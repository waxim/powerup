/** The practice page is its own chunk (it bundles the engine and the bots). */
export const loadTry = () => import("../pages/Try");

let started = false;

/** Start downloading the practice page as soon as someone looks likely to open it. */
export function prefetchTry(): void {
  if (started) return;
  started = true;
  loadTry().catch(() => {
    // Offline or a stale deploy: it'll be fetched (or fail visibly) when actually opened.
    started = false;
  });
}
