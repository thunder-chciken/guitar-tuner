import { detectPitch } from './pitch.js';
import { TUNINGS, freqToMidi, midiToFreq, noteName, noteOctave, centsBetween, pluck, audioCtx } from './music.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('fw.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('fw.' + k, JSON.stringify(v)); } catch {} },
};

const state = {
  tuning: store.get('tuning', 'standard'),
  a4: store.get('a4', 440),
  locked: -1,          // -1 = auto-detect string, otherwise string index (0 = low string)
  refTone: false,
  running: false,
  needle: 0,
  history: [],
  lastHeard: 0,
  goodSince: 0,
  done: new Set(),
  activeIdx: -2,
};

// ---------- Gauge ----------
const CX = 160, CY = 176, SPAN = 60; // ±50¢ → ±60°
const polar = (deg, r) => {
  const a = deg * Math.PI / 180;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
};
(function drawGauge() {
  const g = $('ticks');
  let html = '';
  for (let c = -50; c <= 50; c += 5) {
    const deg = c / 50 * SPAN;
    const major = c % 25 === 0;
    const [x1, y1] = polar(deg, major ? 118 : 124);
    const [x2, y2] = polar(deg, 134);
    html += `<line class="tick${major ? ' major' : ''}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    if (major && c !== 0) {
      const [tx, ty] = polar(deg, 104);
      html += `<text class="scale-label" x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}">${c > 0 ? '+' : ''}${c}</text>`;
    }
  }
  g.innerHTML = html;
  const [zx1, zy1] = polar(-6, 146), [zx2, zy2] = polar(6, 146);
  $('zone').setAttribute('d', `M${zx1.toFixed(1)} ${zy1.toFixed(1)} A146 146 0 0 1 ${zx2.toFixed(1)} ${zy2.toFixed(1)}`);
})();

// ---------- Controls ----------
const tuningSel = $('tuning');
const shortName = (key) => key === 'chromatic' ? 'Chromatic' : TUNINGS[key].name.split('  ')[0];
for (const [key, t] of Object.entries(TUNINGS)) tuningSel.add(new Option(t.name.replace('  ', ' · '), key));
tuningSel.add(new Option('Chromatic (any note)', 'chromatic'));
if (!TUNINGS[state.tuning] && state.tuning !== 'chromatic') state.tuning = 'standard';
tuningSel.value = state.tuning;
function showTuning() {
  $('tuningLabel').textContent = shortName(state.tuning);
  const notes = stringNotes();
  $('sub').textContent = notes ? notes.map(noteName).join(' ') : 'Any note';
}
tuningSel.addEventListener('change', () => {
  state.tuning = tuningSel.value; store.set('tuning', state.tuning);
  state.locked = -1; state.done.clear(); showTuning(); renderChips();
});

const a4Sel = $('a4');
for (let f = 430; f <= 450; f++) a4Sel.add(new Option(`A = ${f} Hz${f === 440 ? ' (standard)' : ''}`, f));
function setA4(v) {
  state.a4 = Math.min(450, Math.max(430, v)); store.set('a4', state.a4);
  a4Sel.value = state.a4;
  $('a4Label').textContent = `A = ${state.a4} Hz`;
}
setA4(state.a4);
a4Sel.addEventListener('change', () => setA4(+a4Sel.value));

function setMode(manual) {
  const notes = stringNotes();
  state.locked = manual && notes ? (state.locked >= 0 ? state.locked : 0) : -1;
  renderChips();
}
$('modeAuto').onclick = () => setMode(false);
$('modeManual').onclick = () => setMode(true);

const stringNotes = () => (state.tuning === 'chromatic' ? null : TUNINGS[state.tuning].notes);

function renderChips() {
  const notes = stringNotes();
  const row = $('chips');
  row.innerHTML = '';
  $('modeAuto').setAttribute('aria-pressed', state.locked === -1);
  $('modeManual').setAttribute('aria-pressed', state.locked !== -1);
  if (!notes) {
    $('hint').textContent = 'Chromatic mode shows the nearest note for anything you play.';
    return;
  }
  $('hint').textContent = state.locked === -1
    ? 'Tap a string to hear how it should sound.'
    : `Tuning string ${6 - state.locked} only. Tap another string to switch.`;
  notes.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = 'chip' + (state.locked === i ? ' locked' : '') + (state.done.has(i) ? ' done' : '') + (state.activeIdx === i ? ' active' : '');
    b.dataset.i = i;
    b.innerHTML = `<b>${noteName(m)}</b><small>${6 - i}${['th','th','th','rd','nd','st'][i]}</small>`;
    b.setAttribute('aria-label', `String ${6 - i}, ${noteName(m)}${noteOctave(m)}. Plays reference note.`);
    b.onclick = () => {
      pluck(midiToFreq(m, state.a4), { gain: 0.6 });
      if (state.locked !== -1) state.locked = i;
      renderChips();
    };
    row.appendChild(b);
  });
}
showTuning();
renderChips();

// ---------- Audio ----------
let analyser, buf, stream, wakeLock;

async function start() {
  $('err').textContent = '';
  const ctx = audioCtx();
  const demo = new URLSearchParams(location.search).get('demo');
  let source;
  try {
    if (demo) {
      source = demoSource(ctx, parseFloat(demo) || 82.41);
    } else {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('insecure');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      source = ctx.createMediaStreamSource(stream);
    }
  } catch (e) {
    $('err').textContent = e.message === 'insecure'
      ? 'Microphone needs a secure (https://) page. Open the hosted version of this app.'
      : 'Microphone access was blocked. Allow it in your browser’s site settings, then try again.';
    return;
  }
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 0.5;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 55;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  buf = new Float32Array(analyser.fftSize);
  source.connect(hp).connect(lp).connect(analyser);
  state.running = true;
  $('gate').hidden = true;
  keepAwake();
  requestAnimationFrame(loop);
}

// ?demo=<Hz> feeds a synthetic, slowly-drifting guitar-like tone so the UI can be tested without a mic.
function demoSource(ctx, hz) {
  const osc = ctx.createOscillator();
  const real = new Float32Array(10), imag = new Float32Array(10);
  for (let k = 1; k < 10; k++) imag[k] = Math.abs(Math.sin(Math.PI * k * 0.18)) / k;
  osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
  osc.frequency.value = hz;
  const lfo = ctx.createOscillator(), depth = ctx.createGain();
  lfo.frequency.value = 0.08; depth.gain.value = 18; // ±18 cents drift
  lfo.connect(depth).connect(osc.detune);
  const g = ctx.createGain(); g.gain.value = 0.3;
  osc.connect(g); osc.start(); lfo.start();
  return g;
}

async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.running) { keepAwake(); audioCtx(); }
});

$('startBtn').onclick = start;

// ---------- Main loop ----------
function median(a) { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }

function loop(now) {
  if (!state.running) return;
  analyser.getFloatTimeDomainData(buf);
  const { freq, clarity } = detectPitch(buf, audioCtx().sampleRate);

  if (freq > 0 && clarity > 0.86) {
    state.history.push(freq);
    if (state.history.length > 5) state.history.shift();
    state.lastHeard = now;
    update(median(state.history), now);
  } else if (now - state.lastHeard > 900) {
    state.history = [];
    idle();
  }
  requestAnimationFrame(loop);
}

function target(freq) {
  const notes = stringNotes();
  if (!notes) {
    const m = Math.round(freqToMidi(freq, state.a4));
    return { midi: m, idx: -1 };
  }
  if (state.locked >= 0) return { midi: notes[state.locked], idx: state.locked };
  let best = 0, bestDist = Infinity;
  notes.forEach((m, i) => {
    const dist = Math.abs(centsBetween(freq, midiToFreq(m, state.a4)));
    if (dist < bestDist) { bestDist = dist; best = i; }
  });
  return { midi: notes[best], idx: best };
}

function update(freq, now) {
  const t = target(freq);
  const cents = centsBetween(freq, midiToFreq(t.midi, state.a4));
  state.needle += (Math.max(-55, Math.min(55, cents)) - state.needle) * 0.35;
  $('needle').style.transform = `rotate(${(state.needle / 50 * SPAN).toFixed(2)}deg)`;
  $('note').innerHTML = `${noteName(t.midi)}<sub>${noteOctave(t.midi)}</sub>`;
  $('hz').textContent = freq.toFixed(1) + ' Hz';
  $('cents').textContent = Math.abs(cents) >= 100
    ? (cents >= 0 ? '+' : '−') + Math.round(Math.abs(cents) / 100) + ' semitones'
    : (cents >= 0 ? '+' : '−') + Math.abs(cents).toFixed(0) + ' cents';

  const abs = Math.abs(cents);
  let st, msg;
  if (abs <= 4) { st = 'good'; msg = 'In tune'; }
  else if (cents < 0) { st = 'flat'; msg = abs > 60 ? 'Way too low · Tighten' : 'Too low · Tighten'; }
  else { st = 'sharp'; msg = abs > 60 ? 'Way too high · Loosen' : 'Too high · Loosen'; }
  document.body.dataset.state = st;
  $('status').textContent = msg;

  if (st === 'good') {
    if (!state.goodSince) state.goodSince = now;
    if (now - state.goodSince > 500 && t.idx >= 0 && !state.done.has(t.idx)) {
      state.done.add(t.idx);
      navigator.vibrate?.(35);
      renderChips();
    }
  } else state.goodSince = 0;

  if (t.idx !== state.activeIdx) {
    state.activeIdx = t.idx;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', +c.dataset.i === t.idx));
  }
}

function idle() {
  if (document.body.dataset.state === 'idle') return;
  document.body.dataset.state = 'idle';
  $('status').textContent = 'Listening…';
  state.goodSince = 0;
}

// ---------- Install prompt ----------
let deferred;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferred = e; $('installBtn').hidden = false;
});
$('installBtn').onclick = async () => {
  if (!deferred) return;
  deferred.prompt(); await deferred.userChoice; deferred = null; $('installBtn').hidden = true;
};
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) {
  $('installTip').hidden = false;
  $('installTip').innerHTML = '<span style="font-size:22px">📲</span><span>Add this tuner to your Home Screen: tap <b>Share</b>, then <b>Add to Home Screen</b>. It works offline.</span>';
}
