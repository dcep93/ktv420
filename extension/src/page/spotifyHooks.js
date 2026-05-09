(() => {
  const INSTALL_MARKER = "__ktv420_page_hooks_installed__";
  const SOURCE = "ktv420_page_hooks";
  const WORKLET_URL = document.currentScript?.dataset?.ktv420WorkletUrl || "";
  const PLAYLIST_CONTENTS_OPERATION = "fetchPlaylistContents";

  if (window[INSTALL_MARKER]) {
    return;
  }
  window[INSTALL_MARKER] = true;

  let lastPlaylistContentsRequest = null;

  const post = (event, payload, transfer = []) => {
    window.postMessage({ source: SOURCE, event, payload }, window.location.origin, transfer);
  };

  const isSpotifyStateUrl = (url) => {
    const text = String(url || "").toLowerCase();
    if (!text.includes("spotify")) {
      return false;
    }

    return [
      "connect-state",
      "/connect/",
      "player_state",
      "player-state",
      "/player",
      "playback",
      "currently-playing"
    ].some((needle) => text.includes(needle));
  };

  const isPlaylistPathfinderUrl = (url) =>
    /api-partner\.spotify\.com\/pathfinder\/v\d\/query/i.test(String(url || ""));

  const inspectJsonResponse = async ({ source, url, status, response, method = "GET", requestHeaders = null, requestBody = null }) => {
    if (!(status >= 200 && status < 300) || (!isSpotifyStateUrl(url) && !isPlaylistPathfinderUrl(url))) {
      return;
    }

    try {
      const text = await response.text();
      if (!text || !/^[\s[{]/.test(text)) {
        return;
      }

      const json = JSON.parse(text);
      if (isSpotifyStateUrl(url)) {
        const candidates = extractTrackCandidates(json).slice(0, 80);
        if (candidates.length > 0) {
          post("playback-state", {
            source,
            url,
            status,
            candidates,
            capturedAt: Date.now()
          });
        }
      }

      const parsedRequestBody = parseJson(requestBody);
      if (isPlaylistContentsRequest(url, parsedRequestBody)) {
        lastPlaylistContentsRequest = {
          url,
          method,
          headers: serializeHeaders(requestHeaders),
          body: parsedRequestBody
        };
      }
    } catch {
      // Spotify returns several non-JSON state-adjacent responses. They are ignored.
    }
  };

  const nativeFetch = window.fetch;
  window.fetch = async function ktv420Fetch(input, init) {
    const response = await nativeFetch.apply(this, arguments);
    const url = response.url || (typeof input === "string" ? input : input?.url) || "";
    inspectJsonResponse({
      source: "fetch",
      url,
      status: response.status,
      response: response.clone(),
      method: init?.method || input?.method || "GET",
      requestHeaders: init?.headers || input?.headers || null,
      requestBody: init?.body || null
    });
    return response;
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function ktv420XhrOpen(method, url) {
    this.__ktv420Method = method;
    this.__ktv420Url = url;
    return nativeOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function ktv420XhrSend() {
    this.__ktv420Body = arguments[0];
    this.addEventListener("loadend", () => {
      const url = this.responseURL || this.__ktv420Url || "";
      if (!(this.status >= 200 && this.status < 300) || (!isSpotifyStateUrl(url) && !isPlaylistPathfinderUrl(url))) {
        return;
      }

      try {
        let body = null;
        if (this.responseType === "" || this.responseType === "text") {
          body = this.responseText;
        } else if (this.responseType === "json") {
          body = JSON.stringify(this.response);
        }

        if (!body) {
          return;
        }

        inspectJsonResponse({
          source: "xhr",
          url,
          status: this.status,
          response: new Response(body),
          method: this.__ktv420Method || "GET",
          requestBody: this.__ktv420Body || null
        });
      } catch {
        // Some XHR response types cannot be inspected safely.
      }
    });

    return nativeSend.apply(this, arguments);
  };

  const mediaTracker = installMediaElementTracking();
  const captureController = createCaptureController(mediaTracker);
  installCommandBridge(captureController);
  installMediaSessionProbe();

  function installCommandBridge(controller) {
    window.addEventListener("message", async (event) => {
      if (event.source !== window || event.data?.source !== "ktv420_content") {
        return;
      }

      const { command, commandId, payload } = event.data;
      try {
        let result;
        if (command === "media-targets") {
          result = controller.describeTargets();
        } else if (command === "capture-begin") {
          result = await controller.begin(payload || {});
        } else if (command === "capture-finish-and-begin") {
          result = await controller.finishAndBegin(payload || {});
        } else if (command === "capture-mark-start") {
          result = controller.markAcceptedStart();
        } else if (command === "capture-state") {
          result = controller.state();
        } else if (command === "capture-finish") {
          result = controller.finish();
        } else if (command === "capture-abort") {
          result = controller.abort();
        } else if (command === "playlist-tracks") {
          result = await fetchPlaylistTracks(payload || {});
        } else {
          throw new Error(`Unknown ktv420 page command: ${command}`);
        }

        post("command-result", { commandId, ok: true, result }, collectTransferables(result));
      } catch (error) {
        post("command-result", {
          commandId,
          ok: false,
          error: error?.message || String(error)
        });
      }
    });
  }

  function installMediaElementTracking() {
    const elements = new Set();

    const remember = (element) => {
      if (!isMediaElement(element)) {
        return element;
      }

      elements.add(element);
      return element;
    };

    document.querySelectorAll("audio, video").forEach(remember);

    const nativeCreateElement = Document.prototype.createElement;
    Document.prototype.createElement = function ktv420CreateElement(tagName, options) {
      return remember(nativeCreateElement.apply(this, arguments));
    };

    const nativeCreateElementNS = Document.prototype.createElementNS;
    Document.prototype.createElementNS = function ktv420CreateElementNS(namespace, qualifiedName, options) {
      return remember(nativeCreateElementNS.apply(this, arguments));
    };

    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function ktv420Play() {
      remember(this);
      return nativePlay.apply(this, arguments);
    };

    const NativeAudio = window.Audio;
    if (typeof NativeAudio === "function") {
      window.Audio = function ktv420Audio(...args) {
        return remember(new NativeAudio(...args));
      };
      window.Audio.prototype = NativeAudio.prototype;
      Object.setPrototypeOf(window.Audio, NativeAudio);
    }

    return {
      remember,
      all() {
        document.querySelectorAll("audio, video").forEach(remember);
        return Array.from(elements).filter((element) => element && !element.__ktv420Forgotten);
      }
    };
  }

  function createCaptureController(mediaTracker) {
    let currentCapture = null;

    return {
      describeTargets() {
        return discoverUsableTargets(mediaTracker).map(describeMediaElement);
      },
      async begin({ timeoutMs = 1000 } = {}) {
        const element = await waitForSingleCaptureTarget(mediaTracker, timeoutMs);
        currentCapture?.abort();
        currentCapture = await PagePcmCapture.create(element);
        await currentCapture.begin();
        return {
          target: describeMediaElement(element),
          sampleRate: currentCapture.sampleRate,
          channelCount: currentCapture.channelCount
        };
      },
      async finishAndBegin({ timeoutMs = 1000 } = {}) {
        assertCapture(currentCapture);
        const finished = currentCapture.finish();
        currentCapture = null;

        const element = await waitForSingleCaptureTarget(mediaTracker, timeoutMs);
        currentCapture = await PagePcmCapture.create(element);
        await currentCapture.begin();
        return {
          finished,
          next: {
            target: describeMediaElement(element),
            sampleRate: currentCapture.sampleRate,
            channelCount: currentCapture.channelCount
          }
        };
      },
      markAcceptedStart() {
        assertCapture(currentCapture);
        currentCapture.markAcceptedStart();
        return this.state();
      },
      state() {
        assertCapture(currentCapture);
        return describeMediaElement(currentCapture.element);
      },
      finish() {
        assertCapture(currentCapture);
        const result = currentCapture.finish();
        currentCapture = null;
        return result;
      },
      abort() {
        currentCapture?.abort();
        currentCapture = null;
        return { ok: true };
      }
    };
  }

  class PagePcmCapture {
    static async create(element) {
      const graph = await getOrCreateAudioGraph(element);
      return new PagePcmCapture(element, graph);
    }

    constructor(element, graph) {
      this.element = element;
      this.graph = graph;
      this.context = this.graph.context;
      this.chunks = [];
      this.byteLength = 0;
      this.capturing = false;
      this.sampleRate = this.context.sampleRate;
      this.channelCount = 2;
      this.startMediaTime = 0;
      this.graph.consumers.add(this);
    }

    async begin() {
      if (this.context.state === "suspended") {
        await this.context.resume();
      }

      this.chunks = [];
      this.byteLength = 0;
      this.channelCount = 2;
      this.startMediaTime = safeMediaTime(this.element);
      this.capturing = true;
    }

    markAcceptedStart() {
      this.chunks = [];
      this.byteLength = 0;
      this.startMediaTime = safeMediaTime(this.element);
    }

    abort() {
      this.capturing = false;
      this.chunks = [];
      this.byteLength = 0;
      this.graph.consumers.delete(this);
    }

    finish() {
      this.capturing = false;
      this.graph.consumers.delete(this);
      const bytes = new Uint8Array(this.byteLength);
      let offset = 0;

      for (const chunk of this.chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }

      return {
        bytesBuffer: bytes.buffer,
        byteLength: bytes.byteLength,
        sampleRate: this.sampleRate,
        channelCount: this.channelCount,
        startMediaTime: this.startMediaTime
      };
    }

    handleAudioChunk(message) {
      if (!this.capturing) {
        return;
      }

      const bytes = new Uint8Array(message.bytesBuffer || new ArrayBuffer(0));
      this.channelCount = Math.min(2, Math.max(1, Number(message.channelCount) || this.channelCount || 1));
      this.chunks.push(bytes);
      this.byteLength += bytes.byteLength;
    }
  }

  const audioGraphs = new WeakMap();

  async function getOrCreateAudioGraph(element) {
    const existing = audioGraphs.get(element);
    if (existing && existing.context.state !== "closed") {
      return existing;
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextCtor();
    await ensurePcmWorkletModule(context);
    const source = context.createMediaElementSource(element);
    const worklet = new AudioWorkletNode(context, "ktv420-pcm-capture", {
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
      numberOfInputs: 1,
      numberOfOutputs: 0
    });
    const graph = {
      context,
      source,
      worklet,
      consumers: new Set()
    };

    worklet.port.onmessage = (event) => {
      for (const consumer of graph.consumers) {
        consumer.handleAudioChunk(event.data || {});
      }
    };

    source.connect(worklet);
    source.connect(context.destination);
    audioGraphs.set(element, graph);
    return graph;
  }

  const pcmWorkletModulesByContext = new WeakMap();

  async function ensurePcmWorkletModule(context) {
    const existing = pcmWorkletModulesByContext.get(context);
    if (existing) {
      return existing;
    }

    const modulePromise = (async () => {
      if (!context.audioWorklet?.addModule || typeof AudioWorkletNode !== "function") {
        throw new Error("AudioWorkletNode is not available in this browser context.");
      }

      if (WORKLET_URL) {
        await context.audioWorklet.addModule(WORKLET_URL);
        return;
      }

      throw new Error("ktv420 PCM worklet URL was not provided.");
    })();

    pcmWorkletModulesByContext.set(context, modulePromise);
    return modulePromise;
  }

  async function waitForSingleCaptureTarget(mediaTracker, timeoutMs) {
    const deadline = performance.now() + timeoutMs;
    let lastCount = 0;
    let lastSeen = [];

    while (performance.now() <= deadline) {
      const targets = discoverUsableTargets(mediaTracker);
      lastSeen = mediaTracker.all().map(describeMediaElement);
      lastCount = targets.length;

      if (targets.length === 1) {
        return targets[0];
      }

      if (targets.length > 1) {
        throw new Error(`Expected one Spotify media element, found ${targets.length}.`);
      }

      await delay(50);
    }

    throw new Error(
      `No usable Spotify media element found after ${timeoutMs}ms. Last page-world target count: ${lastCount}. Seen: ${JSON.stringify(lastSeen)}`
    );
  }

  function discoverUsableTargets(mediaTracker) {
    return mediaTracker.all().filter(isUsableCaptureTarget);
  }

  function isUsableCaptureTarget(element) {
    return isMediaElement(element) &&
      Boolean(getMediaSource(element)) &&
      Number.isFinite(element.duration) &&
      element.duration > 0 &&
      element.readyState >= 1 &&
      element.muted === false &&
      element.volume > 0 &&
      element.playbackRate > 0;
  }

  function describeMediaElement(element) {
    return {
      source: getMediaSource(element),
      currentTime: safeMediaTime(element),
      duration: Number.isFinite(element.duration) ? element.duration : null,
      paused: Boolean(element.paused),
      ended: Boolean(element.ended),
      readyState: element.readyState,
      muted: Boolean(element.muted),
      volume: element.volume,
      playbackRate: element.playbackRate,
      tagName: element.tagName
    };
  }

  function assertCapture(capture) {
    if (!capture) {
      throw new Error("No active ktv420 page capture.");
    }
  }

  function collectTransferables(value) {
    const transferables = [];
    const transferred = new Set();
    const seen = new WeakSet();

    const visit = (item) => {
      if (!item || typeof item !== "object") {
        return;
      }

      if (item instanceof ArrayBuffer) {
        if (item.byteLength > 0 && !transferred.has(item)) {
          transferred.add(item);
          transferables.push(item);
        }
        return;
      }

      if (seen.has(item)) {
        return;
      }
      seen.add(item);

      for (const child of Object.values(item)) {
        visit(child);
      }
    };

    visit(value);
    return transferables;
  }

  function isMediaElement(element) {
    return element instanceof HTMLMediaElement;
  }

  function getMediaSource(element) {
    return element.currentSrc || element.src || "";
  }

  function safeMediaTime(element) {
    return Number.isFinite(element?.currentTime) ? Math.max(0, element.currentTime) : 0;
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function installMediaSessionProbe() {
    const emit = () => {
      const metadata = navigator.mediaSession?.metadata;
      if (!metadata) {
        return;
      }

      post("media-session", {
        title: metadata.title || "",
        artist: metadata.artist || "",
        album: metadata.album || "",
        artwork: Array.isArray(metadata.artwork) ? metadata.artwork : [],
        capturedAt: Date.now()
      });
    };

    let last = "";
    window.setInterval(() => {
      const metadata = navigator.mediaSession?.metadata;
      const key = metadata ? `${metadata.title || ""}\u0000${metadata.artist || ""}\u0000${metadata.album || ""}` : "";
      if (key !== last) {
        last = key;
        emit();
      }
    }, 250);

    emit();
  }

  async function fetchPlaylistTracks({ playlistUri = "", maxPages = 10 } = {}) {
    if (!lastPlaylistContentsRequest) {
      return {
        ok: false,
        reason: "No Spotify playlist contents request has been observed yet.",
        tracks: []
      };
    }

    const request = lastPlaylistContentsRequest;
    const variables = request.body?.variables || {};
    const uri = playlistUri || variables.uri || "";
    if (!uri) {
      return {
        ok: false,
        reason: "No playlist URI is available.",
        tracks: []
      };
    }

    const limit = Math.min(100, Math.max(1, Number(variables.limit) || 50));
    const tracks = [];
    let offset = 0;
    let expectedTotal = Number.NaN;

    for (let page = 0; page < maxPages; page += 1) {
      const body = JSON.stringify({
        ...request.body,
        variables: {
          ...variables,
          uri,
          offset,
          limit
        }
      });

      const response = await nativeFetch(request.url, {
        method: request.method || "POST",
        headers: request.headers,
        body
      });

      if (!(response.status >= 200 && response.status < 300)) {
        return {
          ok: false,
          reason: `Spotify playlist contents request failed with ${response.status}.`,
          tracks: dedupePlaylistTracks(tracks)
        };
      }

      const json = await response.json();
      const pageTracks = extractPlaylistTracks(json);
      const total = extractPlaylistTotal(json);
      if (Number.isFinite(total)) {
        expectedTotal = total;
      }

      if (pageTracks.length === 0) {
        break;
      }

      tracks.push(...pageTracks);
      offset += pageTracks.length;

      if (Number.isFinite(expectedTotal) && offset >= expectedTotal) {
        break;
      }
    }

    return {
      ok: tracks.length > 0,
      playlistUri: uri,
      total: Number.isFinite(expectedTotal) ? expectedTotal : null,
      tracks: dedupePlaylistTracks(tracks)
    };
  }

  function isPlaylistContentsRequest(url, body) {
    return isPlaylistPathfinderUrl(url) &&
      body?.operationName === PLAYLIST_CONTENTS_OPERATION &&
      typeof body?.variables?.uri === "string";
  }

  function parseJson(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function serializeHeaders(headers) {
    const serialized = {};

    try {
      new Headers(headers || {}).forEach((value, key) => {
        serialized[key] = value;
      });
    } catch {
      return serialized;
    }

    return serialized;
  }

  function extractPlaylistTracks(json) {
    const items = json?.data?.playlistV2?.content?.items;
    if (!Array.isArray(items)) {
      return [];
    }

    return items
      .map((item, index) => playlistItemToTrack(item, index))
      .filter(Boolean);
  }

  function extractPlaylistTotal(json) {
    const content = json?.data?.playlistV2?.content;
    const candidates = [
      content?.totalCount,
      content?.total,
      content?.pagingInfo?.totalCount,
      content?.pagingInfo?.total
    ];

    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value >= 0) {
        return value;
      }
    }

    return Number.NaN;
  }

  function playlistItemToTrack(item, index) {
    const data = item?.itemV2?.data || item?.item?.data || item?.track || item;
    const trackId = extractTrackId(firstString(data?.id, data?.uri, data?.sharingInfo?.shareUrl));
    if (!trackId) {
      return null;
    }

    const artists = extractPlaylistArtists(data);
    const albumImages = extractPlaylistAlbumImages(data);

    return {
      rowIndex: index,
      trackId,
      trackName: firstString(data?.name, data?.title),
      trackArtist: artists.join(", "),
      trackArtworkSrc: albumImages[0]?.url || "",
      uri: firstString(data?.uri) || `spotify:track:${trackId}`,
      albumName: firstString(data?.albumOfTrack?.name, data?.album?.name),
      albumImages
    };
  }

  function extractPlaylistArtists(data) {
    const artistItems = Array.isArray(data?.artists?.items)
      ? data.artists.items
      : Array.isArray(data?.artists)
        ? data.artists
        : [];

    return artistItems
      .map((artist) => firstString(artist?.profile?.name, artist?.name, artist?.title))
      .filter(Boolean);
  }

  function extractPlaylistAlbumImages(data) {
    const sources =
      data?.albumOfTrack?.coverArt?.sources ||
      data?.album?.coverArt?.sources ||
      data?.album?.images ||
      [];

    if (!Array.isArray(sources)) {
      return [];
    }

    return sources
      .map((source) => ({
        url: firstString(source?.url, source?.uri),
        width: Number.isFinite(source?.width) ? source.width : null,
        height: Number.isFinite(source?.height) ? source.height : null
      }))
      .filter((source) => source.url);
  }

  function dedupePlaylistTracks(tracks) {
    const byId = new Map();

    for (const track of tracks) {
      if (!byId.has(track.trackId)) {
        byId.set(track.trackId, {
          ...track,
          rowIndex: byId.size
        });
      }
    }

    return Array.from(byId.values());
  }

  function extractTrackCandidates(json) {
    const candidates = [];
    const seenObjects = new WeakSet();

    const visit = (value, path, depth) => {
      if (!value || depth > 12) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
        return;
      }

      if (typeof value !== "object") {
        return;
      }

      if (seenObjects.has(value)) {
        return;
      }
      seenObjects.add(value);

      const candidate = objectToCandidate(value, path);
      if (candidate) {
        candidates.push(candidate);
      }

      for (const [key, child] of Object.entries(value)) {
        visit(child, path ? `${path}.${key}` : key, depth + 1);
      }
    };

    visit(json, "$", 0);
    return dedupeCandidates(candidates);
  }

  function objectToCandidate(object, path) {
    const keys = Object.keys(object);
    const uri = firstString(object.uri, object.track_uri, object.trackUri, object.context_uri);
    const href = firstString(object.href, object.url, object.link);
    const type = firstString(object.type, object.item_type, object.media_type);
    const idValue = firstString(object.id, object.track_id, object.trackId, object.gid);
    const trackId =
      extractTrackId(uri) ||
      extractTrackId(href) ||
      extractTrackId(type === "track" ? idValue : null) ||
      extractTrackId(path.toLowerCase().includes("track") ? idValue : null);

    if (!trackId) {
      return null;
    }

    return {
      trackId,
      uri: uri || "",
      name: firstString(object.name, object.title, object.track_name, object.trackName) || "",
      artist: extractArtist(object),
      isPlaying: object.is_playing === true || object.playing === true || object.paused === false,
      keys,
      path
    };
  }

  function extractArtist(object) {
    if (Array.isArray(object.artists)) {
      const artists = object.artists
        .map((artist) => firstString(artist?.name, artist?.profile?.name, artist?.title))
        .filter(Boolean);
      if (artists.length > 0) {
        return artists.join(", ");
      }
    }

    if (object.artist && typeof object.artist === "object") {
      return firstString(object.artist.name, object.artist.title, object.artist.profile?.name) || "";
    }

    return firstString(object.artist, object.artist_name, object.artistName, object.subtitle) || "";
  }

  function extractTrackId(value) {
    if (!value || typeof value !== "string") {
      return null;
    }

    const direct = value.match(/^[A-Za-z0-9]{22}$/);
    if (direct) {
      return value;
    }

    const uri = value.match(/spotify:track:([A-Za-z0-9]{22})/);
    if (uri) {
      return uri[1];
    }

    const path = value.match(/\/track\/([A-Za-z0-9]{22})(?:[/?#]|$)/);
    return path ? path[1] : null;
  }

  function firstString(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return "";
  }

  function dedupeCandidates(candidates) {
    const seen = new Set();
    return candidates.filter((candidate) => {
      const key = `${candidate.trackId}\u0000${candidate.path}\u0000${candidate.name}\u0000${candidate.artist}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
})();
