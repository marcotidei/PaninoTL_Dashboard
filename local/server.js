#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const tls = require("tls");
const net = require("net");
const { WebSocketServer } = require("ws");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PANINOTL_LOCAL_PORT || process.env.PORT || 8787);
const HOST = process.env.PANINOTL_LOCAL_HOST || "127.0.0.1";
const DEFAULT_UPSTREAM = "mqtts://63f5450f2daa43c191b14e9602fcf094.s1.eu.hivemq.cloud:8883";
const UPSTREAM = process.env.PANINOTL_UPSTREAM_MQTT || DEFAULT_UPSTREAM;
const TOPIC_PREFIX = process.env.PANINOTL_TOPIC_PREFIX || "panino";

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

function parseUpstream(value) {
  const url = new URL(value);
  const secure = url.protocol === "mqtts:" || url.protocol === "ssl:" || url.protocol === "tls:";
  if (!secure && url.protocol !== "mqtt:" && url.protocol !== "tcp:") {
    throw new Error(`Unsupported upstream protocol: ${url.protocol}`);
  }
  return {
    host: url.hostname,
    port: Number(url.port || (secure ? 8883 : 1883)),
    secure
  };
}

function isInsideRoot(filePath) {
  const relative = path.relative(ROOT, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function localBrokerUrl(req) {
  const host = req.headers.host || `${HOST}:${PORT}`;
  return `ws://${host}/mqtt`;
}

function sendIndex(req, res) {
  const indexPath = path.join(ROOT, "index.html");
  let html = fs.readFileSync(indexPath, "utf8");
  const injected = [
    "<script>",
    `window.PANINOTL_DEFAULT_BROKER_URL = ${JSON.stringify(localBrokerUrl(req))};`,
    `window.PANINOTL_DEFAULT_TOPIC_PREFIX = ${JSON.stringify(TOPIC_PREFIX)};`,
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

  if (pathname === "/local-status") {
    res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
    res.end(JSON.stringify({
      ok: true,
      brokerUrl: localBrokerUrl(req),
      upstream: UPSTREAM,
      topicPrefix: TOPIC_PREFIX
    }));
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

function attachMqttBridge(server) {
  const upstream = parseUpstream(UPSTREAM);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (requestUrl.pathname !== "/mqtt") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
  });

  wss.on("connection", ws => {
    console.log("[local-mqtt-proxy] browser connected");
    const mqttSocket = upstream.secure
      ? tls.connect({ host: upstream.host, port: upstream.port, servername: upstream.host })
      : net.connect({ host: upstream.host, port: upstream.port });

    let upstreamReady = false;
    const pending = [];

    function closeBoth() {
      try { ws.close(); } catch {}
      try { mqttSocket.destroy(); } catch {}
    }

    mqttSocket.on("connect", () => {
      console.log(`[local-mqtt-proxy] upstream connected ${upstream.host}:${upstream.port}`);
      upstreamReady = true;
      while (pending.length) mqttSocket.write(pending.shift());
    });

    mqttSocket.on("data", data => {
      if (ws.readyState === 1) ws.send(data);
    });

    mqttSocket.on("error", err => {
      console.error("[local-mqtt-proxy] upstream error:", err.message);
      closeBoth();
    });

    mqttSocket.on("close", () => {
      console.log("[local-mqtt-proxy] upstream closed");
      closeBoth();
    });

    ws.on("message", data => {
      const packet = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (upstreamReady) mqttSocket.write(packet);
      else pending.push(packet);
    });

    ws.on("close", () => {
      console.log("[local-mqtt-proxy] browser disconnected");
      closeBoth();
    });
    ws.on("error", closeBoth);
  });
}

const server = http.createServer(sendStatic);
attachMqttBridge(server);

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
  console.log(`Local MQTT WebSocket:     ws://${HOST}:${PORT}/mqtt`);
  console.log(`Upstream MQTT bridge:     ${UPSTREAM}`);
});
