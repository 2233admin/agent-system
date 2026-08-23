"""Client launch: auth staging, execution, and receipt emission."""
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
from agent_system.profile.constants import AMBIENT_CONFIG_ENV, CLIENT_EXECUTABLES, OMP_AMBIENT_AUTH_ENV, _client_adapter_version, _is_ambient_credential_name
from agent_system.profile.models import AuthBinding, LaunchSpec, Profile, ProfileError, Project, ReceiptReservation, RenderedFile, StableDirectory
from agent_system.profile.util import _canonical_json, _expect_keys, _loads_strict_json, _require_git_root, _sha256, _validate_client
from agent_system.profile.stable_dir import _home_relative_name, _require_external_directory, _stable_directory, _validate_stable_directory
from agent_system.profile.project_loading import _select_profile, load_project
from agent_system.profile.render import _render_tree, _rendered_skill_names, _rendered_text, _tree_hash
from agent_system.profile.home_security import _read_stable_private_value, _validate_private_directory, _validate_private_tree
from agent_system.profile.pollution_checks import _check_project_pollution
from agent_system.profile.base_manifest import _base_state, _load_base_manifest, _profile_uses_real_home, _warn_out_of_scope_base_mcps
from agent_system.profile.lock import _desired_lock, _input_records, _profile_inventory, _verify_lock
from agent_system.profile.evidence import _verify_evidence
from agent_system.profile.materialize_fs import _materialize_tree
from agent_system.profile.receipt import _commit_receipt, _prepare_receipt_path, _release_receipt, _reserve_receipt
from agent_system.profile.binding import _check_profile_environment


def _create_auth_symlink(
    runtime: StableDirectory, name: str, target: Path, context: str
) -> None:
    """Expose one validated persistent credential object inside the temporary root."""

    if os.name == "nt":
        raise ProfileError(
            f"{context} staging is not supported on this host; "
            "only omp launches without credential staging"
        )
    try:
        os.symlink(str(target), runtime.path / name)
    except OSError as error:
        raise ProfileError(f"could not stage {context}: {error}") from error

def _validate_broker_url(value: Any) -> str:
    """Return one HTTPS or loopback-HTTP auth-broker URL."""

    if not isinstance(value, str) or not value:
        raise ProfileError("OMP auth broker url must be a non-empty string")
    if any(not character.isprintable() or character.isspace() for character in value):
        raise ProfileError(
            "OMP auth broker url must contain only printable non-space characters"
        )
    parsed = urlsplit(value)
    if (
        parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise ProfileError("OMP auth broker url must contain only scheme and authority")
    loopback = parsed.hostname in {"127.0.0.1", "::1", "localhost"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and loopback):
        raise ProfileError("OMP auth broker url must use HTTPS or loopback HTTP")
    if parsed.hostname is None:
        raise ProfileError("OMP auth broker url must include a host")
    try:
        parsed.port
    except ValueError as error:
        raise ProfileError("OMP auth broker url has an invalid port") from error
    return value.rstrip("/")

def _parse_codex_auth(payload: bytes) -> dict[str, Any]:
    """Parse one complete Codex auth snapshot."""

    try:
        parsed = _loads_strict_json(
            payload.decode("utf-8"), "<auth-root>/codex/auth.json"
        )
    except UnicodeError as error:
        raise ProfileError("Codex auth.json must be UTF-8 JSON") from error
    if not isinstance(parsed, dict) or not parsed:
        raise ProfileError("Codex auth.json must be a non-empty JSON object")
    return parsed

def _parse_omp_broker_metadata(payload: bytes) -> dict[str, Any]:
    """Parse and validate one complete OMP broker metadata snapshot."""

    try:
        broker = _loads_strict_json(
            payload.decode("utf-8"), "<auth-root>/omp/broker.json"
        )
    except UnicodeError as error:
        raise ProfileError("OMP broker metadata must be UTF-8 JSON") from error
    if not isinstance(broker, dict):
        raise ProfileError("OMP broker metadata must be a JSON object")
    _expect_keys(broker, {"version", "url"}, "OMP broker metadata")
    if type(broker["version"]) is not int or broker["version"] != 1:
        raise ProfileError("OMP broker metadata.version must be 1")
    return {"version": 1, "url": _validate_broker_url(broker["url"])}

def _parse_omp_broker_token(payload: bytes) -> str:
    """Parse one complete OMP broker bearer-token snapshot."""

    try:
        token = payload.decode("ascii")
    except UnicodeError as error:
        raise ProfileError("OMP broker token must be ASCII") from error
    if not token or any(not 0x21 <= ord(character) <= 0x7E for character in token):
        raise ProfileError(
            "OMP broker token must contain only printable non-space ASCII"
        )
    return token

@contextmanager
def _staged_auth(
    project: Project,
    client: str,
    auth_root: Path | str,
    runtime: StableDirectory,
) -> Iterator[AuthBinding]:
    """Stage only the selected client's explicit persistent credential source."""

    root_path = Path(auth_root).expanduser().absolute()
    with _stable_directory(root_path, "auth root") as root:
        _require_external_directory(project, root, "auth root")
        _validate_private_directory(root, "auth root")
        client_path = root.path / client
        with _stable_directory(client_path, f"{client} auth directory") as client_root:
            _validate_private_directory(client_root, f"{client} auth directory")
            if client == "codex":
                _read_stable_private_value(
                    client_root,
                    "auth.json",
                    "Codex auth.json",
                    max_bytes=1024 * 1024,
                    parse=_parse_codex_auth,
                    require_owner_write=True,
                )
                _create_auth_symlink(
                    runtime, "auth.json", client_root.path / "auth.json", "Codex auth"
                )
                yield AuthBinding({}, (str(root.path), str(client_root.path)))
            elif client == "qoder":
                auth_path = client_root.path / ".auth"
                with _stable_directory(auth_path, "Qoder .auth") as qoder_auth:
                    _validate_private_directory(qoder_auth, "Qoder .auth")
                    _validate_private_tree(qoder_auth.path, "Qoder .auth")
                    _create_auth_symlink(
                        runtime, ".auth", qoder_auth.path, "Qoder auth directory"
                    )
                    yield AuthBinding({}, (str(root.path), str(qoder_auth.path)))
                    _validate_stable_directory(qoder_auth)
                    _validate_private_tree(qoder_auth.path, "Qoder .auth")
            elif client == "omp":
                broker = _read_stable_private_value(
                    client_root,
                    "broker.json",
                    "OMP broker metadata",
                    max_bytes=16 * 1024,
                    parse=_parse_omp_broker_metadata,
                )
                token_text = _read_stable_private_value(
                    client_root,
                    "token",
                    "OMP broker token",
                    max_bytes=8192,
                    parse=_parse_omp_broker_token,
                )
                yield AuthBinding(
                    {
                        "OMP_AUTH_BROKER_URL": broker["url"],
                        "OMP_AUTH_BROKER_TOKEN": token_text,
                    },
                    (str(root.path), str(client_root.path), token_text),
                )
            else:
                raise ProfileError(f"client {client} has no auth adapter")
            _validate_stable_directory(client_root)
        _validate_stable_directory(root)

def build_launch(
    client: str,
    runtime_root: Path | str,
    rendered_tree: Mapping[str, RenderedFile],
    forwarded_args: Sequence[str] = (),
) -> LaunchSpec:
    """Build one fixed launch from a stable root name and its immutable rendered tree."""

    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    _validate_client(client)
    root = Path(runtime_root).absolute()
    args = tuple(forwarded_args)
    _validate_forwarded_args(client, args)
    executable = _cli.CLIENT_EXECUTABLES[client]
    if client == "codex":
        return LaunchSpec((executable, *args), {"CODEX_HOME": str(root)})
    prompt = _rendered_text(
        rendered_tree, "system-prompt.md", "rendered profile prompt"
    )
    if client == "qoder":
        command = (
            executable,
            "--config-dir",
            str(root),
            "--strict-mcp-config",
            "--mcp-config",
            str(root / "mcp.json"),
            "--append-system-prompt",
            prompt,
            *args,
        )
        return LaunchSpec(command, {"QODER_CONFIG_DIR": str(root)})
    if client == "omp":
        skill_names = _rendered_skill_names(rendered_tree)
        skill_arguments = (
            ("--skills", ",".join(skill_names)) if skill_names else ("--no-skills",)
        )
        command = (
            executable,
            "--config",
            str(root / "config.yml"),
            "--append-system-prompt",
            prompt + "\n",
            *skill_arguments,
            "--no-extensions",
            "--no-rules",
            *args,
        )
        return LaunchSpec(
            command,
            {
                "OMP_PROFILE": "default",
                # PI_CODING_AGENT_DIR is resolved by the client; PI_CONFIG_DIR
                # is joined with the home, so it must be a relative name.
                "PI_CODING_AGENT_DIR": str(root),
                "PI_CONFIG_DIR": _home_relative_name(root, "omp runtime root"),
                "PI_CONFIG_FILES": str(root / "config.yml"),
                "PI_PROFILE": "default",
            },
        )
    raise ProfileError(f"client {client} has no launch adapter")

def _prepare_execution(
    project_root: Path | str,
    client: str,
    profile_name: str,
    forwarded_args: Sequence[str],
    *,
    private_overlay: Path | str | None = None,
    base_manifest: Path | str | None = None,
    base_pin: Path | str | None = None,
    binding_dir: Path | str | None = None,
    allow_active_drift: bool = False,
) -> tuple[Project, Profile, dict[str, Any], tuple[str, ...]]:
    """Validate every launch precondition before a client process can be created."""

    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    project = load_project(project_root, private_overlay)
    _require_git_root(project.root)
    _check_project_pollution(project.root)
    if project.overlay is not None:
        _check_project_pollution(project.overlay.root)
    desired = _desired_lock(project)
    _cli._verify_lock(project, desired)
    if project.overlay is not None:
        _verify_evidence(project, desired)
    profile = _select_profile(project, profile_name)
    _check_profile_environment(
        project,
        profile,
        desired,
        base_manifest=base_manifest,
        base_pin=base_pin,
        binding_dir=binding_dir,
        allow_active_drift=allow_active_drift,
    )
    _warn_out_of_scope_base_mcps(project, profile, base_manifest)
    _validate_client(client)
    args = tuple(forwarded_args)
    _validate_forwarded_args(client, args)
    return project, profile, desired, args

def _prepare_workdir(value: Path | str | None, default: Path) -> Path:
    """Resolve the client working directory without using mutable profile state."""

    if value is None:
        return default
    path = Path(value).expanduser().resolve(strict=True)
    if path.is_symlink() or not path.is_dir():
        raise ProfileError(f"workdir must be a non-symlink directory: {path}")
    return path

def _execute_runtime(
    project: Project,
    client: str,
    profile: Profile,
    desired: Mapping[str, Any],
    forwarded_args: Sequence[str],
    *,
    auth_root: Path | str,
    runner: Callable[..., Any],
    capture_output: bool,
    workdir: Path | str | None = None,
    base_manifest: Path | str | None = None,
    base_pin: Path | str | None = None,
    binding_dir: Path | str | None = None,
    allow_active_drift: bool = False,
) -> tuple[int, str, str]:
    """Render, bind explicit auth, and invoke one client through the strict path."""

    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    output_hash = desired["profiles"][profile.name]["clients"][client]["tree_hash"]
    with _ephemeral_runtime_root(client, profile.name) as runtime_root:
        tree = _render_tree(project, client, profile)
        if _tree_hash(tree) != output_hash:
            raise ProfileError("rendered output drifted after lock verification")
        with _stable_directory(runtime_root, "runtime root") as runtime_directory:
            _materialize_tree(runtime_directory, tree)
            with _staged_auth(
                project, client, auth_root, runtime_directory
            ) as auth_binding:
                spec = _cli.build_launch(
                    client, runtime_directory.path, tree, forwarded_args
                )
                target_workdir = _prepare_workdir(workdir, project.root)
                if client == "omp":
                    spec = LaunchSpec(
                        (
                            spec.command[0],
                            "--cwd",
                            str(target_workdir),
                            *spec.command[1:],
                        ),
                        spec.environment,
                    )
                environment = os.environ.copy()
                for name in AMBIENT_CONFIG_ENV:
                    environment.pop(name, None)
                if client == "omp":
                    for name in set(OMP_AMBIENT_AUTH_ENV) | {
                        candidate
                        for candidate in environment
                        if _is_ambient_credential_name(candidate)
                    }:
                        environment[name] = ""
                    environment["AWS_EC2_METADATA_DISABLED"] = "true"
                    if _profile_uses_real_home(profile):
                        assert base_manifest is not None
                        environment["HOME"] = _load_base_manifest(base_manifest)["home"]
                    else:
                        environment["HOME"] = str(runtime_directory.path)
                    environment["PI_AUTH_NO_BORROW"] = "1"
                environment.update(spec.environment)
                environment.update(auth_binding.environment)
                run_options: dict[str, Any] = {
                    "cwd": str(
                        runtime_directory.path if client == "omp" else target_workdir
                    ),
                    "env": environment,
                    "check": False,
                }
                if capture_output:
                    run_options.update(
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                    )
                _check_project_pollution(project.root)
                _check_profile_environment(
                    project,
                    profile,
                    desired,
                    base_manifest=base_manifest,
                    base_pin=base_pin,
                    binding_dir=binding_dir,
                    allow_active_drift=allow_active_drift,
                )
                if _input_records(project) != desired["inputs"]:
                    raise ProfileError("locked inputs drifted after lock verification")
                _validate_stable_directory(runtime_directory)
                completed = runner(list(spec.command), **run_options)
                _check_profile_environment(
                    project,
                    profile,
                    desired,
                    base_manifest=base_manifest,
                    base_pin=base_pin,
                    binding_dir=binding_dir,
                    allow_active_drift=allow_active_drift,
                )
                return_code = getattr(completed, "returncode", None)
                if type(return_code) is not int:
                    raise ProfileError(
                        "client runner did not return an integer return code"
                    )
                stdout = getattr(completed, "stdout", "") or ""
                stderr = getattr(completed, "stderr", "") or ""
                private_spellings = {
                    str(runtime_root),
                    runtime_root.as_posix(),
                    str(runtime_directory.path),
                    runtime_directory.path.as_posix(),
                    str(Path(auth_root).expanduser().absolute()),
                    Path(auth_root).expanduser().absolute().as_posix(),
                    *auth_binding.private_values,
                }
                for spelling in sorted(
                    (value for value in private_spellings if value),
                    key=len,
                    reverse=True,
                ):
                    stdout = stdout.replace(spelling, "<private>")
                    stderr = stderr.replace(spelling, "<private>")
    return return_code, stdout, stderr

def _receipt_payload(
    client: str,
    profile: Profile,
    desired: Mapping[str, Any],
    forwarded_args: Sequence[str],
    return_code: int,
) -> dict[str, Any]:
    """Build a receipt that records identity and hashes without arguments or secrets."""

    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    return {
        "version": 1,
        "client": client,
        "profile": profile.name,
        "executable": _cli.CLIENT_EXECUTABLES[client],
        "exit_code": return_code,
        "forwarded_argument_count": len(forwarded_args),
        "inventory": _profile_inventory(profile),
        "lock_hash": f"sha256:{_sha256(_canonical_json(desired))}",
        "output_tree_hash": desired["profiles"][profile.name]["clients"][client][
            "tree_hash"
        ],
        "adapter_version": _client_adapter_version(client),
        "temporary_root_removed": True,
    }

def run_client(
    project_root: Path | str,
    client: str,
    profile_name: str,
    forwarded_args: Sequence[str] = (),
    *,
    auth_root: Path | str,
    receipt_path: Path | str | None = None,
    workdir: Path | str | None = None,
    runner: Callable[..., Any] | None = None,
    private_overlay: Path | str | None = None,
    base_manifest: Path | str | None = None,
    base_pin: Path | str | None = None,
    binding_dir: Path | str | None = None,
) -> int:
    """Launch one authenticated client in a verified temporary root and clean it up."""

    project, profile, desired, args = _prepare_execution(
        project_root,
        client,
        profile_name,
        forwarded_args,
        private_overlay=private_overlay,
        base_manifest=base_manifest,
        base_pin=base_pin,
        binding_dir=binding_dir,
        allow_active_drift=True,
    )
    if _profile_uses_real_home(profile):
        assert base_manifest is not None and base_pin is not None
        _manifest, active_drift, passive_drift = _base_state(
            base_manifest, base_pin
        )
        if passive_drift:
            print(
                "profile: warning: passive machine-context drift: "
                + ", ".join(passive_drift),
                file=sys.stderr,
            )
        if active_drift:
            print(
                "profile: active machine-context drift: " + ", ".join(active_drift),
                file=sys.stderr,
            )
            if not sys.stdin.isatty():
                raise ProfileError(
                    "active machine-context drift blocks non-interactive launch"
                )
            answer = input(
                "Type 'continue' to launch once without updating lock or approval: "
            )
            if answer != "continue":
                raise ProfileError("interactive launch cancelled")
    receipt_target = (
        _prepare_receipt_path(receipt_path) if receipt_path is not None else None
    )
    reservation: ReceiptReservation | None = None
    if receipt_target is not None:
        reservation = _reserve_receipt(project, receipt_target)
    committed = False
    try:
        return_code, _, _ = _execute_runtime(
            project,
            client,
            profile,
            desired,
            args,
            auth_root=auth_root,
            runner=runner or subprocess.run,
            capture_output=False,
            workdir=workdir,
            base_manifest=base_manifest,
            base_pin=base_pin,
            binding_dir=binding_dir,
            allow_active_drift=True,
        )
        receipt_bytes = _canonical_json(
            _receipt_payload(client, profile, desired, args, return_code)
        )
        if reservation is None:
            sys.stdout.buffer.write(receipt_bytes)
        else:
            _commit_receipt(reservation, receipt_bytes)
            committed = True
        return return_code if return_code >= 0 else 128 + abs(return_code)
    finally:
        if reservation is not None:
            _release_receipt(reservation, remove=not committed)

@contextmanager
def _ephemeral_runtime_root(client: str, profile_name: str) -> Iterator[Path]:
    """Yield a one-shot runtime root that both hosts can express to a client.

    It lives under the real home rather than the system temporary directory.
    Some clients define a configuration directory variable as a *name relative
    to the home* and join it with the home themselves, so a root outside the
    home cannot be expressed at all: the value would be joined twice and the run
    would fail before it starts. Neither host's temporary directory is under the
    home -- macOS uses /tmp, Windows uses the LOCALAPPDATA temp folder -- so
    root under the home is what lets one implementation serve both instead of
    special-casing a platform.

    `_require_external_directory` already accepts locations under the home; it
    rejects only the home itself, the project, and the native capability roots.
    """

    parent = Path.home().absolute() / ".agent-system-state" / "tmp"
    parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=f"profile-{client}-{profile_name}-", dir=str(parent)
    ) as temporary:
        yield Path(temporary)

def _validate_forwarded_args(client: str, args: Sequence[str]) -> None:
    # Deferred, module-qualified: see the matching comment in lock.py.
    import agent_system.profile.cli as _cli

    try:
        forbidden = _cli.FORBIDDEN_CLIENT_ARGUMENTS[client]
        compact_prefixes = _cli.FORBIDDEN_CLIENT_ARGUMENT_PREFIXES[client]
    except KeyError as error:
        # A registered client with no forbidden-argument policy would otherwise
        # raise KeyError here and accept every forwarded flag, including ones
        # that reopen gates the adapter closed.
        raise ProfileError(
            f"client {client} has no forwarded-argument policy"
        ) from error
    for argument in args:
        if not isinstance(argument, str) or "\x00" in argument:
            raise ProfileError("forwarded arguments must be NUL-free strings")
        key = argument.split("=", 1)[0]
        compact_override = any(
            argument.startswith(prefix) for prefix in compact_prefixes
        )
        if key in forbidden or compact_override:
            raise ProfileError(
                f"forwarded argument may override the {client} capability root: {argument}"
            )
