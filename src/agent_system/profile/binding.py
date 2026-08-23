"""Assembly-bind command logic: bind a profile to the current machine."""
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
from agent_system.profile.constants import BINDING_VERSION, MACHINE_CONTEXT_NAME, REAL_HOME_PROFILE
from agent_system.profile.models import Profile, ProfileError, Project
from agent_system.profile.util import _atomic_write, _canonical_json, _sha256, _strict_json
from agent_system.profile.project_loading import _select_profile, load_project
from agent_system.profile.home_security import _validate_external_imports, classify_asset_inventory, discover_asset_inventory, enforce_asset_closure
from agent_system.profile.pollution_checks import _check_global_pollution, _check_project_pollution
from agent_system.profile.base_manifest import _base_state, _load_base_manifest, _profile_uses_real_home, _validate_base_layer_operations, _warn_out_of_scope_base_mcps
from agent_system.profile.lock import _desired_lock, _verify_lock
from agent_system.profile.evidence import _verify_evidence


def _profile_layer_digest(project: Project, profile: Profile) -> str:
    locked = _desired_lock(project)["profiles"][profile.name]
    return locked["layer_digest"]

def bind_profile(
    project_root: Path | str,
    profile_name: str,
    manifest_path: Path | str,
    pin_path: Path | str,
    binding_dir: Path | str,
    *,
    private_overlay: Path | str | None = None,
) -> dict[str, Any]:
    """Bind one portable profile layer to an approved machine-specific base."""

    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    project = load_project(project_root, private_overlay)
    _check_project_pollution(project.root)
    if project.overlay is not None:
        _check_project_pollution(project.overlay.root)
    desired = _desired_lock(project)
    _cli._verify_lock(project, desired)
    if project.overlay is not None:
        _verify_evidence(project, desired)
    profile = _select_profile(project, profile_name)
    if not _profile_uses_real_home(profile):
        raise ProfileError(f"profile {profile.name} does not extend {REAL_HOME_PROFILE}")
    manifest, active, _passive = _base_state(manifest_path, pin_path)
    _validate_base_layer_operations(project, profile, manifest)
    _warn_out_of_scope_base_mcps(project, profile, manifest_path)
    inventory = discover_asset_inventory(manifest["home"])
    imported = _validate_external_imports(project, profile, inventory)
    enforce_asset_closure(
        classify_asset_inventory(
            inventory,
            allowed=(
                *profile.skills,
                *profile.mcps,
                *profile.hooks,
                *profile.plugins,
                *imported,
            ),
            denied=tuple(
                capability
                for operations in profile.operations.values()
                for capability in operations.deny
            ),
        )
    )
    if active:
        raise ProfileError(f"active machine-context drift detected: {', '.join(active)}")
    layer_digest = desired["profiles"][profile.name]["layer_digest"]
    effective_digest = "sha256:" + _sha256(_canonical_json({
        "machine_context_digest": manifest["effective_digest"],
        "layer_digest": layer_digest,
        "profile": profile.name,
    }))
    target = Path(binding_dir).expanduser().absolute() / f"{profile.name}.binding.json"
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    payload = {
        "version": BINDING_VERSION,
        "profile": profile.name,
        "machine_context": MACHINE_CONTEXT_NAME,
        "machine_context_digest": manifest["effective_digest"],
        "layer_digest": layer_digest,
        "effective_digest": effective_digest,
    }
    if project.overlay is not None:
        payload["overlay_namespace"] = project.overlay.namespace
    _atomic_write(target, _canonical_json(payload), mode=0o644)
    return payload

def _verify_profile_binding(
    project: Project,
    profile: Profile,
    desired: Mapping[str, Any],
    manifest_path: Path | str,
    pin_path: Path | str,
    binding_dir: Path | str,
) -> tuple[list[str], list[str]]:
    manifest, active, passive = _base_state(manifest_path, pin_path)
    _validate_base_layer_operations(project, profile, manifest)
    binding_path = (
        Path(binding_dir).expanduser().resolve(strict=True)
        / f"{profile.name}.binding.json"
    )
    binding = _strict_json(binding_path)
    layer_digest = desired["profiles"][profile.name]["layer_digest"]
    expected_effective = "sha256:" + _sha256(_canonical_json({
        "machine_context_digest": manifest["effective_digest"],
        "layer_digest": layer_digest,
        "profile": profile.name,
    }))
    expected = {
        "version": BINDING_VERSION,
        "profile": profile.name,
        "machine_context": MACHINE_CONTEXT_NAME,
        "machine_context_digest": manifest["effective_digest"],
        "layer_digest": layer_digest,
        "effective_digest": expected_effective,
    }
    if project.overlay is not None:
        expected["overlay_namespace"] = project.overlay.namespace
    if binding != expected:
        raise ProfileError(
            f"profile {profile.name} binding is stale; run profile bind after review"
        )
    return active, passive

def _check_profile_environment(
    project: Project,
    profile: Profile,
    desired: Mapping[str, Any],
    *,
    base_manifest: Path | str | None,
    base_pin: Path | str | None,
    binding_dir: Path | str | None,
    allow_active_drift: bool = False,
) -> list[str]:
    """Verify the approved machine-context or the legacy clean-home gate."""

    if not _profile_uses_real_home(profile):
        _check_global_pollution()
        return []
    if base_manifest is None or base_pin is None or binding_dir is None:
        raise ProfileError(
            f"profile {profile.name} requires --machine-context-manifest, "
            "--machine-context-pin, and --assembly-binding-dir"
        )
    active, passive = _verify_profile_binding(
        project,
        profile,
        desired,
        base_manifest,
        base_pin,
        binding_dir,
    )
    if active and not allow_active_drift:
        raise ProfileError(f"active machine-context drift detected: {', '.join(active)}")
    machine_context = _load_base_manifest(base_manifest)
    inventory = discover_asset_inventory(machine_context["home"])
    imported = _validate_external_imports(project, profile, inventory)
    allowed = (
        *profile.skills,
        *profile.mcps,
        *profile.hooks,
        *profile.plugins,
        *imported,
    )
    denied = tuple(
        capability
        for operations in profile.operations.values()
        for capability in operations.deny
    )
    enforce_asset_closure(
        classify_asset_inventory(inventory, allowed=allowed, denied=denied)
    )
    return [*(f"active:{path}" for path in active), *passive]
