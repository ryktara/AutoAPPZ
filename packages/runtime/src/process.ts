import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";

/** Any HTTP response within the timeout counts as alive (dev servers may 404 on "/"). */
export function httpProbe(url: string, timeoutMs = 2_000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      url,
      { method: "GET", timeout: timeoutMs, headers: { "user-agent": "autoappz-health" } },
      (res) => {
        res.resume();
        resolve(true);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => {
      resolve(false);
    });
    req.end();
  });
}

/**
 * Terminates a process tree: SIGTERM, grace period, then SIGKILL. Windows uses `taskkill /T`
 * (argument array, no shell); POSIX signals the process group created by `detached: true`.
 */
export async function killTree(
  child: ChildProcess,
  graceMs = 5_000,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  if (platform === "win32") {
    // No graceful signal exists for arbitrary console apps on Windows; taskkill /T /F ends the tree.
    await runTaskkill(pid);
  } else {
    signalGroup(pid, "SIGTERM");
    const graceful = await Promise.race([exited.then(() => true), sleep(graceMs).then(() => false)]);
    if (!graceful) signalGroup(pid, "SIGKILL");
  }
  await Promise.race([exited, sleep(graceMs)]);
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

function runTaskkill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const tk = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    tk.on("exit", () => {
      resolve();
    });
    tk.on("error", () => {
      resolve();
    });
  });
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
