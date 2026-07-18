import { createHash, randomBytes } from "node:crypto";

import type {
  BoundedContextPacket,
  StartedNimbusTask,
  StartNimbusTaskInput,
} from "../codex/task-gateway";

const MAX_HANDOFF_MARKDOWN_CHARACTERS = 18_000;
const MAX_PUBLISHER_PROMPT_CHARACTERS = 22_000;

export interface PublisherTaskLauncher {
  startTask: (input: StartNimbusTaskInput) => Promise<StartedNimbusTask>;
}

export interface PublicationWarningLogger {
  warn: (message: string, fields: PublicationWarningFields) => void;
}

export interface PublicationWarningFields {
  workItemId: string;
  url: string;
  attempt: number;
  maxAttempts: number;
  error: string;
}

export interface HandoffSiteReachabilityProbe {
  check: (input: HandoffSiteReachabilityProbeInput) => Promise<void>;
}

export interface HandoffSiteReachabilityProbeInput {
  url: string;
  timeoutMs: number;
}

export interface PublicationRetryPolicy {
  maxAttempts: number;
  retryDelayMs: number;
  timeoutMs: number;
}

export interface HandoffSitePublisherConfig {
  taskLauncher: PublisherTaskLauncher;
  reachabilityProbe: HandoffSiteReachabilityProbe;
  warningLogger: PublicationWarningLogger;
  retryPolicy: PublicationRetryPolicy;
  createAttemptToken: () => string;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
}

export interface BeginHandoffSitePublicationInput {
  workItemId: string;
  workItemTitle: string;
  model: string;
  expectedDocumentHash: string;
  acceptedHandoffMarkdown: string;
}

export interface HandoffSitePublicationPacket {
  workItemId: string;
  workItemTitle: string;
  expectedDocumentHash: string;
  acceptedHandoffDigest: string;
  publicationAttemptToken: string;
  acceptedHandoffMarkdown: string;
}

export interface StartedHandoffSitePublication {
  packet: HandoffSitePublicationPacket;
  publisherTask: StartedNimbusTask;
}

export interface RecordHandoffSiteInput {
  workItemId: string;
  acceptedHandoffDigest: string;
  publicationAttemptToken: string;
  url: string;
}

export interface HandoffSitePersistenceInput {
  workItemId: string;
  expectedDocumentHash: string;
  publicationAttemptToken: string;
  url: string;
}

export interface CompletedHandoffSitePublication {
  workItemId: string;
  acceptedHandoffDigest: string;
  publicationAttemptToken: string;
  url: string;
  openUrl: string;
  checkedAt: string;
  reachabilityAttempts: number;
  recordHandoffSite: HandoffSitePersistenceInput;
}

interface PublicationAttempt {
  workItemId: string;
  expectedDocumentHash: string;
  acceptedHandoffDigest: string;
  createdAt: string;
}

export class HandoffPublicationInputError extends Error {
  public readonly name = "HandoffPublicationInputError";

  public constructor(message: string) {
    super(message);
  }
}

export class UnknownHandoffPublicationAttemptError extends Error {
  public readonly name = "UnknownHandoffPublicationAttemptError";

  public constructor(publicationAttemptToken: string) {
    super(
      `Nimbus could not find the Handoff Site publication attempt ${publicationAttemptToken}.`,
    );
  }
}

export class ConsumedHandoffPublicationAttemptError extends Error {
  public readonly name = "ConsumedHandoffPublicationAttemptError";

  public constructor(publicationAttemptToken: string) {
    super(
      `Nimbus Handoff Site publication attempt ${publicationAttemptToken} has already been used. Start a new publication attempt.`,
    );
  }
}

export class HandoffPublicationAttemptBindingError extends Error {
  public readonly name = "HandoffPublicationAttemptBindingError";

  public constructor(message: string) {
    super(message);
  }
}

export class InvalidHandoffSiteUrlError extends Error {
  public readonly name = "InvalidHandoffSiteUrlError";

  public constructor(url: string, reason: string) {
    super(`Nimbus rejected Handoff Site URL ${url}: ${reason}`);
  }
}

export class HandoffSiteReachabilityError extends Error {
  public readonly name = "HandoffSiteReachabilityError";

  public constructor(
    public readonly url: string,
    public readonly attempts: number,
    public readonly lastError: Error,
  ) {
    super(
      `Nimbus could not reach Handoff Site ${url} after ${attempts} attempt(s): ${lastError.message}`,
      { cause: lastError },
    );
  }
}

/**
 * Holds only in-memory, one-use attempt bindings. The runtime remains the
 * owner of the canonical Work Item write after a successful reachability check.
 */
export class HandoffSitePublisher {
  private readonly config: HandoffSitePublisherConfig;
  private readonly pendingAttempts = new Map<string, PublicationAttempt>();
  private readonly consumedAttemptTokens = new Set<string>();

  public constructor(config: HandoffSitePublisherConfig) {
    validatePublisherConfig(config);
    this.config = config;
  }

  public async beginPublication(
    input: BeginHandoffSitePublicationInput,
  ): Promise<StartedHandoffSitePublication> {
    validateBeginPublicationInput(input);
    const packet = createHandoffSitePublicationPacket({
      ...input,
      publicationAttemptToken: this.config.createAttemptToken(),
    });
    const context = createPublisherTaskContext(packet);
    const attempt: PublicationAttempt = {
      workItemId: packet.workItemId,
      expectedDocumentHash: packet.expectedDocumentHash,
      acceptedHandoffDigest: packet.acceptedHandoffDigest,
      createdAt: this.config.now().toISOString(),
    };

    this.pendingAttempts.set(packet.publicationAttemptToken, attempt);
    try {
      const publisherTask = await this.config.taskLauncher.startTask({
        taskKind: "publisher",
        title: `${packet.workItemId} - Publish Handoff`,
        model: input.model,
        context,
      });
      return { packet, publisherTask };
    } catch (error: unknown) {
      this.pendingAttempts.delete(packet.publicationAttemptToken);
      throw error;
    }
  }

  public async recordHandoffSite(
    input: RecordHandoffSiteInput,
  ): Promise<CompletedHandoffSitePublication> {
    validateRecordHandoffSiteInput(input);
    const attempt = this.takeAttempt(input.publicationAttemptToken);
    validateAttemptBinding(attempt, input);
    validateHandoffSiteUrl(input.url);
    const reachability = await waitForReachableHandoffSite({
      workItemId: input.workItemId,
      url: input.url,
      probe: this.config.reachabilityProbe,
      warningLogger: this.config.warningLogger,
      retryPolicy: this.config.retryPolicy,
      sleep: this.config.sleep,
      now: this.config.now,
    });

    return {
      workItemId: input.workItemId,
      acceptedHandoffDigest: input.acceptedHandoffDigest,
      publicationAttemptToken: input.publicationAttemptToken,
      url: input.url,
      openUrl: input.url,
      checkedAt: reachability.checkedAt,
      reachabilityAttempts: reachability.attempts,
      recordHandoffSite: {
        workItemId: input.workItemId,
        expectedDocumentHash: attempt.expectedDocumentHash,
        publicationAttemptToken: input.publicationAttemptToken,
        url: input.url,
      },
    };
  }

  private takeAttempt(publicationAttemptToken: string): PublicationAttempt {
    const attempt = this.pendingAttempts.get(publicationAttemptToken);
    if (attempt === undefined) {
      if (this.consumedAttemptTokens.has(publicationAttemptToken)) {
        throw new ConsumedHandoffPublicationAttemptError(
          publicationAttemptToken,
        );
      }
      throw new UnknownHandoffPublicationAttemptError(publicationAttemptToken);
    }
    this.pendingAttempts.delete(publicationAttemptToken);
    this.consumedAttemptTokens.add(publicationAttemptToken);
    return attempt;
  }
}

export function createHandoffSitePublicationPacket(
  input: BeginHandoffSitePublicationInput & { publicationAttemptToken: string },
): HandoffSitePublicationPacket {
  validateBeginPublicationInput(input);
  requireAttemptToken(input.publicationAttemptToken);
  return {
    workItemId: input.workItemId,
    workItemTitle: input.workItemTitle,
    expectedDocumentHash: input.expectedDocumentHash,
    acceptedHandoffDigest: sha256(input.acceptedHandoffMarkdown),
    publicationAttemptToken: input.publicationAttemptToken,
    acceptedHandoffMarkdown: input.acceptedHandoffMarkdown,
  };
}

export function createPublisherTaskContext(
  packet: HandoffSitePublicationPacket,
): BoundedContextPacket {
  validatePacket(packet);
  const context: BoundedContextPacket = {
    workItemId: packet.workItemId,
    taskKind: "publisher",
    summary: `Publish the accepted Handoff for ${packet.workItemId}: ${packet.workItemTitle}.`,
    facts: [
      `Accepted Handoff SHA-256: ${packet.acceptedHandoffDigest}`,
      `Publication attempt token: ${packet.publicationAttemptToken}`,
      `Expected Work Item document hash: ${packet.expectedDocumentHash}`,
    ],
    artifactReferences: [
      `Work Item: ${packet.workItemId}`,
      `Accepted Handoff digest: ${packet.acceptedHandoffDigest}`,
    ],
    instructions: createPublisherTaskPrompt(packet),
  };
  if (
    createPublisherTaskPrompt(packet).length > MAX_PUBLISHER_PROMPT_CHARACTERS
  ) {
    throw new HandoffPublicationInputError(
      `Nimbus Publisher task prompt exceeds ${MAX_PUBLISHER_PROMPT_CHARACTERS} characters.`,
    );
  }
  return context;
}

export function createPublisherTaskPrompt(
  packet: HandoffSitePublicationPacket,
): string {
  validatePacket(packet);
  return [
    "Use the Sites plugin to create and host a real static Handoff explainer.",
    "Do not substitute a placeholder, fake URL, local URL, or prose-only completion.",
    "The Site should faithfully explain the bounded accepted Handoff, including relevant outcome, decisions, plan-to-implementation mapping, mental-model changes, evidence, and unresolved concerns.",
    "After Sites returns the deployed HTTPS URL, call record_handoff_site exactly once with this payload:",
    "```json",
    JSON.stringify(
      {
        workItemId: packet.workItemId,
        expectedDocumentHash: packet.expectedDocumentHash,
        publicationAttemptToken: packet.publicationAttemptToken,
        url: "<Sites deployed HTTPS URL>",
      },
      null,
      2,
    ),
    "```",
    "Nimbus will independently verify reachability before it records or opens the URL. Report the deployed URL only after the MCP call succeeds.",
    "",
    "## Bounded accepted Handoff",
    packet.acceptedHandoffMarkdown,
  ].join("\n");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createPublicationAttemptToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createFetchHandoffSiteReachabilityProbe(): HandoffSiteReachabilityProbe {
  return {
    check: async (input: HandoffSiteReachabilityProbeInput): Promise<void> => {
      const response = await fetch(input.url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(input.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(
          `Handoff Site returned HTTP ${response.status} ${response.statusText}.`,
        );
      }
    },
  };
}

export async function waitForReachableHandoffSite(input: {
  workItemId: string;
  url: string;
  probe: HandoffSiteReachabilityProbe;
  warningLogger: PublicationWarningLogger;
  retryPolicy: PublicationRetryPolicy;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => Date;
}): Promise<{ attempts: number; checkedAt: string }> {
  validateHandoffSiteUrl(input.url);
  validateRetryPolicy(input.retryPolicy);

  let lastError: Error | null = null;
  for (
    let attempt = 1;
    attempt <= input.retryPolicy.maxAttempts;
    attempt += 1
  ) {
    try {
      await input.probe.check({
        url: input.url,
        timeoutMs: input.retryPolicy.timeoutMs,
      });
      return { attempts: attempt, checkedAt: input.now().toISOString() };
    } catch (error: unknown) {
      lastError = asError(error);
      input.warningLogger.warn(
        "Nimbus Handoff Site reachability check failed.",
        {
          workItemId: input.workItemId,
          url: input.url,
          attempt,
          maxAttempts: input.retryPolicy.maxAttempts,
          error: lastError.message,
        },
      );
      if (attempt < input.retryPolicy.maxAttempts) {
        await input.sleep(input.retryPolicy.retryDelayMs);
      }
    }
  }

  if (lastError === null) {
    throw new HandoffPublicationInputError(
      "Nimbus Handoff Site reachability check did not run.",
    );
  }
  throw new HandoffSiteReachabilityError(
    input.url,
    input.retryPolicy.maxAttempts,
    lastError,
  );
}

export function sleepForPublicationRetry(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function validatePublisherConfig(config: HandoffSitePublisherConfig): void {
  validateRetryPolicy(config.retryPolicy);
  if (
    typeof config.taskLauncher.startTask !== "function" ||
    typeof config.reachabilityProbe.check !== "function" ||
    typeof config.warningLogger.warn !== "function" ||
    typeof config.createAttemptToken !== "function" ||
    typeof config.now !== "function" ||
    typeof config.sleep !== "function"
  ) {
    throw new HandoffPublicationInputError(
      "Nimbus Handoff Site publisher requires task launch, reachability, warning, clock, token, and sleep dependencies.",
    );
  }
}

function validateBeginPublicationInput(
  input: BeginHandoffSitePublicationInput,
): void {
  requireNonEmpty(input.workItemId, "workItemId");
  requireNonEmpty(input.workItemTitle, "workItemTitle");
  requireNonEmpty(input.model, "model");
  requireSha256(input.expectedDocumentHash, "expectedDocumentHash");
  requireNonEmpty(input.acceptedHandoffMarkdown, "acceptedHandoffMarkdown");
  if (input.acceptedHandoffMarkdown.length > MAX_HANDOFF_MARKDOWN_CHARACTERS) {
    throw new HandoffPublicationInputError(
      `acceptedHandoffMarkdown exceeds ${MAX_HANDOFF_MARKDOWN_CHARACTERS} characters.`,
    );
  }
}

function validateRecordHandoffSiteInput(input: RecordHandoffSiteInput): void {
  requireNonEmpty(input.workItemId, "workItemId");
  requireSha256(input.acceptedHandoffDigest, "acceptedHandoffDigest");
  requireAttemptToken(input.publicationAttemptToken);
  requireNonEmpty(input.url, "url");
}

function validatePacket(packet: HandoffSitePublicationPacket): void {
  requireNonEmpty(packet.workItemId, "workItemId");
  requireNonEmpty(packet.workItemTitle, "workItemTitle");
  requireSha256(packet.expectedDocumentHash, "expectedDocumentHash");
  requireNonEmpty(packet.acceptedHandoffMarkdown, "acceptedHandoffMarkdown");
  if (packet.acceptedHandoffMarkdown.length > MAX_HANDOFF_MARKDOWN_CHARACTERS) {
    throw new HandoffPublicationInputError(
      `acceptedHandoffMarkdown exceeds ${MAX_HANDOFF_MARKDOWN_CHARACTERS} characters.`,
    );
  }
  requireSha256(packet.acceptedHandoffDigest, "acceptedHandoffDigest");
  requireAttemptToken(packet.publicationAttemptToken);
  const expectedDigest = sha256(packet.acceptedHandoffMarkdown);
  if (packet.acceptedHandoffDigest !== expectedDigest) {
    throw new HandoffPublicationInputError(
      "acceptedHandoffDigest does not match acceptedHandoffMarkdown.",
    );
  }
}

function validateAttemptBinding(
  attempt: PublicationAttempt,
  input: RecordHandoffSiteInput,
): void {
  if (attempt.workItemId !== input.workItemId) {
    throw new HandoffPublicationAttemptBindingError(
      `Publication attempt is bound to Work Item ${attempt.workItemId}, not ${input.workItemId}.`,
    );
  }
  if (attempt.acceptedHandoffDigest !== input.acceptedHandoffDigest) {
    throw new HandoffPublicationAttemptBindingError(
      "Publication attempt is bound to a different accepted Handoff digest.",
    );
  }
}

function validateRetryPolicy(retryPolicy: PublicationRetryPolicy): void {
  if (
    !Number.isInteger(retryPolicy.maxAttempts) ||
    retryPolicy.maxAttempts < 1
  ) {
    throw new HandoffPublicationInputError(
      "maxAttempts must be a positive integer.",
    );
  }
  if (
    !Number.isInteger(retryPolicy.retryDelayMs) ||
    retryPolicy.retryDelayMs < 0
  ) {
    throw new HandoffPublicationInputError(
      "retryDelayMs must be a non-negative integer.",
    );
  }
  if (!Number.isInteger(retryPolicy.timeoutMs) || retryPolicy.timeoutMs < 1) {
    throw new HandoffPublicationInputError(
      "timeoutMs must be a positive integer.",
    );
  }
}

function validateHandoffSiteUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error: unknown) {
    throw new InvalidHandoffSiteUrlError(value, asError(error).message);
  }
  if (url.protocol !== "https:") {
    throw new InvalidHandoffSiteUrlError(value, "URL must use HTTPS.");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new InvalidHandoffSiteUrlError(
      value,
      "URL must not include credentials.",
    );
  }
}

function requireSha256(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new HandoffPublicationInputError(
      `${field} must be a SHA-256 hexadecimal digest.`,
    );
  }
}

function requireAttemptToken(value: string): void {
  requireNonEmpty(value, "publicationAttemptToken");
  if (/\s/.test(value)) {
    throw new HandoffPublicationInputError(
      "publicationAttemptToken must not contain whitespace.",
    );
  }
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new HandoffPublicationInputError(`${field} must be non-empty.`);
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
