# PaninoTL Dashboard

Stable browser dashboard for PaninoTL devices.

Version: `v1.0.0`

The dashboard connects to the configured MQTT broker, reads retained PaninoTL device state packets, and shows device health, schedule, camera status, Wi-Fi/battery status, SD usage, alerts, and the latest uploaded image when image upload is enabled.

## Files

- `index.html` - dashboard application
- `style.css` - dashboard styling
- `img/` - GoPro model images
- `favicon.png` - browser icon
- `shutter.wav` - successful image sound
- `error.wav` - alert sound

## Usage

Open `index.html` directly in a browser or publish this folder with GitHub Pages.

On first load, enter:

- MQTT broker URL
- topic prefix
- username
- password

The connection settings and display preferences are stored locally in the browser with `localStorage`.

## Dashboard Behavior

- Device cards are ordered locally and can be rearranged by dragging the device name.
- Compact and expanded views are available from Display Settings.
- Timestamps can be shown in local time or device time.
- Alerts are shown only when the firmware publishes an active issue or recent error.
- Older firmware that does not publish newer alert fields simply omits those fields in the dashboard.

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
- new active alerts

Sounds can be turned off in Display Settings. On iPhone/iPad, tap the dashboard once after opening it so Safari allows audio playback.
