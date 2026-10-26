// Dev-only catalog UI fixture. No audio, extension, or persistent storage access.
import { createRoot } from 'react-dom/client';
import SavedPage from './src/pages/SavedPage';
import './src/styles/theme.css';
import './src/index.css';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
const collections = [
  {path:'album/1111111111111111111111',title:'Captured album',artwork:'',savedAt:1,captured:7,ready:5,total:12},
  {path:'playlist/2222222222222222222222',title:'Just started',artwork:'',savedAt:2,captured:0,ready:0,total:8},
];
Object.defineProperty(window, 'chrome', { configurable:true, value:{runtime:{sendMessage(_id:string,message:{type:string;path?:string;confirmed?:boolean},reply:(value:unknown)=>void) {
  if (message.type === 'ktv420:delete-collection-audio') {
    const item = collections.find(item => item.path === message.path);
    if (!item || message.confirmed !== true) { reply({ok:false,error:'Invalid fixture deletion'}); return; }
    item.captured = 0; item.ready = 0;
  }
  reply({ok:true,collections:structuredClone(collections)});
}}} });
createRoot(document.getElementById('root')!).render(<SavedPage />);
