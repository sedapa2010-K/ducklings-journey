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
  const k = mode === 'fg' || mode === 'bg' ? 0.667 : mode === 'splash' ? 0.9 : 1, off = (1 - k) / 2;   // 적응형 아이콘은 가운데 66.7% 만 보임
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
  const poly = (pts, col, alpha = 1) => {   // 다각형 (정규화 좌표)
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    fill(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (u, v) => {
      let inside = false;
      for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
        const [xa, ya] = pts[a], [xb, yb] = pts[b];
        if ((ya > v) !== (yb > v) && u < (xb - xa) * (v - ya) / (yb - ya) + xa) inside = !inside;
      }
      return inside;
    }, col, alpha);
  };
  const lerpC = (a, b, t) => { const A = hex(a), B = hex(b); return (Math.round(A[0] + (B[0] - A[0]) * t) << 16) | (Math.round(A[1] + (B[1] - A[1]) * t) << 8) | Math.round(A[2] + (B[2] - A[2]) * t); };
  // ---------- 배경: 하늘 + 풀밭 + 멀어질수록 작아지는 수로 (원근감) ----------
  const HZ = 0.36, VPX = 0.8;                                   // 지평선 높이 · 소실점
  const sOf = v => Math.min(1.4, Math.max(0, (v - HZ) / (1 - HZ)));             // 0 = 먼 곳, 1 = 가장 가까운 곳
  const Lx = v => VPX - 0.015 + (-0.12 - VPX) * sOf(v), Rx = v => VPX + 0.015 + (1.02 - VPX) * sOf(v);   // 물길 양쪽 가장자리
  const scene = () => {
    for (let y = 0; y < W; y++) {                                // 하늘 (분홍빛 → 하늘색) / 풀밭 (먼 곳은 연하게)
      const v = ((y + 0.5) / W - off) / k;
      const col = v < HZ ? hex(lerpC(0xffd9ec, 0x9fdcff, v / HZ)) : hex(lerpC(0xa8e08a, 0x5cbf4a, sOf(v)));
      for (let x = 0; x < W; x++) blend((y * W + x) * 4, col, 1);
    }
    ellipse(0.2, HZ + 0.02, 0.3, 0.07, 0x8fd17a); ellipse(0.95, HZ + 0.025, 0.25, 0.06, 0x8fd17a);   // 먼 언덕
    sparkle(0.14, 0.14, 0.05, 0xffffff); sparkle(0.42, 0.08, 0.03, 0xfff3a8);
    // 나무 난간 (가까울수록 두껍게)
    const wall = (sign) => {
      const pts = [], N = 24;
      for (let i = 0; i <= N; i++) { const v = HZ + (1.5 - HZ) * i / N, w = 0.012 + 0.07 * sOf(v); pts.push([sign < 0 ? Lx(v) - w : Rx(v) + w, v]); }
      for (let i = N; i >= 0; i--) { const v = HZ + (1.5 - HZ) * i / N; pts.push([sign < 0 ? Lx(v) : Rx(v), v]); }
      poly(pts, 0xc98f5a);
      for (let i = 0; i <= 10; i++) {   // 난간 기둥 (멀어질수록 촘촘하고 작게)
        const z = i / 10, v = HZ + (1 - HZ) * z * z, w = 0.012 + 0.07 * sOf(v), x = sign < 0 ? Lx(v) - w / 2 : Rx(v) + w / 2;
        ellipse(x, v - 0.02 * sOf(v) - 0.005, w * 0.45 + 0.004, 0.012 + 0.05 * sOf(v), 0xa96f3f);
      }
    };
    // 물 (먼 곳은 밝게, 가까운 곳은 진하게)
    const N = 40;
    for (let i = 0; i < N; i++) {
      const v0 = HZ + (1.5 - HZ) * i / N, v1 = HZ + (1.5 - HZ) * (i + 1) / N;
      poly([[Lx(v0), v0], [Rx(v0), v0], [Rx(v1), v1], [Lx(v1), v1]], lerpC(0xc4f0ff, 0x4fb0ea, sOf(v1)));
    }
    // 하얀 물결 줄 (멀수록 작고 촘촘하게)
    for (let i = 1; i <= 9; i++) {
      const z = i / 9, v = HZ + (1 - HZ) * z * z, s = sOf(v), lw = Rx(v) - Lx(v);
      for (const f of [0.25, 0.62, 0.85]) ellipse(Lx(v) + lw * (f + (i % 2) * 0.05), v, 0.008 + 0.05 * s, 0.002 + 0.01 * s, 0xffffff, 0, 0.75);
    }
    wall(-1); wall(1);
  };
  const duckFig = (ox = 0.42, oy = 0.7, sc = 0.78) => {   // (ox, oy) 를 중심으로 sc 배 크기
    const tx = x => ox + (x - 0.47) * sc, ty = y => oy + (y - 0.7) * sc;
    const E = (x, y, rx, ry, c, r = 0, a = 1) => ellipse(tx(x), ty(y), rx * sc, ry * sc, c, r, a);
    const O = (x, y, rx, ry, c, t = 0.02, r = 0) => outlined(tx(x), ty(y), rx * sc, ry * sc, c, t * Math.max(0.8, sc), r);
    // 🐥 수로를 따라 힘차게 헤엄치는 오리 (소실점 쪽을 보고 앞으로) + 튜브 + 물보라
    for (const [x, y, r] of [[0.1, 0.84, 0.035], [0.16, 0.76, 0.028], [0.08, 0.72, 0.02], [0.84, 0.9, 0.03], [0.9, 0.82, 0.022], [0.22, 0.92, 0.03]]) E(x, y, r, r * 0.9, 0xffffff, 0, 0.9);   // 튀는 물방울
    E(0.47, 0.86, 0.36, 0.09, 0xffffff, 0, 0.85);                 // 물보라 띠
    O(0.47, 0.8, 0.27, 0.095, 0xff5a64, 0.02);                  // 빨간 튜브
    for (const [x, y] of [[0.24, 0.79], [0.47, 0.885], [0.7, 0.8]]) E(x, y, 0.045, 0.045, 0xffffff);
    O(0.27, 0.66, 0.06, 0.035, 0xffdb4d, 0.016, 0.7);           // 꼬리 (뒤로 쫑긋)
    O(0.44, 0.69, 0.22, 0.14, 0xffdb4d, 0.02, -0.25);            // 몸통 (앞으로 기울어짐)
    O(0.33, 0.5, 0.12, 0.045, 0xffc93c, 0.018, -1.15);          // 날개: 등에서 위로 번쩍 (힘차게 파닥)
    O(0.27, 0.52, 0.07, 0.03, 0xffc93c, 0.016, -1.45);
    E(0.335, 0.49, 0.075, 0.015, 0xffe27a, -1.15, 0.9);
    O(0.61, 0.33, 0.026, 0.06, 0xffdb4d, 0.013, 0.25);           // 머리 깃털
    O(0.65, 0.335, 0.024, 0.055, 0xffdb4d, 0.013, 0.6);
    O(0.6, 0.47, 0.155, 0.145, 0xffdb4d);                       // 머리 (앞쪽 = 오른쪽 위를 봄)
    E(0.55, 0.39, 0.05, 0.025, 0xfff3b8, -0.4, 0.9);              // 광택
    E(0.665, 0.45, 0.04, 0.05, 0x2b1d14);                          // 눈 (앞을 똑바로)
    E(0.655, 0.432, 0.016, 0.018, 0xffffff);
    E(0.678, 0.468, 0.008, 0.008, 0xffffff);
    E(0.62, 0.53, 0.04, 0.024, 0xff8fb0, 0, 0.85);                // 볼터치
    O(0.76, 0.49, 0.075, 0.04, 0xff9a3c, 0.014, -0.35);          // 부리 (앞으로 쭉)
    E(0.77, 0.505, 0.05, 0.012, 0xe8742a, -0.35);
    for (const [x, y, r, a] of [[0.13, 0.58, 0.07, -0.35], [0.11, 0.66, 0.05, -0.35], [0.16, 0.5, 0.04, -0.35]]) E(x, y, r, 0.007, 0xffffff, a, 0.9);   // 쌩쌩 속도선
  };
  if (mode === 'bg') scene();
  if (mode === 'store') { scene(); duckFig(); }   // 스토어용: 모서리 자르지 않은 정사각형 (스토어가 알아서 둥글게)
  if (mode === 'full' || mode === 'round') {
    scene(); duckFig();
    // 둥근 사각형 / 원 바깥은 지움
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const u = x / W, v = y / W; let out;
      if (mode === 'round') out = (u - 0.5) ** 2 + (v - 0.5) ** 2 > 0.25;
      else { const r = 0.2, cx = Math.min(Math.max(u, r), 1 - r), cy = Math.min(Math.max(v, r), 1 - r); out = (u - cx) ** 2 + (v - cy) ** 2 > r * r; }
      if (out) buf[(y * W + x) * 4 + 3] = 0;
    }
  }
  if (mode === 'fg') duckFig();                    // 적응형 앞면: 전체 아이콘과 같은 자리·크기
  if (mode === 'splash') duckFig(0.47, 0.7, 1);   // 시작 화면: 오리만 가운데 크게
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
  fs.writeFileSync(path.join(dir, 'ic_launcher_background.png'), draw(Math.round(108 * m), 'bg'));   // 적응형 아이콘 뒷면: 수로 풍경
}
fs.mkdirSync(path.join(res, 'drawable-nodpi'), { recursive: true });
fs.writeFileSync(path.join(res, 'drawable-nodpi', 'splash_icon.png'), draw(288, 'splash'));
// 미리보기용
if (process.argv[3]) fs.writeFileSync(process.argv[3], draw(512, 'full'));
// 플레이 스토어 아이콘 (512×512, 꽉 찬 정사각형): node tools/make-icons.js <res> <미리보기> <스토어 아이콘>
if (process.argv[4]) { const b = draw(512, 'store'); fs.writeFileSync(process.argv[4], b); }
console.log('icons written to', res);
