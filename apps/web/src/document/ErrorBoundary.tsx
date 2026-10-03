import { Component, type ReactNode } from 'react';

/** Shows what went wrong instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="docpage__center" role="alert">
        <h1>L’éditeur a rencontré une erreur</h1>
        <p>{error.message}</p>
        <pre className="docpage__stack">{error.stack}</pre>
        <button type="button" onClick={() => location.reload()}>Recharger</button>
      </div>
    );
  }
}
