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
// J: 점프대 (경사로 2.0 → 끊어진 물길 3.0). 속도를 내서 날아가야 건너감
function J() { return { t: 'J', len: 5.0, ramp: 2.0, gap: 3.0, h: 0.7, walls: 'both' }; }

let LEVELS = [
  {
    name: '첫 물놀이',
    flow: 2.2, width: 4.2,
    pieces: [
      S(16, 'both'),
      C(-90, 6.5, 'both'),
      S(18, 'both'),
    ],
  },
  {
    name: '두근두근 물길',
    flow: 2.4, width: 4.0, cross: 1.8,
    pieces: [
      S(10, 'both'),
      C(-90, 6, 'both'),
      S(5, 'both'),
      S(10, 'none'),
      S(4, 'both'),
      C(90, 6, 'both'),
      S(6, 'both'),
      S(9, 'none'),
      S(5, 'both'),
    ],
  },
  {
    name: '빨라진 물살',
    flow: 3.0, width: 3.8, cross: 2.0,
    pieces: [                       // ㄷ자로 꺾여 되돌아오는 연속 코너
      S(10, 'both'),
      C(-90, 4.5, 'both'),
      S(3, 'both'),
      C(-90, 4.5, 'both'),
      S(6, 'both'),
      S(9, 'none'),
      S(4, 'both'),
      C(90, 5.5, 'both'),
      S(5, 'both'),
      S(7, 'none'),
      S(4, 'both'),
    ],
  },
  {
    name: '코너 끝 낭떠러지',
    flow: 3.0, width: 3.6, cross: 2.2,
    pieces: [                       // 크게 휘는 둥근 커브 + 코너 직후 난간 없음
      S(9, 'both'),
      C(-150, 7.5, 'both'),
      S(7, 'none'),
      S(3, 'both'),
      C(150, 7.5, 'both'),
      S(8, 'none'),
      S(3, 'both'),
      C(-90, 5.5, 'L'),
      S(8, 'none'),
      S(3, 'both'),
      C(90, 5.5, 'R'),
      S(9, 'none'),
      S(4, 'both'),
    ],
  },
  {
    name: 'S자 아슬아슬',
    flow: 3.1, width: 3.0, cross: 2.2,
    pieces: [
      S(9, 'both', 3.6),
      S(5, 'none', 3.2),
      C(-90, 4.8, 'L'),
      S(3, 'none'),
      C(90, 4.8, 'none'),
      S(6, 'none'),
      C(-90, 4.8, 'none'),
      S(2.5, 'none'),
      C(90, 4.8, 'R'),
      S(7, 'none', 2.8),
      C(-90, 5, 'none'),
      S(6, 'none'),
      S(4, 'both', 3.4),
    ],
  },
];

// ---------------------------------------------------------------------
// 코스 겹침 검사: 물길이 자기 자신이나 도착 섬과 겹치면 true
// ---------------------------------------------------------------------
function courseOverlaps(def, checkPond = true) {
  const pts = []; let x = 0, z = 0, th = -Math.PI / 2, d = 0, acc = 0;
  for (const p of def.pieces) {
    const len = p.t === 'C' ? Math.abs(p.angle * Math.PI / 180) * p.radius : p.len;
    const n = Math.max(1, Math.round(len / 0.25)), ds = len / n;
    const dth = p.t === 'C' ? (p.angle * Math.PI / 180) / n : 0;
    for (let i = 0; i < n; i++) {
      th += dth / 2; x -= Math.sin(th) * ds; z -= Math.cos(th) * ds; th += dth / 2; d += ds; acc += ds;
      if (acc >= 1) { acc = 0; pts.push({ x, z, d, w: (p.w || def.width) / 2 }); }
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
        if (a.d - b.d >= 14 && Math.hypot(a.x - b.x, a.z - b.z) < a.w + b.w + 2.2) return true;
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
  function build(n, rng) {
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
    const budget = -lakeY - 1.5 - (falls - bigN) * 1.2;
    const bigDrop = bigN ? Math.min(budget / bigN, 3.5 + 3 * Math.min(1, (n - 11) / 40) + rng() * 0.8) : 0;
    // 커브 중간 난간 끊김: 레벨 8부터, 높을수록 자주
    const pGap = n < 8 ? 0 : 0.22 + 0.38 * Math.min(1, (n - 8) / 40);
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
    const cw = (turn, long) => {                 // 코너 난간 (U턴·둥근 커브처럼 긴 커브는 바깥 난간은 항상 있음)
      const outer = turn > 0 ? 'R' : 'L';
      const w = rng() < 0.75 - 0.45 * k ? 'both' : (rng() < 0.6 ? outer : 'none');
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
      while (ji < jumpAfter.length && jumpAfter[ji] <= c) { pieces.push(S(5, 'both'), J(), S(4, 'both')); ji++; }
      const len = n <= 20 ? 4 + rng() * 4 : n <= 40 ? 3 + rng() * 3 : 2.5 + rng() * 2.5;   // 코너가 많을수록 직선은 짧게
      if (c < n && rng() < 0.35 + 0.35 * k) pieces.push(S(len, 'none'), S(2, 'both'));
      else pieces.push(S(len, 'both'));
    }
    pieces.push(S(5, 'both'));
    return {
      flow: +(2.8 + 0.6 * k + 0.2 * k2).toFixed(2),
      width: +(3.6 - 0.5 * k).toFixed(2),
      cross: +(1.8 + 0.5 * k).toFixed(2),
      pieces,
    };
  }
  // 처음 플레이(또는 미리보기)할 때만 그 레벨을 만들어서 페이지 로딩을 빠르게
  const MAX_LEVEL = 60;
  const cache = {};
  function generate(n) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const cand = build(n, seeded(n * 97 + 13 + attempt * 7919));
      if (cand && !courseOverlaps(cand)) return cand;
    }
    console.warn('겹치지 않는 코스를 못 만듦: 레벨', n);
    return build(n, seeded(n * 97 + 13));
  }
  const fixed = LEVELS.slice();
  fixed.forEach((L, i) => { L.no = i + 1; if (courseOverlaps(L)) console.warn('코스 겹침: 레벨', i + 1); });
  LEVELS = new Proxy(new Array(MAX_LEVEL).fill(null), {
    get(target, prop) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) {
        const i = +prop;
        if (i >= MAX_LEVEL) return undefined;
        if (i < fixed.length) return fixed[i];
        if (!cache[i]) { cache[i] = generate(i + 1); cache[i].no = i + 1; }
        return cache[i];
      }
      return Reflect.get(target, prop);
    },
  });
})();
