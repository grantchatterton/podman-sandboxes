#!/usr/bin/env bash
set -euo pipefail

declare -a pi_run_args=()

if [[ -f "${PI_APPEND_SYSTEM_PROMPT_FILE:-}" ]]; then
  pi_run_args+=(--append-system-prompt "$PI_APPEND_SYSTEM_PROMPT_FILE")
fi

exec pi "${pi_run_args[@]}" "$@"
