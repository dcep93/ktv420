export const STORE_ID = 'kmkbecinmhkfihahalgclomhcicmoiia';
export const STORE_URL = `https://chromewebstore.google.com/detail/ktv420/${STORE_ID}`;
export function extensionId(): string {
  const requested = new URLSearchParams(location.search).get('extension');
  try {
    if (requested && /^[a-p]{32}$/.test(requested)) localStorage.setItem('ktv420:spotify-extension', requested);
    const saved = localStorage.getItem('ktv420:spotify-extension');
    if (saved && /^[a-p]{32}$/.test(saved)) return saved;
  } catch { /* Optional capture connection preference; library playback is independent. */ }
  return requested && /^[a-p]{32}$/.test(requested) ? requested : STORE_ID;
}
export function catalogUrl(): string { return '/catalog'; }
