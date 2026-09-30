import { Component, type ReactNode } from "react";

/**
 * Catches a lazily loaded page that fails to download (offline, or an old page after a new deploy) so the rest
 * of the app keeps working. Reloading fetches the current version.
 */
export class LoadErrorBoundary extends Component<{ what: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page center-page">
        <h1>Couldn't load {this.props.what}</h1>
        <p>Check your connection, then try again.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
        <a className="btn btn-ghost" href="/">
          Home
        </a>
      </div>
    );
  }
}
