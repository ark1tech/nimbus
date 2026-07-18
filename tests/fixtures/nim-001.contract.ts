export const nim001 = {
  id: "NIM-001",
  decisionId: "D-01",
  optionId: "D-01-A",
  question:
    "Why should a decision use a dedicated, resumable chat instead of the implementation chat?",
  evidencePath: "src/server/codex/decision-chat.ts",
} as const;

/**
 * Product-owned hooks required by the E2E journey.
 *
 * Tests deliberately depend on these semantic identifiers instead of visual
 * structure or prose. Integration owns adding them to the browser layer.
 */
export const testIds = {
  app: "nimbus-app",
  workItem: "work-item-NIM-001",
  workItemPhase: "work-item-phase",
  decision: "decision-D-01",
  decisionRoom: "decision-room-D-01",
  decisionQuestion: "decision-question",
  decisionChatInput: "decision-chat-input",
  sendDecisionChat: "send-decision-chat",
  decisionChatMessage: "decision-chat-message",
  option: "option-D-01-A",
  acceptDecision: "accept-decision",
  plan: "implementation-plan",
  approvePlan: "approve-plan",
  advanceDemo: "advance-demo",
  implementation: "implementation-map",
  evidenceTab: "implementation-tab",
  handoffTab: "handoff-tab",
  implementationMapping: "implementation-mapping-D-01.r1",
  fidelity: "implementation-fidelity-D-01.r1",
  evidence: "evidence-D-01.r1",
  handoff: "handoff",
} as const;

export type NimbusTestId = (typeof testIds)[keyof typeof testIds];
