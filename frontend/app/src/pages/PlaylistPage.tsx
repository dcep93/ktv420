import { embeddedSpotify } from '../features/local/spotify/overlay';
import CapturePage from './CapturePage';
import LibraryPage from './LibraryPage';
export default function PlaylistPage() {
  return embeddedSpotify ? <CapturePage /> : <LibraryPage />;
}
