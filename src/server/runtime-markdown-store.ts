import type {
  Decision,
  EvidenceLink,
  Handoff,
  ImplementationResult,
  PlanItem,
  PublishedInvestigation,
  WorkItem,
  WorkItemPhase,
} from "../shared/model";
import type {
  NimbusWorkItem,
  NimbusWorkItemStore,
  RuntimeEvidence,
  RuntimePhase,
} from "./http/types";
import { createMarkdownWorkItemStore } from "./markdown-store";

export interface RuntimeMarkdownWorkItemStoreOptions {
  filePath: string;
}

const runtimeToCanonicalPhase: Record<RuntimePhase, WorkItemPhase> = {
  grill: "grilling",
  plan: "planning",
  implement: "implementing",
  review: "review",
  handoff: "handoff",
  complete: "complete",
};

const canonicalToRuntimePhase: Record<WorkItemPhase, RuntimePhase> = {
  grilling: "grill",
  planning: "plan",
  implementing: "implement",
  review: "review",
  handoff: "handoff",
  complete: "complete",
};

export function createRuntimeMarkdownWorkItemStore(
  options: RuntimeMarkdownWorkItemStoreOptions,
): NimbusWorkItemStore {
  const canonicalStore = createMarkdownWorkItemStore({
    filePath: options.filePath,
  });
  return {
    read: async (): Promise<NimbusWorkItem> =>
      toRuntimeWorkItem(await canonicalStore.read()),
    write: async (workItem: NimbusWorkItem): Promise<void> =>
      canonicalStore.write(toCanonicalWorkItem(workItem)),
  };
}

export function toCanonicalWorkItem(workItem: NimbusWorkItem): WorkItem {
  return {
    id: workItem.id,
    title: workItem.title,
    source: workItem.source,
    phase: runtimeToCanonicalPhase[workItem.phase],
    createdAt: workItem.createdAt,
    updatedAt: workItem.updatedAt,
    tasks: {
      orchestrator: null,
      grill: null,
      plan: null,
      implement: null,
      review: null,
      handoff: null,
    },
    brief: workItem.brief,
    decisions: workItem.decisions.map((decision): Decision => ({
      id: decision.id,
      title: decision.question,
      context: decision.context,
      options: decision.options.map((option) => ({
        id: option.id,
        title: option.label,
        explanation: option.explanation,
        concreteEffects: option.concreteEffects,
        pros: option.pros,
        cons: option.cons,
        publishedInvestigations: investigationsFor(
          workItem,
          "option",
          option.id,
        ),
      })),
      recommendationOptionId: decision.recommendationOptionId,
      recommendationRationale: decision.recommendationReason,
      acceptedOptionId: decision.selectedOptionId,
      acceptedRationale: decision.rationale,
      acceptedAt:
        decision.selectedOptionId === null ? null : workItem.updatedAt,
      revisions: [],
      publishedInvestigations: investigationsFor(
        workItem,
        "decision",
        decision.id,
      ),
    })),
    plan: toCanonicalPlan(workItem),
    implementation: workItem.implementation.map(
      (result): ImplementationResult => ({
        id: result.id,
        planItemId: result.planItemId,
        actualResult: result.actualResult,
        deviation: result.deviation,
        evidence: result.evidence.map(toCanonicalEvidence),
        publishedInvestigations: investigationsFor(
          workItem,
          "implementation_result",
          result.id,
        ),
      }),
    ),
    handoff: toCanonicalHandoff(workItem),
    publishedInvestigations: investigationsFor(workItem, "work_item", null),
  };
}

export function toRuntimeWorkItem(workItem: WorkItem): NimbusWorkItem {
  const implementedPlanItems = new Set(
    workItem.implementation.map((result) => result.planItemId),
  );
  return {
    id: workItem.id,
    title: workItem.title,
    source: workItem.source,
    phase: canonicalToRuntimePhase[workItem.phase],
    brief: workItem.brief,
    decisions: workItem.decisions.map((decision) => ({
      id: decision.id,
      question: decision.title,
      context: decision.context,
      options: decision.options.map((option) => ({
        id: option.id,
        label: option.title,
        explanation: option.explanation,
        concreteEffects: option.concreteEffects,
        pros: option.pros,
        cons: option.cons,
      })),
      recommendationOptionId: decision.recommendationOptionId,
      recommendationReason: decision.recommendationRationale,
      selectedOptionId: decision.acceptedOptionId,
      rationale: decision.acceptedRationale,
    })),
    plan:
      workItem.plan.length === 0
        ? null
        : {
            document: toRuntimePlanDocument(workItem.plan),
            items: workItem.plan.map((item) => ({
              id: item.id,
              title: item.title,
              outcome: item.outcome,
              decisionRefs: item.decisionIds,
              status: implementedPlanItems.has(item.id)
                ? "implemented"
                : "pending",
            })),
          },
    implementation: workItem.implementation.map((result) => ({
      id: result.id,
      planItemId: result.planItemId,
      actualResult: result.actualResult,
      deviation: result.deviation,
      evidence: result.evidence.map((evidence) => ({
        path: evidence.path,
        startLine: evidence.startLine,
        endLine: evidence.endLine,
        role: evidence.role,
      })),
    })),
    investigations: collectRuntimeInvestigations(workItem),
    handoff: toRuntimeHandoff(workItem),
    deliveryActions: {
      handoffSiteUrl: readHandoffSiteUrl(workItem.handoff.deliveryActions),
    },
    createdAt: workItem.createdAt,
    updatedAt: workItem.updatedAt,
  };
}

function toCanonicalPlan(workItem: NimbusWorkItem): PlanItem[] {
  if (workItem.plan === null) return [];
  return workItem.plan.items.map((item) => ({
    id: item.id,
    title: item.title,
    decisionIds: item.decisionRefs,
    outcome: item.outcome,
    implementationBoundary: "Defined by the accepted Nimbus Plan.",
    publishedInvestigations: investigationsFor(workItem, "plan_item", item.id),
  }));
}

function toCanonicalEvidence(evidence: RuntimeEvidence): EvidenceLink {
  return {
    path: evidence.path,
    startLine: evidence.startLine,
    endLine: evidence.endLine,
    description: `${evidence.role} ${evidence.path}`,
    role: evidence.role,
  };
}

function toCanonicalHandoff(workItem: NimbusWorkItem): Handoff {
  if (workItem.handoff === null) {
    return {
      summary: [],
      contracts: [],
      unresolved: [],
      nextActions: [],
      deliveryActions: [],
      publishedInvestigations: [],
    };
  }
  return {
    summary: [
      ...workItem.handoff.outcome,
      ...workItem.handoff.decisions.map((item) => `Decision: ${item}`),
      ...workItem.handoff.deviations.map((item) => `Deviation: ${item}`),
    ],
    contracts: workItem.handoff.contracts,
    unresolved: workItem.handoff.unresolved,
    nextActions: workItem.handoff.nextActions,
    deliveryActions:
      workItem.deliveryActions.handoffSiteUrl === null
        ? []
        : [`Handoff Site: ${workItem.deliveryActions.handoffSiteUrl}`],
    publishedInvestigations: [],
  };
}

function toRuntimeHandoff(workItem: WorkItem): NimbusWorkItem["handoff"] {
  if (workItem.phase !== "handoff" && workItem.phase !== "complete")
    return null;
  return {
    outcome: workItem.handoff.summary.filter(
      (item) =>
        !item.startsWith("Decision: ") && !item.startsWith("Deviation: "),
    ),
    decisions: workItem.handoff.summary
      .filter((item) => item.startsWith("Decision: "))
      .map((item) => item.slice("Decision: ".length)),
    deviations: workItem.handoff.summary
      .filter((item) => item.startsWith("Deviation: "))
      .map((item) => item.slice("Deviation: ".length)),
    contracts: workItem.handoff.contracts,
    unresolved: workItem.handoff.unresolved,
    nextActions: workItem.handoff.nextActions,
  };
}

function investigationsFor(
  workItem: NimbusWorkItem,
  ownerType: NimbusWorkItem["investigations"][number]["owner"]["type"],
  ownerId: string | null,
): PublishedInvestigation[] {
  return workItem.investigations
    .filter(
      (investigation) =>
        investigation.owner.type === ownerType &&
        investigation.owner.id === ownerId,
    )
    .map((investigation) => ({
      publishedAt: investigation.publishedAt,
      conclusion: investigation.conclusion,
      rationale: investigation.rationale,
      evidence: investigation.evidence.map(formatRuntimeEvidence).join("; "),
      unresolved: investigation.unresolvedRisk ?? "None.",
      taskUrl: `codex://threads/${investigation.taskId}`,
    }));
}

function formatRuntimeEvidence(evidence: RuntimeEvidence): string {
  return `${evidence.path}:${evidence.startLine}-${evidence.endLine} [${evidence.role}]`;
}

function collectRuntimeInvestigations(
  workItem: WorkItem,
): NimbusWorkItem["investigations"] {
  return [
    ...workItem.publishedInvestigations.map((investigation) =>
      toRuntimeInvestigation(investigation, "work_item", null),
    ),
    ...workItem.decisions.flatMap((decision) => [
      ...decision.publishedInvestigations.map((investigation) =>
        toRuntimeInvestigation(investigation, "decision", decision.id),
      ),
      ...decision.options.flatMap((option) =>
        option.publishedInvestigations.map((investigation) =>
          toRuntimeInvestigation(investigation, "option", option.id),
        ),
      ),
    ]),
    ...workItem.plan.flatMap((item) =>
      item.publishedInvestigations.map((investigation) =>
        toRuntimeInvestigation(investigation, "plan_item", item.id),
      ),
    ),
    ...workItem.implementation.flatMap((result) =>
      result.publishedInvestigations.map((investigation) =>
        toRuntimeInvestigation(
          investigation,
          "implementation_result",
          result.id,
        ),
      ),
    ),
  ];
}

function toRuntimeInvestigation(
  investigation: PublishedInvestigation,
  ownerType: NimbusWorkItem["investigations"][number]["owner"]["type"],
  ownerId: string | null,
): NimbusWorkItem["investigations"][number] {
  return {
    workItemId: "",
    expectedDocumentHash: "",
    owner: { type: ownerType, id: ownerId },
    conclusion: investigation.conclusion,
    rationale: investigation.rationale,
    evidence: parseRuntimeEvidence(investigation.evidence),
    unresolvedRisk:
      investigation.unresolved === "None." ? null : investigation.unresolved,
    taskId: investigation.taskUrl.replace("codex://threads/", ""),
    publishedAt: investigation.publishedAt,
  };
}

function parseRuntimeEvidence(value: string): RuntimeEvidence[] {
  if (value.trim().length === 0) return [];
  return value.split("; ").flatMap((entry) => {
    const match = entry.match(
      /^(.+):(\d+)-(\d+) \[(implements|verifies|configures|contradicts)\]$/,
    );
    if (match === null) return [];
    return [
      {
        path: match[1],
        startLine: Number(match[2]),
        endLine: Number(match[3]),
        role: match[4] as RuntimeEvidence["role"],
      },
    ];
  });
}

function toRuntimePlanDocument(items: PlanItem[]): string {
  return [
    "# Plan",
    "",
    ...items.flatMap((item) => [
      `## ${item.id}: ${item.title}`,
      "",
      item.outcome,
      "",
      `Supports: ${item.decisionIds.join(", ")}`,
      "",
    ]),
  ].join("\n");
}

function readHandoffSiteUrl(deliveryActions: string[]): string | null {
  const action = deliveryActions.find((item) =>
    item.startsWith("Handoff Site: "),
  );
  return action === undefined ? null : action.slice("Handoff Site: ".length);
}
