export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <div className="h-10 w-56 animate-pulse rounded-sm bg-muted" />
      <div className="h-4 w-72 animate-pulse rounded-sm bg-muted" />
      <div className="h-16 w-full animate-pulse rounded-sm bg-muted" />
      <span className="sr-only">Carregando organizações…</span>
    </div>
  );
}
