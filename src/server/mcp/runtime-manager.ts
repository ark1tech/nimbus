import { existsSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import {
  createDemoRuntime,
  createDemoWorkItem,
  type HandoffSiteRecordRequest,
  startDemoServer,
} from "../demo";
import {
  createCodexTaskGateway,
  type CodexTaskGateway,
  type StartNimbusTaskInput,
  type StartedNimbusTask,
} from "../codex/task-gateway";
import {
  NIMBUS_HOST,
  type NimbusRuntime,
  type NimbusWorkItem,
  type NimbusWorkItemStore,
} from "../http/types";
import { createMarkdownWorkItemStore } from "../markdown-store";
import {
  createFetchHandoffSiteReachabilityProbe,
  createPublicationAttemptToken,
  HandoffSitePublisher,
  sleepForPublicationRetry,
} from "../publish/handoff-site-publisher";
import type {
  BeginPlanItemInput,
  NimbusMcpAdapter,
  OpenWorkItemInput,
  PresentDecisionInput,
  PresentHandoffInput,
  PresentPlanInput,
  PresentReviewInput,
  PublishInvestigationConclusionInput,
  RecordHandoffSiteInput,
  ReportImplementationItemInput,
} from "./contracts";

export interface NimbusRuntimeManagerOptions {
  pluginRoot: string;
  host: string;
  port: number;
  launchBrowser: (url: string) => Promise<void>;
}

export class NimbusRuntimeManager implements NimbusMcpAdapter {
  private readonly options: NimbusRuntimeManagerOptions;
  private readonly sessionToken: string;
  private activeWorkItemId: string | null = null;
  private runtime: NimbusRuntime | null = null;
  private server: Server | null = null;
  private taskGateway: CodexTaskGateway | null = null;
  private taskGatewayProjectRoot: string | null = null;
  private publisher: HandoffSitePublisher | null = null;
  private readonly publicationAttemptDigests = new Map<string, string>();

  public constructor(options: NimbusRuntimeManagerOptions) {
    this.options = options;
    this.sessionToken = randomBytes(24).toString("base64url");
  }

  public async openWorkItem(input: OpenWorkItemInput): Promise<unknown> {
    if (!path.isAbsolute(input.projectRoot))
      throw new Error(
        `Nimbus projectRoot must be absolute: ${input.projectRoot}.`,
      );
    if (
      this.activeWorkItemId !== null &&
      this.activeWorkItemId !== input.workItemId
    )
      throw new Error(
        `Nimbus is already serving ${this.activeWorkItemId}; close this MCP process before opening ${input.workItemId}.`,
      );
    if (this.runtime === null) await this.startRuntime(input);
    const result = await this.requireRuntime().openWorkItem(input);
    await this.options.launchBrowser(this.reviewUrl());
    return result;
  }

  public presentDecision(input: PresentDecisionInput): Promise<unknown> {
    return this.requireRuntime().presentDecision(input);
  }
  public presentPlan(input: PresentPlanInput): Promise<unknown> {
    return this.requireRuntime().presentPlan(input);
  }
  public beginPlanItem(input: BeginPlanItemInput): Promise<unknown> {
    return this.requireRuntime().beginPlanItem(input);
  }
  public reportImplementationItem(
    input: ReportImplementationItemInput,
  ): Promise<unknown> {
    return this.requireRuntime().reportImplementationItem(input);
  }
  public presentReview(input: PresentReviewInput): Promise<unknown> {
    return this.requireRuntime().presentReview(input);
  }
  public publishInvestigationConclusion(
    input: PublishInvestigationConclusionInput,
  ): Promise<unknown> {
    return this.requireRuntime().publishInvestigationConclusion(input);
  }
  public presentHandoff(input: PresentHandoffInput): Promise<unknown> {
    return this.requireRuntime().presentHandoff(input);
  }
  public recordHandoffSite(input: RecordHandoffSiteInput): Promise<unknown> {
    return this.requireRuntime().recordHandoffSite(input);
  }

  public async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    try {
      if (server !== null) {
        await new Promise<void>((resolve, reject) => {
          server.close((error?: Error): void => {
            if (error === undefined) resolve();
            else reject(error);
          });
        });
      }
    } finally {
      const taskGateway = this.taskGateway;
      this.taskGateway = null;
      this.taskGatewayProjectRoot = null;
      this.publisher = null;
      this.publicationAttemptDigests.clear();
      if (taskGateway !== null) await taskGateway.close();
    }
    this.runtime = null;
    this.activeWorkItemId = null;
  }

  private async startRuntime(input: OpenWorkItemInput): Promise<void> {
    const projectRoot = path.resolve(input.projectRoot);
    const webRoot = path.join(this.options.pluginRoot, "dist");
    const indexPath = path.join(webRoot, "index.html");
    if (!existsSync(indexPath))
      throw new Error(
        `Nimbus browser build is missing at ${indexPath}. Run npm run build in the Nimbus plugin directory.`,
      );
    const filePath = path.join(
      projectRoot,
      "docs",
      "nimbus",
      `${input.workItemId}.md`,
    );
    // Package 2 owns the canonical Markdown store. This cast keeps the runtime independent of its internal parser.
    const store = createMarkdownWorkItemStore({
      filePath,
    }) as unknown as NimbusWorkItemStore;
    const initialWorkItem = await this.loadOrCreateWorkItem(
      input,
      store,
      filePath,
    );
    const publisher = this.createPublisher(projectRoot);
    const runtime = createDemoRuntime({
      store,
      initialWorkItem,
      reviewUrl: this.reviewUrl(),
      repositoryRoot: projectRoot,
      onPublicationRequested: async ({
        workItem,
        expectedDocumentHash,
        model,
      }) => {
        const started = await publisher.beginPublication({
          workItemId: workItem.id,
          workItemTitle: workItem.title,
          model,
          expectedDocumentHash,
          acceptedHandoffMarkdown: createAcceptedHandoffMarkdown(workItem),
        });
        this.publicationAttemptDigests.set(
          started.packet.publicationAttemptToken,
          started.packet.acceptedHandoffDigest,
        );
        return {
          token: started.packet.publicationAttemptToken,
          createdAt: new Date().toISOString(),
        };
      },
      onHandoffSiteRecorded: async (request) =>
        this.completeHandoffSitePublication(publisher, request),
      onPublicationCompleted: async ({ openUrl }) =>
        this.options.launchBrowser(openUrl),
    });
    const server = await startDemoServer({
      host: this.options.host,
      port: this.options.port,
      runtime,
      webRoot,
      sessionToken: this.sessionToken,
    });
    this.activeWorkItemId = input.workItemId;
    this.runtime = runtime;
    this.server = server;
    this.publisher = publisher;
  }

  private createPublisher(projectRoot: string): HandoffSitePublisher {
    return new HandoffSitePublisher({
      taskLauncher: {
        startTask: (input: StartNimbusTaskInput): Promise<StartedNimbusTask> =>
          this.startPublisherTask(projectRoot, input),
      },
      reachabilityProbe: createFetchHandoffSiteReachabilityProbe(),
      warningLogger: {
        warn: (message, fields): void => console.warn(message, fields),
      },
      retryPolicy: {
        maxAttempts: 3,
        retryDelayMs: 1_000,
        timeoutMs: 10_000,
      },
      createAttemptToken: createPublicationAttemptToken,
      now: (): Date => new Date(),
      sleep: sleepForPublicationRetry,
    });
  }

  private async startPublisherTask(
    projectRoot: string,
    input: StartNimbusTaskInput,
  ): Promise<StartedNimbusTask> {
    const taskGateway = await this.getTaskGateway(projectRoot);
    return taskGateway.startTask(input);
  }

  private async getTaskGateway(
    projectRoot: string,
  ): Promise<CodexTaskGateway> {
    if (this.taskGateway !== null) {
      if (this.taskGatewayProjectRoot !== projectRoot) {
        throw new Error(
          `Nimbus Codex task gateway is bound to ${this.taskGatewayProjectRoot}, not ${projectRoot}.`,
        );
      }
      return this.taskGateway;
    }
    const taskGateway = createCodexTaskGateway({
      executablePath: "codex",
      repositoryCwd: projectRoot,
      clientName: "nimbus",
      clientVersion: "0.1.0",
      startupTimeoutMs: 10_000,
      requestTimeoutMs: 30_000,
      runningApp: { socketPath: undefined },
    });
    this.taskGateway = taskGateway;
    this.taskGatewayProjectRoot = projectRoot;
    try {
      await taskGateway.start();
      return taskGateway;
    } catch (error: unknown) {
      this.taskGateway = null;
      this.taskGatewayProjectRoot = null;
      await taskGateway.close();
      throw error;
    }
  }

  private async completeHandoffSitePublication(
    publisher: HandoffSitePublisher,
    request: HandoffSiteRecordRequest,
  ): Promise<{ url: string; openUrl: string }> {
    const digest = this.publicationAttemptDigests.get(
      request.record.publicationAttemptToken,
    );
    if (digest === undefined) {
      throw new Error(
        `Nimbus could not find the Handoff Site digest for publication attempt ${request.record.publicationAttemptToken}.`,
      );
    }
    try {
      const completed = await publisher.recordHandoffSite({
        workItemId: request.record.workItemId,
        acceptedHandoffDigest: digest,
        publicationAttemptToken: request.record.publicationAttemptToken,
        url: request.record.url,
      });
      return { url: completed.url, openUrl: completed.openUrl };
    } finally {
      this.publicationAttemptDigests.delete(
        request.record.publicationAttemptToken,
      );
    }
  }

  private async loadOrCreateWorkItem(
    input: OpenWorkItemInput,
    store: NimbusWorkItemStore,
    filePath: string,
  ): Promise<NimbusWorkItem> {
    if (existsSync(filePath)) return store.read();
    const created = {
      ...createDemoWorkItem(),
      id: input.workItemId,
      title: input.title,
      source: input.source,
      brief: input.brief,
    };
    await store.write(created);
    return created;
  }

  private requireRuntime(): NimbusRuntime {
    if (this.runtime === null)
      throw new Error(
        "Open a Nimbus Work Item before presenting workflow content.",
      );
    return this.runtime;
  }

  private reviewUrl(): string {
    return `http://${this.options.host}:${this.options.port}?token=${encodeURIComponent(this.sessionToken)}`;
  }
}

const createAcceptedHandoffMarkdown = (workItem: NimbusWorkItem): string => {
  if (workItem.handoff === null) {
    throw new Error(
      `Nimbus cannot publish Work Item ${workItem.id} without an accepted Handoff.`,
    );
  }
  return [
    "# Handoff",
    "",
    "## Outcome",
    "",
    ...toMarkdownList(workItem.handoff.outcome),
    "",
    "## Decisions",
    "",
    ...toMarkdownList(workItem.handoff.decisions),
    "",
    "## Deviations",
    "",
    ...toMarkdownList(workItem.handoff.deviations),
    "",
    "## Contracts",
    "",
    ...toMarkdownList(workItem.handoff.contracts),
    "",
    "## Unresolved",
    "",
    ...toMarkdownList(workItem.handoff.unresolved),
    "",
    "## Next actions",
    "",
    ...toMarkdownList(workItem.handoff.nextActions),
  ].join("\n");
};

const toMarkdownList = (items: string[]): string[] =>
  items.length === 0 ? ["- None."] : items.map((item) => `- ${item}`);

export async function launchSystemBrowser(url: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? { executable: "open", arguments: [url] }
      : process.platform === "win32"
        ? { executable: "cmd", arguments: ["/c", "start", "", url] }
        : { executable: "xdg-open", arguments: [url] };
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.arguments, {
      stdio: "ignore",
    });
    child.once("error", (error: Error): void =>
      reject(
        new Error(`Nimbus could not open ${url}: ${error.message}`, {
          cause: error,
        }),
      ),
    );
    child.once("close", (code: number | null): void => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Nimbus browser launcher ${command.executable} exited with code ${String(code)}.`,
          ),
        );
    });
  });
}

export function createDefaultRuntimeManager(
  pluginRoot: string,
): NimbusRuntimeManager {
  const port = Number(process.env.NIMBUS_PORT ?? "4318");
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error(`NIMBUS_PORT must be a valid TCP port: ${String(port)}.`);
  return new NimbusRuntimeManager({
    pluginRoot,
    host: NIMBUS_HOST,
    port,
    launchBrowser: launchSystemBrowser,
  });
}
