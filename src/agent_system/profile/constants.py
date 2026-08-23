"""Shared version numbers, name constants, and static tables for the v3 profile engine."""
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


from agent_system.profile.models import ProfileError


RENDERER_VERSION = "profile-renderer-v3"

LOCK_VERSION = 3

MANIFEST_VERSION = 3

PROFILE_VERSION = 3

BASE_MANIFEST_VERSION = 3

BASE_PIN_VERSION = 3

BINDING_VERSION = 3

OVERLAY_VERSION = 2

PROJECT_SKILL_IMPORTS_VERSION = 1

EVIDENCE_VERSION = 2

MACHINE_CONTEXT_NAME = "machine-context"

REAL_HOME_PROFILE = "real-home"  # legacy migration format only

PROJECT_DEFAULTS_NAME = "project-defaults"

CLIENTS = ("codex", "qoder", "omp", "claude")

LAUNCHABLE_CLIENTS = ("codex", "qoder", "omp")

CLIENT_EXECUTABLES = {
    "codex": "codex",
    "qoder": "qoder",
    "omp": "omp",
    "claude": "claude",
}

CLIENT_ADAPTER_VERSION: Mapping[str, int] = {
    "codex": 8,
    "omp": 8,
    "qoder": 8,
    "claude": 1,
}

IDENTIFIER = re.compile(r"^[a-z][a-z0-9-]*$")

CAPABILITY_KINDS = ("skills", "mcp", "hooks", "plugins")

PROJECT_BYPASS_DIRS = frozenset(
    {
        ".agents",
        ".claude",
        ".claude-plugin",
        ".codex-plugin",
        ".codeium",
        ".codex",
        ".cursor",
        ".gemini",
        ".omp",
        ".qoder",
        ".vscode",
        ".windsurf",
    }
)

PROJECT_BYPASS_FILES = frozenset(
    {
        "AGENTS.md",
        "AGENTS.override.md",
        "CLAUDE.md",
        "CLAUDE.local.md",
        "QODER.md",
        "QODER.local.md",
    }
)

PROJECT_BYPASS_PATHS = frozenset(
    {
        ".mcp.json",
        "mcp.json",
        ".claude/.mcp.json",
        ".claude/mcp.json",
        ".cursor/mcp.json",
        ".gemini/settings.json",
        ".vscode/mcp.json",
        ".windsurf/mcp_config.json",
        "opencode.json",
    }
)

GLOBAL_CAPABILITY_PATHS = (
    ".agents/hooks",
    ".agents/plugins",
    ".agents/skills",
    ".claude/mcp.json",
    ".codeium/windsurf/mcp_config.json",
    ".codex/AGENTS.md",
    ".codex/AGENTS.override.md",
    ".codex/hooks",
    ".codex/hooks.json",
    ".codex/plugins",
    ".codex/skills",
    ".cursor/mcp.json",
    ".mcp.json",
    ".omp/AGENTS.md",
    ".omp/hooks",
    ".omp/mcp.json",
    ".omp/plugins",
    ".omp/skills",
    ".omp/agent/AGENTS.md",
    ".omp/agent/extensions",
    ".omp/agent/hooks",
    ".omp/agent/mcp.json",
    ".omp/agent/.mcp.json",
    ".omp/agent/plugins",
    ".omp/agent/skills",
    ".pi/agent/AGENTS.md",
    ".pi/agent/extensions",
    ".pi/agent/hooks",
    ".pi/agent/mcp.json",
    ".pi/agent/skills",
    ".qoder/AGENTS.md",
    ".qoder/QODER.md",
    ".qoder/hooks",
    ".qoder/mcp.json",
    ".qoder/plugins",
    ".qoder/skills",
)

GLOBAL_FLOOR_PATHS = frozenset({".codex/AGENTS.md", ".qoder/AGENTS.md"})

HOST_FLOOR_TEXT = """# Agent 宿主底座

- 业务指令与能力必须由当前 Git 项目显式声明；模板只用于生成项目内副本，不是运行时来源。
- 全局不得启用业务 Skills、MCP、hooks、plugins、rules、agents、marketplaces 或 provider 覆盖。
- 项目需要本机增量时，必须在项目 manifest 中显式允许；不得因目录位置自动继承。
- 项目缺少 `AGENTS.md` 或 `.cap/manifest.toml` 时，先警告再按用户要求继续；不得从用户目录补齐业务能力。
- 认证、运行态与 UI 偏好可以留在用户目录，但不得向模型注入业务上下文。
- 用户当轮明确指令与平台安全约束优先。
"""

CODEX_CAPABILITY_FEATURES = frozenset(
    {
        "apps",
        "browser_use",
        "browser_use_external",
        "browser_use_full_cdp_access",
        "computer_use",
        "goals",
        "hooks",
        "image_generation",
        "in_app_browser",
        "memories",
        "multi_agent",
        "multi_agent_v2",
        "plugin_sharing",
        "plugins",
        "recommended_plugins",
        "remote_plugin",
        "skill_mcp_dependency_install",
        "skill_search",
        "tool_suggest",
        "workspace_dependencies",
    }
)

CODEX_RUNTIME_ONLY_FEATURES = frozenset({"prevent_idle_sleep"})

CODEX_RUNTIME_ONLY_KEYS = frozenset(
    {
        "approval_policy",
        "analytics",
        "approvals_reviewer",
        "cli_auth_credentials_store",
        "feedback",
        "desktop",
        "features",
        "history",
        "model",
        "model_reasoning_effort",
        "model_reasoning_summary",
        "notice",
        "sandbox_mode",
        "tool_output_token_limit",
        "projects",
        "tui",
    }
)

CODEX_CAPABILITY_KEYS = frozenset(
    {
        "agents",
        "apps",
        "developer_instructions",
        "hooks",
        "marketplaces",
        "mcp_servers",
        "model_instructions_file",
        "model_provider",
        "model_providers",
        "personality",
        "plugins",
        "skills",
    }
)

ORCA_MANAGED_EXTENSION_NAMES = frozenset(
    {"orca-agent-status.ts", "orca-prefill.ts", "orca-titlebar-spinner.ts"}
)

CODEX_EXPLICITLY_DISABLABLE_ROOTS = frozenset({"agents", "apps", "marketplaces"})

GLOBAL_NATIVE_ROOTS = (
    ".agents",
    ".claude",
    ".codeium",
    ".codex",
    ".config/opencode",
    ".cursor",
    ".gemini",
    ".omp",
    ".pi",
    ".qoder",
)

AMBIENT_CONFIG_ENV = frozenset(
    {
        "CODEX_ACCESS_TOKEN",
        "CODEX_API_KEY",
        "CODEX_HOME",
        "OMP_AUTH_BROKER_TOKEN",
        "OMP_AUTH_BROKER_URL",
        "OMP_PROFILE",
        "OPENAI_API_KEY",
        "PI_CODING_AGENT_DIR",
        "PI_CONFIG_DIR",
        "PI_CONFIG_FILES",
        "PI_PROFILE",
        "QODER_CONFIG_DIR",
        "QODER_WORKING_DIR",
    }
)

OMP_AMBIENT_AUTH_ENV = frozenset(
    {
        "AIAND_API_KEY",
        "AIMLAPI_API_KEY",
        "AI_GATEWAY_API_KEY",
        "ALIBABA_CODING_PLAN_API_KEY",
        "ALIBABA_TOKEN_PLAN_API_KEY",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_CUSTOM_HEADERS",
        "ANTHROPIC_FOUNDRY_API_KEY",
        "ANTHROPIC_OAUTH_TOKEN",
        "AWS_CONFIG_FILE",
        "ANTHROPIC_SEARCH_API_KEY",
        "ANTHROPIC_SEARCH_BASE_URL",
        "AWS_ACCESS_KEY_ID",
        "AWS_BEARER_TOKEN_BEDROCK",
        "AWS_CONTAINER_AUTHORIZATION_TOKEN",
        "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
        "AWS_CONTAINER_CREDENTIALS_FULL_URI",
        "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
        "AWS_EC2_METADATA_DISABLED",
        "AWS_EC2_METADATA_SERVICE_ENDPOINT",
        "AWS_PROFILE",
        "AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE",
        "AWS_ROLE_ARN",
        "AWS_ROLE_SESSION_NAME",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "AWS_SHARED_CREDENTIALS_FILE",
        "AWS_WEB_IDENTITY_TOKEN_FILE",
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_API_VERSION",
        "AZURE_OPENAI_BASE_URL",
        "AZURE_OPENAI_DEPLOYMENT_NAME_MAP",
        "AZURE_OPENAI_ENDPOINT",
        "AZURE_OPENAI_RESOURCE_NAME",
        "BAILIAN_TOKEN_PLAN_API_KEY",
        "BASETEN_API_KEY",
        "BRAVE_API_KEY",
        "CEREBRAS_API_KEY",
        "CLAUDE_CODE_USE_FOUNDRY",
        "CLAUDE_CODE_CLIENT_CERT",
        "CLAUDE_CODE_CLIENT_KEY",
        "CLOUDFLARE_AI_GATEWAY_API_KEY",
        "COPILOT_GITHUB_TOKEN",
        "CLOUDSDK_CONFIG",
        "COREWEAVE_API_KEY",
        "CURSOR_ACCESS_TOKEN",
        "CURSOR_API_KEY",
        "DEEPSEEK_API_KEY",
        "DEVIN_API_KEY",
        "EXA_API_KEY",
        "FIRECRAWL_API_KEY",
        "FIREPASS_API_KEY",
        "FIREWORKS_API_KEY",
        "FUGU_BASE_URL",
        "FOUNDRY_BASE_URL",
        "FUGU_API_KEY",
        "GEMINI_API_KEY",
        "GITLAB_TOKEN",
        "GCLOUD_PROJECT",
        "GMI_API_KEY",
        "GOOGLE_API_KEY",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GOOGLE_CLOUD_ACCESS_TOKEN",
        "GOOGLE_CLOUD_API_KEY",
        "GOOGLE_CLOUD_LOCATION",
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_CLOUD_PROJECT_ID",
        "GOOGLE_VERTEX_LOCATION",
        "GCP_PROJECT",
        "GROQ_API_KEY",
        "HF_TOKEN",
        "HUGGINGFACE_HUB_TOKEN",
        "JINA_API_KEY",
        "KAGI_API_KEY",
        "KILO_API_KEY",
        "KIMI_API_KEY",
        "KIMI_CODE_BASE_URL",
        "KIMI_CODE_OAUTH_HOST",
        "KIMI_OAUTH_HOST",
        "KIMI_SEARCH_API_KEY",
        "LITELLM_API_KEY",
        "LITELLM_BASE_URL",
        "LLAMA_CPP_API_KEY",
        "LLAMA_CPP_BASE_URL",
        "LM_STUDIO_API_KEY",
        "LM_STUDIO_BASE_URL",
        "META_API_KEY",
        "MINIMAX_API_KEY",
        "MINIMAX_CODE_API_KEY",
        "MINIMAX_CODE_CN_API_KEY",
        "MISTRAL_API_KEY",
        "MODEL_API_KEY",
        "MOONSHOT_API_KEY",
        "MOONSHOT_BASE_URL",
        "MOONSHOT_SEARCH_API_KEY",
        "NANO_GPT_API_KEY",
        "NOVITA_API_KEY",
        "NVIDIA_API_KEY",
        "NODE_EXTRA_CA_CERTS",
        "OLLAMA_API_KEY",
        "OLLAMA_CLOUD_API_KEY",
        "OPENCODE_API_KEY",
        "OPENAI_API_KEY",
        "OLLAMA_BASE_URL",
        "OLLAMA_HOST",
        "OPENAI_BASE_URL",
        "OPENAI_CODEX_OAUTH_TOKEN",
        "OPENROUTER_API_KEY",
        "PARALLEL_API_KEY",
        "PERPLEXITY_API_KEY",
        "PERPLEXITY_COOKIES",
        "QIANFAN_API_KEY",
        "QWEN_OAUTH_TOKEN",
        "QWEN_PORTAL_API_KEY",
        "SAKANA_API_KEY",
        "SILICONFLOW_API_KEY",
        "SILICONFLOW_CN_API_KEY",
        "SYNTHETIC_API_KEY",
        "TAVILY_API_KEY",
        "TINYFISH_API_KEY",
        "TOGETHER_API_KEY",
        "UMANS_AI_CODING_PLAN_API_KEY",
        "SAKANA_BASE_URL",
        "VENICE_API_KEY",
        "VERCEL_AI_GATEWAY_API_KEY",
        "VLLM_API_KEY",
        "WAFER_SERVERLESS_API_KEY",
        "WANDB_API_KEY",
        "XAI_API_KEY",
        "UMANS_WEBSEARCH_PROVIDER",
        "XAI_OAUTH_TOKEN",
        "XIAOMI_API_KEY",
        "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
        "XIAOMI_TOKEN_PLAN_CN_API_KEY",
        "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
        "ZAI_API_KEY",
        "ZENMUX_API_KEY",
        "VERTEX_LOCATION",
        "ZHIPU_API_KEY",
    }
)

OMP_AMBIENT_CREDENTIAL_SUFFIXES = (
    "_API_KEY",
    "_ACCESS_TOKEN",
    "_OAUTH_TOKEN",
    "_BEARER_TOKEN",
    "_HUB_TOKEN",
    "_SECRET_ACCESS_KEY",
    "_SESSION_TOKEN",
)

def _is_ambient_credential_name(name: str) -> bool:
    """Return whether an inherited variable can directly carry provider credentials."""

    return name.endswith(OMP_AMBIENT_CREDENTIAL_SUFFIXES)

FORBIDDEN_CLIENT_ARGUMENTS = {
    # Every flag here can reopen a gate the adapter closed: a different
    # settings source, capability source or system prompt. Verified to exist
    # against Claude Code 2.1.236; see the Claude adapter change package.
    "claude": frozenset(
        {
            "--add-dir",
            "--agent",
            "--agents",
            "--allow-dangerously-skip-permissions",
            "--allowedTools",
            "--allowed-tools",
            "--append-system-prompt",
            "--bare",
            "--dangerously-skip-permissions",
            "--disallowedTools",
            "--disallowed-tools",
            "--mcp-config",
            "--permission-mode",
            "--plugin-dir",
            "--plugin-url",
            "--safe-mode",
            "--setting-sources",
            "--settings",
            "--strict-mcp-config",
            "--system-prompt",
            "--system-prompt-file",
            "--tools",
        }
    ),
    "codex": frozenset(
        {"-c", "-C", "-p", "--add-dir", "--cd", "--config", "--profile"}
    ),
    "qoder": frozenset(
        {
            "-w",
            "--add-dir",
            "--allowed-mcp-server-names",
            "--append-system-prompt",
            "--config-dir",
            "--mcp-config",
            "--plugin-dir",
            "--settings",
            "--strict-mcp-config",
            "--system-prompt",
            "--cwd",
            "--worktree",
        }
    ),
    "omp": frozenset(
        {
            "--add-dir",
            "-e",
            "--append-system-prompt",
            "--config",
            "--extension",
            "--cwd",
            "--from-claude",
            "--from-codex",
            "--hook",
            "--no-skills",
            "--plugin-dir",
            "--trusted-extension",
            "--profile",
            "--skills",
            "--system-prompt",
        }
    ),
}

FORBIDDEN_CLIENT_ARGUMENT_PREFIXES = {
    "codex": ("-c", "-C", "-p"),
    "qoder": ("-w",),
    "omp": ("-e",),
    "claude": (),
}

OBSERVATION_DIMENSIONS = ("skills", "mcps", "context", "hooks", "plugins")

REPORT_MARKERS = {
    "skills": "SKILLS-AVAILABLE",
    "mcps": "MCP-AVAILABLE",
    "context": "CONTEXT-FILES",
    "hooks": "HOOKS-AVAILABLE",
    "plugins": "PLUGINS-AVAILABLE",
}

SECRET_KEY_PATTERN = re.compile(
    r"(?:api[-_]?key|auth|bearer|cookie|credential|password|private[-_]?key|secret|token)",
    re.IGNORECASE,
)

SECRET_LINE_PATTERN = re.compile(
    r"(?im)^(\s*[\"']?[^:=\n]*(?:api[-_]?key|auth|bearer|cookie|credential|"
    r"password|private[-_]?key|secret|token)[^:=\n]*[\"']?\s*[:=]\s*).*$"
)

REAL_HOME_CONFIG_KEYS: Mapping[str, set[str]] = {
    ".claude.json": {"enabledPlugins", "hooks", "mcpServers", "plugins", "skills"},
    ".gemini/settings.json": {
        "extensions",
        "hooks",
        "mcpServers",
        "plugins",
        "skills",
    },
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

def _client_adapter_version(client: str) -> int:
    # Deferred, module-qualified: see the matching comment in lock.py. This
    # module is the lowest in the package's dependency order, so the import
    # of `cli` (the highest) must stay inside the function to avoid a
    # circular import at load time.
    import agent_system.profile.cli as _cli

    try:
        return _cli.CLIENT_ADAPTER_VERSION[client]
    except KeyError as error:
        raise ProfileError(f"client {client} has no adapter version") from error
