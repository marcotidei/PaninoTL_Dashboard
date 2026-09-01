# PaninoTL Dashboard

Stable browser dashboard for PaninoTL devices.

Last updated: `2026-08-29 22:21 EDT`

The dashboard connects to the configured MQTT broker, reads retained PaninoTL device state packets, and shows device health, schedule, camera status, Wi-Fi/battery status, SD usage, alerts, and the latest uploaded image when image upload is enabled.

## Files

- `index.html` - dashboard application
- `style.css` - dashboard styling
- `img/` - GoPro model images
- `favicon.png` - browser icon
- `shutter.wav` - successful image sound
- `error.wav` - alert sound
- `fake-camera.json` - optional local fake camera payload for UI testing

## Usage

Open `index.html` directly in a browser or publish this folder with GitHub Pages.

On first load, enter:

- MQTT broker URL
- topic prefix
- username
- password

The connection settings and display preferences are stored locally in the browser with `localStorage`.

## Fake Camera

For UI work without a device, serve this folder with any simple static web
server and edit `fake-camera.json`. When that file is available over HTTP, the
dashboard adds it as a fake camera panel. Browsers usually block
`fake-camera.json` when `index.html` is opened directly with `file://`.

## Dashboard Behavior

- Device cards are ordered locally and can be rearranged by dragging the device name.
- Compact and expanded views are available from Display Settings.
- Timestamps can be shown in local time or device time.
- Alerts are shown only when the firmware publishes an active issue or recent error.
- Power Mode displays Always On, Power Save, or Hybrid when published by
  the firmware.
- GoPro SD health displays the camera-reported write-issues counter when
  published by the firmware.

## Image Behavior

- Upload disabled: no image is expected or shown.
- Upload enabled and image link present: the dashboard shows the image.
- Upload enabled and image link missing: the dashboard shows an error and an image placeholder.
- New image packets schedule one image refresh about 2 seconds after packet arrival.
- Thumbnail/preview uploads reuse the same Dropbox link, so the dashboard keys refresh and cache behavior from the image link plus capture timestamp.
- Full-resolution uploads keep the firmware's full-res behavior: timestamped file plus replacement of the latest-image object.

The image info modal uses the device-reported capture time as the main timestamp. Full-resolution images may also show EXIF time, camera, GPS, exposure, resolution, and file size when the JPEG metadata is available.

## Sounds

The dashboard can play sounds for:

- confirmed photo-count increases
- failed photo-count increases or new device errors

Sounds can be turned off in Display Settings. On iPhone/iPad, tap the dashboard once after opening it so Safari allows audio playback.
