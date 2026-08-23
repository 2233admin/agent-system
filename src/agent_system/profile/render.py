"""Render a role Profile into a per-client native configuration tree."""
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
from agent_system.profile.models import McpDefinition, Profile, ProfileError, Project, RenderedFile
from agent_system.profile.util import _canonical_json, _read_nonempty_text, _safe_relative, _sha256, _validate_client, _validate_identifier
from agent_system.profile.home_security import _canonical_mode, _redacted_file_bytes


def _rendered_text(
    tree: Mapping[str, RenderedFile],
    relative: str,
    context: str,
    *,
    require_nonempty: bool = True,
) -> str:
    """Decode one UTF-8 file directly from the immutable rendered tree."""

    try:
        value = tree[relative].content.decode("utf-8").strip()
    except (KeyError, UnicodeError) as error:
        raise ProfileError(
            f"{context} must be rendered UTF-8 text: {relative}"
        ) from error
    if require_nonempty and not value:
        raise ProfileError(f"{context} must be non-empty")
    return value

def _rendered_skill_names(tree: Mapping[str, RenderedFile]) -> tuple[str, ...]:
    """Return validated top-level skill names directly from the rendered tree."""

    names = {
        parts[1]
        for relative in tree
        if len(parts := PurePosixPath(relative).parts) >= 3 and parts[0] == "skills"
    }
    for name in names:
        _validate_identifier(name, "rendered skill name")
    return tuple(sorted(names))

def _render_tree(
    project: Project, client: str, profile: Profile
) -> dict[str, RenderedFile]:
    _validate_client(client)
    tree: dict[str, RenderedFile] = {}
    folded_paths: dict[str, str] = {}

    def put(path: str, rendered: RenderedFile, source: str) -> None:
        relative = _safe_relative(path, f"render path from {source}").as_posix()
        folded = relative.casefold()
        if relative in tree or folded in folded_paths:
            prior = folded_paths.get(folded, relative)
            raise ProfileError(
                f"render path conflict: {relative} from {source} conflicts with {prior}"
            )
        tree[relative] = rendered
        folded_paths[folded] = relative

    prompt = _profile_prompt(profile)
    mcp_definitions = [project.mcps[name] for name in profile.mcps]
    if client == "codex":
        put(
            "config.toml",
            RenderedFile(_codex_config(mcp_definitions)),
            "codex renderer",
        )
        put("AGENTS.md", RenderedFile(prompt), "codex renderer")
    elif client == "qoder":
        put("settings.json", RenderedFile(b"{}\n"), "qoder renderer")
        put("mcp.json", RenderedFile(_qoder_mcp(mcp_definitions)), "qoder renderer")
        put("system-prompt.md", RenderedFile(prompt), "qoder renderer")
    elif client == "claude":
        # `claude-config.yaml` is the CAP-owned intermediate, not a Claude
        # native file. It stays empty in the portable render for the same
        # reason OMP's `config.yml` does: effective policy and machine
        # binding belong to the adapter, not to the reproducible tree.
        put("claude-config.yaml", RenderedFile(b"{}\n"), "claude renderer")
        put(
            "mcp.json",
            RenderedFile(_claude_mcp(mcp_definitions)),
            "claude renderer",
        )
        put("system-prompt.md", RenderedFile(prompt), "claude renderer")
    elif client == "omp":
        put("config.yml", RenderedFile(b"{}\n"), "omp renderer")
        put("mcp.json", RenderedFile(_omp_mcp(mcp_definitions)), "omp renderer")
        put("system-prompt.md", RenderedFile(prompt), "omp renderer")
    else:
        raise ProfileError(f"client {client} has no renderer")

    for skill in profile.skills:
        source_root = profile.origins["skills"].get(skill)
        if source_root is None:
            raise ProfileError(f"skill {skill} has no verified source")
        rendered = 0
        for source in sorted(
            source_root.rglob("*"),
            key=lambda path: path.relative_to(source_root).as_posix(),
        ):
            if source.is_file():
                relative = source.relative_to(source_root).as_posix()
                put(
                    f"skills/{skill}/{relative}",
                    RenderedFile(
                        _redacted_file_bytes(source), _canonical_mode(source)
                    ),
                    f"skill {skill}",
                )
                rendered += 1
        if not rendered:
            # rglob() yields nothing for a missing or empty directory, so a
            # declared skill whose origin resolves to the wrong place would
            # otherwise be dropped without any error: lock, verify and render
            # all keep passing while the client receives no skill at all.
            raise ProfileError(
                f"skill {skill} rendered no files from {source_root}"
            )

    for kind, names in (("hooks", profile.hooks), ("plugins", profile.plugins)):
        for name in names:
            source_root = profile.origins[kind].get(name)
            if source_root is None:
                raise ProfileError(f"{kind[:-1]} {name} has no verified source")
            target = source_root / "targets" / client
            if not target.is_dir() or target.is_symlink():
                raise ProfileError(f"{kind[:-1]} {name} lacks required {client} target")
            for source in sorted(
                target.rglob("*"), key=lambda path: path.relative_to(target).as_posix()
            ):
                if source.is_file():
                    relative = source.relative_to(target).as_posix()
                    put(
                        relative,
                        RenderedFile(
                            _redacted_file_bytes(source),
                            _canonical_mode(source),
                        ),
                        f"{kind[:-1]} {name}",
                    )
    return dict(sorted(tree.items()))

def _profile_prompt(profile: Profile) -> bytes:
    texts = [
        _read_nonempty_text(path, f"profile {profile.name} prompt")
        for path in profile.prompt_chain
    ]
    return ("\n\n".join(texts) + "\n").encode("utf-8")

def _codex_config(definitions: Sequence[McpDefinition]) -> bytes:
    lines = ['cli_auth_credentials_store = "file"']
    for definition in definitions:
        if lines:
            lines.append("")
        lines.extend(
            [
                f"[mcp_servers.{definition.name}]",
                f"command = {_toml_string(definition.command)}",
                f"args = {_toml_array(definition.args)}",
                "required = true",
            ]
        )
        if definition.env:
            lines.append("")
            lines.append(f"[mcp_servers.{definition.name}.env]")
            for key, value in sorted(definition.env.items()):
                lines.append(f"{_toml_key(key)} = {_toml_string(value)}")
    return (("\n".join(lines) + "\n") if lines else "").encode("utf-8")

def _qoder_mcp(definitions: Sequence[McpDefinition]) -> bytes:
    servers = {
        definition.name: {
            "command": definition.command,
            "args": list(definition.args),
            "env": dict(definition.env),
        }
        for definition in definitions
    }
    return _canonical_json({"mcpServers": servers})

def _claude_mcp(definitions: Sequence[McpDefinition]) -> bytes:
    """Render the CAP-side MCP tree consumed by the Claude adapter.

    Claude reads `mcpServers` with the same stdio shape as OMP, so the
    portable bytes are identical today. It is kept separate anyway: the two
    clients version their native schemas independently, and sharing one
    renderer would silently couple them.
    """

    servers = {
        definition.name: {
            "type": "stdio",
            "command": definition.command,
            "args": list(definition.args),
            "env": dict(definition.env),
        }
        for definition in definitions
    }
    return _canonical_json({"mcpServers": servers})

def _omp_mcp(definitions: Sequence[McpDefinition]) -> bytes:
    servers = {
        definition.name: {
            "type": "stdio",
            "command": definition.command,
            "args": list(definition.args),
            "env": dict(definition.env),
        }
        for definition in definitions
    }
    return _canonical_json({"mcpServers": servers})

def _toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)

def _toml_array(values: Sequence[str]) -> str:
    return "[" + ", ".join(_toml_string(value) for value in values) + "]"

def _toml_key(value: str) -> str:
    return value if re.fullmatch(r"[A-Za-z0-9_-]+", value) else _toml_string(value)

def _tree_hash(tree: Mapping[str, RenderedFile]) -> str:
    records = {
        path: {
            "mode": f"{rendered.mode:04o}",
            "sha256": _sha256(rendered.content),
        }
        for path, rendered in sorted(tree.items())
    }
    return f"sha256:{_sha256(_canonical_json(records))}"
