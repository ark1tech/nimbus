import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const requiredFiles = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "skills/nimbus-work-item/SKILL.md",
  "scripts/nimbus-mcp.sh",
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

process.stdout.write("Nimbus plugin packaging is valid.\n");
