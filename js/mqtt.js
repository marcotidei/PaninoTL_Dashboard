function normalizeTopicPrefix(prefix) {
  return String(prefix || "").trim().replace(/^\/+|\/+$/g, "");
}

function withConfigDefaults(config) {
  config = config || {};
  return {
    ...config,
    url: config.url || DEFAULT_BROKER_URL,
    topicPrefix: normalizeTopicPrefix(config.topicPrefix) || DEFAULT_TOPIC_PREFIX
  };
}

function topicPrefix(config = currentConfig) {
  return normalizeTopicPrefix(config && config.topicPrefix) || DEFAULT_TOPIC_PREFIX;
}

function topicFilter(config = currentConfig) {
  const prefix = topicPrefix(config);
  return prefix === DEFAULT_TOPIC_PREFIX ? DEFAULT_TOPIC_FILTER : `${prefix}/+/state`;
}

function ackTopicFilter(config = currentConfig) {
  return `${topicPrefix(config)}/+/ack`;
}

function commandTopicFilter(config = currentConfig) {
  return `${topicPrefix(config)}/+/cmd`;
}

function stateTopic(id, config = currentConfig) {
  return `${topicPrefix(config)}/${id}/state`;
}

function commandTopic(id, config = currentConfig) {
  return `${topicPrefix(config)}/${id}/cmd`;
}

function deviceIdFromTopic(topic, config = currentConfig, end = "/state") {
  const prefix = topicPrefix(config);
  const start  = `${prefix}/`;
  if (!topic.startsWith(start) || !topic.endsWith(end)) return null;

  const id = topic.slice(start.length, -end.length);
  return id && !id.includes("/") ? id : null;
}

// Config and broker credentials
async function loadConfig() {
  const saved = localStorage.getItem("mqtt_config");
  if (saved) {
    try { return withConfigDefaults(JSON.parse(saved)); } catch { localStorage.removeItem("mqtt_config"); }
  }
  return withConfigDefaults({});
}

function openConfigModal(prefill, forcePrefill = false) {
  prefill = withConfigDefaults(prefill || {});
  const modal = document.getElementById("configModal");
  if (modal.classList.contains("is-visible") && !forcePrefill) return;

  document.getElementById("cfg_url").value = prefill.url || DEFAULT_BROKER_URL;
  document.getElementById("cfg_topic_prefix").value = prefill.topicPrefix || DEFAULT_TOPIC_PREFIX;
  if (Object.prototype.hasOwnProperty.call(prefill, "username")) {
    document.getElementById("cfg_user").value = prefill.username || "";
  }
  if (Object.prototype.hasOwnProperty.call(prefill, "password")) {
    document.getElementById("cfg_pass").value = prefill.password || "";
  }
  modal.classList.add("is-visible");
}

function loginRequired() {
  return connectionState === "disconnected" || connectionState === "error";
}

function closeConfigModal(force = false) {
  // Keep login visible when credentials are required.
  if (!force && loginRequired()) return;
  document.getElementById("configModal").classList.remove("is-visible");
}

function setConfigError(message) {
  connectionErrorMessage = message || "";
  const errorEl = document.getElementById("cfg_error");
  if (!errorEl) return;
  errorEl.textContent = connectionErrorMessage;
  errorEl.hidden = !connectionErrorMessage;
}

function friendlyMqttError(err) {
  const text = String((err && (err.message || err.code)) || err || "").trim();
  const lower = text.toLowerCase();

  if (lower.includes("bad username") ||
      lower.includes("not authorized") ||
      lower.includes("not authorised") ||
      lower.includes("identifier rejected") ||
      lower.includes("connection refused: bad user name or password") ||
      (lower.includes("connack") && lower.includes("5"))) {
    return "The MQTT broker rejected the username or password. Check both credentials and try Connect again.";
  }

  if (lower.includes("certificate") || lower.includes("tls") || lower.includes("ssl")) {
    return "The secure broker connection failed. Check that the Broker URL uses the correct secure WebSocket address.";
  }

  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "The dashboard could not reach the MQTT broker before the timeout. Check the Broker URL and network.";
  }

  if (lower.includes("websocket") || lower.includes("web socket")) {
    return "The browser could not open the MQTT WebSocket connection. Check the Broker URL and whether this network blocks WebSockets.";
  }

  if (text) return `MQTT connection failed: ${text}`;
  return "MQTT connection failed. Check the Broker URL, topic prefix, username, and password.";
}

function saveConfig(event) {
  if (event) event.preventDefault();
  primeAudioFromGesture();
  setConfigError("");

  const config = {
    url:      document.getElementById("cfg_url").value.trim(),
    topicPrefix: normalizeTopicPrefix(document.getElementById("cfg_topic_prefix").value),
    username: document.getElementById("cfg_user").value.trim(),
    password: document.getElementById("cfg_pass").value
  };
  if (!config.url || !config.topicPrefix || !config.username) {
    setConfigError("Please enter broker URL, topic prefix, and username.");
    return;
  }
  if (/[+#]/.test(config.topicPrefix)) {
    setConfigError("Topic prefix cannot contain MQTT wildcards (+ or #).");
    return;
  }
  localStorage.setItem("mqtt_config", JSON.stringify(config));
  connectMQTT(config);
  closeConfigModal(true);
}

// MQTT connection
function setConnStatus(state) {
  connectionState = state;

  const icon  = document.getElementById("connIcon");
  const btn   = document.getElementById("connectionBtn");

  const map = {
    disconnected: { icon: "fa-link-slash", className: "conn-disconnected", title: "Connect to broker" },
    connecting:   { icon: "fa-link",       className: "conn-connecting",   title: "Connecting to broker" },
    reconnecting: { icon: "fa-link",       className: "conn-connecting",   title: "Reconnecting to broker" },
    connected:    { icon: "fa-link",       className: "conn-connected",    title: "Forget credentials and reconnect" },
    error:        { icon: "fa-link-slash", className: "conn-error",        title: connectionErrorMessage || "Reconnect to broker" },
  };

  const s = map[state] || map.disconnected;
  icon.className = `fa-solid ${s.icon}`;
  btn.className = `connection-btn ${s.className}`;
  btn.title = s.title;
  btn.setAttribute("aria-label", s.title);

  if (loginRequired()) {
    openConfigModal(currentConfig || { url: DEFAULT_BROKER_URL });
    if (state === "error" && connectionErrorMessage) setConfigError(connectionErrorMessage);
  } else if (state === "connected") {
    setConfigError("");
    closeConfigModal(true);
  }

  if (typeof renderDeviceCommandPreview === "function") {
    renderDeviceCommandPreview();
  }
}

function endActiveClient() {
  if (!client) return;
  const active = client;
  client = null;
  active.end(true);
}

function disconnectMQTT() {
  manualDisconnect = true;
  setConfigError("");
  endActiveClient();
  clearDashboardState();
  currentConfig = null;
  setConnStatus("disconnected");
  render();
}

function publishDeviceCommand(id, command) {
  if (!client || !client.connected) {
    throw new Error("Dashboard is not connected to MQTT");
  }
  if (!id || !command) {
    throw new Error("Missing command");
  }
  const topic = commandTopic(id);
  const payload = JSON.stringify(command);
  client.publish(topic, payload, { qos: 0, retain: true });
  pendingCommands[id] = {
    id: command.id,
    type: command.type,
    sentAt: new Date().toISOString(),
    command
  };
  render();
  console.log("📤 Published command", topic, command);
}

function validDeviceCommand(command) {
  if (!command || command.schema !== 1 || !command.id) return false;
  if (command.type === "set") return !!command.config && typeof command.config === "object";
  if (command.type === "action") return !!command.action;
  if (command.type === "batch") {
    return Array.isArray(command.commands) && command.commands.length > 0 && command.commands.every(op => (
      op && (
        (op.type === "set" && op.config && typeof op.config === "object") ||
        (op.type === "action" && !!op.action)
      )
    ));
  }
  return false;
}

function setPendingDeviceCommand(id, command, receivedAt = new Date().toISOString()) {
  pendingCommands[id] = {
    id: command.id,
    type: command.type,
    sentAt: receivedAt,
    command
  };
}

function commandConfigHas(config, key) {
  return !!config && Object.prototype.hasOwnProperty.call(config, key);
}

function commandSettingsConfig(command) {
  command = command && command.command ? command.command : command;
  if (!command) return null;
  if (command.type === "set") return command.config || null;
  if (command.type === "batch" && Array.isArray(command.commands)) {
    const op = command.commands.find(item => item && item.type === "set" && item.config);
    return op ? op.config : null;
  }
  return null;
}

function uploadModeFromCommandConfig(config, currentMode) {
  const enabled = commandConfigHas(config, "dropboxUploadEnabled")
    ? !!config.dropboxUploadEnabled
    : Number(currentMode) > 0;
  const mode = commandConfigHas(config, "dropboxUploadMode")
    ? Number(config.dropboxUploadMode)
    : (Number(currentMode) === 2 ? 1 : 0);
  return enabled ? (mode === 1 ? 2 : 1) : 0;
}

function applyAcceptedSettingsCommand(id, pending) {
  const command = pending && pending.command;
  const config = commandSettingsConfig(command);
  if (!command || !config) return;
  const d = devices[id];
  if (!d || !d.config) return;

  const next = { ...d.config };

  if (commandConfigHas(config, "intervalSec")) {
    const value = Number(config.intervalSec);
    if (Number.isFinite(value)) next.interval = value;
  }
  if (commandConfigHas(config, "scheduleDays")) next.days = scheduleDaysMaskFromValue(config.scheduleDays);
  if (commandConfigHas(config, "scheduleStart")) next.start = String(config.scheduleStart);
  if (commandConfigHas(config, "scheduleEnd")) next.end = String(config.scheduleEnd);
  if (commandConfigHas(config, "photoLens")) {
    const value = Number(config.photoLens);
    if (Number.isFinite(value)) next.lens = value;
  }
  if (commandConfigHas(config, "photoOutput")) {
    const value = Number(config.photoOutput);
    if (Number.isFinite(value)) next.output = value;
  }
  if (commandConfigHas(config, "powerMode")) {
    const value = Number(config.powerMode);
    if (Number.isFinite(value)) next.powerMode = value;
  }
  if (commandConfigHas(config, "batteryMonitorEnabled")) {
    next.batteryMonitorEnabled = config.batteryMonitorEnabled ? 1 : 0;
  }
  if (commandConfigHas(config, "sdLogEnabled")) {
    next.sdLogEnabled = config.sdLogEnabled ? 1 : 0;
  }
  if (commandConfigHas(config, "maxSleepSec")) {
    const value = Number(config.maxSleepSec);
    if (Number.isFinite(value)) next.maxSleepSec = value;
  }
  if (commandConfigHas(config, "ntpSyncMode")) {
    const value = Number(config.ntpSyncMode);
    if (Number.isFinite(value)) next.ntpSyncMode = value;
  }
  if (commandConfigHas(config, "dropboxUploadEnabled") || commandConfigHas(config, "dropboxUploadMode")) {
    next.uploadMode = uploadModeFromCommandConfig(config, next.uploadMode);
    if (Number(next.uploadMode) !== 2) next.ensureFullResUpload = 0;
  }
  if (commandConfigHas(config, "dropboxEnsureFullResUpload")) {
    next.ensureFullResUpload = config.dropboxEnsureFullResUpload ? 1 : 0;
    if (Number(next.uploadMode) !== 2) next.ensureFullResUpload = 0;
  }
  if (commandConfigHas(config, "dropboxBackfillMaxAfterSchedule")) {
    const value = Number(config.dropboxBackfillMaxAfterSchedule);
    if (Number.isFinite(value)) next.backfillMaxAfterSchedule = value;
  }
  if (commandConfigHas(config, "uploadTimeoutMin")) {
    const value = Number(config.uploadTimeoutMin);
    if (Number.isFinite(value)) next.uploadTimeout = value;
  }

  d.config = next;
}

function clearRetainedDeviceCommand(id) {
  if (!client || !client.connected || !id) return;
  client.publish(commandTopic(id), "", { qos: 0, retain: true });
  console.log("🧹 Cleared retained command", commandTopic(id));
}

function abortPendingDeviceCommand(id) {
  if (!client || !client.connected) {
    throw new Error("Dashboard is not connected to MQTT");
  }
  if (!id || !pendingCommands[id]) {
    throw new Error("No pending command to abort");
  }
  clearRetainedDeviceCommand(id);
  delete pendingCommands[id];
  render();
}

function handleRetainedDeviceCommand(id, rawCommand) {
  if (!rawCommand) {
    delete pendingCommands[id];
    render();
    return;
  }

  const command = JSON.parse(rawCommand);
  if (!validDeviceCommand(command)) {
    console.warn("Ignoring invalid retained command", id, command);
    return;
  }

  const ack = devices[id] && devices[id].commandAck;
  if (ack && ack.id === command.id) {
    if (ack.applied === true) {
      applyAcceptedSettingsCommand(id, { command });
    }
    delete pendingCommands[id];
    clearRetainedDeviceCommand(id);
    render();
    return;
  }

  setPendingDeviceCommand(id, command);
  render();
}

function handleConnectionClick() {
  primeAudioFromGesture();
  const brokerUrl = (currentConfig && currentConfig.url) || DEFAULT_BROKER_URL;
  const prefix = topicPrefix(currentConfig);
  localStorage.removeItem("mqtt_config");
  disconnectMQTT();
  openConfigModal({ url: brokerUrl, topicPrefix: prefix, username: "", password: "" }, true);
}

function mqttMessageToString(message) {
  if (message == null) return "";
  return (typeof message === "string") ? message : message.toString();
}

function handleMqttMessage(topic, message, config = currentConfig) {
  try {
    const ackId = deviceIdFromTopic(topic, config, "/ack");
    if (ackId) {
      const rawAck = mqttMessageToString(message);
      if (!rawAck) {
        delete pendingCommands[ackId];
        render();
        return;
      }
      const ack = JSON.parse(rawAck);
      const pending = pendingCommands[ackId];
      if (pending && ack.id === pending.id) {
        if (ack.applied === true) applyAcceptedSettingsCommand(ackId, pending);
        delete pendingCommands[ackId];
        clearRetainedDeviceCommand(ackId);
      }
      devices[ackId] = {
        ...(devices[ackId] || { id: ackId }),
        commandAck: ack
      };
      render();
      return;
    }

    const commandId = deviceIdFromTopic(topic, config, "/cmd");
    if (commandId) {
      handleRetainedDeviceCommand(commandId, mqttMessageToString(message));
      return;
    }

    const id = deviceIdFromTopic(topic, config);
    if (!id) return;

    // Empty retained payloads mean the broker cleared the device state.
    const raw = mqttMessageToString(message);
    if (!raw) return;

    const data = JSON.parse(raw);
    const s    = data.s || {};
    const h    = data.h || null;
    const c    = data.c || {};
    const g    = data.g || {};
    const f    = data.f || {};

    const prev = devices[id] || {};
    rememberDeviceOrder(id);
    const packetHasImageUrl = Object.prototype.hasOwnProperty.call(s, "img");
    const imageUrl = packetHasImageUrl ? (s.img || "") : (prev.imageUrl || "");
    const packetHasLogUrl = Object.prototype.hasOwnProperty.call(s, "log");
    const logUrl = packetHasLogUrl ? (s.log || "") : (prev.logUrl || "");
    const imageLinkReceived = !!(packetHasImageUrl && s.img);
    const lastUploadOk = s.up || prev.lastUploadOk || "";
    const imageRevision = imageUrl ? [imageUrl, lastUploadOk || s.ok || prev.lastShotOk || ""].join("|") : "";
    const imageRevisionChanged = imageLinkReceived && imageRevision && imageRevision !== prev.imageRevision;
    const imagePacketSeq = imageRevisionChanged
      ? ((prev.imagePacketSeq || 0) + 1)
      : (prev.imagePacketSeq || 0);
    const photosSuccessful = (typeof s.pc === "number") ? s.pc : 0;
    const confirmedPhotosIncreased = photoSoundPrimed[id]
      && typeof prev.photosSuccessful === "number"
      && photosSuccessful > prev.photosSuccessful;
    const photosFailed = (typeof s.pf === "number") ? s.pf : 0;
    const lastCaptureFail = s.cf;
    const hasHealth = !!(h && Object.prototype.hasOwnProperty.call(h, "c"));
    const healthCode = hasHealth ? Number(h.c) : null;
    const healthText = hasHealth ? decodeHealthCode(h.c, "None") : null;
    const healthLevel = hasHealth ? normalizeHealthSeverity(h.s) : null;
    const healthTime = hasHealth && h.t && h.t !== "-" ? h.t : null;
    const healthSticky = hasHealth && Number(h.k) === 1;
    const currentLastError = decodeCode(LAST_ERR_TEXT, s.err, "None");
    const currentLastErrorTime = s.et;
    const currentIssueCode = Object.prototype.hasOwnProperty.call(s, "iss")
                            ? decodeCode(ISSUE_CODE_TEXT, s.iss, "None")
                            : null;
    const issueTime = s.it && s.it !== "-" ? s.it : null;
    const lastError = hasHealth && !healthSticky ? healthText : currentLastError;
    const lastErrorTime = hasHealth && !healthSticky ? healthTime : currentLastErrorTime;
    const issueCode = hasHealth && healthSticky ? healthText : currentIssueCode;
    const failedPhotosIncreased = errorSoundState[id]
      && typeof prev.photosFailed === "number"
      && photosFailed > prev.photosFailed;
    const newDeviceError = errorSoundState[id]
      && lastError !== "None"
      && (
        lastError !== prev.lastError
        || String(lastErrorTime || "") !== String(prev.lastErrorTime || "")
        || String(lastCaptureFail || "") !== String(prev.lastCaptureFail || "")
      );
    const newStandingIssue = errorSoundState[id]
      && issueCode
      && issueCode !== "None"
      && issueCode !== prev.issueCode;

    devices[id] = {
      id,
      batteryPct:    (typeof s.b  === "number") ? s.b : -1,
      rtcTempC:      (typeof s.rt === "number") ? s.rt : null,
      wifiQuality:   (typeof s.wq === "number") ? s.wq : 0,
      photosSuccessful,
      sdPhotoCount:     (typeof s.sdpc === "number") ? s.sdpc : 0,
      pendingFullResUploads: (typeof s.pu === "number") ? s.pu : 0,
      photosFailed,
      sdTotalMB:     (typeof s.st === "number") ? s.st : 0,
      sdFreeMB:      (typeof s.sf === "number") ? s.sf : 0,
      goproSdWriteIssues: (typeof s.sdw === "number") ? s.sdw : 0,
      goproSdWriteIssuesValid: Number(s.sdwv || 0) === 1,
      paninoSdFault: Number(s.psdf || 0) === 1,
      paninoSdFaultTime: s.psdt || "",
      dropboxTotalMB: (typeof s.dbxt === "number") ? s.dbxt : 0,
      dropboxFreeMB:  (typeof s.dbxf === "number") ? s.dbxf : 0,
      lastShotOk:    s.ok,
      lastUploadOk,
      lastCaptureFail,
      lastError,
      lastErrorTime,
      healthCode,
      healthText,
      healthLevel,
      healthTime,
      healthSticky,
      // A standing condition needing user action; unlike lastError, this is not
      // tied to a specific failed shot and does not clear because a later shot succeeded.
      issueCode,
      issueTime,
      // Dropbox share link the device resolved for its own last_capture.jpg.
      // Some packets may omit it; keep the last known link, but only reload
      // the image when this packet actually carries a non-empty image link.
      imageUrl,
      logUrl,
      imageRevision,
      imagePacketSeq,
      config: {
        interval: c.i,
        days:     scheduleDaysMaskFromValue(c.d),
        start:    c.s,
        end:      c.e,
        lens:     c.l,
        output:   c.o,
        powerMode: c.p ?? 0,
        batteryMonitorEnabled: c.bm ?? 1,
        sdLogEnabled: c.sdl ?? 0,
        maxSleepSec: c.k ?? 3600,
        ntpSyncMode: c.ntp ?? 0,
        // Tri-state: 0=Disabled, 1=Thumbnail, 2=Full Res.
        uploadMode: c.u,
        ensureFullResUpload: c.efu ?? 0,
        backfillMaxAfterSchedule: c.bfm ?? 3,
        uploadTimeout: c.uto
      },
      gopro:         g,
      firmware:      f,
      commandAck:    prev.commandAck || null,
      lastCommDevice: s.t,
      // IANA zone name used for the device-time display mode.
      tz:            s.tz || ""
    };

    if (imageRevisionChanged) {
      scheduleAutoImageRefresh(id);
    }
    if (confirmedPhotosIncreased) playImageSuccessSound();
    photoSoundPrimed[id] = true;
    if (failedPhotosIncreased || newDeviceError || newStandingIssue) playErrorSound();
    errorSoundState[id] = true;
    notified[id] = false;
  } catch (e) {
    console.error("MQTT parse error:", e);
  }
}

function connectMQTT(config) {
  config = withConfigDefaults(config);
  currentConfig = config;
  manualDisconnect = false;

  clearDashboardState();
  render();
  if (typeof loadLocalFakeCameras === "function") loadLocalFakeCameras(config);

  endActiveClient();
  setConfigError("");
  setConnStatus("connecting");

  const newClient = mqtt.connect(config.url, {
    username: config.username,
    password: config.password,
    clean: true,
    connectTimeout: 10000,
    reconnectPeriod: 5000,
    keepalive: 30,
    resubscribe: true
  });
  client = newClient;

  newClient.on("connect", () => {
    if (client !== newClient) return;
    console.log("✅ Connected");
    const filters = [topicFilter(config), ackTopicFilter(config), commandTopicFilter(config)];
    newClient.subscribe(filters, (err) => {
      if (client !== newClient) return;
      if (err) {
        console.error("MQTT subscribe failed:", filters, err);
        setConfigError(friendlyMqttError(err));
        setConnStatus("error");
        return;
      }
      console.log("✅ Subscribed", filters.join(", "));
      setConnStatus("connected");
    });
  });

  newClient.on("reconnect", () => {
    if (client !== newClient) return;
    if (connectionErrorMessage) return;
    setConnStatus("reconnecting");
  });

  newClient.on("close", () => {
    if (client !== newClient) return;
    if (!manualDisconnect && connectionErrorMessage) {
      setConnStatus("error");
      return;
    }
    setConnStatus(manualDisconnect ? "disconnected" : "reconnecting");
  });

  newClient.on("error", (err) => {
    if (client !== newClient) return;
    console.error("MQTT error:", err);
    setConfigError(friendlyMqttError(err));
    setConnStatus("error");
  });

  newClient.on("message", (topic, message) => {
    if (client !== newClient) return;
    handleMqttMessage(topic, message, config);
  });
}

function clearDeviceState(event, id) {
  event.stopPropagation();
  if (!client || !client.connected) { alert("Not connected to broker"); return; }
  if (!confirm(`Clear retained state for ${id}?`)) return;

  uiLocked = true;
  const topic = stateTopic(id);

  client.publish(topic, "", { retain: true }, (err) => {
    uiLocked = false;
    if (err) { console.error("Publish failed:", err); return; }
    console.log("✅ Cleared retained state for", topic);
    delete devices[id];
    delete notified[id];
    delete openState[id];
    deviceOrder = deviceOrder.filter(existing => existing !== id);
    saveDeviceOrder();
    if (autoRefreshTimers[id]) clearTimeout(autoRefreshTimers[id]);
    delete autoRefreshTimers[id];
    delete manualRefreshToken[id];
    delete photoSoundPrimed[id];
    delete errorSoundState[id];
    render();
  });
}
