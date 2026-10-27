# Space controls playback

Space in ktv420 must only play/pause, regardless of focused buttons, sliders, or text controls. Consume both keydown and keyup before native control activation; held keys toggle once. The hosted LibraryPage owns the shortcut, routes active replay to replay transport, loaded audio to the same manual player action as its Play button, and otherwise current Spotify playback to the existing relay. Space never starts capture or activates the logo. Standalone Player retains the shortcut; embedded Player delegates it to LibraryPage. Other keys and Spotify outside the overlay remain unchanged.

Use a shared capture-phase listener with cleanup and a hook holding the latest callback. Remove the separate replay listener to prevent double toggles. Verify focused controls, repeats, keyup, cleanup, replay ownership, tests/lint/build, and browser playback.
