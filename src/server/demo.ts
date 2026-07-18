import { createHash, randomBytes } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import type { Server } from "node:http";
import path from "node:path";

import { createNimbusHttpApp } from "./http";
import { HttpProblem } from "./http/errors";
import {
  NIMBUS_HOST,
  NIMBUS_PORT,
  type NimbusBrowserState,
  type NimbusRuntime,
  type NimbusWorkItem,
  type NimbusWorkItemResponse,
  type RuntimeEvidence,
  type RuntimePhase,
  type WorkItemEventBus,
  type WorkItemEventListener,
  type WorkItemRuntimeEvent,
  type NimbusWorkItemStore,
} from "./http/types";
import type {
  BeginPlanItemInput,
  OpenWorkItemInput,
  PresentDecisionInput,
  PresentHandoffInput,
  PresentPlanInput,
  PresentReviewInput,
  PublishInvestigationConclusionInput,
  RecordHandoffSiteInput,
  ReportImplementationItemInput,
} from "./mcp/contracts";

export interface DemoRuntimeOptions {
  store: NimbusWorkItemStore | null;
  initialWorkItem: NimbusWorkItem | null;
  reviewUrl: () => string;
  repositoryRoot: string;
  onPublicationRequested?: (input: PublicationRequestInput) => Promise<PublicationAttempt>;
  onHandoffSiteRecorded?: (
    input: HandoffSiteRecordRequest,
  ) => Promise<HandoffSiteRecordResult>;
  onPublicationCompleted?: (input: HandoffSiteRecordResult) => Promise<void>;
}

export interface PublicationRequestInput {
  workItem: NimbusWorkItem;
  expectedDocumentHash: string;
  model: string;
}

export interface PublicationAttempt {
  token: string;
  createdAt: string;
}

export interface HandoffSiteRecordRequest {
  workItem: NimbusWorkItem;
  record: RecordHandoffSiteInput;
}

export interface HandoffSiteRecordResult {
  url: string;
  openUrl: string;
}

export interface DemoServerOptions {
  host: string;
  port: number;
  runtime: NimbusRuntime;
  webRoot: string | null;
  sessionToken: string | null;
}

type PendingAction = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const timestamp = (): string => new Date().toISOString();

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const hashWorkItem = (workItem: NimbusWorkItem): string =>
  createHash("sha256").update(stableStringify(workItem)).digest("hex");

const cloneWorkItem = (workItem: NimbusWorkItem): NimbusWorkItem =>
  structuredClone(workItem);

const createInMemoryStore = (initial: NimbusWorkItem): NimbusWorkItemStore => {
  let workItem = cloneWorkItem(initial);
  return {
    read: async (): Promise<NimbusWorkItem> => cloneWorkItem(workItem),
    write: async (next: NimbusWorkItem): Promise<void> => {
      workItem = cloneWorkItem(next);
    },
  };
};

const createEventBus = (): WorkItemEventBus => {
  const listeners = new Set<WorkItemEventListener>();
  return {
    publish: (event: WorkItemRuntimeEvent): void => {
      for (const listener of listeners) listener(event);
    },
    subscribe: (listener: WorkItemEventListener): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
};

const createBrowserState = (documentHash: string): NimbusBrowserState => ({
  documentHash,
  activePlanItemId: null,
  activityPhrase: null,
  pendingLaunch: null,
  pendingPlanChangeSet: [],
  pendingCorrectionSet: [],
  publicationAttempt: null,
});

export const createDemoWorkItem = (): NimbusWorkItem => {
  const createdAt = timestamp();
  return {
    id: "NIM-001",
    title: "Show the Nimbus lifecycle",
    source: "demo",
    phase: "grill",
    brief: {
      problem: "Developers need to understand and guide coding-agent work.",
      goal: "Preserve decisions, plan, actual implementation, and handoff in one Work Item.",
      scope: ["Grill", "Plan", "Implement", "Review", "Handoff"],
      constraints: ["Markdown is canonical", "The browser never hosts chat"],
      acceptanceCriteria: [
        "Evidence maps actual implementation back to each Plan Item",
      ],
    },
    decisions: [],
    plan: null,
    implementation: [],
    investigations: [],
    handoff: null,
    deliveryActions: { handoffSiteUrl: null },
    createdAt,
    updatedAt: createdAt,
  };
};

const createWorkItemFromInput = (input: OpenWorkItemInput): NimbusWorkItem => {
  const createdAt = timestamp();
  return {
    id: input.workItemId,
    title: input.title,
    source: input.source,
    phase: "grill",
    brief: input.brief,
    decisions: [],
    plan: null,
    implementation: [],
    investigations: [],
    handoff: null,
    deliveryActions: { handoffSiteUrl: null },
    createdAt,
    updatedAt: createdAt,
  };
};

const pending = (
  label: string,
): { promise: Promise<unknown>; action: PendingAction } => {
  let resolve: ((value: unknown) => void) | null = null;
  let reject: ((error: Error) => void) | null = null;
  const promise = new Promise<unknown>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  const timer = setTimeout(
    (): void => {
      reject?.(
        new HttpProblem(
          408,
          "Nimbus browser action expired",
          `${label} was not completed within 30 minutes.`,
        ),
      );
    },
    30 * 60 * 1000,
  );
  return {
    promise,
    action: {
      resolve: (value: unknown): void => {
        clearTimeout(timer);
        resolve?.(value);
      },
      reject: (error: Error): void => {
        clearTimeout(timer);
        reject?.(error);
      },
      timer,
    },
  };
};

const assertExpectedHash = (expected: string, actual: string): void => {
  if (expected !== actual) {
    throw new HttpProblem(
      409,
      "Stale Work Item update",
      "Reload the Work Item before submitting this action.",
    );
  }
};

const assertWorkItem = (workItem: NimbusWorkItem, id: string): void => {
  if (workItem.id !== id)
    throw new HttpProblem(
      409,
      "Another Work Item is active",
      `Nimbus is reviewing ${workItem.id}, not ${id}.`,
    );
};

const assertPhase = (
  workItem: NimbusWorkItem,
  accepted: RuntimePhase[],
  action: string,
): void => {
  if (!accepted.includes(workItem.phase))
    throw new HttpProblem(
      409,
      "Invalid workflow transition",
      `${action} requires ${accepted.join(" or ")} phase, but the Work Item is ${workItem.phase}.`,
    );
};

const validateEvidence = async (
  repositoryRoot: string,
  evidence: RuntimeEvidence[],
): Promise<void> => {
  for (const item of evidence) {
    if (
      path.isAbsolute(item.path) ||
      item.path.split(path.sep).includes("..")
    ) {
      throw new HttpProblem(
        422,
        "Invalid implementation evidence",
        `${item.path} escapes the active repository.`,
      );
    }
    const resolvedRoot = path.resolve(repositoryRoot);
    const absolutePath = path.resolve(resolvedRoot, item.path);
    if (!absolutePath.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new HttpProblem(
        422,
        "Invalid implementation evidence",
        `${item.path} escapes the active repository.`,
      );
    }
    await access(absolutePath);
    const lineCount = (await readFile(absolutePath, "utf8")).split("\n").length;
    if (
      item.startLine > lineCount ||
      item.endLine > lineCount ||
      item.endLine < item.startLine
    ) {
      throw new HttpProblem(
        422,
        "Invalid implementation evidence",
        `${item.path}:${item.startLine}-${item.endLine} is outside the file.`,
      );
    }
  }
};

export const createDemoRuntime = (
  options: DemoRuntimeOptions,
): NimbusRuntime => {
  const initial = options.initialWorkItem ?? createDemoWorkItem();
  const store = options.store ?? createInMemoryStore(initial);
  const events = createEventBus();
  let browser = createBrowserState(hashWorkItem(initial));
  const pendingDecision = new Map<string, PendingAction>();
  let pendingPlan: PendingAction | null = null;
  let pendingReview: PendingAction | null = null;
  let pendingHandoff: PendingAction | null = null;

  const state = async (): Promise<NimbusWorkItemResponse> => {
    const workItem = await store.read();
    const documentHash = hashWorkItem(workItem);
    browser = { ...browser, documentHash };
    return { workItem, browser: structuredClone(browser) };
  };

  const publishBrowser = (): void =>
    events.publish({
      type: "browser.updated",
      browser: structuredClone(browser),
    });
  const save = async (
    next: NimbusWorkItem,
    label: string,
  ): Promise<NimbusWorkItemResponse> => {
    const workItem = { ...next, updatedAt: timestamp() };
    await store.write(workItem);
    const current = await state();
    events.publish({ type: "work_item.updated", state: current });
    events.publish({ type: "runtime.step", label });
    return current;
  };
  const mutate = async (
    expectedDocumentHash: string,
    label: string,
    updater: (
      workItem: NimbusWorkItem,
    ) => Promise<NimbusWorkItem> | NimbusWorkItem,
  ): Promise<NimbusWorkItemResponse> => {
    const current = await store.read();
    assertExpectedHash(expectedDocumentHash, hashWorkItem(current));
    return save(await updater(current), label);
  };

  return {
    events,
    getWorkItem: state,
    openWorkItem: async (input: OpenWorkItemInput): Promise<unknown> => {
      const current = await store.read();
      if (current.id !== input.workItemId)
        throw new HttpProblem(
          409,
          "Another Work Item is active",
          `Nimbus is reviewing ${current.id}, not ${input.workItemId}.`,
        );
      return {
        workItemId: current.id,
        reviewUrl: options.reviewUrl(),
        documentHash: hashWorkItem(current),
      };
    },
    presentDecision: async (input: PresentDecisionInput): Promise<unknown> => {
      const next = await mutate(
        input.expectedDocumentHash,
        `Presented ${input.decision.id}.`,
        (current) => {
          assertWorkItem(current, input.workItemId);
          assertPhase(current, ["grill"], "Presenting a Decision");
          if (
            current.decisions.some(
              (decision) => decision.id === input.decision.id,
            )
          )
            throw new HttpProblem(
              409,
              "Decision ID already exists",
              `${input.decision.id} is already present.`,
            );
          return {
            ...current,
            decisions: [
              ...current.decisions,
              { ...input.decision, selectedOptionId: null, rationale: null },
            ],
          };
        },
      );
      const waiting = pending(`Decision ${input.decision.id}`);
      pendingDecision.set(input.decision.id, waiting.action);
      return waiting.promise.then(() => ({
        workItemId: next.workItem.id,
        documentHash: next.browser.documentHash,
      }));
    },
    selectDecisionOption: async (
      decisionId,
      optionId,
      rationale,
      expectedDocumentHash,
    ) => {
      const next = await mutate(
        expectedDocumentHash,
        `Accepted ${optionId} for ${decisionId}.`,
        (current) => {
          assertPhase(current, ["grill"], "Selecting a Decision Option");
          const decision = current.decisions.find(
            (item) => item.id === decisionId,
          );
          if (decision === undefined)
            throw new HttpProblem(
              404,
              "Decision not found",
              `No Decision exists with id ${decisionId}.`,
            );
          if (decision.selectedOptionId !== null)
            throw new HttpProblem(
              409,
              "Decision is already resolved",
              `${decisionId} already has an accepted Option.`,
            );
          if (!decision.options.some((option) => option.id === optionId))
            throw new HttpProblem(
              422,
              "Invalid Decision Option",
              `${optionId} does not belong to ${decisionId}.`,
            );
          return {
            ...current,
            decisions: current.decisions.map((item) =>
              item.id === decisionId
                ? { ...item, selectedOptionId: optionId, rationale }
                : item,
            ),
          };
        },
      );
      const waiting = pendingDecision.get(decisionId);
      if (waiting === undefined)
        throw new HttpProblem(
          409,
          "Decision is not awaiting a selection",
          `${decisionId} has no waiting Grill task.`,
        );
      pendingDecision.delete(decisionId);
      waiting.resolve({
        decisionId,
        optionId,
        rationale,
        documentHash: next.browser.documentHash,
      });
      return next;
    },
    presentPlan: async (input: PresentPlanInput): Promise<unknown> => {
      await mutate(
        input.expectedDocumentHash,
        "Presented Plan draft.",
        (current) => {
          assertWorkItem(current, input.workItemId);
          assertPhase(current, ["grill", "plan"], "Presenting a Plan");
          if (
            current.decisions.length === 0 ||
            current.decisions.some(
              (decision) => decision.selectedOptionId === null,
            )
          )
            throw new HttpProblem(
              422,
              "Plan cannot be presented",
              "Accept every presented Decision before presenting a Plan.",
            );
          if (current.phase === "plan" && current.plan !== null)
            browser.pendingPlanChangeSet = [];
          return {
            ...current,
            phase: "plan",
            plan: {
              document: input.document,
              items: input.items.map((item) => ({
                ...item,
                status: "pending",
              })),
            },
          };
        },
      );
      const waiting = pending("Plan review");
      pendingPlan = waiting.action;
      return waiting.promise;
    },
    submitPlanChangeSet: async (changeSet, expectedDocumentHash) => {
      const next = await mutate(
        expectedDocumentHash,
        changeSet.length === 0
          ? "Accepted Plan."
          : "Submitted Plan Change Set.",
        (current) => {
          assertPhase(current, ["plan"], "Submitting a Plan Change Set");
          if (current.plan === null)
            throw new HttpProblem(
              409,
              "Plan is unavailable",
              "No Plan draft is currently available.",
            );
          return changeSet.length === 0
            ? { ...current, phase: "implement" }
            : current;
        },
      );
      browser.pendingPlanChangeSet = structuredClone(changeSet);
      publishBrowser();
      if (pendingPlan === null)
        throw new HttpProblem(
          409,
          "Plan is not awaiting review",
          "No Plan task is waiting for a browser action.",
        );
      const waiting = pendingPlan;
      pendingPlan = null;
      waiting.resolve(
        changeSet.length === 0
          ? { approved: true, documentHash: next.browser.documentHash }
          : {
              approved: false,
              changeSet,
              documentHash: next.browser.documentHash,
            },
      );
      return next;
    },
    beginPlanItem: async (input: BeginPlanItemInput): Promise<unknown> => {
      const next = await mutate(
        input.expectedDocumentHash,
        `Started ${input.planItemId}.`,
        (current) => {
          assertWorkItem(current, input.workItemId);
          assertPhase(current, ["implement"], "Starting a Plan Item");
          if (browser.activePlanItemId !== null)
            throw new HttpProblem(
              409,
              "A Plan Item is already active",
              `${browser.activePlanItemId} must be reported before starting ${input.planItemId}.`,
            );
          if (
            current.plan === null ||
            !current.plan.items.some(
              (item) =>
                item.id === input.planItemId && item.status === "pending",
            )
          )
            throw new HttpProblem(
              422,
              "Invalid Plan Item",
              `${input.planItemId} is not a pending Plan Item.`,
            );
          return current;
        },
      );
      browser = {
        ...browser,
        activePlanItemId: input.planItemId,
        activityPhrase: input.activityPhrase,
      };
      publishBrowser();
      return {
        workItemId: next.workItem.id,
        planItemId: input.planItemId,
        documentHash: next.browser.documentHash,
      };
    },
    reportImplementationItem: async (
      input: ReportImplementationItemInput,
    ): Promise<unknown> => {
      await validateEvidence(options.repositoryRoot, input.result.evidence);
      const next = await mutate(
        input.expectedDocumentHash,
        `Recorded ${input.result.id} for ${input.planItemId}.`,
        (current) => {
          assertWorkItem(current, input.workItemId);
          assertPhase(
            current,
            ["implement"],
            "Reporting an Implementation Result",
          );
          if (browser.activePlanItemId !== input.planItemId)
            throw new HttpProblem(
              409,
              "Wrong active Plan Item",
              `${input.planItemId} cannot be reported while ${browser.activePlanItemId ?? "no Plan Item"} is active.`,
            );
          if (current.plan === null)
            throw new HttpProblem(
              409,
              "Plan is unavailable",
              "No accepted Plan exists.",
            );
          if (
            current.implementation.some(
              (result) => result.id === input.result.id,
            )
          )
            throw new HttpProblem(
              409,
              "Implementation Result ID already exists",
              `${input.result.id} is already present.`,
            );
          const item = current.plan.items.find(
            (candidate) => candidate.id === input.planItemId,
          );
          if (item === undefined || item.status !== "pending")
            throw new HttpProblem(
              422,
              "Invalid Plan Item",
              `${input.planItemId} is not pending.`,
            );
          return {
            ...current,
            plan: {
              ...current.plan,
              items: current.plan.items.map((candidate) =>
                candidate.id === input.planItemId
                  ? { ...candidate, status: "implemented" }
                  : candidate,
              ),
            },
            implementation: [
              ...current.implementation,
              { ...input.result, planItemId: input.planItemId },
            ],
          };
        },
      );
      browser = { ...browser, activePlanItemId: null, activityPhrase: null };
      publishBrowser();
      return {
        workItemId: next.workItem.id,
        implementationResultId: input.result.id,
        documentHash: next.browser.documentHash,
      };
    },
    presentReview: async (input: PresentReviewInput): Promise<unknown> => {
      await mutate(
        (await state()).browser.documentHash,
        "Presented derived Review.",
        (current) => {
          assertWorkItem(current, input.workItemId);
          assertPhase(current, ["implement", "review"], "Presenting Review");
          if (
            current.plan === null ||
            current.plan.items.some((item) => item.status !== "implemented")
          )
            throw new HttpProblem(
              422,
              "Review cannot begin",
              "Every Plan Item needs an Implementation Result before Review.",
            );
          return { ...current, phase: "review" };
        },
      );
      const waiting = pending("Review");
      pendingReview = waiting.action;
      return waiting.promise;
    },
    requestReviewCorrection: async (correction, expectedDocumentHash) => {
      const next = await mutate(
        expectedDocumentHash,
        "Submitted Implementation Change Set.",
        (current) => {
          assertPhase(current, ["review"], "Requesting a Review correction");
          return { ...current, phase: "implement" };
        },
      );
      browser.pendingCorrectionSet = [
        ...browser.pendingCorrectionSet,
        correction,
      ];
      publishBrowser();
      if (pendingReview === null)
        throw new HttpProblem(
          409,
          "Review is not awaiting action",
          "No Review task is waiting for a browser action.",
        );
      const waiting = pendingReview;
      pendingReview = null;
      waiting.resolve({
        accepted: false,
        corrections: [...browser.pendingCorrectionSet],
        documentHash: next.browser.documentHash,
      });
      return next;
    },
    acceptReview: async (expectedDocumentHash) => {
      const next = await mutate(
        expectedDocumentHash,
        "Accepted Review.",
        (current) => {
          assertPhase(current, ["review"], "Accepting Review");
          return current;
        },
      );
      if (pendingReview === null)
        throw new HttpProblem(
          409,
          "Review is not awaiting action",
          "No Review task is waiting for a browser action.",
        );
      const waiting = pendingReview;
      pendingReview = null;
      waiting.resolve({
        accepted: true,
        documentHash: next.browser.documentHash,
      });
      return next;
    },
    publishInvestigationConclusion: async (
      input: PublishInvestigationConclusionInput,
    ): Promise<unknown> => {
      await validateEvidence(options.repositoryRoot, input.evidence);
      const next = await mutate(
        input.expectedDocumentHash,
        "Published Investigation conclusion.",
        (current) => {
          assertWorkItem(current, input.workItemId);
          const ownerExists =
            input.owner.type === "work_item" ||
            (input.owner.type === "decision" &&
              current.decisions.some((item) => item.id === input.owner.id)) ||
            (input.owner.type === "option" &&
              current.decisions.some((item) =>
                item.options.some((option) => option.id === input.owner.id),
              )) ||
            (input.owner.type === "plan_item" &&
              current.plan?.items.some((item) => item.id === input.owner.id)) ||
            (input.owner.type === "implementation_result" &&
              current.implementation.some(
                (item) => item.id === input.owner.id,
              ));
          if (!ownerExists)
            throw new HttpProblem(
              422,
              "Invalid Investigation owner",
              `${input.owner.type}:${String(input.owner.id)} does not exist in the active Work Item.`,
            );
          return {
            ...current,
            investigations: [
              ...current.investigations,
              { ...input, publishedAt: timestamp() },
            ],
          };
        },
      );
      return {
        workItemId: next.workItem.id,
        documentHash: next.browser.documentHash,
      };
    },
    presentHandoff: async (input: PresentHandoffInput): Promise<unknown> => {
      await mutate(
        input.expectedDocumentHash,
        "Presented Handoff.",
        (current) => {
          assertWorkItem(current, input.workItemId);
          assertPhase(current, ["review"], "Presenting Handoff");
          return { ...current, phase: "handoff", handoff: input.handoff };
        },
      );
      const waiting = pending("Handoff");
      pendingHandoff = waiting.action;
      return waiting.promise;
    },
    acceptHandoff: async (expectedDocumentHash) => {
      const next = await mutate(
        expectedDocumentHash,
        "Accepted Handoff. Work Item complete.",
        (current) => {
          assertPhase(current, ["handoff"], "Accepting Handoff");
          if (current.handoff === null)
            throw new HttpProblem(
              422,
              "Handoff is unavailable",
              "A Handoff must be presented before it can be accepted.",
            );
          return { ...current, phase: "complete" };
        },
      );
      if (pendingHandoff === null)
        throw new HttpProblem(
          409,
          "Handoff is not awaiting acceptance",
          "No Handoff task is waiting for a browser action.",
        );
      const waiting = pendingHandoff;
      pendingHandoff = null;
      waiting.resolve({
        accepted: true,
        documentHash: next.browser.documentHash,
      });
      return next;
    },
    startPublication: async (expectedDocumentHash) => {
      const current = await store.read();
      assertExpectedHash(expectedDocumentHash, hashWorkItem(current));
      assertPhase(current, ["complete"], "Starting Handoff Site publication");
      const model =
        browser.pendingLaunch?.phase === "handoff"
          ? browser.pendingLaunch.model
          : null;
      if (model === null) {
        throw new HttpProblem(
          422,
          "Publisher model confirmation is required",
          "Confirm a model for the Handoff Site Publisher before starting publication.",
        );
      }
      const publicationAttempt =
        options.onPublicationRequested === undefined
          ? {
              token: randomBytes(24).toString("base64url"),
              createdAt: timestamp(),
            }
          : await options.onPublicationRequested({
              workItem: current,
              expectedDocumentHash,
              model,
            });
      browser = { ...browser, publicationAttempt };
      publishBrowser();
      return state();
    },
    recordHandoffSite: async (
      input: RecordHandoffSiteInput,
    ): Promise<unknown> => {
      const current = await store.read();
      assertExpectedHash(input.expectedDocumentHash, hashWorkItem(current));
      assertWorkItem(current, input.workItemId);
      assertPhase(current, ["complete"], "Recording a Handoff Site");
      if (
        browser.publicationAttempt === null ||
        browser.publicationAttempt.token !== input.publicationAttemptToken
      )
        throw new HttpProblem(
          409,
          "Stale publication attempt",
          "Start a fresh publication attempt before recording its Site.",
        );
      const completed =
        options.onHandoffSiteRecorded === undefined
          ? await recordReachableHandoffSite(input.url)
          : await options.onHandoffSiteRecorded({
              workItem: current,
              record: input,
            });
      const next = await save(
        {
          ...current,
          deliveryActions: {
            ...current.deliveryActions,
            handoffSiteUrl: completed.url,
          },
        },
        "Recorded reachable Handoff Site.",
      );
      browser = { ...browser, publicationAttempt: null };
      publishBrowser();
      if (options.onPublicationCompleted !== undefined) {
        await options.onPublicationCompleted(completed);
      }
      return {
        workItemId: next.workItem.id,
        url: completed.url,
        documentHash: next.browser.documentHash,
      };
    },
    confirmLaunch: async (phase, model, expectedDocumentHash) => {
      const current = await store.read();
      assertExpectedHash(expectedDocumentHash, hashWorkItem(current));
      if (phase === "complete")
        throw new HttpProblem(
          422,
          "Invalid task launch",
          "A complete Work Item cannot launch a Phase task.",
        );
      browser = { ...browser, pendingLaunch: { phase, model } };
      publishBrowser();
      return state();
    },
  };
};

const recordReachableHandoffSite = async (
  url: string,
): Promise<HandoffSiteRecordResult> => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpProblem(
      422,
      "Handoff Site is unreachable",
      `${url}: ${message}`,
    );
  }
  if (!response.ok)
    throw new HttpProblem(
      422,
      "Handoff Site is unreachable",
      `${url} returned HTTP ${response.status}.`,
    );
  return { url, openUrl: url };
};

export const startDemoServer = async (
  options: DemoServerOptions,
): Promise<Server> => {
  const app = createNimbusHttpApp(
    options.runtime,
    options.webRoot,
    options.sessionToken,
  );
  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(options.port, options.host, (): void =>
      resolve(server),
    );
    server.once("error", reject);
  });
};

export const startStandaloneDemo = async (): Promise<void> => {
  const runtime = createDemoRuntime({
    store: null,
    initialWorkItem: null,
    reviewUrl: (): string => `http://${NIMBUS_HOST}:${NIMBUS_PORT}`,
    repositoryRoot: process.cwd(),
    onPublicationRequested: undefined,
  });
  await startDemoServer({
    host: NIMBUS_HOST,
    port: NIMBUS_PORT,
    runtime,
    webRoot: path.resolve("dist"),
    sessionToken: null,
  });
};
