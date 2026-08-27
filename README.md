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

## Local Installation

If a company network blocks browser WebSocket connections to the MQTT broker, run the dashboard locally:

Download the dashboard with Git:

```bash
git clone https://github.com/marcotidei/PaninoTL_Dashboard.git
cd PaninoTL_Dashboard
```

Or download it as a ZIP:

1. Open `https://github.com/marcotidei/PaninoTL_Dashboard`
2. Click `Code`
3. Click `Download ZIP`
4. Unzip the file
5. Open a terminal in the unzipped `PaninoTL_Dashboard` folder

Install and start the local dashboard:

```bash
./install-local.sh
npm run local
```

Then open:

```text
http://127.0.0.1:8787
```

Local mode serves the same dashboard files, including local copies of the MQTT browser library and Font Awesome icons. It also changes the default broker URL to:

```text
ws://127.0.0.1:8787/mqtt
```

If the browser had already saved the hosted GitHub Pages broker URL, local mode automatically changes that saved URL to the localhost proxy. If login still fails, click the connection button, confirm the Broker URL is `ws://127.0.0.1:8787/mqtt`, and try again.

You can verify that the local server is running here:

```text
http://127.0.0.1:8787/local-status
```

The local Node process bridges that browser WebSocket to the HiveMQ broker over MQTT TLS on port `8883`. MQTT username, password, and topic prefix are still entered in the normal dashboard connection modal and stored only in browser `localStorage`.

Optional environment variables:

```bash
PANINOTL_LOCAL_PORT=8787
PANINOTL_UPSTREAM_MQTT=mqtts://your-broker.example.com:8883
PANINOTL_TOPIC_PREFIX=panino
npm run local
```

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
- failed photo-count increases or new device errors

Sounds can be turned off in Display Settings. On iPhone/iPad, tap the dashboard once after opening it so Safari allows audio playback.
