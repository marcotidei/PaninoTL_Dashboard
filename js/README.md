# Dashboard JavaScript

The dashboard intentionally uses plain classic browser scripts instead of a
build step or module bundler. This keeps the static `index.html` usable from a
local file or any simple web host.

Script order in `index.html` matters:

1. `constants.js` - protocol constants and health/error decoders.
2. `audio.js` - browser audio priming and alert sounds.
3. `app-state.js` - shared dashboard state, device ordering, drag behavior.
4. `mqtt.js` - MQTT config, connection handling, and state packet ingestion.
5. `time-format.js` - display preferences, scheduling, labels, status helpers.
6. `images.js` - camera/image modals, Dropbox image loading, EXIF parsing.
7. `modals.js` - firmware/settings/command modals and global modal handlers.
8. `render.js` - device panel rendering.
9. `boot.js` - startup sequence and render timer.
