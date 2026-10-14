import LibraryPage from '../pages/LibraryPage';
export default function AppRoutes() {
  if (window.parent === window) return <main className="iframe-page">
    <img src="./favicon.svg" alt="ktv420" width="56" height="56" />
    <p>Open ktv420 on Spotify to play your locally saved tracks.</p>
    <a href="https://open.spotify.com/">Open Spotify</a>
    <a href="/">Installation guide</a>
  </main>;
  return <LibraryPage />;
}
