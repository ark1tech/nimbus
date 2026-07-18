#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
plugin_root=$(CDPATH= cd -- "$script_dir/.." && pwd)

exec node "$plugin_root/dist/server/mcp/index.mjs"
