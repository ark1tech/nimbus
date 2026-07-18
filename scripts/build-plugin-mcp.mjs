import { build } from "esbuild";

await build({
  entryPoints: ["src/server/mcp/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/server/mcp/index.mjs",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
