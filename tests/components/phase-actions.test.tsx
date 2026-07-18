// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type {
  NimbusBrowserState,
  NimbusWorkItem,
} from "../../src/app/nimbus-api";
import { nimbusApi } from "../../src/app/nimbus-api";
import { PlanView } from "../../src/components/nimbus/plan-view";

const workItem: NimbusWorkItem = {
  id: "TEST-001",
  title: "Test Nimbus",
  phase: "plan",
  brief: {
    problem: "Test the browser action.",
    goal: "Approve the Plan.",
    scope: [],
    constraints: [],
    acceptanceCriteria: [],
  },
  decisions: [],
  plan: {
    document: "# Plan\n\nApprove this Plan.",
    items: [
      {
        id: "P-01",
        title: "Approve Plan",
        outcome: "Implementation can begin.",
        decisionRefs: [],
        status: "pending",
      },
    ],
  },
  implementation: [],
  investigations: [],
  handoff: null,
  deliveryActions: { handoffSiteUrl: null },
};

const browser: NimbusBrowserState = {
  documentHash: "a".repeat(64),
  activePlanItemId: null,
  activityPhrase: null,
  pendingLaunch: null,
  pendingPlanChangeSet: [],
  pendingCorrectionSet: [],
  publicationAttempt: null,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const originalFetch = globalThis.fetch;

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach((): void => {
  if (root !== null) {
    act((): void => root?.unmount());
  }
  container?.remove();
  globalThis.fetch = originalFetch;
  root = null;
  container = null;
});

describe("Nimbus phase actions", () => {
  it("offers an explicit Plan approval action", (): void => {
    let approvalCount = 0;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act((): void => {
      root?.render(
        <PlanView
          workItem={workItem}
          browser={browser}
          onSubmit={(): void => undefined}
          onApprove={(): void => {
            approvalCount += 1;
          }}
          onInvestigate={(): void => undefined}
        />,
      );
    });

    const approveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Approve plan") === true,
    );
    expect(approveButton).toBeDefined();

    act((): void => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(approvalCount).toBe(1);
  });

  it("submits Review acceptance to the runtime", async (): Promise<void> => {
    const calls: string[] = [];
    globalThis.fetch = async (
      input: string | URL | Request,
    ): Promise<Response> => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({
          workItem: { ...workItem, phase: "review" },
          browser,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    await nimbusApi.acceptReview(browser.documentHash);

    expect(calls).toEqual(["/api/review/accept"]);
  });
});
