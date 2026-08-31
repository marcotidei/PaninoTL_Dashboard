// Customize these defaults for your broker and MQTT topic layout.
// A local server may set window.PANINOTL_DEFAULT_* before this file loads.
const HOSTED_BROKER_URL    = "wss://63f5450f2daa43c191b14e9602fcf094.s1.eu.hivemq.cloud:8884/mqtt";
const DEFAULT_BROKER_URL   = window.PANINOTL_DEFAULT_BROKER_URL || HOSTED_BROKER_URL;
const DEFAULT_TOPIC_PREFIX = window.PANINOTL_DEFAULT_TOPIC_PREFIX || "panino";
const DEFAULT_TOPIC_FILTER = `${DEFAULT_TOPIC_PREFIX}/+/state`;
const GRACE_SECONDS = 120;
const DASHBOARD_UPDATED_AT = "2026-08-29 22:21 EDT";

// Must stay in sync with ISSUE_* (PaninoTL/include/board_config.h).
const ISSUE_CODE_TEXT = [
  "None",
  "Camera not found",
  "Camera not connected",
  "Shooting failure",
  "Camera Wi-Fi on 5 GHz - set it to 2.4GHz on the camera to allow PaninoTL to get the image",
  "Camera media wedged - hold the GoPro power button for 20s, then retry; factory reset if it persists"
];

// Must stay in sync with LastErrorReason (PaninoTL/include/app_defs.h).
const LAST_ERR_TEXT = [
  "None",
  "Camera not found",
  "Connect failed",
  "Pairing failed",
  "BLE not ready",
  "Camera not ready",
  "Camera settings failed",
  "Pre-shot read failed",
  "Shutter failed",
  "Shot not confirmed",
  "Unable to retrieve image from camera",
  "Panino SD failed",
  "Upload failed",
  "Dropbox authorization not configured",
  "Dropbox image link unavailable",
  "Dropbox account full"
];

// Compact health-code registry.
const HEALTH_CODE_TEXT = {
  0:    "None",
  2001: "Camera not found",
  2002: "Connect failed",
  2003: "Pairing failed",
  2004: "BLE not ready",
  2005: "Camera not ready",
  2006: "Camera settings failed",
  3001: "Pre-shot read failed",
  3002: "Shutter failed",
  3003: "Shot not confirmed",
  3004: "Unable to retrieve image from camera",
  4001: "Panino SD failed",
  5001: "Upload failed",
  5002: "Dropbox authorization not configured",
  5003: "Dropbox image link unavailable",
  5004: "Dropbox account full",
  6001: "Camera Wi-Fi on 5 GHz - set it to 2.4GHz on the camera",
  6002: "Camera media wedged - hold the GoPro power button for 20s, then retry; factory reset if it persists",
  9001: "Shooting failure"
};

function decodeCode(table, code, missingValue = "Unknown") {
  if (typeof code === "number") return (table[code] !== undefined) ? table[code] : "Unknown";
  if (typeof code === "string" && code.trim() !== "") {
    const numeric = Number(code);
    if (!Number.isNaN(numeric)) return (table[numeric] !== undefined) ? table[numeric] : "Unknown";
    return code;
  }
  return missingValue;
}

function decodeHealthCode(code, missingValue = "Unknown") {
  if (typeof code === "number") return HEALTH_CODE_TEXT[code] || "Unknown";
  if (typeof code === "string" && code.trim() !== "") {
    const numeric = Number(code);
    if (!Number.isNaN(numeric)) return HEALTH_CODE_TEXT[numeric] || "Unknown";
    return code;
  }
  return missingValue;
}

function normalizeHealthSeverity(severity) {
  const n = Number(severity);
  if (n >= 3) return "error";
  if (n >= 2) return "warn";
  if (n >= 1) return "neutral";
  return "ok";
}
