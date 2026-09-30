import type { ReactNode } from "react";
import { prefetchTry } from "../lib/preload";
import { linkHandler } from "../lib/router";

/** A link to the practice page that fetches it ahead of the tap. */
export function TryLink({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <a
      href="/try"
      className={className}
      onClick={linkHandler("/try")}
      onPointerEnter={prefetchTry}
      onFocus={prefetchTry}
      onTouchStart={prefetchTry}
    >
      {children}
    </a>
  );
}
