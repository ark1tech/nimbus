import type { WorkItem } from "../src/shared/model";

const noTasks = {
  orchestrator: null,
  grill: null,
  plan: null,
  implement: null,
  review: null,
  handoff: null,
};

export function createDemoWorkItem(): WorkItem {
  return {
    id: "NIM-001",
    title: "Create a resumable decision workspace",
    source: "https://example.test/issues/NIM-001",
    phase: "complete",
    createdAt: "2026-07-18T08:00:00.000Z",
    updatedAt: "2026-07-18T11:30:00.000Z",
    tasks: noTasks,
    brief: {
      problem: "Developers lose the reasoning behind consequential choices when implementation moves quickly.",
      goal: "Keep decisions, plan, actual implementation, and handoff in one readable Work Item.",
      scope: ["Grill", "Plan", "Implement", "Review", "Handoff"],
      constraints: ["Codex owns conversations", "Markdown is canonical", "The browser never hosts chat"],
      acceptanceCriteria: ["Every Plan Item maps to an evidence-backed implementation result"],
    },
    decisions: [{
      id: "D-01",
      title: "Where should a developer interrogate a decision?",
      context: "Extended learning should not crowd the implementation task.",
      options: [
        { id: "D-01/A", title: "Use the implementation task", explanation: "Ask every follow-up in the task that implements the work.", concreteEffects: ["Keeps one task"], pros: ["Minimal orchestration"], cons: ["Exploration crowds implementation context"], publishedInvestigations: [] },
        { id: "D-01/B", title: "Fork an investigation task", explanation: "Use a focused Codex task for the decision and publish only its conclusion.", concreteEffects: ["Creates a focused Codex task"], pros: ["Keeps implementation context compact"], cons: ["Requires task orchestration"], publishedInvestigations: [] },
      ],
      recommendationOptionId: "D-01/B",
      recommendationRationale: "A focused task preserves comparison without diluting implementation context.",
      acceptedOptionId: "D-01/B",
      acceptedRationale: "The learning conversation belongs in a separate Codex task.",
      acceptedAt: "2026-07-18T09:10:00.000Z",
      revisions: [{ acceptedAt: "2026-07-18T08:20:00.000Z", optionId: "D-01/A", rationale: "The initial approach minimized orchestration." }],
      publishedInvestigations: [],
    }],
    plan: [
      { id: "P-01", title: "Persist the Work Item", decisionIds: ["D-01"], outcome: "One readable Markdown record round-trips through Nimbus.", implementationBoundary: "Only the canonical Markdown compiler owns durable state.", publishedInvestigations: [] },
      { id: "P-02", title: "Map implementation evidence", decisionIds: ["D-01"], outcome: "Every implementation result names repository file and line evidence.", implementationBoundary: "Evidence stays repository-relative and line-based.", publishedInvestigations: [] },
    ],
    implementation: [
      { id: "IR-01", planItemId: "P-01", actualResult: "Nimbus serializes and parses the Work Item as readable Markdown.", deviation: null, evidence: [{ path: "src/core/work-item-markdown.ts", startLine: 30, endLine: 89, description: "Canonical Markdown serialization and parsing", role: "implements" }], publishedInvestigations: [] },
      { id: "IR-02", planItemId: "P-02", actualResult: "Implementation results keep repository-relative line evidence.", deviation: null, evidence: [{ path: "src/core/evidence.ts", startLine: 15, endLine: 42, description: "Evidence path and line validation", role: "implements" }], publishedInvestigations: [] },
    ],
    handoff: {
      summary: ["Nimbus keeps a durable Work Item from Grill through Handoff."],
      contracts: ["Markdown is canonical", "Browser actions return to Codex"],
      unresolved: ["Sites publication requires a live Codex Publisher task"],
      nextActions: ["Open a new Work Item through Nimbus MCP"],
      deliveryActions: [],
      publishedInvestigations: [],
    },
    publishedInvestigations: [],
  };
}
