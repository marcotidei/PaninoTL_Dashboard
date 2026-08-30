// Render
// Skip unchanged snapshots to avoid unnecessary DOM rebuilds and focus loss.
let lastRenderSnapshot = "";
const RENDER_TIME_BUCKET_MS = 60 * 1000;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hasOwnValue(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function pendingSettingsConfig(pendingCommand) {
  const command = pendingCommand && pendingCommand.command ? pendingCommand.command : pendingCommand;
  if (!command) return null;
  if (command.type === "set") return command.config || null;
  if (command.type === "batch" && Array.isArray(command.commands)) {
    const op = command.commands.find(item => item && item.type === "set" && item.config);
    return op ? op.config : null;
  }
  return null;
}

function pendingActionCommands(pendingCommand) {
  const command = pendingCommand && pendingCommand.command ? pendingCommand.command : pendingCommand;
  if (!command) return [];
  if (command.type === "action" && command.action) return [command.action];
  if (command.type === "batch" && Array.isArray(command.commands)) {
    return command.commands
      .filter(item => item && item.type === "action" && item.action)
      .map(item => item.action);
  }
  return [];
}

function hasPendingSetting(pendingCommand, keys) {
  const config = pendingSettingsConfig(pendingCommand);
  return !!config && keys.some(key => hasOwnValue(config, key));
}

function pendingSettingClass(pendingCommand, keys) {
  return hasPendingSetting(pendingCommand, keys) ? "pending-setting-affected" : "";
}

function formatUploadMode(mode) {
  switch (Number(mode)) {
    case 0: return "Disabled";
    case 1: return "Thumbnail";
    case 2: return "Full Resolution";
    default: return "-";
  }
}

function pendingUploadMode(config, currentMode) {
  const enabled = hasOwnValue(config, "dropboxUploadEnabled")
    ? !!config.dropboxUploadEnabled
    : Number(currentMode) > 0;
  const mode = hasOwnValue(config, "dropboxUploadMode")
    ? Number(config.dropboxUploadMode)
    : (Number(currentMode) === 2 ? 1 : 0);
  return enabled ? (mode === 1 ? 2 : 1) : 0;
}

function formatTimeoutMin(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${n} ${n === 1 ? "min" : "mins"}`;
}

function formatPowerMode(value) {
  switch (Number(value)) {
    case 1: return "Power Save";
    case 2: return "Hybrid";
    default: return "Always On";
  }
}

function formatNtpSyncMode(value) {
  switch (Number(value)) {
    case 1: return "Always";
    case 2: return "Daily";
    case 3: return "Weekly";
    case 4: return "Monthly";
    default: return "Disabled";
  }
}

function formatEnabled(value) {
  return Number(value) === 0 || value === false ? "Disabled" : "Enabled";
}

function formatMaxSleep(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return "-";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} ${minutes === 1 ? "min" : "mins"}`;
}

function pendingChangeValueHtml(value) {
  return value && value.html ? value.html : escapeHtml(value);
}

function pendingSettingsChanges(d, pendingCommand) {
  const config = pendingSettingsConfig(pendingCommand);
  if (!config) return [];

  const c = d.config || {};
  const changes = [];

  if (hasOwnValue(config, "scheduleDays")) {
    changes.push({
      label: "Active days",
      current: { html: renderDays(c.days) },
      next: { html: renderDays(config.scheduleDays) }
    });
  }

  if (hasOwnValue(config, "scheduleStart")) {
    changes.push({
      label: "Start",
      current: c.start || "-",
      next: config.scheduleStart || "-"
    });
  }

  if (hasOwnValue(config, "scheduleEnd")) {
    changes.push({
      label: "End",
      current: c.end || "-",
      next: config.scheduleEnd || "-"
    });
  }

  if (hasOwnValue(config, "intervalSec")) {
    changes.push({
      label: "Interval",
      current: formatIntervalMinutes(c.interval),
      next: formatIntervalMinutes(config.intervalSec)
    });
  }

  if (hasOwnValue(config, "photoLens")) {
    changes.push({
      label: "Lens",
      current: lensName(c.lens),
      next: lensName(Number(config.photoLens))
    });
  }

  if (hasOwnValue(config, "photoOutput")) {
    changes.push({
      label: "Format",
      current: photoOutputName(c.output),
      next: photoOutputName(Number(config.photoOutput))
    });
  }

  if (hasOwnValue(config, "powerMode")) {
    changes.push({
      label: "GoPro Power",
      current: formatPowerMode(c.powerMode),
      next: formatPowerMode(config.powerMode)
    });
  }

  if (hasOwnValue(config, "batteryMonitorEnabled")) {
    changes.push({
      label: "Battery Monitor",
      current: formatEnabled(c.batteryMonitorEnabled),
      next: formatEnabled(config.batteryMonitorEnabled)
    });
  }

  if (hasOwnValue(config, "sdLogEnabled")) {
    changes.push({
      label: "SD Debug Log",
      current: formatEnabled(c.sdLogEnabled),
      next: formatEnabled(config.sdLogEnabled)
    });
  }

  if (hasOwnValue(config, "maxSleepSec")) {
    changes.push({
      label: "Keep Alive",
      current: formatMaxSleep(c.maxSleepSec),
      next: formatMaxSleep(config.maxSleepSec)
    });
  }

  if (hasOwnValue(config, "ntpSyncMode")) {
    changes.push({
      label: "Clock Sync",
      current: formatNtpSyncMode(c.ntpSyncMode),
      next: formatNtpSyncMode(config.ntpSyncMode)
    });
  }

  if (hasOwnValue(config, "dropboxUploadEnabled") || hasOwnValue(config, "dropboxUploadMode")) {
    changes.push({
      label: "Upload Images",
      current: formatUploadMode(c.uploadMode),
      next: formatUploadMode(pendingUploadMode(config, c.uploadMode))
    });
  }

  if (hasOwnValue(config, "dropboxEnsureFullResUpload")) {
    changes.push({
      label: "Ensure Full Res Upload",
      current: formatEnabled(c.ensureFullResUpload),
      next: formatEnabled(config.dropboxEnsureFullResUpload)
    });
  }

  if (hasOwnValue(config, "dropboxBackfillMaxAfterSchedule")) {
    changes.push({
      label: "Backfill After Schedule",
      current: c.backfillMaxAfterSchedule ?? "-",
      next: config.dropboxBackfillMaxAfterSchedule
    });
  }

  if (hasOwnValue(config, "uploadTimeoutMin")) {
    changes.push({
      label: "Upload Timeout",
      current: formatTimeoutMin(c.uploadTimeout),
      next: formatTimeoutMin(config.uploadTimeoutMin)
    });
  }

  return changes;
}

function pendingSettingsPanelHtml(id, d, pendingCommand) {
  const changes = pendingSettingsChanges(d, pendingCommand);
  if (!changes.length) return "";

  return `
    <div class="section pending-settings-panel section-clickable" data-device-id="${escapeAttr(id)}"
      onclick="openDeviceCommandModal(event)" title="Edit pending settings">
      <div class="section-icon pending-settings-icon"><i class="fa-solid fa-arrows-rotate"></i></div>
      <div class="section-body">
        <div class="pending-settings-heading">Ready for next sync</div>
        <div class="pending-settings-list">
          ${changes.map(change => `
            <div class="pending-settings-row">
              <span class="pending-settings-name">${escapeHtml(change.label)}</span>
              <span class="pending-settings-current">${pendingChangeValueHtml(change.current)}</span>
              <i class="fa-solid fa-arrow-right pending-settings-arrow" aria-hidden="true"></i>
              <span class="pending-settings-next">${pendingChangeValueHtml(change.next)}</span>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function actionCommandLabel(action) {
  switch (action) {
    case "syncTimeNow": return "Sync time now";
    case "clearHealth": return "Clear health";
    case "uploadSdLog": return "Upload SD log";
    default: return action || "Unknown action";
  }
}

function pendingActionPanelHtml(id, pendingCommand) {
  const actions = pendingActionCommands(pendingCommand);
  if (!actions.length) return "";

  return `
    <div class="section pending-settings-panel pending-command-panel section-clickable" data-device-id="${escapeAttr(id)}"
      onclick="openDeviceCommandModal(event)" title="Preview pending command">
      <div class="section-icon pending-settings-icon pending-command-panel-icon"><i class="fa-solid fa-arrows-rotate"></i></div>
      <div class="section-body">
        <div class="pending-settings-heading pending-command-heading">Command ready for next sync</div>
        <div class="pending-settings-list">
          ${actions.map(action => `
            <div class="pending-settings-row">
              <span class="pending-settings-name pending-command-name">Action</span>
              <span class="pending-settings-current pending-command-current">Pending</span>
              <i class="fa-solid fa-arrow-right pending-settings-arrow pending-command-arrow" aria-hidden="true"></i>
              <span class="pending-settings-next pending-command-next">${escapeHtml(actionCommandLabel(action))}</span>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function pendingCommandPanelHtml(id, d, pendingCommand) {
  const changes = pendingSettingsChanges(d, pendingCommand);
  const actions = pendingActionCommands(pendingCommand);
  if (!changes.length && !actions.length) return "";

  return `
    <div class="section pending-settings-panel pending-command-panel section-clickable" data-device-id="${escapeAttr(id)}"
      onclick="openDeviceCommandModal(event)" title="Edit pending settings and commands">
      <div class="section-icon pending-settings-icon pending-command-panel-icon"><i class="fa-solid fa-arrows-rotate"></i></div>
      <div class="section-body">
        <div class="pending-settings-heading pending-command-heading">Ready for next sync</div>
        <div class="pending-settings-list">
          ${changes.map(change => `
            <div class="pending-settings-row">
              <span class="pending-settings-name">${escapeHtml(change.label)}</span>
              <span class="pending-settings-current">${pendingChangeValueHtml(change.current)}</span>
              <i class="fa-solid fa-arrow-right pending-settings-arrow" aria-hidden="true"></i>
              <span class="pending-settings-next">${pendingChangeValueHtml(change.next)}</span>
            </div>
          `).join("")}
          ${actions.map(action => `
            <div class="pending-settings-row">
              <span class="pending-settings-name pending-command-name">Action</span>
              <span class="pending-settings-current pending-command-current">Pending</span>
              <i class="fa-solid fa-arrow-right pending-settings-arrow pending-command-arrow" aria-hidden="true"></i>
              <span class="pending-settings-next pending-command-next">${escapeHtml(actionCommandLabel(action))}</span>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function buildSnapshot() {
  return JSON.stringify(
    {
      timeBucket: Math.floor(Date.now() / RENDER_TIME_BUCKET_MS),
      devices: orderedDeviceIds().map(id => {
        const d = devices[id];
        const s = status(d, id);
        return {
          id,
          s,
          lastCommDevice: d.lastCommDevice,
          batteryPct:     d.batteryPct,
          rtcTempC:       d.rtcTempC,
          wifiQuality:    d.wifiQuality,
          photosSuccessful: d.photosSuccessful,
          sdPhotoCount:     d.sdPhotoCount,
          photosFailed:   d.photosFailed,
          sdFreeMB:       d.sdFreeMB,
          sdTotalMB:      d.sdTotalMB,
          lastShotOk:     d.lastShotOk,
          lastUploadOk:   d.lastUploadOk,
          imageUrl:       d.imageUrl,
          imageRevision:  d.imageRevision,
          imagePacketSeq: d.imagePacketSeq,
          uploadMode:     d.config && d.config.uploadMode,
          lastError:      d.lastError,
          lastErrorTime:  d.lastErrorTime,
          issueCode:      d.issueCode,
          issueTime:      d.issueTime,
          healthCode:     d.healthCode,
          healthText:     d.healthText,
          healthLevel:    d.healthLevel,
          healthTime:     d.healthTime,
          healthSticky:   d.healthSticky,
          firmware:       d.firmware,
          pendingCommand:  pendingCommands[id] && pendingCommands[id].command,
          commandAck:     d.commandAck,
          open:           !!openState[id]
        };
      })
    }
  );
}

function render() {
  const snapshot = buildSnapshot();

  if (snapshot === lastRenderSnapshot) return;
  lastRenderSnapshot = snapshot;

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const container = document.getElementById("devices");
  container.innerHTML = "";

  const visibleDeviceIds = orderedDeviceIds();

  visibleDeviceIds.forEach(id => {
    const d = devices[id];
    if (!d.config) return;
    const captureSrc = captureImageSrc(id);
    const missingImageLink = uploadMissingImageLink(d);

    const s   = status(d, id);
    const err = effectiveErrorInfo(d, id, s);

    // Device panels use the highest severity from communication and JSON status.
    const severityOf = level => ({ ok: 1, idle: 0, warn: 2, error: 3 }[level] ?? 0);
    const errLevel   = err.hasError && (err.level === "error" || err.level === "warn") ? err.level : s;
    const panelState = [s, errLevel].reduce((a, b) => severityOf(a) >= severityOf(b) ? a : b);
    const statusIconHtml = (() => {
      if (err.hasError && err.level === "warn") {
        return `<i class="fa-solid fa-circle-exclamation text-warning"></i>`;
      }
      if (err.hasError && err.level === "error") {
        return `<i class="fa-solid fa-circle-xmark text-danger"></i>`;
      }
      if (panelState === "warn") {
        return `<i class="fa-solid fa-circle-exclamation text-warning"></i>`;
      }
      if (panelState === "error") {
        return `<i class="fa-solid fa-circle-xmark text-danger"></i>`;
      }
      if (panelState !== "ok") {
        return `<i class="fa-solid fa-clock text-muted"></i>`;
      }
      return "";
    })();
    const pendingCommand = pendingCommands[id];
    const commandAck = d.commandAck || null;
    const pendingScheduleDaysClass = pendingSettingClass(pendingCommand, ["scheduleDays"]);
    const pendingScheduleWindowClass = pendingSettingClass(pendingCommand, ["scheduleStart", "scheduleEnd"]);
    const pendingIntervalClass = pendingSettingClass(pendingCommand, ["intervalSec"]);
    const pendingUploadModeClass = pendingSettingClass(pendingCommand, ["dropboxUploadEnabled", "dropboxUploadMode"]);
    const pendingEnsureUploadClass = pendingSettingClass(pendingCommand, ["dropboxEnsureFullResUpload"]);
    const pendingBackfillMaxClass = pendingSettingClass(pendingCommand, ["dropboxBackfillMaxAfterSchedule"]);
    const pendingUploadTimeoutClass = pendingSettingClass(pendingCommand, ["uploadTimeoutMin"]);
    const pendingPowerModeClass = pendingSettingClass(pendingCommand, ["powerMode"]);
    const pendingSdLogClass = pendingSettingClass(pendingCommand, ["sdLogEnabled"]);
    const pendingMaxSleepClass = pendingSettingClass(pendingCommand, ["maxSleepSec"]);
    const pendingNtpSyncClass = pendingSettingClass(pendingCommand, ["ntpSyncMode"]);
    const pendingLensClass = pendingSettingClass(pendingCommand, ["photoLens"]);
    const pendingOutputClass = pendingSettingClass(pendingCommand, ["photoOutput"]);
    const uploadEnabled = Number(d.config.uploadMode) > 0;
    const fullResUpload = Number(d.config.uploadMode) === 2;
    const ensureFullResUpload = Number(d.config.ensureFullResUpload) === 1 || d.config.ensureFullResUpload === true;
    const hasPendingFullResUploads = Number(d.pendingFullResUploads || 0) > 0;

    const dev = document.createElement("div");
    dev.className    = "device " + panelState;
    dev.dataset.id   = id;

    const userHasInteracted = Object.prototype.hasOwnProperty.call(openState, id);
    const shouldOpen = userHasInteracted ? openState[id] : expandAll;

    if (shouldOpen) dev.classList.add("open");

    // "neutral" is just a past error logged for reference, not an active
    // issue -- only active alerts (warn/error) get surfaced in the compact view.
    const isActiveAlert = err.hasError && err.level !== "neutral";

    const alertBannerHtml = `
      <div class="alert-banner ${alertClass(err)} ${err.glow ? "glow" : ""}">
        ${err.hasError ? `
          <span>${err.text}</span>
          ${err.time ? `<span class="alert-time">${formatDateTime(err.time, d.tz)}</span>` : ""}
          ${err.jsonError ? `
            <span class="secondary-alert">${err.jsonError} @ ${formatDateTime(err.jsonErrorTime, d.tz)}</span>
          ` : ""}
        ` : "<span>No alerts</span>"}
      </div>
    `;

    dev.innerHTML = `
      <div class="header" onclick="maybeToggle(this.parentElement, event)">
        <span class="device-title">
          <button type="button" class="drag-handle" title="Drag to reorder" aria-label="Drag ${id} to reorder"
            onpointerdown="handleDeviceDragPointerDown(event, '${id}')" onclick="event.stopPropagation()">
            <i class="fa-solid fa-grip-vertical"></i>
          </button>
          <b class="device-name">${id}</b>
        </span>
        <span class="header-metrics">
          ${pendingCommand ? `
            <i class="fa-solid fa-hourglass-half pending-command-icon" title="Pending command"></i>
          ` : ""}
          ${statusIconHtml}

          <span class="photo-metric">
            <i class="fa-solid fa-camera metric-icon"></i>
            <span>${d.photosSuccessful}</span>
            ${(d.photosFailed || 0) > 0 ? `
              <span class="photo-failures">(${d.photosFailed})</span>
            ` : ""}
          </span>

          <i class="fa-solid fa-wifi ${wifiQualityClass(d.wifiQuality)}"
            title="Wi-Fi ${wifiQualityLabel(d.wifiQuality)} (${d.wifiQuality ?? 0}%)"></i>

          <i class="fa-solid ${batteryIconClass(d.batteryPct)} ${batteryClass(d.batteryPct)}"
            title="Battery ${batteryLabel(d.batteryPct)}"></i>
        </span>
      </div>

      <div class="collapsed-summary${(captureSrc || missingImageLink) ? " has-thumb" : ""}" onclick="maybeToggle(this.parentElement, event)">
        ${isActiveAlert ? `<div class="compact-alert">${alertBannerHtml}</div>` : ""}
        ${captureSrc ? `<span class="capture-slot" data-kind="compact"></span>` : missingImageLink ? capturePlaceholderHtml("compact") : ""}
        <div class="summary-stack">
          <div class="summary-item">
            <span class="summary-label">Last comm.:</span>
            <span class="summary-value">${elapsedAgo(d.lastCommDevice)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Last capture:</span>
            <span class="summary-value">${formatDateTime(d.lastShotOk, d.tz)}</span>
          </div>
        </div>

        <div class="summary-schedule">
          <span class="summary-days ${pendingScheduleDaysClass}">${renderDays(d.config.days)}</span>
          <span class="${pendingScheduleWindowClass}">${d.config.start} → ${d.config.end}</span>
          <span class="${pendingIntervalClass}">${formatIntervalMinutes(d.config.interval)}</span>
        </div>
      </div>

      <div class="content">
        ${alertBannerHtml}

        <div class="sections">

          <div class="section">
            <div class="section-icon"><i class="fa-solid fa-image"></i></div>
            <div class="section-body">
              ${captureSrc ? `
                <span class="capture-slot" data-kind="expanded"></span>
                <div class="capture-toolbar">
                  <button class="capture-tool-btn" onclick="refreshCaptureImage(event, '${id}')" title="Force refresh image">
                    <i class="fa-solid fa-rotate-right"></i>
                  </button>
                  <button class="capture-tool-btn" onclick="downloadCaptureImageFromToolbar(event, '${id}')" title="Download image">
                    <i class="fa-solid fa-download"></i>
                  </button>
                  <button class="capture-tool-btn" onclick="openImageInfoModal(event, '${id}')" title="Image info">
                    <i class="fa-solid fa-circle-info"></i>
                  </button>
                </div>
              ` : missingImageLink ? `
                ${capturePlaceholderHtml("expanded")}
              ` : `
                <div class="row"><span>Last capture:</span><span>No image yet</span></div>
              `}
            </div>
          </div>

          <div class="section section-clickable" onclick="openFirmwareModal('${id}')">
            <div class="section-icon"><i class="fa-solid fa-heart-pulse"></i></div>
            <div class="section-body">
              <div class="row"><span>Last comm.:</span><span>${elapsedAgo(d.lastCommDevice)}</span></div>

              <div class="row"><span>Next comm.:</span><span>${formatDateTime(nextScheduledConnection(d), d.tz)}</span></div>

              <div class="row"><span>Last capture:</span><span>${formatDateTime(d.lastShotOk, d.tz)}</span></div>

              <div class="row"><span>Confirmed photos:</span><span>${d.photosSuccessful}</span></div>

              <div class="row">
                <span>Failed photos:</span>
                <span class="${failureTextClass(d.photosFailed)}">
                  ${d.photosFailed || 0}
                </span>
              </div>

              ${d.batteryPct == null || d.batteryPct < 0 ? `
                <div class="row">
                  <span>Battery:</span>
                  <span class="${batteryClass(d.batteryPct)}">${batteryLabel(d.batteryPct)}</span>
                </div>
              ` : `
                <div class="row sd-row">
                  <div class="sd-wrap">
                    <i class="fa-solid ${batteryIconClass(d.batteryPct)} ${batteryClass(d.batteryPct)}"></i>
                    <progress class="sd-progress ${batteryLevelClass(d.batteryPct)}" value="${clampPercent(d.batteryPct)}" max="100"></progress>
                    <span class="sd-summary ${batteryClass(d.batteryPct)}">${batteryLabel(d.batteryPct)}</span>
                  </div>
                </div>
              `}

              ${d.rtcTempC == null || Number.isNaN(d.rtcTempC) ? `
                <div class="row">
                  <span>Temperature:</span>
                  <span>${formatTemperature(d.rtcTempC)}</span>
                </div>
              ` : `
                <div class="row sd-row">
                  <div class="sd-wrap">
                    <i class="fa-solid fa-temperature-half ${temperatureTextClass(d.rtcTempC)}"></i>
                    <progress class="sd-progress ${temperatureLevelClass(d.rtcTempC)}" value="${temperatureBarPercent(d.rtcTempC)}" max="100"></progress>
                    <span class="sd-summary ${temperatureTextClass(d.rtcTempC)}">${formatTemperature(d.rtcTempC)}</span>
                  </div>
                </div>
              `}

              <div class="row sd-row">
                <div class="sd-wrap">
                  <i class="fa-solid fa-wifi ${wifiQualityClass(d.wifiQuality)}"></i>
                  <progress class="sd-progress ${wifiLevelClass(d.wifiQuality)}" value="${clampPercent(d.wifiQuality)}" max="100"></progress>
                  <span class="sd-summary ${wifiQualityClass(d.wifiQuality)}">${wifiQualityLabel(d.wifiQuality)} (${clampPercent(d.wifiQuality)}%)</span>
                </div>
              </div>
              
              <div class="row ${pendingSdLogClass}"><span>SD debug log:</span><span>${formatEnabled(d.config.sdLogEnabled)}</span></div>

              ${d.logUrl ? `
                <div class="row"><span>SD log link:</span><span><a href="${escapeAttr(d.logUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open</a></span></div>
              ` : ""}

            </div>
          </div>

          <div class="section">
            <div class="section-icon"><i class="fa-solid fa-calendar-days"></i></div>
            <div class="section-body">
              <div class="row ${pendingScheduleDaysClass}"><span>Days of the week:</span><span>${renderDays(d.config.days)}</span></div>
              <div class="row ${pendingScheduleWindowClass}"><span>Time window:</span><span>${d.config.start} → ${d.config.end}</span></div>
              <div class="row ${pendingIntervalClass}"><span>Interval:</span><span>${formatIntervalMinutes(d.config.interval)}</span></div>
              <div class="row ${pendingMaxSleepClass}"><span>Keepalive:</span><span>${formatMaxSleep(d.config.maxSleepSec)}</span></div>
              <div class="row ${pendingNtpSyncClass}"><span>Clock sync:</span><span>${formatNtpSyncMode(d.config.ntpSyncMode)}</span></div>
            </div>
          </div>

          <div class="section">
            <div class="section-icon"><i class="fa-solid fa-cloud-arrow-up"></i></div>
            <div class="section-body">
              <div class="row ${pendingUploadModeClass}"><span>Upload Images:</span><span>${formatUploadMode(d.config.uploadMode)}</span></div>
              ${fullResUpload ? `
                <div class="row ${pendingEnsureUploadClass}"><span>Ensure full-res upload:</span><span>${formatEnabled(d.config.ensureFullResUpload)}</span></div>
              ` : ""}
              ${fullResUpload && ensureFullResUpload ? `
                <div class="row ${pendingBackfillMaxClass}"><span>Backfill after schedule:</span><span>${d.config.backfillMaxAfterSchedule ?? 3}</span></div>
              ` : ""}
              ${ensureFullResUpload || hasPendingFullResUploads ? `
                <div class="row"><span>Pending uploads:</span><span>${d.pendingFullResUploads || 0}</span></div>
              ` : ""}
              ${uploadEnabled ? `
                <div class="row ${pendingUploadTimeoutClass}"><span>Upload timeout:</span><span>${formatTimeoutMin(d.config.uploadTimeout)}</span></div>
              ` : ""}
              ${uploadEnabled && hasDropboxTotal(d) ? `
                <div class="row sd-row">
                  <div class="sd-wrap">
                    <i class="fa-brands fa-dropbox"></i>
                    <progress class="sd-progress ${dropboxLevelClass(d)}" value="${dropboxUsagePercent(d)}" max="100"></progress>
                    <span class="sd-summary">${formatFreeSmart(usedSpaceMB(d.dropboxTotalMB, d.dropboxFreeMB))} / ${formatTotalGB(d.dropboxTotalMB)}</span>
                  </div>
                </div>
              ` : ""}
            </div>
          </div>

          <div class="section section-clickable" onclick="openCameraModal('${id}')">
            <div class="section-icon"><i class="fa-solid fa-camera"></i></div>
            <div class="section-body">
              <div class="row">
                <span>GoPro SD health:</span>
                <span class="${d.paninoSdFault ? "text-danger" : "text-success"}">
                  ${d.paninoSdFault ? `Fault${d.paninoSdFaultTime && d.paninoSdFaultTime !== "-" ? ` @ ${formatDateTime(d.paninoSdFaultTime, d.tz)}` : ""}` : "OK"}
                </span>
              </div>
              ${hasSdTotal(d) ? `
                <div class="row sd-row">
                  <div class="sd-wrap">
                    <i class="fa-solid fa-sd-card"></i>
                    <progress class="sd-progress ${sdLevelClass(d)}" value="${sdUsagePercent(d)}" max="100"></progress>
                    <span class="sd-summary">${formatFreeSmart(usedSpaceMB(d.sdTotalMB, d.sdFreeMB))} / ${formatTotalGB(d.sdTotalMB)}</span>
                  </div>
                </div>
              ` : `
                <div class="row"><span>SD free space:</span><span>${formatFreeSmart(d.sdFreeMB)}</span></div>
              `}
              <div class="row"><span>Photos in SD:</span><span>${d.sdPhotoCount}</span></div>
              <div class="row ${pendingPowerModeClass}"><span>Power Mode:</span><span>${formatPowerMode(d.config.powerMode)}</span></div>
              <div class="row ${pendingLensClass}"><span>Lens:</span><span>${lensName(d.config.lens)}</span></div>
              <div class="row ${pendingOutputClass}"><span>Format:</span><span>${photoOutputName(d.config.output)}</span></div>
            </div>
          </div>
        </div>

        ${pendingCommandPanelHtml(id, d, pendingCommand)}

        <div class="clear-actions">
          <div class="command-action-group">
            <button type="button" class="device-command-btn" data-device-id="${escapeAttr(id)}"
              onclick="openDeviceCommandModal(event)" title="Device settings and commands"
              aria-label="Device settings and commands for ${escapeAttr(id)}">
              <i class="fa-solid fa-gear"></i>
            </button>
            ${!pendingCommand && commandAck && commandAck.applied === false ? `
              <span class="command-status error" title="${escapeAttr(commandAck.error || "Command rejected")}">
                Command rejected
              </span>
            ` : ""}
          </div>
          <button class="clear-device-btn" onclick="clearDeviceState(event, '${id}')">Clear Device</button>
        </div>
      </div>
    `;

    mountCaptureImages(dev, id);
    container.appendChild(dev);
  });

  updateCompactSummaryLayouts(container);

  if (scrollX || scrollY) {
    requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
  }
}
