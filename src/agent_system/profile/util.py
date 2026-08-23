"""Small, dependency-free helpers: strict JSON/TOML reads, path/identifier validation, atomic primitives."""
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
from agent_system.profile.constants import CLIENTS, IDENTIFIER
from agent_system.profile.models import ProfileError, StableDirectory
from agent_system.profile.stable_dir import _is_link_component, _same_file_identity, _validate_stable_directory


def _read_toml(path: Path) -> dict[str, Any]:
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, tomllib.TOMLDecodeError) as error:
        raise ProfileError(f"invalid TOML {path}: {error}") from error
    if not isinstance(data, dict):
        raise ProfileError(f"TOML root must be a table: {path}")
    return data

def _loads_strict_json(text: str, context: str) -> Any:
    """Parse strict JSON text with duplicate-key and non-finite-number rejection."""

    def pairs_hook(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ProfileError(f"duplicate JSON key {key!r} in {context}")
            result[key] = value
        return result

    def reject_constant(value: str) -> Any:
        raise ProfileError(f"non-finite JSON number {value!r} in {context}")

    try:
        return json.loads(
            text,
            object_pairs_hook=pairs_hook,
            parse_constant=reject_constant,
        )
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ProfileError(f"invalid JSON {context}: {error}") from error

def _strict_json(path: Path) -> Any:
    """Read and parse one strict JSON file by path."""

    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise ProfileError(f"invalid JSON {path}: {error}") from error
    return _loads_strict_json(text, str(path))

def _strict_json_from_directory(directory: StableDirectory, name: str) -> Any:
    """Read one strict JSON file relative to a held directory without following links."""

    flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0)
    for flag_name in ("O_CLOEXEC", "O_NOFOLLOW"):
        flags |= getattr(os, flag_name, 0)
    target = directory.path / name
    try:
        _validate_stable_directory(directory)
        try:
            if _is_link_component(os.lstat(target)):
                raise ProfileError(f"state file must not be a link: {name}")
            descriptor = os.open(target, flags)
        except FileNotFoundError as error:
            raise ProfileError(f"state file missing: {name}") from error
        try:
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ProfileError(f"state file must be a private regular file: {name}")
            with os.fdopen(descriptor, "r", encoding="utf-8") as stream:
                descriptor = -1
                text = stream.read()
        finally:
            if descriptor >= 0:
                os.close(descriptor)
        live = os.stat(target, follow_symlinks=False)
        if (
            not stat.S_ISREG(live.st_mode)
            or live.st_nlink != 1
            or not _same_file_identity(live, info.st_dev, info.st_ino)
        ):
            raise ProfileError(f"state file changed while reading: {name}")
        _validate_stable_directory(directory)
    except ProfileError:
        raise
    except (OSError, NotImplementedError, UnicodeError) as error:
        raise ProfileError(f"invalid JSON {directory.path / name}: {error}") from error
    return _loads_strict_json(text, str(directory.path / name))

def _expect_keys(data: Mapping[str, Any], expected: set[str], context: str) -> None:
    actual = set(data)
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    if missing or extra:
        raise ProfileError(f"{context} keys mismatch: missing={missing}, extra={extra}")

def _validate_identifier(value: Any, context: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ProfileError(f"{context} must match {IDENTIFIER.pattern}: {value!r}")
    return value

def _identifier_list(value: Any, context: str) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise ProfileError(f"{context} must be an array")
    result = tuple(_validate_identifier(item, context) for item in value)
    if len(result) != len(set(result)):
        raise ProfileError(f"{context} contains duplicates")
    return result

def _safe_relative(value: str, context: str) -> PurePosixPath:
    if not value or "\\" in value:
        raise ProfileError(
            f"{context} must be a normalized POSIX relative path: {value!r}"
        )
    path = PurePosixPath(value)
    if (
        path.is_absolute()
        or path.as_posix() != value
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise ProfileError(
            f"{context} must be a normalized POSIX relative path: {value!r}"
        )
    return path

def _resolve_file(root: Path, value: str, context: str) -> Path:
    relative = _safe_relative(value, context)
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ProfileError(f"{context} must not traverse a symlink: {value}")
    try:
        resolved = current.resolve(strict=True)
    except OSError as error:
        raise ProfileError(f"{context} does not exist: {value}") from error
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise ProfileError(f"{context} must resolve to a regular project file: {value}")
    return resolved

def _resolve_directory(root: Path, value: str, context: str) -> Path:
    relative = _safe_relative(value, context)
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ProfileError(f"{context} must not traverse a symlink: {value}")
    try:
        resolved = current.resolve(strict=True)
    except OSError as error:
        raise ProfileError(f"{context} does not exist: {value}") from error
    if not resolved.is_relative_to(root) or not resolved.is_dir():
        raise ProfileError(f"{context} must resolve to a project directory: {value}")
    return resolved

def _require_under_cap(root: Path, path: Path, context: str) -> None:
    cap_root = root / ".cap"
    if not path.is_relative_to(cap_root):
        raise ProfileError(f"{context} must be stored under .cap")

def _read_nonempty_text(path: Path, context: str) -> str:
    """Read one required non-empty UTF-8 project source file."""

    try:
        value = path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError) as error:
        raise ProfileError(f"{context} must be readable UTF-8 text: {error}") from error
    if not value:
        raise ProfileError(f"{context} must be non-empty")
    return value

def _validate_client(client: str) -> None:
    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    if client not in _cli.CLIENTS:
        raise ProfileError(f"unknown client: {client}")

def _require_git_root(root: Path) -> None:
    completed = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--show-toplevel"],
        capture_output=True,
        check=False,
        text=True,
    )
    if completed.returncode != 0:
        raise ProfileError("run requires the profile project to be a Git worktree root")
    try:
        discovered = Path(completed.stdout.strip()).resolve(strict=True)
    except OSError as error:
        raise ProfileError("Git reported an invalid worktree root") from error
    if discovered != root:
        raise ProfileError(
            f"profile project must equal the Git worktree root; discovered {discovered}"
        )

def _contains_mapping_key(value: Any, keys: set[str]) -> bool:
    """Return whether a nested mapping contains any capability-bearing key."""

    if isinstance(value, Mapping):
        return any(
            key in keys or _contains_mapping_key(item, keys)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(_contains_mapping_key(item, keys) for item in value)
    return False

def _text_has_top_level_key(path: Path, keys: set[str]) -> bool:
    """Detect capability-bearing top-level keys in YAML or JSONC configuration."""

    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise ProfileError(
            f"global config must be readable UTF-8 text: {path}: {error}"
        ) from error
    stripped = text.lstrip()
    if stripped.startswith("{"):
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            alternatives = "|".join(re.escape(key) for key in sorted(keys))
            return (
                re.search(
                    rf"(?m)^[ \t]*(?:\"(?:{alternatives})\"|'(?:{alternatives})'|(?:{alternatives}))\s*:",
                    text,
                )
                is not None
            )
        return isinstance(data, dict) and any(key in data for key in keys)
    alternatives = "|".join(re.escape(key) for key in sorted(keys))
    return (
        re.search(
            rf"(?m)^(?:\"(?:{alternatives})\"|'(?:{alternatives})'|(?:{alternatives}))\s*:",
            text,
        )
        is not None
    )

def _atomic_write(path: Path, content: bytes, *, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(mode)
        os.replace(temporary, path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise

def _canonical_json(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    ).encode("utf-8")

def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()

def _print_json(value: Any) -> None:
    sys.stdout.buffer.write(_canonical_json(value))
