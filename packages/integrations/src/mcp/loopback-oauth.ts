import { createServer, type Server } from "node:http";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { AppError } from "@autoappz/contracts";

export interface OAuthState {
  clientInformation?: OAuthClientInformationFull | undefined;
  tokens?: OAuthTokens | undefined;
}

export interface LoopbackOAuthOptions {
  /** Persists client registration + tokens (the desktop stores this as one secret). */
  readonly load: () => Promise<OAuthState>;
  readonly save: (state: OAuthState) => Promise<void>;
  /** Opens the authorization URL in the user's browser (desktop: shell.openExternal). */
  readonly openAuthorizationUrl: (url: URL) => Promise<void> | void;
  readonly clientName?: string | undefined;
}

/**
 * OAuth 2.1 client provider for MCP HTTP servers using a loopback redirect (127.0.0.1, ephemeral port)
 * with PKCE handled by the SDK. Tokens never leave the main process; they are persisted via `save`.
 */
export class LoopbackOAuthProvider implements OAuthClientProvider {
  private server: Server | undefined;
  private redirect: URL | undefined;
  private verifier: string | undefined;
  private codeWaiters: { resolve: (code: string) => void; reject: (error: Error) => void }[] = [];
  private pendingCode: string | undefined;
  private cachedState: OAuthState | undefined;

  constructor(private readonly options: LoopbackOAuthOptions) {}

  get redirectUrl(): string | URL {
    return this.redirect ?? "http://127.0.0.1/callback";
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.options.clientName ?? "AutoAPPZ",
      redirect_uris: [String(this.redirectUrl)],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async clientInformation(): Promise<OAuthClientInformationFull | undefined> {
    return (await this.loadState()).clientInformation;
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    const state = await this.loadState();
    state.clientInformation = info;
    await this.options.save(state);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.loadState()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const state = await this.loadState();
    state.tokens = tokens;
    await this.options.save(state);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.ensureLoopback();
    // The SDK built the URL with the redirect_uri it read before the loopback existed; replace it.
    authorizationUrl.searchParams.set("redirect_uri", String(this.redirectUrl));
    await this.options.openAuthorizationUrl(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.verifier) throw new AppError("internal", "mcp.oauth_state", "No PKCE verifier saved.");
    return this.verifier;
  }

  /** Starts the loopback listener ahead of time so the redirect URI is known during registration. */
  async ensureLoopback(): Promise<URL> {
    if (this.redirect) return this.redirect;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.setHeader("content-type", "text/html; charset=utf-8");
      if (code) {
        res.end("<!doctype html><title>AutoAPPZ</title><p>Signed in. You can return to AutoAPPZ.</p>");
        this.deliver(code);
      } else {
        res.statusCode = 400;
        res.end(
          `<!doctype html><title>AutoAPPZ</title><p>Authorization failed: ${escapeHtml(error ?? "no code")}</p>`,
        );
        for (const w of this.codeWaiters.splice(0))
          w.reject(
            new AppError("permission", "mcp.oauth_denied", `Authorization failed: ${error ?? "no code"}`),
          );
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    this.server = server;
    this.redirect = new URL(`http://127.0.0.1:${String(port)}/callback`);
    return this.redirect;
  }

  waitForAuthorizationCode(): Promise<string> {
    if (this.pendingCode !== undefined) {
      const code = this.pendingCode;
      this.pendingCode = undefined;
      return Promise.resolve(code);
    }
    return new Promise((resolve, reject) => this.codeWaiters.push({ resolve, reject }));
  }

  close(): void {
    this.server?.close();
    this.server = undefined;
    this.redirect = undefined;
  }

  private deliver(code: string): void {
    const waiters = this.codeWaiters.splice(0);
    if (waiters.length === 0) this.pendingCode = code;
    for (const w of waiters) w.resolve(code);
  }

  private async loadState(): Promise<OAuthState> {
    this.cachedState ??= await this.options.load();
    return this.cachedState;
  }
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
