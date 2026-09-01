# Fake Camera Help

`fake-camera.json` is a local test payload for the dashboard. Serve this folder
over HTTP, edit `fake-camera.json`, save it, then refresh the dashboard.

The dashboard does not read this help file automatically. This file is only a
reference while manually customizing the fake camera.

## Basic Shape

```json
{
  "id": "CameraID-11001c",
  "state": {
    "s": {},
    "c": {},
    "g": {},
    "f": {},
    "h": {}
  }
}
```

- `id`: fake device id shown by the dashboard.
- `state.s`: live status values shown in the camera card.
- `state.c`: current device configuration.
- `state.g`: GoPro model, firmware, and serial.
- `state.f`: Panino firmware/build identity.
- `state.h`: compact health alert.

## Quick Test Scenarios

- Healthy: set `state.s.err` to `0`, `state.s.iss` to `0`, `state.h.c` to `0`, `state.h.s` to `ok`, and `state.s.pf` to `0`.
- Low battery: set `state.s.b` below `15`.
- Bad WiFi: set `state.s.wq` below `40`.
- Full GoPro SD: lower `state.s.sf`; SD usage is calculated from `state.s.st` and `state.s.sf`.
- Panino SD fault: set `state.s.psdf` to `1` and `state.s.psdt` to a timestamp.
- Last error: set `state.s.err` to a last-error code and `state.s.et` to the error time.
- Standing issue: set `state.s.iss` to an issue code and `state.s.it` to the issue time.
- Health alert: set `state.h.c` to a health code, `state.h.s` to `warn` or `error`, and `state.h.t` to the alert time.

## Status Fields: `state.s`

- `t`: last communication timestamp. ISO/UTC is preferred.
- `b`: battery percent. Use `-1` for unknown; `0`-`14` is critical, `15`-`39` is low, `40`+ is ok.
- `rt`: controller RTC temperature in Celsius.
- `wq`: WiFi quality percent. Try `0`, `25`, `50`, `78`, or `100`.
- `pc`: successful confirmed photo count.
- `pf`: failed photo count.
- `sdpc`: photos reported on the GoPro SD card.
- `st`: GoPro SD total size in MB.
- `sf`: GoPro SD free size in MB.
- `sdw`: GoPro SD write issue count.
- `sdwv`: `1` means `sdw` is valid; `0` means it is not valid.
- `psdf`: Panino/controller SD fault flag. Use `1` for fault, `0` for ok.
- `psdt`: Panino SD fault time, or `-`.
- `dbxt`: Dropbox total storage in MB.
- `dbxf`: Dropbox free storage in MB.
- `ok`: last successful shot time.
- `up`: last successful upload time.
- `pu`: pending full-resolution upload count.
- `cf`: last capture failure detail, or `-`.
- `err`: last error code.
- `iss`: standing issue code.
- `it`: standing issue time, or `-`.
- `img`: preview image URL/path. Local paths like `img/hero12.png` are useful for testing.
- `log`: optional SD/debug log URL. Leave empty to hide the log link.
- `et`: last error time, or `-`.
- `tz`: device timezone, for example `America/New_York` or `Europe/Rome`.

## Config Fields: `state.c`

- `i`: photo interval in seconds.
- `d`: schedule day bitmask. `31` is weekdays; `127` is every day.
- `s`: schedule start time in device local time.
- `e`: schedule end time in device local time.
- `k`: maximum sleep/keepalive interval in seconds.
- `l`: lens setting value.
- `o`: output/photo mode value.
- `p`: power mode. Common values are `0` Always On, `1` Hybrid, `2` Power Save.
- `bm`: battery monitor enabled. Use `1` on, `0` off.
- `sdl`: SD debug log enabled. Use `1` on, `0` off.
- `ntp`: NTP sync mode.
- `u`: upload mode. Use `0` disabled, `1` thumbnail, `2` full resolution.
- `efu`: ensure full-res upload before cleanup. Use `1` enabled, `0` disabled.
- `bfm`: backfill max attempts after schedule.
- `uto`: upload timeout/profile value.

## GoPro Fields: `state.g`

- `m`: GoPro model number.
- `fw`: GoPro firmware version string.
- `sn`: GoPro serial number.

## Firmware Fields: `state.f`

- `dt`: firmware build date/time string.
- `id`: firmware/build id string.
- `wmac`: controller WiFi MAC string.
- `dirty`: `true` marks a dirty/local firmware build.

## Health Fields: `state.h`

- `c`: health code.
- `s`: health severity: `ok`, `neutral`, `warn`, or `error`.
- `t`: health alert time, or `-`.
- `k`: sticky flag. `0` acts like a last error; `1` acts like a standing issue banner.

## Last Error Codes

- `0`: None
- `1`: Camera not found
- `2`: Connect failed
- `3`: Pairing failed
- `4`: BLE not ready
- `5`: Camera not ready
- `6`: Camera settings failed
- `7`: Pre-shot read failed
- `8`: Shutter failed
- `9`: Shot not confirmed
- `10`: Unable to retrieve image from camera
- `11`: Panino SD failed
- `12`: Upload failed
- `13`: Dropbox authorization not configured
- `14`: Dropbox image link unavailable
- `15`: Dropbox account full

## Standing Issue Codes

- `0`: None
- `1`: Camera not found
- `2`: Camera not connected
- `3`: Shooting failure
- `4`: Camera Wi-Fi on 5 GHz
- `5`: Camera media wedged

## Health Codes

- `0`: None
- `2001`: Camera not found
- `2002`: Connect failed
- `2003`: Pairing failed
- `2004`: BLE not ready
- `2005`: Camera not ready
- `2006`: Camera settings failed
- `3001`: Pre-shot read failed
- `3002`: Shutter failed
- `3003`: Shot not confirmed
- `3004`: Unable to retrieve image from camera
- `4001`: Panino SD failed
- `5001`: Upload failed
- `5002`: Dropbox authorization not configured
- `5003`: Dropbox image link unavailable
- `5004`: Dropbox account full
- `6001`: Camera Wi-Fi on 5 GHz
- `6002`: Camera media wedged
- `9001`: Shooting failure
