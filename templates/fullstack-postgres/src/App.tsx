import { useEffect, useState, type FormEvent } from "react";

interface User {
  id: number;
  email: string;
}
interface Note {
  id: number;
  body: string;
  createdAt: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${String(res.status)})`);
  return data;
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    api<{ user: User | null }>("/api/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    api<{ notes: Note[] }>("/api/notes")
      .then((r) => setNotes(r.notes))
      .catch((e: Error) => setError(e.message));
  }, [user]);

  const submitAuth = async (e: FormEvent<HTMLFormElement>, mode: "login" | "register") => {
    e.preventDefault();
    setError(undefined);
    const form = new FormData(e.currentTarget);
    try {
      const r = await api<{ user: User }>(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      setUser(r.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const addNote = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get("body") ?? "");
    try {
      const r = await api<{ note: Note }>("/api/notes", { method: "POST", body: JSON.stringify({ body }) });
      setNotes((n) => [r.note, ...n]);
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeNote = async (id: number) => {
    await api(`/api/notes/${String(id)}`, { method: "DELETE" }).catch((e: Error) => setError(e.message));
    setNotes((n) => n.filter((x) => x.id !== id));
  };

  if (user === undefined) return <main className="app">Loading…</main>;

  if (!user) {
    return (
      <main className="app">
        <h1>Notes</h1>
        {error ? <p className="error">{error}</p> : null}
        <form
          onSubmit={(e) => {
            const mode =
              (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "register"
                ? "register"
                : "login";
            void submitAuth(e, mode);
          }}
          className="card"
        >
          <h2>Sign in</h2>
          <label>
            Email <input name="email" type="email" required />
          </label>
          <label>
            Password <input name="password" type="password" minLength={8} required />
          </label>
          <div className="row">
            <button type="submit" value="login">
              Sign in
            </button>
            <button type="submit" value="register">
              Create account
            </button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="row">
        <h1>Notes</h1>
        <span>{user.email}</span>
        <button
          type="button"
          onClick={() => void api("/api/auth/logout", { method: "POST" }).then(() => setUser(null))}
        >
          Sign out
        </button>
      </header>
      {error ? <p className="error">{error}</p> : null}
      <form onSubmit={(e) => void addNote(e)} className="row">
        <input name="body" placeholder="Write a note…" required />
        <button type="submit">Add</button>
      </form>
      <ul className="notes">
        {notes.map((n) => (
          <li key={n.id} className="card row">
            <span>{n.body}</span>
            <button type="button" onClick={() => void removeNote(n.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
