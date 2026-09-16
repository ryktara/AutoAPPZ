import { AppError, blueprint as contracts } from "@autoappz/contracts";
import type { BlueprintsRepository, RequirementsRepository } from "@autoappz/storage";

type Blueprint = contracts.Blueprint;
type BlueprintDocument = contracts.BlueprintDocument;
type Requirement = contracts.Requirement;
type AcceptanceCriterion = contracts.AcceptanceCriterion;

export class BlueprintService {
  constructor(
    private readonly repo: BlueprintsRepository,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = defaultId,
  ) {}

  latest(projectId: string): Blueprint | null {
    return this.repo.latest(projectId) ?? null;
  }

  /** Every save is a new version; versions are immutable so approvals stay meaningful. */
  save(projectId: string, document: BlueprintDocument, derivedFromTaskId?: string): Blueprint {
    const parsed = contracts.BlueprintDocumentSchema.parse(document);
    const previous = this.repo.latest(projectId);
    const b: Blueprint = {
      id: this.newId(),
      projectId,
      version: (previous?.version ?? 0) + 1,
      document: parsed,
    };
    if (derivedFromTaskId !== undefined) b.derivedFromTaskId = derivedFromTaskId;
    this.repo.insert(b);
    return b;
  }

  approve(projectId: string, version: number): Blueprint {
    const b = this.repo.get(projectId, version);
    if (!b)
      throw new AppError("not_found", "blueprint.not_found", "Blueprint version not found.", {
        details: { projectId, version },
      });
    const latest = this.repo.latest(projectId);
    if (latest && latest.version !== version) {
      throw new AppError(
        "conflict",
        "blueprint.not_latest",
        "Only the latest blueprint version can be approved.",
        {
          details: { latest: latest.version, requested: version },
        },
      );
    }
    const approvedAt = this.now();
    this.repo.setApproved(b.id, approvedAt);
    return { ...b, approvedAt };
  }
}

export class RequirementsService {
  constructor(
    private readonly repo: RequirementsRepository,
    private readonly blueprints: BlueprintsRepository,
  ) {}

  list(projectId: string): { requirements: Requirement[]; criteria: AcceptanceCriterion[] } {
    return this.repo.list(projectId);
  }

  /**
   * Derives REQ-nnn rows from the latest blueprint: one per page, one per entity, plus a general bucket
   * for unassigned criteria. Existing statuses survive when the derived row keeps the same ref.
   */
  sync(projectId: string): { requirements: Requirement[]; criteria: AcceptanceCriterion[] } {
    const bp = this.blueprints.latest(projectId);
    if (!bp) {
      this.repo.replace(projectId, [], []);
      return { requirements: [], criteria: [] };
    }
    const existing = this.repo.list(projectId);
    const statusByRef = new Map(existing.requirements.map((r) => [r.blueprintItemRef ?? r.id, r.status]));
    const critStatusByText = new Map(existing.criteria.map((c) => [`${c.requirementId}|${c.text}`, c]));

    const derived = deriveRequirements(bp.document);
    const requirements: Requirement[] = derived.map((d, i) => ({
      id: reqId(i + 1),
      projectId,
      blueprintItemRef: d.ref,
      title: d.title,
      status: statusByRef.get(d.ref) ?? "planned",
    }));
    const refToId = new Map(requirements.map((r) => [r.blueprintItemRef ?? r.id, r.id]));

    const criteria: AcceptanceCriterion[] = [];
    let n = 0;
    for (const ac of bp.document.acceptance_criteria) {
      const ref = ac.ref !== undefined && refToId.has(refFor(ac.ref)) ? refFor(ac.ref) : "general";
      const requirementId = refToId.get(ref);
      if (!requirementId) continue;
      n += 1;
      const prior = critStatusByText.get(`${requirementId}|${ac.text}`);
      const c: AcceptanceCriterion = {
        id: acId(n),
        requirementId,
        text: ac.text,
        status: prior?.status ?? "planned",
      };
      if (prior?.evidence) c.evidence = prior.evidence;
      criteria.push(c);
    }
    this.repo.replace(projectId, requirements, criteria);
    return { requirements, criteria };
  }
}

function deriveRequirements(doc: BlueprintDocument): { ref: string; title: string }[] {
  const out: { ref: string; title: string }[] = [];
  for (const page of doc.pages) out.push({ ref: `page:${page.id}`, title: `Page: ${page.title}` });
  for (const entity of doc.entities)
    out.push({ ref: `entity:${entity.name}`, title: `Entity: ${entity.name}` });
  const unassigned = doc.acceptance_criteria.some((ac) => {
    const ref = ac.ref;
    return ref === undefined || !out.some((r) => r.ref === refFor(ref));
  });
  if (unassigned || out.length === 0) out.push({ ref: "general", title: "General acceptance criteria" });
  return out;
}

/** Criteria reference pages/entities by bare id; requirements use a typed ref. */
function refFor(bareId: string): string {
  return bareId.includes(":") ? bareId : `page:${bareId}`;
}

const reqId = (n: number) => `REQ-${String(n).padStart(3, "0")}`;
const acId = (n: number) => `AC-${String(n).padStart(3, "0")}`;

function defaultId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = "bp_";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
