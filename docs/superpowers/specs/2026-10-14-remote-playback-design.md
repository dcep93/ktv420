# Remote-controlled listening and capture — implementation and verification

## Intent

Let Spotify remain the user's remote and queue, while ktv420 chooses one audible source on the selected computer. Preserve the compact overlay and fixed control row. Add a persistent volume slider with percentage and a small source label: Capture, Stems, or Muted. The volume is listening volume, never an adjustment to saved capture amplitude.

Control the existing Spotify webpage through its DOM, as explicitly requested. Do not integrate Spotify Connect, the Web Playback SDK, Spotify Web API transport endpoints, or account tokens. Read now-playing links, play/pause controls, progress and volume sliders, and local HTMLMediaElement state. Remote actions are inputs only when reflected in this browser’s DOM/local media state. If the browser is no longer the local playback destination, stop local stems rather than following account-wide activity on another device.

## Playback rules

- A selected song with saved, ready stems opens and plays in the existing hosted iframe. Spotify continues silently as the reference transport. Match its track ID, play/pause state, and position; local stem mixer play/pause/seek/next/previous controls operate Spotify’s DOM buttons and seek slider, then confirm that the page applied the requested state.
- A song without ready stems plays audibly through the capture monitoring path and is captured automatically. Respect the user's selected song and position; never restart or skip it solely to obtain a complete capture. Save for separation only after a complete valid pass from the beginning. Interrupted, seeked, or late-start recordings must not become misleading complete songs.
- Remote pause is a normal pause, not a capture failure. Exclude paused time from recorded PCM. Remote seeking or skipping takes precedence over capture completion. Existing batch capture remains available through k; an external selection overrides the batch instead of allowing it to force the previous queue.
- Silence Spotify's local output whenever it is not the authorized capture source. Use an independent output gain after the recording branch. Validate native media mute/volume interactions with the PCM tap before relying on them; setting media volume blindly can damage capture or prevent discovery.
- Stems become audible only after matching buffers are ready and the previous source is silenced. Track/session generations cancel stale asynchronous loads. Rapid skips, repeat of the same track, and failed loads must not resurrect old audio. An unavailable/broken stem record falls back to the authorized capture path with a concise visible notice.
- Closing the overlay hides it without interrupting the remote session. The iframe must remain alive. Reload or disconnect silences the controlled sources until ownership and state are known. Avoid competing Spotify tabs by granting one listening owner per extension profile.

## Synchronization and controls

Use local media events and bounded 200 ms polling for reconciliation. Resolve the current song from its now-playing DOM link rather than playlist position or title guesses. Use existing data-testid selectors and accessible slider/control attributes, with isolated selector helpers for future Spotify changes. Operate actual buttons and sliders; verify their resulting state instead of treating a dispatched synthetic event as success. Seek through Spotify’s UI so its own state updates, using media currentTime as local timing evidence. Missing, ambiguous, or disabled controls produce a concise unavailable status; do not fall back to private endpoints. Spotify owns track order, shuffle, repeat, and explicit remote transport changes. A single coordinator serializes local commands, distinguishes acknowledgments from new input, and performs bounded drift correction rather than continuously seeking both players. Confirm local media activity before making stems audible; DOM metadata alone does not prove this browser is the playback destination.

Keep speed at 1× for initial correctness. The current stem player has no playback-speed control. Probe DOM media playbackRate support; only enable other rates if Spotify retains the rate and its displayed time, seeks, and song boundaries remain consistent with our player. Do not introduce an API integration for speed or advertise synchronization based solely on a successful property assignment.

The same volume slider controls capture monitoring and the stem mix master gain. Explore mapping incoming Spotify remote volume to this gain without an endless mute/unmute feedback loop. This must be validated against real DOM volume changes; displayed Spotify volume may differ from the zero output gain used to silence its audio. Chrome may require one click in the listening page to enable audio; show an explicit enable-sound action when blocked.

## Boundaries and verification

Keep audio interception, transport commands, and strict broker message validation in the extension. Keep routing decisions, volume UI, playback, and visualization in the hosted player where practical. Add capability negotiation so an older extension asks for an update instead of entering half-working remote mode. No new cloud processing/storage or additional Spotify credentials.

Before release, test muted/quiet capture retaining identical PCM, pause without added silence, partial-capture rejection, rapid track changes, stale async loads, only one audible source, device transfer away, ownership loss, remote and local seeking, previous-track restart semantics, shuffle/repeat, and lifecycle/autoplay failures. Preserve fixed control positions. Run isolated browser tests and existing audio/storage tests, then validate real DOM play/pause/seek/next/previous/volume and remote actions reflected in this browser before claiming remote compatibility. Test DOM replacement, missing selectors, rejected slider events, and page rerenders so the controller cannot silently drift out of sync. This feature requires a new extension package as well as a hosted deployment.

Selected approach: a DOM controller for the existing Spotify tab, with local media observation and the existing PCM tap. Local-player-only controls would fail the remote requirement; API/SDK transport integration is explicitly out of scope. Prove the actual DOM controls and observed state before release.

## Verification recorded during implementation

The browser fixture at `frontend/app/dom-playback-preview.html` uses detached native audio, the actual PCM worklet, DOM adapter, coordinator, storage broker, and hosted player. It passes twelve assertions covering silent Spotify during stems, bidirectional play/pause/seek, volume independent of capture amplitude, complete paused/resumed capture, no pause padding, preservation of existing stems, partial-capture rejection, and loss of local media. Separate unit tests cover ownership expiry, bounded messages, and trusted origins/windows.

Playback speed remains 1×. A phone remote, actual device transfer, and shuffle/repeat require real-device validation; passing a DOM fixture is not evidence of those interactions.
