#!/bin/sh
# Pin the verified official artifact by content hash; no global proxy changes.
set -eu
task_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
task_dir="$task_root/.reuse-eval/cache/qmd/models"
task_file="$task_dir/hf_Qwen_Qwen3-Embedding-0.6B-Q8_0.gguf"
task_hash=06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439
verify_model() {
  python3 - "$1" "$task_hash" <<'PY'
import hashlib, sys
from pathlib import Path
p = Path(sys.argv[1])
assert p.stat().st_size == 639150592, 'Unexpected model size'
h = hashlib.sha256()
with p.open('rb') as f:
    assert f.read(4) == b'GGUF', 'Not a GGUF model'
    f.seek(0)
    for block in iter(lambda: f.read(1024 * 1024), b''):
        h.update(block)
assert h.hexdigest() == sys.argv[2], 'Official artifact SHA-256 mismatch'
print('Verified official Qwen embedding model: ' + h.hexdigest())
PY
}
if [ -f "$task_file" ]; then
  verify_model "$task_file"
  exit 0
fi
mkdir -p "$task_dir"
task_temp=$(mktemp "$task_dir/download.XXXXXX")
trap 'rm -f "$task_temp"' EXIT HUP INT TERM
task_url=https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf
if [ -n "${CARDDESK_MODEL_PROXY:-}" ]; then
  curl --fail -L --retry 2 --connect-timeout 15 --max-time 1200 --proxy "$CARDDESK_MODEL_PROXY" "$task_url" -o "$task_temp"
else
  curl --fail -L --retry 2 --connect-timeout 15 --max-time 1200 "$task_url" -o "$task_temp"
fi
verify_model "$task_temp"
mv "$task_temp" "$task_file"
