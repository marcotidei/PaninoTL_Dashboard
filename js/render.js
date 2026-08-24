// Render
// Skip unchanged snapshots to avoid unnecessary DOM rebuilds and focus loss.
let lastRenderSnapshot = "";
const RENDER_TIME_BUCKET_MS = 60 * 1000;

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
          commandPending: !!pendingCommands[id],
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
          <span class="summary-days">${renderDays(d.config.days)}</span>
          <span>${d.config.start} → ${d.config.end}</span>
          <span>${formatIntervalMinutes(d.config.interval)}</span>
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
              <div class="row">
                <span>Battery:</span>
                <span class="${batteryClass(d.batteryPct)}">${batteryLabel(d.batteryPct)}</span>
              </div>
              <div class="row">
                <span>Temperature:</span>
                <span>${formatTemperature(d.rtcTempC)}</span>
              </div>
              <div class="row">
                <span>Wi-Fi:</span>
                <span class="${wifiQualityClass(d.wifiQuality)}">
                  ${wifiQualityLabel(d.wifiQuality)} (${d.wifiQuality ?? 0}%)
                </span>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-icon"><i class="fa-solid fa-calendar-days"></i></div>
            <div class="section-body">
              <div class="row"><span>Days of the week:</span><span>${renderDays(d.config.days)}</span></div>
              <div class="row"><span>Time window:</span><span>${d.config.start} → ${d.config.end}</span></div>
              <div class="row"><span>Every:</span><span>${formatIntervalMinutes(d.config.interval)}</span></div>
              <div class="row"><span>Upload/Timeout:</span><span>${formatUploadSummary(d.config)}</span></div>
            </div>
          </div>

          <div class="section section-clickable" onclick="openCameraModal('${id}')">
            <div class="section-icon"><i class="fa-solid fa-camera"></i></div>
            <div class="section-body">
              ${hasSdTotal(d) ? `
                <div class="row sd-row">
                  <div class="sd-wrap">
                    <i class="fa-solid fa-sd-card"></i>
                    <progress class="sd-progress ${sdLevelClass(d)}" value="${sdUsagePercent(d)}" max="100"></progress>
                    <span class="sd-summary">
                      ${formatFreeSmart(d.sdFreeMB)} / ${formatTotalGB(d.sdTotalMB)}
                    </span>
                  </div>
                </div>
              ` : `
                <div class="row"><span>SD free space:</span><span>${formatFreeSmart(d.sdFreeMB)}</span></div>
              `}
              <div class="row"><span>Photos in SD:</span><span>${d.sdPhotoCount}</span></div>
              <div class="row"><span>Lens:</span><span>${lensName(d.config.lens)}</span></div>
              <div class="row"><span>Format:</span><span>${photoOutputName(d.config.output)}</span></div>
            </div>
          </div>
        </div>

        <div class="clear-actions">
          <button type="button" class="device-command-btn" data-device-id="${escapeAttr(id)}"
            onclick="openDeviceCommandModal(event)" title="Device settings and commands"
            aria-label="Device settings and commands for ${escapeAttr(id)}">
            <i class="fa-solid ${pendingCommand ? "fa-hourglass-half" : "fa-gear"}"></i>
          </button>
          ${pendingCommand ? `<span class="command-status pending">Command pending</span>` : ""}
          ${!pendingCommand && commandAck ? `
            <span class="command-status ${commandAck.applied ? "ok" : "error"}">
              ${commandAck.applied ? "Command applied" : "Command rejected"}
            </span>
          ` : ""}
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
