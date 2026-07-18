import { describe, expect, it } from "vitest";

import { createDemoRuntime } from "../../src/server/demo";

const workItemHash = async (
  runtime: ReturnType<typeof createDemoRuntime>,
): Promise<string> => (await runtime.getWorkItem()).browser.documentHash;

const waitForRuntimeMutation = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

describe("Nimbus runtime lifecycle", () => {
  it("runs Grill through accepted Handoff with one active Plan Item", async (): Promise<void> => {
    const runtime = createDemoRuntime({
      initialWorkItem: null,
      store: null,
      reviewUrl: (): string => "http://127.0.0.1:5173",
      repositoryRoot: process.cwd(),
    });
    const decision = runtime.presentDecision({
      workItemId: "NIM-001",
      expectedDocumentHash: await workItemHash(runtime),
      decision: {
        id: "D-01",
        question: "Where should interrogation happen?",
        context: "Deep questions must not consume implementation context.",
        options: [
          {
            id: "D-01/A",
            label: "Forked task",
            explanation: "Use a separate Codex task.",
            concreteEffects: ["Keeps context isolated"],
            pros: ["Deep exploration"],
            cons: ["Creates task lifecycle work"],
          },
          {
            id: "D-01/B",
            label: "Main task",
            explanation: "Keep questions in implementation.",
            concreteEffects: ["Shares context"],
            pros: ["Fewer tasks"],
            cons: ["Noisy context"],
          },
        ],
        recommendationOptionId: "D-01/A",
        recommendationReason: "The implementation task remains focused.",
      },
    });
    await waitForRuntimeMutation();
    await runtime.selectDecisionOption(
      "D-01",
      "D-01/A",
      "I need an isolated teaching conversation.",
      await workItemHash(runtime),
    );
    await expect(decision).resolves.toMatchObject({ workItemId: "NIM-001" });

    const plan = runtime.presentPlan({
      workItemId: "NIM-001",
      expectedDocumentHash: await workItemHash(runtime),
      document: "# Plan\n\n## P-01\n\nCreate the runtime lifecycle.",
      items: [
        {
          id: "P-01",
          title: "Create lifecycle",
          outcome: "A Plan Item maps to one Result.",
          decisionRefs: ["D-01"],
        },
      ],
    });
    await waitForRuntimeMutation();
    await runtime.submitPlanChangeSet([], await workItemHash(runtime));
    await expect(plan).resolves.toMatchObject({ approved: true });

    await runtime.beginPlanItem({
      workItemId: "NIM-001",
      planItemId: "P-01",
      activityPhrase: "Editing code",
      expectedDocumentHash: await workItemHash(runtime),
    });
    await expect(
      runtime.beginPlanItem({
        workItemId: "NIM-001",
        planItemId: "P-01",
        activityPhrase: "Editing code",
        expectedDocumentHash: await workItemHash(runtime),
      }),
    ).rejects.toMatchObject({ message: "A Plan Item is already active" });
    await runtime.reportImplementationItem({
      workItemId: "NIM-001",
      planItemId: "P-01",
      expectedDocumentHash: await workItemHash(runtime),
      result: {
        id: "IR-01",
        actualResult: "The runtime reports one completed implementation item.",
        deviation: null,
        evidence: [
          {
            path: "src/server/demo.ts",
            startLine: 1,
            endLine: 1,
            role: "implements",
          },
        ],
      },
    });

    const review = runtime.presentReview({ workItemId: "NIM-001" });
    await waitForRuntimeMutation();
    await runtime.acceptReview(await workItemHash(runtime));
    await expect(review).resolves.toMatchObject({ accepted: true });

    const handoff = runtime.presentHandoff({
      workItemId: "NIM-001",
      expectedDocumentHash: await workItemHash(runtime),
      handoff: {
        outcome: ["Implemented the lifecycle."],
        decisions: ["D-01/A"],
        deviations: [],
        contracts: [],
        unresolved: [],
        nextActions: [],
      },
    });
    await waitForRuntimeMutation();
    await runtime.acceptHandoff(await workItemHash(runtime));
    await expect(handoff).resolves.toMatchObject({ accepted: true });
    expect((await runtime.getWorkItem()).workItem.phase).toBe("complete");
  });
});
