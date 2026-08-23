"""Project lock computation, verification, and top-level verify_project orchestration."""
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
from agent_system.profile.constants import CLIENTS, CLIENT_EXECUTABLES, EVIDENCE_VERSION, LOCK_VERSION, PROJECT_DEFAULTS_NAME, _client_adapter_version
from agent_system.profile.models import Profile, ProfileError, Project
from agent_system.profile.util import _canonical_json, _sha256, _strict_json
from agent_system.profile.render import _render_tree, _tree_hash
from agent_system.profile.home_security import _canonical_mode, _redacted_file_bytes


def _lock_path(project: Project) -> Path:
    """Return the public or explicit private lock path."""

    root = project.overlay.root if project.overlay is not None else project.root
    return root / ".cap" / "lock.json"

def _desired_lock(project: Project) -> dict[str, Any]:
    # Deferred, module-qualified (not `from .cli import RENDERER_VERSION`):
    # tests monkeypatch `RENDERER_VERSION` on the `cli` facade module to
    # simulate a renderer bump, and a plain import-time name copy here would
    # not see that patch. `cli` imports this module, so the import must be
    # deferred to call time to avoid a circular import at load time.
    import agent_system.profile.cli as _cli

    profiles: dict[str, Any] = {}
    for name, profile in sorted(project.profiles.items()):
        clients = {
            client: {"tree_hash": _tree_hash(_render_tree(project, client, profile))}
            for client in _cli.CLIENTS
        }
        operations = {
            kind: {
                "allow": list(profile.operations[kind].allow),
                "deny": list(profile.operations[kind].deny),
                "override": list(profile.operations[kind].override),
            }
            for kind in ("skills", "mcps", "hooks", "plugins")
        }
        layer = {
            "defaults": PROJECT_DEFAULTS_NAME,
            "chain": list(profile.chain),
            "runtime": dict(profile.runtime),
            "operations": operations,
            "inventory": _profile_inventory(profile),
            "clients": clients,
        }
        layer["layer_digest"] = f"sha256:{_sha256(_canonical_json(layer))}"
        profiles[name] = layer
    payload: dict[str, Any] = {
        "version": LOCK_VERSION,
        "renderer_version": _cli.RENDERER_VERSION,
        "clients": {
            client: {
                "adapter_version": _client_adapter_version(client),
                "executable": _cli.CLIENT_EXECUTABLES[client],
            }
            for client in _cli.CLIENTS
        },
        "capability_semantics": {
            "skills": "native-staging",
            "mcp": "native-config",
            "hooks": "opaque-staging",
            "plugins": "opaque-staging",
        },
        "inputs": _input_records(project),
        "external_imports": list(project.external_imports),
        "profiles": profiles,
    }
    if project.skill_imports:
        payload["project_skill_imports"] = [
            {
                "name": item.name,
                "source": item.source.relative_to(project.root).as_posix(),
            }
            for item in project.skill_imports.values()
        ]
    if project.overlay is not None:
        payload["source_layers"] = [
            {"kind": "public", "root": "project"},
            {
                "kind": "private",
                "namespace": project.overlay.namespace,
                "root": "explicit-overlay",
            },
        ]
        payload["evidence"] = {
            "version": EVIDENCE_VERSION,
            "root": "user-state/evidence",
            "source_digest": f"sha256:{_sha256(_canonical_json(payload['inputs']))}",
        }
    return payload

def _profile_inventory(profile: Profile) -> dict[str, list[str]]:
    return {
        "skills": list(profile.skills),
        "mcps": list(profile.mcps),
        "hooks": list(profile.hooks),
        "plugins": list(profile.plugins),
    }

def _input_records(project: Project) -> dict[str, Any]:
    if project.overlay is None:
        paths: set[Path] = {
            project.manifest,
            project.defaults,
            *project.runtime_policies.values(),
            project.root / "AGENTS.md",
        }
        if project.skill_imports_manifest is not None:
            paths.add(project.skill_imports_manifest)
        for item in project.skill_imports.values():
            paths.add(item.source)
            paths.update(item.source.rglob("*"))
        for profile in project.profiles.values():
            paths.update({profile.source, profile.prompt})
        capability_root = project.root / ".cap" / "capabilities"
        paths.add(capability_root)
        paths.update(capability_root.rglob("*"))
        records: dict[str, Any] = {}
        for path in sorted(
            paths, key=lambda item: item.relative_to(project.root).as_posix()
        ):
            relative = path.relative_to(project.root).as_posix()
            if path.is_symlink():
                raise ProfileError(f"lock input must not be a symlink: {relative}")
            if path.is_dir():
                records[relative] = {"type": "directory"}
            elif path.is_file():
                records[relative] = {
                    "type": "file",
                    "mode": f"{_canonical_mode(path):04o}",
                    "sha256": _sha256(path.read_bytes()),
                }
            else:
                raise ProfileError(
                    f"lock input is not a regular file or directory: {relative}"
                )
        return records

    entries: list[tuple[str, Path]] = [
        ("public/AGENTS.md", project.root / "AGENTS.md"),
        ("public/.cap/manifest.toml", project.manifest),
    ]
    entries.extend(
        (
            "public/" + path.relative_to(project.root).as_posix(),
            path,
        )
        for path in (project.defaults, *project.runtime_policies.values())
    )
    if project.skill_imports_manifest is not None:
        entries.append(
            (
                "public/" + project.skill_imports_manifest.relative_to(project.root).as_posix(),
                project.skill_imports_manifest,
            )
        )
    for item in project.skill_imports.values():
        relative = item.source.relative_to(project.root).as_posix()
        entries.append((f"public/{relative}", item.source))
        entries.extend(
            (
                "public/" + path.relative_to(project.root).as_posix(),
                path,
            )
            for path in item.source.rglob("*")
        )
    roots: dict[Path, str] = {project.root: "public"}
    if project.overlay is not None:
        roots[project.overlay.root] = "private"
        entries.append(
            (
                "private/.cap/manifest.toml",
                project.overlay.root / ".cap" / "manifest.toml",
            )
        )
        if project.overlay.descriptor is not None:
            entries.append(
                ("private/.cap/overlay.toml", project.overlay.descriptor)
            )
    for profile in project.profiles.values():
        prefix = roots[profile.source_root]
        entries.extend(
            (
                f"{prefix}/{path.relative_to(profile.source_root).as_posix()}",
                path,
            )
            for path in (profile.source, profile.prompt)
        )
    for source_root, prefix in roots.items():
        capability_root = source_root / ".cap" / "capabilities"
        entries.append(
            (f"{prefix}/.cap/capabilities", capability_root)
        )
        entries.extend(
            (
                f"{prefix}/{path.relative_to(source_root).as_posix()}",
                path,
            )
            for path in capability_root.rglob("*")
        )
    records: dict[str, Any] = {}
    for relative, path in sorted(entries):
        if path.is_symlink():
            raise ProfileError(f"lock input must not be a symlink: {relative}")
        if path.is_dir():
            records[relative] = {"type": "directory"}
        elif path.is_file():
            records[relative] = {
                "type": "file",
                "mode": f"{_canonical_mode(path):04o}",
                "sha256": _sha256(_redacted_file_bytes(path)),
            }
        else:
            raise ProfileError(
                f"lock input is not a regular file or directory: {relative}"
            )
    return records

def _verify_lock(project: Project, desired: Mapping[str, Any]) -> None:
    lock_path = _lock_path(project)
    if lock_path.is_symlink() or not lock_path.is_file():
        raise ProfileError("missing regular .cap/lock.json; run profile lock")
    actual = _strict_json(lock_path)
    if actual != desired:
        raise ProfileError(
            "capability lock drift detected; run profile lock after reviewing changes"
        )
