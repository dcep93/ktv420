import LibraryPage from '../pages/LibraryPage';
export default function AppRoutes() {
  if (window.parent === window) return <main className="iframe-page">
    <section className="direct-player-guide">
      <h1 className="app-title">ktv420</h1>
      <p>Open ktv420 on Spotify to play your saved tracks.</p>
      <nav aria-label="Get started">
        <a className="primary-button" href="https://open.spotify.com/">Open Spotify</a>
        <a href="/">Install</a>
      </nav>
    </section>
  </main>;
  return <LibraryPage />;
}
