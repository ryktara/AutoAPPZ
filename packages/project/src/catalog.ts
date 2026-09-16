import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { AppError, project as contracts } from "@autoappz/contracts";
import type { Logger } from "@autoappz/diagnostics";
import type { ProjectsRepository } from "@autoappz/storage";
import {
  assertAllowedProjectDirectory,
  assertEmptyOrMissing,
  assertExistingDirectory,
  slugify,
  uniqueChildDirectory,
  type PathPolicy,
} from "./paths.ts";
import type { TemplateRegistry } from "./templates.ts";

type Project = contracts.Project;

export interface ProjectCatalogOptions {
  repo: ProjectsRepository;
  templates: TemplateRegistry;
  policy: PathPolicy;
  /** Where new projects go unless the caller specifies a parent directory. */
  defaultParentDirectory: () => string;
  logger?: Logger | undefined;
  now?: (() => number) | undefined;
  newId?: (() => string) | undefined;
}

export interface ProjectChange {
  id: string;
  kind: "created" | "updated" | "deleted";
}

/**
 * Project catalog. Creating and importing never execute anything from the project
 * (no install, no scripts); that is the Runtime Supervisor's job and needs explicit user action.
 */
export class ProjectCatalog {
  private readonly repo: ProjectsRepository;
  private readonly templates: TemplateRegistry;
  private readonly policy: PathPolicy;
  private readonly defaultParent: () => string;
  private readonly log: Logger | undefined;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly listeners = new Set<(change: ProjectChange) => void>();

  constructor(options: ProjectCatalogOptions) {
    this.repo = options.repo;
    this.templates = options.templates;
    this.policy = options.policy;
    this.defaultParent = options.defaultParentDirectory;
    this.log = options.logger;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? defaultId;
  }

  onChange(listener: (change: ProjectChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  list(includeArchived = false): Project[] {
    return this.repo.list(includeArchived);
  }

  get(id: string): Project {
    const p = this.repo.get(id);
    if (!p) throw new AppError("not_found", "project.not_found", "Project not found.", { details: { id } });
    return p;
  }

  defaultDirectory(): string {
    return this.defaultParent();
  }

  create(input: { name: string; templateId: string; parentDirectory?: string | undefined }): Project {
    const name = contracts.ProjectNameSchema.parse(input.name);
    const parent = assertAllowedProjectDirectory(input.parentDirectory ?? this.defaultParent(), this.policy);
    mkdirSync(parent, { recursive: true });
    const dir = assertAllowedProjectDirectory(uniqueChildDirectory(parent, slugify(name)), this.policy);
    assertEmptyOrMissing(dir);

    mkdirSync(dir, { recursive: true });
    try {
      this.templates.materialize(input.templateId, dir, { projectName: name });
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }

    const at = this.now();
    const project: Project = {
      id: this.newId(),
      name,
      path: dir,
      origin: "created",
      templateId: input.templateId,
      runtimeProfile: "host",
      createdAt: at,
      lastOpenedAt: at,
    };
    this.repo.insert(project);
    this.log?.info("project created", { projectId: project.id, templateId: input.templateId });
    this.emit({ id: project.id, kind: "created" });
    return project;
  }

  import(input: {
    sourcePath: string;
    mode: "in_place" | "copy";
    name?: string | undefined;
    parentDirectory?: string | undefined;
  }): Project {
    const source = assertAllowedProjectDirectory(input.sourcePath, this.policy);
    assertExistingDirectory(source);
    const name = contracts.ProjectNameSchema.parse(input.name ?? path.basename(source));

    let dir = source;
    let origin: Project["origin"] = "imported";
    if (input.mode === "copy") {
      const parent = assertAllowedProjectDirectory(
        input.parentDirectory ?? this.defaultParent(),
        this.policy,
      );
      mkdirSync(parent, { recursive: true });
      dir = assertAllowedProjectDirectory(uniqueChildDirectory(parent, slugify(name)), this.policy);
      assertEmptyOrMissing(dir);
      cpSync(source, dir, {
        recursive: true,
        filter: (src) => path.basename(src) !== "node_modules",
      });
      origin = "copied";
    } else {
      const existing = this.repo.findByPath(dir);
      if (existing) {
        throw new AppError("conflict", "project.already_imported", "This folder is already a project.", {
          details: { projectId: existing.id },
        });
      }
    }

    const at = this.now();
    const project: Project = {
      id: this.newId(),
      name,
      path: dir,
      origin,
      runtimeProfile: "host",
      createdAt: at,
      lastOpenedAt: at,
    };
    this.repo.insert(project);
    this.log?.info("project imported", { projectId: project.id, mode: input.mode });
    this.emit({ id: project.id, kind: "created" });
    return project;
  }

  open(id: string): Project {
    const p = { ...this.get(id), lastOpenedAt: this.now() };
    this.repo.update(p);
    this.emit({ id, kind: "updated" });
    return p;
  }

  rename(id: string, name: string): Project {
    const p = { ...this.get(id), name: contracts.ProjectNameSchema.parse(name) };
    this.repo.update(p);
    this.emit({ id, kind: "updated" });
    return p;
  }

  setRuntimeProfile(id: string, runtimeProfile: Project["runtimeProfile"]): Project {
    const p = { ...this.get(id), runtimeProfile };
    this.repo.update(p);
    this.emit({ id, kind: "updated" });
    return p;
  }

  /**
   * Removes the project from the catalog. Files are deleted only when explicitly requested, the user
   * retyped the name, and the directory was created or copied by AutoAPPZ — never for in-place imports.
   */
  delete(input: { id: string; deleteFiles: boolean; confirmName?: string | undefined }): void {
    const p = this.get(input.id);
    if (input.deleteFiles) {
      if (p.origin === "imported") {
        throw new AppError(
          "precondition",
          "project.delete_files_refused",
          "This project was imported in place; its files are not managed by AutoAPPZ and will not be deleted.",
        );
      }
      if (input.confirmName !== p.name) {
        throw new AppError(
          "precondition",
          "project.confirm_name_mismatch",
          "Type the project name to confirm deleting its files.",
        );
      }
      const dir = assertAllowedProjectDirectory(p.path, this.policy);
      rmSync(dir, { recursive: true, force: true });
      this.log?.warn("project files deleted", { projectId: p.id });
    }
    this.repo.delete(p.id);
    this.log?.info("project removed from catalog", { projectId: p.id, deletedFiles: input.deleteFiles });
    this.emit({ id: p.id, kind: "deleted" });
  }

  private emit(change: ProjectChange): void {
    for (const l of this.listeners) l(change);
  }
}

function defaultId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = "prj_";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
