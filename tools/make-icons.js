// =====================================================================
// Duckling's Journey - 앱 아이콘/시작 화면 이미지 만들기 (외부 라이브러리 없이 PNG 직접 생성)
// 사용법: node tools/make-icons.js <안드로이드 res 폴더>
// =====================================================================
const fs = require('fs'), path = require('path'), zlib = require('zlib');

// ---------- PNG 인코더 ----------
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 아주 작은 그리기 도구 (4배 슈퍼샘플링으로 부드럽게) ----------
const hex = h => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
function draw(size, mode) {
  const SS = 4, W = size * SS, buf = new Float32Array(W * W * 4);
  const blend = (i, [r, g, b], a) => { const o = buf[i + 3]; buf[i] = r * a + buf[i] * (1 - a); buf[i + 1] = g * a + buf[i + 1] * (1 - a); buf[i + 2] = b * a + buf[i + 2] * (1 - a); buf[i + 3] = a + o * (1 - a); };
  // 모양 좌표는 0~1. fg(적응형 아이콘 앞면)·splash 는 가운데로 줄여서 안전 영역 안에
  const k = mode === 'fg' ? 0.6 : mode === 'splash' ? 0.9 : 1, off = (1 - k) / 2;
  const X = v => (off + v * k) * W, R = v => v * k * W;
  // 정규화 좌표(0~1)에서 test(u, v)가 참인 곳을 칠함 (bbox 안만 검사)
  const fill = (bx0, by0, bx1, by1, test, col, alpha = 1) => {
    const c = hex(col);
    const x0 = Math.max(0, Math.floor(X(bx0))), x1 = Math.min(W - 1, Math.ceil(X(bx1))), y0 = Math.max(0, Math.floor(X(by0))), y1 = Math.min(W - 1, Math.ceil(X(by1)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const u = ((x + 0.5) / W - off) / k, v = ((y + 0.5) / W - off) / k;
      if (test(u, v)) blend((y * W + x) * 4, c, alpha);
    }
  };
  const ellipse = (cx, cy, rx, ry, col, rot = 0, alpha = 1) => {
    const cs = Math.cos(rot), sn = Math.sin(rot), m = Math.max(rx, ry);
    fill(cx - m, cy - m, cx + m, cy + m, (u, v) => { const dx = u - cx, dy = v - cy, a = (dx * cs + dy * sn) / rx, b = (-dx * sn + dy * cs) / ry; return a * a + b * b <= 1; }, col, alpha);
  };
  const INK = 0x5a4632;
  const outlined = (cx, cy, rx, ry, col, t = 0.02, rot = 0) => { ellipse(cx, cy, rx + t, ry + t, INK, rot); ellipse(cx, cy, rx, ry, col, rot); };
  const heart = (cx, cy, r, col) => fill(cx - r * 1.3, cy - r * 1.3, cx + r * 1.3, cy + r * 1.3, (u, v) => { const x = (u - cx) / r, y = -(v - cy) / r + 0.15; const q = x * x + y * y - 1; return q * q * q - x * x * y * y * y <= 0; }, col);
  const sparkle = (cx, cy, r, col) => fill(cx - r, cy - r, cx + r, cy + r, (u, v) => { const x = Math.abs(u - cx) / r, y = Math.abs(v - cy) / r; return Math.sqrt(x) + Math.sqrt(y) <= 1; }, col);
  // 배경: 파스텔 하늘 → 물 (앞면/시작 화면은 투명)
  if (mode === 'full' || mode === 'round') {
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const v = y / W, t = Math.min(1, v / 0.72);
      const col = v < 0.74 ? [255 - t * 70, 226 + t * 6, 240 + t * 15] : [104, 190, 240];   // 분홍빛 하늘 → 하늘색, 아래는 물
      if (mode === 'round') { const dx = x / W - 0.5, dy = y / W - 0.5; if (dx * dx + dy * dy > 0.25) continue; }
      else { const r = 0.2, cx = Math.min(Math.max(x / W, r), 1 - r), cy = Math.min(Math.max(y / W, r), 1 - r); if ((x / W - cx) ** 2 + (y / W - cy) ** 2 > r * r) continue; }
      blend((y * W + x) * 4, col, 1);
    }
    for (const [cx, cy] of [[0.14, 0.86], [0.86, 0.9]]) ellipse(cx, cy, 0.08, 0.016, 0xd6f2ff);   // 물결
    sparkle(0.16, 0.2, 0.06, 0xffffff); sparkle(0.84, 0.3, 0.045, 0xfff3a8); sparkle(0.12, 0.5, 0.03, 0xffffff);
    heart(0.84, 0.13, 0.055, 0xff7fa8);
  }
  // 🐥 정면을 보는 통통한 아기 오리 + 튜브
  outlined(0.5, 0.8, 0.37, 0.1, 0xff5a64, 0.02);                      // 튜브
  for (const sx of [0.2, 0.5, 0.8]) ellipse(sx, 0.81, 0.05, 0.075, 0xffffff);
  outlined(0.23, 0.66, 0.08, 0.05, 0xffc93c, 0.018, -0.7);            // 날개 (양옆으로 파닥)
  outlined(0.77, 0.66, 0.08, 0.05, 0xffc93c, 0.018, 0.7);
  outlined(0.5, 0.7, 0.28, 0.16, 0xffdb4d);                           // 몸통
  outlined(0.47, 0.17, 0.03, 0.065, 0xffdb4d, 0.014, -0.35);          // 머리 깃털 세 가닥
  outlined(0.53, 0.165, 0.03, 0.07, 0xffdb4d, 0.014, 0.3);
  outlined(0.5, 0.45, 0.29, 0.265, 0xffdb4d);                         // 큰 머리
  ellipse(0.4, 0.29, 0.07, 0.035, 0xfff3b8, -0.5, 0.9);               // 머리 위 반짝 광택
  // 큰 눈 + 반짝이 두 개
  for (const ex of [0.385, 0.615]) {
    ellipse(ex, 0.45, 0.058, 0.072, 0x2b1d14);
    ellipse(ex - 0.018, 0.425, 0.024, 0.026, 0xffffff);
    ellipse(ex + 0.02, 0.475, 0.011, 0.011, 0xffffff);
  }
  ellipse(0.3, 0.535, 0.055, 0.032, 0xff8fb0, 0, 0.85);               // 볼터치
  ellipse(0.7, 0.535, 0.055, 0.032, 0xff8fb0, 0, 0.85);
  outlined(0.5, 0.535, 0.075, 0.042, 0xff9a3c, 0.014);                // 동그란 부리 (웃는 입)
  ellipse(0.5, 0.548, 0.05, 0.016, 0xe8742a);
  ellipse(0.48, 0.52, 0.022, 0.01, 0xffc58a);
  // 4배 → 원래 크기로 줄이기
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) { const i = ((y * SS + sy) * W + x * SS + sx) * 4; r += buf[i] * buf[i + 3]; g += buf[i + 1] * buf[i + 3]; b += buf[i + 2] * buf[i + 3]; a += buf[i + 3]; }
    const o = (y * size + x) * 4;
    out[o + 3] = Math.round(a / (SS * SS) * 255);
    if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
  }
  return png(size, size, out);
}

const res = process.argv[2];
if (!res) { console.error('usage: node tools/make-icons.js <android res dir>'); process.exit(1); }
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, m] of Object.entries(dens)) {
  const dir = path.join(res, 'mipmap-' + d);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), draw(Math.round(48 * m), 'full'));
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), draw(Math.round(48 * m), 'round'));
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), draw(Math.round(108 * m), 'fg'));
}
fs.mkdirSync(path.join(res, 'drawable-nodpi'), { recursive: true });
fs.writeFileSync(path.join(res, 'drawable-nodpi', 'splash_icon.png'), draw(288, 'splash'));
// 미리보기용
if (process.argv[3]) fs.writeFileSync(process.argv[3], draw(512, 'full'));
console.log('icons written to', res);
