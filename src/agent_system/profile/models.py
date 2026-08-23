"""Dataclasses shared across the v3 profile engine."""
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


class ProfileError(Exception):
    """Report a deterministic validation or launch-preparation failure."""

@dataclass(frozen=True)
class McpDefinition:
    """Hold one validated, client-neutral stdio MCP definition."""

    name: str
    command: str
    args: tuple[str, ...]
    env: Mapping[str, str]
    source: Path

@dataclass(frozen=True)
class CapabilityOperations:
    """Describe one explicit v3 capability mutation."""

    allow: tuple[str, ...]
    deny: tuple[str, ...]
    override: tuple[str, ...]

@dataclass(frozen=True)
class ProjectSkillImport:
    """Bind one project-owned Skill id to its canonical source directory."""

    name: str
    source: Path

@dataclass(frozen=True)
class Profile:
    """Hold one resolved capability layer, including its source root."""

    name: str
    source: Path
    source_root: Path
    extends: str | None
    chain: tuple[str, ...]
    prompt: Path
    prompt_chain: tuple[Path, ...]
    operations: Mapping[str, CapabilityOperations]
    origins: Mapping[str, Mapping[str, Path]]
    skills: tuple[str, ...]
    mcps: tuple[str, ...]
    hooks: tuple[str, ...]
    plugins: tuple[str, ...]
    runtime: Mapping[str, str]

@dataclass(frozen=True)
class OverlaySpec:
    """Describe one explicit private capability overlay."""

    root: Path
    namespace: str
    descriptor: Path | None

@dataclass(frozen=True)
class Project:
    """Hold a fully validated public project and optional private overlay."""

    root: Path
    manifest: Path
    defaults: Path
    runtime_policies: Mapping[str, Path]
    skill_imports_manifest: Path | None
    skill_imports: Mapping[str, ProjectSkillImport]
    profiles: Mapping[str, Profile]
    mcps: Mapping[str, McpDefinition]
    external_imports: tuple[Mapping[str, Any], ...]
    overlay: OverlaySpec | None = None

@dataclass(frozen=True)
class RenderedFile:
    """Hold normalized output bytes and permission bits for one rendered file."""

    content: bytes
    mode: int = 0o644

@dataclass(frozen=True)
class LaunchSpec:
    """Describe a client command and its isolated-root environment override."""

    command: tuple[str, ...]
    environment: Mapping[str, str]

@dataclass(frozen=True)
class AuthBinding:
    """Hold explicit auth environment values and strings that must be redacted."""

    environment: Mapping[str, str]
    private_values: tuple[str, ...]

@dataclass(frozen=True)
class ReceiptReservation:
    """Hold a no-clobber receipt inode and its stable parent directory."""

    path: Path
    descriptor: int
    parent_device: int
    parent_inode: int
    device: int
    inode: int

@dataclass(frozen=True)
class StableDirectory:
    """Hold a directory and the object identity of every component from the root to it."""

    path: Path
    parts: tuple[str, ...]
    identities: tuple[tuple[int, int], ...]

    @property
    def identity(self) -> tuple[int, int]:
        """Return the device and inode identity of the final directory."""

        return self.identities[-1]
