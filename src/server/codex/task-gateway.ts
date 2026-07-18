import {
  CodexProcessError,
  CodexProtocolError,
  CodexRpcError,
  CodexTimeoutError,
  isJsonRpcRequest,
  isJsonRpcResponse,
  type JsonRpcId,
  type JsonRpcInbound,
  type JsonRpcOutbound,
  type JsonValue,
} from "./protocol";
import {
  createCodexStdioTransport,
  type CodexAppServerTransport,
  type CodexRunningAppConnection,
  type CodexTransportFactory,
} from "./transport";

const MAX_CONTEXT_PACKET_CHARACTERS = 24_000;

export type NimbusTaskKind =
  | "orchestrator"
  | "grill"
  | "plan"
  | "implement"
  | "review"
  | "investigation"
  | "publisher";

export interface CodexTaskGatewayConfig {
  executablePath: string;
  repositoryCwd: string;
  clientName: string;
  clientVersion: string;
  startupTimeoutMs: number;
  requestTimeoutMs: number;
  runningApp: CodexRunningAppConnection;
}

export interface CodexModel {
  id: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string;
  isDefault: boolean;
}

export interface BoundedContextPacket {
  workItemId: string;
  taskKind: NimbusTaskKind;
  summary: string;
  facts: string[];
  artifactReferences: string[];
  instructions: string;
}

export interface StartNimbusTaskInput {
  taskKind: Exclude<NimbusTaskKind, "investigation">;
  title: string;
  model: string;
  context: BoundedContextPacket;
}

export interface ForkInvestigationTaskInput {
  title: string;
  model: string;
  owningThreadId: string;
  latestCompletedTurnId: string;
  context: BoundedContextPacket;
}

export interface ResumeNimbusTaskInput {
  threadId: string;
}

export interface StartTaskTurnInput {
  threadId: string;
  prompt: string;
}

export interface CodexTask {
  threadId: string;
  model: string;
  title: string;
  navigationUrl: string;
}

export interface StartedNimbusTask extends CodexTask {
  turnId: string;
}

interface PendingRequest {
  method: string;
  resolve: (result: Record<string, JsonValue>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Typed boundary for visible Codex tasks. It deliberately uses app-server
 * proxy transport; a private app-server process would create invisible tasks.
 */
export class CodexTaskGateway {
  private readonly config: CodexTaskGatewayConfig;
  private readonly transportFactory: CodexTransportFactory;
  private transport: CodexAppServerTransport | null = null;
  private readonly pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private nextRequestId = 0;
  private started = false;
  private closed = false;
  private unsubscribeMessage: (() => void) | null = null;
  private unsubscribeExit: (() => void) | null = null;

  public constructor(
    config: CodexTaskGatewayConfig,
    transportFactory: CodexTransportFactory,
  ) {
    this.config = config;
    this.transportFactory = transportFactory;
  }

  public async start(): Promise<void> {
    if (this.closed) {
      throw new CodexProcessError("Cannot start a closed Codex task gateway.");
    }
    if (this.started) {
      return;
    }

    const transport = this.transportFactory({
      executablePath: this.config.executablePath,
      cwd: this.config.repositoryCwd,
      startupTimeoutMs: this.config.startupTimeoutMs,
      runningApp: this.config.runningApp,
    });
    this.transport = transport;
    this.unsubscribeMessage = transport.onMessage(
      (message: JsonRpcInbound): void => this.handleMessage(message),
    );
    this.unsubscribeExit = transport.onExit((error: CodexProcessError): void =>
      this.handleTransportExit(error),
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

  public async listModels(): Promise<CodexModel[]> {
    this.assertReady();
    const models: CodexModel[] = [];
    let cursor: string | null = null;

    do {
      const result = await this.request("model/list", {
        ...(cursor === null ? {} : { cursor }),
      });
      const page = this.readModelPage(result);
      models.push(...page.models);
      cursor = page.nextCursor;
    } while (cursor !== null);

    if (models.length === 0) {
      throw new CodexProtocolError(
        "Codex model/list returned no selectable models.",
      );
    }
    return models;
  }

  public async startTask(
    input: StartNimbusTaskInput,
  ): Promise<StartedNimbusTask> {
    this.assertReady();
    this.validateTaskInput(
      input.taskKind,
      input.title,
      input.model,
      input.context,
    );
    await this.assertModelAvailable(input.model);

    const result = await this.request("thread/start", {
      model: input.model,
      cwd: this.config.repositoryCwd,
      allowProviderModelFallback: false,
    });
    const task = this.readTask(
      result,
      input.title,
      input.model,
      "thread/start",
    );
    await this.request("thread/name/set", {
      threadId: task.threadId,
      name: task.title,
    });
    const turnId = await this.startContextTurn(task.threadId, input.context);
    return { ...task, turnId };
  }

  public async forkInvestigation(
    input: ForkInvestigationTaskInput,
  ): Promise<StartedNimbusTask> {
    this.assertReady();
    this.validateTaskInput(
      "investigation",
      input.title,
      input.model,
      input.context,
    );
    this.requireIdentifier(input.owningThreadId, "owningThreadId");
    this.requireIdentifier(
      input.latestCompletedTurnId,
      "latestCompletedTurnId",
    );
    await this.assertModelAvailable(input.model);

    const result = await this.request("thread/fork", {
      threadId: input.owningThreadId,
      lastTurnId: input.latestCompletedTurnId,
      model: input.model,
      cwd: this.config.repositoryCwd,
      excludeTurns: true,
      deferGoalContinuation: true,
    });
    const task = this.readTask(result, input.title, input.model, "thread/fork");
    await this.request("thread/name/set", {
      threadId: task.threadId,
      name: task.title,
    });
    const turnId = await this.startContextTurn(task.threadId, input.context);
    return { ...task, turnId };
  }

  public async resumeTask(input: ResumeNimbusTaskInput): Promise<CodexTask> {
    this.assertReady();
    this.requireIdentifier(input.threadId, "threadId");
    const result = await this.request("thread/resume", {
      threadId: input.threadId,
      excludeTurns: true,
    });
    const threadId = this.readRequiredId(result, "thread", "thread/resume");
    const model = this.readRequiredString(
      result.model,
      "model",
      "thread/resume",
    );
    return {
      threadId,
      model,
      title: this.readOptionalThreadName(result, threadId),
      navigationUrl: createCodexTaskUrl(threadId),
    };
  }

  public async startTurn(input: StartTaskTurnInput): Promise<string> {
    this.assertReady();
    this.requireIdentifier(input.threadId, "threadId");
    this.requireNonEmpty(input.prompt, "prompt");
    const result = await this.request("turn/start", {
      threadId: input.threadId,
      input: [createTextInput(input.prompt)],
    });
    return this.readRequiredId(result, "turn", "turn/start");
  }

  public navigationFor(threadId: string): string {
    this.requireIdentifier(threadId, "threadId");
    return createCodexTaskUrl(threadId);
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.started = false;
    const error = new CodexProcessError("Codex task gateway closed.");
    this.rejectAll(error);
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

  private async startContextTurn(
    threadId: string,
    context: BoundedContextPacket,
  ): Promise<string> {
    return this.startTurn({
      threadId,
      prompt: serializeBoundedContextPacket(context),
    });
  }

  private async assertModelAvailable(model: string): Promise<void> {
    const models = await this.listModels();
    if (!models.some((candidate) => candidate.id === model)) {
      throw new CodexProtocolError(
        `The explicitly selected Codex model ${model} is not available.`,
      );
    }
  }

  private validateTaskInput(
    taskKind: NimbusTaskKind,
    title: string,
    model: string,
    context: BoundedContextPacket,
  ): void {
    this.requireNonEmpty(taskKind, "taskKind");
    this.requireNonEmpty(title, "title");
    this.requireIdentifier(model, "model");
    validateBoundedContextPacket(context);
    if (context.taskKind !== taskKind) {
      throw new CodexProtocolError(
        `Nimbus task context kind ${context.taskKind} does not match requested task kind ${taskKind}.`,
      );
    }
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
        "Codex task gateway transport is unavailable.",
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
          message: `Nimbus does not support server request ${message.method}.`,
        },
      });
    }
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
  }

  private readModelPage(result: Record<string, JsonValue>): {
    models: CodexModel[];
    nextCursor: string | null;
  } {
    const rawModels = result.data;
    if (!Array.isArray(rawModels)) {
      throw new CodexProtocolError(
        "Codex model/list response did not include data.",
      );
    }
    const nextCursor = result.nextCursor;
    if (nextCursor !== null && typeof nextCursor !== "string") {
      throw new CodexProtocolError(
        "Codex model/list response did not include a valid nextCursor.",
      );
    }
    return {
      models: rawModels.map((model) => this.readModel(model)),
      nextCursor,
    };
  }

  private readModel(rawModel: JsonValue): CodexModel {
    if (!this.isRecord(rawModel)) {
      throw new CodexProtocolError(
        "Codex model/list returned a non-object model.",
      );
    }
    const supportedReasoningEfforts = rawModel.supportedReasoningEfforts;
    if (!Array.isArray(supportedReasoningEfforts)) {
      throw new CodexProtocolError(
        "Codex model/list model did not include supportedReasoningEfforts.",
      );
    }
    return {
      id: this.readRequiredString(rawModel.model, "model", "model/list"),
      displayName: this.readRequiredString(
        rawModel.displayName,
        "displayName",
        "model/list",
      ),
      description: this.readRequiredString(
        rawModel.description,
        "description",
        "model/list",
      ),
      supportedReasoningEfforts: supportedReasoningEfforts.map((effort) => {
        if (!this.isRecord(effort)) {
          throw new CodexProtocolError(
            "Codex model/list returned a non-object reasoning effort.",
          );
        }
        return this.readRequiredString(
          effort.reasoningEffort,
          "reasoningEffort",
          "model/list",
        );
      }),
      defaultReasoningEffort: this.readRequiredString(
        rawModel.defaultReasoningEffort,
        "defaultReasoningEffort",
        "model/list",
      ),
      isDefault: this.readRequiredBoolean(
        rawModel.isDefault,
        "isDefault",
        "model/list",
      ),
    };
  }

  private readTask(
    result: Record<string, JsonValue>,
    title: string,
    selectedModel: string,
    method: string,
  ): CodexTask {
    const threadId = this.readRequiredId(result, "thread", method);
    const resolvedModel = this.readRequiredString(
      result.model,
      "model",
      method,
    );
    if (resolvedModel !== selectedModel) {
      throw new CodexProtocolError(
        `Codex ${method} returned model ${resolvedModel} after Nimbus selected ${selectedModel}.`,
      );
    }
    return {
      threadId,
      model: resolvedModel,
      title,
      navigationUrl: createCodexTaskUrl(threadId),
    };
  }

  private readRequiredId(
    result: Record<string, JsonValue>,
    key: "thread" | "turn",
    method: string,
  ): string {
    const entity = result[key];
    if (!this.isRecord(entity)) {
      throw new CodexProtocolError(
        `Codex ${method} response did not include ${key}.`,
      );
    }
    return this.readRequiredString(entity.id, `${key}.id`, method);
  }

  private readOptionalThreadName(
    result: Record<string, JsonValue>,
    fallback: string,
  ): string {
    const thread = result.thread;
    if (!this.isRecord(thread) || thread.name === null) {
      return fallback;
    }
    return this.readRequiredString(thread.name, "thread.name", "thread/resume");
  }

  private readRequiredString(
    value: JsonValue | undefined,
    field: string,
    method: string,
  ): string {
    if (typeof value !== "string" || value.length === 0) {
      throw new CodexProtocolError(
        `Codex ${method} response did not include a non-empty ${field}.`,
      );
    }
    return value;
  }

  private readRequiredBoolean(
    value: JsonValue | undefined,
    field: string,
    method: string,
  ): boolean {
    if (typeof value !== "boolean") {
      throw new CodexProtocolError(
        `Codex ${method} response did not include boolean ${field}.`,
      );
    }
    return value;
  }

  private isRecord(
    value: JsonValue | undefined,
  ): value is Record<string, JsonValue> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private requireIdentifier(value: string, field: string): void {
    this.requireNonEmpty(value, field);
    if (/\s/.test(value)) {
      throw new CodexProtocolError(`${field} must not contain whitespace.`);
    }
  }

  private requireNonEmpty(value: string, field: string): void {
    if (value.trim().length === 0) {
      throw new CodexProtocolError(`${field} must be non-empty.`);
    }
  }

  private assertReady(): void {
    if (!this.started || this.transport === null || this.closed) {
      throw new CodexProcessError(
        "Start the Codex task gateway before managing Nimbus tasks.",
      );
    }
  }
}

export function validateBoundedContextPacket(
  context: BoundedContextPacket,
): void {
  if (context.taskKind.length === 0 || context.workItemId.trim().length === 0) {
    throw new CodexProtocolError(
      "Nimbus bounded context must include a workItemId and taskKind.",
    );
  }
  for (const [field, value] of Object.entries({
    summary: context.summary,
    instructions: context.instructions,
  })) {
    if (value.trim().length === 0) {
      throw new CodexProtocolError(
        `Nimbus bounded context ${field} must be non-empty.`,
      );
    }
  }
  if (
    !Array.isArray(context.facts) ||
    !Array.isArray(context.artifactReferences) ||
    context.facts.some((fact) => fact.trim().length === 0) ||
    context.artifactReferences.some(
      (reference) => reference.trim().length === 0,
    )
  ) {
    throw new CodexProtocolError(
      "Nimbus bounded context facts and artifactReferences must contain only non-empty entries.",
    );
  }
  const prompt = serializeBoundedContextPacket(context);
  if (prompt.length > MAX_CONTEXT_PACKET_CHARACTERS) {
    throw new CodexProtocolError(
      `Nimbus bounded context exceeds ${MAX_CONTEXT_PACKET_CHARACTERS} characters.`,
    );
  }
}

export function serializeBoundedContextPacket(
  context: BoundedContextPacket,
): string {
  return [
    `# Nimbus ${taskLabel(context.taskKind)} task`,
    "",
    "## Bounded Work Item context",
    `Work Item: ${context.workItemId}`,
    `Task: ${taskLabel(context.taskKind)}`,
    "",
    "### Summary",
    context.summary,
    "",
    "### Facts",
    ...context.facts.map((fact) => `- ${fact}`),
    "",
    "### Artifact references",
    ...context.artifactReferences.map((reference) => `- ${reference}`),
    "",
    "### Nimbus instructions",
    context.instructions,
  ].join("\n");
}

export function createCodexTaskUrl(threadId: string): string {
  if (threadId.trim().length === 0 || /\s/.test(threadId)) {
    throw new CodexProtocolError("threadId must be a non-empty Codex task id.");
  }
  return `codex://threads/${encodeURIComponent(threadId)}`;
}

export function createCodexTaskGateway(
  config: CodexTaskGatewayConfig,
): CodexTaskGateway {
  return new CodexTaskGateway(config, createCodexStdioTransport);
}

function createTextInput(prompt: string): JsonValue {
  return { type: "text", text: prompt, text_elements: [] };
}

function taskLabel(taskKind: NimbusTaskKind): string {
  const labels: Record<NimbusTaskKind, string> = {
    orchestrator: "Orchestrator",
    grill: "Grill",
    plan: "Plan",
    implement: "Implement",
    review: "Review",
    investigation: "Investigation",
    publisher: "Publish Handoff",
  };
  return labels[taskKind];
}
