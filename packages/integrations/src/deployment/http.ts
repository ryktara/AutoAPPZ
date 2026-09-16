import { AppError } from "@autoappz/contracts";

export interface ApiRequest {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | undefined;
  readonly token: string;
  readonly body?: unknown;
  /** Raw body (file bytes, multipart); wins over `body`. */
  readonly raw?: Buffer | FormData | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly signal: AbortSignal;
  /** Status codes that are not failures (e.g. 409 "already uploaded"). */
  readonly okStatuses?: readonly number[] | undefined;
}

export interface ApiResponse<T> {
  readonly status: number;
  readonly data: T;
}

/** JSON-first fetch wrapper for provider APIs: bearer token, error mapping, no retries on 4xx. */
export async function api<T = unknown>(url: string, req: ApiRequest): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${req.token}`,
    Accept: "application/json",
    ...(req.headers ?? {}),
  };
  let body: RequestInit["body"];
  if (req.raw !== undefined) body = req.raw instanceof FormData ? req.raw : new Uint8Array(req.raw);
  else if (req.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(req.body);
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: req.method ?? "GET",
      headers,
      signal: req.signal,
      ...(body !== undefined ? { body } : {}),
    });
  } catch (error) {
    throw new AppError(
      "external",
      "deploy.network",
      `Could not reach ${new URL(url).host}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok && !(req.okStatuses ?? []).includes(res.status)) {
    const message = extractMessage(data) ?? `${String(res.status)} ${res.statusText}`;
    throw new AppError(
      "external",
      res.status === 401 || res.status === 403 ? "deploy.unauthorized" : "deploy.api_error",
      message,
      {
        details: { status: res.status, url: url.replace(/\?.*$/, "") },
      },
    );
  }
  return { status: res.status, data: data as T };
}

function extractMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as {
    error?: { message?: string } | string;
    message?: string;
    errors?: { message?: string }[];
  };
  if (typeof d.error === "string") return d.error;
  if (d.error && typeof d.error === "object" && typeof d.error.message === "string") return d.error.message;
  if (typeof d.message === "string") return d.message;
  const first = d.errors?.[0]?.message;
  return typeof first === "string" ? first : undefined;
}

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new AppError("cancelled", "deploy.cancelled", "Deployment cancelled."));
      },
      { once: true },
    );
  });
