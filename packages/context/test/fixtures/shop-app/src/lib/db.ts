export interface PoolOptions {
  readonly size: number;
  readonly idleTimeoutMs: number;
}

const DEFAULT_POOL: PoolOptions = { size: 5, idleTimeoutMs: 30_000 };

export function connectionPool(options: Partial<PoolOptions> = {}): PoolOptions {
  return { ...DEFAULT_POOL, ...options };
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  void sql;
  void params;
  return [];
}
