import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect } from "node:net";
import type { AddressInfo, Socket } from "node:net";

export const PREVIEW_SCRIPT_VERSION = "1";
export const PREVIEW_SCRIPT_PATH = "/__autoappz/preview.js";

/**
 * Instrumentation injected into previewed pages. Reports only diagnostics (errors, console errors/warnings,
 * navigation, failed requests, blank screen) to the embedding window. It never receives credentials.
 * The renderer validates `event.source` and `event.origin` against the preview lease before trusting it.
 */
export function previewScript(): string {
  return `(() => {
  if (window.__autoappzPreview) return;
  window.__autoappzPreview = "${PREVIEW_SCRIPT_VERSION}";
  var SOURCE = "autoappz-preview";
  var budget = 60; // console messages per page load
  function post(ev) {
    ev.source = SOURCE; ev.version = "${PREVIEW_SCRIPT_VERSION}"; ev.at = Date.now();
    try { window.parent.postMessage(ev, "*"); } catch (e) {}
  }
  function str(v) { try { return typeof v === "string" ? v : JSON.stringify(v); } catch (e) { return String(v); } }
  window.addEventListener("error", function (e) {
    post({ type: "error", message: e.message || "Uncaught error", stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 8000) : undefined, url: e.filename });
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason; post({ type: "unhandledrejection", message: r && r.message ? r.message : str(r), stack: r && r.stack ? String(r.stack).slice(0, 8000) : undefined });
  });
  ["error", "warn"].forEach(function (level) {
    var orig = console[level];
    console[level] = function () {
      if (budget-- > 0) post({ type: "console", level: level, message: Array.prototype.map.call(arguments, str).join(" ").slice(0, 4000) });
      return orig.apply(console, arguments);
    };
  });
  var ofetch = window.fetch;
  if (ofetch) window.fetch = function (input, init) {
    return ofetch.apply(this, arguments).then(function (res) {
      if (!res.ok) post({ type: "network", url: String(res.url || input).slice(0, 2000), status: res.status, message: "fetch failed" });
      return res;
    }, function (err) { post({ type: "network", url: String(input).slice(0, 2000), message: err && err.message ? err.message : "fetch error" }); throw err; });
  };
  function nav() { post({ type: "navigation", url: location.href }); }
  var push = history.pushState, replace = history.replaceState;
  history.pushState = function () { var r = push.apply(this, arguments); nav(); return r; };
  history.replaceState = function () { var r = replace.apply(this, arguments); nav(); return r; };
  window.addEventListener("popstate", nav);
  window.addEventListener("load", function () {
    post({ type: "ready", url: location.href });
    setTimeout(function () {
      var root = document.body;
      var painted = root && root.innerText.trim().length > 0 || document.querySelector("img,canvas,svg,video");
      if (!painted) post({ type: "blank", message: "No visible content 3 s after load" });
    }, 3000);
  });
})();`;
}

export interface PreviewProxy {
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

/**
 * Reverse proxy in front of the dev server. Injects the preview script into HTML documents and forwards
 * WebSocket upgrades (HMR) transparently. Listens on loopback only.
 */
export async function startPreviewProxy(options: {
  port: number;
  targetPort: number;
  targetHost?: string | undefined;
}): Promise<PreviewProxy> {
  const targetHost = options.targetHost ?? "127.0.0.1";
  const server: Server = createServer((req, res) => {
    handle(req, res);
  });

  function handle(req: IncomingMessage, res: ServerResponse): void {
    if (req.url === PREVIEW_SCRIPT_PATH) {
      res.writeHead(200, {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(previewScript());
      return;
    }
    const headers = {
      ...req.headers,
      host: `${targetHost}:${String(options.targetPort)}`,
      "accept-encoding": "identity",
    };
    const upstream = request(
      { host: targetHost, port: options.targetPort, method: req.method, path: req.url, headers },
      (up) => {
        const type = up.headers["content-type"] ?? "";
        if (type.includes("text/html")) {
          const chunks: Buffer[] = [];
          up.on("data", (c: Buffer) => chunks.push(c));
          up.on("end", () => {
            const html = injectScript(Buffer.concat(chunks).toString("utf8"));
            const out = { ...up.headers, "content-length": String(Buffer.byteLength(html)) };
            delete out["content-encoding"];
            delete out["transfer-encoding"];
            res.writeHead(up.statusCode ?? 200, out);
            res.end(html);
          });
        } else {
          res.writeHead(up.statusCode ?? 200, up.headers);
          up.pipe(res);
        }
      },
    );
    upstream.on("error", (err: NodeJS.ErrnoException) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/html; charset=utf-8" });
      res.end(
        injectScript(
          `<!doctype html><html><body><h1>Preview unavailable</h1><p>${escapeHtml(err.message)}</p></body></html>`,
        ),
      );
    });
    req.pipe(upstream);
  }

  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const target = connect(options.targetPort, targetHost, () => {
      const lines = [`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1`];
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        lines.push(`${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
      }
      target.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) target.write(head);
      socket.pipe(target).pipe(socket);
    });
    const drop = () => {
      socket.destroy();
      target.destroy();
    };
    target.on("error", drop);
    socket.on("error", drop);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: `http://127.0.0.1:${String(port)}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

export function injectScript(html: string): string {
  const tag = `<script src="${PREVIEW_SCRIPT_PATH}"></script>`;
  if (html.includes(PREVIEW_SCRIPT_PATH)) return html;
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  return tag + html;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
