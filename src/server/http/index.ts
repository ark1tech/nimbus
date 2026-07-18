import path from "node:path";

import type { NextFunction, Request, RequestHandler, Response } from "express";
import express from "express";
import { z, ZodError } from "zod";

import {
  beginPlanItemSchema,
  openWorkItemSchema,
  presentDecisionSchema,
  presentHandoffSchema,
  presentPlanSchema,
  presentReviewSchema,
  publishInvestigationConclusionSchema,
  recordHandoffSiteSchema,
  reportImplementationItemSchema,
} from "../mcp/schemas";
import { HttpProblem } from "./errors";
import type {
  NimbusRuntime,
  RuntimePhase,
  WorkItemRuntimeEvent,
} from "./types";

const expectedDocumentHashSchema = z.object({
  expectedDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
});
const decisionSelectionSchema = expectedDocumentHashSchema.extend({
  optionId: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
});
const planChangeSetSchema = expectedDocumentHashSchema.extend({
  changeSet: z.array(
    z.object({
      type: z.enum(["comment", "insert", "replace", "delete"]),
      target: z.string().min(1),
      content: z.string(),
    }),
  ),
});
const launchConfirmationSchema = expectedDocumentHashSchema.extend({
  phase: z.enum([
    "grill",
    "plan",
    "implement",
    "review",
    "handoff",
    "complete",
  ]),
  model: z.string().trim().min(1),
});
const correctionSchema = expectedDocumentHashSchema.extend({
  correction: z.string().trim().min(1),
});

const asyncHandler =
  (handler: RequestHandler): RequestHandler =>
  (request, response, next): void => {
    void Promise.resolve(handler(request, response, next)).catch(next);
  };

const requiredRouteParam = (
  value: string | string[] | undefined,
  name: string,
): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpProblem(
      400,
      "Invalid route parameter",
      `${name} must be a non-empty string.`,
    );
  }
  return value;
};

const writeSseEvent = (
  response: Response,
  event: WorkItemRuntimeEvent,
): void => {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
};

const toApiError = (
  error: unknown,
): { statusCode: number; body: { error: string; details: string } } => {
  if (error instanceof HttpProblem) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message, details: error.details },
    };
  }
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      body: {
        error: "Invalid request body",
        details: error.issues.map((issue) => issue.message).join("; "),
      },
    };
  }
  if (error instanceof SyntaxError && "body" in error) {
    return {
      statusCode: 400,
      body: { error: "Invalid JSON request body", details: error.message },
    };
  }
  return {
    statusCode: 500,
    body: {
      error: "Nimbus server failure",
      details:
        error instanceof Error ? error.message : "Unknown server failure",
    },
  };
};

export const createNimbusHttpApp = (
  runtime: NimbusRuntime,
  webRoot: string | null,
  sessionToken: string | null,
): express.Express => {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use((request, _response, next): void => {
    const protectedRoute =
      request.path.startsWith("/api/") ||
      request.path.startsWith("/mcp/") ||
      request.path === "/events";
    if (sessionToken === null || !protectedRoute) {
      next();
      return;
    }
    const suppliedToken =
      request.header("X-Nimbus-Token") ??
      (typeof request.query.token === "string" ? request.query.token : null);
    if (suppliedToken !== sessionToken) {
      next(
        new HttpProblem(
          401,
          "Invalid Nimbus session token",
          "Open the current Nimbus workspace URL.",
        ),
      );
      return;
    }
    next();
  });

  app.get(
    "/api/work-item",
    asyncHandler(async (_request, response): Promise<void> => {
      response.status(200).json(await runtime.getWorkItem());
    }),
  );
  app.post(
    "/api/decisions/:decisionId/selection",
    asyncHandler(async (request, response): Promise<void> => {
      const payload = decisionSelectionSchema.parse(request.body);
      response
        .status(200)
        .json(
          await runtime.selectDecisionOption(
            requiredRouteParam(request.params.decisionId, "decisionId"),
            payload.optionId,
            payload.rationale,
            payload.expectedDocumentHash,
          ),
        );
    }),
  );
  app.post(
    "/api/plan/change-set",
    asyncHandler(async (request, response): Promise<void> => {
      const payload = planChangeSetSchema.parse(request.body);
      response
        .status(200)
        .json(
          await runtime.submitPlanChangeSet(
            payload.changeSet,
            payload.expectedDocumentHash,
          ),
        );
    }),
  );
  app.post(
    "/api/launch-confirmation",
    asyncHandler(async (request, response): Promise<void> => {
      const payload = launchConfirmationSchema.parse(request.body);
      response
        .status(200)
        .json(
          await runtime.confirmLaunch(
            payload.phase as RuntimePhase,
            payload.model,
            payload.expectedDocumentHash,
          ),
        );
    }),
  );
  app.post(
    "/api/review/corrections",
    asyncHandler(async (request, response): Promise<void> => {
      const payload = correctionSchema.parse(request.body);
      response
        .status(200)
        .json(
          await runtime.requestReviewCorrection(
            payload.correction,
            payload.expectedDocumentHash,
          ),
        );
    }),
  );
  app.post(
    "/api/review/accept",
    asyncHandler(async (request, response): Promise<void> => {
      const payload = expectedDocumentHashSchema.parse(request.body);
      response
        .status(200)
        .json(await runtime.acceptReview(payload.expectedDocumentHash));
    }),
  );
  app.post(
    "/api/handoff/accept",
    asyncHandler(async (request, response): Promise<void> => {
      const payload = expectedDocumentHashSchema.parse(request.body);
      response
        .status(200)
        .json(await runtime.acceptHandoff(payload.expectedDocumentHash));
    }),
  );
  app.post(
    "/api/handoff/publication",
    asyncHandler(async (request, response): Promise<void> => {
      const payload = expectedDocumentHashSchema.parse(request.body);
      response
        .status(200)
        .json(await runtime.startPublication(payload.expectedDocumentHash));
    }),
  );

  app.post(
    "/mcp/open-work-item",
    asyncHandler(async (request, response): Promise<void> => {
      response
        .status(200)
        .json(
          await runtime.openWorkItem(openWorkItemSchema.parse(request.body)),
        );
    }),
  );
  app.post(
    "/mcp/present-decision",
    asyncHandler(async (request, response): Promise<void> => {
      response
        .status(200)
        .json(
          await runtime.presentDecision(
            presentDecisionSchema.parse(request.body),
          ),
        );
    }),
  );
  app.post(
    "/mcp/present-plan",
    asyncHandler(async (request, response): Promise<void> => {
      response
        .status(200)
        .json(await runtime.presentPlan(presentPlanSchema.parse(request.body)));
    }),
  );
  app.post(
    "/mcp/begin-plan-item",
    asyncHandler(async (request, response): Promise<void> => {
      response
        .status(200)
        .json(
          await runtime.beginPlanItem(beginPlanItemSchema.parse(request.body)),
        );
    }),
  );
  app.post(
    "/mcp/report-implementation-item",
    asyncHandler(async (request, response): Promise<void> => {
      response
        .status(200)
        .json(
          await runtime.reportImplementationItem(
            reportImplementationItemSchema.parse(request.body),
          ),
        );
    }),
  );
  app.post(
    "/mcp/present-review",
    asyncHandler(async (request, response): Promise<void> => {
      response
        .status(200)
        .json(
          await runtime.presentReview(presentReviewSchema.parse(request.body)),
        );
    }),
  );
  app.post(
    "/mcp/publish-investigation-conclusion",
    asyncHandler(async (request, response): Promise<void> => {
      response
        .status(200)
        .json(
          await runtime.publishInvestigationConclusion(
            publishInvestigationConclusionSchema.parse(request.body),
          ),
        );
    }),
  );
  app.post(
    "/mcp/present-handoff",
    asyncHandler(async (request, response): Promise<void> => {
      response
        .status(200)
        .json(
          await runtime.presentHandoff(
            presentHandoffSchema.parse(request.body),
          ),
        );
    }),
  );
  app.post(
    "/mcp/record-handoff-site",
    asyncHandler(async (request, response): Promise<void> => {
      response
        .status(200)
        .json(
          await runtime.recordHandoffSite(
            recordHandoffSiteSchema.parse(request.body),
          ),
        );
    }),
  );

  app.get("/events", (request, response): void => {
    response.status(200).set({
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    const unsubscribe = runtime.events.subscribe((event): void =>
      writeSseEvent(response, event),
    );
    request.on("close", (): void => {
      unsubscribe();
      response.end();
    });
  });

  if (webRoot !== null) {
    const resolvedWebRoot = path.resolve(webRoot);
    app.use(express.static(resolvedWebRoot));
    app.get(/^(?!\/api|\/mcp|\/events).*$/, (_request, response): void => {
      response.sendFile(path.join(resolvedWebRoot, "index.html"));
    });
  }
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ): void => {
      const apiError = toApiError(error);
      response.status(apiError.statusCode).json(apiError.body);
    },
  );
  return app;
};

export { HttpProblem } from "./errors";
export type { NimbusRuntime, WorkItemEventBus, WorkItemStore } from "./types";
