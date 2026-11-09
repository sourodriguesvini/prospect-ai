export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <div className="h-10 w-48 animate-pulse rounded-sm bg-muted" />
      <div className="h-4 w-80 animate-pulse rounded-sm bg-muted" />
      <span className="sr-only">Carregando…</span>
    </div>
  );
}
