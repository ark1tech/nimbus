import { describe, expect, it } from "vitest";

import type {
  StartedNimbusTask,
  StartNimbusTaskInput,
} from "../../../src/server/codex/task-gateway";
import {
  ConsumedHandoffPublicationAttemptError,
  HandoffPublicationAttemptBindingError,
  HandoffSitePublisher,
  HandoffSiteReachabilityError,
  InvalidHandoffSiteUrlError,
  sha256,
  type HandoffSiteReachabilityProbe,
  type PublicationWarningFields,
} from "../../../src/server/publish/handoff-site-publisher";

const handoffMarkdown = [
  "# Handoff",
  "",
  "## Summary",
  "",
  "- Server-side sessions now support revocation.",
  "",
  "## Unresolved",
  "",
  "- Confirm production key rotation.",
].join("\n");

function createStartedTask(): StartedNimbusTask {
  return {
    threadId: "publisher-thread",
    turnId: "publisher-turn",
    model: "gpt-5.6-terra",
    title: "NIM-001 - Publish Handoff",
    navigationUrl: "codex://threads/publisher-thread",
  };
}

function createPublisher(input: {
  probe: HandoffSiteReachabilityProbe;
  warningFields: PublicationWarningFields[];
  receivedTaskInputs: StartNimbusTaskInput[];
  tokens: string[];
  slept: number[];
}): HandoffSitePublisher {
  return new HandoffSitePublisher({
    taskLauncher: {
      startTask: async (
        taskInput: StartNimbusTaskInput,
      ): Promise<StartedNimbusTask> => {
        input.receivedTaskInputs.push(taskInput);
        return createStartedTask();
      },
    },
    reachabilityProbe: input.probe,
    warningLogger: {
      warn: (_message: string, fields: PublicationWarningFields): void => {
        input.warningFields.push(fields);
      },
    },
    retryPolicy: { maxAttempts: 3, retryDelayMs: 10, timeoutMs: 500 },
    createAttemptToken: (): string => {
      const token = input.tokens.shift();
      if (token === undefined) {
        throw new Error("Test did not provide a publication attempt token.");
      }
      return token;
    },
    now: (): Date => new Date("2026-07-18T12:00:00.000Z"),
    sleep: async (milliseconds: number): Promise<void> => {
      input.slept.push(milliseconds);
    },
  });
}

async function beginPublication(publisher: HandoffSitePublisher): Promise<{
  packet: { acceptedHandoffDigest: string; publicationAttemptToken: string };
}> {
  return publisher.beginPublication({
    workItemId: "NIM-001",
    workItemTitle: "Add server-side sessions",
    model: "gpt-5.6-terra",
    expectedDocumentHash: "a".repeat(64),
    acceptedHandoffMarkdown: handoffMarkdown,
  });
}

describe("HandoffSitePublisher", () => {
  it("creates a one-use task packet bound to the accepted Handoff digest", async () => {
    const receivedTaskInputs: StartNimbusTaskInput[] = [];
    const publisher = createPublisher({
      probe: { check: async (): Promise<void> => undefined },
      warningFields: [],
      receivedTaskInputs,
      tokens: ["attempt-1"],
      slept: [],
    });

    const result = await beginPublication(publisher);

    expect(result.packet).toMatchObject({
      acceptedHandoffDigest: sha256(handoffMarkdown),
      publicationAttemptToken: "attempt-1",
    });
    expect(receivedTaskInputs).toHaveLength(1);
    expect(receivedTaskInputs[0]).toMatchObject({
      taskKind: "publisher",
      title: "NIM-001 - Publish Handoff",
      model: "gpt-5.6-terra",
      context: {
        workItemId: "NIM-001",
        taskKind: "publisher",
      },
    });
    expect(receivedTaskInputs[0]?.context.instructions).toContain(
      "Use the Sites plugin",
    );
    expect(receivedTaskInputs[0]?.context.instructions).toContain(
      "record_handoff_site",
    );
    expect(receivedTaskInputs[0]?.context.instructions).toContain("attempt-1");
  });

  it("retries real reachability and returns persistence plus opening output", async () => {
    let checks = 0;
    const warnings: PublicationWarningFields[] = [];
    const slept: number[] = [];
    const publisher = createPublisher({
      probe: {
        check: async (): Promise<void> => {
          checks += 1;
          if (checks < 3) {
            throw new Error(`HTTP 503 on check ${checks}`);
          }
        },
      },
      warningFields: warnings,
      receivedTaskInputs: [],
      tokens: ["attempt-2"],
      slept,
    });
    const started = await beginPublication(publisher);

    const completed = await publisher.recordHandoffSite({
      workItemId: "NIM-001",
      acceptedHandoffDigest: started.packet.acceptedHandoffDigest,
      publicationAttemptToken: started.packet.publicationAttemptToken,
      url: "https://handoff.example.com/nim-001",
    });

    expect(checks).toBe(3);
    expect(slept).toEqual([10, 10]);
    expect(warnings).toEqual([
      {
        workItemId: "NIM-001",
        url: "https://handoff.example.com/nim-001",
        attempt: 1,
        maxAttempts: 3,
        error: "HTTP 503 on check 1",
      },
      {
        workItemId: "NIM-001",
        url: "https://handoff.example.com/nim-001",
        attempt: 2,
        maxAttempts: 3,
        error: "HTTP 503 on check 2",
      },
    ]);
    expect(completed).toMatchObject({
      workItemId: "NIM-001",
      publicationAttemptToken: "attempt-2",
      url: "https://handoff.example.com/nim-001",
      openUrl: "https://handoff.example.com/nim-001",
      reachabilityAttempts: 3,
      recordHandoffSite: {
        workItemId: "NIM-001",
        expectedDocumentHash: "a".repeat(64),
        publicationAttemptToken: "attempt-2",
        url: "https://handoff.example.com/nim-001",
      },
    });
  });

  it("rejects invalid URLs and consumes each attempt after it is used", async () => {
    let checks = 0;
    const publisher = createPublisher({
      probe: {
        check: async (): Promise<void> => {
          checks += 1;
        },
      },
      warningFields: [],
      receivedTaskInputs: [],
      tokens: ["attempt-3"],
      slept: [],
    });
    const started = await beginPublication(publisher);

    await expect(
      publisher.recordHandoffSite({
        workItemId: "NIM-001",
        acceptedHandoffDigest: started.packet.acceptedHandoffDigest,
        publicationAttemptToken: started.packet.publicationAttemptToken,
        url: "http://handoff.example.com/nim-001",
      }),
    ).rejects.toBeInstanceOf(InvalidHandoffSiteUrlError);
    expect(checks).toBe(0);

    await expect(
      publisher.recordHandoffSite({
        workItemId: "NIM-001",
        acceptedHandoffDigest: started.packet.acceptedHandoffDigest,
        publicationAttemptToken: started.packet.publicationAttemptToken,
        url: "https://handoff.example.com/nim-001",
      }),
    ).rejects.toBeInstanceOf(ConsumedHandoffPublicationAttemptError);
  });

  it("rejects a stale binding and raises the final real reachability error", async () => {
    const warnings: PublicationWarningFields[] = [];
    const publisher = createPublisher({
      probe: {
        check: async (): Promise<void> => {
          throw new Error("HTTP 502");
        },
      },
      warningFields: warnings,
      receivedTaskInputs: [],
      tokens: ["attempt-4", "attempt-5"],
      slept: [],
    });
    const started = await beginPublication(publisher);

    await expect(
      publisher.recordHandoffSite({
        workItemId: "NIM-002",
        acceptedHandoffDigest: started.packet.acceptedHandoffDigest,
        publicationAttemptToken: started.packet.publicationAttemptToken,
        url: "https://handoff.example.com/nim-001",
      }),
    ).rejects.toBeInstanceOf(HandoffPublicationAttemptBindingError);

    const retry = await beginPublication(publisher);
    await expect(
      publisher.recordHandoffSite({
        workItemId: "NIM-001",
        acceptedHandoffDigest: retry.packet.acceptedHandoffDigest,
        publicationAttemptToken: retry.packet.publicationAttemptToken,
        url: "https://handoff.example.com/nim-001",
      }),
    ).rejects.toBeInstanceOf(HandoffSiteReachabilityError);
    expect(warnings).toHaveLength(3);
  });
});
