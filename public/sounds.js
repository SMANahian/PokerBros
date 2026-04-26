'use strict';
/* Web Audio API sound engine — no external files required */

const Sounds = (() => {
  let ctx = null;
  let muted = false;

  function init() {
    if (ctx) return;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function isMuted() { return muted; }
  function setMuted(v) { muted = v; }

  /* ── Low-level helpers ──────────────────────────────────────────────── */

  function noise(duration, gainVal = 0.25) {
    if (!ctx || muted) return;
    const len = Math.ceil(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    src.connect(g); g.connect(ctx.destination);
    src.start(ctx.currentTime);
    src.stop(ctx.currentTime + duration);
    return { src, gain: g };
  }

  function tone(freq, duration, gainVal = 0.15, type = 'sine') {
    if (!ctx || muted) return;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gainVal, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
    return { osc, gain: g };
  }

  function bandNoise(freq, q, duration, gainVal = 0.2) {
    if (!ctx || muted) return;
    const len = Math.ceil(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    src.connect(filt); filt.connect(g); g.connect(ctx.destination);
    src.start(ctx.currentTime);
    src.stop(ctx.currentTime + duration);
  }

  /* ── Game sounds ────────────────────────────────────────────────────── */

  // Short paper-swoosh card deal
  function cardDeal() {
    if (!ctx || muted) return;
    // Filtered noise burst
    const len = Math.ceil(ctx.sampleRate * 0.09);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * (1 - t) * (1 - t);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hi = ctx.createBiquadFilter();
    hi.type = 'highpass';
    hi.frequency.value = 3000;
    const g = ctx.createGain();
    g.gain.value = 0.35;
    src.connect(hi); hi.connect(g); g.connect(ctx.destination);
    src.start(ctx.currentTime);
    // Tiny pitch-bent tone for snap
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(900, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.07);
    og.gain.setValueAtTime(0.08, ctx.currentTime);
    og.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.07);
    osc.connect(og); og.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.07);
    src.stop(ctx.currentTime + 0.09);
  }

  // Multiple chip clinks (bet / call)
  function chips(count = 3) {
    if (!ctx || muted) return;
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + i * 0.055;
      const freq = 520 + Math.random() * 180;
      const osc  = ctx.createOscillator();
      const g    = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.07);
      // harmonic
      const osc2 = ctx.createOscillator();
      const g2   = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.value = freq * 1.5;
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.linearRampToValueAtTime(0.1, t + 0.004);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      osc2.connect(g2); g2.connect(ctx.destination);
      osc2.start(t); osc2.stop(t + 0.06);
    }
  }

  // Bigger chip pile for raise
  function chipRaise() {
    if (!ctx || muted) return;
    chips(5);
    // Add a low thud
    const t = ctx.currentTime + 0.12;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.15);
  }

  // Soft tap for check
  function check() {
    if (!ctx || muted) return;
    bandNoise(800, 2, 0.06, 0.15);
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 280;
    g.gain.setValueAtTime(0.1, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.06);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.07);
  }

  // Card slide away (fold)
  function fold() {
    if (!ctx || muted) return;
    const len = Math.ceil(ctx.sampleRate * 0.18);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 1.5) * 0.8;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4000, ctx.currentTime);
    lp.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.18);
    const g = ctx.createGain();
    g.gain.value = 0.3;
    src.connect(lp); lp.connect(g); g.connect(ctx.destination);
    src.start(ctx.currentTime);
    src.stop(ctx.currentTime + 0.19);
  }

  // All-in — dramatic woosh + rising tone
  function allIn() {
    if (!ctx || muted) return;
    chips(8);
    const t = ctx.currentTime + 0.05;
    // Rising sweep
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.35);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    const dist = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) curve[i] = ((i / 128) - 1) < 0 ? -0.5 : 0.5;
    dist.curve = curve;
    osc.connect(dist); dist.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.4);
  }

  // Win — celebratory ascending arpeggio
  function win() {
    if (!ctx || muted) return;
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((f, i) => {
      const t   = ctx.currentTime + i * 0.11;
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.02);
      g.gain.setValueAtTime(0.18, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.32);
      // soft overtone
      const osc2 = ctx.createOscillator();
      const g2   = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.value = f * 2;
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.linearRampToValueAtTime(0.06, t + 0.02);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc2.connect(g2); g2.connect(ctx.destination);
      osc2.start(t); osc2.stop(t + 0.22);
    });
  }

  // Your turn — two-note ping
  function yourTurn() {
    if (!ctx || muted) return;
    [880, 1109].forEach((f, i) => {
      const t   = ctx.currentTime + i * 0.13;
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.23);
    });
  }

  // Shuffle (new hand) — rapid card flips
  function shuffle() {
    if (!ctx || muted) return;
    for (let i = 0; i < 6; i++) {
      setTimeout(() => cardDeal(), i * 50);
    }
  }

  return { init, resume, isMuted, setMuted, cardDeal, chips, chipRaise, check, fold, allIn, win, yourTurn, shuffle };
})();
