// Jazzicon（@metamask/jazzicon 同算法）：官方 Identicon 用 Jazzicon(16, parseInt(account.slice(2, 10), 16))。
class MT {
  constructor(seed) { this.mt = new Array(624); this.mti = 625; this.init(seed); }
  init(s) { const mt = this.mt; mt[0] = s >>> 0; for (this.mti = 1; this.mti < 624; this.mti++) { const p = mt[this.mti - 1] ^ (mt[this.mti - 1] >>> 30); mt[this.mti] = (((((p & 0xffff0000) >>> 16) * 1812433253) << 16) + (p & 0x0000ffff) * 1812433253) + this.mti; mt[this.mti] >>>= 0; } }
  int() {
    let y; const mag = [0, 0x9908b0df], mt = this.mt;
    if (this.mti >= 624) {
      let k;
      for (k = 0; k < 227; k++) { y = (mt[k] & 0x80000000) | (mt[k + 1] & 0x7fffffff); mt[k] = mt[k + 397] ^ (y >>> 1) ^ mag[y & 1]; }
      for (; k < 623; k++) { y = (mt[k] & 0x80000000) | (mt[k + 1] & 0x7fffffff); mt[k] = mt[k - 227] ^ (y >>> 1) ^ mag[y & 1]; }
      y = (mt[623] & 0x80000000) | (mt[0] & 0x7fffffff); mt[623] = mt[396] ^ (y >>> 1) ^ mag[y & 1]; this.mti = 0;
    }
    y = mt[this.mti++]; y ^= y >>> 11; y ^= (y << 7) & 0x9d2c5680; y ^= (y << 15) & 0xefc60000; y ^= y >>> 18; return y >>> 0;
  }
  random() { return this.int() * (1.0 / 4294967296.0); }
}
const COLORS = ["#01888C", "#FC7500", "#034F5D", "#F73F01", "#FC1960", "#C7144C", "#F3C100", "#1598F2", "#2465E1", "#F19E02"];
function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255; const min = Math.min(r, g, b), max = Math.max(r, g, b), d = max - min; let h, s;
  if (max === min) h = 0; else if (r === max) h = (g - b) / d; else if (g === max) h = 2 + (b - r) / d; else h = 4 + (r - g) / d;
  h = Math.min(h * 60, 360); if (h < 0) h += 360; const l = (min + max) / 2;
  if (max === min) s = 0; else if (l <= 0.5) s = d / (max + min); else s = d / (2 - max - min);
  return [h, s * 100, l * 100];
}
function hsl2rgb([h, s, l]) {
  h /= 360; s /= 100; l /= 100; if (s === 0) { const v = l * 255; return [v, v, v]; }
  const t2 = l < 0.5 ? l * (1 + s) : l + s - l * s, t1 = 2 * l - t2, out = [];
  for (let i = 0; i < 3; i++) { let t3 = h + 1 / 3 * -(i - 1); if (t3 < 0) t3++; if (t3 > 1) t3--; let v;
    if (6 * t3 < 1) v = t1 + (t2 - t1) * 6 * t3; else if (2 * t3 < 1) v = t2; else if (3 * t3 < 2) v = t1 + (t2 - t1) * (2 / 3 - t3) * 6; else v = t1; out[i] = v * 255; }
  return out;
}
const hex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0").toUpperCase()).join("");
function rotate(hexStr, deg) {
  const rgb = [1, 3, 5].map((i) => parseInt(hexStr.slice(i, i + 2), 16));
  const hsl = rgb2hsl(rgb).map((v) => Math.round(v)); let h = (hsl[0] + deg) % 360; if (h < 0) h += 360;
  return hex(hsl2rgb([h, hsl[1], hsl[2]]));
}
export function jazziconHtml(account, diameter = 16) {
  const gen = new MT(parseInt(String(account).slice(2, 10), 16));
  const amount = gen.random() * 30 - 15;
  const remaining = COLORS.map((c) => rotate(c, amount));
  const pick = () => { gen.random(); const idx = Math.floor(remaining.length * gen.random()); return remaining.splice(idx, 1)[0]; };
  const bg = pick(); const center = diameter / 2; let rects = "";
  for (let i = 0; i < 3; i++) {
    const firstRot = gen.random(), angle = Math.PI * 2 * firstRot, velocity = diameter / 3 * gen.random() + (i * diameter / 3);
    const tx = Math.cos(angle) * velocity, ty = Math.sin(angle) * velocity, secondRot = gen.random(), rot = firstRot * 360 + secondRot * 180;
    rects += '<rect x="0" y="0" width="' + diameter + '" height="' + diameter + '" transform="translate(' + tx + " " + ty + ") rotate(" + rot.toFixed(1) + " " + center + " " + center + ')" fill="' + pick() + '"></rect>';
  }
  const r = parseInt(bg.slice(1, 3), 16), g = parseInt(bg.slice(3, 5), 16), b = parseInt(bg.slice(5, 7), 16);
  return '<div style="border-radius: 50px; overflow: hidden; padding: 0px; margin: 0px; width: ' + diameter + 'px; height: ' + diameter + 'px; display: inline-block; background: rgb(' + r + ", " + g + ", " + b + ');"><svg x="0" y="0" width="' + diameter + '" height="' + diameter + '">' + rects + "</svg></div>";
}
