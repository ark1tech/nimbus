import { createDemoRuntime, startDemoServer } from "../src/server/demo";

async function main(): Promise<void> {
  const port = Number(process.env.NIMBUS_SMOKE_PORT ?? "4399");
  const baseUrl = `http://127.0.0.1:${port}`;
  const token = "nimbus-smoke-token";
  const runtime = createDemoRuntime({
    initialWorkItem: null,
    store: null,
    reviewUrl: (): string => `${baseUrl}?token=${token}`,
    repositoryRoot: process.cwd(),
  });
  const server = await startDemoServer({
    host: "127.0.0.1",
    port,
    runtime,
    webRoot: "dist",
    sessionToken: token,
  });
  try {
    const response = await fetch(`${baseUrl}/api/work-item`, {
      headers: { "X-Nimbus-Token": token },
    });
    if (!response.ok)
      throw new Error(
        `Nimbus Work Item API returned ${response.status}: ${await response.text()}`,
      );
    const state = (await response.json()) as {
      workItem?: { id?: unknown };
      browser?: { documentHash?: unknown };
    };
    if (
      state.workItem?.id !== "NIM-001" ||
      typeof state.browser?.documentHash !== "string"
    )
      throw new Error(
        "Nimbus runtime did not return a Work Item and document hash.",
      );
    const unauthorized = await fetch(`${baseUrl}/api/work-item`);
    if (unauthorized.status !== 401)
      throw new Error(
        `Nimbus unauthenticated API returned ${unauthorized.status} instead of 401.`,
      );
    process.stdout.write(`Nimbus plugin runtime smoke passed at ${baseUrl}.\n`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error?: Error): void =>
        error === undefined ? resolve() : reject(error),
      ),
    );
  }
}

void main().catch((error: unknown): void => {
  process.stderr.write(
    `Nimbus plugin runtime smoke failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
