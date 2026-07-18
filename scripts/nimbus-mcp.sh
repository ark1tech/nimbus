#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
plugin_root=$(CDPATH= cd -- "$script_dir/.." && pwd)

exec "$plugin_root/node_modules/.bin/tsx" "$plugin_root/src/server/mcp/index.ts"
