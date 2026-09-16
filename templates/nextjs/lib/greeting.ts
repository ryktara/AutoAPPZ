/** Greeting shown on the home page; kept in a plain module so it is unit-testable without React. */
export function greeting(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? `Hello, ${trimmed}!` : "Hello!";
}
