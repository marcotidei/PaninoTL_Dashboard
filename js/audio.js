let audioCtx = null;
let audioPrimed = false;
let shutterAudio = null;
let errorAudio = null;
let soundMode = localStorage.getItem("soundMode") || "on";
if (soundMode !== "on" && soundMode !== "off") soundMode = "on";

function ensureAudioReady() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function primeAudioFromGesture() {
  if (soundMode !== "on") return;
  const ctx = ensureAudioReady();
  if (!shutterAudio && typeof Audio !== "undefined") {
    shutterAudio = new Audio("audio/shutter.wav");
    shutterAudio.preload = "auto";
  }
  if (!errorAudio && typeof Audio !== "undefined") {
    errorAudio = new Audio("audio/error.wav");
    errorAudio.preload = "auto";
  }

  try {
    if (ctx) {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.00001, now + 0.03);
      osc.frequency.setValueAtTime(440, now);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    }
    audioPrimed = true;
  } catch (err) {
    console.warn("Audio priming failed:", err);
  }
}

function playGeneratedImageSuccessSound() {
  if (soundMode !== "on") return;
  const ctx = ensureAudioReady();
  if (!ctx || ctx.state === "suspended" || !audioPrimed) return;

  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
  master.connect(ctx.destination);

  [
    { freq: 740, start: 0.00, dur: 0.16 },
    { freq: 988, start: 0.13, dur: 0.22 }
  ].forEach(note => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(note.freq, now + note.start);
    gain.gain.setValueAtTime(0.0001, now + note.start);
    gain.gain.exponentialRampToValueAtTime(1, now + note.start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now + note.start);
    osc.stop(now + note.start + note.dur + 0.03);
  });
}

function playImageSuccessSound() {
  if (soundMode !== "on" || !audioPrimed) return;

  if (shutterAudio) {
    try {
      shutterAudio.pause();
      shutterAudio.currentTime = 0;
      const play = shutterAudio.play();
      if (play && typeof play.catch === "function") {
        play.catch(() => playGeneratedImageSuccessSound());
      }
      return;
    } catch {
      // Fall back to generated sound below.
    }
  }

  playGeneratedImageSuccessSound();
}

function playGeneratedErrorSound() {
  if (soundMode !== "on") return;
  const ctx = ensureAudioReady();
  if (!ctx || ctx.state === "suspended" || !audioPrimed) return;

  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.1, now + 0.01);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
  master.connect(ctx.destination);

  [
    { freq: 392, start: 0.00, dur: 0.22 },
    { freq: 294, start: 0.24, dur: 0.28 }
  ].forEach(note => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(note.freq, now + note.start);
    gain.gain.setValueAtTime(0.0001, now + note.start);
    gain.gain.exponentialRampToValueAtTime(1, now + note.start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now + note.start);
    osc.stop(now + note.start + note.dur + 0.03);
  });
}

function playErrorSound() {
  if (soundMode !== "on" || !audioPrimed) return;

  if (errorAudio) {
    try {
      errorAudio.pause();
      errorAudio.currentTime = 0;
      const play = errorAudio.play();
      if (play && typeof play.catch === "function") {
        play.catch(() => playGeneratedErrorSound());
      }
      return;
    } catch {
      // Fall back to generated sound below.
    }
  }

  playGeneratedErrorSound();
}
