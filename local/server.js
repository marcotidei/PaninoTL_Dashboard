#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const mqtt = require("mqtt");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PANINOTL_LOCAL_PORT || process.env.PORT || 8787);
const HOST = process.env.PANINOTL_LOCAL_HOST || "127.0.0.1";
const DEFAULT_UPSTREAM = "mqtts://63f5450f2daa43c191b14e9602fcf094.s1.eu.hivemq.cloud:8883";
const UPSTREAM = process.env.PANINOTL_UPSTREAM_MQTT || DEFAULT_UPSTREAM;
const TOPIC_PREFIX = process.env.PANINOTL_TOPIC_PREFIX || "panino";
const MQTT_CONNECT_TIMEOUT_MS = Number(process.env.PANINOTL_MQTT_CONNECT_TIMEOUT_MS || 10000);
const MQTT_RECONNECT_MS = Number(process.env.PANINOTL_MQTT_RECONNECT_MS || 5000);
const HTTP_POLL_MS = Number(process.env.PANINOTL_HTTP_POLL_MS || 1500);
const MAX_BODY_BYTES = 16 * 1024;
const MAX_EVENTS = 10000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".ico": "image/x-icon"
};

let mqttClient = null;
let mqttState = "disconnected";
let mqttError = "";
let mqttConfig = null;
let mqttSeq = 0;
let mqttEvents = [];
let manualDisconnect = false;

function normalizeTopicPrefix(prefix) {
  return String(prefix || "").trim().replace(/^\/+|\/+$/g, "");
}

function topicFilters(prefix) {
  return [
    `${prefix}/+/state`,
    `${prefix}/+/ack`,
    `${prefix}/+/cmd`
  ];
}

function hostPort(hostname, port) {
  const host = hostname.includes(":") ? `[${hostname}]` : hostname;
  return port ? `${host}:${port}` : host;
}

function upstreamFromBrowserUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return UPSTREAM;

  const url = new URL(raw);
  if (url.protocol === "http:" || url.protocol === "https:") return UPSTREAM;
  if (url.protocol === "mqtt:" || url.protocol === "mqtts:" || url.protocol === "tcp:" || url.protocol === "tls:") {
    return raw;
  }
  if (url.protocol === "wss:" || url.protocol === "ws:") {
    const secure = url.protocol === "wss:";
    const fallbackPort = secure ? "8883" : "1883";
    const port = url.port === "8884" ? "8883" : (url.port || fallbackPort);
    const protocol = secure ? "mqtts:" : "mqtt:";
    return `${protocol}//${hostPort(url.hostname, port)}`;
  }

  throw new Error(`Unsupported broker URL protocol: ${url.protocol}`);
}

function localApiUrl(req) {
  const host = req.headers.host || `${HOST}:${PORT}`;
  return `http://${host}/local-api`;
}

function mqttStatus() {
  return {
    state: mqttState,
    connected: !!(mqttClient && mqttClient.connected),
    error: mqttError,
    seq: mqttSeq,
    config: mqttConfig ? {
      upstream: mqttConfig.upstream,
      topicPrefix: mqttConfig.topicPrefix,
      username: mqttConfig.username
    } : null,
    pollMs: HTTP_POLL_MS
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": MIME[".json"],
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, res, callback) {
  let body = "";
  let tooLarge = false;

  req.setEncoding("utf8");
  req.on("data", chunk => {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      tooLarge = true;
      sendJson(res, 413, { ok: false, error: "Request body too large" });
      req.destroy();
    }
  });
  req.on("end", () => {
    if (tooLarge) return;
    if (!body.trim()) {
      callback(null, {});
      return;
    }
    try {
      callback(null, JSON.parse(body));
    } catch (err) {
      callback(err);
    }
  });
  req.on("error", err => {
    if (!tooLarge) callback(err);
  });
}

function resetMqttEvents() {
  mqttSeq = 0;
  mqttEvents = [];
}

function recordMqttEvent(topic, payload) {
  const entry = {
    seq: ++mqttSeq,
    topic,
    payload,
    receivedAt: new Date().toISOString()
  };
  mqttEvents.push(entry);
  if (mqttEvents.length > MAX_EVENTS) {
    mqttEvents.splice(0, mqttEvents.length - MAX_EVENTS);
  }
}

function disconnectUpstream() {
  manualDisconnect = true;
  if (mqttClient) {
    try { mqttClient.end(true); } catch {}
    mqttClient = null;
  }
  mqttState = "disconnected";
  mqttError = "";
  mqttConfig = null;
}

function connectUpstream(config) {
  const topicPrefix = normalizeTopicPrefix(config.topicPrefix) || TOPIC_PREFIX;
  const upstream = upstreamFromBrowserUrl(config.url || config.upstream);
  const username = String(config.username || "").trim();
  const password = String(config.password || "");

  if (!topicPrefix) throw new Error("Topic prefix is required");
  if (/[+#]/.test(topicPrefix)) throw new Error("Topic prefix cannot contain MQTT wildcards");
  if (!username) throw new Error("Username is required");

  disconnectUpstream();
  resetMqttEvents();

  mqttConfig = { upstream, topicPrefix, username };
  mqttState = "connecting";
  mqttError = "";
  manualDisconnect = false;

  const client = mqtt.connect(upstream, {
    username,
    password,
    clean: true,
    connectTimeout: MQTT_CONNECT_TIMEOUT_MS,
    reconnectPeriod: MQTT_RECONNECT_MS,
    keepalive: 30,
    resubscribe: true
  });
  mqttClient = client;

  client.on("connect", () => {
    if (mqttClient !== client) return;
    const filters = topicFilters(topicPrefix);
    console.log("[local-mqtt-http] upstream connected");
    client.subscribe(filters, err => {
      if (mqttClient !== client) return;
      if (err) {
        mqttState = "error";
        mqttError = err.message;
        console.error("[local-mqtt-http] subscribe failed:", err.message);
        return;
      }
      mqttState = "connected";
      mqttError = "";
      console.log("[local-mqtt-http] subscribed", filters.join(", "));
    });
  });

  client.on("reconnect", () => {
    if (mqttClient !== client) return;
    mqttState = "reconnecting";
  });

  client.on("close", () => {
    if (mqttClient !== client) return;
    mqttState = manualDisconnect ? "disconnected" : "reconnecting";
  });

  client.on("offline", () => {
    if (mqttClient !== client) return;
    mqttState = manualDisconnect ? "disconnected" : "reconnecting";
  });

  client.on("error", err => {
    if (mqttClient !== client) return;
    mqttState = "error";
    mqttError = err.message;
    console.error("[local-mqtt-http] upstream error:", err.message);
  });

  client.on("message", (topic, message) => {
    if (mqttClient !== client) return;
    recordMqttEvent(topic, message.toString());
  });
}

function publishUpstream(message, callback) {
  if (!mqttClient || !mqttClient.connected) {
    callback(new Error("Local MQTT bridge is not connected"));
    return;
  }

  const topic = String(message.topic || "");
  if (!topic) {
    callback(new Error("Topic is required"));
    return;
  }

  mqttClient.publish(topic, String(message.payload || ""), {
    qos: 0,
    retain: !!message.retain
  }, callback);
}

function handleLocalApi(req, res, pathname, requestUrl) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return true;
  }

  if (pathname === "/local-api/status" && req.method === "GET") {
    sendJson(res, 200, { ok: true, ...mqttStatus() });
    return true;
  }

  if (pathname === "/local-api/events" && req.method === "GET") {
    const since = Number(requestUrl.searchParams.get("since") || 0);
    const messages = mqttEvents.filter(entry => entry.seq > since);
    sendJson(res, 200, { ok: true, ...mqttStatus(), messages });
    return true;
  }

  if (pathname === "/local-api/connect" && req.method === "POST") {
    readJsonBody(req, res, (err, body) => {
      if (err) {
        sendJson(res, 400, { ok: false, error: err.message });
        return;
      }
      try {
        connectUpstream(body);
        sendJson(res, 200, { ok: true, ...mqttStatus() });
      } catch (connectErr) {
        mqttState = "error";
        mqttError = connectErr.message;
        sendJson(res, 400, { ok: false, ...mqttStatus() });
      }
    });
    return true;
  }

  if (pathname === "/local-api/disconnect" && req.method === "POST") {
    disconnectUpstream();
    sendJson(res, 200, { ok: true, ...mqttStatus() });
    return true;
  }

  if (pathname === "/local-api/publish" && req.method === "POST") {
    readJsonBody(req, res, (err, body) => {
      if (err) {
        sendJson(res, 400, { ok: false, error: err.message });
        return;
      }
      publishUpstream(body, publishErr => {
        if (publishErr) {
          sendJson(res, 503, { ok: false, ...mqttStatus(), error: publishErr.message });
          return;
        }
        sendJson(res, 200, { ok: true, ...mqttStatus() });
      });
    });
    return true;
  }

  return false;
}

function isInsideRoot(filePath) {
  const relative = path.relative(ROOT, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sendIndex(req, res) {
  const indexPath = path.join(ROOT, "index.html");
  let html = fs.readFileSync(indexPath, "utf8");
  const injected = [
    "<script>",
    `window.PANINOTL_DEFAULT_BROKER_URL = ${JSON.stringify(localApiUrl(req))};`,
    `window.PANINOTL_DEFAULT_TOPIC_PREFIX = ${JSON.stringify(TOPIC_PREFIX)};`,
    `window.PANINOTL_LOCAL_HTTP_API = ${JSON.stringify("/local-api")};`,
    "window.PANINOTL_LOCAL_PROXY = true;",
    "</script>"
  ].join("");

  html = html
    .replace("https://unpkg.com/mqtt/dist/mqtt.min.js", "/vendor/mqtt.min.js")
    .replace("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css", "/vendor/fontawesome/css/all.min.css");

  res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
  res.end(html.replace("</head>", `  ${injected}\n</head>`));
}

function sendVendor(req, res, pathname) {
  let filePath = null;
  if (pathname === "/vendor/mqtt.min.js") {
    filePath = path.join(ROOT, "node_modules", "mqtt", "dist", "mqtt.min.js");
  } else if (pathname === "/vendor/fontawesome/css/all.min.css") {
    filePath = path.join(ROOT, "node_modules", "@fortawesome", "fontawesome-free", "css", "all.min.css");
  } else if (pathname.startsWith("/vendor/fontawesome/webfonts/")) {
    const name = path.basename(pathname);
    filePath = path.join(ROOT, "node_modules", "@fortawesome", "fontawesome-free", "webfonts", name);
  }

  if (!filePath) return false;

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Run ./install-local.sh first");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
  return true;
}

function sendStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const decoded = decodeURIComponent(requestUrl.pathname);
  const pathname = decoded === "/" ? "/index.html" : decoded;

  if (pathname.startsWith("/local-api/") && handleLocalApi(req, res, pathname, requestUrl)) {
    return;
  }

  if (pathname === "/local-status") {
    sendJson(res, 200, {
      ok: true,
      browserTransport: "http-poll",
      localApiUrl: localApiUrl(req),
      upstream: UPSTREAM,
      topicPrefix: TOPIC_PREFIX,
      mqtt: mqttStatus()
    });
    return;
  }

  if (sendVendor(req, res, pathname)) return;

  if (pathname === "/index.html") {
    sendIndex(req, res);
    return;
  }

  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!isInsideRoot(filePath)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500);
      res.end(err.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(sendStatic);

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Try PANINOTL_LOCAL_PORT=8788 npm run local`);
  } else if (err.code === "EPERM") {
    console.error(`Cannot listen on ${HOST}:${PORT}. Check local firewall, endpoint security, or try another port.`);
  } else {
    console.error("Local dashboard server failed:", err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`PaninoTL local dashboard: http://${HOST}:${PORT}`);
  console.log(`Browser transport:        HTTP polling at /local-api/events`);
  console.log(`Upstream MQTT bridge:     ${UPSTREAM}`);
});
