export type JsonRpcId = number | string;

export type JsonValue =
  boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params: Record<string, JsonValue>;
}

export interface JsonRpcNotification {
  method: string;
  params: Record<string, JsonValue>;
}

export interface JsonRpcSuccessResponse {
  id: JsonRpcId;
  result: Record<string, JsonValue>;
}

export interface JsonRpcErrorResponse {
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: JsonValue;
  };
}

export type JsonRpcOutbound =
  JsonRpcRequest | JsonRpcNotification | JsonRpcErrorResponse;

export type JsonRpcInbound =
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse
  | JsonRpcNotification
  | JsonRpcRequest;

export class CodexProtocolError extends Error {
  public readonly name = "CodexProtocolError";

  public constructor(message: string) {
    super(message);
  }
}

export class CodexRpcError extends Error {
  public readonly name = "CodexRpcError";
  public readonly code: number;
  public readonly data: JsonValue | undefined;

  public constructor(
    message: string,
    code: number,
    data: JsonValue | undefined,
  ) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export class CodexTimeoutError extends Error {
  public readonly name = "CodexTimeoutError";
  public readonly operation: string;
  public readonly timeoutMs: number;

  public constructor(operation: string, timeoutMs: number) {
    super(
      `Codex app-server timed out waiting for ${operation} after ${timeoutMs}ms.`,
    );
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

export class CodexProcessError extends Error {
  public readonly name = "CodexProcessError";

  public constructor(message: string) {
    super(message);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonRpcMessage(line: string): JsonRpcInbound {
  let value: unknown;

  try {
    value = JSON.parse(line) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CodexProtocolError(
      `Codex app-server emitted invalid JSON: ${detail}`,
    );
  }

  if (!isRecord(value)) {
    throw new CodexProtocolError(
      "Codex app-server emitted a non-object JSON-RPC message.",
    );
  }

  const id = value.id;
  const method = value.method;
  const result = value.result;
  const error = value.error;
  const hasId = typeof id === "string" || typeof id === "number";

  if (typeof method === "string") {
    const params = value.params;
    if (params !== undefined && !isRecord(params)) {
      throw new CodexProtocolError(
        `Codex app-server sent non-object params for ${method}.`,
      );
    }

    if (hasId) {
      return {
        id,
        method,
        params: (params ?? {}) as Record<string, JsonValue>,
      };
    }

    return { method, params: (params ?? {}) as Record<string, JsonValue> };
  }

  if (!hasId) {
    throw new CodexProtocolError(
      "Codex app-server sent a message without an id or method.",
    );
  }

  if (error !== undefined) {
    if (
      !isRecord(error) ||
      typeof error.code !== "number" ||
      typeof error.message !== "string"
    ) {
      throw new CodexProtocolError(
        "Codex app-server sent an invalid JSON-RPC error response.",
      );
    }

    return {
      id,
      error: {
        code: error.code,
        message: error.message,
        ...(error.data === undefined ? {} : { data: error.data as JsonValue }),
      },
    };
  }

  if (result !== undefined && isRecord(result)) {
    return { id, result: result as Record<string, JsonValue> };
  }

  throw new CodexProtocolError(
    "Codex app-server sent a response without a result or error.",
  );
}

export function isJsonRpcResponse(
  message: JsonRpcInbound,
): message is JsonRpcSuccessResponse | JsonRpcErrorResponse {
  return "id" in message && !("method" in message);
}

export function isJsonRpcRequest(
  message: JsonRpcInbound,
): message is JsonRpcRequest {
  return "id" in message && "method" in message;
}

export function isJsonRpcNotification(
  message: JsonRpcInbound,
): message is JsonRpcNotification {
  return !("id" in message) && "method" in message;
}
