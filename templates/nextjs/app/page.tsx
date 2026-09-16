import { greeting } from "@/lib/greeting";

export default function HomePage() {
  return (
    <main className="app">
      <h1>{greeting("builder")}</h1>
      <p>
        Edit <code>app/page.tsx</code> to get started. Server components render here; add client components
        with <code>&quot;use client&quot;</code>.
      </p>
    </main>
  );
}
