import { describe, expect, it } from "vitest";

import {
  CodexDecisionChatConnector,
  type CodexDecisionChatConfig,
} from "../../src/server/codex/decision-chat";
import type { JsonRpcOutbound } from "../../src/server/codex/protocol";
import type { CodexTransportFactory } from "../../src/server/codex/transport";
import {
  createFakeCodexTransport,
  type FakeCodexTransport,
} from "./fake-transport";

const config: CodexDecisionChatConfig = {
  executablePath: "codex",
  repositoryCwd: "/workspace/nimbus",
  model: "gpt-5.6",
  clientName: "nimbus",
  clientVersion: "0.1.0",
  startupTimeoutMs: 100,
  requestTimeoutMs: 100,
  turnTimeoutMs: 100,
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

function createConnector(
  transport: FakeCodexTransport,
): CodexDecisionChatConnector {
  const factory: CodexTransportFactory = () => transport;
  return new CodexDecisionChatConnector(config, factory);
}

describe("CodexDecisionChatConnector", () => {
  it("initializes a read-only decision room and streams a completed answer", async () => {
    const deltas: string[] = [];
    const transport = createFakeCodexTransport({
      onSend(message, fake): void {
        if (isRequest(message, "initialize")) {
          fake.emit({
            id: requestId(message),
            result: { serverInfo: { name: "codex" } },
          });
          return;
        }
        if (isRequest(message, "thread/start")) {
          fake.emit({
            id: requestId(message),
            result: { thread: { id: "decision-auth" } },
          });
          return;
        }
        if (isRequest(message, "turn/start")) {
          fake.emit({
            id: requestId(message),
            result: { turn: { id: "turn-1" } },
          });
          queueMicrotask((): void => {
            fake.emit({
              method: "item/agentMessage/delta",
              params: { turnId: "turn-1", delta: "Use sessions " },
            });
            fake.emit({
              method: "item/agentMessage/delta",
              params: { turnId: "turn-1", delta: "for revocation." },
            });
            fake.emit({
              method: "turn/completed",
              params: { turn: { id: "turn-1", status: "completed" } },
            });
          });
        }
      },
    });
    const connector = createConnector(transport);

    await connector.start();
    const answer = await connector.askDecisionRoom({
      threadId: null,
      prompt: "Which authentication strategy fits this project?",
      onDelta: (delta: string): void => {
        deltas.push(delta);
      },
    });

    expect(answer).toEqual({
      threadId: "decision-auth",
      answer: "Use sessions for revocation.",
    });
    expect(deltas).toEqual(["Use sessions ", "for revocation."]);
    expect(transport.startCalls).toBe(1);
    expect(transport.sent).toEqual([
      {
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "nimbus", version: "0.1.0" },
        },
      },
      { method: "initialized", params: {} },
      {
        id: 2,
        method: "thread/start",
        params: {
          model: "gpt-5.6",
          cwd: "/workspace/nimbus",
          sandbox: "read-only",
        },
      },
      {
        id: 3,
        method: "turn/start",
        params: {
          threadId: "decision-auth",
          input: [
            {
              type: "text",
              text: "Which authentication strategy fits this project?",
              text_elements: [],
            },
          ],
        },
      },
    ]);
  });

  it("resumes an existing decision room before its next turn", async () => {
    const transport = createFakeCodexTransport({
      onSend(message, fake): void {
        if (
          isRequest(message, "initialize") ||
          isRequest(message, "thread/resume")
        ) {
          fake.emit({ id: requestId(message), result: {} });
          return;
        }
        if (isRequest(message, "turn/start")) {
          fake.emit({
            id: requestId(message),
            result: { turn: { id: "turn-2" } },
          });
          queueMicrotask((): void => {
            fake.emit({
              method: "item/agentMessage/delta",
              params: {
                turnId: "turn-2",
                delta: "The trade-off is migration cost.",
              },
            });
            fake.emit({
              method: "turn/completed",
              params: { turn: { id: "turn-2", status: "completed" } },
            });
          });
        }
      },
    });
    const connector = createConnector(transport);

    await connector.start();
    const answer = await connector.askDecisionRoom({
      threadId: "decision-auth",
      prompt: "Why not the recommended alternative?",
      onDelta: undefined,
    });

    expect(answer).toEqual({
      threadId: "decision-auth",
      answer: "The trade-off is migration cost.",
    });
    expect(
      transport.sent.map((message) =>
        "method" in message ? message.method : "response",
      ),
    ).toEqual(["initialize", "initialized", "thread/resume", "turn/start"]);
    expect(transport.sent[2]).toEqual({
      id: 2,
      method: "thread/resume",
      params: { threadId: "decision-auth" },
    });
  });

  it("rejects a decision-room turn when Codex reports a failed completion", async () => {
    const transport = createFakeCodexTransport({
      onSend(message, fake): void {
        if (isRequest(message, "initialize")) {
          fake.emit({ id: requestId(message), result: {} });
          return;
        }
        if (isRequest(message, "thread/start")) {
          fake.emit({
            id: requestId(message),
            result: { thread: { id: "decision-auth" } },
          });
          return;
        }
        if (isRequest(message, "turn/start")) {
          fake.emit({
            id: requestId(message),
            result: { turn: { id: "turn-3" } },
          });
          queueMicrotask((): void => {
            fake.emit({
              method: "turn/completed",
              params: { turn: { id: "turn-3", status: "failed" } },
            });
          });
        }
      },
    });
    const connector = createConnector(transport);

    await connector.start();
    await expect(
      connector.askDecisionRoom({
        threadId: null,
        prompt: "Explain the risk.",
        onDelta: undefined,
      }),
    ).rejects.toThrow("ended with status failed");
  });

  it("closes the app-server transport after a decision chat", async () => {
    const transport = createFakeCodexTransport({
      onSend(message, fake): void {
        if (isRequest(message, "initialize")) {
          fake.emit({ id: requestId(message), result: {} });
        }
      },
    });
    const connector = createConnector(transport);

    await connector.start();
    await connector.close();

    expect(transport.closeCalls).toBe(1);
  });
});
