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
} from "../mcp/contracts";
import type { WorkItem } from "../../shared/model";

export const NIMBUS_HOST = "127.0.0.1";
export const NIMBUS_PORT = 4318;

export type RuntimePhase =
  "grill" | "plan" | "implement" | "review" | "handoff" | "complete";

export type RuntimeEvidence = {
  path: string;
  startLine: number;
  endLine: number;
  role: "implements" | "verifies" | "configures" | "contradicts";
};

export type NimbusWorkItem = {
  id: string;
  title: string;
  source: string | null;
  phase: RuntimePhase;
  brief: OpenWorkItemInput["brief"];
  decisions: Array<
    PresentDecisionInput["decision"] & {
      selectedOptionId: string | null;
      rationale: string | null;
    }
  >;
  plan: {
    document: string;
    items: Array<
      PresentPlanInput["items"][number] & { status: "pending" | "implemented" }
    >;
  } | null;
  implementation: Array<
    ReportImplementationItemInput["result"] & { planItemId: string }
  >;
  investigations: Array<
    PublishInvestigationConclusionInput & { publishedAt: string }
  >;
  handoff: PresentHandoffInput["handoff"] | null;
  deliveryActions: { handoffSiteUrl: string | null };
  createdAt: string;
  updatedAt: string;
};

export type NimbusBrowserState = {
  documentHash: string;
  activePlanItemId: string | null;
  activityPhrase: string | null;
  pendingLaunch: { phase: RuntimePhase; model: string | null } | null;
  pendingPlanChangeSet: Array<{
    type: "comment" | "insert" | "replace" | "delete";
    target: string;
    content: string;
  }>;
  pendingCorrectionSet: string[];
  publicationAttempt: { token: string; createdAt: string } | null;
};

export type NimbusWorkItemResponse = {
  workItem: NimbusWorkItem;
  browser: NimbusBrowserState;
};

export interface WorkItemStore {
  read: () => Promise<WorkItem>;
  write: (workItem: WorkItem) => Promise<void>;
}

export interface NimbusWorkItemStore {
  read: () => Promise<NimbusWorkItem>;
  write: (workItem: NimbusWorkItem) => Promise<void>;
}

export type WorkItemRuntimeEvent =
  | { type: "work_item.updated"; state: NimbusWorkItemResponse }
  | { type: "browser.updated"; browser: NimbusBrowserState }
  | { type: "runtime.step"; label: string };

export type WorkItemEventListener = (event: WorkItemRuntimeEvent) => void;

export interface WorkItemEventBus {
  publish: (event: WorkItemRuntimeEvent) => void;
  subscribe: (listener: WorkItemEventListener) => () => void;
}

export interface NimbusRuntime {
  getWorkItem: () => Promise<NimbusWorkItemResponse>;
  selectDecisionOption: (
    decisionId: string,
    optionId: string,
    rationale: string,
    expectedDocumentHash: string,
  ) => Promise<NimbusWorkItemResponse>;
  submitPlanChangeSet: (
    changeSet: NimbusBrowserState["pendingPlanChangeSet"],
    expectedDocumentHash: string,
  ) => Promise<NimbusWorkItemResponse>;
  confirmLaunch: (
    phase: RuntimePhase,
    model: string,
    expectedDocumentHash: string,
  ) => Promise<NimbusWorkItemResponse>;
  requestReviewCorrection: (
    correction: string,
    expectedDocumentHash: string,
  ) => Promise<NimbusWorkItemResponse>;
  acceptReview: (
    expectedDocumentHash: string,
  ) => Promise<NimbusWorkItemResponse>;
  acceptHandoff: (
    expectedDocumentHash: string,
  ) => Promise<NimbusWorkItemResponse>;
  startPublication: (
    expectedDocumentHash: string,
  ) => Promise<NimbusWorkItemResponse>;
  openWorkItem: (input: OpenWorkItemInput) => Promise<unknown>;
  presentDecision: (input: PresentDecisionInput) => Promise<unknown>;
  presentPlan: (input: PresentPlanInput) => Promise<unknown>;
  beginPlanItem: (input: BeginPlanItemInput) => Promise<unknown>;
  reportImplementationItem: (
    input: ReportImplementationItemInput,
  ) => Promise<unknown>;
  presentReview: (input: PresentReviewInput) => Promise<unknown>;
  publishInvestigationConclusion: (
    input: PublishInvestigationConclusionInput,
  ) => Promise<unknown>;
  presentHandoff: (input: PresentHandoffInput) => Promise<unknown>;
  recordHandoffSite: (input: RecordHandoffSiteInput) => Promise<unknown>;
  events: WorkItemEventBus;
}
