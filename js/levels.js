// =====================================================================
// Duckling's Journey - 레벨 데이터
// S(길이, 벽, 폭?)          : 직선 구간
// C(각도, 반지름, 벽, 폭?)   : 코너 (각도 + = 좌회전, - = 우회전)
// flow = 유속, width = 물길 폭, cross = 좌우로 흔드는 옆 물살 세기
// 벽: 'both' | 'none' | 'L' | 'R'  ('none' = 추락 위험 구간)
// F(낙차, 길이?)            : 폭포 (양쪽 난간, 타면 빨라짐). 낙차가 크면 길이도 길게
// PRD 3.1: 레벨 N 에는 코너가 정확히 N 개
// 폭포: 레벨 6~10 = 1개, 11~15 = 2개, ... 56~60 = 11개 (5레벨마다 1개씩 추가)
// 제한 시간(타임어택)은 코스 길이와 유속으로 game.js 에서 자동 계산
// =====================================================================
function S(len, walls, w) { return { t: 'S', len, walls, w }; }
function C(angle, radius, walls, w) { return { t: 'C', angle, radius, walls, w }; }
function F(drop, len) { return { t: 'F', len: len || Math.max(1.8, drop * 1.25), drop, walls: 'both' }; }
// J: 점프대 (경사로 2.0 → 끊어진 물길 3.8). 속도를 내서 날아가야 건너감
function J() { return { t: 'J', len: 5.8, ramp: 2.0, gap: 3.8, h: 0.7, walls: 'both' }; }
// 🎯 멀리뛰기: 가속 경사로(ramp) → 넓은 빈 공간(gap)을 날아서 → 아래쪽 넓은 착지 수영장(과녁)에 착수
function LJ(gap, drop) { return { t: 'L', len: +(3 + gap).toFixed(2), ramp: 3, h: 1.0, gap: +gap.toFixed(2), drop: +drop.toFixed(2), walls: 'both' }; }
// 🛝 급류 워터슬라이드: 좌우로 굽이치며 쭉 내려가는 빠른 미끄럼틀 (drop 만큼 내려감)
function SL(angle, radius, drop) { return { t: 'C', angle, radius, walls: 'both', slide: true, drop: +drop.toFixed(2) }; }
// 물 엘리베이터 오르막 (나선 슬라이드로 내려간 만큼 다시 올라옴)
// ⛰️ 절벽: 물길이 뚝 끊기고 drop 만큼 아래의 넓고 깊은 웅덩이(pool)로 떨어짐
function CL(drop, w) { return { t: 'CL', len: 9.2, gap: 1.2, poolLen: 8, drop: +drop.toFixed(2), walls: 'both', w: +w.toFixed(2) }; }
// 🎢 세로 한 바퀴(루프): 넓은 직선 위에서 가속 물살을 타고 들어가 관을 따라 한 바퀴 빙 돌고 옆 줄로 나옴
function LP(w) { return { t: 'S', len: 16, walls: 'both', w: +w.toFixed(2), loop: true }; }
// 🚃 광산 기차: 물길이 끝나고 승강장 → 기차 1칸을 타고 오르내리는 레일 → 갈림 레일(🪙 코인 / ⚡ 빠른 길) → 다시 물길로 풍덩
const MC_LEN = 90;   // 레일 길이 (예전 30의 3배)
// 레일 모양: 좌우로 굽이치는 S자 (조각마다 [길이, 각도]). 큰 커브부터 시도하고, 겹치면 더 완만한 모양으로
const MC_SHAPES = [
  [[22, 70], [46, -120], [22, 70]],
  [[25, 60], [40, -90], [25, 60]],
  [[25, 40], [40, -60], [25, 40]],
  [[30, 30], [30, -30], [30, 30]],
  [[90, 30]],
];
function MC(shape, sg) {   // cu0~cu1: 레일 전체에서 이 조각이 차지하는 구간 (언덕·갈림 레일 모양을 레일 전체 기준으로)
  let at = 0;
  return shape.map(([len, ang]) => {
    const p = { t: 'C', angle: sg * ang, radius: +(len / (Math.abs(ang) * Math.PI / 180)).toFixed(2), walls: 'none', w: 8.0, cart: true, cu0: +(at / MC_LEN).toFixed(4), cu1: +((at + len) / MC_LEN).toFixed(4) };
    at += len; return p;
  });
}
function UP(rise) { return { t: 'S', len: +(rise * 3.3 + 2).toFixed(2), walls: 'both', liftUp: true, rise: +rise.toFixed(2), drop: -rise }; }
// 🪨 징검다리: 돌(stone) ↔ 빈 틈(hop) 번갈아. 돌은 좌우로 조금씩 엇갈림(so)
function STONES(count, rnd) {
  const out = [];
  for (let k = 0; k < count; k++) {
    out.push({ t: 'S', len: 1.0, walls: 'none', w: 2.2, hopGap: true });
    out.push({ t: 'S', len: 1.6, walls: 'none', w: 2.2, stone: true, so: +((k % 2 ? 1 : -1) * (0.45 + rnd() * 0.45)).toFixed(2) });
  }
  out.push({ t: 'S', len: 1.0, walls: 'none', w: 2.2, hopGap: true });
  return out;
}
// K: 갈림길 (가운데 섬이 물길을 둘로 나눔). side 쪽(1=왼쪽, -1=오른쪽)은 ⚡빠른 물살 + 바깥 난간 없음, 반대쪽은 느리지만 안전
// V: 깊은 골짜기 폭포 (깊이 쑥 떨어졌다가 물 엘리베이터를 타고 다시 원래 높이로 올라옴)
// 떨어지는 쪽은 짧고 가파르게(스릴), 올라오는 쪽은 예전처럼 길게
function V(depth) {
  const drop = depth * 0.5 + 1.2, rise = depth * 2.15 + 1.95, len = +(drop + rise).toFixed(2);
  return { t: 'V', len, depth, A: +(drop / len).toFixed(3), walls: 'both' };
}
// fv = 갈림길 종류, ns = 빠른 쪽이 좁아지기 시작하는 곳(0~1), sq = 섬이 빠른 쪽으로 밀리는 정도
function K(len, side, w, ih, fv = 'classic', ns = 0.38, sq = 0.65) { return { t: 'S', len, walls: side > 0 ? 'R' : 'L', w, fork: true, fside: side, ih, fv, ns, sq }; }
// 🔀 갈림길 종류: 기본 / 긴 섬(장애물 3개, 빠른 길에 코인) / 짧은 섬(꽃게 1마리, 빠른 길에 코인) / 넓은 섬(꽃게 2마리)
const FORK_KINDS = ['classic', 'long', 'short', 'wide'];
// 🔀↪ 굽은 갈림길: 같은 길이로 bend(도)만큼 휘어짐. 빠른 쪽(난간 없음)이 커브 바깥 → 빠르게 가면 바깥으로 밀려 떨어질 수 있음
function curveFork(k, bend) {
  const a = Math.abs(bend) * Math.PI / 180;
  return { ...k, t: 'C', angle: -k.fside * Math.abs(bend), radius: +(k.len / a).toFixed(2) };
}
function forkPiece(kind, fs, fw, ih, r) {
  if (kind === 'long') return K(+(30 + r * 4).toFixed(1), fs, fw, ih, kind, 0.28, 0.8);
  if (kind === 'short') return K(+(15 + r * 2).toFixed(1), fs, fw, ih, kind, 0.3, 0.55);
  if (kind === 'wide') return K(+(22 + r * 3).toFixed(1), fs, +(fw + 1).toFixed(2), +(ih * 1.7).toFixed(2), kind, 0.38, 0.65);
  return K(+(20 + r * 4).toFixed(1), fs, fw, ih);
}

let LEVELS = [
  {
    name: '첫 물놀이',
    flow: 2.2, width: 4.2, lakeY: -2.3,
    pieces: [                       // 작은 폭포로 슝~ → 오른쪽으로 크게 한 번
      S(10, 'both'),
      F(0.9),
      S(5, 'both'),
      C(-90, 6.5, 'both'),
      S(14, 'both'),
    ],
  },
  {
    name: '두근두근 물길',   // 좌우 반전: 왼쪽으로 먼저 꺾음
    flow: 2.4, width: 4.0, cross: 1.8, lakeY: -2.4,
    pieces: [
      S(10, 'both'),
      C(90, 6, 'both'),
      S(4, 'both'),
      F(1.0),                       // 💦 폭포 타고 쭉
      S(3, 'both'),
      S(9, 'none'),
      S(4, 'both'),
      C(-90, 6, 'both'),
      S(6, 'both'),
      S(9, 'none'),
      S(5, 'both'),
    ],
  },
  {
    name: '빨라진 물살',
    flow: 3.0, width: 3.8, cross: 2.0,
    pieces: [                       // ㄷ자로 꺾여 되돌아오는 연속 코너 → 🦘 첫 점프대 (가속 물살이 밀어줘서 그냥 타도 넘음)
      S(10, 'both'),
      C(-90, 4.5, 'both'),
      S(3, 'both'),
      C(-90, 4.5, 'both'),
      S(4, 'both'),
      { ...J(), gap: 2.6, len: 4.6, jet: true },   // 첫 점프대는 틈이 짧아서 그냥 흘러가도 넘음
      S(4, 'both'),
      S(7, 'none'),
      S(4, 'both'),
      C(90, 5.5, 'both'),
      S(5, 'both'),
      S(7, 'none'),
      S(4, 'both'),
    ],
  },
  {
    name: '코너 끝 낭떠러지',   // 좌우 반전: 왼쪽으로 먼저 꺾음
    flow: 3.0, width: 3.6, cross: 2.2, lakeY: -3.5,
    pieces: [                       // 크게 휘는 둥근 커브 + 코너 직후 난간 없음 + 폭포 두 번
      S(9, 'both'),
      C(150, 7.5, 'both'),
      S(7, 'none'),
      S(3, 'both'),
      F(1.1),
      S(3, 'both'),
      C(-150, 7.5, 'both'),
      S(8, 'none'),
      S(3, 'both'),
      C(90, 5.5, 'R'),
      S(4, 'both'),
      F(1.1),
      S(3, 'both'),
      S(6, 'none'),
      S(3, 'both'),
      C(-90, 5.5, 'L'),
      S(9, 'none'),
      S(4, 'both'),
    ],
  },
  {
    name: 'S자 아슬아슬',
    flow: 3.1, width: 3.0, cross: 2.2, lakeY: -2.6,
    pieces: [                       // 점프대로 시작 → S자 연속 → 폭포
      S(8, 'both', 3.6),
      { ...J(), gap: 2.8, len: 4.8, jet: true, w: 3.6 },
      S(4, 'both', 3.6),
      S(4, 'none', 3.2),
      C(-90, 4.8, 'L'),
      S(3, 'none'),
      C(90, 4.8, 'none'),
      S(5, 'none'),
      C(-90, 4.8, 'none'),
      S(2.5, 'none'),
      C(90, 4.8, 'R'),
      S(4, 'both', 3.2),
      F(1.2),
      S(4, 'both', 3.2),
      C(-90, 5, 'none'),
      S(5, 'none'),
      S(4, 'both', 3.4),
    ],
  },
];

// ---------------------------------------------------------------------
// 코스 겹침 검사: 물길이 자기 자신이나 도착 섬과 겹치면 true
// ---------------------------------------------------------------------
function courseOverlaps(def, checkPond = true) {
  const pts = []; let x = 0, z = 0, th = -Math.PI / 2, d = 0, acc = 0, y = 0;
  for (const p of def.pieces) {
    const len = p.t === 'C' ? Math.abs(p.angle * Math.PI / 180) * p.radius : p.len;
    const n = Math.max(1, Math.round(len / 0.25)), ds = len / n;
    const dth = p.t === 'C' ? (p.angle * Math.PI / 180) / n : 0;
    for (let i = 0; i < n; i++) {
      th += dth / 2; x -= Math.sin(th) * ds; z -= Math.cos(th) * ds; th += dth / 2; d += ds; acc += ds;
      y -= (p.drop || 0) / n;
      if (acc >= 1) { acc = 0; pts.push({ x, z, d, y, w: (p.w || def.width) / 2 }); }
    }
  }
  const tx = -Math.sin(th), tz = -Math.cos(th);
  const pond = { x: x + tx * 4.8, z: z + tz * 4.8 };
  // 6×6 격자에 점을 넣고 이웃 칸끼리만 비교 (빠름)
  const CELL = 6, grid = new Map();
  for (const a of pts) {
    if (checkPond && a.d < d - 12 && Math.hypot(a.x - pond.x, a.z - pond.z) < 9.5 + a.w) return true;
    const cx = Math.floor(a.x / CELL), cz = Math.floor(a.z / CELL);
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const cell = grid.get(ix + ',' + iz);
      if (cell) for (const b of cell)
        if (a.d - b.d >= 14 && Math.abs(a.y - b.y) < 2.6 && Math.hypot(a.x - b.x, a.z - b.z) < a.w + b.w + 2.2) return true;   // 2.6 넘게 위아래면 다리처럼 지나감
    }
    const key = cx + ',' + cz;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(a);
  }
  return false;
}

// ---------------------------------------------------------------------
// 레벨 6 ~ 60 자동 생성 (고정 시드라서 매번 같은 코스)
// 코스 조각을 섞어서 다이나믹하게:
//   지그재그 / U턴(둥근 180°) / ㄷ자(네모 180°) / 크게 휘는 둥근 커브 / S자 / 한 번 꺾기
// 겹치는 코스가 나오면 시드를 바꿔 다시 만듦.
// 레벨이 오를수록 유속·옆 물살 증가, 폭·코너 반지름 감소, 난간 없는 구간 증가
// ---------------------------------------------------------------------
(function generateLevels() {
  const seeded = a => () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  function build(n, rng, opt = {}) {
    const k = Math.min(1, (n - 6) / 14);         // 레벨 6~20: 0 → 1
    const k2 = Math.max(0, (n - 20) / 20);       // 레벨 21~40: 0 → 1, 41~60: 1 → 2
    const R = 5.4 - 0.7 * k;
    const falls = Math.floor((n - 1) / 5);       // 6~10:1, 11~15:2, ... 36~40:7
    const fallAfter = [];
    for (let j = 1; j <= falls; j++) fallAfter.push(Math.round(n * j / (falls + 1)));
    // 큰 폭포: 레벨 11부터 1개, 36부터 2개. 호수(수면) 위로 1.5 이상 남도록 낙차를 맞춤
    const lakeY = -1.3 - Math.floor((n - 1) / 5) * 2;   // game.js 의 lakeYFor 와 같은 식
    const bigN = n < 11 ? 0 : n < 36 ? 1 : 2;
    const bigAt = bigN === 1 ? [Math.floor(falls / 2)] : bigN === 2 ? [Math.floor(falls / 3), Math.floor(falls * 2 / 3)] : [];
    // 🎯 멀리뛰기(레벨 10~) · 🛝 워터슬라이드(레벨 12~)도 내려가므로 호수 위 여유 안에서 낙차를 나눠 씀
    const avail = Math.max(0, -lakeY - 1.5 - falls * 1.2);
    const hasJump = n >= 10 && !opt.noJump, hasSlide = n >= 12 && !opt.noSlide;
    const jumpD = hasJump ? Math.min(1.2, avail * 0.4) : 0, slideD = hasSlide ? Math.min(2.4, Math.max(0, avail - jumpD)) : 0;
    let cliffD = n >= 6 ? Math.min(3.2, Math.max(0, avail - jumpD - slideD)) : 0;   // ⛰️ 절벽 높이: 호수 위 여유만큼 (낮은 절벽 1.2~ / 높은 절벽 ~3.2)
    if (cliffD < 1.2) cliffD = 0;
    const budget = -lakeY - 1.5 - (falls - bigN) * 1.2 - jumpD - slideD - cliffD;
    const bigDrop = bigN ? Math.min(budget / bigN, 3.5 + 3 * Math.min(1, (n - 11) / 40) + rng() * 0.8) : 0;
    // 커브 중간 난간 끊김: 레벨 8부터, 높을수록 자주
    const pGap = n < 8 ? 0 : 0.28 + 0.4 * Math.min(1, (n - 8) / 40);   // 난이도↑: 커브 난간 끊김 더 자주
    const gapCurve = p => {
      if (!pGap || p.t !== 'C' || Math.abs(p.angle) < 75 || p.walls === 'none' || rng() >= pGap) return [p];
      const outer = p.angle > 0 ? 'R' : 'L', inner = outer === 'R' ? 'L' : 'R';
      const cut = rng() < 0.6 ? outer : inner;                 // 바깥쪽(더 어려움) 또는 안쪽 난간을 잠깐 없앰
      const mid = p.walls === 'both' ? (cut === outer ? inner : outer) : p.walls === cut ? 'none' : p.walls;
      if (mid === p.walls) return [p];
      const f = 0.25 + rng() * 0.12, g = 1 - 2 * f;            // 앞뒤 난간 있음, 가운데 약 1/4~1/2 은 끊김
      return [C(p.angle * f, p.radius, p.walls, p.w), C(p.angle * g, p.radius, mid, p.w), C(p.angle * f, p.radius, p.walls, p.w)];
    };
    const jumps = n < 35 ? 0 : Math.min(3, 1 + Math.floor((n - 35) / 10));   // 점프대: 35:1, 45:2, 55:3
    const jumpAfter = [];
    for (let j = 1; j <= jumps; j++) jumpAfter.push(Math.round(n * (j - 0.5) / jumps) + 1);
    let ji = 0;
    // 🔀 갈림길: 레벨 16~35 = 1개, 36~ = 2개. 코스 모양이 예전과 같게 따로 만든 난수 사용
    const frng = seeded(n * 131 + 7);
    const hard0 = Math.min(1, (n - 6) / 30), width0 = (3.6 - 0.5 * k) * (1 - 0.1 * hard0);
    const forks = n < 16 ? 0 : n < 36 ? 1 : 2;
    const forkAfter = forks === 1 ? [Math.round(n * 0.62)] : forks === 2 ? [Math.round(n * 0.34), Math.round(n * 0.8)] : [];
    let ki = 0;
    // 레벨마다 갈림길 종류가 달라짐. 한 레벨에 2개면 서로 다른 종류
    const fk0 = Math.floor(frng() * FORK_KINDS.length), forkKinds = [FORK_KINDS[fk0], FORK_KINDS[(fk0 + 1 + Math.floor(frng() * 3)) % FORK_KINDS.length]];
    // 🎢 골짜기 폭포: 레벨 14부터 코스 40% 쯤에 1개. 호수(수면) 위로 1.3 이상 남는 만큼만 깊게
    const dipAt = n < 14 ? -1 : Math.round(n * 0.4);
    let dipped = false;
    const jumpAt = hasJump ? Math.round(n * 0.5) : -1, slideAt = hasSlide ? Math.round(n * 0.72) : -1;
    let bigJumped = false, slid = false, stoned = false, raced = false, cliffed = false;
    const cliffAt = n >= 6 ? Math.round(n * 0.62) : -1;
    const loopAt = n >= 31 && n % 5 === 3 ? Math.round(n * 0.42) : -1;   // 🎢 루프: 31레벨부터 5개 중 1개 (33·38·43·48·53·58)
    let looped = false;
    const cartAt = n >= 41 && (n % 5 === 1 || n % 5 === 4) ? Math.round(n * 0.25) : -1;   // 🚃 광산 기차: 41·44·46·49·51·54·56·59
    let carted = false;
    const raceAt = -1;   // 🏁 라이벌 레이싱: 지금은 끔 (켜려면 n >= 15 && !opt.noRace ? Math.round(n * 0.45) : -1)
    const stoneAt = -1;   // 🪨 징검다리: 너무 어려워서 지금은 끔 (켜려면 n >= 8 ? Math.round(n * 0.27) : -1)
    const flow0 = (2.8 + 0.6 * k + 0.2 * k2) * (1 + 0.1 * Math.min(1, (n - 6) / 30));
    const cw = (turn, long) => {                 // 코너 난간 (U턴·둥근 커브처럼 긴 커브는 바깥 난간은 항상 있음)
      const outer = turn > 0 ? 'R' : 'L';
      const w = rng() < 0.65 - 0.45 * k ? 'both' : (rng() < 0.6 ? outer : 'none');   // 난이도↑: 양쪽 난간 코너 줄임
      return long && w === 'none' ? outer : w;
    };
    const side = () => (rng() < 0.5 ? 1 : -1);
    const PATTERNS = [
      { name: 'zig',   c: 2, w: 3, make: s => { const a = rng() < 0.3 ? 60 : 90; return [C(s * a, R, cw(s)), S(3 + rng() * 3, 'both'), C(-s * a, R, cw(-s))]; } },
      { name: 'U',     c: 1, w: 2, make: s => [C(s * 180, R * 0.9, cw(s, true))] },
      { name: 'box',   c: 2, w: 2, make: s => [C(s * 90, R * 0.75, cw(s)), S(3 + rng() * 3, 'both'), C(s * 90, R * 0.75, cw(s))] },
      { name: 'round', c: 1, w: 2, make: s => [C(s * (120 + 15 * Math.floor(rng() * 5)), R * 1.5, cw(s, true))] },
      { name: 'S',     c: 2, w: 2, make: s => { const a = 60 + 15 * Math.floor(rng() * 3); return [C(s * a, R, cw(s)), C(-s * a, R, cw(-s))]; } },
      { name: 'turn',  c: 1, w: 2, make: s => [C(s * 90, R, cw(s))] },
    ];
    // 한 조각씩 붙이면서 매번 겹침 검사. 동쪽(오른쪽)에서 많이 벗어나는 방향은 뒤로 미룸
    const pieces = [S(8, 'both')];
    let c = 0, fi = 0, heading = 0;
    const turnOf = ps => ps.reduce((a, p) => a + (p.t === 'C' ? p.angle : 0), 0);
    const norm = h => ((h + 540) % 360) - 180;
    while (c < n) {
      const left = n - c;
      const cands = [];
      for (const pat of PATTERNS) if (pat.c <= left)
        for (const s of [1, -1]) {
          const ps = pat.make(s), h = norm(heading + turnOf(ps));
          // 서쪽(왼쪽)으로 가는 중이면 다시 돌아오는 조각을 우선. U/ㄷ/둥근 커브는 자주 나오게 가산점
          const wasWest = Math.abs(heading) > 135, goesWest = Math.abs(h) > 135;
          const fancy = pat.name === 'U' || pat.name === 'box' || pat.name === 'round' ? 0.45 : 0;
          cands.push({ pat, ps, h, score: rng() * pat.w + fancy - (wasWest && goesWest ? 2 : 0) - (Math.abs(h) > 60 && Math.abs(h) <= 135 ? 0.25 : 0) });
        }
      cands.sort((a, b) => b.score - a.score);
      let ok = null;
      for (const cd of cands) {
        const test = { width: 3.6, pieces: [...pieces, ...cd.ps, S(6, 'both')] };
        if (!courseOverlaps(test, false)) { ok = cd; break; }
      }
      if (!ok) return null;                     // 막다른 길 → 다른 시드로 다시
      for (const p of ok.ps) pieces.push(...gapCurve(p));
      heading = ok.h; c += ok.pat.c;
      while (fi < fallAfter.length && fallAfter[fi] <= c) {
        if (bigAt.includes(fi) && bigDrop >= 2.5) pieces.push(S(4, 'both'), F(+bigDrop.toFixed(2)), S(6, 'both'));   // 긴 폭포
        else pieces.push(S(3, 'both'), F(1.2), S(4, 'both'));
        fi++;
      }
      let jumped = false;
      while (ji < jumpAfter.length && jumpAfter[ji] <= c) { pieces.push(S(5, 'both'), J(), S(4, 'both')); ji++; jumped = true; }
      if (!jumped && ki < forkAfter.length && forkAfter[ki] <= c && c < n) {
        const fs = frng() < 0.5 ? 1 : -1, fw = +(width0 * 1.75 + 1.2).toFixed(2), ih = +(0.075 * width0 + 0.6).toFixed(2);
        let fk = forkPiece(forkKinds[ki], fs, fw, ih, frng());
        const brng = seeded(n * 977 + ki * 31 + 3);   // 굽은 갈림길용 난수 (코스 나머지 모양은 그대로)
        if (brng() < 0.75) {   // 4개 중 3개는 굽은 갈림길 (안 들어가면 곧은 갈림길)
          const bent = curveFork(fk, 55 + brng() * 45);
          const test = { width: 3.6, pieces: [...pieces, S(3, 'both'), bent, S(3, 'both'), S(8, 'both')] };
          if (!courseOverlaps(test, false)) { fk = bent; heading = norm(heading + bent.angle); }
        }
        pieces.push(S(3, 'both'), fk, S(3, 'both'));
        ki++;
      } else if (!jumped && !carted && cartAt > 0 && c >= cartAt && c < n) {
        let mc = null;
        for (const shape of MC_SHAPES) {   // 크게 굽이치는 모양부터, 왼쪽·오른쪽 중 안 겹치는 쪽
          for (const sg of [1, -1]) {
            const cand = MC(shape, sg);
            if (!courseOverlaps({ width: 3.6, pieces: [...pieces, S(4, 'both'), ...cand, S(5, 'both'), S(8, 'both')] }, false)) { mc = cand; break; }
          }
          if (mc) break;
        }
        if (mc) { pieces.push(S(4, 'both'), ...mc, S(5, 'both')); heading = norm(heading + mc.reduce((a, q) => a + q.angle, 0)); }
        carted = !!mc;
      } else if (!jumped && !dipped && dipAt > 0 && c >= dipAt && c < n) {
        const yNow = -pieces.reduce((a, q) => a + (q.drop || 0), 0);
        const depth = Math.min(3.5 + 4 * Math.min(1, (n - 14) / 30) + frng(), yNow - lakeY - 1.3);
        if (depth >= 2.5) pieces.push(S(3, 'both'), V(+depth.toFixed(2)), S(6, 'both'));
        dipped = true;
      } else if (!jumped && !bigJumped && jumpAt > 0 && c >= jumpAt && c < n) {
        // 🎯 빈 공간 길이: 느리게 와도(유속 1.25배) 넘을 수 있을 만큼 → 착지 수영장(폭 2배)에 과녁
        // 빈 공간은 그냥 흘러가도 넘을 만큼(2.8), 착지 수영장은 힘껏 가속해도 안 넘칠 만큼 길게(15)
        pieces.push(S(4, 'both'), LJ(2.8, jumpD), { t: 'S', len: 18, walls: 'both', w: +(width0 * 2).toFixed(2), land: true }, S(4, 'both'));
        bigJumped = true;
      } else if (!jumped && !slid && slideAt > 0 && c >= slideAt && c < n) {
        // 🛝 좌우로 굽이치며 내려감 (좌우 회전 합 0 → 방향은 그대로)
        const s0 = frng() < 0.5 ? 1 : -1;
        if (n >= 20) {   // 🌀 물 엘리베이터로 3.8 올라가서 → 굽이굽이 → 빙글 한 바퀴 돌며 3.8 내려감 (자기 밑으로 지나감)
          const d3 = slideD / 3;
          pieces.push(S(3, 'both'), UP(3.8), S(2, 'both'), SL(s0 * 40, 6.5, d3), SL(-s0 * 80, 6.5, d3), SL(s0 * 40, 6.5, d3), SL(s0 * 360, 5.2, 3.8), S(4, 'both'));
        } else {       // 굽이굽이 6번 (예전의 1.5배 길이)
          const d6 = slideD / 6;
          pieces.push(S(3, 'both'), SL(s0 * 40, 6.5, d6), SL(-s0 * 80, 6.5, d6), SL(s0 * 60, 6.5, d6), SL(-s0 * 60, 6.5, d6), SL(s0 * 80, 6.5, d6), SL(-s0 * 40, 6.5, d6), S(4, 'both'));
        }
        slid = true;
      } else if (!jumped && !looped && loopAt > 0 && c >= loopAt && c < n) {
        pieces.push(S(4, 'both'), LP(width0), S(5, 'both'));   // 물길 폭은 보통 그대로 (관 두 줄이 꽉 채움)
        looped = true;
      } else if (!jumped && !cliffed && cliffAt > 0 && c >= cliffAt && c < n) {
        // 높이 여유가 있으면 그만큼 내려가는 절벽, 없으면 절벽 뒤 물 엘리베이터로 다시 올라옴 (호수 위 여유 안에서 낮은~높은 절벽)
        const yNow = -pieces.reduce((a, q) => a + (q.drop || 0), 0);
        const d = cliffD || Math.min(3.2, yNow - lakeY - 1.6);
        if (d >= 1.2) {
          pieces.push(S(5, 'both'), CL(d, width0 * 1.9), S(4, 'both'));
          if (!cliffD) pieces.push(S(2, 'both'), UP(d), S(3, 'both'));
        }
        cliffed = true;
      } else if (!jumped && !raced && raceAt > 0 && c >= raceAt && c < n) {
        // 🏁 레이스 구간: 넓은 물길(두 오리가 나란히) → 완만한 S자 → 결승선
        const rw = +(width0 * 1.35).toFixed(2), rs = frng() < 0.5 ? 1 : -1;
        pieces.push(S(4, 'both'),
          { t: 'S', len: 6, walls: 'both', w: rw, race: true },
          { t: 'C', angle: rs * 35, radius: 10, walls: 'both', w: rw, race: true },
          { t: 'C', angle: -rs * 70, radius: 10, walls: 'both', w: rw, race: true },
          { t: 'C', angle: rs * 35, radius: 10, walls: 'both', w: rw, race: true },
          { t: 'S', len: 6, walls: 'both', w: rw, race: true }, S(4, 'both'));
        raced = true;
      } else if (!jumped && !stoned && stoneAt > 0 && c >= stoneAt && c < n) {
        pieces.push(S(3, 'both'), ...STONES(n < 25 ? 4 : n < 45 ? 5 : 6, frng), S(4, 'both'));
        stoned = true;
      }
      const len = n <= 20 ? 4 + rng() * 4 : n <= 40 ? 3 + rng() * 3 : 2.5 + rng() * 2.5;   // 코너가 많을수록 직선은 짧게
      if (c < n && rng() < 0.42 + 0.33 * k) pieces.push({ ...S(len * 1.15, 'none'), plain: true }, S(2, 'both'));   // 난이도↑: 난간 없는 직선 더 자주·더 길게
      else pieces.push({ ...S(len, 'both'), plain: true });
    }
    pieces.push(S(5, 'both'));
    if (carted) {   // 🚃 기차 구간만큼 보통 직선들을 고르게 줄여서 레벨 전체 길이는 예전과 같게
      const plain = pieces.filter(q => q.plain), tot = plain.reduce((a, q) => a + q.len, 0);
      const f = Math.max(0.35, 1 - (MC_LEN + 9) / Math.max(1, tot));
      for (const q of plain) q.len = +(q.len * f).toFixed(2);
    }
    // 난이도↑: 레벨이 오를수록 폭은 최대 10% 좁게, 유속 최대 +10%, 옆 물살 최대 +25%
    const hard = Math.min(1, (n - 6) / 30);
    return {
      flow: +((2.8 + 0.6 * k + 0.2 * k2) * (1 + 0.1 * hard)).toFixed(2),
      baseFlow: +(2.8 + 0.6 * k + 0.2 * k2).toFixed(2),   // 제한 시간 계산용 (물살이 세져도 시간이 줄지 않게)
      width: +((3.6 - 0.5 * k) * (1 - 0.1 * hard)).toFixed(2),
      cross: +((1.8 + 0.5 * k) * (1 + 0.25 * hard)).toFixed(2),
      pieces,
    };
  }
  // 처음 플레이(또는 미리보기)할 때만 그 레벨을 만들어서 페이지 로딩을 빠르게
  const MAX_LEVEL = 60;
  const cache = {};
  // 🏁 레이스 스테이지: 10레벨마다 1개 (LEVELS[100] ~ LEVELS[105] = 레이스 1~6)
  // 단계마다 상대 오리 +1, 코스 길어짐, 물길 넓음, 난간은 모두 있음(떨어질 곳 거의 없음), 폭포·점프대 많이
  function buildRace(k, rng) {
    const n = 8 + 4 * k, R = 6.5;
    const PAT = [
      s => [C(s * 60, R, 'both'), S(3 + rng() * 2, 'both'), C(-s * 60, R, 'both')],
      s => [C(s * 90, R * 1.2, 'both')],
      s => [C(s * 45, R * 1.4, 'both'), C(-s * 45, R * 1.4, 'both')],
      s => [C(s * 120, R * 1.3, 'both')],
    ];
    const pieces = [S(12, 'both')];
    let heading = 0, c = 0, drop = 0;
    const helixAt = Math.round(n * 0.5), bigAt = [Math.round(n * 0.3), Math.round(n * 0.78)];
    const JR = () => ({ t: 'J', len: 6.2, ramp: 2.6, gap: 3.6, h: 1.3, walls: 'both', jet: true });   // 🦘 높고 긴 점프대 (경사로 가속)
    const turnOf = ps => ps.reduce((a, p) => a + (p.t === 'C' ? p.angle : 0), 0);
    const norm = h => ((h + 540) % 360) - 180;
    while (c < n) {
      const cands = [];
      for (const mk of PAT) for (const sg of [1, -1]) { const ps = mk(sg), h = norm(heading + turnOf(ps)); cands.push({ ps, h, score: rng() - (Math.abs(h) > 100 ? 1.5 : 0) }); }
      cands.sort((a, b) => b.score - a.score);
      let ok = null;
      for (const cd of cands) if (!courseOverlaps({ width: 5, pieces: [...pieces, ...cd.ps, S(8, 'both')] }, false)) { ok = cd; break; }
      if (!ok) return null;
      pieces.push(...ok.ps); heading = ok.h; c++;
      if (c === helixAt) {   // 🌀 스피드 회전: 물 엘리베이터로 올라가서 굽이굽이 → 360° 나선으로 쭉 내려옴
        const s0 = rng() < 0.5 ? 1 : -1;
        pieces.push(S(3, 'both'), UP(3.8), S(2, 'both'), SL(s0 * 40, 7, 0.3), SL(-s0 * 80, 7, 0.3), SL(s0 * 40, 7, 0.3), SL(s0 * 360, 6, 3.8), S(4, 'both'));
        drop += 0.9;
      } else if (c === Math.round(n * 0.18) || c === Math.round(n * 0.64)) {   // ⛰️ 절벽: 앞쪽은 낮게, 뒤쪽은 높게
        const d = c < n / 2 ? 1.6 + rng() * 0.4 : 3.0 + rng() * 0.6;
        pieces.push(S(5, 'both'), CL(d, (4.4 + 0.25 * k) * 1.6), S(5, 'both')); drop += d;
      } else if (bigAt.includes(c)) {   // 💦 큰 폭포
        const d = +(3.5 + rng() * 1.5).toFixed(2); pieces.push(S(4, 'both'), F(d), S(6, 'both')); drop += d;
      } else if (c % 3 === 1) { const d = +(1.3 + rng() * 0.8).toFixed(2); pieces.push(S(3, 'both'), F(d), S(4, 'both')); drop += d; }   // 💦 폭포로 쭉
      else if (c % 3 === 2) pieces.push(S(5, 'both'), JR(), S(5, 'both'));   // 🦘 점프대 (경사로에 가속 물살 → 그냥 흘러가도 넘음)
      else pieces.push(S(5 + rng() * 3, 'both'));
    }
    pieces.push(S(6, 'both'));
    return { race: k, rivals: k, no: 10 * k - 1, theme: 'day', lakeY: +(-drop - 2.5).toFixed(2),
      flow: +(3.5 + 0.12 * k).toFixed(2), width: +(4.4 + 0.25 * k).toFixed(2), cross: 0, pieces };
  }
  const RACE_BASE = 100, RACE_N = 6, raceCache = {};
  function genRace(k) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const cand = buildRace(k, seeded(k * 7717 + 29 + attempt * 104729));
      if (cand && !courseOverlaps(cand)) return cand;
    }
    console.warn('레이스 코스를 못 만듦', k);
    return { race: k, rivals: k, no: 10 * k - 1, theme: 'day', lakeY: -3, flow: 3.6, width: 4.6, cross: 0, pieces: [S(20, 'both'), C(-90, 8, 'both'), S(20, 'both')] };
  }
  function generate(n) {
    // 안 겹치는 코스가 안 나오면 워터슬라이드 없이 → 그래도 안 되면 멀리뛰기도 없이 같은 시드들로 다시
    for (const opt of [{}, { noSlide: true }, { noSlide: true, noStone: true }, { noSlide: true, noRace: true, noStone: true }, { noSlide: true, noJump: true, noStone: true, noRace: true }])
      for (let attempt = 0; attempt < 60; attempt++) {
        const cand = build(n, seeded(n * 97 + 13 + attempt * 7919), opt);
        if (cand && !courseOverlaps(cand)) return cand;
      }
    console.warn('겹치지 않는 코스를 못 만듦: 레벨', n);
    for (let attempt = 60; attempt < 400; attempt++) {   // 시드를 더 바꿔 가며 (도착 섬 겹침은 눈감아 줌)
      const cand = build(n, seeded(n * 97 + 13 + attempt * 7919));
      if (cand) return cand;
    }
    return { flow: 3, width: 3.4, cross: 2, pieces: [S(10, 'both'), C(-90, 6, 'both'), S(10, 'both')] };   // 최후의 안전한 코스
  }
  const fixed = LEVELS.slice();
  fixed.forEach((L, i) => { L.no = i + 1; if (courseOverlaps(L)) console.warn('코스 겹침: 레벨', i + 1); });
  LEVELS = new Proxy(new Array(MAX_LEVEL).fill(null), {
    get(target, prop) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) {
        const i = +prop;
        if (i >= RACE_BASE && i < RACE_BASE + RACE_N) { const k = i - RACE_BASE + 1; return raceCache[k] || (raceCache[k] = genRace(k)); }
        if (i >= MAX_LEVEL) return undefined;
        if (i < fixed.length) return fixed[i];
        if (!cache[i]) { cache[i] = generate(i + 1); cache[i].no = i + 1; }
        return cache[i];
      }
      return Reflect.get(target, prop);
    },
  });
})();
