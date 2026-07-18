import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type {
  BeginPlanItemInput,
  NimbusMcpAdapter,
  OpenWorkItemInput,
  PresentDecisionInput,
  PresentHandoffInput,
  PresentPlanInput,
  PresentReviewInput,
  PublishInvestigationConclusionInput,
  RecordHandoffSiteInput,
  ReportImplementationItemInput,
} from "./contracts";
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
} from "./schemas";

const toToolResult = (
  result: unknown,
): { content: Array<{ type: "text"; text: string }> } => ({
  content: [{ type: "text", text: JSON.stringify(result) }],
});

export function registerNimbusTools(
  server: McpServer,
  adapter: NimbusMcpAdapter,
): void {
  server.registerTool(
    "open_work_item",
    {
      title: "Open Nimbus Work Item",
      description: "Create or resume a Work Item and open Nimbus.",
      inputSchema: openWorkItemSchema.shape,
    },
    async (input) =>
      toToolResult(await adapter.openWorkItem(input as OpenWorkItemInput)),
  );
  server.registerTool(
    "present_decision",
    {
      title: "Present Nimbus Decision",
      description:
        "Present one Grill decision and wait for an option selection.",
      inputSchema: presentDecisionSchema.shape,
    },
    async (input) =>
      toToolResult(
        await adapter.presentDecision(input as PresentDecisionInput),
      ),
  );
  server.registerTool(
    "present_plan",
    {
      title: "Present Nimbus Plan",
      description:
        "Present a complete Plan draft and wait for approval or one change set.",
      inputSchema: presentPlanSchema.shape,
    },
    async (input) =>
      toToolResult(await adapter.presentPlan(input as PresentPlanInput)),
  );
  server.registerTool(
    "begin_plan_item",
    {
      title: "Begin Nimbus Plan Item",
      description: "Set the one transient active Plan Item.",
      inputSchema: beginPlanItemSchema.shape,
    },
    async (input) =>
      toToolResult(await adapter.beginPlanItem(input as BeginPlanItemInput)),
  );
  server.registerTool(
    "report_implementation_item",
    {
      title: "Report Nimbus Implementation Item",
      description: "Persist one implemented Plan Item and its evidence.",
      inputSchema: reportImplementationItemSchema.shape,
    },
    async (input) =>
      toToolResult(
        await adapter.reportImplementationItem(
          input as ReportImplementationItemInput,
        ),
      ),
  );
  server.registerTool(
    "present_review",
    {
      title: "Present Nimbus Review",
      description:
        "Present derived reconciliation and wait for acceptance or correction.",
      inputSchema: presentReviewSchema.shape,
    },
    async (input) =>
      toToolResult(await adapter.presentReview(input as PresentReviewInput)),
  );
  server.registerTool(
    "publish_investigation_conclusion",
    {
      title: "Publish Nimbus Investigation Conclusion",
      description: "Persist an explicitly approved Investigation conclusion.",
      inputSchema: publishInvestigationConclusionSchema.shape,
    },
    async (input) =>
      toToolResult(
        await adapter.publishInvestigationConclusion(
          input as PublishInvestigationConclusionInput,
        ),
      ),
  );
  server.registerTool(
    "present_handoff",
    {
      title: "Present Nimbus Handoff",
      description: "Persist and present the reviewed Handoff.",
      inputSchema: presentHandoffSchema.shape,
    },
    async (input) =>
      toToolResult(await adapter.presentHandoff(input as PresentHandoffInput)),
  );
  server.registerTool(
    "record_handoff_site",
    {
      title: "Record Nimbus Handoff Site",
      description:
        "Record the reachable HTTPS Handoff Site for a current publication attempt.",
      inputSchema: recordHandoffSiteSchema.shape,
    },
    async (input) =>
      toToolResult(
        await adapter.recordHandoffSite(input as RecordHandoffSiteInput),
      ),
  );
}
