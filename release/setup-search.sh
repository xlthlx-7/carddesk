#!/bin/sh
# Install only this extracted tool bundle; never change global Node/npm settings.
set -eu
carddesk_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
carddesk_node=${CARDDESK_NODE:-node}
"$carddesk_node" -e 'if(Number(process.versions.node.split(".")[0])<22){console.error("需要 Node 22+；可设置 CARDDESK_NODE 为其绝对路径");process.exit(1)}'
carddesk_node_dir=$("$carddesk_node" -p 'require("node:path").dirname(process.execPath)')
PATH="$carddesk_node_dir:$PATH"
export PATH
carddesk_npm=$(command -v npm)
carddesk_deps="$carddesk_root/.reuse-eval/qmd"
mkdir -p "$carddesk_deps"
cp "$carddesk_root/reuse-eval/qmd-dependency/package.json" "$carddesk_deps/package.json"
cp "$carddesk_root/reuse-eval/qmd-dependency/package-lock.json" "$carddesk_deps/package-lock.json"
"$carddesk_node" "$carddesk_npm" ci --prefix "$carddesk_deps" --cache "${CARDDESK_NPM_CACHE:-$carddesk_root/.reuse-eval/npm-cache}" --no-audit --no-fund
"$carddesk_node" --input-type=module -e 'const fs=await import("node:fs/promises"); const p=JSON.parse(await fs.readFile(process.argv[1],"utf8"));if(p.version!=="2.9.0")throw Error("QMD version mismatch");console.log("QMD 2.9.0 已安装；模型需另行准备，未初始化或修改任何 Vault。")' "$carddesk_deps/node_modules/@tobilu/qmd/package.json"
