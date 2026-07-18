import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  validateEvidenceLink,
  validateEvidenceLocator,
  validateEvidencePath,
} from "../../src/core/evidence";
import { EvidenceValidationError } from "../../src/core/errors";

describe("evidence validation", () => {
  const repositoryRoot = path.resolve("/workspace/nimbus");

  it("validates an in-repository path and symbol locator against an inspected snapshot", () => {
    const evidence = validateEvidenceLink(
      {
        rootPath: repositoryRoot,
        files: {
          "src/core/work-item.ts": "export function persistWorkItem(): void {}",
        },
      },
      {
        id: "E-01",
        path: "src/core/work-item.ts",
        locator: "#persistWorkItem",
        role: "implements",
        valid: false,
      },
    );

    expect(evidence).toMatchObject({
      valid: true,
      absolutePath: "/workspace/nimbus/src/core/work-item.ts",
    });
  });

  it("accepts a stable quoted snippet", () => {
    expect(() =>
      validateEvidenceLocator(
        'const cookieName = "nimbus_session";',
        '#"nimbus_session"',
      ),
    ).not.toThrow();
  });

  it("rejects an evidence path that escapes the repository root", () => {
    expect(() =>
      validateEvidencePath(repositoryRoot, "../secrets.txt"),
    ).toThrow(EvidenceValidationError);
  });
});
