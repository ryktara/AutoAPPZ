import fc from "fast-check";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDir } from "@autoappz/testing";
import {
  GitService,
  checkpointBaseRef,
  createGitClient,
  parsePorcelainV2,
  withTaskTrailer,
} from "../src/index.ts";

const client = createGitClient();
const service = new GitService({ client });

async function repo(dir: string, files: Record<string, string>): Promise<string> {
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    writeFileSync(path.join(dir, p), content);
  }
  await service.init(dir, "initial");
  return dir;
}
const read = (dir: string, p: string) => readFileSync(path.join(dir, p), "utf8");
const write = (dir: string, p: string, c: string) => {
  mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
  writeFileSync(path.join(dir, p), c);
};

describe("helpers", () => {
  it("builds refs, trailers and parses porcelain v2", () => {
    expect(checkpointBaseRef("task_1")).toBe("refs/autoappz/checkpoints/task_1/base");
    expect(() => checkpointBaseRef("../x")).toThrow();
    const once = withTaskTrailer("feat: x", "t1");
    expect(once).toBe("feat: x\n\nAutoAPPZ-Task: t1\n");
    expect(withTaskTrailer(once, "t1")).toBe(once);
    const parsed = parsePorcelainV2(
      [
        "# branch.oid abc",
        "# branch.head main",
        "1 .M N... 100644 100644 100644 h h src/a.ts",
        "? new.txt",
        "u UU N... 100644 100644 100644 100644 h h h conflict.txt",
        "",
      ].join("\0"),
    );
    expect(parsed).toEqual({
      branch: "main",
      modified: ["src/a.ts"],
      untracked: ["new.txt"],
      conflicted: ["conflict.txt"],
    });
  });
});

// Real git processes under a fully parallel test run can take a few seconds each.
describe("GitService", { timeout: 30_000 }, () => {
  it("init creates a repository with an initial commit; status reports the tree", async () => {
    await withTempDir(async (dir) => {
      expect(await service.isRepository(dir)).toBe(false);
      await repo(dir, { "a.txt": "a\n" });
      const s = await service.status(dir);
      expect(s).toMatchObject({ isRepository: true, branch: "main", modified: [], untracked: [] });
      expect(s.head).toMatch(/^[0-9a-f]{40}$/);
      write(dir, "a.txt", "changed\n");
      write(dir, "b.txt", "new\n");
      expect(await service.status(dir)).toMatchObject({ modified: ["a.txt"], untracked: ["b.txt"] });
      // init is idempotent and nested init is refused
      await service.init(dir);
      mkdirSync(path.join(dir, "sub"));
      await expect(service.init(path.join(dir, "sub"))).rejects.toMatchObject({
        code: "git.nested_repository",
      });
    });
  });

  it("checkpoint captures uncommitted work without touching the user's index or worktree", async () => {
    await withTempDir(async (dir) => {
      await repo(dir, { "a.txt": "a\n" });
      write(dir, "a.txt", "user edit\n");
      write(dir, "untracked.txt", "u\n");
      await client.exec(["add", "a.txt"], dir); // user staged something
      const before = await client.exec(["diff", "--cached", "--name-only"], dir);
      const cp = await service.createCheckpoint(dir, "task_1");
      expect(cp.baseRef).toBe("refs/autoappz/checkpoints/task_1/base");
      expect(cp.headBefore).toBe((await service.status(dir)).head);
      // snapshot contains both the edit and the untracked file
      expect((await client.exec(["show", `${cp.baseRef}:a.txt`], dir)).stdout).toBe("user edit\n");
      expect((await client.exec(["show", `${cp.baseRef}:untracked.txt`], dir)).stdout).toBe("u\n");
      // user's index untouched, worktree untouched, HEAD unchanged
      expect((await client.exec(["diff", "--cached", "--name-only"], dir)).stdout).toBe(before.stdout);
      expect(read(dir, "a.txt")).toBe("user edit\n");
      expect((await service.status(dir)).head).toBe(cp.headBefore);
    });
  });

  it("commits only task-touched paths with the trailer; unchanged trees produce no commit", async () => {
    await withTempDir(async (dir) => {
      await repo(dir, { "a.txt": "a\n", "b.txt": "b\n" });
      await service.createCheckpoint(dir, "task_2");
      write(dir, "b.txt", "user private edit\n"); // not part of the task
      write(dir, "a.txt", "agent edit\n");
      const sha = await service.commitTask(dir, "task_2", "Change a", ["a.txt"]);
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      const msg = (await client.exec(["log", "-1", "--format=%B"], dir)).stdout;
      expect(msg).toContain("Change a");
      expect(msg).toContain("AutoAPPZ-Task: task_2");
      expect((await client.exec(["show", "--stat", "--format=", "HEAD"], dir)).stdout).toContain("a.txt");
      expect((await client.exec(["show", "--stat", "--format=", "HEAD"], dir)).stdout).not.toContain("b.txt");
      expect((await service.status(dir)).modified).toEqual(["b.txt"]);
      expect(await service.commitTask(dir, "task_2", "nothing", ["a.txt"])).toBeUndefined();
      const diff = await service.taskDiff(dir, "task_2", sha);
      expect(diff.files).toEqual(["a.txt"]);
      expect(diff.diff).toContain("+agent edit");
    });
  });

  it("undo restores task-touched files to the base, keeping user edits captured before the task", async () => {
    await withTempDir(async (dir) => {
      await repo(dir, { "a.txt": "a\n", "c.txt": "c\n" });
      write(dir, "a.txt", "user edit before task\n");
      write(dir, "b.txt", "user untracked\n");
      await service.createCheckpoint(dir, "task_3");
      write(dir, "a.txt", "agent edit\n");
      write(dir, "new.txt", "agent new\n");
      write(dir, "c.txt", "agent c\n");
      const sha = await service.commitTask(dir, "task_3", "Task", ["a.txt", "new.txt", "c.txt"]);
      write(dir, "c.txt", "user edit after task\n");
      const result = await service.restorePaths(dir, "task_3", ["a.txt", "new.txt", "c.txt"], {
        resultCommit: sha,
      });
      expect(result).toEqual({ restored: ["a.txt"], skipped: ["c.txt"], removed: ["new.txt"] });
      expect(read(dir, "a.txt")).toBe("user edit before task\n");
      expect(read(dir, "b.txt")).toBe("user untracked\n");
      expect(read(dir, "c.txt")).toBe("user edit after task\n");
      expect(existsSync(path.join(dir, "new.txt"))).toBe(false);
      const forced = await service.restorePaths(dir, "task_3", ["c.txt"], { resultCommit: sha, force: true });
      expect(forced.restored).toEqual(["c.txt"]);
      expect(read(dir, "c.txt")).toBe("c\n");
    });
  });

  it("property: undo never loses a user's pre-task edits or untracked files", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(fc.stringMatching(/^[a-z]{1,6}\.txt$/), fc.string({ maxLength: 20 }), {
          minKeys: 1,
          maxKeys: 5,
        }),
        fc.dictionary(fc.stringMatching(/^[a-z]{1,6}\.txt$/), fc.string({ maxLength: 20 }), { maxKeys: 4 }),
        fc.dictionary(fc.stringMatching(/^[a-z]{1,6}\.txt$/), fc.string({ maxLength: 20 }), {
          minKeys: 1,
          maxKeys: 4,
        }),
        async (committed, userEdits, agentEdits) => {
          await withTempDir(async (dir) => {
            await repo(dir, committed);
            for (const [p, c] of Object.entries(userEdits)) write(dir, p, `USER:${c}`);
            const expected = new Map<string, string>();
            for (const p of new Set([...Object.keys(committed), ...Object.keys(userEdits)]))
              expected.set(p, read(dir, p));
            await service.createCheckpoint(dir, "prop");
            for (const [p, c] of Object.entries(agentEdits)) write(dir, p, `AGENT:${c}`);
            const touched = Object.keys(agentEdits);
            const sha = await service.commitTask(dir, "prop", "agent", touched);
            await service.restorePaths(dir, "prop", touched, { resultCommit: sha });
            for (const [p, content] of expected) expect(read(dir, p)).toBe(content);
            for (const p of touched) if (!expected.has(p)) expect(existsSync(path.join(dir, p))).toBe(false);
          });
        },
      ),
      { numRuns: 12 },
    );
  }, 120_000);

  it("refuses checkpoints during a merge and skips oversized files", async () => {
    await withTempDir(async (dir) => {
      await repo(dir, { "a.txt": "a\n" });
      writeFileSync(path.join(dir, ".git", "MERGE_HEAD"), "0000000000000000000000000000000000000000\n");
      await expect(service.createCheckpoint(dir, "task_4")).rejects.toMatchObject({
        code: "git.operation_in_progress",
      });
      const { rmSync } = await import("node:fs");
      rmSync(path.join(dir, ".git", "MERGE_HEAD"));
      write(dir, "big.bin", "x".repeat(21 * 1024 * 1024));
      const cp = await service.createCheckpoint(dir, "task_4");
      expect(cp.skippedLargeFiles).toEqual(["big.bin"]);
      expect(
        (await client.exec(["cat-file", "-e", `${cp.baseRef}:big.bin`], dir, { check: false })).exitCode,
      ).not.toBe(0);
    });
  }, 60_000);

  it("branches from a checkpoint, lists and switches branches, refuses unsafe names", async () => {
    await withTempDir(async (dir) => {
      await repo(dir, { "a.txt": "a\n" });
      await service.createCheckpoint(dir, "task_5");
      await service.branchFromCheckpoint(dir, "task_5", "experiment/one");
      const b = await service.branches(dir);
      expect(b.current).toBe("main");
      expect(b.branches).toEqual(expect.arrayContaining(["main", "experiment/one"]));
      await service.switchBranch(dir, "experiment/one");
      expect((await service.branches(dir)).current).toBe("experiment/one");
      await expect(service.branchFromCheckpoint(dir, "task_5", "--evil")).rejects.toMatchObject({
        code: "git.invalid_branch",
      });
      await expect(service.switchBranch(dir, "nope")).rejects.toMatchObject({ code: "git.switch_failed" });
      expect(await service.commitAll(dir, "nothing")).toBeUndefined();
      write(dir, "z.txt", "z\n");
      expect(await service.commitAll(dir, "user commit")).toMatch(/^[0-9a-f]{40}$/);
    });
  });
});
