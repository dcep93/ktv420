export const EXTENSION_NAME = "ktv420";
export const STORAGE_VERSION = 3;

export const SUPPORTED_ROUTE_RE = /^\/(album|playlist)\/[A-Za-z0-9]+(?:\/|$)/;

export const SELECTORS = {
  spotifyLogo: '[data-encore-id="logoSpotify"]',
  tracklistRoot: 'div[data-testid="playlist-tracklist"], div[data-testid="track-list"]',
  trackRow: 'div[data-testid="tracklist-row"]',
  trackAnchor: 'a[href^="/track/"], a[href*="/track/"]',
  artistAnchor: 'a[href^="/artist/"], a[href*="/artist/"]',
  playPauseButton: '[data-testid="control-button-playpause"]',
  skipForwardButton: '[data-testid="control-button-skip-forward"]'
};

export const PAGE_EVENT_SOURCE = "ktv420_page_hooks";
