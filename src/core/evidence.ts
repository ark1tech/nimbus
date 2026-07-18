import path from "node:path";

import type { EvidenceLink } from "../shared/model";
import { EvidenceValidationError } from "./errors";

export interface EvidenceRepositorySnapshot {
  rootPath: string;
  files: Readonly<Record<string, string>>;
}

export interface ValidatedEvidenceLink extends EvidenceLink {
  absolutePath: string;
}

type LegacyEvidenceLink = {
  id: string;
  path: string;
  locator: string;
  role: EvidenceLink["role"];
  valid: boolean;
};

export function validateEvidencePath(repositoryRoot: string, evidencePath: string): string {
  if (evidencePath.length === 0) throw new EvidenceValidationError("Evidence path must not be empty.");
  if (path.isAbsolute(evidencePath)) throw new EvidenceValidationError(`Evidence path must be repository-relative: ${evidencePath}.`);
  const resolvedRoot = path.resolve(repositoryRoot);
  const resolvedPath = path.resolve(resolvedRoot, evidencePath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) throw new EvidenceValidationError(`Evidence path resolves outside repository root: ${evidencePath}.`);
  return resolvedPath;
}

export function validateEvidenceLineRange(fileContent: string, startLine: number, endLine: number): void {
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) throw new EvidenceValidationError(`Evidence line range is invalid: ${startLine}-${endLine}.`);
  const lineCount = fileContent.split("\n").length;
  if (endLine > lineCount) throw new EvidenceValidationError(`Evidence line range ${startLine}-${endLine} exceeds file length ${lineCount}.`);
}

export function validateEvidenceLink(
  snapshot: EvidenceRepositorySnapshot,
  evidence: EvidenceLink | LegacyEvidenceLink,
): ValidatedEvidenceLink | (LegacyEvidenceLink & { absolutePath: string; valid: true }) {
  const absolutePath = validateEvidencePath(snapshot.rootPath, evidence.path);
  const relativePath = path.relative(path.resolve(snapshot.rootPath), absolutePath);
  const fileContent = snapshot.files[relativePath];
  if (typeof fileContent !== "string") throw new EvidenceValidationError(`Evidence file does not exist in inspected snapshot: ${evidence.path}.`);
  if ("locator" in evidence) {
    validateEvidenceLocator(fileContent, evidence.locator);
    return { ...evidence, absolutePath, valid: true };
  }
  validateEvidenceLineRange(fileContent, evidence.startLine, evidence.endLine);
  return { ...evidence, absolutePath };
}

/** Compatibility helper for legacy evidence fixtures while line ranges are canonical. */
export function validateEvidenceLocator(fileContent: string, locator: string): void {
  const symbol = /^#([A-Za-z_$][\w$]*)$/.exec(locator);
  const snippet = /^#"(.+)"$/.exec(locator);
  if (symbol !== null && new RegExp(`\\b${symbol[1]}\\b`).test(fileContent)) return;
  if (snippet !== null && fileContent.includes(snippet[1])) return;
  throw new EvidenceValidationError(`Evidence locator does not resolve: ${locator}.`);
}
