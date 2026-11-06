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
  const ellipse = (cx, cy, rx, ry, col) => {
    const c = hex(col), x0 = Math.max(0, Math.floor(X(cx) - R(rx))), x1 = Math.min(W - 1, Math.ceil(X(cx) + R(rx)));
    const y0 = Math.max(0, Math.floor(X(cy) - R(ry))), y1 = Math.min(W - 1, Math.ceil(X(cy) + R(ry)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - X(cx)) / R(rx), dy = (y + 0.5 - X(cy)) / R(ry);
      if (dx * dx + dy * dy <= 1) blend((y * W + x) * 4, c, 1);
    }
  };
  const outlined = (cx, cy, rx, ry, col, t = 0.022) => { ellipse(cx, cy, rx + t, ry + t, 0x5a4632); ellipse(cx, cy, rx, ry, col); };
  // 배경: 하늘 → 물 (앞면/시작 화면은 투명)
  if (mode === 'full' || mode === 'round') {
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const v = y / W, col = v < 0.7 ? [191 - v * 40, 230 - v * 20, 255] : [79, 168, 232];
      if (mode === 'round') { const dx = x / W - 0.5, dy = y / W - 0.5; if (dx * dx + dy * dy > 0.25) continue; }
      else { const r = 0.2, cx = Math.min(Math.max(x / W, r), 1 - r), cy = Math.min(Math.max(y / W, r), 1 - r); if ((x / W - cx) ** 2 + (y / W - cy) ** 2 > r * r) continue; }
      blend((y * W + x) * 4, col, 1);
    }
    for (const [cx, cy] of [[0.2, 0.82], [0.62, 0.88], [0.86, 0.79]]) ellipse(cx, cy, 0.09, 0.018, 0xbfe9ff);   // 물결
  }
  // 오리 (튜브 낀 귀여운 아기 오리)
  outlined(0.53, 0.68, 0.33, 0.085, 0xe8323c, 0.02);                  // 빨간 튜브
  for (const sx of [0.32, 0.53, 0.74]) ellipse(sx, 0.69, 0.045, 0.07, 0xffffff);
  outlined(0.55, 0.6, 0.27, 0.17, 0xffd84d);                          // 몸통
  outlined(0.62, 0.58, 0.1, 0.07, 0xf2b01e, 0.016);                   // 날개
  outlined(0.45, 0.4, 0.2, 0.19, 0xffd84d);                           // 머리
  outlined(0.47, 0.205, 0.028, 0.06, 0xffd84d, 0.014);                // 머리 깃털
  outlined(0.255, 0.45, 0.085, 0.042, 0xff9a3c, 0.016);               // 부리
  ellipse(0.37, 0.37, 0.036, 0.045, 0x2b1d14);                        // 눈
  ellipse(0.357, 0.355, 0.014, 0.014, 0xffffff);
  ellipse(0.53, 0.37, 0.036, 0.045, 0x2b1d14);
  ellipse(0.517, 0.355, 0.014, 0.014, 0xffffff);
  ellipse(0.32, 0.47, 0.04, 0.022, 0xff8fab);                         // 볼터치
  ellipse(0.59, 0.47, 0.04, 0.022, 0xff8fab);
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
