import { z } from "zod";

const artifactId = z.string().regex(/^(?:D-\d+|D-\d+\/[A-Z]+|P-\d+|IR-\d+)$/);
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
  workItemId: z.string().min(1).describe("Stable work-item identifier."),
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
  id: artifactId,
  label: z.string().min(1),
  explanation: z.string().min(1),
  concreteEffects: z.array(z.string().min(1)).min(1),
  pros: z.array(z.string().min(1)).min(1),
  cons: z.array(z.string().min(1)).min(1),
});

export const presentDecisionSchema = expectedDocumentHashSchema.extend({
  workItemId: z.string().min(1),
  decision: z.object({
    id: artifactId.regex(/^D-\d+$/),
    question: z.string().min(1),
    context: z.string().min(1),
    options: z.array(decisionOptionSchema).min(2).max(3),
    recommendationOptionId: artifactId.regex(/^D-\d+\/[A-Z]+$/),
    recommendationReason: z.string().min(1),
  }),
});

export const presentPlanSchema = expectedDocumentHashSchema.extend({
  workItemId: z.string().min(1),
  document: z.string().min(1),
  items: z
    .array(
      z.object({
        id: artifactId.regex(/^P-\d+$/),
        title: z.string().min(1),
        outcome: z.string().min(1),
        decisionRefs: z.array(artifactId.regex(/^D-\d+$/)).min(1),
      }),
    )
    .min(1),
});

export const beginPlanItemSchema = expectedDocumentHashSchema.extend({
  workItemId: z.string().min(1),
  planItemId: artifactId.regex(/^P-\d+$/),
  activityPhrase: z.string().min(1).max(120),
});

export const reportImplementationItemSchema = expectedDocumentHashSchema.extend(
  {
    workItemId: z.string().min(1),
    planItemId: artifactId.regex(/^P-\d+$/),
    result: z.object({
      id: artifactId.regex(/^IR-\d+$/),
      actualResult: z.string().min(1),
      deviation: z.string().min(1).nullable(),
      evidence: z.array(evidenceSchema).min(1),
    }),
  },
);

export const presentReviewSchema = z.object({ workItemId: z.string().min(1) });

export const publishInvestigationConclusionSchema =
  expectedDocumentHashSchema.extend({
    workItemId: z.string().min(1),
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
  workItemId: z.string().min(1),
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
  workItemId: z.string().min(1),
  publicationAttemptToken: z.string().min(1),
  url: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === "https:", {
      message: "url must use HTTPS.",
    }),
});
