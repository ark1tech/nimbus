import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NimbusRuntimeManager } from "../../src/server/mcp/runtime-manager";

describe("Nimbus installed runtime", () => {
  it("opens a Work Item and persists its canonical Markdown", async (): Promise<void> => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "nimbus-runtime-"));
    const openedUrls: string[] = [];
    const manager = new NimbusRuntimeManager({
      pluginRoot: process.cwd(),
      host: "127.0.0.1",
      port: 0,
      launchBrowser: async (url: string): Promise<void> => {
        openedUrls.push(url);
      },
    });

    try {
      const result = await manager.openWorkItem({
        projectRoot,
        workItemId: "TEST-001",
        title: "Test the installed Nimbus plugin",
        source: null,
        brief: {
          problem: "The installed plugin must create durable Work Items.",
          goal: "Open a browser-backed Work Item from the bundled MCP server.",
          scope: ["Plugin runtime"],
          constraints: ["Markdown is canonical"],
          acceptanceCriteria: ["The Work Item file is readable"],
        },
      });
      const markdown = await readFile(
        path.join(projectRoot, "docs", "nimbus", "TEST-001.md"),
        "utf8",
      );

      expect(result).toMatchObject({ workItemId: "TEST-001" });
      expect(markdown).toContain("id: TEST-001");
      expect(markdown).toContain("# Brief");
      expect(openedUrls).toHaveLength(1);
      const openedUrlText = openedUrls[0];
      if (openedUrlText === undefined)
        throw new Error("Nimbus did not launch its Work Item browser URL.");
      const openedUrl = new URL(openedUrlText);
      expect(openedUrl.port).not.toBe("0");
      const token = openedUrl.searchParams.get("token");
      if (token === null)
        throw new Error("Nimbus Work Item browser URL is missing its token.");
      const response = await fetch(new URL("/api/work-item", openedUrl), {
        headers: {
          "X-Nimbus-Token": token,
        },
      });
      expect(response.status).toBe(200);
      const state = (await response.json()) as {
        workItem?: { id?: unknown };
      };
      expect(state.workItem?.id).toBe("TEST-001");
    } finally {
      await manager.close();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
