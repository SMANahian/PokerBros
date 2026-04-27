'use strict';
/* Web Audio API — authentic poker/casino sounds, no external files */

const Sounds = (() => {
  let ctx    = null;
  let master = null;
  let muted  = false;

  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createDynamicsCompressor();
      master.threshold.value = -3;
      master.knee.value      = 3;
      master.ratio.value     = 20;
      master.attack.value    = 0.001;
      master.release.value   = 0.1;
      master.connect(ctx.destination);
    } catch (e) {}
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function isMuted()    { return muted; }
  function setMuted(v)  { muted = v; }
  function out()        { return master || ctx.destination; }

  /* ── Primitives ────────────────────────────────────────────────────── */

  // White-noise buffer through a filter
  function noiseBuf(duration, freqStart, freqEnd, filterType, gainVal, t) {
    const len = Math.ceil(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src  = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type  = filterType;
    filt.frequency.setValueAtTime(freqStart, t);
    if (freqEnd !== freqStart) filt.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filt); filt.connect(g); g.connect(out());
    src.start(t); src.stop(t + duration + 0.01);
  }

  // Sine tone with attack / decay
  function sineTone(freq, t, duration, peak, freqEnd) {
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g); g.connect(out());
    osc.start(t); osc.stop(t + duration + 0.01);
  }

  /* ── Single chip click (ceramic/clay ring) ─────────────────────────── */
  function _chip(t) {
    if (!ctx) return;

    // Sharp contact transient
    const len = Math.ceil(ctx.sampleRate * 0.007);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp  = ctx.createBiquadFilter();
    hp.type   = 'highpass';
    hp.frequency.value = 3800;
    const ng  = ctx.createGain();
    ng.gain.value = 0.35;
    src.connect(hp); hp.connect(ng); ng.connect(out());
    src.start(t);

    // Metallic ring: fundamental + inharmonic partials
    const base = 1100 + Math.random() * 420;
    [[1.0, 0.16], [2.1, 0.07], [3.4, 0.035]].forEach(([mult, pk]) => {
      sineTone(base * mult, t, 0.072, pk);
    });
  }

  /* ── Game sounds ────────────────────────────────────────────────────── */

  // Call / small bet — a few chips
  function chips(count = 3) {
    if (!ctx || muted) return;
    const n = Math.min(count, 8);
    for (let i = 0; i < n; i++) _chip(ctx.currentTime + i * 0.058);
  }

  // Raise — larger stack + low thud as pile lands on felt
  function chipRaise() {
    if (!ctx || muted) return;
    const n = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) _chip(ctx.currentTime + i * 0.046);
    const t = ctx.currentTime + 0.09;
    sineTone(140, t, 0.16, 0.22, 55);
  }

  // Card dealt onto felt — swish + snap
  function cardDeal() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;

    // Paper swish: shaped highpass noise
    const len = Math.ceil(ctx.sampleRate * 0.055);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = (i / len < 0.15) ? (i / len) / 0.15 : Math.pow(1 - (i / len - 0.15) / 0.85, 2);
      d[i] = (Math.random() * 2 - 1) * env;
    }
    const src  = ctx.createBufferSource();
    src.buffer = buf;
    const hp   = ctx.createBiquadFilter();
    hp.type    = 'highpass';
    hp.frequency.setValueAtTime(2600, t);
    hp.frequency.linearRampToValueAtTime(1300, t + 0.055);
    const g = ctx.createGain();
    g.gain.value = 0.26;
    src.connect(hp); hp.connect(g); g.connect(out());
    src.start(t); src.stop(t + 0.065);

    // Snap tone at landing
    sineTone(750, t + 0.033, 0.045, 0.055, 280);
  }

  // Check — knuckle tap on felt-covered table
  function check() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    sineTone(220, t, 0.11, 0.13, 95);

    // Brief surface transient
    const len = Math.ceil(ctx.sampleRate * 0.011);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src  = ctx.createBufferSource();
    src.buffer = buf;
    const bp   = ctx.createBiquadFilter();
    bp.type    = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 1.4;
    const ng   = ctx.createGain();
    ng.gain.value = 0.10;
    src.connect(bp); bp.connect(ng); ng.connect(out());
    src.start(t);
  }

  // Fold — cards sliding into the muck
  function fold() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    noiseBuf(0.16, 3500, 900, 'lowpass', 0.20, t);
    // Soft thud as cards land
    sineTone(180, t + 0.10, 0.10, 0.09, 75);
  }

  // All-in — cascade of chips + heavy thud + rising swoosh
  function allIn() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 8; i++) _chip(t + i * 0.036);
    const tt = t + 0.14;
    sineTone(100, tt, 0.20, 0.26, 40);
    noiseBuf(0.30, 200, 1800, 'bandpass', 0.14, tt);
  }

  // Win — ascending bell arpeggio + chip rake
  function win() {
    if (!ctx || muted) return;
    const t     = ctx.currentTime;
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      const nt  = t + i * 0.12;
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type  = 'triangle';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.001, nt);
      g.gain.linearRampToValueAtTime(0.15, nt + 0.014);
      g.gain.setValueAtTime(0.15, nt + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, nt + 0.38);
      osc.connect(g); g.connect(out());
      osc.start(nt); osc.stop(nt + 0.4);
      sineTone(freq * 2, nt, 0.24, 0.05);
    });
    // Chip rake — pot being pulled in
    const rake = t + 0.58;
    for (let i = 0; i < 6; i++) _chip(rake + i * 0.030);
  }

  // Your turn — two-note ascending chime (A5 → C#6)
  function yourTurn() {
    if (!ctx || muted) return;
    [880, 1109].forEach((freq, i) => {
      const nt = ctx.currentTime + i * 0.13;
      sineTone(freq, nt, 0.26, 0.13);
    });
  }

  // Shuffle — riffle: two bursts of card snaps
  function shuffle() {
    if (!ctx || muted) return;
    for (let i = 0; i < 7; i++) setTimeout(() => cardDeal(), i * 44);
    for (let i = 0; i < 7; i++) setTimeout(() => cardDeal(), 380 + i * 44);
  }

  return { init, resume, isMuted, setMuted, cardDeal, chips, chipRaise, check, fold, allIn, win, yourTurn, shuffle };
})();
