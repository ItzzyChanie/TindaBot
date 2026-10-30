export default function Loading() {
  return (
    <div
      className="page-content route-loading"
      role="status"
      aria-label="Loading page"
    >
      <span className="sr-only">Loading page…</span>
      <div className="loading-hero" />
      <div className="loading-metrics">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="loading-panels">
        <i />
        <i />
      </div>
    </div>
  );
}
