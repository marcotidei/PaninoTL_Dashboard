async function loadLocalFakeCameras(config = currentConfig) {
  let data;
  try {
    const response = await fetch("fake-camera.json", { cache: "no-store" });
    if (!response.ok) return;
    data = await response.json();
  } catch {
    console.info("No local fake camera loaded. Serve the dashboard over HTTP to use fake-camera.json.");
    return;
  }

  const prefix = topicPrefix(config || { topicPrefix: DEFAULT_TOPIC_PREFIX });
  const entries = Array.isArray(data) ? data : [data];

  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const id = String(entry.id || entry.deviceId || `fake-camera-${index + 1}`);
    const state = entry.state || entry.payload || entry;
    handleMqttMessage(`${prefix}/${id}/state`, JSON.stringify(state), { topicPrefix: prefix });
    console.info(`Loaded local fake camera: ${id}`);
  });

  render();
}
