import { retainPlayerAssets } from './player-assets.mjs';
await retainPlayerAssets(new URL('../site/player/', import.meta.url).pathname, 'https://ktv420.web.app/player/');
console.log('Retained immutable player assets needed by existing sessions.');
