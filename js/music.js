// Shared music helpers: note math, tunings and a plucked-string synth.

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export const freqToMidi = (f, a4 = 440) => 69 + 12 * Math.log2(f / a4);
export const midiToFreq = (m, a4 = 440) => a4 * Math.pow(2, (m - 69) / 12);
export const noteName = (m) => NOTE_NAMES[((Math.round(m) % 12) + 12) % 12];
export const noteOctave = (m) => Math.floor(Math.round(m) / 12) - 1;
export const centsBetween = (f, ref) => 1200 * Math.log2(f / ref);

// MIDI numbers, low (6th) string first.
export const TUNINGS = {
  standard: { name: 'Standard  E A D G B E', notes: [40, 45, 50, 55, 59, 64] },
  halfDown: { name: 'Half-step down  E♭ A♭ D♭ G♭ B♭ E♭', notes: [39, 44, 49, 54, 58, 63] },
  dropD:    { name: 'Drop D  D A D G B E', notes: [38, 45, 50, 55, 59, 64] },
  dadgad:   { name: 'DADGAD', notes: [38, 45, 50, 55, 57, 62] },
  openG:    { name: 'Open G  D G D G B D', notes: [38, 43, 50, 55, 59, 62] },
  openD:    { name: 'Open D  D A D F♯ A D', notes: [38, 45, 50, 54, 57, 62] },
};

let ctx = null;
export function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Additive "pluck": harmonics with pluck-position weighting and faster decay
// for upper partials. Pitch is exact (unlike integer-delay Karplus-Strong),
// which matters because people tune against it by ear.
const bufferCache = new Map();
function pluckBuffer(c, freq, dur) {
  const key = freq.toFixed(3) + '|' + dur;
  if (bufferCache.has(key)) return bufferCache.get(key);
  const sr = c.sampleRate;
  const len = Math.floor(sr * dur);
  const buf = c.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const pluckPos = 0.18;
  const parts = [];
  for (let k = 1; k <= 16; k++) {
    const fk = freq * k;
    if (fk > sr / 2.2) break;
    const amp = Math.abs(Math.sin(Math.PI * k * pluckPos)) / (k * 0.85);
    const decay = 1.1 + 0.55 * k * (freq / 110);
    parts.push({ w: 2 * Math.PI * fk / sr, a: amp, r: Math.exp(-decay / sr), ph: Math.random() * 0.3 });
  }
  let peak = 0;
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (const p of parts) { s += p.a * Math.sin(p.w * i + p.ph); p.a *= p.r; }
    d[i] = s;
  }
  // Envelope pass: short attack + overall decay (cheaper than per-partial exp above).
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const att = Math.min(1, t / 0.004);
    d[i] *= att;
    peak = Math.max(peak, Math.abs(d[i]));
  }
  for (let i = 0; i < len; i++) d[i] /= peak || 1;
  bufferCache.set(key, buf);
  return buf;
}

export function pluck(freq, { gain = 0.5, dur = 2.6, when = 0 } = {}) {
  const c = audioCtx();
  const src = c.createBufferSource();
  // Render once per semitone and pitch-shift with playbackRate, so detuned
  // strings don't each need a freshly synthesised buffer.
  const base = midiToFreq(Math.round(freqToMidi(freq)));
  src.buffer = pluckBuffer(c, base, dur);
  src.playbackRate.value = freq / base;
  const g = c.createGain();
  const t0 = c.currentTime + when;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  src.connect(g).connect(c.destination);
  src.start(t0);
  src.stop(t0 + dur);
  return { stop: () => { try { g.gain.setTargetAtTime(0, c.currentTime, 0.03); src.stop(c.currentTime + 0.2); } catch {} } };
}
