// Firmware modal
function openFirmwareModal(id) {
  const d = devices[id];
  if (!d) return;

  const f = d.firmware || {};
  document.getElementById("fwInfoDevice").innerText   = id;
  document.getElementById("fwInfoTz").innerText       = d.tz || "-";
  document.getElementById("fwInfoDatetime").innerText = f.dt || "-";
  document.getElementById("fwInfoId").innerText       = f.id || "-";
  document.getElementById("fwInfoDirty").innerText    =
    (typeof f.dirty === "boolean") ? (f.dirty ? "Yes" : "No") : "-";

  document.getElementById("firmwareModal").classList.add("is-visible");
}

function closeFirmwareModal() {
  document.getElementById("firmwareModal").classList.remove("is-visible");
}

function openSettingsModal() {
  document.getElementById("settingsModal").classList.add("is-visible");
}

function closeSettingsModal() {
  document.getElementById("settingsModal").classList.remove("is-visible");
}

let deviceCommandDeviceId = null;
let deviceCommandTab = "settings";
let deviceCommandAction = "syncTimeNow";
let deviceCommandRequestId = null;
let deviceCommandIntervalsReady = false;

function escapeAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function readNumberInput(id) {
  const value = document.getElementById(id).value;
  if (value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sameCommandValue(a, b) {
  if (a === null || a === undefined || a === "") return b === null || b === undefined || b === "";
  if (b === null || b === undefined || b === "") return false;
  return String(a) === String(b);
}

function populateDeviceCommandIntervalSelects() {
  if (deviceCommandIntervalsReady) return;
  const hours = document.getElementById("cmd_intervalHours");
  const minutes = document.getElementById("cmd_intervalMinutes");

  hours.appendChild(new Option("-", ""));
  minutes.appendChild(new Option("-", ""));

  for (let i = 0; i <= 24; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${i} h`;
    hours.appendChild(opt);
  }

  for (let i = 0; i <= 59; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${i} min`;
    minutes.appendChild(opt);
  }

  deviceCommandIntervalsReady = true;
}

function clampIntervalSec(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return null;
  return Math.min(86400, Math.max(60, Math.round(n)));
}

function setIntervalControls(seconds) {
  const total = clampIntervalSec(seconds);
  if (total === null) {
    document.getElementById("cmd_intervalHours").value = "";
    document.getElementById("cmd_intervalMinutes").value = "";
    return;
  }
  document.getElementById("cmd_intervalHours").value = String(Math.floor(total / 3600));
  document.getElementById("cmd_intervalMinutes").value = String(Math.floor((total % 3600) / 60));
}

function readIntervalSec() {
  const h = readNumberInput("cmd_intervalHours");
  const m = readNumberInput("cmd_intervalMinutes");
  if (h === null || m === null) return null;
  return clampIntervalSec((h * 3600) + (m * 60));
}

function scheduleDaysMaskFromValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value & 0x7f;
  const str = String(value ?? "").trim();
  if (/^\d+$/.test(str)) return Number(str) & 0x7f;
  let mask = 0;
  for (let i = 0; i < 7; i++) {
    if (str[i] && str[i] !== "-") mask |= (1 << i);
  }
  return mask;
}

function setScheduleDayControls(value) {
  const mask = scheduleDaysMaskFromValue(value);
  document.querySelectorAll("#deviceCommandSettingsPanel [data-day-index]").forEach(input => {
    input.checked = !!(mask & (1 << Number(input.dataset.dayIndex)));
  });
}

function readScheduleDaysMask() {
  let mask = 0;
  document.querySelectorAll("#deviceCommandSettingsPanel [data-day-index]").forEach(input => {
    if (input.checked) mask |= (1 << Number(input.dataset.dayIndex));
  });
  return mask;
}

function setSelectValueWithFallback(id, value, label) {
  const select = document.getElementById(id);
  const stringValue = value === null || value === undefined ? "" : String(value);
  if (stringValue && !Array.from(select.options).some(opt => opt.value === stringValue)) {
    const opt = document.createElement("option");
    opt.value = stringValue;
    opt.textContent = `${label} (${stringValue})`;
    select.prepend(opt);
  }
  select.value = stringValue;
}

function openDeviceCommandModal(event) {
  event.stopPropagation();
  const id = event.currentTarget.dataset.deviceId;
  const d = devices[id];
  if (!d || !d.config) return;

  deviceCommandDeviceId = id;
  deviceCommandTab = "settings";
  deviceCommandAction = "syncTimeNow";
  deviceCommandRequestId = newDeviceCommandId(id);
  document.getElementById("deviceCommandTitle").innerText = id;

  populateDeviceCommandIntervalSelects();

  const c = d.config || {};
  setIntervalControls(c.interval);
  setScheduleDayControls(c.days);
  document.getElementById("cmd_scheduleStart").value = c.start || "";
  document.getElementById("cmd_scheduleEnd").value = c.end || "";
  setSelectValueWithFallback("cmd_photoLens", c.lens, "Current lens");
  setSelectValueWithFallback("cmd_photoOutput", c.output, "Current output");
  setSelectValueWithFallback("cmd_dropboxUpload", c.uploadMode, "Current upload mode");
  document.getElementById("cmd_uploadTimeoutMin").value = c.uploadTimeout ?? "";

  setDeviceCommandTab("settings");
  renderDeviceActionChoices();
  renderDeviceCommandPreview();
  document.getElementById("deviceCommandModal").classList.add("is-visible");
}

function closeDeviceCommandModal() {
  document.getElementById("deviceCommandModal").classList.remove("is-visible");
  deviceCommandDeviceId = null;
  deviceCommandRequestId = null;
}

function setDeviceCommandTab(tab) {
  deviceCommandTab = tab === "actions" ? "actions" : "settings";
  document.getElementById("deviceCommandSettingsPanel").hidden = deviceCommandTab !== "settings";
  document.getElementById("deviceCommandActionsPanel").hidden = deviceCommandTab !== "actions";
  document.getElementById("deviceCommandSettingsTab").classList.toggle("is-active", deviceCommandTab === "settings");
  document.getElementById("deviceCommandActionsTab").classList.toggle("is-active", deviceCommandTab === "actions");
  renderDeviceCommandPreview();
}

function selectDeviceCommandAction(action) {
  deviceCommandAction = action;
  renderDeviceActionChoices();
  renderDeviceCommandPreview();
}

function renderDeviceActionChoices() {
  document.querySelectorAll(".device-action-choice").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.action === deviceCommandAction);
  });
}

function newDeviceCommandId(id) {
  return `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildDeviceSettingsPatch(id) {
  const d = devices[id] || {};
  const c = d.config || {};
  const patch = {};

  const intervalSec = readIntervalSec();
  if (intervalSec !== null && !sameCommandValue(intervalSec, clampIntervalSec(c.interval))) patch.intervalSec = intervalSec;

  const scheduleDays = readScheduleDaysMask();
  if (!sameCommandValue(scheduleDays, scheduleDaysMaskFromValue(c.days))) patch.scheduleDays = scheduleDays;

  const scheduleStart = document.getElementById("cmd_scheduleStart").value;
  if (scheduleStart && !sameCommandValue(scheduleStart, c.start)) patch.scheduleStart = scheduleStart;

  const scheduleEnd = document.getElementById("cmd_scheduleEnd").value;
  if (scheduleEnd && !sameCommandValue(scheduleEnd, c.end)) patch.scheduleEnd = scheduleEnd;

  const photoLens = readNumberInput("cmd_photoLens");
  if (photoLens !== null && !sameCommandValue(photoLens, c.lens)) patch.photoLens = photoLens;

  const photoOutput = readNumberInput("cmd_photoOutput");
  if (photoOutput !== null && !sameCommandValue(photoOutput, c.output)) patch.photoOutput = photoOutput;

  const uploadMode = Number(document.getElementById("cmd_dropboxUpload").value);
  if (Number.isFinite(uploadMode) && !sameCommandValue(uploadMode, c.uploadMode)) {
    patch.dropboxUploadEnabled = uploadMode > 0;
    patch.dropboxUploadMode = uploadMode === 2 ? 1 : 0;
  }

  const uploadTimeoutMin = readNumberInput("cmd_uploadTimeoutMin");
  if (uploadTimeoutMin !== null && !sameCommandValue(uploadTimeoutMin, c.uploadTimeout)) {
    patch.uploadTimeoutMin = uploadTimeoutMin;
  }

  return patch;
}

function buildDeviceCommandPreview() {
  const id = deviceCommandDeviceId;
  if (!id) return {};

  if (deviceCommandTab === "actions") {
    return {
      schema: 1,
      id: deviceCommandRequestId || newDeviceCommandId(id),
      type: "action",
      action: deviceCommandAction
    };
  }

  return {
    schema: 1,
    id: deviceCommandRequestId || newDeviceCommandId(id),
    type: "set",
    config: buildDeviceSettingsPatch(id)
  };
}

function renderDeviceCommandPreview() {
  const preview = document.getElementById("deviceCommandPreview");
  if (!preview) return;
  preview.textContent = JSON.stringify(buildDeviceCommandPreview(), null, 2);
}

document.addEventListener("click", (e) => {
  const cameraModal = document.getElementById("cameraModal");
  const firmwareModal = document.getElementById("firmwareModal");
  const configModal = document.getElementById("configModal");
  const imageInfoModal = document.getElementById("imageInfoModal");
  const settingsModal = document.getElementById("settingsModal");
  const deviceCommandModal = document.getElementById("deviceCommandModal");
  if (cameraModal.classList.contains("is-visible") && e.target === cameraModal) closeCameraModal();
  if (firmwareModal.classList.contains("is-visible") && e.target === firmwareModal) closeFirmwareModal();
  if (configModal.classList.contains("is-visible") && e.target === configModal) closeConfigModal();
  if (imageInfoModal.classList.contains("is-visible") && e.target === imageInfoModal) closeImageInfoModal();
  if (settingsModal.classList.contains("is-visible") && e.target === settingsModal) closeSettingsModal();
  if (deviceCommandModal.classList.contains("is-visible") && e.target === deviceCommandModal) closeDeviceCommandModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeCameraModal();
    closeFirmwareModal();
    closeConfigModal();
    closeImageInfoModal();
    closeSettingsModal();
    closeDeviceCommandModal();
  }
});
document.addEventListener("pointerdown", primeAudioFromGesture, { passive: true });
document.addEventListener("touchend", primeAudioFromGesture, { passive: true });
document.addEventListener("click", primeAudioFromGesture, { passive: true });
