import { Home, Logo } from "./pages/Home";
import { Rules } from "./pages/Rules";
import { TablePage } from "./pages/TablePage";
import { linkHandler, useRoute } from "./lib/router";

export function App() {
  const route = useRoute();
  switch (route.name) {
    case "home":
      return <Home />;
    case "rules":
      return <Rules />;
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
