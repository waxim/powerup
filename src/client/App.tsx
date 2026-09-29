import { lazy, Suspense } from "react";
import { linkHandler, useRoute } from "./lib/router";
import { Home, Logo } from "./pages/Home";
import { Rules } from "./pages/Rules";
import { TablePage } from "./pages/TablePage";

// The practice mode bundles the game engine and bots, so it's only downloaded when someone opens it.
const Try = lazy(() => import("./pages/Try"));

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
        <Suspense fallback={<Loading />}>
          <Try />
        </Suspense>
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
        </div>
      );
  }
}
