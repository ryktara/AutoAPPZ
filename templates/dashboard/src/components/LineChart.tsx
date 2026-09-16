/** Dependency-free SVG line chart; the path is computed so it can be tested without a browser. */
export function linePath(values: readonly number[], width: number, height: number, padding = 8): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const stepX = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = padding + i * stepX;
      const y = height - padding - (v / max) * (height - padding * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function LineChart({ values, title }: { values: readonly number[]; title: string }) {
  const width = 640;
  const height = 200;
  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${String(width)} ${String(height)}`} role="img" aria-label={title}>
        <path d={linePath(values, width, height)} fill="none" stroke="currentColor" strokeWidth={2} />
      </svg>
    </figure>
  );
}
