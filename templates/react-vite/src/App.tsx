import { useState } from "react";

export function App() {
  const [count, setCount] = useState(0);
  return (
    <main className="app">
      <h1>Your app is running</h1>
      <p>
        Edit <code>src/App.tsx</code> to get started.
      </p>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        Clicked {count} {count === 1 ? "time" : "times"}
      </button>
    </main>
  );
}
