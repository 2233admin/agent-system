"""machine-context manifest and pin lifecycle (create/approve/diff)."""
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
from agent_system.profile.constants import BASE_MANIFEST_VERSION, BASE_PIN_VERSION, MACHINE_CONTEXT_NAME, REAL_HOME_PROFILE
from agent_system.profile.models import Profile, ProfileError, Project
from agent_system.profile.util import _atomic_write, _canonical_json, _expect_keys, _sha256, _strict_json
from agent_system.profile.home_security import _controlled_output_path, discover_real_home


def create_base_manifest(
    home_root: Path | str, manifest_path: Path | str
) -> dict[str, Any]:
    """Refresh the private machine-context manifest without approving it."""

    payload = discover_real_home(home_root)
    target = _controlled_output_path(manifest_path, "machine-context manifest")
    _atomic_write(target, _canonical_json(payload), mode=0o600)
    return payload

def _load_base_manifest(path: Path | str) -> dict[str, Any]:
    target = Path(path).expanduser().resolve(strict=True)
    payload = _strict_json(target)
    if not isinstance(payload, Mapping):
        raise ProfileError("machine-context manifest must be an object")
    _expect_keys(
        payload,
        {
            "version",
            "context",
            "home",
            "effective_digest",
            "inventory_digest",
            "entries",
        },
        "machine-context manifest",
    )
    if payload["version"] != BASE_MANIFEST_VERSION:
        raise ProfileError(
            f"machine-context manifest.version must be {BASE_MANIFEST_VERSION}"
        )
    if payload["context"] != MACHINE_CONTEXT_NAME:
        raise ProfileError(
            f"machine-context manifest.context must be {MACHINE_CONTEXT_NAME}"
        )
    if not isinstance(payload["entries"], list):
        raise ProfileError("machine-context manifest.entries must be an array")
    effective = [
        entry
        for entry in payload["entries"]
        if isinstance(entry, Mapping) and entry.get("state") == "active"
    ]
    expected_effective = f"sha256:{_sha256(_canonical_json(effective))}"
    expected_inventory = (
        f"sha256:{_sha256(_canonical_json(payload['entries']))}"
    )
    if payload["effective_digest"] != expected_effective:
        raise ProfileError("machine-context effective_digest is invalid")
    if payload["inventory_digest"] != expected_inventory:
        raise ProfileError("machine-context inventory_digest is invalid")
    return dict(payload)

def approve_base_manifest(
    manifest_path: Path | str, pin_path: Path | str
) -> dict[str, Any]:
    """Approve one reviewed machine-context digest without copying its inventory."""

    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    manifest = _load_base_manifest(manifest_path)
    payload = {
        "version": BASE_PIN_VERSION,
        "context": MACHINE_CONTEXT_NAME,
        "approved_digest": manifest["effective_digest"],
        "approved_at": datetime.now(timezone.utc).isoformat(),
        "tool_version": _cli.RENDERER_VERSION,
        "policy": "tiered-gate",
    }
    target = _controlled_output_path(pin_path, "machine-context pin")
    _atomic_write(target, _canonical_json(payload), mode=0o644)
    return payload

def _load_base_pin(path: Path | str) -> dict[str, Any]:
    payload = _strict_json(Path(path).expanduser().resolve(strict=True))
    if not isinstance(payload, Mapping):
        raise ProfileError("machine-context pin must be an object")
    _expect_keys(
        payload,
        {
            "version",
            "context",
            "approved_digest",
            "approved_at",
            "tool_version",
            "policy",
        },
        "machine-context pin",
    )
    if payload["version"] != BASE_PIN_VERSION:
        raise ProfileError(
            f"machine-context pin.version must be {BASE_PIN_VERSION}"
        )
    if payload["context"] != MACHINE_CONTEXT_NAME:
        raise ProfileError(
            f"machine-context pin.context must be {MACHINE_CONTEXT_NAME}"
        )
    if payload["policy"] != "tiered-gate":
        raise ProfileError("machine-context pin.policy must be tiered-gate")
    return dict(payload)

def _profile_uses_real_home(profile: Profile) -> bool:
    """All v3 roles run inside the approved machine context."""

    return True

def _base_diff(
    locked: Mapping[str, Any], live: Mapping[str, Any]
) -> tuple[list[str], list[str]]:
    locked_entries = {
        entry["path"]: entry
        for entry in locked["entries"]
        if isinstance(entry, Mapping) and isinstance(entry.get("path"), str)
    }
    live_entries = {
        entry["path"]: entry
        for entry in live["entries"]
        if isinstance(entry, Mapping) and isinstance(entry.get("path"), str)
    }
    active: list[str] = []
    passive: list[str] = []
    for path in sorted(set(locked_entries) | set(live_entries)):
        before = locked_entries.get(path)
        after = live_entries.get(path)
        if before == after:
            continue
        if (before and before.get("state") == "active") or (
            after and after.get("state") == "active"
        ):
            active.append(path)
        else:
            passive.append(path)
    return active, passive

def _project_declared_capabilities(
    project: Project, profile: Profile, field: str
) -> set[str]:
    """Return the effective project-declared capability set."""

    return set(getattr(profile, field))

def _out_of_scope_base_mcps(
    project: Project, profile: Profile, manifest: Mapping[str, Any]
) -> list[tuple[str, str]]:
    """Return active base MCP ids not explicitly selected by project layers."""

    declared = _project_declared_capabilities(project, profile, "mcps")
    findings: set[tuple[str, str]] = set()
    for entry in manifest["entries"]:
        if not isinstance(entry, Mapping) or entry.get("state") != "active":
            continue
        path = entry.get("path")
        capabilities = entry.get("capabilities")
        if not isinstance(path, str) or not isinstance(capabilities, Mapping):
            continue
        names = capabilities.get("mcps")
        if not isinstance(names, list):
            continue
        for name in names:
            if isinstance(name, str) and name not in declared:
                findings.add((name, path))
    return sorted(findings)

def _warn_out_of_scope_base_mcps(
    project: Project, profile: Profile, manifest_path: Path | str | None
) -> None:
    """Warn the operator before an ambient base MCP can surprise the selected profile."""

    if manifest_path is None or not _profile_uses_real_home(profile):
        return
    manifest = _load_base_manifest(manifest_path)
    findings = _out_of_scope_base_mcps(project, profile, manifest)
    if not findings:
        return
    details = ", ".join(f"{name} ({path})" for name, path in findings)
    print(
        f"profile: warning: {profile.name} has out-of-scope base MCP(s): {details}; "
        "they are not part of the project-declared capability closure",
        file=sys.stderr,
    )

def _validate_base_layer_operations(
    project: Project, profile: Profile, manifest: Mapping[str, Any]
) -> None:
    """Resolve every operation against approved base ids and reject silent collisions."""

    base_names: dict[str, set[str]] = {
        field: {
            name
            for entry in manifest["entries"]
            if isinstance(entry, Mapping) and entry.get("state") == "active"
            for name in (
                entry.get("capabilities", {}).get(field, ())
                if isinstance(entry.get("capabilities"), Mapping)
                else ()
            )
            if isinstance(name, str)
        }
        for field in ("skills", "mcps", "hooks", "plugins")
    }
    effective = {field: set(names) for field, names in base_names.items()}
    for layer_name in profile.chain:
        if layer_name == REAL_HOME_PROFILE:
            continue
        layer = project.profiles.get(layer_name)
        if layer is None:
            continue
        for field in ("skills", "mcps", "hooks", "plugins"):
            operations = layer.operations[field]
            duplicate_allows = set(operations.allow) & effective[field]
            if duplicate_allows:
                raise ProfileError(
                    f"profile {layer.name}.{field}.allow conflicts with base/layer names: "
                    f"{sorted(duplicate_allows)}"
                )
            missing_denies = set(operations.deny) - effective[field]
            missing_overrides = set(operations.override) - effective[field]
            if missing_denies or missing_overrides:
                raise ProfileError(
                    f"profile {layer.name}.{field} references unknown inherited names: "
                    f"{sorted(missing_denies | missing_overrides)}"
                )
            effective[field].difference_update(operations.deny)
            effective[field].difference_update(operations.override)
            effective[field].update(operations.override)
            effective[field].update(operations.allow)

def _base_state(
    manifest_path: Path | str, pin_path: Path | str
) -> tuple[dict[str, Any], list[str], list[str]]:
    manifest = _load_base_manifest(manifest_path)
    pin = _load_base_pin(pin_path)
    if pin["approved_digest"] != manifest["effective_digest"]:
        raise ProfileError(
            "machine-context pin does not approve the current machine-context digest"
        )
    live = discover_real_home(manifest["home"])
    active, passive = _base_diff(manifest, live)
    return manifest, active, passive
