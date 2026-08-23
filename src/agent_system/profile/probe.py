"""Runtime state observation (probe/diff) against a rendered profile."""
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
from agent_system.profile.constants import OBSERVATION_DIMENSIONS, REPORT_MARKERS, _client_adapter_version
from agent_system.profile.models import Profile, ProfileError, Project, ReceiptReservation, RenderedFile, StableDirectory
from agent_system.profile.util import _canonical_json, _loads_strict_json, _sha256, _strict_json_from_directory, _validate_client
from agent_system.profile.stable_dir import _close_stable_directory, _open_stable_directory, _require_external_directory, _stable_directory, _validate_stable_directory
from agent_system.profile.project_loading import _select_profile, load_project
from agent_system.profile.render import _render_tree, _rendered_skill_names, _rendered_text, _tree_hash
from agent_system.profile.home_security import _credential_privacy_evidence
from agent_system.profile.pollution_checks import _check_project_pollution
from agent_system.profile.base_manifest import _warn_out_of_scope_base_mcps
from agent_system.profile.lock import _desired_lock, _profile_inventory, _verify_lock
from agent_system.profile.evidence import _verify_evidence
from agent_system.profile.materialize_fs import _materialize_tree
from agent_system.profile.receipt import _commit_receipt, _prepare_receipt_path, _release_receipt, _reserve_receipt
from agent_system.profile.launch import _ephemeral_runtime_root, _execute_runtime, _prepare_execution, _receipt_payload
from agent_system.profile.binding import _check_profile_environment


def parse_reported(text: str, marker: str) -> list[str] | None:
    """Parse one self-report marker, preserving unknown separately from observed none."""

    for line in reversed(text.splitlines()):
        candidate = line.strip().lstrip("+-").strip().strip("`").strip()
        if not candidate.upper().startswith(marker + ":"):
            continue
        body = candidate.split(":", 1)[1].strip().strip("`").strip()
        if body.lower() in {"unknown", "未知"}:
            return None
        if body.lower() in {"none", "无", ""}:
            return []
        return [item.strip().strip("`") for item in body.split(",") if item.strip()]
    return None

def _state_root(
    project: Project, value: Path | str, *, require_empty: bool
) -> StableDirectory:
    """Open an explicit observation directory without remembering a prior selection."""

    candidate = Path(value).expanduser().absolute()
    directory = _open_stable_directory(candidate, "state directory")
    try:
        _require_external_directory(project, directory, "state directory")
        if require_empty and os.listdir(directory.path):
            raise ProfileError("state directory must be empty")
        _validate_stable_directory(directory)
        return directory
    except BaseException:
        _close_stable_directory(directory)
        raise

def _declared_snapshot(
    project: Project,
    client: str,
    profile: Profile,
    desired: Mapping[str, Any],
) -> dict[str, Any]:
    """Describe the selected declaration and its normalized client render."""

    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    context = [str(project.root / "AGENTS.md")]
    if client == "codex":
        context.append("<runtime>/AGENTS.md")
    return {
        "version": 1,
        "client": client,
        "profile": profile.name,
        "renderer_version": _cli.RENDERER_VERSION,
        "adapter_version": _client_adapter_version(client),
        "lock_hash": f"sha256:{_sha256(_canonical_json(desired))}",
        "output_tree_hash": desired["profiles"][profile.name]["clients"][client][
            "tree_hash"
        ],
        "inventory": _profile_inventory(profile),
        "external_imports": list(project.external_imports),
        "evidence": {
            "declared": "ok",
            "configured": "rendered",
            "effective": "unknown",
            "credential_privacy": _credential_privacy_evidence(),
        },
        "context": context,
        "capability_semantics": desired["capability_semantics"],
    }

def _configured_mcp_names(tree: Mapping[str, RenderedFile], client: str) -> list[str]:
    """Read native MCP server names directly from the immutable rendered tree."""

    if client == "codex":
        try:
            data = tomllib.loads(
                _rendered_text(
                    tree,
                    "config.toml",
                    "rendered Codex configuration",
                    require_nonempty=False,
                )
            )
        except tomllib.TOMLDecodeError as error:
            raise ProfileError(
                f"rendered Codex configuration is invalid: {error}"
            ) from error
        servers = data.get("mcp_servers", {})
    elif client in {"qoder", "omp", "claude"}:
        relative = "mcp.json"
        data = _loads_strict_json(
            _rendered_text(tree, relative, "rendered MCP configuration"),
            f"<rendered-tree>/{relative}",
        )
        servers = data.get("mcpServers", {}) if isinstance(data, dict) else None
    else:
        raise ProfileError(f"client {client} has no MCP reader")
    if not isinstance(servers, dict):
        raise ProfileError("rendered MCP configuration has an invalid server table")
    return sorted(servers)

def probe_profile(
    project_root: Path | str,
    client: str,
    profile_name: str,
    state_root: Path | str,
    *,
    private_overlay: Path | str | None = None,
    base_manifest: Path | str | None = None,
    base_pin: Path | str | None = None,
    binding_dir: Path | str | None = None,
) -> dict[str, Any]:
    """Observe the rendered configuration plane without invoking an agent or model."""

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
    _check_profile_environment(
        project,
        profile,
        desired,
        base_manifest=base_manifest,
        base_pin=base_pin,
        binding_dir=binding_dir,
    )
    _warn_out_of_scope_base_mcps(project, profile, base_manifest)
    _validate_client(client)
    state = _state_root(project, state_root, require_empty=True)
    try:
        expected_hash = desired["profiles"][profile.name]["clients"][client][
            "tree_hash"
        ]
        with _ephemeral_runtime_root(f"probe-{client}", profile.name) as runtime_root:
            tree = _render_tree(project, client, profile)
            if _tree_hash(tree) != expected_hash:
                raise ProfileError("rendered output drifted after lock verification")
            with _stable_directory(
                runtime_root, "probe runtime root"
            ) as runtime_directory:
                _materialize_tree(runtime_directory, tree)
                skills = list(_rendered_skill_names(tree))
                mcps = _configured_mcp_names(tree, client)
        declared = _declared_snapshot(project, client, profile, desired)
        probed = {
            "version": 1,
            "client": client,
            "profile": profile.name,
            "plane": "configured",
            "probed_at": datetime.now(timezone.utc).isoformat(),
            "observed": {
                "skills": skills,
                "mcps": mcps,
                "context": None,
                "hooks": None,
                "plugins": None,
            },
            "candidates": {"context": declared["context"]},
            "staged": {
                "hooks": list(profile.hooks),
                "plugins": list(profile.plugins),
            },
            "caveats": [
                "context candidates are not proof that the client loaded them",
                "hooks and plugins are opaque-staging until native loading is verified",
                "configured state is not effective runtime state",
            ],
        }
        _materialize_tree(
            state,
            {
                "declared.json": RenderedFile(_canonical_json(declared)),
                "probed.json": RenderedFile(_canonical_json(probed)),
            },
        )
        return probed
    finally:
        _close_stable_directory(state)

def run_observed(
    project_root: Path | str,
    client: str,
    profile_name: str,
    state_root: Path | str,
    forwarded_args: Sequence[str] = (),
    *,
    auth_root: Path | str,
    receipt_path: Path | str | None = None,
    workdir: Path | str | None = None,
    runner: Callable[..., Any] | None = None,
    private_overlay: Path | str | None = None,
    base_manifest: Path | str | None = None,
    base_pin: Path | str | None = None,
    binding_dir: Path | str | None = None,
) -> int:
    """Run one batch client, capture self-reported effective state, and clean its root."""

    project, profile, desired, args = _prepare_execution(
        project_root,
        client,
        profile_name,
        forwarded_args,
        private_overlay=private_overlay,
        base_manifest=base_manifest,
        base_pin=base_pin,
        binding_dir=binding_dir,
    )
    state = _state_root(project, state_root, require_empty=True)
    reservation: ReceiptReservation | None = None
    committed = False
    try:
        receipt_target = _prepare_receipt_path(
            receipt_path or state.path / "receipt.json"
        )
        reservation = _reserve_receipt(
            project,
            receipt_target,
            parent_directory=state if receipt_target.parent == state.path else None,
        )
        declared = _declared_snapshot(project, client, profile, desired)
        _materialize_tree(
            state,
            {"declared.json": RenderedFile(_canonical_json(declared))},
        )
        started = datetime.now(timezone.utc)
        return_code, stdout, stderr = _execute_runtime(
            project,
            client,
            profile,
            desired,
            args,
            auth_root=auth_root,
            runner=runner or subprocess.run,
            capture_output=True,
            workdir=workdir,
            base_manifest=base_manifest,
            base_pin=base_pin,
            binding_dir=binding_dir,
        )
        ended = datetime.now(timezone.utc)
        text = stdout + "\n" + stderr
        reported = {
            dimension: parse_reported(text, REPORT_MARKERS[dimension])
            for dimension in OBSERVATION_DIMENSIONS
        }
        client_limited = {
            "codex": {"mcps", "context"},
            "qoder": set(),
            "omp": {"mcps"},
        }[client]
        forced_unknown = {"hooks", "plugins"} | client_limited
        effective = {
            "version": 1,
            "client": client,
            "profile": profile.name,
            "plane": "effective",
            "started_at": started.isoformat(),
            "ended_at": ended.isoformat(),
            "duration_s": round((ended - started).total_seconds()),
            "exit_code": return_code,
            "forwarded_argument_count": len(args),
            "observed": {
                dimension: None if dimension in forced_unknown else reported[dimension]
                for dimension in OBSERVATION_DIMENSIONS
            },
            "reported_opaque_staging": {
                dimension: reported[dimension] for dimension in ("hooks", "plugins")
            },
            "reported_client_limited": {
                dimension: reported[dimension] for dimension in sorted(client_limited)
            },
            "evidence": (
                "client output self-report; missing or explicit unknown markers remain unknown; "
                "hook/plugin reports remain opaque-staging; client-limited dimensions are retained "
                "only as unreliable reports rather than effective observations"
            ),
        }
        _materialize_tree(
            state,
            {"effective.json": RenderedFile(_canonical_json(effective))},
        )
        _commit_receipt(
            reservation,
            _canonical_json(
                _receipt_payload(client, profile, desired, args, return_code)
            ),
        )
        committed = True
        if stdout:
            print(stdout, end="" if stdout.endswith("\n") else "\n")
        if stderr:
            print(stderr, end="" if stderr.endswith("\n") else "\n", file=sys.stderr)
        return return_code if return_code >= 0 else 128 + abs(return_code)
    finally:
        if reservation is not None:
            _release_receipt(reservation, remove=not committed)
        _close_stable_directory(state)

def _observation_key(dimension: str, value: str) -> str:
    if dimension != "context":
        return value.strip()
    normalized = value.strip().strip("`").replace("\\", "/").rstrip("/")
    return os.path.normcase(normalized)

def diff_profile(
    project_root: Path | str,
    client: str,
    profile_name: str,
    state_root: Path | str,
    *,
    private_overlay: Path | str | None = None,
    base_manifest: Path | str | None = None,
    base_pin: Path | str | None = None,
    binding_dir: Path | str | None = None,
) -> int:
    """Compare one immutable declaration with the separately captured effective state."""

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
    _check_profile_environment(
        project,
        profile,
        desired,
        base_manifest=base_manifest,
        base_pin=base_pin,
        binding_dir=binding_dir,
    )
    _warn_out_of_scope_base_mcps(project, profile, base_manifest)
    _validate_client(client)
    state = _state_root(project, state_root, require_empty=False)
    try:
        try:
            declared = _strict_json_from_directory(state, "declared.json")
            effective = _strict_json_from_directory(state, "effective.json")
        except ProfileError as error:
            if "state file missing:" in str(error):
                raise ProfileError(
                    "diff requires declared.json and effective.json from one observed run"
                ) from error
            raise
        current = _declared_snapshot(project, client, profile, desired)
        if declared != current:
            raise ProfileError(
                "declared observation no longer matches the selected locked profile"
            )
        if (
            not isinstance(effective, dict)
            or effective.get("client") != client
            or effective.get("profile") != profile.name
        ):
            raise ProfileError(
                "effective observation belongs to a different client or profile"
            )
        observed_by_dimension = effective.get("observed")
        if not isinstance(observed_by_dimension, dict):
            raise ProfileError("effective observation has no observed dimension table")
        expected = {
            "skills": list(profile.skills),
            "mcps": list(profile.mcps),
            "context": list(current["context"]),
            "hooks": list(profile.hooks),
            "plugins": list(profile.plugins),
        }
        problems: list[str] = []
        unknowns: list[str] = []
        print(f"profile: {profile.name}  client: {client}")
        for dimension in OBSERVATION_DIMENSIONS:
            observed = observed_by_dimension.get(dimension)
            effective_text = observed if observed is not None else "unknown"
            print(
                f"[{dimension}] declared={expected[dimension] or '(none)'} "
                f"effective={effective_text}"
            )
            if observed is None:
                unknowns.append(
                    f"{dimension}: unknown; absence of evidence is not observed none"
                )
                continue
            if not isinstance(observed, list) or any(
                not isinstance(item, str) for item in observed
            ):
                raise ProfileError(
                    f"effective observation {dimension} must be an array or null"
                )
            expected_keys = {
                _observation_key(dimension, item): item for item in expected[dimension]
            }
            observed_keys = {
                _observation_key(dimension, item): item for item in observed
            }
            missing = sorted(
                expected_keys[key]
                for key in expected_keys.keys() - observed_keys.keys()
            )
            extra = sorted(
                observed_keys[key]
                for key in observed_keys.keys() - expected_keys.keys()
            )
            if missing:
                problems.append(f"{dimension} missing: {missing}")
            if extra:
                problems.append(f"{dimension} outside declaration: {extra}")
        if effective.get("exit_code") != 0:
            problems.append(f"client exit code was {effective.get('exit_code')}")
        if unknowns:
            print("unknown:")
            for item in unknowns:
                print(f"  ? {item}")
        if problems:
            print("drift:")
            for item in problems:
                print(f"  - {item}")
            return 1
        if unknowns:
            print("result: unknown; one or more effective dimensions were not observed")
            return 2
        print("result: no observed drift")
        return 0
    finally:
        _close_stable_directory(state)
