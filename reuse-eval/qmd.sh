#!/bin/sh
# Isolated evaluation only; no global collections, daemon, or remote inference.
set -eu
task_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export QMD_CONFIG_DIR="$task_root/.reuse-eval/config"
export XDG_CACHE_HOME="$task_root/.reuse-eval/cache"
export QMD_EMBED_MODEL="hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf"
task_node=${CARDDESK_QMD_NODE:-/usr/local/bin/node}
exec "$task_node" "$task_root/.reuse-eval/qmd/node_modules/@tobilu/qmd/bin/qmd" "$@"
