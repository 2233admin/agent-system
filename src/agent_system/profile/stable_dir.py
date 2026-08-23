"""TOCTOU-safe directory handle primitives used by home/asset and materialize code paths."""
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
from agent_system.profile.constants import GLOBAL_NATIVE_ROOTS
from agent_system.profile.models import ProfileError, Project, StableDirectory


def _same_file_identity(info: os.stat_result, device: int, inode: int) -> bool:
    """Return whether one stat result names the expected filesystem object."""

    return info.st_dev == device and info.st_ino == inode

def _is_link_component(info: os.stat_result) -> bool:
    """Return whether one lstat result names a symlink, junction or other reparse point."""

    if stat.S_ISLNK(info.st_mode):
        return True
    attributes = getattr(info, "st_file_attributes", 0)
    return bool(attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))

def _validate_stable_directory(directory: StableDirectory) -> None:
    """Verify that every component still names the object it named when opened."""

    try:
        current = Path(directory.path.anchor)
        for index, identity in enumerate(directory.identities):
            if index:
                current = current / directory.parts[index - 1]
            live = os.lstat(current)
            if not stat.S_ISDIR(live.st_mode) or (
                index and _is_link_component(live)
            ):
                raise ProfileError(f"stable directory changed: {directory.path}")
            if not _same_file_identity(live, identity[0], identity[1]):
                raise ProfileError(f"stable directory changed: {directory.path}")
    except ProfileError:
        raise
    except (OSError, NotImplementedError) as error:
        raise ProfileError(
            f"stable directory is no longer accessible: {error}"
        ) from error

def _normalize_root_alias(path: Path, context: str) -> Path:
    """Normalize only a root-owned first-component symlink such as macOS /var."""

    absolute = path.expanduser().absolute()
    if absolute.anchor != os.sep:
        return absolute
    if len(absolute.parts) < 2:
        return absolute
    first = Path(os.sep) / absolute.parts[1]
    try:
        info = os.lstat(first)
        if not stat.S_ISLNK(info.st_mode):
            return absolute
        if getattr(info, "st_uid", -1) != 0:
            raise ProfileError(f"{context} contains a non-root-owned symlink ancestor")
        target = first.resolve(strict=True)
    except ProfileError:
        raise
    except OSError as error:
        raise ProfileError(f"{context} root alias is not stable: {error}") from error
    return target.joinpath(*absolute.parts[2:])

def _open_stable_directory(path: Path, context: str) -> StableDirectory:
    """Bind a lexical path to one component-verified chain of directory identities."""

    absolute = _normalize_root_alias(path, context)
    parts = tuple(absolute.parts[1:])
    identities: list[tuple[int, int]] = []
    try:
        current = Path(absolute.anchor)
        info = os.lstat(current)
        if not stat.S_ISDIR(info.st_mode):
            raise ProfileError(f"{context} filesystem root is not a directory")
        identities.append((info.st_dev, info.st_ino))
        for part in parts:
            current = current / part
            info = os.lstat(current)
            if not stat.S_ISDIR(info.st_mode) or _is_link_component(info):
                raise ProfileError(
                    f"{context} must be an existing non-symlink directory: {current}"
                )
            identities.append((info.st_dev, info.st_ino))
    except ProfileError:
        raise
    except (OSError, NotImplementedError) as error:
        raise ProfileError(
            f"{context} must be an existing non-symlink directory: {error}"
        ) from error
    directory = StableDirectory(absolute, parts, tuple(identities))
    _validate_stable_directory(directory)
    return directory

def _close_stable_directory(directory: StableDirectory) -> None:
    """Release one directory binding; identities hold no operating-system resource."""

    return None

@contextmanager
def _stable_directory(path: Path, context: str) -> Iterator[StableDirectory]:
    """Yield one component-verified directory and re-verify its path before releasing."""

    directory = _open_stable_directory(path, context)
    try:
        yield directory
    except BaseException:
        raise
    else:
        _validate_stable_directory(directory)
    finally:
        _close_stable_directory(directory)

def _stable_directory_is_within(directory: StableDirectory, root: Path) -> bool:
    """Return whether a verified directory is the same as or below one physical root."""

    root_directory = _open_stable_directory(root, "restricted root")
    return root_directory.identity in directory.identities

def _stable_directory_is_same(directory: StableDirectory, other: Path) -> bool:
    """Return whether a verified directory is the same physical directory as one path."""

    return _open_stable_directory(other, "restricted root").identity == directory.identity

def _home_relative_name(directory: Path, context: str) -> str:
    """Express one managed directory as the home-relative name a client needs.

    See can1357/oh-my-pi#9067: the split between a resolved variable and a
    home-relative one is deliberate upstream, so cap converts rather than
    hoping an absolute path is accepted.
    """

    home = Path.home().absolute()
    try:
        return directory.absolute().relative_to(home).as_posix()
    except ValueError as error:
        raise ProfileError(
            f"{context} must live under the real home so it can be named "
            f"relative to it: {directory}"
        ) from error

def _require_external_directory(
    project: Project, directory: StableDirectory, context: str
) -> None:
    """Reject a held output directory inside the project or native capability roots."""

    if _stable_directory_is_within(directory, project.root):
        raise ProfileError(f"{context} must be outside the project root")
    home = Path.home().absolute()
    if _stable_directory_is_same(directory, home):
        raise ProfileError(f"{context} must be outside global capability roots")
    for relative in GLOBAL_NATIVE_ROOTS:
        native_root = home / relative
        if native_root.exists() and _stable_directory_is_within(directory, native_root):
            raise ProfileError(f"{context} must be outside global capability roots")
