import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import {
  CodexProcessError,
  CodexProtocolError,
  type JsonRpcInbound,
  type JsonRpcOutbound,
  parseJsonRpcMessage,
} from "./protocol";

export interface CodexProcessConfig {
  executablePath: string;
  cwd: string;
  startupTimeoutMs: number;
  runningApp: CodexRunningAppConnection | undefined;
}

/**
 * Connects a client to the app-server already owned by the Codex desktop app.
 * Omitting this value is supported only for the legacy Decision Room connector.
 */
export interface CodexRunningAppConnection {
  socketPath: string | undefined;
}

export interface CodexAppServerTransport {
  start: () => Promise<void>;
  send: (message: JsonRpcOutbound) => void;
  onMessage: (listener: (message: JsonRpcInbound) => void) => () => void;
  onExit: (listener: (error: CodexProcessError) => void) => () => void;
  close: () => Promise<void>;
}

export type CodexTransportFactory = (
  config: CodexProcessConfig,
) => CodexAppServerTransport;

export class CodexStdioTransport implements CodexAppServerTransport {
  private readonly config: CodexProcessConfig;
  private readonly messageListeners = new Set<
    (message: JsonRpcInbound) => void
  >();
  private readonly exitListeners = new Set<
    (error: CodexProcessError) => void
  >();
  private readonly decoder = new StringDecoder("utf8");
  private process: ChildProcess | null = null;
  private buffer = "";
  private closed = false;

  public constructor(config: CodexProcessConfig) {
    this.config = config;
  }

  public async start(): Promise<void> {
    if (this.process !== null) {
      throw new CodexProcessError(
        "Codex app-server transport has already started.",
      );
    }
    if (this.closed) {
      throw new CodexProcessError(
        "Codex app-server transport has already closed.",
      );
    }

    const process = spawn(this.config.executablePath, this.commandArguments(), {
      cwd: this.config.cwd,
      stdio: ["pipe", "pipe", "ignore"],
    });
    this.process = process;
    this.subscribeToProcess(process);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new CodexProcessError(
            `Codex app-server did not start within ${this.config.startupTimeoutMs}ms.`,
          ),
        );
      }, this.config.startupTimeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        process.off("spawn", onSpawn);
        process.off("error", onError);
      };
      const onSpawn = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(
          new CodexProcessError(
            `Unable to start Codex app-server: ${error.message}`,
          ),
        );
      };

      process.once("spawn", onSpawn);
      process.once("error", onError);
    });
  }

  public send(message: JsonRpcOutbound): void {
    if (
      this.process === null ||
      this.process.stdin === null ||
      this.process.stdin.destroyed ||
      this.closed
    ) {
      throw new CodexProcessError(
        "Cannot send JSON-RPC to a stopped Codex app-server.",
      );
    }

    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  public onMessage(listener: (message: JsonRpcInbound) => void): () => void {
    this.messageListeners.add(listener);
    return (): void => {
      this.messageListeners.delete(listener);
    };
  }

  public onExit(listener: (error: CodexProcessError) => void): () => void {
    this.exitListeners.add(listener);
    return (): void => {
      this.exitListeners.delete(listener);
    };
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    const process = this.process;
    this.process = null;
    if (process === null || process.exitCode !== null) {
      return;
    }

    await new Promise<void>((resolve) => {
      process.once("exit", () => resolve());
      process.kill();
    });
  }

  private subscribeToProcess(process: ChildProcess): void {
    if (process.stdout === null) {
      throw new CodexProcessError("Codex app-server did not provide stdout.");
    }
    process.stdout.on("data", (chunk: Buffer) => {
      this.buffer += this.decoder.write(chunk);
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";

      for (const line of lines) {
        const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (normalizedLine.length === 0) {
          continue;
        }

        try {
          const message = parseJsonRpcMessage(normalizedLine);
          for (const listener of this.messageListeners) {
            listener(message);
          }
        } catch (error: unknown) {
          const protocolError =
            error instanceof CodexProtocolError
              ? error
              : new CodexProtocolError(
                  `Failed to parse Codex app-server JSON-RPC: ${String(error)}`,
                );
          this.notifyExit(new CodexProcessError(protocolError.message));
        }
      }
    });

    process.once("error", (error: Error) => {
      this.notifyExit(
        new CodexProcessError(
          `Codex app-server process error: ${error.message}`,
        ),
      );
    });
    process.once(
      "exit",
      (code: number | null, signal: NodeJS.Signals | null) => {
        if (!this.closed) {
          this.notifyExit(
            new CodexProcessError(
              `Codex app-server exited unexpectedly with code ${String(code)} and signal ${String(signal)}.`,
            ),
          );
        }
      },
    );
  }

  private commandArguments(): string[] {
    return createCodexAppServerCommandArguments(this.config.runningApp);
  }

  private notifyExit(error: CodexProcessError): void {
    for (const listener of this.exitListeners) {
      listener(error);
    }
  }
}

export const createCodexStdioTransport: CodexTransportFactory = (
  config: CodexProcessConfig,
): CodexAppServerTransport => new CodexStdioTransport(config);

export function createCodexAppServerCommandArguments(
  runningApp: CodexRunningAppConnection | undefined,
): string[] {
  if (runningApp === undefined) {
    return ["app-server", "--listen", "stdio://"];
  }

  return [
    "app-server",
    "proxy",
    ...(runningApp.socketPath === undefined
      ? []
      : ["--sock", runningApp.socketPath]),
  ];
}
