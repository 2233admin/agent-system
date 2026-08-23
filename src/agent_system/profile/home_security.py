"""Real-home/asset discovery, asset closure enforcement, and private-tree redaction."""
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
from agent_system.profile.constants import BASE_MANIFEST_VERSION, CAPABILITY_KINDS, GLOBAL_CAPABILITY_PATHS, IDENTIFIER, MACHINE_CONTEXT_NAME, REAL_HOME_CONFIG_KEYS, SECRET_KEY_PATTERN, SECRET_LINE_PATTERN
from agent_system.profile.models import Profile, ProfileError, Project, StableDirectory
from agent_system.profile.util import _canonical_json, _contains_mapping_key, _loads_strict_json, _read_toml, _sha256, _strict_json, _text_has_top_level_key
from agent_system.profile.stable_dir import _is_link_component, _same_file_identity
from agent_system.profile.pollution_checks import _codex_config_has_active_capability, _global_path_is_passive, _path_has_symlink_component, _qoder_config_has_active_capability


def _private_checks_are_expressible() -> bool:
    """Return whether this host expresses POSIX ownership and permission bits."""

    return hasattr(os, "geteuid")

def _credential_privacy_evidence() -> str:
    """Report whether credential privacy was judged or is unknown on this host."""

    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    return "checked" if _cli._private_checks_are_expressible() else "unknown"

def _validate_private_directory(directory: StableDirectory, context: str) -> None:
    """Require one credential directory to be private, writable, and user-owned."""

    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    info = os.lstat(directory.path)
    if not stat.S_ISDIR(info.st_mode) or _is_link_component(info):
        raise ProfileError(f"{context} must be a directory")
    if not _cli._private_checks_are_expressible():
        return
    if info.st_uid != os.geteuid():
        raise ProfileError(f"{context} must be owned by the current user")
    mode = stat.S_IMODE(info.st_mode)
    if mode & 0o077:
        raise ProfileError(f"{context} must not grant group or other access")
    if mode & 0o700 != 0o700:
        raise ProfileError(f"{context} must grant its owner read, write, and search")

def _read_private_file(
    directory: StableDirectory,
    name: str,
    context: str,
    *,
    max_bytes: int,
    require_owner_write: bool = False,
) -> bytes:
    """Read one bounded private file, retrying concurrent in-place refreshes."""

    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    flags |= getattr(os, "O_BINARY", 0)
    target = directory.path / name
    expressible = _cli._private_checks_are_expressible()
    for attempt in range(3):
        try:
            if _is_link_component(os.lstat(target)):
                raise ProfileError(f"{context} must not be a link")
            descriptor = os.open(target, flags)
        except ProfileError:
            raise
        except OSError as error:
            raise ProfileError(
                f"{context} is not a readable regular file: {error}"
            ) from error
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                raise ProfileError(
                    f"{context} must be a regular file with one hard link"
                )
            if expressible and before.st_uid != os.geteuid():
                raise ProfileError(f"{context} must be owned by the current user")
            mode = stat.S_IMODE(before.st_mode)
            if expressible and mode & 0o077:
                raise ProfileError(f"{context} must not grant group or other access")
            if expressible and (
                mode & 0o400 != 0o400
                or (require_owner_write and mode & 0o200 != 0o200)
            ):
                requirement = "read and write" if require_owner_write else "read"
                raise ProfileError(f"{context} must grant its owner {requirement}")
            content = bytearray()
            while len(content) <= max_bytes:
                chunk = os.read(descriptor, min(65536, max_bytes + 1 - len(content)))
                if not chunk:
                    break
                content.extend(chunk)
            if len(content) > max_bytes:
                raise ProfileError(f"{context} exceeds {max_bytes} bytes")
            after = os.fstat(descriptor)
            live = os.lstat(target)
            # The descriptor-to-descriptor comparison below keeps st_ctime_ns,
            # but the name-to-descriptor one must not: on Windows st_ctime is
            # the creation time and fstat and lstat report it from different
            # sources, so the same untouched file differs by a fraction of a
            # millisecond and every read would be reported as unstable.
            stable_identity = _same_file_identity(
                after, before.st_dev, before.st_ino
            ) and _same_file_identity(live, before.st_dev, before.st_ino)
            stable_generation = (
                after.st_size,
                after.st_mtime_ns,
                after.st_ctime_ns,
            ) == (
                before.st_size,
                before.st_mtime_ns,
                before.st_ctime_ns,
            ) and (
                live.st_size,
                live.st_mtime_ns,
            ) == (
                before.st_size,
                before.st_mtime_ns,
            )
            if stable_identity and stable_generation:
                return bytes(content)
        finally:
            os.close(descriptor)
        if attempt == 2:
            break
    raise ProfileError(f"{context} did not remain stable while it was read")

def _read_stable_private_value(
    directory: StableDirectory,
    name: str,
    context: str,
    *,
    max_bytes: int,
    parse: Callable[[bytes], Any],
    require_owner_write: bool = False,
) -> Any:
    """Read and parse one private value, retrying stable-but-incomplete refresh snapshots."""

    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    last_error: ProfileError | None = None
    for attempt in range(3):
        payload = _cli._read_private_file(
            directory,
            name,
            context,
            max_bytes=max_bytes,
            require_owner_write=require_owner_write,
        )
        try:
            return parse(payload)
        except ProfileError as error:
            last_error = error
            if attempt < 2:
                time.sleep(0.01 * (attempt + 1))
    assert last_error is not None
    raise last_error

def _validate_private_tree(root: Path, context: str) -> None:
    """Reject unsafe, deep, or oversized entries in one mutable auth tree."""

    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    entry_count = 0
    total_bytes = 0
    expressible = _cli._private_checks_are_expressible()
    pending = [(root, 0)]
    while pending:
        directory, depth = pending.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                entry_count += 1
                if entry_count > 256:
                    raise ProfileError(f"{context} exceeds 256 directory entries")
                info = entry.stat(follow_symlinks=False)
                label = f"{context}/{entry.name}"
                if _is_link_component(info):
                    raise ProfileError(f"{label} must not be a link")
                if expressible and info.st_uid != os.geteuid():
                    raise ProfileError(f"{label} must be owned by the current user")
                if stat.S_ISDIR(info.st_mode):
                    if expressible and stat.S_IMODE(info.st_mode) & 0o077:
                        raise ProfileError(
                            f"{label} must not grant group or other access"
                        )
                    if expressible and stat.S_IMODE(info.st_mode) & 0o700 != 0o700:
                        raise ProfileError(
                            f"{label} must grant its owner read, write, and search"
                        )
                    if depth >= 16:
                        raise ProfileError(f"{context} exceeds 16 directory levels")
                    pending.append((Path(entry.path), depth + 1))
                    continue
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise ProfileError(
                        f"{label} must be a regular file with one hard link"
                    )
                if expressible and stat.S_IMODE(info.st_mode) & 0o022:
                    raise ProfileError(f"{label} must not grant group or other write")
                total_bytes += info.st_size
                if total_bytes > 16 * 1024 * 1024:
                    raise ProfileError(f"{context} exceeds 16 MiB")

def _redact_secret_values(value: Any, parent_key: str = "") -> Any:
    """Remove secret-bearing values before any configuration content is hashed."""

    if isinstance(value, Mapping):
        redacted: dict[str, Any] = {}
        for key, item in sorted(value.items(), key=lambda pair: str(pair[0])):
            name = str(key)
            if SECRET_KEY_PATTERN.search(name) or parent_key.casefold() in {
                "env",
                "environment",
                "headers",
            }:
                redacted[name] = "<external-secret>"
            else:
                redacted[name] = _redact_secret_values(item, name)
        return redacted
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_redact_secret_values(item, parent_key) for item in value]
    return value

def _canonical_mode(path: Path) -> int:
    """Return a filesystem-independent permission value for one lock or render input.

    The raw `stat.S_IMODE` value is not comparable across platforms or even
    across filesystems on one platform, so recording it verbatim made
    `.cap/lock.json` and every `tree_hash` environment-dependent: a lock written
    in one environment always failed verification in another. Observed values
    for the same committed, non-executable file:

        Linux ext4        0o644
        Windows (native)  0o666   -- only a read-only flag exists
        WSL on DrvFs      0o777   -- every file reports as executable

    No canonicalization of these values can agree, because DrvFs reports the
    executable bit set for everything while Git for Windows checks every file
    out as non-executable. The permission bits therefore carry no portable
    information, and this function returns a constant.

    Integrity is unaffected: `type` plus the content `sha256` already identify
    every lock input, and capability permissions are gated separately.

    Consequence: an executable capability file is recorded and materialized as
    non-executable. No lock input is currently executable. Restoring executable
    support requires a portable source for that bit -- Git's index rather than
    the filesystem -- and a lock version bump; the field should simply be
    removed at that point. See zaurakworks/agent-system#82.
    """

    del path
    return 0o644

def _redacted_file_bytes(path: Path) -> bytes:
    """Read one bounded capability file and redact recognizable secret assignments."""

    content = path.read_bytes()
    if len(content) > 8 * 1024 * 1024:
        raise ProfileError(f"machine-context capability file exceeds 8 MiB: {path}")
    suffix = path.suffix.casefold()
    try:
        if suffix == ".json":
            parsed = _loads_strict_json(content.decode("utf-8"), str(path))
            return _canonical_json(_redact_secret_values(parsed))
        if suffix == ".toml":
            parsed = tomllib.loads(content.decode("utf-8"))
            return _canonical_json(_redact_secret_values(parsed))
        text = content.decode("utf-8")
    except (UnicodeError, tomllib.TOMLDecodeError, ProfileError):
        return content
    return SECRET_LINE_PATTERN.sub(r"\1<external-secret>", text).encode("utf-8")

def _home_path_digest(path: Path) -> str:
    """Hash one capability path as redacted content, mode, and lexical tree shape."""

    records: dict[str, Any] = {}
    entries = [path]
    if path.is_dir() and not path.is_symlink():
        entries.extend(sorted(path.rglob("*"), key=lambda item: item.relative_to(path).as_posix()))
    if len(entries) > 4096:
        raise ProfileError(f"machine-context capability tree exceeds 4096 entries: {path}")
    for item in entries:
        relative = "." if item == path else item.relative_to(path).as_posix()
        info = item.lstat()
        mode = f"{stat.S_IMODE(info.st_mode):04o}"
        if item.is_symlink():
            records[relative] = {
                "type": "symlink",
                "mode": mode,
                "target_sha256": _sha256(os.readlink(item).encode("utf-8")),
            }
        elif item.is_dir():
            records[relative] = {"type": "directory", "mode": mode}
        elif item.is_file():
            records[relative] = {
                "type": "file",
                "mode": mode,
                "sha256": _sha256(_redacted_file_bytes(item)),
            }
        else:
            raise ProfileError(f"unsupported machine-context capability entry: {item}")
    return f"sha256:{_sha256(_canonical_json(records))}"

def _home_entry_kind(relative: str) -> str:
    folded = relative.casefold()
    if any(name in folded for name in ("agents.md", "claude.md", "gemini.md", "instructions")):
        return "context"
    if "skill" in folded:
        return "skills"
    if "mcp" in folded:
        return "mcp"
    if "hook" in folded:
        return "hooks"
    if "plugin" in folded or "extension" in folded:
        return "plugins"
    return "settings"

def _home_capability_inventory(path: Path, kind: str) -> dict[str, list[str]]:
    """Extract stable capability ids without recording capability contents."""

    names: dict[str, set[str]] = {
        field: set() for field in ("skills", "mcps", "hooks", "plugins")
    }

    def add_values(field: str, value: Any) -> None:
        if isinstance(value, Mapping):
            values = value.keys()
        elif isinstance(value, list):
            values = value
        else:
            return
        names[field].update(
            item for item in values if isinstance(item, str) and IDENTIFIER.fullmatch(item)
        )

    try:
        if kind == "skills" and path.is_dir():
            names["skills"].update(
                skill.parent.name
                for skill in path.rglob("SKILL.md")
                if IDENTIFIER.fullmatch(skill.parent.name)
            )
        elif kind == "hooks" and path.is_dir():
            names["hooks"].update(
                item.name for item in path.iterdir() if IDENTIFIER.fullmatch(item.name)
            )
        elif kind == "plugins" and path.is_dir():
            for marker in path.rglob("plugin.json"):
                payload = _strict_json(marker)
                if isinstance(payload, Mapping):
                    name = payload.get("name")
                    if isinstance(name, str) and IDENTIFIER.fullmatch(name):
                        names["plugins"].add(name)
        if path.is_file() and path.suffix.casefold() == ".json":
            payload = _strict_json(path)
            if isinstance(payload, Mapping):
                add_values("mcps", payload.get("mcpServers"))
                add_values("plugins", payload.get("enabledPlugins"))
        elif path.is_file() and path.suffix.casefold() == ".toml":
            payload = tomllib.loads(path.read_text(encoding="utf-8"))
            if isinstance(payload, Mapping):
                add_values("mcps", payload.get("mcp_servers"))
                add_values("mcps", payload.get("mcpServers"))
    except (OSError, ProfileError, UnicodeDecodeError, tomllib.TOMLDecodeError):
        return {field: [] for field in ("skills", "mcps", "hooks", "plugins")}
    return {field: sorted(values) for field, values in names.items()}

def discover_real_home(home_root: Path | str) -> dict[str, Any]:
    """Build a private, redacted inventory of one real HOME capability surface."""

    home = Path(home_root).expanduser().resolve(strict=True)
    if not home.is_dir():
        raise ProfileError(f"real HOME is not a directory: {home}")
    codex_config_path = home / ".codex" / "config.toml"
    codex_config = _read_toml(codex_config_path) if codex_config_path.is_file() else {}
    qoder_config_path = home / ".qoder" / "settings.json"
    qoder_config = (
        _strict_json(qoder_config_path) if qoder_config_path.is_file() else {}
    )
    candidates = set(GLOBAL_CAPABILITY_PATHS) | set(REAL_HOME_CONFIG_KEYS) | {
        ".codex/config.toml",
        ".qoder/settings.json",
    }
    entries: list[dict[str, Any]] = []
    for relative in sorted(candidates):
        path = home / relative
        if not os.path.lexists(path):
            continue
        active = True
        if relative in GLOBAL_CAPABILITY_PATHS:
            active = not _global_path_is_passive(
                relative, path, home, codex_config, qoder_config
            )
        if relative == ".codex/config.toml":
            active = bool(codex_config) and _codex_config_has_active_capability(
                codex_config
            )
        elif relative == ".qoder/settings.json":
            active = bool(qoder_config) and _qoder_config_has_active_capability(
                qoder_config, home
            )
        elif relative in REAL_HOME_CONFIG_KEYS:
            keys = REAL_HOME_CONFIG_KEYS[relative]
            if path.suffix.casefold() == ".json":
                active = path.is_file() and _contains_mapping_key(
                    _strict_json(path), keys
                )
            else:
                active = path.is_file() and _text_has_top_level_key(path, keys)
        kind = _home_entry_kind(relative)
        capabilities = _home_capability_inventory(path, kind)
        entries.append(
            {
                "path": relative,
                "kind": kind,
                "state": "active" if active else "passive",
                "digest": _home_path_digest(path),
                "capabilities": capabilities,
            }
        )
    effective_records = [entry for entry in entries if entry["state"] == "active"]
    return {
        "version": BASE_MANIFEST_VERSION,
        "context": MACHINE_CONTEXT_NAME,
        "home": str(home),
        "effective_digest": f"sha256:{_sha256(_canonical_json(effective_records))}",
        "inventory_digest": f"sha256:{_sha256(_canonical_json(entries))}",
        "entries": entries,
    }

def discover_asset_inventory(home_root: Path | str) -> dict[str, Any]:
    """Build a separate redacted inventory for Agent-facing candidates."""

    machine_context = discover_real_home(home_root)

    def observed_entries(kind: str) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for entry in machine_context["entries"]:
            if entry["kind"] != kind:
                continue
            result.append(
                {
                    **entry,
                    "status": "unknown"
                    if entry["state"] == "active"
                    else "observed",
                }
            )
        return result

    capability_entries = [
        {
            **entry,
            "status": "unknown" if entry["state"] == "active" else "observed",
        }
        for entry in machine_context["entries"]
        if entry["kind"] in CAPABILITY_KINDS
    ]
    instruction_entries = observed_entries("context")
    inventory_digest = "sha256:" + _sha256(_canonical_json({
        "capability": capability_entries,
        "instruction": instruction_entries,
    }))
    return {
        "version": 1,
        "kind": "asset-inventory",
        "source_context_digest": machine_context["effective_digest"],
        "inventory_digest": inventory_digest,
        "capability_entries": capability_entries,
        "instruction_entries": instruction_entries,
    }

def classify_asset_inventory(
    inventory: Mapping[str, Any],
    *,
    allowed: Sequence[str] = (),
    denied: Sequence[str] = (),
    client_limited: bool = False,
) -> dict[str, Any]:
    """Project observed candidates into explicit closure evidence states."""

    allowed_names = set(allowed)
    denied_names = set(denied)

    def classify(entries: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for entry in entries:
            names = {
                name
                for values in entry.get("capabilities", {}).values()
                for name in values
            }
            names.add(str(entry["path"]))
            if client_limited:
                status = "reported_client_limited"
            elif names & denied_names:
                status = "blocked"
            elif names & allowed_names:
                status = "allowed"
            elif entry.get("status") == "unknown":
                status = "unknown"
            else:
                status = "stripped"
            result.append({**entry, "status": status})
        return result

    return {
        **inventory,
        "capability_entries": classify(inventory["capability_entries"]),
        "instruction_entries": classify(inventory["instruction_entries"]),
    }

def enforce_asset_closure(
    inventory: Mapping[str, Any], *, require_client_evidence: bool = True
) -> None:
    """Fail closed for blocked assets and active unknown observations."""

    entries = [
        *inventory["capability_entries"],
        *inventory["instruction_entries"],
    ]
    blocked = sorted(
        str(entry["path"]) for entry in entries if entry.get("status") == "blocked"
    )
    if blocked:
        raise ProfileError(f"blocked Agent-facing assets: {', '.join(blocked)}")
    if require_client_evidence:
        unknown = sorted(
            str(entry["path"]) for entry in entries if entry.get("status") == "unknown"
        )
        if unknown:
            raise ProfileError(
                "active Agent-facing assets lack client evidence: "
                + ", ".join(unknown)
            )

def _validate_external_imports(
    project: Project, profile: Profile, inventory: Mapping[str, Any]
) -> tuple[str, ...]:
    """Require approved provenance and role binding for external assets."""

    entries = [
        *inventory["capability_entries"],
        *inventory["instruction_entries"],
    ]
    imported: list[str] = []
    for item in project.external_imports:
        if profile.name not in item["profiles"]:
            continue
        if not item["approved"]:
            raise ProfileError(
                f"external import {item['name']} is not approved for {profile.name}"
            )
        matches = [
            entry
            for entry in entries
            if entry["digest"] == item["digest"]
            and item["name"]
            in {
                name
                for values in entry.get("capabilities", {}).values()
                for name in values
            }
        ]
        if not matches:
            raise ProfileError(
                f"external import {item['name']} does not match machine asset digest"
            )
        imported.append(item["name"])
    return tuple(imported)

def _controlled_output_path(value: Path | str, context: str) -> Path:
    path = Path(value).expanduser().absolute()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink() or _path_has_symlink_component(path.parent):
        raise ProfileError(f"{context} path must not traverse symlinks: {path}")
    return path
