export interface ProjectDescriptor {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly templateId: string;
  readonly createdAt: number;
  readonly lastOpenedAt: number;
}

export interface TemplateDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly stack: readonly string[];
  readonly source: { kind: "bundled"; dir: string } | { kind: "git"; url: string; ref: string };
}

export interface ProjectService {
  list(): Promise<readonly ProjectDescriptor[]>;
  get(id: string): Promise<ProjectDescriptor | undefined>;
  create(input: { name: string; templateId: string; directory?: string }): Promise<ProjectDescriptor>;
  remove(id: string, options: { deleteFiles: boolean }): Promise<void>;
}
