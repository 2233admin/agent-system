"""Validation for the on-disk .cap/capabilities/{skills,mcp,hooks,plugins} store shape."""
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
from agent_system.profile.constants import CAPABILITY_KINDS, CLIENTS
from agent_system.profile.models import McpDefinition, ProfileError
from agent_system.profile.util import _expect_keys, _strict_json, _validate_identifier


def _validate_capability_store(
    root: Path, expected: Mapping[str, set[str]]
) -> dict[str, McpDefinition]:
    base = root / ".cap" / "capabilities"
    _require_directory(base, "capability store")
    children = {item.name for item in base.iterdir()}
    known_kinds = set(CAPABILITY_KINDS)
    extra_kinds = sorted(children - known_kinds)
    missing_required_kinds = sorted(
        kind for kind in known_kinds - children if expected[kind]
    )
    if extra_kinds or missing_required_kinds:
        raise ProfileError(
            "capability store kinds mismatch: "
            f"missing={missing_required_kinds}, extra={extra_kinds}"
        )
    mcps: dict[str, McpDefinition] = {}
    for kind in CAPABILITY_KINDS:
        kind_root = base / kind
        if not kind_root.exists():
            if kind_root.is_symlink() or expected[kind]:
                _require_directory(kind_root, f"capability kind {kind}")
            continue
        _require_directory(kind_root, f"capability kind {kind}")
        if kind == "mcp":
            actual = set()
            for item in sorted(kind_root.iterdir(), key=lambda path: path.name):
                if item.is_symlink() or not item.is_file() or item.suffix != ".json":
                    raise ProfileError(
                        f"mcp store contains invalid entry: {item.relative_to(root)}"
                    )
                name = item.stem
                _validate_identifier(name, "mcp capability name")
                actual.add(name)
                mcps[name] = _load_mcp(item, name)
        else:
            actual = set()
            for item in sorted(kind_root.iterdir(), key=lambda path: path.name):
                if item.is_symlink() or not item.is_dir():
                    raise ProfileError(
                        f"{kind} store contains invalid entry: {item.relative_to(root)}"
                    )
                _validate_identifier(item.name, f"{kind} capability name")
                actual.add(item.name)
                _validate_capability_tree(root, kind, item)
        if actual != expected[kind]:
            raise ProfileError(
                f"{kind} inventory mismatch: missing={sorted(expected[kind] - actual)}, "
                f"unreferenced={sorted(actual - expected[kind])}"
            )
    return mcps

def _require_directory(path: Path, context: str) -> None:
    if path.is_symlink() or not path.exists() or not path.is_dir():
        raise ProfileError(f"{context} must be a non-symlink directory: {path}")

def _validate_capability_tree(root: Path, kind: str, capability: Path) -> None:
    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    entries = sorted(
        capability.rglob("*"), key=lambda path: path.relative_to(root).as_posix()
    )
    for item in entries:
        if item.is_symlink() or not (item.is_file() or item.is_dir()):
            raise ProfileError(
                f"capability tree contains unsupported entry: {item.relative_to(root)}"
            )
    if kind == "skills":
        if not (capability / "SKILL.md").is_file():
            raise ProfileError(
                f"skill capability lacks SKILL.md: {capability.relative_to(root)}"
            )
        if not any(item.is_file() for item in entries):
            raise ProfileError(
                f"skill capability is empty: {capability.relative_to(root)}"
            )
        return
    direct = {item.name for item in capability.iterdir()}
    if direct != {"targets"}:
        raise ProfileError(
            f"{kind} capability must contain only targets/: {capability.relative_to(root)}"
        )
    targets = capability / "targets"
    _require_directory(targets, f"{kind} targets")
    target_names = {item.name for item in targets.iterdir()}
    if not target_names or not target_names.issubset(set(_cli.CLIENTS)):
        raise ProfileError(
            f"{kind} targets must be a non-empty subset of {list(_cli.CLIENTS)}"
        )
    for target in targets.iterdir():
        _require_directory(target, f"{kind} target {target.name}")
        direct = {item.name for item in target.iterdir()}
        if direct != {kind}:
            raise ProfileError(
                f"{kind} target {target.name} must contain only {kind}/: "
                f"{target.relative_to(root)}"
            )
        namespace = target / kind
        _require_directory(namespace, f"{kind} target {target.name} namespace")
        if not any(item.is_file() for item in namespace.rglob("*")):
            raise ProfileError(f"{kind} target is empty: {target.relative_to(root)}")

def _load_mcp(path: Path, expected_name: str) -> McpDefinition:
    data = _strict_json(path)
    if not isinstance(data, dict):
        raise ProfileError(f"MCP definition must be an object: {path}")
    _expect_keys(
        data, {"version", "name", "command", "args", "env"}, f"MCP {expected_name}"
    )
    if type(data["version"]) is not int or data["version"] != 1:
        raise ProfileError(f"MCP {expected_name}.version must be 1")
    if data["name"] != expected_name:
        raise ProfileError(f"MCP {expected_name}.name must equal its file name")
    if (
        not isinstance(data["command"], str)
        or not data["command"]
        or "\x00" in data["command"]
    ):
        raise ProfileError(
            f"MCP {expected_name}.command must be a non-empty NUL-free string"
        )
    args = data["args"]
    if not isinstance(args, list) or any(
        not isinstance(item, str) or "\x00" in item for item in args
    ):
        raise ProfileError(
            f"MCP {expected_name}.args must be an array of NUL-free strings"
        )
    env = data["env"]
    if not isinstance(env, dict) or any(
        not isinstance(key, str)
        or not key
        or "\x00" in key
        or not isinstance(value, str)
        or "\x00" in value
        for key, value in env.items()
    ):
        raise ProfileError(f"MCP {expected_name}.env must be a string-to-string object")
    return McpDefinition(
        expected_name, data["command"], tuple(args), dict(sorted(env.items())), path
    )
