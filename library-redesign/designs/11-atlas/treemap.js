// Squarified treemap (Bruls, Huizing & van Wijk): values (sorted, largest first) → rects in {x,y,w,h}.
export function squarify(values, { x, y, w, h }) {
  const n = values.length, out = new Array(n);
  const total = values.reduce((a, b) => a + b, 0);
  if (!n || total <= 0 || w <= 0 || h <= 0) return values.map(() => ({ x, y, w: 0, h: 0 }));
  const areas = values.map(v => v * (w * h) / total);
  const worst = (s, min, max, side) => Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  let i = 0;
  while (i < n) {
    const side = Math.min(w, h);
    let sum = areas[i], min = areas[i], max = areas[i], best = worst(sum, min, max, side), j = i + 1;
    while (j < n) {
      const a = areas[j], s = sum + a, mn = Math.min(min, a), mx = Math.max(max, a), r = worst(s, mn, mx, side);
      if (r > best) break;
      best = r; sum = s; min = mn; max = mx; j++;
    }
    if (j === n) sum = Math.max(sum, 1e-9);
    if (w >= h) {
      const cw = j === n ? w : sum / h; let yy = y;
      for (let k = i; k < j; k++) { const hh = k === j - 1 ? y + h - yy : areas[k] / cw; out[k] = { x, y: yy, w: cw, h: hh }; yy += hh; }
      x += cw; w -= cw;
    } else {
      const rh = j === n ? h : sum / w; let xx = x;
      for (let k = i; k < j; k++) { const ww = k === j - 1 ? x + w - xx : areas[k] / rh; out[k] = { x: xx, y, w: ww, h: rh }; xx += ww; }
      y += rh; h -= rh;
    }
    i = j;
  }
  return out;
}
