// Time helpers. Firmware publishes ISO8601 UTC timestamps when timezone is
// configured, and local wall-clock strings when it has no zone rule.
function parseTS(ts) {
  if (!ts || ts === "-") return null;
  if (ts instanceof Date) return ts;
  const iso = ts.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/);
  if (iso) {
    return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]),
                             Number(iso[4]), Number(iso[5]), Number(iso[6])));
  }
  const wall = ts.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (wall) {
    return new Date(Number(wall[1]), Number(wall[2]) - 1, Number(wall[3]),
                    Number(wall[4]), Number(wall[5]), Number(wall[6]));
  }
  return null;
}

// Timezone display mode: "my" renders instants in the viewer's zone,
// "device" in the zone the device publishes ("tz" field).
let tzMode = localStorage.getItem("tzMode") || "my";

function setTzMode(mode) {
  if ((mode !== "my" && mode !== "device") || mode === tzMode) return;
  tzMode = mode;
  localStorage.setItem("tzMode", tzMode);
  updateTzToggleUI();
  render();
}

function updateTzToggleUI() {
  applySegmentedControl("tzToggle", tzMode);
}

function setSoundMode(mode) {
  if ((mode !== "on" && mode !== "off") || mode === soundMode) return;
  soundMode = mode;
  localStorage.setItem("soundMode", soundMode);
  updateSoundToggleUI();
  if (soundMode === "on") primeAudioFromGesture();
}

function updateSoundToggleUI() {
  applySegmentedControl("soundToggle", soundMode);
}

// Thumbnail display size: purely a rendering preference (how big the capture
// images are drawn), independent of the actual image resolution fetched.
// Persisted the same way as tzMode above, so a phone user who prefers Large
// keeps seeing Large after closing the tab. First-time visitors default to Small.
const THUMB_SIZES = ["s", "m", "l"];
let thumbSize = localStorage.getItem("thumbSize") || "s";
if (THUMB_SIZES.indexOf(thumbSize) === -1) thumbSize = "s";

function setThumbSize(size) {
  if (THUMB_SIZES.indexOf(size) === -1 || size === thumbSize) return;
  thumbSize = size;
  localStorage.setItem("thumbSize", thumbSize);
  applyThumbSize();
}

function applyThumbSize() {
  document.body.classList.remove("thumb-size-s", "thumb-size-m", "thumb-size-l");
  document.body.classList.add("thumb-size-" + thumbSize);
  applySegmentedControl("thumbSizeSlider", thumbSize);
}

function updateViewToggleUI() {
  applySegmentedControl("viewToggle", expandAll ? "expanded" : "compact");
}

// Shared by the Thumbnail/Time/View controls in the settings modal: a sliding
// highlight (sized to 1/N of the track, N = option count) moves to whichever
// button's data-value matches the current state.
function applySegmentedControl(containerId, activeValue) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const options = Array.from(el.querySelectorAll(".segmented-option"));
  const index = options.findIndex((btn) => btn.dataset.value === activeValue);
  el.style.setProperty("--options", options.length);
  el.style.setProperty("--active-index", Math.max(index, 0));
  options.forEach((btn) => {
    const isActive = btn.dataset.value === activeValue;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-checked", String(isActive));
  });
}

let topbarLabelResizeTimer = null;
window.addEventListener("resize", function () {
  clearTimeout(topbarLabelResizeTimer);
  topbarLabelResizeTimer = setTimeout(updateCompactSummaryLayouts, 150);
});

function updateCompactSummaryLayouts(root = document) {
  root.querySelectorAll(".collapsed-summary.has-thumb").forEach((summary) => {
    summary.classList.remove("stack-under-thumb");

    const shouldStack = Array.from(summary.querySelectorAll(".summary-value"))
      .some((value) => value.scrollWidth > value.clientWidth + 1);

    if (shouldStack) summary.classList.add("stack-under-thumb");
  });
}

function relativeTime(ts) {
  if (!ts) return "-";
  const t = (ts instanceof Date) ? ts : parseTS(ts);
  if (!t || isNaN(t)) return "-";
  const diff = Math.floor((Date.now() - t.getTime()) / 1000);
  if (diff < 10)   return "now";
  if (diff < 60)   return diff + "s";
  if (diff < 3600) return Math.floor(diff / 60) + "m";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function elapsedAgo(ts) {
  if (!ts) return "-";
  const t = (ts instanceof Date) ? ts : parseTS(ts);
  if (!t || isNaN(t)) return "-";

  const diff = Math.max(0, Math.floor((Date.now() - t.getTime()) / 1000));
  if (diff < 10) return "now";
  if (diff < 60) return `${diff} secs ago`;

  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "min" : "mins"} ago`;

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}:${String(remMinutes).padStart(2, "0")} ${hours === 1 ? "hour" : "hours"} ago`;
}

// Days/hours/minutes breakdown, e.g. "2d 04h 31m ago" -- used where the plain
// elapsedAgo's collapsed hour:minute form isn't granular enough past a day.
function elapsedAgoDetailed(ts) {
  if (!ts) return "-";
  const t = (ts instanceof Date) ? ts : parseTS(ts);
  if (!t || isNaN(t)) return "-";

  const diff = Math.max(0, Math.floor((Date.now() - t.getTime()) / 1000));
  if (diff < 10) return "now";

  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${String(hours).padStart(2, "0")}h`);
  parts.push(`${String(minutes).padStart(2, "0")}m`);
  return `${parts.join(" ")} ago`;
}

// tz is the device's IANA zone name.
// Device-time mode uses the browser's own tzdata via Intl, so DST resolves
// correctly for any instant with zero date math here.
function formatDateTime(ts, tz) {
  if (!ts || ts === "-") return "-";
  const t = (ts instanceof Date) ? ts : parseTS(ts);
  if (!t || isNaN(t)) return "-";
  if (tzMode === "device" && tz) {
    try { return t.toLocaleString(undefined, { timeZone: tz }); }
    catch (e) { /* unknown zone name -> fall through to viewer-local */ }
  }
  return t.toLocaleString();
}

const deviceWallTimeFormatters = {};

function wallTimeFormatter(tz) {
  if (!tz) return null;
  if (deviceWallTimeFormatters[tz]) return deviceWallTimeFormatters[tz];
  deviceWallTimeFormatters[tz] = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  return deviceWallTimeFormatters[tz];
}

function localWallParts(date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
    jsDay: date.getDay()
  };
}

function deviceWallParts(date, tz) {
  if (!tz) return localWallParts(date);
  try {
    const parts = {};
    wallTimeFormatter(tz).formatToParts(date).forEach(part => {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);
    const second = Number(parts.second);
    if (![year, month, day, hour, minute, second].every(Number.isFinite)) {
      return localWallParts(date);
    }
    return {
      year,
      month,
      day,
      hour,
      minute,
      second,
      jsDay: new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    };
  } catch {
    return localWallParts(date);
  }
}

function uploadEnabled(config) {
  return Number(config && config.uploadMode) > 0;
}

function uploadMissingImageLink(d) {
  return !!(d && uploadEnabled(d.config) && !captureUrlFor(d.id));
}

function capturePlaceholderHtml(kind) {
  return `
    <div class="capture-thumb-wrap kind-${kind} capture-placeholder" title="Upload enabled, but image link is missing">
      <i class="fa-solid fa-image-slash"></i>
      <span>Image unavailable</span>
    </div>
  `;
}

// Unit conversion helpers
function sdUsagePercent(d) {
  if (!d.sdTotalMB || d.sdTotalMB === 0) return 0;
  return Math.round(100 * (1 - (d.sdFreeMB / d.sdTotalMB)));
}

function dropboxUsagePercent(d) {
  if (!d.dropboxTotalMB || d.dropboxTotalMB === 0) return 0;
  return Math.round(100 * (1 - (d.dropboxFreeMB / d.dropboxTotalMB)));
}

function clampPercent(value) {
  const pct = Number(value);
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function usedSpaceMB(totalMB, freeMB) {
  if (typeof totalMB !== "number" || totalMB <= 0) return 0;
  if (typeof freeMB !== "number" || freeMB < 0) return totalMB;
  return Math.max(0, totalMB - freeMB);
}

function hasSdTotal(d) {
  return typeof d.sdTotalMB === "number" && d.sdTotalMB > 0;
}

function hasDropboxTotal(d) {
  return typeof d.dropboxTotalMB === "number" && d.dropboxTotalMB > 0;
}

function formatTotalGB(mb) {
  if (!mb || mb <= 0) return "-";
  return Math.round(mb / 1024) + " GB";
}

function formatFreeSmart(mb) {
  if (!mb || mb <= 0) return "-";
  if (mb >= 1024) {
    const gb = mb / 1024;
    if (gb >= 100) return Math.round(gb) + " GB";
    if (gb >= 10)  return gb.toFixed(1) + " GB";
    return gb.toFixed(2) + " GB";
  }
  return Math.round(mb) + " MB";
}

function formatTemperature(celsius) {
  if (celsius == null || Number.isNaN(celsius)) return "-";
  const fahrenheit = (celsius * 9 / 5) + 32;
  return `${celsius.toFixed(2)}°C (${fahrenheit.toFixed(2)}°F)`;
}

function temperatureBarPercent(celsius) {
  const value = Number(celsius);
  if (!Number.isFinite(value)) return 0;
  return clampPercent(((value + 10) / 80) * 100);
}

function temperatureLevelClass(celsius) {
  const value = Number(celsius);
  if (!Number.isFinite(value)) return "";
  if (value >= 60) return "sd-error";
  if (value >= 45) return "sd-warn";
  return "sd-ok";
}

function temperatureTextClass(celsius) {
  const value = Number(celsius);
  if (!Number.isFinite(value)) return "text-default";
  if (value >= 60) return "text-danger";
  if (value >= 45) return "text-warning";
  return "text-default";
}

function formatIntervalMinutes(seconds) {
  const value = Number(seconds);
  if (!value || Number.isNaN(value)) return "-";

  const minutes = value / 60;
  const display = Number.isInteger(minutes) ? minutes : Number(minutes.toFixed(1));
  return `${display} ${display === 1 ? "min" : "mins"}`;
}

function formatUploadSummary(config) {
  // Tri-state: 0=Disabled, 1=Thumbnail, 2=Full Res.
  const mode = Number(config && config.uploadMode);
  if (!config || mode === 0 || Number.isNaN(mode)) return "Disabled";

  const label = mode === 2 ? "Full Res" : "Thumbnail";
  const timeout = Number(config.uploadTimeout);
  if (!timeout || Number.isNaN(timeout)) return label;

  return `${label} / ${timeout} ${timeout === 1 ? "min" : "mins"}`;
}

// Schedule helpers
function hhmmToSeconds(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 3600 + m * 60;
}

function dayIndexMon0(jsDay) {
  return (jsDay + 6) % 7;
}

function isDayActive(days, date) {
  const mask = Number(days) & 0x7f;
  return !!(mask & (1 << dayIndexMon0(date.getDay())));
}

function isDayActiveWall(days, wall) {
  const mask = Number(days) & 0x7f;
  return !!(mask & (1 << dayIndexMon0(wall.jsDay)));
}

function shiftWallDate(wall, days) {
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: wall.hour,
    minute: wall.minute,
    second: wall.second,
    jsDay: shifted.getUTCDay()
  };
}

function isInsideWindowWall(d, wall) {
  if (!d.config || !d.config.days) return false;
  const startSec = hhmmToSeconds(d.config.start);
  const endSec   = hhmmToSeconds(d.config.end);
  const endLimitSec = endSec + 60;
  const curSec   = wall.hour * 3600 + wall.minute * 60 + wall.second;
  const wraps    = startSec >= endSec;

  if (!wraps) {
    return isDayActiveWall(d.config.days, wall) && curSec >= startSec && curSec < endLimitSec;
  }
  const prev = shiftWallDate(wall, -1);
  return (
    (isDayActiveWall(d.config.days, wall) && curSec >= startSec) ||
    (isDayActiveWall(d.config.days, prev) && curSec < endLimitSec)
  );
}

function isInsideWindow(d, date) {
  return isInsideWindowWall(d, deviceWallParts(date, d && d.tz));
}

// Device schedules are aligned to midnight; scan minute slots for the next valid one.
function nextScheduledSlotAfter(d, from) {
  if (!d.config || !d.config.interval) return null;
  const intervalMs = d.config.interval * 1000;
  const startMs = Math.floor(from.getTime() / 60000) * 60000 + 60000;

  for (let i = 0; i < 8 * 24 * 60; i++) {
    const candidate = new Date(startMs + i * 60000);
    const wall = deviceWallParts(candidate, d.tz);
    const elapsedMs = ((wall.hour * 3600) + (wall.minute * 60) + wall.second) * 1000;
    if (elapsedMs % intervalMs !== 0) continue;
    if (isInsideWindowWall(d, wall)) return candidate;
  }
  return null;
}

function nextScheduledConnection(d, from = new Date()) {
  const lastComm = parseTS(d.lastCommDevice);
  if (lastComm && !isNaN(lastComm) && d.config && d.config.interval) {
    const expected = nextScheduledSlotAfter(d, lastComm);
    const keepExpectedUntil = new Date(lastComm.getTime() + (d.config.interval + GRACE_SECONDS) * 1000);
    if (expected && from <= keepExpectedUntil) return expected;
  }

  return nextScheduledSlotAfter(d, from);
}

// Health and status logic
function statusLevel(dev) {
  const now = new Date();

  if (!isInsideWindow(dev, now)) {
    return "idle";
  }

  // Brand-new devices can be inside schedule before their first report.
  if (!dev.lastCommDevice || !dev.config || !dev.config.interval) return "idle";

  const lastComm = parseTS(dev.lastCommDevice);
  if (!lastComm || isNaN(lastComm)) return "idle";

  const ageSec     = (now.getTime() - lastComm.getTime()) / 1000;
  const intervalSec = dev.config.interval;

  if (ageSec <= intervalSec + GRACE_SECONDS) {
    return "ok";
  }

  if (ageSec < (2 * intervalSec) + GRACE_SECONDS) return "warn";

  return "error";
}

function status(dev, id) {
  const level = statusLevel(dev);
  if (level === "idle" || level === "ok") {
    notified[id] = false;
    return level;
  }

  if (level === "warn") return level;

  if (!notified[id]) {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Device " + id + " communication lost");
    }
    notified[id] = true;
  }
  return "error";
}

function isRecentError(d) {
  if (!d.lastErrorTime || d.lastError === "None") return false;
  const err = parseTS(d.lastErrorTime);
  if (!err || isNaN(err)) return false;
  if (!d.lastShotOk || d.lastShotOk === "-") return true;
  const shot = parseTS(d.lastShotOk);
  if (!shot || isNaN(shot)) return true;
  return err.getTime() > shot.getTime();
}

function runtimeErrorLevel(d, errorText) {
  const text = String(errorText || "");
  const uploadRelated =
    text === "Upload failed" ||
    text === "Dropbox image link unavailable" ||
    text === "Dropbox account full" ||
    text === "Unable to retrieve image from camera";
  if (uploadRelated && Number(d && d.config && d.config.uploadMode) === 1) {
    return "warn";
  }
  return "error";
}

// Communication delay/loss wins the banner because it is the freshest sign that
// the board is no longer reporting. Camera/media issues remain visible as
// secondary context when they are not the main active problem.
function effectiveErrorInfo(d, id, statusLevel) {
  let commAlert = null;
  if (statusLevel === "warn" && d.lastCommDevice && d.config && d.config.interval) {
    const lastComm = parseTS(d.lastCommDevice);
    if (lastComm && !isNaN(lastComm)) {
      commAlert = {
        text:  "COMM DELAY",
        time:  new Date(lastComm.getTime() + (d.config.interval + GRACE_SECONDS) * 1000),
        level: "warn",
        glow:  false
      };
    }
  } else if (statusLevel === "error" && d.lastCommDevice && d.config && d.config.interval) {
    const lastComm = parseTS(d.lastCommDevice);
    if (lastComm && !isNaN(lastComm)) {
      commAlert = {
        text:  "COMM LOST",
        time:  new Date(lastComm.getTime() + ((2 * d.config.interval) + GRACE_SECONDS) * 1000),
        level: "error",
        glow:  true
      };
    }
  }

  const standingIssue = d.healthSticky && d.healthText && d.healthText !== "None"
    ? {
        text:  d.healthText,
        time:  d.healthTime,
        level: d.healthLevel === "error" ? "error" : "warn"
      }
    : (d.issueCode && d.issueCode !== "None")
      ? {
          text:  d.issueCode,
          time:  d.issueTime,
          level: "warn"
        }
      : null;

  const hasJsonError    = !!(d.lastError && d.lastError !== "None");
  const recentJsonError = hasJsonError && isRecentError(d);
  const recentJsonLevel = runtimeErrorLevel(d, d.lastError);
  const secondaryJsonError = recentJsonError ? d.lastError : null;
  const secondaryJsonErrorTime = recentJsonError ? d.lastErrorTime : null;

  if (commAlert) {
    return {
      hasError:      true,
      text:          commAlert.text,
      time:          commAlert.time,
      level:         commAlert.level,
      glow:          commAlert.glow,
      jsonError:     standingIssue ? standingIssue.text : secondaryJsonError,
      jsonErrorTime: standingIssue ? standingIssue.time : secondaryJsonErrorTime
    };
  }

  if (d.healthSticky && d.healthText && d.healthText !== "None") {
    return {
      hasError:      true,
      text:          d.healthText,
      time:          d.healthTime,
      level:         d.healthLevel === "error" ? "error" : "warn",
      glow:          false,
      jsonError:     null,
      jsonErrorTime: null
    };
  }

  if (d.issueCode && d.issueCode !== "None") {
    if (d.lastError === "Unable to retrieve image from camera" && isRecentError(d)) {
      const level = runtimeErrorLevel(d, d.lastError);
      return {
        hasError:      true,
        text:          d.lastError,
        time:          d.lastErrorTime,
        level,
        glow:          level === "error",
        jsonError:     null,
        jsonErrorTime: null
      };
    }

    return {
      hasError:      true,
      text:          d.issueCode,
      time:          d.issueTime,
      level:         "warn",
      glow:          false,
      jsonError:     null,
      jsonErrorTime: null
    };
  }

  if (recentJsonError) {
    return {
      hasError:      true,
      text:          d.lastError,
      time:          d.lastErrorTime,
      level:         recentJsonLevel,
      glow:          recentJsonLevel === "error",
      jsonError:     null,
      jsonErrorTime: null
    };
  }

  return {
    hasError:      hasJsonError,
    text:          hasJsonError ? d.lastError : "No errors",
    time:          hasJsonError ? d.lastErrorTime : "-",
    level:         hasJsonError ? (recentJsonError ? recentJsonLevel : "neutral") : "ok",
    glow:          recentJsonError && recentJsonLevel === "error",
    jsonError:     null,
    jsonErrorTime: null
  };
}

// Display mapping helpers
function lensName(id) {
  switch (id) {
    case 101: return "Wide";
    case 102: return "Linear";
    case 19:  return "Narrow";
    case 31:  return "Wide 27 MP";
    case 32:  return "Linear 27 MP";
    case 40:  return "Ultra Wide 13MP";
    case 44:  return "Ultra Linear 13MP";
    default:  return "Unknown";
  }
}

function photoOutputName(id) {
  switch (id) {
    case 0: return "Standard";
    case 1: return "RAW";
    case 2: return "HDR";
    case 3: return "SuperPhoto";
    default: return "Unknown";
  }
}

function goproModelName(code) {
  switch (code) {
    case 10: return "HERO10 Black";
    case 11: return "HERO11 Black";
    case 12: return "HERO12 Black";
    case 13: return "HERO13 Black";
    default: return "-";
  }
}

function goproModelImage(code) {
  switch (code) {
    case 10: return "img/hero10.png";
    case 11: return "img/hero11.png";
    case 12: return "img/hero12.png";
    case 13: return "img/hero13.png";
    default: return "";
  }
}

function wifiQualityLabel(q) {
  const v = Number(q ?? 0);
  if (v <= 0)  return "Offline";
  if (v >= 80) return "Excellent";
  if (v >= 60) return "Good";
  if (v >= 40) return "Fair";
  return "Weak";
}

function wifiQualityClass(q) {
  const v = Number(q ?? 0);
  if (v <= 0)  return "text-muted";
  if (v >= 60) return "text-default";
  if (v >= 40) return "text-warning";
  return "text-danger";
}

function batteryClass(pct) {
  if (pct == null || pct < 0) return "text-default";
  if (pct >= 40) return "text-default";
  if (pct >= 15) return "text-warning";
  return "text-danger";
}

function batteryLevelClass(pct) {
  if (pct == null || pct < 0) return "";
  if (pct >= 40) return "sd-ok";
  if (pct >= 15) return "sd-warn";
  return "sd-error";
}

function batteryIconClass(pct) {
  if (pct == null || pct < 0) return "fa-plug-circle-bolt";
  if (pct >= 90) return "fa-battery-full";
  if (pct >= 65) return "fa-battery-three-quarters";
  if (pct >= 40) return "fa-battery-half";
  if (pct >= 15) return "fa-battery-quarter";
  return "fa-battery-empty";
}

function batteryLabel(pct) {
  return (pct == null || pct < 0) ? "Not monitored" : `${pct}%`;
}

function wifiLevelClass(q) {
  const v = Number(q ?? 0);
  if (v >= 60) return "sd-ok";
  if (v >= 40) return "sd-warn";
  return "sd-error";
}

function failureTextClass(count) {
  return (count || 0) > 0 ? "text-danger" : "text-default";
}

function alertClass(err) {
  if (!err.hasError) return "";
  if (err.level === "error") return "alert-error";
  if (err.level === "warn") return "alert-warn";
  return "alert-neutral";
}

function sdLevelClass(d) {
  if (!hasSdTotal(d)) return "";
  const pct = sdUsagePercent(d);
  if (pct < 70) return "sd-ok";
  if (pct < 90) return "sd-warn";
  return "sd-error";
}

function dropboxLevelClass(d) {
  if (!hasDropboxTotal(d)) return "";
  const pct = dropboxUsagePercent(d);
  if (pct < 70) return "sd-ok";
  if (pct < 90) return "sd-warn";
  return "sd-error";
}

function renderDays(daysMask) {
  const mask = Number(daysMask) & 0x7f;
  const labels = ["M","T","W","T","F","S","S"];
  return labels.map((label, i) => {
    const active = !!(mask & (1 << i));
    return active
      ? `<span class="day-active">${label}</span>`
      : `<span class="day-inactive">${label}</span>`;
  }).join(" ");
}

// Panel interactions
function toggle(el) {
  const id = el.dataset.id;
  el.classList.toggle("open");
  openState[id] = el.classList.contains("open");
}

function setViewMode(mode) {
  const isExpanded = mode === "expanded";
  if (isExpanded === expandAll) return;
  expandAll = isExpanded;
  localStorage.setItem("expandAll", String(expandAll));
  updateViewToggleUI();
  Object.keys(devices).forEach(id => { openState[id] = expandAll; });
  render();
}
