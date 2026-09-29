import { Bot } from "lucide-react";
import { lazy, Suspense } from "react";
import { LoadErrorBoundary } from "./components/LoadError";
import { TryLink } from "./components/TryLink";
import { loadTry } from "./lib/preload";
import { linkHandler, useRoute } from "./lib/router";
import { Home, Logo } from "./pages/Home";
import { Rules } from "./pages/Rules";
import { TablePage } from "./pages/TablePage";

// The practice mode bundles the game engine and bots, so it's only downloaded when someone opens it.
const Try = lazy(loadTry);

function Loading() {
  return (
    <div className="page center-page">
      <Logo />
      <p className="loading">Loading…</p>
    </div>
  );
}

export function App() {
  const route = useRoute();
  switch (route.name) {
    case "home":
      return <Home />;
    case "rules":
      return <Rules />;
    case "try":
      return (
        <LoadErrorBoundary what="practice mode">
          <Suspense fallback={<Loading />}>
            <Try />
          </Suspense>
        </LoadErrorBoundary>
      );
    case "table":
      return <TablePage key={route.id} id={route.id} />;
    default:
      return (
        <div className="page center-page">
          <Logo />
          <h1>Nothing here</h1>
          <a className="btn btn-primary" href="/" onClick={linkHandler("/")}>
            Go to PowerUp
          </a>
          <TryLink className="btn btn-ghost">
            <Bot size={18} aria-hidden /> Try a practice game
          </TryLink>
        </div>
      );
  }
}
