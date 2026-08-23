"""Load manifest/profile/project-defaults into Project/Profile, and inspect loaded profiles."""
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
from agent_system.profile.constants import CAPABILITY_KINDS, CLIENTS, MANIFEST_VERSION, OVERLAY_VERSION, PROJECT_SKILL_IMPORTS_VERSION
from agent_system.profile.models import CapabilityOperations, McpDefinition, OverlaySpec, Profile, ProfileError, Project, ProjectSkillImport
from agent_system.profile.util import _expect_keys, _identifier_list, _read_nonempty_text, _read_toml, _require_under_cap, _resolve_directory, _resolve_file, _validate_identifier
from agent_system.profile.capability_store import _validate_capability_store, _validate_capability_tree


def _load_layer_operations(value: Any, context: str) -> CapabilityOperations:
    """Load one strict v3 allow/deny/override table."""

    if not isinstance(value, Mapping):
        raise ProfileError(f"{context} must be a table")
    _expect_keys(value, {"allow", "deny", "override"}, context)
    operations = CapabilityOperations(
        allow=_identifier_list(value["allow"], f"{context}.allow"),
        deny=_identifier_list(value["deny"], f"{context}.deny"),
        override=_identifier_list(value["override"], f"{context}.override"),
    )
    overlap = (
        set(operations.allow) & set(operations.deny)
        | set(operations.allow) & set(operations.override)
        | set(operations.deny) & set(operations.override)
    )
    if overlap:
        raise ProfileError(
            f"{context} names must appear in exactly one operation: {sorted(overlap)}"
        )
    return operations

def _load_external_imports(
    value: Any, context: str
) -> tuple[Mapping[str, Any], ...]:
    """Validate explicit external asset provenance without reading secrets."""

    if not isinstance(value, list):
        raise ProfileError(f"{context} must be an array")
    result: list[Mapping[str, Any]] = []
    for index, item in enumerate(value):
        item_context = f"{context}[{index}]"
        if not isinstance(item, Mapping):
            raise ProfileError(f"{item_context} must be a table")
        _expect_keys(item, {"name", "source", "digest", "approved", "profiles"}, item_context)
        name = _validate_identifier(item["name"], f"{item_context}.name")
        source = item["source"]
        digest = item["digest"]
        if not isinstance(source, str) or not source.strip():
            raise ProfileError(f"{item_context}.source must be non-empty")
        if not isinstance(digest, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
            raise ProfileError(f"{item_context}.digest must be a sha256 digest")
        if type(item["approved"]) is not bool:
            raise ProfileError(f"{item_context}.approved must be boolean")
        profiles = _identifier_list(item["profiles"], f"{item_context}.profiles")
        result.append(
            {
                "name": name,
                "source": source,
                "digest": digest,
                "approved": item["approved"],
                "profiles": profiles,
            }
        )
    return tuple(result)

def _load_project_skill_imports(
    root: Path, manifest_path: Path
) -> dict[str, ProjectSkillImport]:
    """Load canonical project-local Skill sources outside the .cap store."""

    data = _read_toml(manifest_path)
    _expect_keys(data, {"version", "imports"}, "project Skill imports")
    if type(data["version"]) is not int or data["version"] != PROJECT_SKILL_IMPORTS_VERSION:
        raise ProfileError(
            f"project Skill imports.version must be {PROJECT_SKILL_IMPORTS_VERSION}"
        )
    raw_imports = data["imports"]
    if not isinstance(raw_imports, list):
        raise ProfileError("project Skill imports.imports must be an array")
    imports: dict[str, ProjectSkillImport] = {}
    for index, item in enumerate(raw_imports):
        context = f"project Skill imports.imports[{index}]"
        if not isinstance(item, Mapping):
            raise ProfileError(f"{context} must be a table")
        _expect_keys(item, {"name", "source"}, context)
        name = _validate_identifier(item["name"], f"{context}.name")
        source_value = item["source"]
        if not isinstance(source_value, str):
            raise ProfileError(f"{context}.source must be a path string")
        source = _resolve_directory(root, source_value, f"{context}.source")
        if source.is_relative_to(root / ".cap"):
            raise ProfileError(
                f"{context}.source must be outside .cap; use the capability store"
            )
        if source.name != name:
            raise ProfileError(
                f"{context}.source directory {source.name!r} must match {name!r}"
            )
        _validate_capability_tree(root, "skills", source)
        if name in imports:
            raise ProfileError(f"project Skill import is duplicated: {name}")
        imports[name] = ProjectSkillImport(name=name, source=source)
    return imports

def _load_overlay_spec(root: Path, private_overlay: Path | str | None) -> OverlaySpec | None:
    if private_overlay is None:
        return None
    overlay_root = Path(private_overlay).expanduser().resolve(strict=True)
    if not overlay_root.is_dir() or overlay_root == root:
        raise ProfileError("private overlay must be a distinct directory")
    descriptor = overlay_root / ".cap" / "overlay.toml"
    namespace = "private"
    if descriptor.exists():
        data = _read_toml(descriptor)
        _expect_keys(data, {"version", "namespace"}, "private overlay")
        if type(data["version"]) is not int or data["version"] != OVERLAY_VERSION:
            raise ProfileError(f"private overlay.version must be {OVERLAY_VERSION}")
        namespace = _validate_identifier(data["namespace"], "private overlay.namespace")
    return OverlaySpec(root=overlay_root, namespace=namespace, descriptor=descriptor if descriptor.exists() else None)

def load_project(
    project_root: Path | str, private_overlay: Path | str | None = None
) -> Project:
    """Load one v3 project and its optional explicit role overlay."""

    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    root = Path(project_root).expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ProfileError(f"project root is not a directory: {root}")
    root_instructions = _resolve_file(root, "AGENTS.md", "root instructions")
    _read_nonempty_text(root_instructions, "root instructions")
    manifest_path = _resolve_file(root, ".cap/manifest.toml", "manifest")
    manifest = _read_toml(manifest_path)
    required_manifest_keys = {"version", "defaults", "runtime", "profiles"}
    actual_manifest_keys = set(manifest)
    missing_manifest_keys = sorted(required_manifest_keys - actual_manifest_keys)
    extra_manifest_keys = sorted(
        actual_manifest_keys - required_manifest_keys - {"skill_imports"}
    )
    if missing_manifest_keys or extra_manifest_keys:
        raise ProfileError(
            "manifest keys mismatch: "
            f"missing={missing_manifest_keys}, extra={extra_manifest_keys}"
        )
    if type(manifest["version"]) is not int or manifest["version"] != MANIFEST_VERSION:
        raise ProfileError(f"manifest.version must be {MANIFEST_VERSION}")
    raw_profiles = manifest["profiles"]
    if not isinstance(raw_profiles, dict) or not raw_profiles:
        raise ProfileError("manifest.profiles must be a non-empty table")
    raw_runtime = manifest["runtime"]
    if not isinstance(raw_runtime, Mapping):
        raise ProfileError("manifest.runtime must be a table")
    declared_runtimes = set(raw_runtime)
    if not declared_runtimes:
        raise ProfileError("manifest.runtime must declare at least one client")
    unknown_runtimes = sorted(declared_runtimes - set(_cli.CLIENTS))
    if unknown_runtimes:
        raise ProfileError(
            "manifest.runtime declares unknown clients "
            f"{unknown_runtimes}; known clients are {sorted(_cli.CLIENTS)}"
        )
    runtime_policies: dict[str, Path] = {}
    for runtime_client in sorted(declared_runtimes):
        label = f"{runtime_client} runtime policy"
        runtime_source = raw_runtime[runtime_client]
        if not isinstance(runtime_source, str):
            raise ProfileError(
                f"manifest.runtime.{runtime_client} must be a path string"
            )
        runtime_path = _resolve_file(root, runtime_source, label)
        _require_under_cap(root, runtime_path, label)
        runtime_data = _read_toml(runtime_path)
        _expect_keys(runtime_data, {"version", "client", "policy"}, label)
        if type(runtime_data["version"]) is not int or runtime_data["version"] != 1:
            raise ProfileError(f"{label}.version must be 1")
        if runtime_data["client"] != runtime_client or not isinstance(
            runtime_data["policy"], Mapping
        ):
            raise ProfileError(
                f"{label} must target {runtime_client} and contain a table"
            )
        runtime_policies[runtime_client] = runtime_path

    skill_imports_manifest: Path | None = None
    skill_imports: dict[str, ProjectSkillImport] = {}
    raw_skill_imports = manifest.get("skill_imports")
    if raw_skill_imports is not None:
        if not isinstance(raw_skill_imports, str):
            raise ProfileError("manifest.skill_imports must be a path string")
        skill_imports_manifest = _resolve_file(
            root, raw_skill_imports, "project Skill imports"
        )
        _require_under_cap(root, skill_imports_manifest, "project Skill imports")
        skill_imports = _load_project_skill_imports(root, skill_imports_manifest)

    capability_fields = {
        "skills": "skills",
        "mcps": "mcp",
        "hooks": "hooks",
        "plugins": "plugins",
    }
    defaults_path = _resolve_file(root, manifest["defaults"], "project defaults")
    _require_under_cap(root, defaults_path, "project defaults")
    defaults_data = _read_toml(defaults_path)
    _expect_keys(
        defaults_data,
        {"version", "external_imports", *capability_fields},
        "project defaults",
    )
    if type(defaults_data["version"]) is not int or defaults_data["version"] != 3:
        raise ProfileError("project defaults.version must be 3")
    external_imports = _load_external_imports(
        defaults_data["external_imports"], "project-defaults.external_imports"
    )
    default_operations = {
        field: _load_layer_operations(defaults_data[field], f"project-defaults.{field}")
        for field in capability_fields
    }
    expected_by_root: dict[Path, dict[str, set[str]]] = {
        root: {kind: set() for kind in CAPABILITY_KINDS}
    }
    imported_skill_names = set(skill_imports)
    for field, store_kind in capability_fields.items():
        names = {
            *default_operations[field].allow,
            *default_operations[field].override,
        }
        if store_kind == "skills":
            names.difference_update(imported_skill_names)
        expected_by_root[root][store_kind].update(names)

    overlay = _load_overlay_spec(root, private_overlay)
    definitions: dict[str, dict[str, Any]] = {}

    def load_definitions(
        source_root: Path,
        source_manifest: Mapping[str, Any],
        label: str,
        *,
        private: bool,
    ) -> None:
        raw = source_manifest["profiles"]
        if not isinstance(raw, Mapping) or not raw:
            raise ProfileError(f"{label}.profiles must be a non-empty table")
        expected = expected_by_root.setdefault(
            source_root, {kind: set() for kind in CAPABILITY_KINDS}
        )
        for name, raw_path in sorted(raw.items()):
            _validate_identifier(name, f"{label} profile name")
            if name in definitions and not private:
                raise ProfileError(f"profile name is duplicated across layers: {name}")
            if not isinstance(raw_path, str):
                raise ProfileError(f"{label}.profiles.{name} must be a path string")
            source = _resolve_file(source_root, raw_path, f"{label} profile {name}")
            _require_under_cap(source_root, source, f"{label} profile {name}")
            profile_data = _read_toml(source)
            required = {"version", "prompt", "runtime", *capability_fields}
            actual = set(profile_data)
            missing = sorted(required - actual)
            extra = sorted(actual - required)
            if missing or extra:
                raise ProfileError(
                    f"profile {name} keys mismatch: missing={missing}, extra={extra}"
                )
            if type(profile_data["version"]) is not int or profile_data["version"] != 3:
                raise ProfileError(f"profile {name}.version must be 3")
            raw_prompt = profile_data["prompt"]
            if not isinstance(raw_prompt, str):
                raise ProfileError(f"profile {name}.prompt must be a path string")
            prompt = _resolve_file(source_root, raw_prompt, f"profile {name} prompt")
            _require_under_cap(source_root, prompt, f"profile {name} prompt")
            raw_profile_runtime = profile_data["runtime"]
            if not isinstance(raw_profile_runtime, Mapping) or not raw_profile_runtime:
                raise ProfileError(
                    f"profile {name}.runtime must declare at least one client"
                )
            unknown_profile_runtimes = sorted(
                set(raw_profile_runtime) - set(_cli.CLIENTS)
            )
            if unknown_profile_runtimes:
                raise ProfileError(
                    f"profile {name}.runtime declares unknown clients "
                    f"{unknown_profile_runtimes}; known clients are {sorted(_cli.CLIENTS)}"
                )
            for runtime_client, runtime_id in raw_profile_runtime.items():
                if not isinstance(runtime_id, str):
                    raise ProfileError(
                        f"profile {name}.runtime.{runtime_client} must be a string"
                    )
            operations = {
                field: _load_layer_operations(
                    profile_data[field], f"profile {name}.{field}"
                )
                for field in capability_fields
            }
            for field, store_kind in capability_fields.items():
                names = {
                    *operations[field].allow,
                    *operations[field].override,
                }
                if store_kind == "skills":
                    names.difference_update(imported_skill_names)
                expected[store_kind].update(names)
            definitions[name] = {
                "source": source,
                "source_root": source_root,
                "prompt": prompt,
                "runtime": dict(sorted(raw_profile_runtime.items())),
                "operations": operations,
            }

    load_definitions(root, manifest, "public", private=False)
    if overlay is not None:
        overlay_manifest_path = _resolve_file(
            overlay.root, ".cap/manifest.toml", "private overlay manifest"
        )
        overlay_manifest = _read_toml(overlay_manifest_path)
        _expect_keys(
            overlay_manifest,
            {"version", "defaults", "runtime", "profiles"},
            "private overlay manifest",
        )
        if type(overlay_manifest["version"]) is not int or overlay_manifest["version"] != 3:
            raise ProfileError("private overlay manifest.version must be 3")
        load_definitions(overlay.root, overlay_manifest, "private", private=True)

    def capability_origin(field: str, name: str, source_root: Path) -> Path:
        if field == "skills" and name in skill_imports:
            return skill_imports[name].source
        store_kind = capability_fields[field]
        base = source_root / ".cap" / "capabilities" / store_kind
        return base / f"{name}.json" if store_kind == "mcp" else base / name

    profiles: dict[str, Profile] = {}
    for name, definition in sorted(definitions.items()):
        resolved: dict[str, tuple[str, ...]] = {}
        origins: dict[str, dict[str, Path]] = {}
        for field in capability_fields:
            operations = definition["operations"][field]
            inherited = set(default_operations[field].allow)
            origins[field] = {
                capability: capability_origin(field, capability, root)
                for capability in inherited
            }
            denied = set(operations.deny)
            overrides = set(operations.override)
            missing_overrides = overrides - inherited
            if missing_overrides:
                raise ProfileError(
                    f"profile {name}.{field}.override is not inherited: "
                    f"{sorted(missing_overrides)}"
                )
            duplicate_allows = set(operations.allow) & inherited
            if duplicate_allows:
                raise ProfileError(
                    f"profile {name}.{field}.allow conflicts with project defaults: "
                    f"{sorted(duplicate_allows)}"
                )
            inherited.difference_update(denied)
            inherited.difference_update(overrides)
            for capability in denied:
                origins[field].pop(capability, None)
            for capability in (*operations.override, *operations.allow):
                origins[field][capability] = capability_origin(
                    field, capability, definition["source_root"]
                )
            inherited.update(overrides)
            inherited.update(operations.allow)
            resolved[field] = tuple(sorted(inherited))
        profiles[name] = Profile(
            name=name,
            source=definition["source"],
            source_root=definition["source_root"],
            extends=None,
            chain=("project-defaults", name),
            prompt=definition["prompt"],
            prompt_chain=(definition["prompt"],),
            operations=definition["operations"],
            origins=origins,
            skills=resolved["skills"],
            mcps=resolved["mcps"],
            hooks=resolved["hooks"],
            plugins=resolved["plugins"],
            runtime=definition["runtime"],
        )
    referenced_imports = {
        skill
        for profile in profiles.values()
        for skill in profile.skills
        if skill in skill_imports
    }
    unreferenced_imports = sorted(imported_skill_names - referenced_imports)
    if unreferenced_imports:
        raise ProfileError(f"project Skill imports are unreferenced: {unreferenced_imports}")
    mcps: dict[str, McpDefinition] = {}
    for source_root, expected in expected_by_root.items():
        mcps.update(_validate_capability_store(source_root, expected))
    return Project(
        root=root,
        manifest=manifest_path,
        defaults=defaults_path,
        runtime_policies=runtime_policies,
        skill_imports_manifest=skill_imports_manifest,
        skill_imports=dict(sorted(skill_imports.items())),
        profiles=dict(sorted(profiles.items())),
        mcps=dict(sorted(mcps.items())),
        external_imports=external_imports,
        overlay=overlay,
    )

def _select_profile(project: Project, profile_name: str) -> Profile:
    if not profile_name:
        raise ProfileError("profile is required; there is no default profile")
    try:
        return project.profiles[profile_name]
    except KeyError as error:
        raise ProfileError(f"unknown profile: {profile_name}") from error
