import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import './index.css';
import AppServices from './app/AppServices';
import AppRoutes from './app/AppRoutes';
import RecoveryBoundary from './app/RecoveryBoundary';
createRoot(document.getElementById('root')!).render(<RecoveryBoundary><AppRoutes /><AppServices /></RecoveryBoundary>);
