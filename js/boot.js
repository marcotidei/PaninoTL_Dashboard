// Boot
const dashboardUpdatedAt = document.getElementById("dashboardUpdatedAt");
if (dashboardUpdatedAt) {
  dashboardUpdatedAt.textContent = `Updated ${DASHBOARD_UPDATED_AT}`;
}

updateTzToggleUI();   // restore the persisted My time / Device time choice
updateViewToggleUI(); // restore the persisted Compact / Expanded view choice
updateSoundToggleUI(); // restore the persisted image chime choice
applyThumbSize();     // restore the persisted thumbnail size choice
render();

setInterval(() => {
  if (!uiLocked) render();
}, 1000);

if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
  Notification.requestPermission();
}

(async () => {
  const cfg = await loadConfig();
  if (!cfg || !cfg.url || !cfg.username) {
    openConfigModal(cfg || {});
    return;
  }
  connectMQTT(cfg);
})();
