"""Evidence/generation manifest writing and verification."""
from __future__ import annotations

import argparse
import errno
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import tomllib
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Iterator, Mapping, Sequence
from urllib.parse import urlsplit


from agent_system.profile.constants import *  # noqa: F401,F403
from agent_system.profile.constants import CLIENTS, EVIDENCE_VERSION
from agent_system.profile.models import ProfileError, Project, RenderedFile
from agent_system.profile.util import _atomic_write, _canonical_json, _sha256, _strict_json
from agent_system.profile.render import _render_tree, _tree_hash
from agent_system.profile.home_security import _canonical_mode, _redacted_file_bytes
from agent_system.profile.lock import _input_records


def _evidence_root() -> Path:
    configured = os.environ.get("CAP_EVIDENCE_ROOT")
    return Path(configured).expanduser().absolute() if configured else (
        Path.home() / ".agent-system-state" / "evidence"
    )

def _evidence_source_path(project: Project, relative: str) -> Path:
    if relative.startswith("public/"):
        return project.root / relative.removeprefix("public/")
    if project.overlay is None or not relative.startswith("private/"):
        raise ProfileError(f"unknown evidence source: {relative}")
    return project.overlay.root / relative.removeprefix("private/")

def _evidence_entries(tree: Mapping[str, RenderedFile]) -> list[dict[str, Any]]:
    return [
        {
            "path": path,
            "mode": f"{rendered.mode:04o}",
            "size": len(rendered.content),
            "sha256": _sha256(rendered.content),
        }
        for path, rendered in sorted(tree.items())
    ]

def _write_evidence_json(root: Path, payload: Mapping[str, Any]) -> None:
    _atomic_write(root / "evidence.json", _canonical_json(dict(payload)), mode=0o600)

def _write_evidence_entries(root: Path, entries: Sequence[Mapping[str, Any]]) -> None:
    content = b"".join(
        _canonical_json(dict(entry)) for entry in entries
    )
    _atomic_write(root / "entries.jsonl", content, mode=0o600)

def _materialize_evidence(project: Project, desired: Mapping[str, Any]) -> None:
    """Materialize non-secret source and render evidence for an overlay lock."""

    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    if project.overlay is None:
        return
    root = _evidence_root()
    if root.is_symlink():
        raise ProfileError("evidence root must not be a symlink")
    root.mkdir(parents=True, exist_ok=True)
    source_digest = f"sha256:{_sha256(_canonical_json(_input_records(project)))}"
    source_root = root / "sources" / source_digest
    source_entries: list[dict[str, Any]] = []
    for relative, record in _input_records(project).items():
        if record["type"] != "file":
            continue
        source = _evidence_source_path(project, relative)
        content = _redacted_file_bytes(source)
        target = source_root / "tree" / relative
        _atomic_write(target, content, mode=_canonical_mode(source))
        source_entries.append(
            {
                "path": relative,
                "mode": record["mode"],
                "size": len(content),
                "sha256": _sha256(content),
            }
        )
    _write_evidence_entries(source_root, source_entries)
    _write_evidence_json(
        source_root,
        {
            "version": EVIDENCE_VERSION,
            "kind": "source",
            "digest": source_digest,
            "entries": source_entries,
            "excluded": ["secret", "auth", "session", "history", "cache"],
        },
    )
    for profile_name, profile_data in desired["profiles"].items():
        closure_digest = profile_data["layer_digest"]
        closure_root = root / "closures" / closure_digest
        _write_evidence_json(
            closure_root,
            {
                "version": EVIDENCE_VERSION,
                "kind": "closure",
                "digest": closure_digest,
                "profile": profile_name,
                "source_digest": source_digest,
                "inventory": profile_data["inventory"],
            },
        )
        for client in _cli.CLIENTS:
            tree = _render_tree(project, client, project.profiles[profile_name])
            tree_hash = profile_data["clients"][client]["tree_hash"]
            render_root = root / "renders" / tree_hash / profile_name / client
            entries = _evidence_entries(tree)
            for relative, rendered in tree.items():
                _atomic_write(
                    render_root / "tree" / relative,
                    rendered.content,
                    mode=rendered.mode,
                )
            _write_evidence_entries(render_root, entries)
            _write_evidence_json(
                render_root,
                {
                    "version": EVIDENCE_VERSION,
                    "kind": "render",
                    "digest": tree_hash,
                    "profile": profile_name,
                    "client": client,
                    "source_digest": source_digest,
                    "closure_digest": closure_digest,
                    "entries": entries,
                },
            )

def _verify_evidence(project: Project, desired: Mapping[str, Any]) -> None:
    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    if project.overlay is None:
        return
    root = _evidence_root()
    source_digest = f"sha256:{_sha256(_canonical_json(_input_records(project)))}"
    source_root = root / "sources" / source_digest
    source_payload = _strict_json(source_root / "evidence.json")
    if source_payload.get("digest") != source_digest:
        raise ProfileError("source evidence digest mismatch")
    for profile_name, profile_data in desired["profiles"].items():
        closure_root = root / "closures" / profile_data["layer_digest"]
        closure = _strict_json(closure_root / "evidence.json")
        if closure.get("source_digest") != source_digest:
            raise ProfileError(f"profile {profile_name} closure evidence is stale")
        for client in _cli.CLIENTS:
            tree_hash = profile_data["clients"][client]["tree_hash"]
            render_root = root / "renders" / tree_hash / profile_name / client
            payload = _strict_json(render_root / "evidence.json")
            tree = _render_tree(project, client, project.profiles[profile_name])
            if payload.get("digest") != tree_hash or _tree_hash(tree) != tree_hash:
                raise ProfileError(
                    f"profile {profile_name}/{client} render evidence is stale"
                )
            for relative, rendered in tree.items():
                path = render_root / "tree" / relative
                if not path.is_file() or path.read_bytes() != rendered.content:
                    raise ProfileError(
                        f"profile {profile_name}/{client} render evidence is missing or modified"
                    )
