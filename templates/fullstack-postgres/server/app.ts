import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, desc, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { getDb, ping } from "./db.ts";
import { notes, sessions, users } from "./schema.ts";

const SESSION_COOKIE = "sid";
const SESSION_DAYS = 7;

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
});
const NoteInput = z.object({ body: z.string().trim().min(1).max(10_000) });

type Env = { Variables: { userId: number } };

export const app = new Hono<Env>();

app.get("/api/health", async (c) =>
  c.json({ ok: true, database: (await ping()) ? "connected" : "unavailable" }),
);

app.post("/api/auth/register", async (c) => {
  const parsed = Credentials.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success)
    return c.json({ error: "Enter a valid email and a password of at least 8 characters." }, 400);
  const db = getDb();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email));
  if (existing.length > 0) return c.json({ error: "An account with this email already exists." }, 409);
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const [user] = await db
    .insert(users)
    .values({ email: parsed.data.email, passwordHash })
    .returning({ id: users.id, email: users.email });
  if (!user) return c.json({ error: "Could not create the account." }, 500);
  await startSession(c, user.id);
  return c.json({ user }, 201);
});

app.post("/api/auth/login", async (c) => {
  const parsed = Credentials.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Enter your email and password." }, 400);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email));
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return c.json({ error: "Email or password is incorrect." }, 401);
  }
  await startSession(c, user.id);
  return c.json({ user: { id: user.id, email: user.email } });
});

app.post("/api/auth/logout", async (c) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) await getDb().delete(sessions).where(eq(sessions.id, sid));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/auth/me", async (c) => {
  const userId = await currentUserId(c.req.raw.headers.get("cookie"));
  if (userId === undefined) return c.json({ user: null }, 401);
  const [user] = await getDb()
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  return user ? c.json({ user }) : c.json({ user: null }, 401);
});

// Everything under /api/notes requires a session.
app.use("/api/notes/*", async (c, next) => {
  const userId = await currentUserId(c.req.raw.headers.get("cookie"));
  if (userId === undefined) return c.json({ error: "Sign in first." }, 401);
  c.set("userId", userId);
  await next();
});
app.use("/api/notes", async (c, next) => {
  const userId = await currentUserId(c.req.raw.headers.get("cookie"));
  if (userId === undefined) return c.json({ error: "Sign in first." }, 401);
  c.set("userId", userId);
  await next();
});

app.get("/api/notes", async (c) => {
  const rows = await getDb()
    .select()
    .from(notes)
    .where(eq(notes.userId, c.get("userId")))
    .orderBy(desc(notes.createdAt));
  return c.json({ notes: rows });
});

app.post("/api/notes", async (c) => {
  const parsed = NoteInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "A note needs some text." }, 400);
  const [note] = await getDb()
    .insert(notes)
    .values({ userId: c.get("userId"), body: parsed.data.body })
    .returning();
  return c.json({ note }, 201);
});

app.put("/api/notes/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = NoteInput.safeParse(await c.req.json().catch(() => ({})));
  if (!Number.isInteger(id) || !parsed.success) return c.json({ error: "Invalid note." }, 400);
  const [note] = await getDb()
    .update(notes)
    .set({ body: parsed.data.body, updatedAt: new Date() })
    .where(and(eq(notes.id, id), eq(notes.userId, c.get("userId"))))
    .returning();
  return note ? c.json({ note }) : c.json({ error: "Note not found." }, 404);
});

app.delete("/api/notes/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Invalid note." }, 400);
  const deleted = await getDb()
    .delete(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, c.get("userId"))))
    .returning({ id: notes.id });
  return deleted.length > 0 ? c.json({ ok: true }) : c.json({ error: "Note not found." }, 404);
});

async function startSession(c: Context<Env>, userId: number): Promise<void> {
  const id = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await getDb().insert(sessions).values({ id, userId, expiresAt });
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
    secure: process.env.NODE_ENV === "production",
  });
}

async function currentUserId(cookieHeader: string | null): Promise<number | undefined> {
  const sid = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!sid) return undefined;
  const [session] = await getDb().select().from(sessions).where(eq(sessions.id, sid));
  if (!session || session.expiresAt.getTime() < Date.now()) return undefined;
  return session.userId;
}
