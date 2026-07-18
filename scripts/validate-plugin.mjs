import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const requiredFiles = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "skills/nimbus-work-item/SKILL.md",
  "scripts/nimbus-mcp.sh",
  "dist/server/mcp/index.mjs",
  "src/server/mcp/index.ts",
];

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

for (const file of requiredFiles) {
  await access(resolve(root, file));
}

const plugin = await readJson(".codex-plugin/plugin.json");
const mcp = await readJson(".mcp.json");
const launcher = await readFile(resolve(root, "scripts/nimbus-mcp.sh"), "utf8");

if (plugin.name !== "nimbus") {
  throw new Error("Plugin manifest must use the name 'nimbus'.");
}

if (plugin.skills !== "./skills/" || plugin.mcpServers !== "./.mcp.json") {
  throw new Error(
    "Plugin manifest must reference the bundled skills and MCP config.",
  );
}

if (mcp.mcpServers?.nimbus?.command !== "./scripts/nimbus-mcp.sh") {
  throw new Error("MCP config must launch the bundled Nimbus MCP script.");
}

if (!launcher.includes('exec node "$plugin_root/dist/server/mcp/index.mjs"')) {
  throw new Error(
    "Nimbus MCP launcher must execute the self-contained production bundle with Node.js.",
  );
}

if (launcher.includes("node_modules")) {
  throw new Error(
    "Nimbus MCP launcher must not depend on node_modules in the installed plugin cache.",
  );
}

process.stdout.write("Nimbus plugin packaging is valid.\n");
