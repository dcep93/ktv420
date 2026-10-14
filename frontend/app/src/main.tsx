import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import './index.css';
import AppRoutes from './app/AppRoutes';
createRoot(document.getElementById('root')!).render(<AppRoutes />);
