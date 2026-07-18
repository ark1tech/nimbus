export type NimbusPhase =
  "grill" | "plan" | "implement" | "review" | "handoff" | "complete";

export type EvidenceLink = {
  path: string;
  startLine: number;
  endLine: number;
  role: "implements" | "verifies" | "configures" | "contradicts";
};

export type DecisionOption = {
  id: string;
  label: string;
  explanation: string;
  concreteEffects: string[];
  pros: string[];
  cons: string[];
};

export type NimbusDecision = {
  id: string;
  question: string;
  context: string;
  options: DecisionOption[];
  recommendationOptionId: string;
  recommendationReason: string;
  selectedOptionId: string | null;
  rationale: string | null;
};

export type NimbusPlanItem = {
  id: string;
  title: string;
  outcome: string;
  decisionRefs: string[];
  status: "pending" | "implemented";
};

export type NimbusImplementationResult = {
  id: string;
  planItemId: string;
  actualResult: string;
  deviation: string | null;
  evidence: EvidenceLink[];
};

export type NimbusWorkItem = {
  id: string;
  title: string;
  phase: NimbusPhase;
  brief: {
    problem: string;
    goal: string;
    scope: string[];
    constraints: string[];
    acceptanceCriteria: string[];
  };
  decisions: NimbusDecision[];
  plan: { document: string; items: NimbusPlanItem[] } | null;
  implementation: NimbusImplementationResult[];
  investigations: Array<{
    conclusion: string;
    rationale: string;
    unresolvedRisk: string | null;
    taskId: string;
  }>;
  handoff: {
    outcome: string[];
    decisions: string[];
    deviations: string[];
    contracts: string[];
    unresolved: string[];
    nextActions: string[];
  } | null;
  deliveryActions: { handoffSiteUrl: string | null };
};

export type NimbusBrowserState = {
  documentHash: string;
  activePlanItemId: string | null;
  activityPhrase: string | null;
  pendingLaunch: { phase: NimbusPhase; model: string | null } | null;
  pendingPlanChangeSet: Array<{
    type: "comment" | "insert" | "replace" | "delete";
    target: string;
    content: string;
  }>;
  pendingCorrectionSet: string[];
  publicationAttempt: { token: string; createdAt: string } | null;
};

export type NimbusState = {
  workItem: NimbusWorkItem;
  browser: NimbusBrowserState;
};

export type NimbusEvent =
  | { type: "work_item.updated"; state: NimbusState }
  | { type: "browser.updated"; browser: NimbusBrowserState }
  | { type: "runtime.step"; label: string };

const apiBasePath = "/api";

function sessionToken(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const token = sessionToken();
  const response = await fetch(`${apiBasePath}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token === null ? {} : { "X-Nimbus-Token": token }),
      ...init.headers,
    },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      details?: string;
    } | null;
    throw new Error(
      body?.details ?? body?.error ?? `Request failed (${response.status}).`,
    );
  }
  return (await response.json()) as T;
}

const withHash = (
  expectedDocumentHash: string,
): { expectedDocumentHash: string } => ({ expectedDocumentHash });

export const nimbusApi = {
  getWorkItem: (): Promise<NimbusState> =>
    request("/work-item", { method: "GET" }),
  selectDecisionOption: (
    decisionId: string,
    optionId: string,
    rationale: string,
    expectedDocumentHash: string,
  ): Promise<NimbusState> =>
    request(`/decisions/${decisionId}/selection`, {
      method: "POST",
      body: JSON.stringify({
        optionId,
        rationale,
        ...withHash(expectedDocumentHash),
      }),
    }),
  submitPlanChangeSet: (
    changeSet: NimbusBrowserState["pendingPlanChangeSet"],
    expectedDocumentHash: string,
  ): Promise<NimbusState> =>
    request("/plan/change-set", {
      method: "POST",
      body: JSON.stringify({ changeSet, ...withHash(expectedDocumentHash) }),
    }),
  confirmLaunch: (
    phase: NimbusPhase,
    model: string,
    expectedDocumentHash: string,
  ): Promise<NimbusState> =>
    request("/launch-confirmation", {
      method: "POST",
      body: JSON.stringify({ phase, model, ...withHash(expectedDocumentHash) }),
    }),
  requestReviewCorrection: (
    correction: string,
    expectedDocumentHash: string,
  ): Promise<NimbusState> =>
    request("/review/corrections", {
      method: "POST",
      body: JSON.stringify({ correction, ...withHash(expectedDocumentHash) }),
    }),
  acceptReview: (expectedDocumentHash: string): Promise<NimbusState> =>
    request("/review/accept", {
      method: "POST",
      body: JSON.stringify(withHash(expectedDocumentHash)),
    }),
  acceptHandoff: (expectedDocumentHash: string): Promise<NimbusState> =>
    request("/handoff/accept", {
      method: "POST",
      body: JSON.stringify(withHash(expectedDocumentHash)),
    }),
  startPublication: (expectedDocumentHash: string): Promise<NimbusState> =>
    request("/handoff/publication", {
      method: "POST",
      body: JSON.stringify(withHash(expectedDocumentHash)),
    }),
};

export function subscribeToNimbusEvents(
  onEvent: (event: NimbusEvent) => void,
  onError: () => void,
): () => void {
  const token = sessionToken();
  const source = new EventSource(
    token === null ? "/events" : `/events?token=${encodeURIComponent(token)}`,
  );
  for (const eventType of [
    "work_item.updated",
    "browser.updated",
    "runtime.step",
  ] as const) {
    source.addEventListener(eventType, (event: MessageEvent<string>) =>
      onEvent(JSON.parse(event.data) as NimbusEvent),
    );
  }
  source.onerror = onError;
  return () => source.close();
}
