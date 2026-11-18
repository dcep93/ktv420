import { Component, type ReactNode } from 'react';

export default class RecoveryBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error('[ktv420] View failed', error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main style={{ padding: '10vh 8vw', color: '#fff', background: '#100c09', minHeight: '100vh' }}>
      <h1>Let’s reconnect the view</h1>
      <p>Your saved songs are still available. An active Spotify recording can continue while this view reloads.</p>
      <button onClick={() => location.reload()}>Reconnect ktv420</button>
    </main>;
  }
}
