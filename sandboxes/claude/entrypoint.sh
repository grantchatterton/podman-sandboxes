#!/usr/bin/env bash
set -euo pipefail

declare -a claude_run_args=()

if [[ -f "${CLAUDE_APPEND_SYSTEM_PROMPT_FILE:-}" ]]; then
  claude_run_args+=(--append-system-prompt-file "$CLAUDE_APPEND_SYSTEM_PROMPT_FILE")
fi

exec claude "${claude_run_args[@]}" "$@"
