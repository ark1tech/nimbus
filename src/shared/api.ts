import type { WorkItem } from "@/shared/model";

export type DecisionSelectionRequest = {
  optionId: string;
  rationale: string;
  expectedDocumentHash: string;
};

export interface NimbusApi {
  getWorkItem: () => Promise<WorkItem>;
  selectDecisionOption: (
    decisionId: string,
    request: DecisionSelectionRequest,
  ) => Promise<WorkItem>;
  approvePlan: () => Promise<WorkItem>;
  advanceDemo: () => Promise<WorkItem>;
  resetDemo: () => Promise<WorkItem>;
}
