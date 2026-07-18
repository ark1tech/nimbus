import { createHash } from "node:crypto";

import { marked, type Token, type Tokens } from "marked";
import { parse, stringify } from "yaml";

import type {
  Decision,
  DecisionOption,
  DecisionRevision,
  EvidenceLink,
  Handoff,
  ImplementationResult,
  InvestigationOwner,
  PlanItem,
  PublishedInvestigation,
  WorkItem,
  WorkItemBrief,
  WorkItemTasks,
  WorkItemUpdate,
} from "../shared/model";
import { WorkItemMarkdownError } from "./errors";

const SECTION_NAMES = [
  "Brief",
  "Decisions",
  "Plan",
  "Implementation",
  "Handoff",
] as const;
const WORK_ITEM_PHASES = [
  "grilling",
  "planning",
  "implementing",
  "review",
  "handoff",
  "complete",
] as const;
const EVIDENCE_ROLES = [
  "implements",
  "verifies",
  "configures",
  "contradicts",
] as const;

type SectionName = (typeof SECTION_NAMES)[number];
type UnknownRecord = Record<string, unknown>;
type Section = { name: SectionName; tokens: Token[] };

interface FrontMatter {
  id: string;
  title: string;
  phase: WorkItem["phase"];
  source: string | null;
  createdAt: string;
  updatedAt: string;
  tasks: WorkItemTasks;
}

export function serializeWorkItemMarkdown(workItem: WorkItem): string {
  validateWorkItem(workItem);
  const frontMatter: FrontMatter = {
    id: workItem.id,
    title: workItem.title,
    phase: workItem.phase,
    source: workItem.source,
    createdAt: workItem.createdAt,
    updatedAt: workItem.updatedAt,
    tasks: workItem.tasks,
  };
  const markdown = [
    "---",
    stringify(frontMatter, { lineWidth: 0 }).trimEnd(),
    "---",
    "",
    serializeBrief(workItem.brief, workItem.publishedInvestigations),
    serializeDecisions(workItem.decisions),
    serializePlan(workItem.plan),
    serializeImplementation(workItem.implementation, workItem.plan),
    serializeHandoff(workItem.handoff),
    "",
  ].join("\n");

  return normalizeMarkdown(markdown);
}

export function parseWorkItemMarkdown(markdown: string): WorkItem {
  const document = extractDocument(markdown);
  const frontMatter = parseFrontMatter(document.frontMatter);
  const sections = extractSections(marked.lexer(document.body));
  const workItem: WorkItem = {
    id: requireString(frontMatter, "id", "front matter"),
    title: requireString(frontMatter, "title", "front matter"),
    phase: requireEnum(
      requireString(frontMatter, "phase", "front matter"),
      WORK_ITEM_PHASES,
      "front matter.phase",
    ),
    source: requireNullableString(frontMatter, "source", "front matter"),
    createdAt: requireString(frontMatter, "createdAt", "front matter"),
    updatedAt: requireString(frontMatter, "updatedAt", "front matter"),
    tasks: parseTasks(frontMatter.tasks),
    brief: parseBrief(section(sections, "Brief")),
    decisions: parseDecisions(section(sections, "Decisions")),
    plan: parsePlan(section(sections, "Plan")),
    implementation: parseImplementation(section(sections, "Implementation")),
    handoff: parseHandoff(section(sections, "Handoff")),
    publishedInvestigations: parsePublishedInvestigations(
      section(sections, "Brief"),
      "Brief",
    ),
  };
  validateWorkItem(workItem);
  return workItem;
}

export function hashWorkItemMarkdown(markdown: string): string {
  const workItem = parseWorkItemMarkdown(markdown);
  return createHash("sha256")
    .update(serializeWorkItemMarkdown(workItem), "utf8")
    .digest("hex");
}

export function applyWorkItemUpdate(
  workItem: WorkItem,
  update: WorkItemUpdate,
): WorkItem {
  switch (update.type) {
    case "decision.accept":
      return acceptDecision(workItem, update);
    case "implementation.report":
      return reportImplementation(workItem, update.result);
    case "investigation.publish":
      return publishInvestigation(workItem, update.owner, update.investigation);
    case "handoff.delivery-action.add":
      return addDeliveryAction(workItem, update.deliveryAction);
    default: {
      const exhaustive: never = update;
      throw new WorkItemMarkdownError(
        `Unsupported Work Item update: ${JSON.stringify(exhaustive)}.`,
      );
    }
  }
}

export function validateWorkItem(workItem: WorkItem): void {
  requireMatch(workItem.id, /^[A-Z][A-Z0-9]*-\d+$/, "Work Item id");
  requireText(workItem.title, "Work Item title");
  requireEnum(workItem.phase, WORK_ITEM_PHASES, "Work Item phase");
  validateTasks(workItem.tasks);
  validateBrief(workItem.brief);
  validateInvestigations(workItem.publishedInvestigations, "Work Item");

  const decisionIds = new Set<string>();
  const optionIds = new Set<string>();
  for (const decision of workItem.decisions) {
    requireUnique(decisionIds, decision.id, "Decision");
    validateDecision(decision, optionIds);
  }

  const planIds = new Set<string>();
  for (const planItem of workItem.plan) {
    requireUnique(planIds, planItem.id, "Plan Item");
    validatePlanItem(planItem, decisionIds);
  }

  const resultIds = new Set<string>();
  const resultPlanIds = new Set<string>();
  for (const result of workItem.implementation) {
    requireUnique(resultIds, result.id, "Implementation Result");
    requireUnique(
      resultPlanIds,
      result.planItemId,
      "Implementation Result for Plan Item",
    );
    validateImplementationResult(result, planIds);
  }

  if (
    ["handoff", "complete"].includes(workItem.phase) &&
    resultPlanIds.size !== planIds.size
  ) {
    throw new WorkItemMarkdownError(
      "Every accepted Plan Item must have exactly one Implementation Result before Handoff.",
    );
  }
  validateHandoff(workItem.handoff);
}

function serializeBrief(
  brief: WorkItemBrief,
  investigations: PublishedInvestigation[],
): string {
  return [
    "# Brief",
    "",
    "## Problem",
    "",
    brief.problem,
    "",
    "## Goal",
    "",
    brief.goal,
    "",
    "## Scope",
    "",
    serializeList(brief.scope),
    "",
    "## Constraints",
    "",
    serializeList(brief.constraints),
    "",
    "## Acceptance criteria",
    "",
    serializeList(brief.acceptanceCriteria),
    serializePublishedInvestigations(investigations),
    "",
  ].join("\n");
}

function serializeDecisions(decisions: Decision[]): string {
  return [
    "# Decisions",
    "",
    ...decisions.flatMap((decision) => serializeDecision(decision)),
    "",
  ].join("\n");
}

function serializeDecision(decision: Decision): string[] {
  const accepted =
    decision.acceptedOptionId === null
      ? "Not accepted yet."
      : `\`${decision.acceptedOptionId}\`, because ${decision.acceptedRationale}`;
  const acceptedAt =
    decision.acceptedAt === null ? "" : ` Accepted ${decision.acceptedAt}.`;
  return [
    `## ${decision.id}: ${decision.title}`,
    "",
    "### Context",
    "",
    decision.context,
    "",
    "### Options",
    "",
    ...decision.options.flatMap((option) => serializeOption(option)),
    "### Recommendation",
    "",
    `\`${decision.recommendationOptionId}\`, because ${decision.recommendationRationale}`,
    "",
    "### Accepted",
    "",
    `${accepted}${acceptedAt}`,
    ...serializeRevisions(decision.revisions),
    ...serializePublishedInvestigations(decision.publishedInvestigations),
    "",
  ];
}

function serializeOption(option: DecisionOption): string[] {
  return [
    `#### ${option.id}: ${option.title}`,
    "",
    option.explanation,
    "",
    "**Concrete effects**",
    "",
    serializeList(option.concreteEffects),
    "",
    "**Pros**",
    "",
    serializeList(option.pros),
    "",
    "**Cons**",
    "",
    serializeList(option.cons),
    ...serializePublishedInvestigations(option.publishedInvestigations),
    "",
  ];
}

function serializeRevisions(revisions: DecisionRevision[]): string[] {
  if (revisions.length === 0) return [];
  return [
    "<details>",
    "<summary>Revision history</summary>",
    "",
    ...revisions.map(
      (revision, index) =>
        `${index + 1}. \`${revision.acceptedAt}\` - Accepted \`${revision.optionId}\` because ${revision.rationale}`,
    ),
    "",
    "</details>",
  ];
}

function serializePlan(plan: PlanItem[]): string {
  return [
    "# Plan",
    "",
    ...plan.flatMap((item) => [
      `## ${item.id}: ${item.title}`,
      "",
      `**Supports:** ${item.decisionIds.join(", ")}`,
      "",
      `**Outcome:** ${item.outcome}`,
      "",
      `**Implementation boundary:** ${item.implementationBoundary}`,
      ...serializePublishedInvestigations(item.publishedInvestigations),
      "",
    ]),
    "",
  ].join("\n");
}

function serializeImplementation(
  results: ImplementationResult[],
  plan: PlanItem[],
): string {
  const planTitles = new Map(plan.map((item) => [item.id, item.title]));
  return [
    "# Implementation",
    "",
    ...results.flatMap((result) => [
      `## ${result.planItemId}: ${planTitles.get(result.planItemId) ?? "Plan Item"}`,
      "",
      `### ${result.id}: Implemented`,
      "",
      `**Actual result:** ${result.actualResult}`,
      "",
      `**Deviation:** ${result.deviation ?? "None."}`,
      "",
      "**Code evidence**",
      "",
      ...result.evidence.map(
        (evidence) =>
          `- \`${evidence.path}:${evidence.startLine}-${evidence.endLine}\` - ${evidence.description} (${evidence.role}).`,
      ),
      ...serializePublishedInvestigations(result.publishedInvestigations),
      "",
    ]),
    "",
  ].join("\n");
}

function serializeHandoff(handoff: Handoff): string {
  return [
    "# Handoff",
    "",
    "## Summary",
    "",
    serializeList(handoff.summary),
    "",
    "## Contracts",
    "",
    serializeList(handoff.contracts),
    "",
    "## Unresolved",
    "",
    serializeList(handoff.unresolved),
    "",
    "## Next actions",
    "",
    serializeList(handoff.nextActions),
    "",
    "## Delivery actions",
    "",
    serializeList(handoff.deliveryActions),
    ...serializePublishedInvestigations(handoff.publishedInvestigations),
    "",
  ].join("\n");
}

function serializePublishedInvestigations(
  investigations: PublishedInvestigation[],
): string[] {
  if (investigations.length === 0) return [];
  return [
    "",
    "**Published investigations**",
    "",
    ...investigations.map(
      (investigation) =>
        `- \`${investigation.publishedAt}\` - **Conclusion:** ${investigation.conclusion} **Rationale:** ${investigation.rationale} **Evidence:** ${investigation.evidence} **Unresolved:** ${investigation.unresolved} **Task:** \`${investigation.taskUrl}\``,
    ),
  ];
}

function serializeList(items: string[]): string {
  return items.length === 0
    ? "- None."
    : items.map((item) => `- ${item}`).join("\n");
}

function extractDocument(markdown: string): {
  frontMatter: string;
  body: string;
} {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (match === null)
    throw new WorkItemMarkdownError(
      "Work Item Markdown must begin with YAML front matter.",
    );
  return { frontMatter: match[1], body: normalized.slice(match[0].length) };
}

function normalizeMarkdown(markdown: string): string {
  const document = extractDocument(markdown);
  const tokens = marked.lexer(document.body);
  return (
    [
      "---",
      document.frontMatter.trimEnd(),
      "---",
      "",
      ...tokens.map((token) => token.raw),
    ]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

function parseFrontMatter(frontMatter: string): UnknownRecord {
  try {
    return requireRecord(parse(frontMatter), "front matter");
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? error.message : "unknown YAML parse failure";
    throw new WorkItemMarkdownError(`Could not parse front matter: ${detail}`);
  }
}

function extractSections(tokens: Token[]): Section[] {
  rejectYamlPayloads(tokens);
  const headings = tokens.filter(isTopLevelHeading);
  if (
    headings.length !== SECTION_NAMES.length ||
    !SECTION_NAMES.every((name, index) => headings[index]?.text === name)
  ) {
    throw new WorkItemMarkdownError(
      "Work Item Markdown must contain exactly these top-level sections in canonical order: Brief, Decisions, Plan, Implementation, Handoff.",
    );
  }
  const sections: Section[] = [];
  for (let index = 0; index < SECTION_NAMES.length; index += 1) {
    const headingIndex = tokens.indexOf(headings[index]);
    const nextHeadingIndex =
      index + 1 < headings.length
        ? tokens.indexOf(headings[index + 1])
        : tokens.length;
    sections.push({
      name: SECTION_NAMES[index],
      tokens: meaningful(tokens.slice(headingIndex + 1, nextHeadingIndex)),
    });
  }
  return sections;
}

function section(sections: Section[], name: SectionName): Token[] {
  const found = sections.find((entry) => entry.name === name);
  if (found === undefined)
    throw new WorkItemMarkdownError(`Missing ${name} section.`);
  return found.tokens;
}

function parseTasks(value: unknown): WorkItemTasks {
  const record = requireRecord(value, "front matter.tasks");
  return {
    orchestrator: requireOptionalNullableString(
      record,
      "orchestrator",
      "front matter.tasks",
    ),
    grill: requireOptionalNullableString(record, "grill", "front matter.tasks"),
    plan: requireOptionalNullableString(record, "plan", "front matter.tasks"),
    implement: requireOptionalNullableString(
      record,
      "implement",
      "front matter.tasks",
    ),
    review: requireOptionalNullableString(
      record,
      "review",
      "front matter.tasks",
    ),
    handoff: requireOptionalNullableString(
      record,
      "handoff",
      "front matter.tasks",
    ),
  };
}

function parseBrief(tokens: Token[]): WorkItemBrief {
  assertNoTranscript(tokens, "Brief");
  return {
    problem: requiredHeadingText(tokens, "Problem", 2, "Brief"),
    goal: requiredHeadingText(tokens, "Goal", 2, "Brief"),
    scope: requiredHeadingList(tokens, "Scope", 2, "Brief"),
    constraints: requiredHeadingList(tokens, "Constraints", 2, "Brief"),
    acceptanceCriteria: requiredHeadingList(
      tokens,
      "Acceptance criteria",
      2,
      "Brief",
    ),
  };
}

function parseDecisions(tokens: Token[]): Decision[] {
  assertNoTranscript(tokens, "Decisions");
  return splitHeadings(tokens, 2, "Decision").map((entry) =>
    parseDecision(entry.heading, entry.tokens),
  );
}

function parseDecision(heading: Tokens.Heading, tokens: Token[]): Decision {
  const match = /^(D-\d{2}): (.+)$/.exec(heading.text);
  if (match === null)
    throw new WorkItemMarkdownError(
      `Invalid Decision heading: ${heading.text}.`,
    );
  const optionsSlice = requiredHeadingSlice(tokens, "Options", 3, match[1]);
  const options = splitHeadings(optionsSlice, 4, `${match[1]} option`).map(
    (entry) => parseOption(entry.heading, entry.tokens),
  );
  const recommendation = parseOptionReference(
    requiredHeadingText(tokens, "Recommendation", 3, match[1]),
    "Recommendation",
    match[1],
  );
  const accepted = parseAccepted(
    requiredHeadingText(tokens, "Accepted", 3, match[1]),
    match[1],
  );
  return {
    id: match[1],
    title: match[2],
    context: requiredHeadingText(tokens, "Context", 3, match[1]),
    options,
    recommendationOptionId: recommendation.optionId,
    recommendationRationale: recommendation.rationale,
    acceptedOptionId: accepted.optionId,
    acceptedRationale: accepted.rationale,
    acceptedAt: accepted.acceptedAt,
    revisions: parseRevisions(tokens, match[1]),
    publishedInvestigations: parsePublishedInvestigations(tokens, match[1]),
  };
}

function parseOption(heading: Tokens.Heading, tokens: Token[]): DecisionOption {
  const match = /^(D-\d{2}\/[A-Z]): (.+)$/.exec(heading.text);
  if (match === null)
    throw new WorkItemMarkdownError(
      `Invalid Decision Option heading: ${heading.text}.`,
    );
  return {
    id: match[1],
    title: match[2],
    explanation: firstParagraph(tokens, match[1]),
    concreteEffects: requiredLabelList(tokens, "Concrete effects", match[1]),
    pros: requiredLabelList(tokens, "Pros", match[1]),
    cons: requiredLabelList(tokens, "Cons", match[1]),
    publishedInvestigations: parsePublishedInvestigations(tokens, match[1]),
  };
}

function parsePlan(tokens: Token[]): PlanItem[] {
  assertNoTranscript(tokens, "Plan");
  return splitHeadings(tokens, 2, "Plan Item").map((entry) => {
    const match = /^(P-\d{2}): (.+)$/.exec(entry.heading.text);
    if (match === null)
      throw new WorkItemMarkdownError(
        `Invalid Plan Item heading: ${entry.heading.text}.`,
      );
    return {
      id: match[1],
      title: match[2],
      decisionIds: parseReferences(
        requiredLabelText(entry.tokens, "Supports", match[1]),
        "Supports",
        match[1],
      ),
      outcome: requiredLabelText(entry.tokens, "Outcome", match[1]),
      implementationBoundary: requiredLabelText(
        entry.tokens,
        "Implementation boundary",
        match[1],
      ),
      publishedInvestigations: parsePublishedInvestigations(
        entry.tokens,
        match[1],
      ),
    };
  });
}

function parseImplementation(tokens: Token[]): ImplementationResult[] {
  assertNoTranscript(tokens, "Implementation");
  return splitHeadings(tokens, 2, "Implementation Plan Item").map((entry) => {
    const planMatch = /^(P-\d{2}): (.+)$/.exec(entry.heading.text);
    if (planMatch === null)
      throw new WorkItemMarkdownError(
        `Invalid Implementation heading: ${entry.heading.text}.`,
      );
    const result = splitHeadings(entry.tokens, 3, planMatch[1]);
    if (result.length !== 1)
      throw new WorkItemMarkdownError(
        `${planMatch[1]} must contain exactly one Implementation Result.`,
      );
    const resultMatch = /^(IR-\d{2}): Implemented$/.exec(
      result[0].heading.text,
    );
    if (resultMatch === null)
      throw new WorkItemMarkdownError(
        `Invalid Implementation Result heading: ${result[0].heading.text}.`,
      );
    const deviation = requiredLabelText(
      result[0].tokens,
      "Deviation",
      resultMatch[1],
    );
    return {
      id: resultMatch[1],
      planItemId: planMatch[1],
      actualResult: requiredLabelText(
        result[0].tokens,
        "Actual result",
        resultMatch[1],
      ),
      deviation: deviation === "None." ? null : deviation,
      evidence: requiredEvidence(result[0].tokens, resultMatch[1]),
      publishedInvestigations: parsePublishedInvestigations(
        result[0].tokens,
        resultMatch[1],
      ),
    };
  });
}

function parseHandoff(tokens: Token[]): Handoff {
  assertNoTranscript(tokens, "Handoff");
  return {
    summary: requiredHeadingList(tokens, "Summary", 2, "Handoff"),
    contracts: requiredHeadingList(tokens, "Contracts", 2, "Handoff"),
    unresolved: requiredHeadingList(tokens, "Unresolved", 2, "Handoff"),
    nextActions: requiredHeadingList(tokens, "Next actions", 2, "Handoff"),
    deliveryActions: requiredHeadingList(
      tokens,
      "Delivery actions",
      2,
      "Handoff",
    ),
    publishedInvestigations: parsePublishedInvestigations(tokens, "Handoff"),
  };
}

function requiredEvidence(tokens: Token[], location: string): EvidenceLink[] {
  const labelIndex = tokens.findIndex(
    (token) => isParagraph(token) && cleanLabel(token.text) === "Code evidence",
  );
  const list = tokens[labelIndex + 1];
  if (labelIndex < 0 || !isList(list))
    throw new WorkItemMarkdownError(
      `${location} must contain a Code evidence list.`,
    );
  return list.items.map((item) => {
    const match =
      /^`([^:`]+):(\d+)-(\d+)` - (.+) \((implements|verifies|configures|contradicts)\)\.$/.exec(
        item.text,
      );
    if (match === null)
      throw new WorkItemMarkdownError(
        `${location} has malformed code evidence: ${item.text}.`,
      );
    return {
      path: match[1],
      startLine: Number(match[2]),
      endLine: Number(match[3]),
      description: match[4],
      role: requireEnum(match[5], EVIDENCE_ROLES, `${location} evidence role`),
    };
  });
}

function parsePublishedInvestigations(
  tokens: Token[],
  location: string,
): PublishedInvestigation[] {
  const labelIndex = tokens.findIndex(
    (token) =>
      isParagraph(token) &&
      cleanLabel(token.text) === "Published investigations",
  );
  if (labelIndex < 0) return [];
  const list = tokens[labelIndex + 1];
  if (!isList(list))
    throw new WorkItemMarkdownError(
      `${location} Published investigations must be a list.`,
    );
  return list.items.map((item) =>
    parsePublishedInvestigation(item.text, location),
  );
}

function parsePublishedInvestigation(
  text: string,
  location: string,
): PublishedInvestigation {
  const match =
    /^`([^`]+)` - \*\*Conclusion:\*\* (.+?) \*\*Rationale:\*\* (.+?) \*\*Evidence:\*\* (.+?) \*\*Unresolved:\*\* (.+?) \*\*Task:\*\* `([^`]+)`$/.exec(
      text,
    );
  if (match === null)
    throw new WorkItemMarkdownError(
      `${location} has malformed published Investigation.`,
    );
  return {
    publishedAt: match[1],
    conclusion: match[2],
    rationale: match[3],
    evidence: match[4],
    unresolved: match[5],
    taskUrl: match[6],
  };
}

function parseRevisions(tokens: Token[], location: string): DecisionRevision[] {
  const detailsIndex = tokens.findIndex(
    (token) => isHtml(token) && token.text.includes("Revision history"),
  );
  if (detailsIndex < 0) return [];
  const list = tokens.slice(detailsIndex + 1).find(isList);
  if (list === undefined || !list.ordered)
    throw new WorkItemMarkdownError(
      `${location} Revision history must be an ordered list.`,
    );
  return list.items.map((item) => {
    const match =
      /^`([^`]+)` - (?:Accepted|Superseded `[^`]+` with) `(D-\d{2}\/[A-Z])` because (.+)$/.exec(
        item.text,
      );
    if (match === null)
      throw new WorkItemMarkdownError(
        `${location} has malformed Revision history.`,
      );
    return { acceptedAt: match[1], optionId: match[2], rationale: match[3] };
  });
}

function parseOptionReference(
  text: string,
  label: string,
  location: string,
): { optionId: string; rationale: string } {
  const match = /^`(D-\d{2}\/[A-Z])`, because (.+)$/.exec(text);
  if (match === null)
    throw new WorkItemMarkdownError(
      `${location} ${label} must name an Option and rationale.`,
    );
  return { optionId: match[1], rationale: match[2] };
}

function parseAccepted(
  text: string,
  location: string,
): {
  optionId: string | null;
  rationale: string | null;
  acceptedAt: string | null;
} {
  if (text === "Not accepted yet.")
    return { optionId: null, rationale: null, acceptedAt: null };
  const match = /^`(D-\d{2}\/[A-Z])`, because (.+?)(?: Accepted (.+)\.)?$/.exec(
    text,
  );
  if (match === null)
    throw new WorkItemMarkdownError(
      `${location} Accepted must name an Option and rationale.`,
    );
  return {
    optionId: match[1],
    rationale: match[2],
    acceptedAt: match[3] ?? null,
  };
}

function requiredHeadingText(
  tokens: Token[],
  title: string,
  depth: number,
  location: string,
): string {
  return firstParagraph(
    requiredHeadingSlice(tokens, title, depth, location),
    `${location} ${title}`,
  );
}

function requiredHeadingList(
  tokens: Token[],
  title: string,
  depth: number,
  location: string,
): string[] {
  const content = requiredHeadingSlice(tokens, title, depth, location);
  const list = content.find(isList);
  if (list === undefined)
    throw new WorkItemMarkdownError(
      `${location} ${title} must contain a list.`,
    );
  return list.items.map((item) => item.text).filter((item) => item !== "None.");
}

function requiredHeadingSlice(
  tokens: Token[],
  title: string,
  depth: number,
  location: string,
): Token[] {
  const index = tokens.findIndex(
    (token) =>
      isHeading(token) && token.depth === depth && token.text === title,
  );
  if (index < 0)
    throw new WorkItemMarkdownError(`${location} must contain ## ${title}.`);
  const end = tokens.findIndex(
    (token, tokenIndex) =>
      tokenIndex > index && isHeading(token) && token.depth <= depth,
  );
  return meaningful(tokens.slice(index + 1, end < 0 ? tokens.length : end));
}

function firstParagraph(tokens: Token[], location: string): string {
  const paragraph = tokens.find(isParagraph);
  if (paragraph === undefined || paragraph.text.trim().length === 0)
    throw new WorkItemMarkdownError(`${location} must contain readable text.`);
  return paragraph.text.trim();
}

function requiredLabelText(
  tokens: Token[],
  label: string,
  location: string,
): string {
  const paragraph = tokens.find(
    (token): token is Tokens.Paragraph =>
      isParagraph(token) && cleanLabel(token.text).startsWith(`${label}:`),
  );
  if (paragraph === undefined)
    throw new WorkItemMarkdownError(`${location} must contain ${label}.`);
  const value = cleanLabel(paragraph.text)
    .slice(label.length + 1)
    .trim();
  if (value.length === 0)
    throw new WorkItemMarkdownError(`${location} ${label} must not be empty.`);
  return value;
}

function requiredLabelList(
  tokens: Token[],
  label: string,
  location: string,
): string[] {
  const labelIndex = tokens.findIndex(
    (token) => isParagraph(token) && cleanLabel(token.text) === label,
  );
  const list = tokens[labelIndex + 1];
  if (labelIndex < 0 || !isList(list))
    throw new WorkItemMarkdownError(
      `${location} must contain a ${label} list.`,
    );
  return list.items.map((item) => item.text).filter((item) => item !== "None.");
}

function splitHeadings(
  tokens: Token[],
  depth: number,
  location: string,
): Array<{ heading: Tokens.Heading; tokens: Token[] }> {
  const headings = tokens.filter(
    (token): token is Tokens.Heading =>
      isHeading(token) && token.depth === depth,
  );
  if (headings.length === 0) return [];
  return headings.map((heading, index) => {
    const start = tokens.indexOf(heading);
    const end =
      index + 1 < headings.length
        ? tokens.indexOf(headings[index + 1])
        : tokens.length;
    return { heading, tokens: meaningful(tokens.slice(start + 1, end)) };
  });
}

function parseReferences(
  text: string,
  label: string,
  location: string,
): string[] {
  const ids = text
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (ids.length === 0)
    throw new WorkItemMarkdownError(
      `${location} ${label} must list one or more Decision IDs.`,
    );
  return ids;
}

function cleanLabel(value: string): string {
  return value.replace(/\*\*/g, "").trim();
}

function acceptDecision(
  workItem: WorkItem,
  update: Extract<WorkItemUpdate, { type: "decision.accept" }>,
): WorkItem {
  const decision = workItem.decisions.find(
    (item) => item.id === update.decisionId,
  );
  if (decision === undefined)
    throw new WorkItemMarkdownError(
      `Decision ${update.decisionId} does not exist.`,
    );
  if (!decision.options.some((option) => option.id === update.optionId))
    throw new WorkItemMarkdownError(
      `${update.optionId} is not an Option for ${update.decisionId}.`,
    );
  const revisions =
    decision.acceptedOptionId === null ||
    decision.acceptedRationale === null ||
    decision.acceptedAt === null
      ? decision.revisions
      : [
          ...decision.revisions,
          {
            optionId: decision.acceptedOptionId,
            rationale: decision.acceptedRationale,
            acceptedAt: decision.acceptedAt,
          },
        ];
  return {
    ...workItem,
    updatedAt: update.acceptedAt,
    decisions: workItem.decisions.map((item) =>
      item.id === decision.id
        ? {
            ...item,
            acceptedOptionId: update.optionId,
            acceptedRationale: update.rationale,
            acceptedAt: update.acceptedAt,
            revisions,
          }
        : item,
    ),
  };
}

function reportImplementation(
  workItem: WorkItem,
  result: ImplementationResult,
): WorkItem {
  if (!workItem.plan.some((item) => item.id === result.planItemId))
    throw new WorkItemMarkdownError(
      `Plan Item ${result.planItemId} does not exist.`,
    );
  if (
    workItem.implementation.some(
      (item) => item.planItemId === result.planItemId,
    )
  )
    throw new WorkItemMarkdownError(
      `${result.planItemId} already has an Implementation Result.`,
    );
  return { ...workItem, implementation: [...workItem.implementation, result] };
}

function publishInvestigation(
  workItem: WorkItem,
  owner: InvestigationOwner,
  investigation: PublishedInvestigation,
): WorkItem {
  switch (owner.kind) {
    case "work-item":
      return {
        ...workItem,
        publishedInvestigations: [
          ...workItem.publishedInvestigations,
          investigation,
        ],
      };
    case "handoff":
      return {
        ...workItem,
        handoff: {
          ...workItem.handoff,
          publishedInvestigations: [
            ...workItem.handoff.publishedInvestigations,
            investigation,
          ],
        },
      };
    case "decision":
      return {
        ...workItem,
        decisions: workItem.decisions.map((item) =>
          item.id === owner.id
            ? {
                ...item,
                publishedInvestigations: [
                  ...item.publishedInvestigations,
                  investigation,
                ],
              }
            : item,
        ),
      };
    case "decision-option":
      return {
        ...workItem,
        decisions: workItem.decisions.map((decision) => ({
          ...decision,
          options: decision.options.map((option) =>
            option.id === owner.id
              ? {
                  ...option,
                  publishedInvestigations: [
                    ...option.publishedInvestigations,
                    investigation,
                  ],
                }
              : option,
          ),
        })),
      };
    case "plan-item":
      return {
        ...workItem,
        plan: workItem.plan.map((item) =>
          item.id === owner.id
            ? {
                ...item,
                publishedInvestigations: [
                  ...item.publishedInvestigations,
                  investigation,
                ],
              }
            : item,
        ),
      };
    case "implementation-result":
      return {
        ...workItem,
        implementation: workItem.implementation.map((item) =>
          item.id === owner.id
            ? {
                ...item,
                publishedInvestigations: [
                  ...item.publishedInvestigations,
                  investigation,
                ],
              }
            : item,
        ),
      };
    default: {
      const exhaustive: never = owner;
      throw new WorkItemMarkdownError(
        `Unsupported Investigation owner: ${JSON.stringify(exhaustive)}.`,
      );
    }
  }
}

function addDeliveryAction(
  workItem: WorkItem,
  deliveryAction: string,
): WorkItem {
  requireText(deliveryAction, "Delivery Action");
  return {
    ...workItem,
    handoff: {
      ...workItem.handoff,
      deliveryActions: [...workItem.handoff.deliveryActions, deliveryAction],
    },
  };
}

function validateDecision(decision: Decision, optionIds: Set<string>): void {
  requireMatch(decision.id, /^D-\d{2}$/, "Decision id");
  requireText(decision.title, `${decision.id} title`);
  requireText(decision.context, `${decision.id} context`);
  if (decision.options.length < 2 || decision.options.length > 3)
    throw new WorkItemMarkdownError(
      `${decision.id} must contain two or three credible Options.`,
    );
  for (const option of decision.options) {
    requireUnique(optionIds, option.id, "Decision Option");
    requireMatch(
      option.id,
      new RegExp(`^${escapeRegExp(decision.id)}/[A-Z]$`),
      `${decision.id} Option id`,
    );
    requireText(option.title, `${option.id} title`);
    requireText(option.explanation, `${option.id} explanation`);
    requireStringList(option.concreteEffects, `${option.id} Concrete effects`);
    requireStringList(option.pros, `${option.id} Pros`);
    requireStringList(option.cons, `${option.id} Cons`);
    validateInvestigations(option.publishedInvestigations, option.id);
  }
  if (
    !decision.options.some(
      (option) => option.id === decision.recommendationOptionId,
    )
  )
    throw new WorkItemMarkdownError(
      `${decision.id} Recommendation references a missing Option.`,
    );
  requireText(
    decision.recommendationRationale,
    `${decision.id} Recommendation rationale`,
  );
  if (
    (decision.acceptedOptionId === null) !==
      (decision.acceptedRationale === null) ||
    (decision.acceptedOptionId === null) !== (decision.acceptedAt === null)
  )
    throw new WorkItemMarkdownError(
      `${decision.id} Accepted fields must be all present or all empty.`,
    );
  if (
    decision.acceptedOptionId !== null &&
    !decision.options.some((option) => option.id === decision.acceptedOptionId)
  )
    throw new WorkItemMarkdownError(
      `${decision.id} Accepted references a missing Option.`,
    );
  for (const revision of decision.revisions) {
    if (!decision.options.some((option) => option.id === revision.optionId))
      throw new WorkItemMarkdownError(
        `${decision.id} Revision references a missing Option.`,
      );
    requireText(revision.acceptedAt, `${decision.id} Revision timestamp`);
    requireText(revision.rationale, `${decision.id} Revision rationale`);
  }
  validateInvestigations(decision.publishedInvestigations, decision.id);
}

function validatePlanItem(item: PlanItem, decisionIds: Set<string>): void {
  requireMatch(item.id, /^P-\d{2}$/, "Plan Item id");
  requireText(item.title, `${item.id} title`);
  if (item.decisionIds.length === 0)
    throw new WorkItemMarkdownError(
      `${item.id} must support at least one Decision.`,
    );
  for (const decisionId of item.decisionIds)
    if (!decisionIds.has(decisionId))
      throw new WorkItemMarkdownError(
        `${item.id} references missing Decision ${decisionId}.`,
      );
  requireText(item.outcome, `${item.id} Outcome`);
  requireText(
    item.implementationBoundary,
    `${item.id} Implementation boundary`,
  );
  validateInvestigations(item.publishedInvestigations, item.id);
}

function validateImplementationResult(
  result: ImplementationResult,
  planIds: Set<string>,
): void {
  requireMatch(result.id, /^IR-\d{2}$/, "Implementation Result id");
  if (!planIds.has(result.planItemId))
    throw new WorkItemMarkdownError(
      `${result.id} references missing Plan Item ${result.planItemId}.`,
    );
  requireText(result.actualResult, `${result.id} Actual result`);
  if (result.deviation !== null)
    requireText(result.deviation, `${result.id} Deviation`);
  if (result.evidence.length === 0)
    throw new WorkItemMarkdownError(`${result.id} must contain code evidence.`);
  for (const evidence of result.evidence) validateEvidence(evidence, result.id);
  validateInvestigations(result.publishedInvestigations, result.id);
}

function validateEvidence(evidence: EvidenceLink, location: string): void {
  if (
    evidence.path.length === 0 ||
    evidence.path.startsWith("/") ||
    evidence.path.split("/").includes("..")
  )
    throw new WorkItemMarkdownError(
      `${location} evidence path must be repository-relative.`,
    );
  if (
    !Number.isInteger(evidence.startLine) ||
    !Number.isInteger(evidence.endLine) ||
    evidence.startLine < 1 ||
    evidence.endLine < evidence.startLine
  )
    throw new WorkItemMarkdownError(
      `${location} evidence line range is invalid.`,
    );
  requireText(evidence.description, `${location} evidence description`);
  requireEnum(evidence.role, EVIDENCE_ROLES, `${location} evidence role`);
}

function validateHandoff(handoff: Handoff): void {
  requireStringList(handoff.summary, "Handoff Summary");
  requireStringList(handoff.contracts, "Handoff Contracts");
  requireStringList(handoff.unresolved, "Handoff Unresolved");
  requireStringList(handoff.nextActions, "Handoff Next actions");
  requireStringList(handoff.deliveryActions, "Handoff Delivery actions");
  validateInvestigations(handoff.publishedInvestigations, "Handoff");
}

function validateBrief(brief: WorkItemBrief): void {
  requireText(brief.problem, "Brief Problem");
  requireText(brief.goal, "Brief Goal");
  requireStringList(brief.scope, "Brief Scope");
  requireStringList(brief.constraints, "Brief Constraints");
  requireStringList(brief.acceptanceCriteria, "Brief Acceptance criteria");
}

function validateTasks(tasks: WorkItemTasks): void {
  for (const task of Object.values(tasks))
    if (task !== null) requireText(task, "Work Item task id");
}

function validateInvestigations(
  investigations: PublishedInvestigation[],
  location: string,
): void {
  for (const investigation of investigations) {
    requireText(
      investigation.publishedAt,
      `${location} Investigation timestamp`,
    );
    requireText(
      investigation.conclusion,
      `${location} Investigation conclusion`,
    );
    requireText(investigation.rationale, `${location} Investigation rationale`);
    requireText(investigation.evidence, `${location} Investigation evidence`);
    requireText(
      investigation.unresolved,
      `${location} Investigation unresolved risk`,
    );
    if (!/^codex:\/\/threads\/.+/.test(investigation.taskUrl))
      throw new WorkItemMarkdownError(
        `${location} Investigation task must be a Codex thread URL.`,
      );
  }
}

function rejectYamlPayloads(tokens: Token[]): void {
  if (
    tokens.some(
      (token) => isCode(token) && token.lang?.toLowerCase() === "yaml",
    )
  )
    throw new WorkItemMarkdownError(
      "Work Item Markdown body must not contain fenced YAML payloads.",
    );
}

function assertNoTranscript(tokens: Token[], location: string): void {
  if (
    tokens.some(
      (token) =>
        (isHeading(token) || isParagraph(token)) &&
        token.text.toLowerCase().includes("transcript"),
    )
  )
    throw new WorkItemMarkdownError(
      `${location} must not persist a private Investigation transcript.`,
    );
}

function meaningful(tokens: Token[]): Token[] {
  return tokens.filter((token) => token.type !== "space");
}
function isTopLevelHeading(token: Token): token is Tokens.Heading {
  return isHeading(token) && token.depth === 1;
}
function isHeading(token: Token): token is Tokens.Heading {
  return token.type === "heading";
}
function isParagraph(token: Token): token is Tokens.Paragraph {
  return token.type === "paragraph";
}
function isList(token: Token | undefined): token is Tokens.List {
  return token !== undefined && token.type === "list";
}
function isHtml(token: Token): token is Tokens.HTML {
  return token.type === "html";
}
function isCode(token: Token): token is Tokens.Code {
  return token.type === "code";
}

function requireRecord(value: unknown, location: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new WorkItemMarkdownError(`${location} must be a YAML object.`);
  return value as UnknownRecord;
}
function requireString(
  record: UnknownRecord,
  key: string,
  location: string,
): string {
  const value = record[key];
  if (typeof value !== "string")
    throw new WorkItemMarkdownError(`${location}.${key} must be a string.`);
  return value;
}
function requireNullableString(
  record: UnknownRecord,
  key: string,
  location: string,
): string | null {
  const value = record[key];
  if (value !== null && typeof value !== "string")
    throw new WorkItemMarkdownError(
      `${location}.${key} must be a string or null.`,
    );
  return value;
}
function requireOptionalNullableString(
  record: UnknownRecord,
  key: string,
  location: string,
): string | null {
  const value = record[key];
  if (value === undefined) return null;
  if (value !== null && typeof value !== "string")
    throw new WorkItemMarkdownError(
      `${location}.${key} must be a string or null.`,
    );
  return value;
}
function requireText(value: string, location: string): void {
  if (value.trim().length === 0 || value.includes("\n"))
    throw new WorkItemMarkdownError(`${location} must be one non-empty line.`);
}
function requireStringList(values: string[], location: string): void {
  if (
    !values.every((value) => value.trim().length > 0 && !value.includes("\n"))
  )
    throw new WorkItemMarkdownError(
      `${location} must contain non-empty single-line values.`,
    );
}
function requireMatch(value: string, pattern: RegExp, location: string): void {
  if (!pattern.test(value))
    throw new WorkItemMarkdownError(`${location} is invalid: ${value}.`);
}
function requireUnique(
  values: Set<string>,
  value: string,
  location: string,
): void {
  if (values.has(value))
    throw new WorkItemMarkdownError(`${location} ID is reused: ${value}.`);
  values.add(value);
}
function requireEnum<T extends readonly string[]>(
  value: string,
  values: T,
  location: string,
): T[number] {
  if (!values.includes(value))
    throw new WorkItemMarkdownError(
      `${location} has unsupported value: ${value}.`,
    );
  return value as T[number];
}
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
