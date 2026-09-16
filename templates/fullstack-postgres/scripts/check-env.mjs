if (!process.env.DATABASE_URL) {
  console.error(
    [
      "DATABASE_URL is not set.",
      "Attach a PostgreSQL database in the Project tab (AutoAPPZ injects DATABASE_URL), or export it yourself:",
      '  DATABASE_URL="postgresql://postgres:postgres@localhost:5432/app" pnpm dev',
    ].join("\n"),
  );
  process.exit(1);
}
