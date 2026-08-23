#!/usr/bin/env python3
"""Lock, render, launch, and observe explicit project capability profiles.

This module is now a thin facade: the v3 profile engine lives in the
sibling modules under this package (see module docstrings), split out of
what used to be a single ~5300-line file. Every public and private name
the engine previously exposed from here is re-exported unchanged so
existing `from agent_system.profile import cli as profile_cli` call
sites keep working without modification.
"""
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


from agent_system.profile.constants import RENDERER_VERSION, LOCK_VERSION, MANIFEST_VERSION, PROFILE_VERSION, BASE_MANIFEST_VERSION, BASE_PIN_VERSION, BINDING_VERSION, OVERLAY_VERSION, PROJECT_SKILL_IMPORTS_VERSION, EVIDENCE_VERSION, MACHINE_CONTEXT_NAME, REAL_HOME_PROFILE, PROJECT_DEFAULTS_NAME, CLIENTS, LAUNCHABLE_CLIENTS, CLIENT_EXECUTABLES, CLIENT_ADAPTER_VERSION, IDENTIFIER, CAPABILITY_KINDS, PROJECT_BYPASS_DIRS, PROJECT_BYPASS_FILES, PROJECT_BYPASS_PATHS, GLOBAL_CAPABILITY_PATHS, GLOBAL_FLOOR_PATHS, HOST_FLOOR_TEXT, CODEX_CAPABILITY_FEATURES, CODEX_RUNTIME_ONLY_FEATURES, CODEX_RUNTIME_ONLY_KEYS, CODEX_CAPABILITY_KEYS, ORCA_MANAGED_EXTENSION_NAMES, CODEX_EXPLICITLY_DISABLABLE_ROOTS, GLOBAL_NATIVE_ROOTS, AMBIENT_CONFIG_ENV, OMP_AMBIENT_AUTH_ENV, OMP_AMBIENT_CREDENTIAL_SUFFIXES, _is_ambient_credential_name, FORBIDDEN_CLIENT_ARGUMENTS, FORBIDDEN_CLIENT_ARGUMENT_PREFIXES, OBSERVATION_DIMENSIONS, REPORT_MARKERS, SECRET_KEY_PATTERN, SECRET_LINE_PATTERN, REAL_HOME_CONFIG_KEYS, _client_adapter_version
from agent_system.profile.models import ProfileError, McpDefinition, CapabilityOperations, ProjectSkillImport, Profile, OverlaySpec, Project, RenderedFile, LaunchSpec, AuthBinding, ReceiptReservation, StableDirectory
from agent_system.profile.util import _read_toml, _loads_strict_json, _strict_json, _strict_json_from_directory, _expect_keys, _validate_identifier, _identifier_list, _safe_relative, _resolve_file, _resolve_directory, _require_under_cap, _read_nonempty_text, _validate_client, _require_git_root, _contains_mapping_key, _text_has_top_level_key, _atomic_write, _canonical_json, _sha256, _print_json
from agent_system.profile.stable_dir import _same_file_identity, _is_link_component, _validate_stable_directory, _normalize_root_alias, _open_stable_directory, _close_stable_directory, _stable_directory, _stable_directory_is_within, _stable_directory_is_same, _home_relative_name, _require_external_directory
from agent_system.profile.capability_store import _validate_capability_store, _require_directory, _validate_capability_tree, _load_mcp
from agent_system.profile.project_loading import _load_layer_operations, _load_external_imports, _load_project_skill_imports, _load_overlay_spec, load_project, _select_profile
from agent_system.profile.render import _rendered_text, _rendered_skill_names, _render_tree, _profile_prompt, _codex_config, _qoder_mcp, _claude_mcp, _omp_mcp, _toml_string, _toml_array, _toml_key, _tree_hash
from agent_system.profile.home_security import _private_checks_are_expressible, _credential_privacy_evidence, _validate_private_directory, _read_private_file, _read_stable_private_value, _validate_private_tree, _redact_secret_values, _canonical_mode, _redacted_file_bytes, _home_path_digest, _home_entry_kind, _home_capability_inventory, discover_real_home, discover_asset_inventory, classify_asset_inventory, enforce_asset_closure, _validate_external_imports, _controlled_output_path
from agent_system.profile.pollution_checks import _path_key, _managed_publication_paths, _check_project_pollution, _codex_capability_root_is_disabled, _codex_config_has_active_capability, _qoder_hooks_are_ignored_host_integrations, _qoder_config_has_active_capability, _matches_host_floor, _path_has_symlink_component, _tree_has_symlink, _codex_system_skills_are_disabled, _qoder_plugin_cache_is_disabled, _orca_managed_extensions_are_inert, _global_path_is_passive, _check_global_pollution
from agent_system.profile.base_manifest import create_base_manifest, _load_base_manifest, approve_base_manifest, _load_base_pin, _profile_uses_real_home, _base_diff, _project_declared_capabilities, _out_of_scope_base_mcps, _warn_out_of_scope_base_mcps, _validate_base_layer_operations, _base_state
from agent_system.profile.lock import _lock_path, _desired_lock, _profile_inventory, _input_records, _verify_lock
from agent_system.profile.evidence import _evidence_root, _evidence_source_path, _evidence_entries, _write_evidence_json, _write_evidence_entries, _materialize_evidence, _verify_evidence
from agent_system.profile.materialize_fs import _write_all, _fsync_directory, _stage_tree, _publish_staged_entry, _materialize_tree
from agent_system.profile.receipt import _prepare_receipt_path, _reserve_receipt, _validate_receipt_reservation, _commit_receipt, _unlink_reserved_receipt, _release_receipt
from agent_system.profile.probe import parse_reported, _state_root, _declared_snapshot, _configured_mcp_names, probe_profile, run_observed, _observation_key, diff_profile
from agent_system.profile.launch import _create_auth_symlink, _validate_broker_url, _parse_codex_auth, _parse_omp_broker_metadata, _parse_omp_broker_token, _staged_auth, build_launch, _prepare_execution, _prepare_workdir, _execute_runtime, _receipt_payload, run_client, _ephemeral_runtime_root, _validate_forwarded_args
from agent_system.profile.binding import _profile_layer_digest, bind_profile, _verify_profile_binding, _check_profile_environment


def create_lock(
    project_root: Path | str, private_overlay: Path | str | None = None
) -> dict[str, Any]:
    """Create the deterministic lock for a public project or private overlay."""

    project = load_project(project_root, private_overlay)
    _check_project_pollution(project.root)
    if project.overlay is not None:
        _check_project_pollution(project.overlay.root)
    payload = _desired_lock(project)
    lock_path = _lock_path(project)
    if lock_path.is_symlink():
        raise ProfileError("lock file must not be a symlink")
    _atomic_write(lock_path, _canonical_json(payload), mode=0o644)
    _materialize_evidence(project, payload)
    return payload

def verify_project(
    project_root: Path | str,
    *,
    private_overlay: Path | str | None = None,
    base_manifest: Path | str | None = None,
    base_pin: Path | str | None = None,
    binding_dir: Path | str | None = None,
) -> dict[str, Any]:
    """Verify the portable lock, evidence and every selected base binding."""

    project = load_project(project_root, private_overlay)
    _check_project_pollution(project.root)
    if project.overlay is not None:
        _check_project_pollution(project.overlay.root)
    desired = _desired_lock(project)
    _verify_lock(project, desired)
    if project.overlay is not None:
        _verify_evidence(project, desired)
    for profile in project.profiles.values():
        _check_profile_environment(
            project,
            profile,
            desired,
            base_manifest=base_manifest,
            base_pin=base_pin,
            binding_dir=binding_dir,
        )
        _warn_out_of_scope_base_mcps(project, profile, base_manifest)
    return desired

def materialize_profile(
    project_root: Path | str,
    client: str,
    profile_name: str,
    output_root: Path | str,
    *,
    private_overlay: Path | str | None = None,
    base_manifest: Path | str | None = None,
    base_pin: Path | str | None = None,
    binding_dir: Path | str | None = None,
) -> str:
    """Verify and render one profile into an explicit, existing empty directory."""

    project = load_project(project_root, private_overlay)
    _check_project_pollution(project.root)
    if project.overlay is not None:
        _check_project_pollution(project.overlay.root)
    desired = _desired_lock(project)
    _verify_lock(project, desired)
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
    output = Path(output_root).expanduser().absolute()
    with _stable_directory(output, "render output") as output_directory:
        _require_external_directory(project, output_directory, "render output")
        if os.listdir(output_directory.path):
            raise ProfileError("render output directory must be empty")
        tree = _render_tree(project, client, profile)
        tree_hash = _tree_hash(tree)
        expected_hash = desired["profiles"][profile_name]["clients"][client][
            "tree_hash"
        ]
        if tree_hash != expected_hash:
            raise ProfileError("rendered output drifted after lock verification")
        _materialize_tree(output_directory, tree)
        return tree_hash

def list_profiles(
    project_root: Path | str, private_overlay: Path | str | None = None
) -> tuple[str, ...]:
    """Return locked explicit profile names in deterministic order."""

    project = load_project(project_root, private_overlay)
    _check_project_pollution(project.root)
    _verify_lock(project, _desired_lock(project))
    if project.overlay is not None:
        _verify_evidence(project, _desired_lock(project))
    return tuple(sorted(project.profiles))

def explain_profile(
    project_root: Path | str,
    profile_name: str,
    private_overlay: Path | str | None = None,
) -> dict[str, Any]:
    """Return one locked profile layer, closure, render hashes and evidence."""

    project = load_project(project_root, private_overlay)
    _check_project_pollution(project.root)
    desired = _desired_lock(project)
    _verify_lock(project, desired)
    if project.overlay is not None:
        _verify_evidence(project, desired)
    profile = _select_profile(project, profile_name)
    if not _profile_uses_real_home(profile):
        _check_global_pollution()
    locked = desired["profiles"][profile.name]
    prompt = (
        profile.prompt.relative_to(profile.source_root).as_posix()
        if profile.prompt.is_relative_to(profile.source_root)
        else str(profile.prompt)
    )
    result = {
        "profile": profile.name,
        "extends": profile.extends,
        "chain": list(profile.chain),
        "prompt": prompt,
        "operations": locked["operations"],
        "inventory": _profile_inventory(profile),
        "external_imports": list(project.external_imports),
        "skill_imports": [
            {
                "name": imported.name,
                "source": imported.source.relative_to(project.root).as_posix(),
            }
            for imported in project.skill_imports.values()
            if imported.name in profile.skills
        ],
        "evidence": {
            "declared": "ok",
            "configured": "lock-verified",
            "effective": "unknown",
            "credential_privacy": _credential_privacy_evidence(),
        },
        "layer_digest": locked["layer_digest"],
        "clients": locked["clients"],
    }
    if project.overlay is not None:
        result["overlay"] = {
            "namespace": project.overlay.namespace,
            "source": "explicit-overlay",
            "evidence_root": str(_evidence_root()),
        }
    return result

def main(argv: Sequence[str] | None = None) -> int:
    """Run the sole profile command-line interface and return its process exit code."""

    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        project = Path(args.project)
        if args.command == "machine-context-lock":
            payload = create_base_manifest(args.home, args.manifest)
            _print_json(
                {
                    "status": "locked-not-approved",
                    "context": MACHINE_CONTEXT_NAME,
                    "effective_digest": payload["effective_digest"],
                    "inventory_digest": payload["inventory_digest"],
                }
            )
            return 0
        if args.command == "machine-context-approve":
            payload = approve_base_manifest(args.manifest, args.pin)
            _print_json(
                {
                    "status": "approved",
                    "context": MACHINE_CONTEXT_NAME,
                    "approved_digest": payload["approved_digest"],
                }
            )
            return 0
        if args.command == "assembly-bind":
            payload = bind_profile(
                project,
                args.profile,
                args.base_manifest,
                args.base_pin,
                args.binding_dir,
                private_overlay=args.private_overlay,
            )
            _print_json({"status": "bound", **payload})
            return 0
        if args.command == "lock":
            payload = create_lock(project, args.private_overlay)
            _print_json(
                {
                    "status": "locked",
                    "lock_hash": f"sha256:{_sha256(_canonical_json(payload))}",
                }
            )
            return 0
        if args.command == "verify":
            payload = verify_project(
                project,
                private_overlay=args.private_overlay,
                base_manifest=args.base_manifest,
                base_pin=args.base_pin,
                binding_dir=args.binding_dir,
            )
            _print_json(
                {
                    "status": "ok",
                    "lock_hash": f"sha256:{_sha256(_canonical_json(payload))}",
                    "credential_privacy": _credential_privacy_evidence(),
                }
            )
            return 0
        if args.command == "list":
            _print_json({"profiles": list(list_profiles(project, args.private_overlay))})
            return 0
        if args.command == "explain":
            _print_json(explain_profile(project, args.profile, args.private_overlay))
            return 0
        if args.command == "materialize":
            tree_hash = materialize_profile(
                project,
                args.client,
                args.profile,
                args.output,
                private_overlay=args.private_overlay,
                base_manifest=args.base_manifest,
                base_pin=args.base_pin,
                binding_dir=args.binding_dir,
            )
            _print_json(
                {
                    "status": "materialized",
                    "client": args.client,
                    "profile": args.profile,
                    "tree_hash": tree_hash,
                }
            )
            return 0
        if args.command == "probe":
            _print_json(
                probe_profile(
                    project,
                    args.client,
                    args.profile,
                    args.state,
                    private_overlay=args.private_overlay,
                    base_manifest=args.base_manifest,
                    base_pin=args.base_pin,
                    binding_dir=args.binding_dir,
                )
            )
            return 0
        if args.command == "diff":
            return diff_profile(
                project,
                args.client,
                args.profile,
                args.state,
                private_overlay=args.private_overlay,
                base_manifest=args.base_manifest,
                base_pin=args.base_pin,
                binding_dir=args.binding_dir,
            )
        forwarded = list(args.client_args)
        if forwarded and forwarded[0] == "--":
            forwarded.pop(0)
        if args.command == "launch":
            return run_client(
                project,
                args.client,
                args.profile,
                forwarded,
                auth_root=args.auth_root,
                receipt_path=args.receipt,
                private_overlay=args.private_overlay,
                base_manifest=args.base_manifest,
                base_pin=args.base_pin,
                binding_dir=args.binding_dir,
            )
        return run_observed(
            project,
            args.client,
            args.profile,
            args.state,
            forwarded,
            auth_root=args.auth_root,
            receipt_path=args.receipt,
            private_overlay=args.private_overlay,
            base_manifest=args.base_manifest,
            base_pin=args.base_pin,
            binding_dir=args.binding_dir,
        )
    except (ProfileError, OSError) as error:
        print(f"profile: error: {error}", file=sys.stderr)
        return 2

def _add_selection(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--client", required=True, choices=CLIENTS)
    parser.add_argument("--profile", required=True)

def _add_auth(parser: argparse.ArgumentParser) -> None:
    """Require one explicit persistent auth vault for runtime commands."""

    parser.add_argument(
        "--auth-root",
        required=True,
        help="private directory containing codex/, qoder/, and omp/ credentials",
    )

def _add_machine_context_binding(
    parser: argparse.ArgumentParser, *, required: bool = False
) -> None:
    """Add explicit machine-context and assembly binding paths."""

    parser.add_argument(
        "--machine-context-manifest", dest="base_manifest", required=required
    )
    parser.add_argument(
        "--machine-context-pin", dest="base_pin", required=required
    )
    parser.add_argument(
        "--assembly-binding-dir", dest="binding_dir", required=required
    )

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="profile")
    parser.add_argument("--project", required=True, metavar="目录")
    parser.add_argument(
        "--private-overlay",
        default=None,
        metavar="目录",
        help="显式私有 capability overlay 根目录；未提供时只使用公共 source",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("lock")
    verify = subparsers.add_parser("verify")
    _add_machine_context_binding(verify)
    subparsers.add_parser("list")
    machine_context_lock = subparsers.add_parser("machine-context-lock")
    machine_context_lock.add_argument("--home", required=True)
    machine_context_lock.add_argument(
        "--machine-context-manifest", dest="manifest", required=True
    )
    machine_context_approve = subparsers.add_parser("machine-context-approve")
    machine_context_approve.add_argument(
        "--machine-context-manifest", dest="manifest", required=True
    )
    machine_context_approve.add_argument(
        "--machine-context-pin", dest="pin", required=True
    )
    assembly_bind = subparsers.add_parser("assembly-bind")
    assembly_bind.add_argument("--profile", required=True)
    _add_machine_context_binding(assembly_bind, required=True)
    explain = subparsers.add_parser("explain")
    explain.add_argument("--profile", required=True)
    materialize = subparsers.add_parser("materialize")
    _add_selection(materialize)
    _add_machine_context_binding(materialize)
    materialize.add_argument("--output", required=True)
    probe = subparsers.add_parser("probe")
    _add_selection(probe)
    _add_machine_context_binding(probe)
    probe.add_argument("--state", required=True)
    diff = subparsers.add_parser("diff")
    _add_selection(diff)
    _add_machine_context_binding(diff)
    diff.add_argument("--state", required=True)
    launch = subparsers.add_parser("launch")
    _add_selection(launch)
    _add_auth(launch)
    launch.add_argument("--receipt")
    launch.add_argument("--workdir")
    _add_machine_context_binding(launch)
    launch.add_argument("client_args", nargs=argparse.REMAINDER)
    run = subparsers.add_parser("run")
    _add_selection(run)
    _add_auth(run)
    run.add_argument("--state", required=True)
    run.add_argument("--receipt")
    run.add_argument("--workdir")
    _add_machine_context_binding(run)
    run.add_argument("client_args", nargs=argparse.REMAINDER)
    return parser


if __name__ == "__main__":
    raise SystemExit(main())
