import { afterAll, describe, expect, it } from "vitest";
import { app } from "./app.ts";
import { closeDb } from "./db.ts";

const json = (body: unknown, cookie?: string) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
});

afterAll(async () => {
  await closeDb();
});

describe("API without a database", () => {
  it("health responds and validation errors never touch the database", async () => {
    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    const bad = await app.request("/api/auth/register", json({ email: "nope", password: "short" }));
    expect(bad.status).toBe(400);
    const anon = await app.request("/api/notes");
    expect(anon.status).toBe(401);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("API against PostgreSQL (DATABASE_URL)", () => {
  const email = `user-${Date.now().toString(36)}@example.com`;
  let cookie = "";

  it("registers, keeps a session, and runs the notes CRUD end to end", async () => {
    const registered = await app.request(
      "/api/auth/register",
      json({ email, password: "correct horse battery" }),
    );
    expect(registered.status).toBe(201);
    cookie = registered.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).toMatch(/^sid=/);

    const duplicate = await app.request(
      "/api/auth/register",
      json({ email, password: "correct horse battery" }),
    );
    expect(duplicate.status).toBe(409);

    const me = await app.request("/api/auth/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe(email);

    const created = await app.request("/api/notes", json({ body: "first note" }, cookie));
    expect(created.status).toBe(201);
    const note = ((await created.json()) as { note: { id: number } }).note;

    const updated = await app.request(`/api/notes/${String(note.id)}`, {
      ...json({ body: "edited" }, cookie),
      method: "PUT",
    });
    expect(updated.status).toBe(200);

    const list = await app.request("/api/notes", { headers: { cookie } });
    expect(((await list.json()) as { notes: { body: string }[] }).notes.map((n) => n.body)).toEqual([
      "edited",
    ]);

    const wrongPassword = await app.request("/api/auth/login", json({ email, password: "wrong password" }));
    expect(wrongPassword.status).toBe(401);
    const login = await app.request("/api/auth/login", json({ email, password: "correct horse battery" }));
    expect(login.status).toBe(200);

    const removed = await app.request(`/api/notes/${String(note.id)}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(removed.status).toBe(200);
    const empty = await app.request("/api/notes", { headers: { cookie } });
    expect(((await empty.json()) as { notes: unknown[] }).notes).toEqual([]);

    const loggedOut = await app.request("/api/auth/logout", { method: "POST", headers: { cookie } });
    expect(loggedOut.status).toBe(200);
    const after = await app.request("/api/auth/me", { headers: { cookie } });
    expect(after.status).toBe(401);
  });
});
