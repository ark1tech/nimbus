import {
  CodexProcessError,
  CodexProtocolError,
  CodexRpcError,
  CodexTimeoutError,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  type JsonRpcId,
  type JsonRpcInbound,
  type JsonRpcNotification,
  type JsonRpcOutbound,
  type JsonValue,
} from "./protocol";
import {
  createCodexStdioTransport,
  type CodexAppServerTransport,
  type CodexTransportFactory,
} from "./transport";

export interface CodexDecisionChatConfig {
  executablePath: string;
  repositoryCwd: string;
  model: string;
  clientName: string;
  clientVersion: string;
  startupTimeoutMs: number;
  requestTimeoutMs: number;
  turnTimeoutMs: number;
}

export interface AskDecisionRoomInput {
  threadId: string | null;
  prompt: string;
  onDelta: ((delta: string) => void) | undefined;
}

export interface DecisionRoomAnswer {
  threadId: string;
  answer: string;
}

interface PendingRequest {
  method: string;
  resolve: (result: Record<string, JsonValue>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingTurn {
  threadId: string;
  turnId: string | null;
  answer: string;
  queuedNotifications: JsonRpcNotification[];
  onDelta: ((delta: string) => void) | undefined;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CodexDecisionChatConnector {
  private readonly config: CodexDecisionChatConfig;
  private readonly transportFactory: CodexTransportFactory;
  private transport: CodexAppServerTransport | null = null;
  private pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private pendingTurn: PendingTurn | null = null;
  private nextRequestId = 0;
  private started = false;
  private closed = false;
  private unsubscribeMessage: (() => void) | null = null;
  private unsubscribeExit: (() => void) | null = null;

  public constructor(
    config: CodexDecisionChatConfig,
    transportFactory: CodexTransportFactory,
  ) {
    this.config = config;
    this.transportFactory = transportFactory;
  }

  public async start(): Promise<void> {
    if (this.closed) {
      throw new CodexProcessError(
        "Cannot start a closed Codex decision-chat connector.",
      );
    }
    if (this.started) {
      return;
    }

    const transport = this.transportFactory({
      executablePath: this.config.executablePath,
      cwd: this.config.repositoryCwd,
      startupTimeoutMs: this.config.startupTimeoutMs,
      runningApp: undefined,
    });
    this.transport = transport;
    this.unsubscribeMessage = transport.onMessage(
      (message: JsonRpcInbound): void => {
        this.handleMessage(message);
      },
    );
    this.unsubscribeExit = transport.onExit(
      (error: CodexProcessError): void => {
        this.handleTransportExit(error);
      },
    );

    try {
      await transport.start();
      await this.request("initialize", {
        clientInfo: {
          name: this.config.clientName,
          version: this.config.clientVersion,
        },
      });
      this.send({ method: "initialized", params: {} });
      this.started = true;
    } catch (error: unknown) {
      await this.close();
      throw error;
    }
  }

  public async askDecisionRoom(
    input: AskDecisionRoomInput,
  ): Promise<DecisionRoomAnswer> {
    this.assertReady();
    if (this.pendingTurn !== null) {
      throw new CodexProcessError(
        "A Codex decision room turn is already in progress.",
      );
    }

    const threadId = await this.resolveDecisionRoom(input.threadId);
    const turnCompletion = this.waitForTurnCompletion(threadId, input.onDelta);
    let turnId: string;

    try {
      const result = await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text: input.prompt, text_elements: [] }],
      });
      turnId = this.readRequiredId(result, "turn", "turn/start");
    } catch (error: unknown) {
      this.rejectPendingTurn(error);
      throw error;
    }

    this.setPendingTurnId(turnId);
    const answer = await turnCompletion;
    return { threadId, answer };
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.started = false;

    const closeError = new CodexProcessError(
      "Codex decision-chat connector closed.",
    );
    this.rejectAll(closeError);
    this.unsubscribeMessage?.();
    this.unsubscribeExit?.();
    this.unsubscribeMessage = null;
    this.unsubscribeExit = null;

    const transport = this.transport;
    this.transport = null;
    if (transport !== null) {
      await transport.close();
    }
  }

  private async resolveDecisionRoom(threadId: string | null): Promise<string> {
    if (threadId === null) {
      const result = await this.request("thread/start", {
        model: this.config.model,
        cwd: this.config.repositoryCwd,
        sandbox: "read-only",
      });
      return this.readRequiredId(result, "thread", "thread/start");
    }

    await this.request("thread/resume", { threadId });
    return threadId;
  }

  private waitForTurnCompletion(
    threadId: string,
    onDelta: ((delta: string) => void) | undefined,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectPendingTurn(
          new CodexTimeoutError("turn/completed", this.config.turnTimeoutMs),
        );
      }, this.config.turnTimeoutMs);
      this.pendingTurn = {
        threadId,
        turnId: null,
        answer: "",
        queuedNotifications: [],
        onDelta,
        resolve,
        reject,
        timer,
      };
    });
  }

  private request(
    method: string,
    params: Record<string, JsonValue>,
  ): Promise<Record<string, JsonValue>> {
    const id = ++this.nextRequestId;

    return new Promise<Record<string, JsonValue>>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.delete(id)) {
          reject(new CodexTimeoutError(method, this.config.requestTimeoutMs));
        }
      }, this.config.requestTimeoutMs);
      this.pendingRequests.set(id, { method, resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  private send(message: JsonRpcOutbound): void {
    if (this.transport === null) {
      throw new CodexProcessError(
        "Codex decision-chat transport is unavailable.",
      );
    }
    this.transport.send(message);
  }

  private handleMessage(message: JsonRpcInbound): void {
    if (isJsonRpcResponse(message)) {
      const pending = this.pendingRequests.get(message.id);
      if (pending === undefined) {
        throw new CodexProtocolError(
          `Received an unexpected JSON-RPC response id ${message.id}.`,
        );
      }
      clearTimeout(pending.timer);
      this.pendingRequests.delete(message.id);
      if ("error" in message) {
        pending.reject(
          new CodexRpcError(
            message.error.message,
            message.error.code,
            message.error.data,
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (isJsonRpcRequest(message)) {
      this.send({
        id: message.id,
        error: {
          code: -32601,
          message: `Nimbus decision chat does not support server request ${message.method}.`,
        },
      });
      return;
    }

    if (isJsonRpcNotification(message)) {
      this.handleNotification(message);
    }
  }

  private handleNotification(message: {
    method: string;
    params: Record<string, JsonValue>;
  }): void {
    const pendingTurn = this.pendingTurn;
    if (pendingTurn === null) {
      return;
    }
    if (pendingTurn.turnId === null) {
      pendingTurn.queuedNotifications.push(message);
      return;
    }

    if (message.method === "item/agentMessage/delta") {
      const delta = message.params.delta;
      const eventTurnId = this.readOptionalString(
        message.params.turnId,
        "item/agentMessage/delta",
      );
      if (typeof delta !== "string") {
        this.rejectPendingTurn(
          new CodexProtocolError(
            "Codex agent-message delta did not contain a string delta.",
          ),
        );
        return;
      }
      if (this.matchesActiveTurn(pendingTurn, eventTurnId)) {
        pendingTurn.answer += delta;
        pendingTurn.onDelta?.(delta);
      }
      return;
    }

    if (message.method === "turn/completed") {
      const turn = message.params.turn;
      if (
        !this.isRecord(turn) ||
        typeof turn.id !== "string" ||
        typeof turn.status !== "string"
      ) {
        this.rejectPendingTurn(
          new CodexProtocolError(
            "Codex turn/completed did not contain a valid turn.",
          ),
        );
        return;
      }
      if (!this.matchesActiveTurn(pendingTurn, turn.id)) {
        return;
      }
      if (turn.status !== "completed") {
        this.rejectPendingTurn(
          new CodexProcessError(
            `Codex decision room turn ended with status ${turn.status}.`,
          ),
        );
        return;
      }
      this.resolvePendingTurn();
    }
  }

  private matchesActiveTurn(
    pendingTurn: PendingTurn,
    eventTurnId: string | undefined,
  ): boolean {
    return (
      eventTurnId === undefined ||
      pendingTurn.turnId === null ||
      pendingTurn.turnId === eventTurnId
    );
  }

  private resolvePendingTurn(): void {
    const pendingTurn = this.pendingTurn;
    if (pendingTurn === null) {
      return;
    }
    clearTimeout(pendingTurn.timer);
    this.pendingTurn = null;
    pendingTurn.resolve(pendingTurn.answer);
  }

  private rejectPendingTurn(error: unknown): void {
    const pendingTurn = this.pendingTurn;
    if (pendingTurn === null) {
      return;
    }
    clearTimeout(pendingTurn.timer);
    this.pendingTurn = null;
    pendingTurn.reject(
      error instanceof Error ? error : new CodexProcessError(String(error)),
    );
  }

  private handleTransportExit(error: CodexProcessError): void {
    this.started = false;
    this.rejectAll(error);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    this.rejectPendingTurn(error);
  }

  private readRequiredId(
    result: Record<string, JsonValue>,
    key: "thread" | "turn",
    method: string,
  ): string {
    const entity = result[key];
    if (
      !this.isRecord(entity) ||
      typeof entity.id !== "string" ||
      entity.id.length === 0
    ) {
      throw new CodexProtocolError(
        `Codex ${method} response did not include ${key}.id.`,
      );
    }
    return entity.id;
  }

  private readOptionalString(
    candidate: JsonValue | undefined,
    key: string,
  ): string | undefined {
    if (candidate === undefined) {
      return undefined;
    }
    if (typeof candidate !== "string") {
      throw new CodexProtocolError(
        `Codex notification field ${key} must be a string.`,
      );
    }
    return candidate;
  }

  private isRecord(value: unknown): value is Record<string, JsonValue> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private assertReady(): void {
    if (!this.started || this.transport === null || this.closed) {
      throw new CodexProcessError(
        "Start the Codex decision-chat connector before asking a decision room.",
      );
    }
  }

  private setPendingTurnId(turnId: string): void {
    const pendingTurn = this.pendingTurn;
    if (pendingTurn === null) {
      throw new CodexProtocolError(
        "Codex turn completed before turn/start acknowledged its id.",
      );
    }
    pendingTurn.turnId = turnId;
    const queuedNotifications = pendingTurn.queuedNotifications;
    pendingTurn.queuedNotifications = [];
    for (const notification of queuedNotifications) {
      this.handleNotification(notification);
    }
  }
}

export function createCodexDecisionChatConnector(
  config: CodexDecisionChatConfig,
): CodexDecisionChatConnector {
  return new CodexDecisionChatConnector(config, createCodexStdioTransport);
}
