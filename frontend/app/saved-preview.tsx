// Dev-only view of the real local registry with a fixture for external messaging.
import {createRoot} from 'react-dom/client';
import SavedPage from './src/pages/SavedPage';
import {savedCollections} from './src/extension/collectionRegistry';
import './src/styles/theme.css';
import './src/index.css';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
Object.defineProperty(window,'chrome',{value:{runtime:{sendMessage(_id: string,_message:unknown,reply:(v:unknown)=>void){void savedCollections().then(collections=>reply({ok:true,collections}));}}},configurable:true});
createRoot(document.getElementById('root')!).render(<SavedPage/>);
