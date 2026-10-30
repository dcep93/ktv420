import TransferPage from '../pages/TransferPage';
import PlaylistPage from '../pages/PlaylistPage';
import SavedPage from '../pages/SavedPage';
import ReplayPage from '../pages/ReplayPage';
export default function AppRoutes() {
  const path=location.pathname.replace(/\/$/,'');
  if(path==='/transfer')return <TransferPage/>;
  if(path==='/playlist')return <PlaylistPage/>;
  if(path==='/replay')return <ReplayPage/>;
  return <SavedPage/>;
}
