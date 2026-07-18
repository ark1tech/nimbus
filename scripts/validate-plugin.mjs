import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const requiredFiles = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "skills/nimbus-work-item/SKILL.md",
  "assets/nimbus_logo.png",
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
const nimbusSkill = await readFile(
  resolve(root, "skills/nimbus-work-item/SKILL.md"),
  "utf8",
);

if (plugin.name !== "nimbus") {
  throw new Error("Plugin manifest must use the name 'nimbus'.");
}

if (plugin.skills !== "./skills/" || plugin.mcpServers !== "./.mcp.json") {
  throw new Error(
    "Plugin manifest must reference the bundled skills and MCP config.",
  );
}

if (
  !nimbusSkill.includes("attaches the Nimbus plugin") ||
  !nimbusSkill.includes("Nimbus owns the workflow") ||
  !nimbusSkill.includes("Do not invoke generic workflow skills")
) {
  throw new Error(
    "Nimbus skill must activate from plugin attachment and take precedence over generic workflow skills.",
  );
}

const pluginInterface = plugin.interface;
if (
  pluginInterface?.logo !== "./assets/nimbus_logo.png" ||
  pluginInterface?.composerIcon !== "./assets/nimbus_logo.png"
) {
  throw new Error(
    "Plugin presentation must use the bundled Nimbus logo for the detail page and composer.",
  );
}

if (!/^#[0-9A-F]{6}$/i.test(pluginInterface.brandColor)) {
  throw new Error("Plugin presentation must define a hexadecimal brand color.");
}

if (
  !Array.isArray(pluginInterface.defaultPrompt) ||
  pluginInterface.defaultPrompt.length !== 3
) {
  throw new Error("Plugin presentation must define exactly three starter prompts.");
}

for (const prompt of pluginInterface.defaultPrompt) {
  if (
    typeof prompt !== "string" ||
    prompt.trim().length === 0 ||
    prompt.length > 128 ||
    !prompt.startsWith("$nimbus ")
  ) {
    throw new Error(
      "Every starter prompt must explicitly invoke $nimbus and contain at most 128 characters.",
    );
  }
}

if (
  !Array.isArray(pluginInterface.screenshots) ||
  pluginInterface.screenshots.length !== 0
) {
  throw new Error(
    "Nimbus must use the generated prompt presentation without custom screenshots.",
  );
}

if (mcp.mcpServers?.nimbus?.command !== "./scripts/nimbus-mcp.sh") {
  throw new Error("MCP config must launch the bundled Nimbus MCP script.");
}

if (
  !launcher.includes("CODEX_CLI_PATH") ||
  !launcher.includes("cua_node/bin/node") ||
  !launcher.includes(
    "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node",
  ) ||
  !launcher.includes(
    'exec "$node_binary" "$plugin_root/dist/server/mcp/index.mjs"',
  )
) {
  throw new Error(
    "Nimbus MCP launcher must execute the production bundle with shell Node.js or Codex's bundled runtime.",
  );
}

if (launcher.includes("node_modules")) {
  throw new Error(
    "Nimbus MCP launcher must not depend on node_modules in the installed plugin cache.",
  );
}

process.stdout.write("Nimbus plugin packaging is valid.\n");
