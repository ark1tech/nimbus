import { startStandaloneDemo } from "./demo";

void startStandaloneDemo().catch((error: unknown): void => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`Nimbus demo server failed to start: ${message}\n`);
  process.exitCode = 1;
});
