import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  isAppUrl,
  isExternalOpenAllowed,
  isTrustedFrame,
  linuxPasswordStore,
} from "../src/main/security.ts";

const DEV = "http://localhost:5173/";

describe("isAppUrl", () => {
  it("accepts packaged file urls and the dev origin only", () => {
    expect(isAppUrl("file:///C:/app/renderer/index.html", undefined)).toBe(true);
    expect(isAppUrl("http://localhost:5173/index.html", DEV)).toBe(true);
    expect(isAppUrl("http://localhost:5173/index.html", undefined)).toBe(false);
    expect(isAppUrl("http://localhost:41000/", DEV)).toBe(false);
    expect(isAppUrl("https://example.com/", DEV)).toBe(false);
  });
});

describe("isTrustedFrame", () => {
  const main = { url: "file:///app/index.html" };
  const contents = { mainFrame: main };

  it("trusts only the top-level app frame", () => {
    expect(isTrustedFrame(main, contents, undefined)).toBe(true);
    // an iframe with the same url is still a different frame object
    expect(isTrustedFrame({ url: main.url }, contents, undefined)).toBe(false);
    expect(isTrustedFrame({ url: "http://localhost:41000/" }, contents, undefined)).toBe(false);
    expect(isTrustedFrame(null, contents, undefined)).toBe(false);
    expect(isTrustedFrame(main, { mainFrame: null }, undefined)).toBe(false);
  });

  it("distrusts a main frame that navigated away", () => {
    const navigated = { url: "https://evil.example/" };
    expect(isTrustedFrame(navigated, { mainFrame: navigated }, undefined)).toBe(false);
  });
});

describe("contentSecurityPolicy", () => {
  it("production policy forbids eval, inline scripts, remote content and framing", () => {
    const csp = contentSecurityPolicy(undefined);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self';");
  });

  it("dev policy only adds what Vite HMR needs", () => {
    const csp = contentSecurityPolicy(DEV);
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("ws:");
  });

  it("frames are limited to loopback previews", () => {
    expect(contentSecurityPolicy(undefined)).toContain("frame-src http://127.0.0.1:* http://localhost:*");
  });
});

describe("isExternalOpenAllowed", () => {
  it.each(["https://docs.example", "http://localhost:41000"])("allows %s", (u) => {
    expect(isExternalOpenAllowed(u)).toBe(true);
  });
  it.each(["file:///etc/passwd", "javascript:alert(1)", "autoappz://x", "smb://share"])("blocks %s", (u) => {
    expect(isExternalOpenAllowed(u)).toBe(false);
  });
});

describe("linuxPasswordStore", () => {
  it("passes a named keyring backend through on Linux only", () => {
    expect(linuxPasswordStore({ AUTOAPPZ_PASSWORD_STORE: "gnome-libsecret" }, "linux")).toBe(
      "gnome-libsecret",
    );
    expect(linuxPasswordStore({ AUTOAPPZ_PASSWORD_STORE: "kwallet6" }, "linux")).toBe("kwallet6");
    expect(linuxPasswordStore({ AUTOAPPZ_PASSWORD_STORE: "gnome-libsecret" }, "win32")).toBeUndefined();
    expect(linuxPasswordStore({}, "linux")).toBeUndefined();
  });
  it("never accepts an obfuscating or unknown store", () => {
    for (const v of ["basic", "basic_text", "", " ", "gnome-libsecret; --no-sandbox", "detect"])
      expect(linuxPasswordStore({ AUTOAPPZ_PASSWORD_STORE: v }, "linux")).toBeUndefined();
  });
});
