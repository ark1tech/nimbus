export class WorkItemMarkdownError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WorkItemMarkdownError";
  }
}

export class EvidenceValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EvidenceValidationError";
  }
}

export class StaleWorkItemUpdateError extends Error {
  public constructor(expectedDocumentHash: string, currentDocumentHash: string) {
    super(
      `Work Item update is stale. Expected document hash ${expectedDocumentHash}; current document hash is ${currentDocumentHash}.`,
    );
    this.name = "StaleWorkItemUpdateError";
  }
}
