// YIN pitch detection (de Cheveigné & Kawahara, 2002), tuned for guitar.
// Pure function, no DOM — also runs under Node for testing.

export function detectPitch(buf, sampleRate, { minFreq = 60, maxFreq = 1400, threshold = 0.12, minRms = 0.008 } = {}) {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < minRms) return { freq: 0, clarity: 0, rms };

  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(Math.floor(n / 2), Math.ceil(sampleRate / minFreq));
  const W = n - tauMax;
  const d = new Float32Array(tauMax + 1);

  // Difference function (from tau = 1 so the cumulative mean is exact).
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < W; i++) {
      const delta = buf[i] - buf[i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }
  // Cumulative mean normalised difference.
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? d[tau] * tau / running : 1;
  }

  // First dip below threshold, then walk to its local minimum.
  let tau = -1;
  for (let t = tauMin + 1; t < tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 < tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) {
    // No confident dip: take global minimum, but report low clarity.
    let best = tauMin;
    for (let t = tauMin; t <= tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
    if (cmnd[best] > 0.35) return { freq: 0, clarity: 1 - cmnd[best], rms };
    tau = best;
  }

  // Parabolic interpolation on the raw difference function.
  let betterTau = tau;
  if (tau > tauMin && tau < tauMax) {
    const s0 = d[tau - 1], s1 = d[tau], s2 = d[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) betterTau = tau + (s2 - s0) / denom;
  }
  return { freq: sampleRate / betterTau, clarity: 1 - cmnd[tau], rms };
}
