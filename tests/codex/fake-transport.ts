import type {
  CodexProcessError,
  JsonRpcInbound,
  JsonRpcOutbound,
} from "../../src/server/codex/protocol";
import type { CodexAppServerTransport } from "../../src/server/codex/transport";

export interface FakeCodexTransport extends CodexAppServerTransport {
  readonly sent: JsonRpcOutbound[];
  readonly startCalls: number;
  readonly closeCalls: number;
  emit: (message: JsonRpcInbound) => void;
}

export interface FakeTransportHandlers {
  onSend: (message: JsonRpcOutbound, transport: FakeCodexTransport) => void;
}

export function createFakeCodexTransport(
  handlers: FakeTransportHandlers,
): FakeCodexTransport {
  const sent: JsonRpcOutbound[] = [];
  const messageListeners = new Set<(message: JsonRpcInbound) => void>();
  const exitListeners = new Set<(error: CodexProcessError) => void>();
  let starts = 0;
  let closes = 0;

  const transport: FakeCodexTransport = {
    get sent(): JsonRpcOutbound[] {
      return sent;
    },
    get startCalls(): number {
      return starts;
    },
    get closeCalls(): number {
      return closes;
    },
    async start(): Promise<void> {
      starts += 1;
    },
    send(message: JsonRpcOutbound): void {
      sent.push(message);
      handlers.onSend(message, transport);
    },
    onMessage(listener: (message: JsonRpcInbound) => void): () => void {
      messageListeners.add(listener);
      return (): void => {
        messageListeners.delete(listener);
      };
    },
    onExit(listener: (error: CodexProcessError) => void): () => void {
      exitListeners.add(listener);
      return (): void => {
        exitListeners.delete(listener);
      };
    },
    async close(): Promise<void> {
      closes += 1;
    },
    emit(message: JsonRpcInbound): void {
      for (const listener of messageListeners) {
        listener(message);
      }
    },
  };

  return transport;
}
