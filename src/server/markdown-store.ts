import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  applyWorkItemUpdate,
  hashWorkItemMarkdown,
  parseWorkItemMarkdown,
  serializeWorkItemMarkdown,
} from "../core/work-item-markdown";
import { StaleWorkItemUpdateError } from "../core/errors";
import type { WorkItem, WorkItemUpdate } from "../shared/model";

export interface MarkdownWorkItemStoreOptions {
  filePath: string;
}

export interface StoredWorkItem {
  workItem: WorkItem;
  documentHash: string;
}

export interface MarkdownWorkItemStore {
  read: () => Promise<WorkItem>;
  readWithHash: () => Promise<StoredWorkItem>;
  write: (workItem: WorkItem) => Promise<void>;
  update: (update: WorkItemUpdate) => Promise<StoredWorkItem>;
}

export class WorkItemFileError extends Error {
  public readonly filePath: string;

  public constructor(message: string, filePath: string, cause: unknown) {
    super(message, { cause });
    this.name = "WorkItemFileError";
    this.filePath = filePath;
  }
}

export function createMarkdownWorkItemStore(options: MarkdownWorkItemStoreOptions): MarkdownWorkItemStore {
  const filePath = path.resolve(options.filePath);
  return {
    read: async (): Promise<WorkItem> => (await readCurrent(filePath)).workItem,
    readWithHash: async (): Promise<StoredWorkItem> => readCurrent(filePath),
    write: async (workItem: WorkItem): Promise<void> => writeCurrent(filePath, serializeWorkItemMarkdown(workItem)),
    update: async (update: WorkItemUpdate): Promise<StoredWorkItem> => {
      const current = await readCurrent(filePath);
      if (current.documentHash !== update.expectedDocumentHash) throw new StaleWorkItemUpdateError(update.expectedDocumentHash, current.documentHash);
      const next = applyWorkItemUpdate(current.workItem, update);
      const markdown = serializeWorkItemMarkdown(next);
      await writeCurrent(filePath, markdown);
      return { workItem: next, documentHash: hashWorkItemMarkdown(markdown) };
    },
  };
}

async function readCurrent(filePath: string): Promise<StoredWorkItem> {
  try {
    const markdown = await readFile(filePath, "utf8");
    return { workItem: parseWorkItemMarkdown(markdown), documentHash: hashWorkItemMarkdown(markdown) };
  } catch (error: unknown) {
    throw new WorkItemFileError(`Nimbus could not read Work Item Markdown at ${filePath}.`, filePath, error);
  }
}

async function writeCurrent(filePath: string, markdown: string): Promise<void> {
  const temporaryPath = `${filePath}.tmp`;
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(temporaryPath, markdown, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error: unknown) {
    throw new WorkItemFileError(`Nimbus could not write Work Item Markdown at ${filePath}.`, filePath, error);
  }
}
