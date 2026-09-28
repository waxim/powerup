import { useEffect, useState } from "react";

export type Route = { name: "home" } | { name: "rules" } | { name: "table"; id: string } | { name: "notfound" };

function parse(pathname: string): Route {
  if (pathname === "/" || pathname === "") return { name: "home" };
  if (pathname === "/rules" || pathname === "/rules/") return { name: "rules" };
  const m = pathname.match(/^\/t\/([a-z0-9]{6,16})\/?$/);
  if (m) return { name: "table", id: m[1] };
  return { name: "notfound" };
}

export function navigate(path: string): void {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parse(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return route;
}

/** Plain <a> that navigates without a page load. */
export function linkHandler(path: string) {
  return (e: { preventDefault(): void; metaKey?: boolean; ctrlKey?: boolean }) => {
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    navigate(path);
  };
}
