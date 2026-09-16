import type { SecretRef } from "@autoappz/contracts";

export interface DatabaseProvider {
  readonly id: string;
  listInstances(credential: SecretRef): Promise<readonly { id: string; name: string }[]>;
  connectionRef(instanceId: string, credential: SecretRef): Promise<SecretRef>;
}

export interface DeploymentProvider {
  readonly id: string;
  deploy(input: {
    projectRoot: string;
    credential: SecretRef;
    signal: AbortSignal;
  }): Promise<{ url: string; id: string }>;
}

export interface McpClient {
  listTools(): Promise<readonly { name: string; description: string }[]>;
  call(tool: string, input: unknown, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

export interface TemplateSource {
  readonly id: string;
  list(): Promise<readonly { id: string; displayName: string }[]>;
  materialize(templateId: string, targetDir: string): Promise<void>;
}
