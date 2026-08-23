"""Receipt file reservation/commit/release lifecycle."""
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
from agent_system.profile.models import ProfileError, Project, ReceiptReservation, StableDirectory
from agent_system.profile.stable_dir import _is_link_component, _normalize_root_alias, _require_external_directory, _same_file_identity, _stable_directory, _validate_stable_directory
from agent_system.profile.materialize_fs import _write_all


def _prepare_receipt_path(value: Path | str) -> Path:
    """Normalize one lexical receipt target without resolving mutable ancestors."""

    path = Path(value).expanduser().absolute()
    if not path.name:
        raise ProfileError("receipt target must name a file")
    parent = _normalize_root_alias(path.parent, "receipt parent")
    return parent / path.name

def _reserve_receipt(
    project: Project,
    path: Path,
    *,
    parent_directory: StableDirectory | None = None,
) -> ReceiptReservation:
    """Exclusively create an external receipt under one verified parent directory."""

    if parent_directory is not None:
        if path.parent != parent_directory.path:
            raise ProfileError("receipt parent handle does not match the target path")
        _validate_stable_directory(parent_directory)
        _require_external_directory(project, parent_directory, "receipt")
        parent_info = os.lstat(parent_directory.path)
    else:
        with _stable_directory(path.parent, "receipt parent") as stable_parent:
            _require_external_directory(project, stable_parent, "receipt")
            parent_info = os.lstat(stable_parent.path)
    descriptor: int | None = None
    try:
        live_parent = os.lstat(path.parent)
        if (
            not stat.S_ISDIR(live_parent.st_mode)
            or _is_link_component(live_parent)
            or not _same_file_identity(
                live_parent, parent_info.st_dev, parent_info.st_ino
            )
        ):
            raise ProfileError("receipt parent changed before reservation")

        target_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        for name in ("O_CLOEXEC", "O_NOFOLLOW", "O_BINARY"):
            target_flags |= getattr(os, name, 0)
        try:
            descriptor = os.open(path, target_flags, 0o600)
        except FileExistsError as error:
            raise ProfileError(f"receipt target already exists: {path}") from error
        except (OSError, NotImplementedError) as error:
            raise ProfileError(f"could not reserve receipt target: {error}") from error
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o600)
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ProfileError("reserved receipt must be a private regular file")
        return ReceiptReservation(
            path=path,
            descriptor=descriptor,
            parent_device=parent_info.st_dev,
            parent_inode=parent_info.st_ino,
            device=info.st_dev,
            inode=info.st_ino,
        )
    except BaseException:
        if descriptor is not None:
            recorded = os.fstat(descriptor)
            os.close(descriptor)
            _unlink_reserved_receipt(path, recorded.st_dev, recorded.st_ino)
        raise

def _validate_receipt_reservation(reservation: ReceiptReservation) -> None:
    try:
        if any(
            _is_link_component(os.lstat(candidate))
            for candidate in (reservation.path.parent, *reservation.path.parent.parents)
        ):
            raise ProfileError("receipt parent changed to a symlink")
        parent_info = os.lstat(reservation.path.parent)
        target_info = os.lstat(reservation.path)
        descriptor_info = os.fstat(reservation.descriptor)
    except (OSError, NotImplementedError) as error:
        raise ProfileError(
            f"receipt reservation is no longer stable: {error}"
        ) from error
    if not stat.S_ISDIR(parent_info.st_mode) or not _same_file_identity(
        parent_info,
        reservation.parent_device,
        reservation.parent_inode,
    ):
        raise ProfileError("receipt parent changed after reservation")
    if (
        target_info.st_nlink != 1
        or descriptor_info.st_nlink != 1
        or not stat.S_ISREG(target_info.st_mode)
        or not stat.S_ISREG(descriptor_info.st_mode)
        or not _same_file_identity(
            target_info,
            reservation.device,
            reservation.inode,
        )
        or not _same_file_identity(
            descriptor_info,
            reservation.device,
            reservation.inode,
        )
    ):
        raise ProfileError("receipt target changed or gained a hard-link alias")

def _commit_receipt(reservation: ReceiptReservation, content: bytes) -> None:
    """Commit bytes to the reserved inode without resolving the receipt path again."""

    _validate_receipt_reservation(reservation)
    try:
        os.lseek(reservation.descriptor, 0, os.SEEK_SET)
        os.ftruncate(reservation.descriptor, 0)
        _write_all(reservation.descriptor, content)
        os.fsync(reservation.descriptor)
    except OSError as error:
        raise ProfileError(f"could not commit receipt: {error}") from error
    _validate_receipt_reservation(reservation)

def _unlink_reserved_receipt(path: Path, device: int, inode: int) -> None:
    """Remove a reserved receipt only when the name still holds that object.

    The descriptor must already be closed: Windows refuses to unlink a file
    that is still open, so identity is confirmed against the values recorded
    at reservation time rather than against a live fstat.
    """

    try:
        target_info = os.lstat(path)
        if _same_file_identity(target_info, device, inode):
            os.unlink(path)
    except (FileNotFoundError, NotImplementedError):
        return

def _release_receipt(reservation: ReceiptReservation, *, remove: bool) -> None:
    os.close(reservation.descriptor)
    if remove:
        _unlink_reserved_receipt(
            reservation.path, reservation.device, reservation.inode
        )
