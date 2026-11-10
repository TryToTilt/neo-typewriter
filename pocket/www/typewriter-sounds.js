/* Typewriter sounds for NEO Pocket.
 *
 * Unofficial add-on. Listens for typing in the editor and plays a short
 * synthesized key sound (Web Audio, no audio files): a clack for letters,
 * a deeper thunk for the space bar, a softer tap for backspace, and a
 * carriage-return slide with a bell on Enter.
 *
 * It never touches app.js. State lives in localStorage ("neoTypeSound").
 * window.neoTypeSound exposes get()/set() for the ⋯ sheet.
 */
(function () {
  'use strict';

  const KEY = 'neoTypeSound';
  const defaults = { on: true, vol: 0.6, bell: true };
  let cfg = Object.assign({}, defaults);
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) { /* private mode etc. */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (_) { /* ignore */ } };

  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (_) { return false; }
    master = ctx.createGain();
    master.gain.value = cfg.vol;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    // one second of white noise, reused for every click
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  const rnd = (a, b) => a + Math.random() * (b - a);

  // short filtered noise burst
  function burst(t, { freq, q, dur, gain, type = 'bandpass', sweepTo }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = rnd(0.9, 1.1);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, rnd(0, 0.5), dur + 0.02);
  }

  // short pitched thump
  function thump(t, { freq, dur, gain }) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function clack() {
    const t = ctx.currentTime;
    burst(t, { freq: rnd(2200, 3200), q: 1.2, dur: 0.035, gain: rnd(0.55, 0.8) });   // typebar strike
    burst(t + 0.012, { freq: rnd(900, 1300), q: 0.8, dur: 0.05, gain: 0.35 });       // paper/platen
    thump(t, { freq: rnd(130, 170), dur: 0.06, gain: 0.5 });
  }

  function space() {
    const t = ctx.currentTime;
    burst(t, { freq: 700, q: 0.7, dur: 0.06, gain: 0.55 });
    thump(t, { freq: rnd(90, 110), dur: 0.09, gain: 0.7 });
  }

  function back() {
    const t = ctx.currentTime;
    burst(t, { freq: rnd(1500, 1900), q: 1, dur: 0.03, gain: 0.4 });
    thump(t, { freq: rnd(110, 130), dur: 0.05, gain: 0.35 });
  }

  function bell(t) {
    // inharmonic partials give the "ting" of a small brass bell
    [[2350, 0.28], [4720, 0.12], [6430, 0.07]].forEach(([f, gain]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * rnd(0.998, 1.002);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 1.35);
    });
  }

  function enter() {
    const t = ctx.currentTime;
    burst(t, { freq: 600, q: 0.6, dur: 0.05, gain: 0.7 });                 // lever thunk
    thump(t, { freq: 100, dur: 0.1, gain: 0.7 });
    // carriage slide: noise sweeping down
    burst(t + 0.04, { freq: 3800, sweepTo: 700, q: 2, dur: 0.32, gain: 0.22 });
    burst(t + 0.38, { freq: 500, q: 0.7, dur: 0.05, gain: 0.5 });          // carriage stop
    if (cfg.bell) bell(t + 0.02);
  }

  const play = { clack, space, back, enter };

  function inEditor() {
    const ae = document.activeElement;
    if (!(ae && ae.isContentEditable)) return false;
    const menu = document.getElementById('pocket-menu');
    return !(menu && !menu.hidden);
  }

  let lastKeydown = 0;

  function onKeydown(e) {
    lastKeydown = Date.now();
    if (!cfg.on || e.repeat && e.key === 'Enter') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!inEditor()) return;
    const k = e.key;
    let kind = null;
    if (k === 'Enter') kind = 'enter';
    else if (k === ' ' || k === 'Spacebar') kind = 'space';
    else if (k === 'Backspace' || k === 'Delete') kind = 'back';
    else if (k && k.length === 1) kind = 'clack';
    else if (k === 'Tab') kind = 'clack';
    if (!kind || !ensure()) return;
    play[kind]();
  }

  // On-screen keyboards often send keydown with key "Unidentified" (or none
  // at all); fall back to the input event so they still make noise.
  function onBeforeInput(e) {
    if (!cfg.on || Date.now() - lastKeydown < 60) return;
    if (!inEditor()) return;
    const it = e.inputType || '';
    let kind = null;
    if (it === 'insertParagraph' || it === 'insertLineBreak') kind = 'enter';
    else if (it.startsWith('delete')) kind = 'back';
    else if (it.startsWith('insert')) kind = e.data === ' ' ? 'space' : 'clack';
    if (!kind || !ensure()) return;
    play[kind]();
  }

  // a browser won't make sound until the page has been touched or typed on
  const unlock = () => { ensure(); };
  document.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('beforeinput', onBeforeInput, true);

  window.neoTypeSound = {
    get: () => Object.assign({}, cfg),
    set(patch) {
      Object.assign(cfg, patch);
      if (master) master.gain.value = cfg.vol;
      save();
      // a short sample so a change can be heard right away
      if (cfg.on && ensure()) clack();
    }
  };
})();
