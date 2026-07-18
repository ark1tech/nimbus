export type EvidenceRole =
  "implements" | "verifies" | "configures" | "contradicts";

export type EvidenceInput = {
  path: string;
  startLine: number;
  endLine: number;
  role: EvidenceRole;
};

export type ExpectedDocumentHashInput = {
  expectedDocumentHash: string;
};

export type DecisionOptionInput = {
  id: string;
  label: string;
  explanation: string;
  concreteEffects: string[];
  pros: string[];
  cons: string[];
};

export type OpenWorkItemInput = {
  projectRoot: string;
  workItemId: string;
  title: string;
  source: string | null;
  brief: {
    problem: string;
    goal: string;
    scope: string[];
    constraints: string[];
    acceptanceCriteria: string[];
  };
};

export type PresentDecisionInput = ExpectedDocumentHashInput & {
  workItemId: string;
  decision: {
    id: string;
    question: string;
    context: string;
    options: DecisionOptionInput[];
    recommendationOptionId: string;
    recommendationReason: string;
  };
};

export type PresentPlanInput = ExpectedDocumentHashInput & {
  workItemId: string;
  document: string;
  items: Array<{
    id: string;
    title: string;
    outcome: string;
    decisionRefs: string[];
  }>;
};

export type BeginPlanItemInput = ExpectedDocumentHashInput & {
  workItemId: string;
  planItemId: string;
  activityPhrase: string;
};

export type ReportImplementationItemInput = ExpectedDocumentHashInput & {
  workItemId: string;
  planItemId: string;
  result: {
    id: string;
    actualResult: string;
    deviation: string | null;
    evidence: EvidenceInput[];
  };
};

export type PresentReviewInput = {
  workItemId: string;
};

export type PublishInvestigationConclusionInput = ExpectedDocumentHashInput & {
  workItemId: string;
  owner: {
    type:
      | "work_item"
      | "decision"
      | "option"
      | "plan_item"
      | "implementation_result";
    id: string | null;
  };
  conclusion: string;
  rationale: string;
  evidence: EvidenceInput[];
  unresolvedRisk: string | null;
  taskId: string;
};

export type PresentHandoffInput = ExpectedDocumentHashInput & {
  workItemId: string;
  handoff: {
    outcome: string[];
    decisions: string[];
    deviations: string[];
    contracts: string[];
    unresolved: string[];
    nextActions: string[];
  };
};

export type RecordHandoffSiteInput = ExpectedDocumentHashInput & {
  workItemId: string;
  publicationAttemptToken: string;
  url: string;
};

export type NimbusMcpAdapter = {
  openWorkItem(input: OpenWorkItemInput): Promise<unknown>;
  presentDecision(input: PresentDecisionInput): Promise<unknown>;
  presentPlan(input: PresentPlanInput): Promise<unknown>;
  beginPlanItem(input: BeginPlanItemInput): Promise<unknown>;
  reportImplementationItem(
    input: ReportImplementationItemInput,
  ): Promise<unknown>;
  presentReview(input: PresentReviewInput): Promise<unknown>;
  publishInvestigationConclusion(
    input: PublishInvestigationConclusionInput,
  ): Promise<unknown>;
  presentHandoff(input: PresentHandoffInput): Promise<unknown>;
  recordHandoffSite(input: RecordHandoffSiteInput): Promise<unknown>;
};
