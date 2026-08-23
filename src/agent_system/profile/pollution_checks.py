"""Project and global host pollution / drift detection."""
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
from agent_system.profile.constants import CODEX_CAPABILITY_FEATURES, CODEX_CAPABILITY_KEYS, CODEX_EXPLICITLY_DISABLABLE_ROOTS, CODEX_RUNTIME_ONLY_FEATURES, CODEX_RUNTIME_ONLY_KEYS, GLOBAL_CAPABILITY_PATHS, GLOBAL_FLOOR_PATHS, HOST_FLOOR_TEXT, IDENTIFIER, ORCA_MANAGED_EXTENSION_NAMES, PROJECT_BYPASS_DIRS, PROJECT_BYPASS_FILES, PROJECT_BYPASS_PATHS
from agent_system.profile.models import ProfileError
from agent_system.profile.util import _contains_mapping_key, _read_toml, _strict_json, _text_has_top_level_key


def _path_key(value: str) -> str:
    """Normalize one relative path spelling for conservative cross-platform comparisons."""

    return os.path.normcase(value.replace("\\", "/")).casefold()

def _managed_publication_paths(root: Path) -> set[str]:
    """Return exact dual-client Marketplace sources that cannot activate by discovery."""

    allowed: set[str] = set()
    claude_entry = root / "CLAUDE.md"
    if (
        claude_entry.is_file()
        and not claude_entry.is_symlink()
        and claude_entry.read_text(encoding="utf-8") == "@AGENTS.md\n"
    ):
        allowed.add(_path_key("CLAUDE.md"))

    agents_root = root / ".agents"
    agents_plugins = agents_root / "plugins"
    codex_marketplace = agents_plugins / "marketplace.json"
    claude_root = root / ".claude-plugin"
    claude_marketplace = claude_root / "marketplace.json"
    if any(
        path.is_symlink()
        for path in (
            agents_root,
            agents_plugins,
            codex_marketplace,
            claude_root,
            claude_marketplace,
        )
    ) or not codex_marketplace.is_file() or not claude_marketplace.is_file():
        return allowed

    try:
        codex_payload = _strict_json(codex_marketplace)
        claude_payload = _strict_json(claude_marketplace)
    except ProfileError:
        return allowed
    codex_plugins = codex_payload.get("plugins")
    claude_plugins = claude_payload.get("plugins")
    if not isinstance(codex_plugins, list) or not isinstance(claude_plugins, list):
        return allowed

    codex_versions: dict[str, str] = {}
    managed_plugin_paths: set[str] = set()
    for plugin in codex_plugins:
        if not isinstance(plugin, dict):
            return allowed
        name = plugin.get("name")
        version = plugin.get("version")
        source = plugin.get("source")
        if (
            not isinstance(name, str)
            or not IDENTIFIER.fullmatch(name)
            or name in codex_versions
            or not isinstance(version, str)
            or not version
            or not isinstance(source, dict)
            or source.get("source") != "local"
            or source.get("path") != f"./plugins/{name}"
        ):
            return allowed
        plugin_root = root / "plugins" / name
        codex_manifest_root = plugin_root / ".codex-plugin"
        codex_manifest_path = codex_manifest_root / "plugin.json"
        claude_manifest_root = plugin_root / ".claude-plugin"
        claude_manifest_path = claude_manifest_root / "plugin.json"
        if (
            not plugin_root.is_dir()
            or plugin_root.is_symlink()
            or codex_manifest_root.is_symlink()
            or codex_manifest_path.is_symlink()
            or claude_manifest_root.is_symlink()
            or claude_manifest_path.is_symlink()
            or not codex_manifest_path.is_file()
            or not claude_manifest_path.is_file()
        ):
            return allowed
        try:
            codex_manifest = _strict_json(codex_manifest_path)
            claude_manifest = _strict_json(claude_manifest_path)
        except ProfileError:
            return allowed
        for manifest in (codex_manifest, claude_manifest):
            if (
                manifest.get("name") != name
                or manifest.get("version") != version
                or manifest.get("repository")
                != "https://github.com/zaurakworks/agent-system"
                or manifest.get("skills") != "./skills/"
            ):
                return allowed
        codex_versions[name] = version
        managed_plugin_paths.update(
            {
                _path_key(f"plugins/{name}/.codex-plugin"),
                _path_key(f"plugins/{name}/.codex-plugin/plugin.json"),
                _path_key(f"plugins/{name}/.claude-plugin"),
                _path_key(f"plugins/{name}/.claude-plugin/plugin.json"),
            }
        )

    claude_versions: dict[str, str] = {}
    for plugin in claude_plugins:
        if not isinstance(plugin, dict):
            return allowed
        name = plugin.get("name")
        version = plugin.get("version")
        if (
            not isinstance(name, str)
            or not IDENTIFIER.fullmatch(name)
            or name in claude_versions
            or not isinstance(version, str)
            or not version
            or plugin.get("source") != f"./plugins/{name}"
        ):
            return allowed
        claude_versions[name] = version
    if not codex_versions or claude_versions != codex_versions:
        return allowed

    allowed.update(
        {
            _path_key(".agents"),
            _path_key(".agents/plugins"),
            _path_key(".agents/plugins/marketplace.json"),
            _path_key(".claude-plugin"),
            _path_key(".claude-plugin/marketplace.json"),
            *managed_plugin_paths,
        }
    )
    return allowed

def _check_project_pollution(root: Path) -> None:
    violations: list[str] = []
    bypass_dirs = {_path_key(value) for value in PROJECT_BYPASS_DIRS}
    bypass_files = {_path_key(value) for value in PROJECT_BYPASS_FILES}
    bypass_paths = {_path_key(value) for value in PROJECT_BYPASS_PATHS}
    managed_publication_paths = _managed_publication_paths(root)
    for item in sorted(
        root.rglob("*"), key=lambda path: path.relative_to(root).as_posix()
    ):
        relative = item.relative_to(root)
        relative_text = relative.as_posix()
        if relative.parts[0] in {".cap", ".git"}:
            continue
        if _path_key(relative_text) in managed_publication_paths:
            continue
        if any(_path_key(part) in bypass_dirs for part in relative.parts):
            violations.append(relative_text)
            continue
        if _path_key(relative_text) in bypass_paths:
            violations.append(relative_text)
            continue
        if _path_key(item.name) in bypass_files and relative_text != "AGENTS.md":
            violations.append(relative_text)
    if violations:
        raise ProfileError(
            f"project capability bypass detected: {', '.join(violations)}"
        )

def _codex_capability_root_is_disabled(value: Any) -> bool:
    """Return whether a capability root or all of its named entries are disabled."""

    if not isinstance(value, Mapping) or not value:
        return False
    if value.get("enabled") is False:
        return True
    return all(
        isinstance(entry, Mapping) and entry.get("enabled") is False
        for entry in value.values()
    )

def _codex_config_has_active_capability(config: Mapping[str, Any]) -> bool:
    """Return whether a Codex config actively enables model-visible capability input."""

    for key in CODEX_CAPABILITY_KEYS - {"hooks", "plugins", "skills"}:
        value = config.get(key)
        if not value:
            continue
        if (
            key in CODEX_EXPLICITLY_DISABLABLE_ROOTS
            and _codex_capability_root_is_disabled(value)
        ):
            continue
        return True
    projects = config.get("projects")
    if projects and (
        not isinstance(projects, Mapping)
        or any(
            not isinstance(value, Mapping)
            or set(value) - {"trust_level"}
            or not isinstance(value.get("trust_level"), str)
            for value in projects.values()
        )
    ):
        return True
    if any(
        value
        for key, value in config.items()
        if key not in CODEX_RUNTIME_ONLY_KEYS and key not in CODEX_CAPABILITY_KEYS
    ):
        return True
    hooks = config.get("hooks")
    if hooks and (
        not isinstance(hooks, Mapping) or any(key != "state" for key in hooks)
    ):
        return True
    features = config.get("features")
    if features and not isinstance(features, Mapping):
        return True
    if isinstance(features, Mapping):
        for key, value in features.items():
            if key in CODEX_CAPABILITY_FEATURES:
                if value is True:
                    return True
                if value is not False:
                    return True
            elif key not in CODEX_RUNTIME_ONLY_FEATURES and value not in (False, None):
                return True
    plugins = config.get("plugins")
    if plugins and (
        not isinstance(plugins, Mapping)
        or any(
            not isinstance(value, Mapping) or value.get("enabled") is not False
            for value in plugins.values()
        )
    ):
        return True
    skills = config.get("skills")
    if isinstance(skills, Mapping):
        if any(key != "config" for key in skills):
            return True
        entries = skills.get("config", ())
        if not isinstance(entries, Sequence) or isinstance(entries, (str, bytes)):
            return True
        if any(
            not isinstance(entry, Mapping) or entry.get("enabled") is not False
            for entry in entries
        ):
            return True
    elif skills:
        return True
    return False

def _qoder_hooks_are_ignored_host_integrations(value: Any, home: Path) -> bool:
    """Return whether Qoder Hooks contain only the ignored Yunke/R2C integrations."""

    if not isinstance(value, Mapping):
        return False
    yunke_command = f"{home}/.yunke/aah_hooks/hook_entry --agent-type=qoder"
    r2c_command = f"bash {home}/.r2c/scripts/qoder-cli-hook.sh"
    for registrations in value.values():
        if not isinstance(registrations, Sequence) or isinstance(
            registrations, (str, bytes)
        ):
            return False
        for registration in registrations:
            if not isinstance(registration, Mapping) or set(registration) - {
                "hooks",
                "matcher",
            }:
                return False
            actions = registration.get("hooks")
            if not isinstance(actions, Sequence) or isinstance(actions, (str, bytes)):
                return False
            for action in actions:
                if not isinstance(action, Mapping) or action.get("type") != "command":
                    return False
                command = action.get("command")
                if command == yunke_command:
                    if action.get("_yunke_managed") is not True or set(action) - {
                        "_yunke_managed",
                        "command",
                        "timeout",
                        "type",
                    }:
                        return False
                elif command == r2c_command:
                    if set(action) - {"command", "timeout", "type"}:
                        return False
                else:
                    return False
    return True

def _qoder_config_has_active_capability(config: Mapping[str, Any], home: Path) -> bool:
    """Return whether a Qoder config actively enables project business capability."""

    enabled_plugins = config.get("enabledPlugins")
    if isinstance(enabled_plugins, Mapping) and any(
        value is not False for value in enabled_plugins.values()
    ):
        return True
    hooks = config.get("hooks")
    if hooks and not _qoder_hooks_are_ignored_host_integrations(hooks, home):
        return True
    return any(config.get(key) for key in ("mcpServers", "plugins", "skills"))

def _matches_host_floor(path: Path) -> bool:
    """Return whether one global instruction entry is exactly the inert host floor."""

    try:
        return path.is_file() and path.read_text(encoding="utf-8") == HOST_FLOOR_TEXT
    except (OSError, UnicodeError):
        return False

def _path_has_symlink_component(path: Path) -> bool:
    """Return whether an absolute path traverses a symlink at any component."""

    current = Path(path.anchor)
    try:
        for part in path.parts[1:]:
            current /= part
            if current.is_symlink():
                return True
    except OSError:
        return True
    return False

def _tree_has_symlink(root: Path) -> bool:
    """Return whether a materialized capability tree contains any symlink."""

    try:
        return root.is_symlink() or any(item.is_symlink() for item in root.rglob("*"))
    except OSError:
        return True

def _codex_system_skills_are_disabled(
    path: Path, config: Mapping[str, Any], home: Path
) -> bool:
    """Return whether every materialized Codex system Skill is explicitly disabled."""

    features = config.get("features")
    if not isinstance(features, Mapping) or features.get("skill_search") is not False:
        return False
    skills = config.get("skills")
    if not isinstance(skills, Mapping):
        return False
    entries = skills.get("config")
    if not isinstance(entries, Sequence) or isinstance(entries, (str, bytes)):
        return False
    if _tree_has_symlink(path):
        return False
    disabled: set[Path] = set()
    for entry in entries:
        if not isinstance(entry, Mapping) or entry.get("enabled") is not False:
            continue
        raw_path = entry.get("path")
        if not isinstance(raw_path, str) or not raw_path:
            continue
        entry_path = Path(raw_path).expanduser()
        if not entry_path.is_absolute():
            entry_path = home / ".codex" / entry_path
        entry_path = Path(os.path.abspath(entry_path))
        if _path_has_symlink_component(entry_path):
            continue
        disabled.add(entry_path)
    materialized = {Path(os.path.abspath(skill)) for skill in path.rglob("SKILL.md")}
    return materialized.issubset(disabled)

def _qoder_plugin_cache_is_disabled(path: Path, config: Mapping[str, Any]) -> bool:
    """Return whether every materialized Qoder plugin is explicitly disabled."""

    enabled = config.get("enabledPlugins")
    if (
        not isinstance(enabled, Mapping)
        or not enabled
        or any(value is not False for value in enabled.values())
        or _tree_has_symlink(path)
    ):
        return False
    try:
        root_entries = list(path.iterdir())
    except OSError:
        return False
    if any(
        item.name not in {"cache", "data"} or not item.is_dir() for item in root_entries
    ):
        return False
    data = path / "data"
    if data.exists():
        try:
            data_entries = list(data.iterdir())
            if any(
                item.name != "security-scan" or not item.is_dir() or any(item.iterdir())
                for item in data_entries
            ):
                return False
        except OSError:
            return False
    cache = path / "cache"
    if not cache.is_dir():
        return False
    for marketplace in cache.iterdir():
        if not marketplace.is_dir():
            return False
        children = list(marketplace.iterdir())
        if marketplace.name.startswith("qoder-enterprise-"):
            if any(
                item.name != "update.lock" or not item.is_file() for item in children
            ):
                return False
            continue
        for plugin in children:
            if not plugin.is_dir():
                return False
            if enabled.get(f"{plugin.name}@{marketplace.name}") is not False:
                return False
    return True

def _orca_managed_extensions_are_inert(path: Path) -> bool:
    """Return whether a client extension root contains only Orca runtime adapters."""

    if _tree_has_symlink(path):
        return False
    try:
        entries = list(path.iterdir())
        if not entries or any(
            not item.is_file() or item.name not in ORCA_MANAGED_EXTENSION_NAMES
            for item in entries
        ):
            return False
        for item in entries:
            with item.open(encoding="utf-8") as stream:
                if stream.readline(128).rstrip() != "// @orca-managed-pi-extension":
                    return False
        return True
    except (OSError, UnicodeError):
        return False

def _global_path_is_passive(
    relative: str,
    path: Path,
    home: Path,
    codex_config: Mapping[str, Any],
    qoder_config: Mapping[str, Any],
) -> bool:
    """Return whether an existing global path is an inert floor, empty root, or cache."""

    if path.is_dir() and not any(path.iterdir()):
        return True
    if relative in GLOBAL_FLOOR_PATHS:
        return _matches_host_floor(path)
    if relative in {".omp/agent/extensions", ".pi/agent/extensions"}:
        return _orca_managed_extensions_are_inert(path)
    codex_features = codex_config.get("features")
    if relative == ".codex/hooks":
        return (
            isinstance(codex_features, Mapping) and codex_features.get("hooks") is False
        )
    if relative == ".codex/plugins":
        return (
            isinstance(codex_features, Mapping)
            and codex_features.get("plugins") is False
            and not _codex_config_has_active_capability(
                {**codex_config, "skills": {}, "hooks": {}}
            )
        )
    if relative == ".codex/skills":
        return _codex_system_skills_are_disabled(path, codex_config, home)
    if relative == ".qoder/plugins":
        return _qoder_plugin_cache_is_disabled(path, qoder_config)
    return False

def _check_global_pollution() -> None:
    home = Path.home()
    codex_config_path = home / ".codex" / "config.toml"
    codex_config = _read_toml(codex_config_path) if codex_config_path.is_file() else {}
    qoder_config_path = home / ".qoder" / "settings.json"
    qoder_config = (
        _strict_json(qoder_config_path) if qoder_config_path.is_file() else {}
    )
    violations = {
        relative
        for relative in set(GLOBAL_CAPABILITY_PATHS)
        if os.path.lexists(home / relative)
        and not _global_path_is_passive(
            relative, home / relative, home, codex_config, qoder_config
        )
    }
    if codex_config and _codex_config_has_active_capability(codex_config):
        violations.add(".codex/config.toml")
    json_configs = {
        ".claude.json": {"enabledPlugins", "hooks", "mcpServers", "plugins", "skills"},
        ".gemini/settings.json": {
            "extensions",
            "hooks",
            "mcpServers",
            "plugins",
            "skills",
        },
    }
    for relative, keys in json_configs.items():
        path = home / relative
        if path.is_file() and _contains_mapping_key(_strict_json(path), keys):
            violations.add(relative)
    if qoder_config and _qoder_config_has_active_capability(qoder_config, home):
        violations.add(".qoder/settings.json")
    text_configs = {
        ".config/opencode/opencode.json": {"instructions", "mcp", "plugin"},
        ".omp/agent/config.yml": {
            "extensions",
            "hooks",
            "mcp",
            "mcpServers",
            "plugins",
            "rules",
            "skills",
        },
        ".pi/agent/config.yml": {
            "extensions",
            "hooks",
            "mcp",
            "mcpServers",
            "plugins",
            "rules",
            "skills",
        },
    }
    for relative, keys in text_configs.items():
        path = home / relative
        if path.is_file() and _text_has_top_level_key(path, keys):
            violations.add(relative)
    if violations:
        raise ProfileError(
            f"global capability pollution detected: {', '.join(sorted(violations))}"
        )
