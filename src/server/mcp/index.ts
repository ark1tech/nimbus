import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { NimbusMcpAdapter } from "./contracts";
import { createHttpNimbusMcpAdapter } from "./http-adapter";
import { createDefaultRuntimeManager } from "./runtime-manager";
import { registerNimbusTools } from "./tools";

export function createNimbusMcpServer(runtimeUrl: string): McpServer {
  const adapter = createHttpNimbusMcpAdapter({ baseUrl: runtimeUrl, fetch });

  return createNimbusMcpServerWithAdapter(adapter);
}

export function createNimbusMcpServerWithAdapter(
  adapter: NimbusMcpAdapter,
): McpServer {
  const server = new McpServer({ name: "nimbus", version: "0.1.0" });

  registerNimbusTools(server, adapter);
  return server;
}

async function main(): Promise<void> {
  const pluginRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const manager = createDefaultRuntimeManager(pluginRoot);
  const server = createNimbusMcpServerWithAdapter(manager);
  const transport = new StdioServerTransport();

  const close = async (): Promise<void> => {
    await manager.close();
    await server.close();
  };
  process.once("SIGINT", (): void => void close());
  process.once("SIGTERM", (): void => void close());
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`Nimbus MCP server failed to start: ${message}\n`);
  process.exitCode = 1;
});
