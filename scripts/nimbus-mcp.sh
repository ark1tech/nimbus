#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
plugin_root=$(CDPATH= cd -- "$script_dir/.." && pwd)

node_binary=""
if command -v node >/dev/null 2>&1; then
  node_binary=$(command -v node)
elif [ -n "${CODEX_CLI_PATH:-}" ]; then
  codex_resources=$(CDPATH= cd -- "$(dirname -- "$CODEX_CLI_PATH")" && pwd)
  node_binary="$codex_resources/cua_node/bin/node"
fi

if [ ! -x "$node_binary" ] && [ -x "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" ]; then
  node_binary="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
fi

if [ ! -x "$node_binary" ]; then
  echo "Nimbus MCP could not find Node.js. Install Node.js or launch Nimbus from the Codex desktop app." >&2
  exit 127
fi

exec "$node_binary" "$plugin_root/dist/server/mcp/index.mjs"
