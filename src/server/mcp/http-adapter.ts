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

type FetchLike = typeof fetch;

type HttpNimbusMcpAdapterOptions = { baseUrl: string; fetch: FetchLike };

const normalizeBaseUrl = (baseUrl: string): string =>
  baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

async function postJson(
  fetchImplementation: FetchLike,
  baseUrl: string,
  route: string,
  payload: unknown,
): Promise<unknown> {
  const response = await fetchImplementation(
    `${normalizeBaseUrl(baseUrl)}${route}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Nimbus runtime rejected ${route} with ${response.status}: ${body.length === 0 ? "No response body." : body}`,
    );
  }
  try {
    return JSON.parse(body) as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Nimbus runtime returned invalid JSON for ${route}: ${message}`,
    );
  }
}

export function createHttpNimbusMcpAdapter(
  options: HttpNimbusMcpAdapterOptions,
): NimbusMcpAdapter {
  return {
    openWorkItem: (input: OpenWorkItemInput): Promise<unknown> =>
      postJson(options.fetch, options.baseUrl, "/mcp/open-work-item", input),
    presentDecision: (input: PresentDecisionInput): Promise<unknown> =>
      postJson(options.fetch, options.baseUrl, "/mcp/present-decision", input),
    presentPlan: (input: PresentPlanInput): Promise<unknown> =>
      postJson(options.fetch, options.baseUrl, "/mcp/present-plan", input),
    beginPlanItem: (input: BeginPlanItemInput): Promise<unknown> =>
      postJson(options.fetch, options.baseUrl, "/mcp/begin-plan-item", input),
    reportImplementationItem: (
      input: ReportImplementationItemInput,
    ): Promise<unknown> =>
      postJson(
        options.fetch,
        options.baseUrl,
        "/mcp/report-implementation-item",
        input,
      ),
    presentReview: (input: PresentReviewInput): Promise<unknown> =>
      postJson(options.fetch, options.baseUrl, "/mcp/present-review", input),
    publishInvestigationConclusion: (
      input: PublishInvestigationConclusionInput,
    ): Promise<unknown> =>
      postJson(
        options.fetch,
        options.baseUrl,
        "/mcp/publish-investigation-conclusion",
        input,
      ),
    presentHandoff: (input: PresentHandoffInput): Promise<unknown> =>
      postJson(options.fetch, options.baseUrl, "/mcp/present-handoff", input),
    recordHandoffSite: (input: RecordHandoffSiteInput): Promise<unknown> =>
      postJson(
        options.fetch,
        options.baseUrl,
        "/mcp/record-handoff-site",
        input,
      ),
  };
}
