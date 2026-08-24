let client        = null;
let currentConfig = null;
let connectionState = "disconnected";
let manualDisconnect = false;
let expandAll     = localStorage.getItem("expandAll") === "true";
let uiLocked      = false;

// MQTT handlers close over these objects, so clear them in place.
const devices   = {};
const notified  = {};
const openState = {};
const photoSoundPrimed = {};
const errorSoundState = {};
const pendingCommands = {};
const DEVICE_ORDER_STORAGE_KEY = "deviceOrder";
let deviceOrder = loadDeviceOrder();

function clearDashboardState() {
  Object.keys(devices).forEach(k   => delete devices[k]);
  Object.keys(notified).forEach(k  => delete notified[k]);
  Object.keys(openState).forEach(k => delete openState[k]);
  Object.keys(photoSoundPrimed).forEach(k => delete photoSoundPrimed[k]);
  Object.keys(errorSoundState).forEach(k => delete errorSoundState[k]);
  Object.keys(pendingCommands).forEach(k => delete pendingCommands[k]);
}

function loadDeviceOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_ORDER_STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter(id => typeof id === "string" && id.length > 0) : [];
  } catch {
    localStorage.removeItem(DEVICE_ORDER_STORAGE_KEY);
    return [];
  }
}

function saveDeviceOrder() {
  localStorage.setItem(DEVICE_ORDER_STORAGE_KEY, JSON.stringify(deviceOrder));
}

function rememberDeviceOrder(id) {
  if (!id || deviceOrder.includes(id)) return;
  deviceOrder.push(id);
  saveDeviceOrder();
}

function orderedDeviceIds() {
  const ids = Object.keys(devices);
  const known = new Set(ids);
  const ordered = deviceOrder.filter(id => known.has(id));
  ids.forEach(id => {
    if (!ordered.includes(id)) ordered.push(id);
  });
  return ordered;
}

let devicePointerDrag = null;
let suppressNextToggle = false;

function persistDeviceOrder(ordered) {
  const hidden = deviceOrder.filter(existing => !ordered.includes(existing));
  deviceOrder = ordered.concat(hidden);
  saveDeviceOrder();
}

function moveDeviceNear(sourceId, targetId, placeAfter, renderNow = true) {
  if (!sourceId || !targetId || sourceId === targetId) return false;
  const ordered = orderedDeviceIds();
  const sourceIndex = ordered.indexOf(sourceId);
  const targetIndex = ordered.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return false;

  ordered.splice(sourceIndex, 1);
  const targetIndexAfterRemoval = ordered.indexOf(targetId);
  ordered.splice(targetIndexAfterRemoval + (placeAfter ? 1 : 0), 0, sourceId);
  persistDeviceOrder(ordered);
  if (renderNow) render();
  return true;
}

function handleDeviceDragPointerDown(event, id) {
  event.stopPropagation();
  if (event.button !== undefined && event.button !== 0) return;
  const sourceEl = event.currentTarget.closest(".device");
  if (!sourceEl) return;

  devicePointerDrag = {
    id,
    pointerId: event.pointerId,
    sourceEl,
    handleEl: event.currentTarget,
    startX: event.clientX,
    startY: event.clientY,
    active: false
  };
  try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
  document.addEventListener("pointermove", handleDeviceDragPointerMove, { passive: false });
  document.addEventListener("pointerup", handleDeviceDragPointerUp);
  document.addEventListener("pointercancel", handleDeviceDragPointerUp);
}

function handleDeviceDragPointerMove(event) {
  const drag = devicePointerDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;

  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (!drag.active && Math.hypot(dx, dy) < 12) return;

  drag.active = true;
  suppressNextToggle = true;
  uiLocked = true;
  document.body.classList.add("is-reordering");
  drag.sourceEl.classList.add("dragging");
  event.preventDefault();

  const target = document.elementsFromPoint(event.clientX, event.clientY)
    .map(el => el.closest && el.closest(".device"))
    .find(el => el && el.dataset.id && el.dataset.id !== drag.id);
  if (target) {
    const rect = target.getBoundingClientRect();
    const placeAfter = event.clientY > rect.top + (rect.height / 2);
    if (moveDeviceNear(drag.id, target.dataset.id, placeAfter, false)) {
      if (drag.sourceEl && drag.sourceEl !== target) {
        target.parentElement.insertBefore(drag.sourceEl, placeAfter ? target.nextSibling : target);
      }
    }
  }
}

function handleDeviceDragPointerUp(event) {
  const drag = devicePointerDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;

  const wasActive = drag.active;
  devicePointerDrag = null;
  uiLocked = false;
  document.body.classList.remove("is-reordering");
  drag.sourceEl.classList.remove("dragging");
  try { drag.handleEl.releasePointerCapture(event.pointerId); } catch {}
  document.removeEventListener("pointermove", handleDeviceDragPointerMove);
  document.removeEventListener("pointerup", handleDeviceDragPointerUp);
  document.removeEventListener("pointercancel", handleDeviceDragPointerUp);
  if (wasActive) setTimeout(() => { suppressNextToggle = false; }, 0);
}

function maybeToggle(el) {
  if (suppressNextToggle) {
    suppressNextToggle = false;
    return;
  }
  toggle(el);
}
