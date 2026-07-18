import { describe, expect, it } from "vitest";

import {
  parseWorkItemMarkdown,
  serializeWorkItemMarkdown,
} from "../../src/core/work-item-markdown";
import { WorkItemMarkdownError } from "../../src/core/errors";
import { createDemoWorkItem } from "../../examples/demo-work-item";

describe("Work Item Markdown persistence", () => {
  it("parses the human-readable canonical document without fenced YAML body payloads", () => {
    const markdown = `---
id: NIM-001
title: Canonical document
phase: grilling
source: null
createdAt: 2026-07-18T08:00:00Z
updatedAt: 2026-07-18T08:00:00Z
tasks: {}
---

# Brief

## Problem

Preserve development reasoning.

## Goal

Keep one durable Work Item.

## Scope

- Markdown only.

## Constraints

- Codex owns implementation.

## Acceptance criteria

- The document is readable.

# Decisions

# Plan

# Implementation

# Handoff

## Summary

- Foundation created.

## Contracts

- Markdown is canonical.

## Unresolved

- None.

## Next actions

- Continue.

## Delivery actions

- None.
`;

    expect(parseWorkItemMarkdown(markdown).brief.goal).toBe(
      "Keep one durable Work Item.",
    );
  });

  it("round-trips the full demo Work Item including accepted decisions and revisions", () => {
    const original = createDemoWorkItem();
    const markdown = serializeWorkItemMarkdown(original);

    expect(markdown.match(/^# /gm)).toHaveLength(5);
    expect(markdown).toContain("<summary>Revision history</summary>");
    expect(parseWorkItemMarkdown(markdown)).toEqual(original);
  });

  it("rejects a document without the canonical five sections", () => {
    const markdown = serializeWorkItemMarkdown(createDemoWorkItem()).replace(
      "# Handoff",
      "# Notes",
    );

    expect(() => parseWorkItemMarkdown(markdown)).toThrow(
      WorkItemMarkdownError,
    );
  });
});
