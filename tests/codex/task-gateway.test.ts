import { describe, expect, it } from "vitest";

import {
  CodexTaskGateway,
  createCodexTaskUrl,
  serializeBoundedContextPacket,
  type BoundedContextPacket,
  type CodexTaskGatewayConfig,
} from "../../src/server/codex/task-gateway";
import type { JsonRpcOutbound, JsonValue } from "../../src/server/codex/protocol";
import {
  createCodexAppServerCommandArguments,
  type CodexTransportFactory,
} from "../../src/server/codex/transport";
import {
  createFakeCodexTransport,
  type FakeCodexTransport,
} from "./fake-transport";

const config: CodexTaskGatewayConfig = {
  executablePath: "codex",
  repositoryCwd: "/workspace/nimbus",
  clientName: "nimbus",
  clientVersion: "0.1.0",
  startupTimeoutMs: 100,
  requestTimeoutMs: 100,
  runningApp: { socketPath: "/tmp/codex.sock" },
};

const grillContext: BoundedContextPacket = {
  workItemId: "NIM-001",
  taskKind: "grill",
  summary: "Choose the session storage boundary.",
  facts: ["The app needs revocation."],
  artifactReferences: ["D-01"],
  instructions: "Ask one consequential question at a time.",
};

function requestId(message: JsonRpcOutbound): number {
  if (!("id" in message) || typeof message.id !== "number") {
    throw new Error("Expected JSON-RPC request with a numeric id.");
  }
  return message.id;
}

function isRequest(message: JsonRpcOutbound, method: string): boolean {
  return "method" in message && message.method === method && "id" in message;
}

function createGateway(transport: FakeCodexTransport): CodexTaskGateway {
  const factory: CodexTransportFactory = () => transport;
  return new CodexTaskGateway(config, factory);
}

function modelPage(nextCursor: string | null): Record<string, JsonValue> {
  return {
    data: [
      {
        id: "model-gpt-5-6-terra",
        model: "gpt-5.6-terra",
        displayName: "Terra",
        description: "Balanced coding model.",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "Balanced" },
          { reasoningEffort: "high", description: "Deep" },
        ],
        defaultReasoningEffort: "medium",
        isDefault: true,
      },
    ],
    nextCursor,
  };
}

describe("CodexTaskGateway", () => {
  it("uses the running desktop app proxy rather than starting an isolated app-server", () => {
    expect(
      createCodexAppServerCommandArguments({ socketPath: "/tmp/codex.sock" }),
    ).toEqual(["app-server", "proxy", "--sock", "/tmp/codex.sock"]);
  });

  it("starts a model-confirmed phase task through the running app and sends only its bounded packet", async () => {
    const transport = createFakeCodexTransport({
      onSend(message, fake): void {
        if (isRequest(message, "initialize")) {
          fake.emit({ id: requestId(message), result: {} });
          return;
        }
        if (isRequest(message, "model/list")) {
          fake.emit({ id: requestId(message), result: modelPage(null) });
          return;
        }
        if (isRequest(message, "thread/start")) {
          fake.emit({
            id: requestId(message),
            result: { thread: { id: "grill-task" }, model: "gpt-5.6-terra" },
          });
          return;
        }
        if (isRequest(message, "thread/name/set")) {
          fake.emit({ id: requestId(message), result: {} });
          return;
        }
        if (isRequest(message, "turn/start")) {
          fake.emit({
            id: requestId(message),
            result: { turn: { id: "turn-1" } },
          });
        }
      },
    });
    const gateway = createGateway(transport);

    await gateway.start();
    const task = await gateway.startTask({
      taskKind: "grill",
      title: "NIM-001 - Grill",
      model: "gpt-5.6-terra",
      context: grillContext,
    });

    expect(task).toEqual({
      threadId: "grill-task",
      model: "gpt-5.6-terra",
      title: "NIM-001 - Grill",
      navigationUrl: "codex://threads/grill-task",
      turnId: "turn-1",
    });
    expect(transport.sent).toEqual([
      {
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "nimbus", version: "0.1.0" } },
      },
      { method: "initialized", params: {} },
      { id: 2, method: "model/list", params: {} },
      {
        id: 3,
        method: "thread/start",
        params: {
          model: "gpt-5.6-terra",
          cwd: "/workspace/nimbus",
          allowProviderModelFallback: false,
        },
      },
      {
        id: 4,
        method: "thread/name/set",
        params: { threadId: "grill-task", name: "NIM-001 - Grill" },
      },
      {
        id: 5,
        method: "turn/start",
        params: {
          threadId: "grill-task",
          input: [
            {
              type: "text",
              text: serializeBoundedContextPacket(grillContext),
              text_elements: [],
            },
          ],
        },
      },
    ]);
  });

  it("forks an Investigation from the latest completed turn and rejects model rerouting", async () => {
    const transport = createFakeCodexTransport({
      onSend(message, fake): void {
        if (isRequest(message, "initialize")) {
          fake.emit({ id: requestId(message), result: {} });
          return;
        }
        if (isRequest(message, "model/list")) {
          fake.emit({ id: requestId(message), result: modelPage(null) });
          return;
        }
        if (isRequest(message, "thread/fork")) {
          fake.emit({
            id: requestId(message),
            result: {
              thread: { id: "investigation-task" },
              model: "gpt-5.6-terra",
            },
          });
          return;
        }
        if (isRequest(message, "thread/name/set")) {
          fake.emit({ id: requestId(message), result: {} });
          return;
        }
        if (isRequest(message, "turn/start")) {
          fake.emit({
            id: requestId(message),
            result: { turn: { id: "turn-2" } },
          });
        }
      },
    });
    const gateway = createGateway(transport);
    const investigationContext: BoundedContextPacket = {
      ...grillContext,
      taskKind: "investigation",
      artifactReferences: ["D-01/A"],
      instructions:
        "Interrogate the trade-off without changing the Grill task.",
    };

    await gateway.start();
    const task = await gateway.forkInvestigation({
      title: "NIM-001 - Investigate D-01",
      model: "gpt-5.6-terra",
      owningThreadId: "grill-task",
      latestCompletedTurnId: "turn-complete",
      context: investigationContext,
    });

    expect(task.threadId).toBe("investigation-task");
    expect(transport.sent[3]).toEqual({
      id: 3,
      method: "thread/fork",
      params: {
        threadId: "grill-task",
        lastTurnId: "turn-complete",
        model: "gpt-5.6-terra",
        cwd: "/workspace/nimbus",
        excludeTurns: true,
        deferGoalContinuation: true,
      },
    });
  });

  it("fails before task creation when the browser-selected model is unavailable", async () => {
    const transport = createFakeCodexTransport({
      onSend(message, fake): void {
        if (isRequest(message, "initialize")) {
          fake.emit({ id: requestId(message), result: {} });
          return;
        }
        if (isRequest(message, "model/list")) {
          fake.emit({ id: requestId(message), result: modelPage(null) });
        }
      },
    });
    const gateway = createGateway(transport);

    await gateway.start();
    await expect(
      gateway.startTask({
        taskKind: "grill",
        title: "NIM-001 - Grill",
        model: "missing-model",
        context: grillContext,
      }),
    ).rejects.toThrow("missing-model is not available");
    expect(
      transport.sent.map((message) =>
        "method" in message ? message.method : "response",
      ),
    ).toEqual(["initialize", "initialized", "model/list"]);
  });

  it("resumes existing tasks without model confirmation and exposes a Codex navigation URL", async () => {
    const transport = createFakeCodexTransport({
      onSend(message, fake): void {
        if (isRequest(message, "initialize")) {
          fake.emit({ id: requestId(message), result: {} });
          return;
        }
        if (isRequest(message, "thread/resume")) {
          fake.emit({
            id: requestId(message),
            result: {
              thread: {
                id: "implementation-task",
                name: "NIM-001 - Implement",
              },
              model: "gpt-5.6-terra",
            },
          });
        }
      },
    });
    const gateway = createGateway(transport);

    await gateway.start();
    await expect(
      gateway.resumeTask({ threadId: "implementation-task" }),
    ).resolves.toEqual({
      threadId: "implementation-task",
      model: "gpt-5.6-terra",
      title: "NIM-001 - Implement",
      navigationUrl: "codex://threads/implementation-task",
    });
    expect(gateway.navigationFor("implementation-task")).toBe(
      "codex://threads/implementation-task",
    );
  });

  it("rejects unsafe task ids instead of producing another navigation target", () => {
    expect(() => createCodexTaskUrl("task id")).toThrow(
      "must be a non-empty Codex task id",
    );
  });
});
