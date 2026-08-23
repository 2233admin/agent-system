"""Atomic filesystem materialization: stage then publish a rendered tree."""
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
from agent_system.profile.models import ProfileError, RenderedFile, StableDirectory
from agent_system.profile.stable_dir import _is_link_component, _validate_stable_directory


def _write_all(descriptor: int, content: bytes) -> None:
    """Write every byte to one already-open file descriptor."""

    remaining = memoryview(content)
    while remaining:
        written = os.write(descriptor, remaining)
        if written <= 0:
            raise OSError("file write made no progress")
        remaining = remaining[written:]

def _fsync_directory(path: Path) -> None:
    """Flush one directory entry where the host can open a directory for reading."""

    if not hasattr(os, "O_DIRECTORY"):
        return
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def _stage_tree(staging: Path, tree: Mapping[str, RenderedFile]) -> list[str]:
    """Write one complete rendered tree into a private staging directory."""

    published: list[str] = []
    for relative, rendered in sorted(tree.items()):
        relative_path = PurePosixPath(relative)
        if (
            relative_path.is_absolute()
            or not relative_path.parts
            or any(part in {"", ".", ".."} for part in relative_path.parts)
        ):
            raise ProfileError(
                f"render path must be normalized and relative: {relative}"
            )
        if relative_path.parts[0] not in published:
            published.append(relative_path.parts[0])
        parent = staging
        for part in relative_path.parts[:-1]:
            parent = parent / part
            if not parent.is_dir():
                os.mkdir(parent, 0o700)
        target = parent / relative_path.parts[-1]
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        for name in ("O_CLOEXEC", "O_NOFOLLOW", "O_BINARY"):
            flags |= getattr(os, name, 0)
        descriptor = os.open(target, flags, rendered.mode)
        try:
            if hasattr(os, "fchmod"):
                os.fchmod(descriptor, rendered.mode)
            _write_all(descriptor, rendered.content)
            os.fsync(descriptor)
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ProfileError(f"staged file is not private: {relative}")
        finally:
            os.close(descriptor)
    return published

def _publish_staged_entry(source: Path, target: Path) -> None:
    """Move one staged top-level entry into the target directory."""

    if target.exists() or target.is_symlink():
        raise ProfileError(f"materialize target already exists: {target.name}")
    try:
        os.replace(source, target)
    except OSError as error:
        if getattr(error, "errno", None) != errno.EXDEV:
            raise
        shutil.move(str(source), str(target))

def _materialize_tree(
    directory: StableDirectory, tree: Mapping[str, RenderedFile]
) -> None:
    """Stage the whole tree outside the target, then publish it entry by entry.

    Writing straight into the target would let a directory swap capture every
    intermediate ``mkdir`` and ``open``. Staging first confines the tree to a
    directory only this process can name, so the target is touched once per
    top-level entry, each time immediately after re-verifying its identity.
    """

    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    try:
        _validate_stable_directory(directory)
        with tempfile.TemporaryDirectory(prefix="cap-staged-tree-") as staging_root:
            staging = Path(staging_root)
            published = _stage_tree(staging, tree)
            for name in published:
                _validate_stable_directory(directory)
                _cli._publish_staged_entry(staging / name, directory.path / name)
        _validate_stable_directory(directory)
        for relative in sorted(tree):
            live = os.lstat(directory.path / PurePosixPath(relative))
            if (
                not stat.S_ISREG(live.st_mode)
                or live.st_nlink != 1
                or _is_link_component(live)
            ):
                raise ProfileError(f"materialized file changed: {relative}")
        _fsync_directory(directory.path)
        _validate_stable_directory(directory)
    except ProfileError:
        raise
    except (OSError, NotImplementedError) as error:
        raise ProfileError(f"could not materialize tree: {error}") from error
