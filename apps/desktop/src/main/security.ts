/**
 * Pure security policy helpers for the main process. No Electron imports so they are unit-testable;
 * window.ts adapts them to BrowserWindow/WebContents.
 */

export interface FrameLike {
  readonly url: string;
}
export interface ContentsLike {
  readonly mainFrame: FrameLike | null;
}

/** True for URLs the renderer is allowed to be at: the packaged index.html or the dev server origin. */
export function isAppUrl(url: string, devUrl: string | undefined): boolean {
  if (devUrl !== undefined && url.startsWith(devUrl)) return true;
  return url.startsWith("file://");
}

/**
 * A frame is trusted only when it is the top-level frame of the given contents and its URL is an app URL.
 * Iframes (previews) and foreign navigations therefore never reach the bus.
 */
export function isTrustedFrame(
  frame: FrameLike | null,
  contents: ContentsLike,
  devUrl: string | undefined,
): boolean {
  if (frame === null) return false;
  if (contents.mainFrame === null || frame !== contents.mainFrame) return false;
  return isAppUrl(frame.url, devUrl);
}

/** Content Security Policy for the renderer. No remote scripts, no eval; inline scripts only for Vite dev HMR. */
export function contentSecurityPolicy(devUrl: string | undefined): string {
  const dev = devUrl !== undefined;
  const connect = dev ? "'self' ws: http://localhost:* http://127.0.0.1:*" : "'self'";
  const script = dev ? "'self' 'unsafe-inline'" : "'self'";
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "frame-src http://127.0.0.1:* http://localhost:*",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** Only http(s) links may be handed to the OS browser; everything else (file:, javascript:, custom) is dropped. */
export function isExternalOpenAllowed(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
