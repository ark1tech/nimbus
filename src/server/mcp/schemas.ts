import { z } from "zod";

const workItemId = z
  .string()
  .regex(/^[A-Z][A-Z0-9]*-\d+$/)
  .describe("Stable uppercase Work Item identifier, such as DEMO-001.");
const decisionId = z
  .string()
  .regex(/^D-\d{2}$/)
  .describe("Immutable Decision identifier in D-01 format.");
const decisionOptionId = z
  .string()
  .regex(/^D-\d{2}\/[A-Z]$/)
  .describe(
    "Complete immutable Decision Option identifier, such as D-01/A. Never use A alone.",
  );
const planItemId = z
  .string()
  .regex(/^P-\d{2}$/)
  .describe("Immutable Plan Item identifier in P-01 format.");
const implementationResultId = z
  .string()
  .regex(/^IR-\d{2}$/)
  .describe("Immutable Implementation Result identifier in IR-01 format.");
const artifactId = z.union([
  decisionId,
  decisionOptionId,
  planItemId,
  implementationResultId,
]);
const expectedDocumentHash = z.string().regex(/^[a-f0-9]{64}$/i);

export const evidenceSchema = z
  .object({
    path: z.string().min(1).describe("Repository-relative file path."),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    role: z.enum(["implements", "verifies", "configures", "contradicts"]),
  })
  .refine((value) => value.endLine >= value.startLine, {
    message: "endLine must be greater than or equal to startLine.",
  });

const expectedDocumentHashSchema = z.object({ expectedDocumentHash });

export const openWorkItemSchema = z.object({
  projectRoot: z
    .string()
    .min(1)
    .describe("Absolute path to the active repository."),
  workItemId,
  title: z.string().min(1),
  source: z.string().url().nullable(),
  brief: z.object({
    problem: z.string().min(1),
    goal: z.string().min(1),
    scope: z.array(z.string().min(1)),
    constraints: z.array(z.string().min(1)),
    acceptanceCriteria: z.array(z.string().min(1)),
  }),
});

const decisionOptionSchema = z.object({
  id: decisionOptionId,
  label: z.string().min(1),
  explanation: z.string().min(1),
  concreteEffects: z.array(z.string().min(1)).min(1),
  pros: z.array(z.string().min(1)).min(1),
  cons: z.array(z.string().min(1)).min(1),
});

export const presentDecisionSchema = expectedDocumentHashSchema.extend({
  workItemId,
  decision: z.object({
    id: decisionId,
    question: z.string().min(1),
    context: z.string().min(1),
    options: z.array(decisionOptionSchema).min(2).max(3),
    recommendationOptionId: decisionOptionId,
    recommendationReason: z.string().min(1),
  }),
});

export const presentPlanSchema = expectedDocumentHashSchema.extend({
  workItemId,
  document: z.string().min(1),
  items: z
    .array(
      z.object({
        id: planItemId,
        title: z.string().min(1),
        outcome: z.string().min(1),
        decisionRefs: z.array(decisionId).min(1),
      }),
    )
    .min(1),
});

export const beginPlanItemSchema = expectedDocumentHashSchema.extend({
  workItemId,
  planItemId,
  activityPhrase: z.string().min(1).max(120),
});

export const reportImplementationItemSchema = expectedDocumentHashSchema.extend(
  {
    workItemId,
    planItemId,
    result: z.object({
      id: implementationResultId,
      actualResult: z.string().min(1),
      deviation: z.string().min(1).nullable(),
      evidence: z.array(evidenceSchema).min(1),
    }),
  },
);

export const presentReviewSchema = z.object({ workItemId });

export const publishInvestigationConclusionSchema =
  expectedDocumentHashSchema.extend({
    workItemId,
    owner: z.object({
      type: z.enum([
        "work_item",
        "decision",
        "option",
        "plan_item",
        "implementation_result",
      ]),
      id: artifactId.nullable(),
    }),
    conclusion: z.string().min(1),
    rationale: z.string().min(1),
    evidence: z.array(evidenceSchema),
    unresolvedRisk: z.string().min(1).nullable(),
    taskId: z.string().min(1),
  });

export const presentHandoffSchema = expectedDocumentHashSchema.extend({
  workItemId,
  handoff: z.object({
    outcome: z.array(z.string().min(1)).min(1),
    decisions: z.array(z.string().min(1)),
    deviations: z.array(z.string().min(1)),
    contracts: z.array(z.string().min(1)),
    unresolved: z.array(z.string().min(1)),
    nextActions: z.array(z.string().min(1)),
  }),
});

export const recordHandoffSiteSchema = expectedDocumentHashSchema.extend({
  workItemId,
  publicationAttemptToken: z.string().min(1),
  url: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === "https:", {
      message: "url must use HTTPS.",
    }),
});
