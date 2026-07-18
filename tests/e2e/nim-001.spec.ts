import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { nim001, testIds } from "../fixtures/nim-001.contract";

function byTestId(page: Page, testId: string): Locator {
  return page.getByTestId(testId);
}

async function expectNonBlank(page: Page): Promise<void> {
  await expect(byTestId(page, testIds.app)).toBeVisible();
  await expect(page.locator("body")).not.toHaveText(/^\s*$/);
}

async function expectNoViewportOverflow(page: Page): Promise<void> {
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );

  expect(hasHorizontalOverflow).toBeFalsy();
}

async function expectActionIsNotObscured(
  page: Page,
  locator: Locator,
): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();

  if (!box) {
    return;
  }

  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const target = await page.evaluate(
    ({ x, y }) =>
      document
        .elementFromPoint(x, y)
        ?.closest("button, [role='button']")
        ?.getAttribute("data-testid"),
    point,
  );

  expect(target).toBe(await locator.getAttribute("data-testid"));
}

test.describe("NIM-001 demo work item", () => {
  test("takes a work item from decision interrogation through handoff", async ({
    page,
  }, testInfo) => {
    testInfo.skip(
      testInfo.project.name !== "desktop",
      "The complete workflow is captured at the desktop review size.",
    );

    await page.goto("/");
    await byTestId(page, "reset-demo").click();
    await expectNonBlank(page);
    await expect(byTestId(page, testIds.workItem)).toContainText(nim001.id);
    await expect(byTestId(page, testIds.decision)).toBeVisible();

    await expect(byTestId(page, testIds.decisionRoom)).toBeVisible();
    await expect(byTestId(page, testIds.decisionQuestion)).toContainText(
      "preserve the developer's interrogation context",
    );
    await page.screenshot({
      path: testInfo.outputPath("nim-001-decision-room.png"),
      fullPage: true,
      animations: "disabled",
    });

    await byTestId(page, testIds.decisionChatInput).fill(nim001.question);
    await byTestId(page, testIds.sendDecisionChat).click();
    await expect(
      byTestId(page, testIds.decisionChatMessage).last(),
    ).not.toHaveText(/^\s*$/);

    await byTestId(page, testIds.option).click();
    await expectActionIsNotObscured(
      page,
      byTestId(page, testIds.acceptDecision),
    );
    await byTestId(page, testIds.acceptDecision).click();

    await expect(byTestId(page, testIds.plan)).toBeVisible();
    const executionSequence = byTestId(page, "execution-sequence");
    await executionSequence.scrollIntoViewIfNeeded();
    await expect(executionSequence.locator("svg")).toBeVisible();
    await executionSequence.screenshot({
      path: testInfo.outputPath("nim-001-plan-sequence.png"),
      animations: "disabled",
    });
    await expectActionIsNotObscured(page, byTestId(page, testIds.approvePlan));
    await byTestId(page, testIds.approvePlan).click();
    await expect(byTestId(page, testIds.workItemPhase)).toContainText(
      /implementation/i,
    );

    for (let step = 0; step < 2; step += 1) {
      await byTestId(page, testIds.advanceDemo).click();
    }

    await byTestId(page, testIds.evidenceTab).click();
    await expect(byTestId(page, testIds.implementation)).toBeVisible();
    await expect(byTestId(page, testIds.implementationMapping)).toBeVisible();
    await expect(byTestId(page, testIds.fidelity)).toContainText(
      /matched|deviated/i,
    );
    await expect(byTestId(page, testIds.evidence)).toContainText(
      nim001.evidencePath,
    );
    await page.screenshot({
      path: testInfo.outputPath("nim-001-implementation-map.png"),
      fullPage: true,
      animations: "disabled",
    });

    await byTestId(page, testIds.advanceDemo).click();
    await byTestId(page, testIds.handoffTab).click();
    await expect(byTestId(page, testIds.handoff)).toBeVisible();

    const markdown = await readFile(
      path.resolve(process.cwd(), "docs", "nimbus", `${nim001.id}.md`),
      "utf8",
    );
    expect(markdown).toContain(nim001.id);
    expect(markdown).toContain("# Implementation");

    await expectNoViewportOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("nim-001-complete.png"),
      fullPage: true,
      animations: "disabled",
    });
  });

  test("renders a nonblank, non-overflowing mobile work item view", async ({
    page,
  }, testInfo) => {
    testInfo.skip(
      testInfo.project.name !== "mobile",
      "This visual guard runs at the mobile review size.",
    );

    await page.goto("/");
    await expectNonBlank(page);
    await expect(byTestId(page, testIds.workItem)).toContainText(nim001.id);
    await expectNoViewportOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("nim-001-mobile-initial.png"),
      fullPage: true,
      animations: "disabled",
    });
  });
});
