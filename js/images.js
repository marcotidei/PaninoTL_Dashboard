// Camera modal
function openCameraModal(id) {
  const d = devices[id];
  if (!d) return;

  const g = d.gopro;
  document.getElementById("camInfoModel").innerText = goproModelName(g.m);
  document.getElementById("camInfoFw").innerText    = g.fw  || "-";
  document.getElementById("camInfoSn").innerText    = g.sn  || "-";
  document.getElementById("camInfoMac").innerText   = g.mac || "-";

  const img = document.getElementById("camImage");
  const src = goproModelImage(g.m);
  if (src) {
    img.src = src;
    img.hidden = false;
  } else {
    img.hidden = true;
    img.removeAttribute("src");
  }

  document.getElementById("cameraModal").classList.add("is-visible");
}

function closeCameraModal() {
  document.getElementById("cameraModal").classList.remove("is-visible");
}

// Last-capture image
//
// The firmware overwrites one fixed Dropbox path (/<deviceId>/last_capture.jpg)
// on every shot, so a single Dropbox share link keeps resolving to the newest
// photo. That is why this needs no Dropbox token in the page: the link is public
// and stable, and only the bytes behind it change. Device-published only -- no
// manual entry, so a device that hasn't resolved a link yet simply shows nothing
// until it does.
function captureUrlFor(id) {
  return (devices[id] && devices[id].imageUrl) || "";
}

// render() rebuilds the whole device list every second, which would destroy and
// recreate every <img> and make mobile Safari re-decode the picture each tick -
// visible as a constant flash. These wrapper+<img>+badge groups are created
// once and moved into each freshly rendered card instead. Moving a live image
// node does not refetch or re-decode it, so the picture only ever changes
// when its src does. The src is keyed to the MQTT capture/upload state, so a
// new thumbnail refreshes even when Dropbox reuses the same share URL.
const captureImgNodes = {};

// Below this width (px), the JPEG is treated as a small camera-generated
// thumbnail rather than an actual photo -- see readJpegDimensions(). GoPro full-res
// output is thousands of pixels wide regardless of model; its media
// "thumbnail" renders are a few hundred at most, so this threshold has wide
// margin on both sides.
const LOW_RES_WIDTH_THRESHOLD = 1000;
const imageMetaPending = {}; // id -> Promise
const imageBlobCache = {}; // src -> { blobUrl: string, bytes: number }
const manualRefreshToken = {}; // id -> unix ms
const autoRefreshTimers = {}; // id -> timeout handle
const AUTO_IMAGE_REFRESH_DELAY_MS = 2000;

// The displayed thumbnails go through the Cache Storage API instead of a
// plain <img src>, so a reload reuses the cached bytes instead of re-fetching
// them from Dropbox (whose raw links aren't reliably cacheable by the browser
// on their own). src is keyed to the MQTT capture/upload state, so a cache hit
// is only ever for the current image revision -- a new revision gets a new src.
const CAPTURE_CACHE_NAME = "capture-images-v1";
const captureObjectUrls = {}; // src -> blob object URL
const capturePendingLoads = {}; // src -> Promise<string>
const captureCachePrevSrc = {}; // id -> most recently resolved src, for cleanup

async function resolveCaptureImageUrl(src) {
  if (!src) return "";
  if (captureObjectUrls[src]) return captureObjectUrls[src];
  if (capturePendingLoads[src]) return capturePendingLoads[src];

  const load = (async () => {
    if ("caches" in window) {
      try {
        const cache = await caches.open(CAPTURE_CACHE_NAME);
        const hit = await cache.match(src);
        if (hit) return URL.createObjectURL(await hit.blob());
      } catch (err) {
        console.warn("Capture image cache read failed:", src, err);
      }
    }

    for (const candidate of imageFetchCandidates(src)) {
      try {
        const response = await fetch(candidate, { cache: "no-store" });
        if (!response.ok) continue;
        if ("caches" in window) {
          try {
            const cache = await caches.open(CAPTURE_CACHE_NAME);
            await cache.put(src, response.clone());
          } catch (err) {
            console.warn("Capture image cache write failed:", src, err);
          }
        }
        return URL.createObjectURL(await response.blob());
      } catch (err) {
        // try the next candidate host
      }
    }
    return src; // let the <img> attempt a direct network load as a last resort
  })();

  capturePendingLoads[src] = load;
  try {
    const url = await load;
    captureObjectUrls[src] = url;
    return url;
  } finally {
    delete capturePendingLoads[src];
  }
}

async function deleteCaptureCacheEntry(src) {
  if (!src) return;

  if (captureObjectUrls[src]) {
    URL.revokeObjectURL(captureObjectUrls[src]);
    delete captureObjectUrls[src];
  }
  if ("caches" in window) {
    try {
      const cache = await caches.open(CAPTURE_CACHE_NAME);
      await cache.delete(src);
    } catch (err) {
      console.warn("Capture image cache cleanup failed:", src, err);
    }
  }
}

// Drop the previous image's cache entry once a device moves on to a new one,
// so Cache Storage doesn't grow forever across uploads.
async function evictStaleCaptureCache(id, newSrc) {
  const prevSrc = captureCachePrevSrc[id];
  captureCachePrevSrc[id] = newSrc;
  if (!prevSrc || prevSrc === newSrc) return;

  await deleteCaptureCacheEntry(prevSrc);
}

async function refreshStableCaptureImage(id) {
  const src = captureImageSrc(id);
  if (!src) return;

  await deleteCaptureCacheEntry(src);

  Object.keys(captureImgNodes).forEach((key) => {
    if (!key.startsWith(id + "|")) return;
    const entry = captureImgNodes[key];
    if (!entry || entry.img.dataset.captureSrc !== src) return;
    resolveCaptureImageUrl(src).then((url) => {
      if (entry.img.dataset.captureSrc === src) entry.img.setAttribute("src", url);
    });
  });
}

function imageMarkedNotCurrent(id) {
  const d = devices[id];
  const issue = String((d && d.issueCode) || "").toLowerCase();
  const health = String((d && d.healthText) || "").toLowerCase();
  return issue.includes("retrieve image") || issue.includes("media") || health.includes("media wedged");
}

function captureImgWrap(id, kind, src, isLowRes, notCurrent) {
  const key = id + "|" + kind;
  let entry = captureImgNodes[key];
  if (!entry) {
    const wrap = document.createElement("div");
    wrap.className = "capture-thumb-wrap kind-" + kind;

    const img = new Image();
    img.className = kind === "compact" ? "summary-thumb" : "capture-thumb";
    img.alt = "Last capture";

    const badge = document.createElement("span");
    badge.className = "thumb-badge";
    badge.textContent = "Preview";
    badge.hidden = true;

    wrap.appendChild(img);
    wrap.appendChild(badge);

    // Clicking the thumbnail (compact or expanded) opens the image info modal
    // directly, instead of just toggling the panel open/closed underneath it.
    wrap.addEventListener("click", function (event) {
      event.stopPropagation();
      openImageInfoModal(event, id);
    });

    img.addEventListener("load", function () {
      const srcKey = img.getAttribute("data-meta-src") || "";
      if (!srcKey) return;
      const prev = (imageMeta[id] && imageMeta[id].src === srcKey)
        ? imageMeta[id]
        : { src: srcKey, width: 0, height: 0, bytes: 0, exif: null };

      imageMeta[id] = {
        src: srcKey,
        width: img.naturalWidth || prev.width || 0,
        height: img.naturalHeight || prev.height || 0,
        bytes: prev.bytes || 0,
        exif: prev.exif || null,
        exifLoaded: !!prev.exifLoaded
      };
    });

    entry = { wrap, img, badge };
    captureImgNodes[key] = entry;
  }
  if (entry.img.dataset.captureSrc !== src) {
    entry.img.dataset.captureSrc = src;
    entry.img.setAttribute("data-meta-src", src);
    evictStaleCaptureCache(id, src);
    resolveCaptureImageUrl(src).then((url) => {
      if (entry.img.dataset.captureSrc === src) entry.img.setAttribute("src", url);
    });
  }
  entry.badge.textContent = notCurrent ? "Not current" : "Preview";
  entry.badge.title = notCurrent
    ? "The camera captured newer photos, but the displayed image was not updated."
    : "This is a small camera-generated preview, not the full-resolution photo.";
  entry.badge.hidden = !(notCurrent || isLowRes);
  return entry.wrap;
}

function mountCaptureImages(cardEl, id) {
  const src = captureImageSrc(id);
  if (!src) return;
  const meta = imageMeta[id];
  const isLowRes = !!(meta && meta.src === src && meta.width > 0 && meta.width < LOW_RES_WIDTH_THRESHOLD);
  const notCurrent = imageMarkedNotCurrent(id);
  cardEl.querySelectorAll(".capture-slot").forEach((slot) => {
    const kind = slot.dataset.kind;
    const wrap = captureImgWrap(id, kind, src, isLowRes, notCurrent);
    slot.appendChild(wrap);
  });
}

// Dropbox share links land on a preview page by default (dl=0). raw=1 serves the
// file bytes, which is what an <img> needs.
function directImageUrl(shareUrl) {
  if (!shareUrl) return "";
  let url = shareUrl.trim().replace(/[?&]dl=[01]/, "");
  if (!/[?&]raw=1/.test(url)) {
    url += (url.includes("?") ? "&" : "?") + "raw=1";
  }
  return url;
}

function directDownloadUrl(shareUrl) {
  if (!shareUrl) return "";
  let url = shareUrl.trim()
    .replace(/[?&]raw=1/g, "")
    .replace(/[?&]dl=[01]/g, "");
  url += (url.includes("?") ? "&" : "?") + "dl=1";
  return url;
}

function isDropboxUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes("dropbox.com") || host.includes("dropboxusercontent.com");
  } catch {
    return false;
  }
}

function dropboxContentUrl(url) {
  try {
    const u = new URL(url);
    if (!isDropboxUrl(url)) return url;
    u.hostname = "dl.dropboxusercontent.com";
    return u.toString();
  } catch {
    return url;
  }
}

function imageFetchCandidates(src) {
  if (!src) return [];
  if (!isDropboxUrl(src)) return [src];
  const primary = src;
  const alternate = dropboxContentUrl(src);
  return primary === alternate ? [primary] : [primary, alternate];
}

function appendQueryParam(url, key, value) {
  if (!url || value === undefined || value === null || value === "") return url || "";
  return url + (url.includes("?") ? "&" : "?") +
    encodeURIComponent(key) + "=" + encodeURIComponent(String(value));
}

function captureRevisionFor(id) {
  const d = devices[id];
  if (!d) return "";
  return d.imageRevision || "";
}

// Thumbnail mode overwrites the same Dropbox object/path, so the share URL can
// stay unchanged while the bytes behind it change. Keying the display URL to
// the image link plus capture timestamp keeps the current image cached locally
// while still refreshing when the device reports a new uploaded capture.
function captureImageSrc(id) {
  const base = directImageUrl(captureUrlFor(id));
  if (!base) return "";
  const uploadKey = captureRevisionFor(id);
  let src = appendQueryParam(base, "u", uploadKey);
  src = appendQueryParam(src, "r", manualRefreshToken[id]);
  return src;
}

function scheduleAutoImageRefresh(id) {
  if (autoRefreshTimers[id]) clearTimeout(autoRefreshTimers[id]);
  autoRefreshTimers[id] = setTimeout(() => {
    delete autoRefreshTimers[id];

    const d = devices[id];
    if (!d || !uploadEnabled(d.config) || !captureUrlFor(id)) return;

    refreshStableCaptureImage(id);
    if (!uiLocked) render();
  }, AUTO_IMAGE_REFRESH_DELAY_MS);
}

// Low-res preview detection
//
// The one thing worth reading from the image bytes is its real pixel
// dimensions, for the low-res "Thumbnail" badge -- every JPEG bitstream,
// thumbnail or not, has a mandatory SOF marker with true width/height,
// independent of whatever optional metadata it may or may not carry.
const imageMeta = {}; // id -> { src, width, height, bytes, exif }

function ensureImageMetaLoaded(id, src, force = false) {
  if (!src) return Promise.resolve({ src: "", width: 0, height: 0, bytes: 0, exif: null, exifLoaded: false });
  const cached = imageMeta[id];
  if (!force && imageMetaPending[id] && cached && cached.src === src) return imageMetaPending[id];
  if (!force && cached && cached.src === src && (cached.width > 0 || cached.bytes > 0) && cached.exifLoaded) return Promise.resolve(cached);

  const prev = (cached && cached.src === src) ? cached : { src, width: 0, height: 0, bytes: 0, exif: null, exifLoaded: false };
  imageMeta[id] = {
    src,
    width: prev.width || 0,
    height: prev.height || 0,
    bytes: prev.bytes || 0,
    exif: prev.exif || null,
    exifLoaded: !!prev.exifLoaded
  };

  const req = (async function () {
    const options = { cache: "no-store" };
    let dataBuffer = null;
    let lastErr = null;

    for (const candidate of imageFetchCandidates(src)) {
      try {
        const response = await fetch(candidate, options);
        if (!response.ok) throw new Error("HTTP " + response.status);
        dataBuffer = await response.arrayBuffer();
        break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (!dataBuffer) throw (lastErr || new Error("Image fetch failed"));
    return dataBuffer;
  })()
    .then(dataBuffer => {
      let meta = { width: 0, height: 0 };
      try { meta = readJpegDimensions(dataBuffer); } catch (e) { console.warn("JPEG parse failed:", id, e); }
      let exif = null;
      try { exif = readJpegExif(dataBuffer); } catch (e) { console.warn("EXIF parse failed:", id, e); }
      imageMeta[id] = { src, width: meta.width, height: meta.height, bytes: dataBuffer.byteLength, exif, exifLoaded: true };
      // render() ticks every 1s and reads this cache directly, so the
      // low-res badge catches up once the fetch resolves.
      return imageMeta[id];
    })
    .catch(err => {
      console.warn("Capture image fetch failed:", id, err);
      const existing = imageMeta[id] || { src, width: 0, height: 0, bytes: 0, exif: null, exifLoaded: false };
      imageMeta[id] = {
        src,
        width: existing.width || 0,
        height: existing.height || 0,
        bytes: existing.bytes || 0,
        exif: existing.exif || null,
        exifLoaded: !!existing.exifLoaded
      };
      return imageMeta[id];
    })
    .finally(() => {
      if (imageMetaPending[id] === req) delete imageMetaPending[id];
    });

  imageMetaPending[id] = req;
  return req;
}

async function ensureImageBlobCached(src, force = false) {
  if (!src) return null;
  if (!force && imageBlobCache[src]) return imageBlobCache[src];

  const response = await fetch(src, force ? { cache: "no-store" } : undefined);
  if (!response.ok) throw new Error("HTTP " + response.status);

  const blob = await response.blob();
  const existing = imageBlobCache[src];
  if (existing && existing.blobUrl) URL.revokeObjectURL(existing.blobUrl);

  const entry = { blobUrl: URL.createObjectURL(blob), bytes: blob.size };
  imageBlobCache[src] = entry;
  return entry;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!value || Number.isNaN(value) || value < 0) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function imageFilenameFor(id, d) {
  const stampSource = (d && d.lastShotOk) ? String(d.lastShotOk) : String(Date.now());
  const stamp = stampSource.replace(/[^0-9A-Za-z_-]/g, "_");
  return `${id}_last_capture_${stamp}.jpg`;
}

function downloadUrlWithStamp(id) {
  const base = directDownloadUrl(captureUrlFor(id));
  if (!base) return "";
  const uploadKey = captureRevisionFor(id);
  let src = appendQueryParam(base, "u", uploadKey);
  src = appendQueryParam(src, "r", manualRefreshToken[id]);
  return src;
}

async function downloadCaptureImage(id, forceRefresh = false) {
  const d = devices[id];
  if (!d) return;
  const src = downloadUrlWithStamp(id);
  if (!src) return;

  const a = document.createElement("a");
  a.href = src;
  a.download = imageFilenameFor(id, d);
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadCaptureImageFromToolbar(event, id) {
  event.stopPropagation();
  downloadCaptureImage(id);
}

async function refreshCaptureImage(event, id) {
  event.stopPropagation();
  const d = devices[id];
  if (!d) return;

  manualRefreshToken[id] = Date.now();
  const src = captureImageSrc(id);
  await ensureImageMetaLoaded(id, src, true);
  render();
}

async function ensureImageSizeFromHeaders(id, src) {
  const current = imageMeta[id];
  if (!src || !current || current.src !== src || current.bytes > 0) return;
  const candidates = imageFetchCandidates(src);

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { method: "HEAD", cache: "no-store" });
      const len = Number(response.headers.get("content-length") || 0);
      if (response.ok && len > 0) {
        imageMeta[id] = { ...imageMeta[id], bytes: len };
        return;
      }
    } catch (err) {
      console.warn("Image size header read failed:", err);
    }
  }

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { cache: "no-store" });
      if (!response.ok) continue;
      const blob = await response.blob();
      if (blob.size > 0) {
        imageMeta[id] = { ...imageMeta[id], bytes: blob.size };
        return;
      }
    } catch {
      // Keep the existing fallback message if host blocks cross-origin bytes.
    }
  }
}

async function openImageInfoModal(event, id) {
  event.stopPropagation();
  const d = devices[id];
  if (!d) return;

  const src = captureImageSrc(id);
  if (!src) return;

  const model = goproModelName(d.gopro && d.gopro.m);
  const imageLink = document.getElementById("imageInfoLink");
  imageLink.href = directImageUrl(captureUrlFor(id));
  document.getElementById("imageInfoCamera").innerText = model || "-";
  document.getElementById("imageInfoUploaded").innerText =
    d.lastUploadOk && d.lastUploadOk !== "-"
      ? `${formatDateTime(d.lastUploadOk, d.tz)} - ${elapsedAgoDetailed(d.lastUploadOk)}`
      : "Unknown";
  document.getElementById("imageInfoResolution").innerText = "Loading...";
  document.getElementById("imageInfoSize").innerText = "Loading...";
  document.getElementById("imageInfoExifTime").innerText = "Loading...";
  document.getElementById("imageInfoGps").innerText = "Loading...";
  document.getElementById("imageInfoExifCamera").innerText = "Loading...";
  document.getElementById("imageInfoExposure").innerText = "Loading...";
  document.getElementById("imageInfoModal").classList.add("is-visible");

  const meta = await ensureImageMetaLoaded(id, src);
  await ensureImageSizeFromHeaders(id, src);
  const current = imageMeta[id];
  if (!current || current.src !== src) return;

  const resolution = (current.width > 0 && current.height > 0) ? `${current.width} x ${current.height}` : "Unknown";
  const sizeBytes = current.bytes > 0 ? current.bytes : ((imageBlobCache[src] && imageBlobCache[src].bytes) || 0);
  const exif = current.exif || null;
  const exifCam = [exif && exif.make, exif && exif.model].filter(Boolean).join(" ").trim();
  const exifTime = (exif && exif.dateTimeOriginal) || "Not available";
  const gps = (exif && exif.gps && Number.isFinite(exif.gps.lat) && Number.isFinite(exif.gps.lon))
    ? `${exif.gps.lat.toFixed(6)}, ${exif.gps.lon.toFixed(6)}`
    : "Not available";
  const exposureParts = [];
  if (exif && exif.exposureTime) exposureParts.push(exif.exposureTime);
  if (exif && exif.fNumber) exposureParts.push(`f/${exif.fNumber}`);
  if (exif && exif.iso) exposureParts.push(`ISO ${exif.iso}`);
  if (exif && exif.focalLength) exposureParts.push(`${exif.focalLength}mm`);

  document.getElementById("imageInfoResolution").innerText = resolution;
  document.getElementById("imageInfoSize").innerText = sizeBytes > 0 ? formatBytes(sizeBytes) : "Not provided by host";
  document.getElementById("imageInfoExifTime").innerText = exifTime;
  document.getElementById("imageInfoGps").innerText = gps;
  document.getElementById("imageInfoExifCamera").innerText = exifCam || "Not available";
  document.getElementById("imageInfoExposure").innerText = exposureParts.length ? exposureParts.join(" | ") : "Not available";
}

function closeImageInfoModal() {
  document.getElementById("imageInfoModal").classList.remove("is-visible");
}

// Real pixel width/height from a JPEG's mandatory SOFn marker. 0/0 if no SOF
// marker was found (corrupt/truncated fetch).
function readJpegDimensions(buf) {
  const view = new DataView(buf);
  const meta = { width: 0, height: 0 };
  if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return meta;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xFF00) !== 0xFF00) break;
    if (marker === 0xFFD9 || marker === 0xFFDA) break; // EOI / start of scan: no more header segments
    const size = view.getUint16(offset + 2);

    if (isSofMarker(marker) && size >= 7 && offset + 9 <= view.byteLength) {
      // SOF layout after the marker+length: precision(1), height(2), width(2).
      // Always big-endian, per the JPEG spec.
      meta.height = view.getUint16(offset + 5);
      meta.width  = view.getUint16(offset + 7);
      break;
    }

    offset += 2 + size;
  }
  return meta;
}

function readJpegExif(buf) {
  const view = new DataView(buf);
  if (view.byteLength < 12 || view.getUint16(0) !== 0xFFD8) return null;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xFF00) !== 0xFF00) break;
    if (marker === 0xFFD9 || marker === 0xFFDA) break;
    const size = view.getUint16(offset + 2);
    if (size < 2 || offset + 2 + size > view.byteLength) break;

    if (marker === 0xFFE1 && size >= 10) {
      const exifStart = offset + 4;
      const exifId = String.fromCharCode(
        view.getUint8(exifStart),
        view.getUint8(exifStart + 1),
        view.getUint8(exifStart + 2),
        view.getUint8(exifStart + 3)
      );
      if (exifId === "Exif") {
        const tiffOffset = exifStart + 6;
        const segmentEnd = offset + 2 + size;
        return readExifTiff(view, tiffOffset, segmentEnd);
      }
    }

    offset += 2 + size;
  }
  return null;
}

function readExifTiff(view, tiffOffset, endOffset) {
  if (tiffOffset + 8 > endOffset) return null;
  const byteOrder = view.getUint16(tiffOffset);
  const little = byteOrder === 0x4949;
  if (!little && byteOrder !== 0x4D4D) return null;

  const u16 = (off) => view.getUint16(off, little);
  const u32 = (off) => view.getUint32(off, little);
  const i32 = (off) => view.getInt32(off, little);

  if (u16(tiffOffset + 2) !== 42) return null;
  const ifd0Rel = u32(tiffOffset + 4);

  const typeSize = {
    1: 1, 2: 1, 3: 2, 4: 4, 5: 8,
    7: 1, 9: 4, 10: 8
  };

  function readAscii(abs, count) {
    let s = "";
    for (let i = 0; i < count && abs + i < endOffset; i++) {
      const ch = view.getUint8(abs + i);
      if (ch === 0) break;
      s += String.fromCharCode(ch);
    }
    return s.trim();
  }

  function readRational(abs) {
    if (abs + 8 > endOffset) return null;
    const n = u32(abs);
    const d = u32(abs + 4);
    if (!d) return null;
    return n / d;
  }

  function readSRational(abs) {
    if (abs + 8 > endOffset) return null;
    const n = i32(abs);
    const d = i32(abs + 4);
    if (!d) return null;
    return n / d;
  }

  function readValue(type, count, valueOffsetAbs, inlineAbs) {
    const size = (typeSize[type] || 0) * count;
    const sourceAbs = size <= 4 ? inlineAbs : valueOffsetAbs;
    if (sourceAbs < tiffOffset || sourceAbs + Math.max(size, 1) > endOffset) return null;

    if (type === 2) return readAscii(sourceAbs, count);
    if (type === 3) {
      if (count === 1) return u16(sourceAbs);
      const arr = [];
      for (let i = 0; i < count; i++) arr.push(u16(sourceAbs + i * 2));
      return arr;
    }
    if (type === 4) {
      if (count === 1) return u32(sourceAbs);
      const arr = [];
      for (let i = 0; i < count; i++) arr.push(u32(sourceAbs + i * 4));
      return arr;
    }
    if (type === 5) {
      if (count === 1) return readRational(sourceAbs);
      const arr = [];
      for (let i = 0; i < count; i++) arr.push(readRational(sourceAbs + i * 8));
      return arr;
    }
    if (type === 10) {
      if (count === 1) return readSRational(sourceAbs);
      const arr = [];
      for (let i = 0; i < count; i++) arr.push(readSRational(sourceAbs + i * 8));
      return arr;
    }
    if (type === 1 || type === 7) {
      if (count === 1) return view.getUint8(sourceAbs);
      const arr = [];
      for (let i = 0; i < count; i++) arr.push(view.getUint8(sourceAbs + i));
      return arr;
    }
    return null;
  }

  function readIfd(relOffset) {
    const abs = tiffOffset + relOffset;
    if (relOffset <= 0 || abs + 2 > endOffset) return [];
    const count = u16(abs);
    const entries = [];
    for (let i = 0; i < count; i++) {
      const e = abs + 2 + i * 12;
      if (e + 12 > endOffset) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const valueCount = u32(e + 4);
      const valueOffsetRel = u32(e + 8);
      const valueOffsetAbs = tiffOffset + valueOffsetRel;
      const value = readValue(type, valueCount, valueOffsetAbs, e + 8);
      entries.push({ tag, value });
    }
    return entries;
  }

  function valueFor(entries, tag) {
    const item = entries.find((e) => e.tag === tag);
    return item ? item.value : null;
  }

  const ifd0 = readIfd(ifd0Rel);
  const exifRel = valueFor(ifd0, 0x8769);
  const gpsRel = valueFor(ifd0, 0x8825);
  const exifIfd = typeof exifRel === "number" ? readIfd(exifRel) : [];
  const gpsIfd = typeof gpsRel === "number" ? readIfd(gpsRel) : [];

  const make = valueFor(ifd0, 0x010F) || null;
  const model = valueFor(ifd0, 0x0110) || null;
  const dateTimeOriginal = valueFor(exifIfd, 0x9003) || valueFor(ifd0, 0x0132) || null;
  const isoRaw = valueFor(exifIfd, 0x8827);
  const iso = Array.isArray(isoRaw) ? isoRaw[0] : isoRaw;
  const exposure = valueFor(exifIfd, 0x829A);
  const fNumberRaw = valueFor(exifIfd, 0x829D);
  const focalRaw = valueFor(exifIfd, 0x920A);

  const exposureTime = (typeof exposure === "number" && exposure > 0)
    ? (exposure < 1 ? `1/${Math.round(1 / exposure)}s` : `${exposure.toFixed(2)}s`)
    : null;
  const fNumber = (typeof fNumberRaw === "number" && fNumberRaw > 0)
    ? Number(fNumberRaw.toFixed(1))
    : null;
  const focalLength = (typeof focalRaw === "number" && focalRaw > 0)
    ? Number(focalRaw.toFixed(1))
    : null;

  const latRef = valueFor(gpsIfd, 0x0001);
  const latVals = valueFor(gpsIfd, 0x0002);
  const lonRef = valueFor(gpsIfd, 0x0003);
  const lonVals = valueFor(gpsIfd, 0x0004);

  let gps = null;
  if (Array.isArray(latVals) && latVals.length >= 3 && Array.isArray(lonVals) && lonVals.length >= 3) {
    const lat = latVals[0] + latVals[1] / 60 + latVals[2] / 3600;
    const lon = lonVals[0] + lonVals[1] / 60 + lonVals[2] / 3600;
    gps = {
      lat: (String(latRef || "N").toUpperCase() === "S") ? -lat : lat,
      lon: (String(lonRef || "E").toUpperCase() === "W") ? -lon : lon
    };
  }

  return {
    make,
    model,
    dateTimeOriginal,
    iso: (typeof iso === "number") ? iso : null,
    exposureTime,
    fNumber,
    focalLength,
    gps
  };
}

// SOFn markers span 0xFFC0-0xFFCF, excluding 0xFFC4 (DHT), 0xFFC8 (JPG,
// reserved), and 0xFFCC (DAC) -- those three fall in the numeric range but
// are not Start-Of-Frame segments.
function isSofMarker(marker) {
  return marker >= 0xFFC0 && marker <= 0xFFCF &&
         marker !== 0xFFC4 && marker !== 0xFFC8 && marker !== 0xFFCC;
}
