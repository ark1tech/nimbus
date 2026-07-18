export type WorkItemPhase =
  | "grilling"
  | "planning"
  | "implementing"
  | "review"
  | "handoff"
  | "complete";

export type EvidenceRole =
  | "implements"
  | "verifies"
  | "configures"
  | "contradicts";

export interface WorkItemBrief {
  problem: string;
  goal: string;
  scope: string[];
  constraints: string[];
  acceptanceCriteria: string[];
}

export interface WorkItemTasks {
  orchestrator: string | null;
  grill: string | null;
  plan: string | null;
  implement: string | null;
  review: string | null;
  handoff: string | null;
}

export interface PublishedInvestigation {
  publishedAt: string;
  conclusion: string;
  rationale: string;
  evidence: string;
  unresolved: string;
  taskUrl: string;
}

export interface DecisionOption {
  id: string;
  title: string;
  explanation: string;
  concreteEffects: string[];
  pros: string[];
  cons: string[];
  publishedInvestigations: PublishedInvestigation[];
}

export interface DecisionRevision {
  acceptedAt: string;
  optionId: string;
  rationale: string;
}

export interface Decision {
  id: string;
  title: string;
  context: string;
  options: DecisionOption[];
  recommendationOptionId: string;
  recommendationRationale: string;
  acceptedOptionId: string | null;
  acceptedRationale: string | null;
  acceptedAt: string | null;
  revisions: DecisionRevision[];
  publishedInvestigations: PublishedInvestigation[];
}

export interface PlanItem {
  id: string;
  title: string;
  decisionIds: string[];
  outcome: string;
  implementationBoundary: string;
  publishedInvestigations: PublishedInvestigation[];
}

export interface EvidenceLink {
  id?: string;
  path: string;
  startLine: number;
  endLine: number;
  description: string;
  role: EvidenceRole;
}

export interface ImplementationResult {
  id: string;
  planItemId: string;
  actualResult: string;
  deviation: string | null;
  evidence: EvidenceLink[];
  publishedInvestigations: PublishedInvestigation[];
}

export interface Handoff {
  summary: string[];
  contracts: string[];
  unresolved: string[];
  nextActions: string[];
  deliveryActions: string[];
  publishedInvestigations: PublishedInvestigation[];
}

export interface WorkItem {
  id: string;
  title: string;
  source: string | null;
  phase: WorkItemPhase;
  createdAt: string;
  updatedAt: string;
  tasks: WorkItemTasks;
  brief: WorkItemBrief;
  decisions: Decision[];
  plan: PlanItem[];
  implementation: ImplementationResult[];
  handoff: Handoff;
  publishedInvestigations: PublishedInvestigation[];
}

export type WorkItemUpdate =
  | {
      type: "decision.accept";
      expectedDocumentHash: string;
      decisionId: string;
      optionId: string;
      rationale: string;
      acceptedAt: string;
    }
  | {
      type: "implementation.report";
      expectedDocumentHash: string;
      result: ImplementationResult;
    }
  | {
      type: "investigation.publish";
      expectedDocumentHash: string;
      owner: InvestigationOwner;
      investigation: PublishedInvestigation;
    }
  | {
      type: "handoff.delivery-action.add";
      expectedDocumentHash: string;
      deliveryAction: string;
    };

export type InvestigationOwner =
  | { kind: "work-item" }
  | { kind: "decision"; id: string }
  | { kind: "decision-option"; id: string }
  | { kind: "plan-item"; id: string }
  | { kind: "implementation-result"; id: string }
  | { kind: "handoff" };
