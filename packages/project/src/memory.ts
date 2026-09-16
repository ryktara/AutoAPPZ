import { AppError, type memory as contracts } from "@autoappz/contracts";
import type { ProjectMemoryRepository } from "@autoappz/storage";

type Item = contracts.ProjectMemoryItem;
type Category = contracts.MemoryCategory;

/** Distilled project facts with provenance; editable by the user, never a transcript. */
export class ProjectMemoryService {
  constructor(
    private readonly repo: ProjectMemoryRepository,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = defaultId,
  ) {}

  list(projectId: string, includeSuperseded = false): Item[] {
    return this.repo.list(projectId, includeSuperseded);
  }

  add(input: {
    projectId: string;
    category: Category;
    statement: string;
    confidence?: number | undefined;
    provenanceTaskId?: string | undefined;
  }): Item {
    const item: Item = {
      id: this.newId(),
      projectId: input.projectId,
      category: input.category,
      statement: input.statement.trim(),
      confidence: input.confidence ?? 1,
      createdAt: this.now(),
    };
    if (input.provenanceTaskId !== undefined) item.provenanceTaskId = input.provenanceTaskId;
    this.repo.insert(item);
    return item;
  }

  supersede(id: string, statement: string, confidence = 1): Item {
    const old = this.repo.get(id);
    if (!old)
      throw new AppError("not_found", "memory.not_found", "Memory item not found.", { details: { id } });
    if (old.supersededBy) {
      throw new AppError("conflict", "memory.already_superseded", "This item was already replaced.", {
        details: { id, by: old.supersededBy },
      });
    }
    const next = this.add({
      projectId: old.projectId,
      category: old.category,
      statement,
      confidence,
      provenanceTaskId: old.provenanceTaskId,
    });
    this.repo.markSuperseded(old.id, next.id);
    return next;
  }

  delete(id: string): void {
    if (!this.repo.delete(id))
      throw new AppError("not_found", "memory.not_found", "Memory item not found.", { details: { id } });
  }
}

function defaultId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = "mem_";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
