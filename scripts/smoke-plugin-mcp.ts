import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const expectedTools: string[] = [
  "open_work_item",
  "present_decision",
  "present_plan",
  "begin_plan_item",
  "report_implementation_item",
  "present_review",
  "publish_investigation_conclusion",
  "present_handoff",
  "record_handoff_site",
];

async function assertTools(
  environment: Record<string, string> | undefined,
): Promise<number> {
  const transport = new StdioClientTransport({
    command: "sh",
    args: ["scripts/nimbus-mcp.sh"],
    cwd: process.cwd(),
    ...(environment === undefined ? {} : { env: environment }),
    stderr: "pipe",
  });
  const client = new Client({ name: "nimbus-plugin-smoke", version: "0.1.0" });
  let serverStderr = "";
  transport.stderr?.on("data", (chunk: Buffer): void => {
    serverStderr += chunk.toString("utf8");
  });

  try {
    try {
      await client.connect(transport);
    } catch (error: unknown) {
      throw new Error(
        `Nimbus MCP bundle closed during initialization. Server stderr: ${serverStderr.trim() || "<empty>"}`,
        { cause: error },
      );
    }
    const response = await client.listTools();
    const actualTools: string[] = response.tools
      .map((tool) => tool.name)
      .sort();
    const missingTools: string[] = expectedTools.filter(
      (tool) => !actualTools.includes(tool),
    );

    if (missingTools.length > 0) {
      throw new Error(
        `Nimbus MCP bundle is missing tools: ${missingTools.join(", ")}. Advertised tools: ${actualTools.join(", ")}.`,
      );
    }

    const openWorkItemTool = response.tools.find(
      (tool) => tool.name === "open_work_item",
    );
    const presentDecisionTool = response.tools.find(
      (tool) => tool.name === "present_decision",
    );
    if (!JSON.stringify(openWorkItemTool).includes("DEMO-001")) {
      throw new Error(
        "open_work_item must advertise an explicit stable Work Item ID example.",
      );
    }
    if (!JSON.stringify(presentDecisionTool).includes("D-01/A")) {
      throw new Error(
        "present_decision must advertise the complete immutable Decision Option ID format.",
      );
    }

    return actualTools.length;
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const defaultToolCount = await assertTools(undefined);
  const restrictedToolCount = await assertTools({
    HOME: process.env.HOME ?? "/Users/ray",
    PATH: "/usr/bin:/bin",
    CODEX_CLI_PATH: "/Applications/ChatGPT.app/Contents/Resources/codex",
  });
  const bundledToolCount = await assertTools({
    HOME: process.env.HOME ?? "/Users/ray",
    PATH: "/usr/bin:/bin",
  });
  process.stdout.write(
    `Nimbus bundled MCP smoke passed with ${defaultToolCount} shell tools, ${restrictedToolCount} configured Codex tools, and ${bundledToolCount} bundled-runtime tools.\n`,
  );
}

void main().catch((error: unknown): void => {
  process.stderr.write(
    `Nimbus bundled MCP smoke failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
