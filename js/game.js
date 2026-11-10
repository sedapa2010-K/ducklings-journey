// =====================================================================
// Duckling's Journey - 게임 본체 (Three.js r128)
// =====================================================================
(() => {
'use strict';

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

// ---------- 튜닝 상수 ----------
const DUCK_R = 0.36;      // 오리 충돌 반지름
const WATER_DRAG = 1.6;   // 물살이 오리 속도를 유속에 맞추는 정도
const INPUT_ACC = 7.5;    // 기울기/조이스틱 최대 가속도
const WALL_REST = 0.45;   // 벽 반발 계수
const GRAVITY = 20;
// 물길 높이: 5레벨마다 한 단계씩 높아짐 (호수가 그만큼 더 아래에 있음)
const LIMIT_1_5 = [20, 26, 22, 33, 23], STAR_1_5 = [11, 17, 16, 26, 18];   // 레벨 1~5 제한 시간 / ⭐시간 미션
const lakeYFor = n => -1.3 - Math.floor((n - 1) / 5) * 2;   // 1~5: 수면 바로 위(-1.3), 6~10: -3.3, ... 56~60: -23.3 (5레벨마다 2씩 높아짐)
let LAKE_Y = -6;          // 현재 레벨의 호수 높이
const FALL_BOOST = 14;    // 폭포 경사에서 받는 앞쪽 가속
const BOOST_K = 0.75;     // ⚡ 가속 물살: 물살 세기 +75%
const BOOST_T = 2.2;      // ⚡ 가속 물살 패드를 밟으면 빨라지는 시간(초)
const SHIELD_TIME = 5;    // 방패 아이템: 양쪽 벽이 세워지는 시간(초)
const MAX_HEARTS_BASE = 5;   // 하트(목숨) 기본 개수
// ❤️ 레벨별 하트 수: 1~10레벨 3개, 11~20레벨 4개, 그 뒤(레이스 포함) 5개
function maxHearts() { const d = LEVELS[levelIdx]; if (!d || d.race) return MAX_HEARTS_BASE; const n = levelIdx + 1; return n <= 10 ? 3 : n <= 20 ? 4 : MAX_HEARTS_BASE; }
const JUMP_G = 12;        // 점프 중 중력
const CLIFF_VMAX_ADD = 3.6, CLIFF_DIVE = 1.6;   // ⛰️ 절벽: 최고 속도 ≈ 유속 + 3.6, 느리면 1.6초 잠수 (쏙 → 물속 → 떠오름)
const HOP_V = 3.6, HOP_VY = 3.4;   // 🪨 징검다리 폴짝: 앞으로 3.6, 위로 3.4 → 약 2.0 앞에 착지
const JUMP_VY = 0.6;      // 점프대 끝에서 앞으로 가는 속도 × 이 값 만큼 위로 튀어오름
const GYRO_FULL_DEG = 22; // 이 각도만큼 기울이면 최대 입력
const GYRO_DEAD_DEG = 2.5;

// ---------- 저장 (PRD 6.2: 해금 상태/기록) ----------
// 개발용 로컬 서버(python serve.py → http://localhost:8123 등 포트 있음)에서만 테스트 기능을 켬.
// 안드로이드 앱은 https://localhost (포트 없음) 라서 출시판에선 꺼짐
const DEV_BUILD = location.protocol === 'http:' && location.port !== '';
const PRIVACY_URL = 'https://sedapa2010-k.github.io/ducklings-journey/';   // 🔒 개인정보처리방침 (GitHub Pages · docs/index.html)
const SAVE_KEY = 'duckwaterway.v1';
let save = { unlocked: 1, best: {}, missions: {}, equip: {} };   // missions[레벨] = 성공한 미션 비트(1·2·4)
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (s && s.unlocked) save = Object.assign(save, s);
  if (!save.missions) save.missions = {};
  if (!save.equip) save.equip = {};
} catch (e) {}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

// ---------- 렌더러/씬 ----------
const canvas = $('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;   // 물길·난간·기둥 그림자가 호수/섬에 드리움 (오리는 그림자 없음)
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const SKY = 0xbfe6ff;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 45, 120);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 300);

const hemi = new THREE.HemisphereLight(0xffffff, 0xb8d8c0, 0.75); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e0, 0.75);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 160 });   // 높은 레벨의 깊은 호수까지
sun.shadow.bias = -0.002;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// 툰 셰이딩용 3단계 그라디언트
const gradTex = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.LuminanceFormat);
gradTex.minFilter = gradTex.magFilter = THREE.NearestFilter;
gradTex.needsUpdate = true;
const matCache = {};
function toon(color, extra) {
  const key = color + (extra ? JSON.stringify(extra) : '');
  if (!matCache[key]) matCache[key] = new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: gradTex }, extra || {}));
  return matCache[key];
}
// 바닥에 깔리는 둥근 그림자 (가운데가 진하고 가장자리로 흐려짐)
const blobTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32); grd.addColorStop(0, 'rgba(25,35,25,0.8)'); grd.addColorStop(0.55, 'rgba(25,35,25,0.4)'); grd.addColorStop(1, 'rgba(30,40,30,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const blobGeo = new THREE.PlaneGeometry(1, 1); blobGeo.userData.keep = true;
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
const smooth01 = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
// ⛰️ 절벽 웅덩이 짙은 파랑 덧칠: 꼭짓점마다 'fade' 값만큼 진하게 (끝쪽은 투명 → 자연스러운 그라데이션)
const poolTintMat = new THREE.ShaderMaterial({
  uniforms: { col: { value: new THREE.Color(0x0f4f96) } },
  vertexShader: 'attribute float fade; varying float vF; void main(){ vF = fade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 col; varying float vF; void main(){ gl_FragColor = vec4(col, 0.5 * vF); }',
  transparent: true, depthWrite: false,
});
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x5a4632, side: THREE.BackSide });
// 🌊 물 위 군데군데 짙은 파랑 얼룩 (깊은 곳처럼): 물길을 가로로 여러 칸 나눈 격자에 부드러운 무늬로 진하기를 줌
const patchMat = poolTintMat.clone(); patchMat.uniforms = { col: { value: new THREE.Color(0x0d4a8c) } }; patchMat.side = THREE.DoubleSide;
function addWaterPatches(group, S, a, b) {
  const C = 6, pos = [], fade = [], idx = [];
  const noise = (d, u) => {
    const v = Math.sin(d * 0.19 + Math.sin(d * 0.045) * 3 + u * 1.6) * 0.55 + Math.sin(d * 0.083 - u * 2.3 + 1.7) * 0.45;
    return smooth01((v - 0.15) / 0.55);
  };
  let rows = 0;
  for (let i = a; i <= b; i++) {
    const s = S[i], skip = s.fall || s.pool || s.slide || s.lift || s.jet;
    for (let c = 0; c <= C; c++) {
      const u = c / C * 2 - 1, lat = u * s.w, bk = s.bank || 0;
      pos.push(s.x + s.nx * lat, s.y + 0.035 + bk * lat, s.z + s.nz * lat);
      fade.push(skip ? 0 : noise(s.d, u) * (1 - 0.6 * Math.abs(u) ** 3));
    }
    if (rows) { const r0 = (rows - 1) * (C + 1), r1 = rows * (C + 1); for (let c = 0; c < C; c++) idx.push(r0 + c, r1 + c, r0 + c + 1, r0 + c + 1, r1 + c, r1 + c + 1); }
    rows++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('fade', new THREE.Float32BufferAttribute(fade, 1)); g.setIndex(idx);
  const m = new THREE.Mesh(g, patchMat); m.renderOrder = 1; group.add(m);
}

// ---------- 캔버스 텍스처 ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  return t;
}
const waterTex = canvasTex(128, 256, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, '#7fd0f5'); grd.addColorStop(0.5, '#a8e6ff'); grd.addColorStop(1, '#7fd0f5');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  // 물결 줄무늬
  g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 3; g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const x = 10 + ((i * 47) % 110), y = (i * 61) % h, len = 18 + (i % 3) * 10;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 4, y - len / 2, x, y - len); g.stroke();
  }
});
waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
const waterMat = new THREE.MeshToonMaterial({ map: waterTex, gradientMap: gradTex, transparent: true, opacity: 0.93, side: THREE.DoubleSide });
const waterMatDeep = waterMat.clone(); waterMatDeep.color.set(0x9cc2e4); waterMatDeep.opacity = 0.96;   // 🌊 레벨 50~: 조금 더 짙은 물
// 🌇 저녁·🌙 밤: 물길 물빛도 하늘빛에 맞춤 (도착 연못 입구 그라데이션과 같은 색조)
const THEME_WATER = { sunset: 0xc9b8f0, night: 0x5f72b8 };   // 저녁: 보랏빛 노을 물, 밤: 짙은 남색
const waterMatCache = {};
function waterMatFor(theme, deep) {
  const key = (theme || 'day') + (deep ? '_d' : '');
  if (waterMatCache[key]) return waterMatCache[key];
  if (!THEME_WATER[theme]) return (waterMatCache[key] = deep ? waterMatDeep : waterMat);
  const m = (deep ? waterMatDeep : waterMat).clone();
  m.color.multiply(new THREE.Color(THEME_WATER[theme]));
  return (waterMatCache[key] = m);
}
// ⚡ 가속 물살: 노란 화살표(⌃)만 물 위로 앞으로 흘러감
const boostTex = canvasTex(64, 64, (g, w, h) => {
  // 바탕색 없이 화살표만 (물길 색과 따로 놀지 않게)
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 14; g.beginPath(); g.moveTo(12, 46); g.lineTo(32, 22); g.lineTo(52, 46); g.stroke();
  g.strokeStyle = 'rgba(255,214,60,1)'; g.lineWidth = 8; g.beginPath(); g.moveTo(12, 46); g.lineTo(32, 22); g.lineTo(52, 46); g.stroke();
});
boostTex.wrapS = boostTex.wrapT = THREE.RepeatWrapping;
// 긴 가속 구간(슬라이드·나선·물 엘리베이터·멀리뛰기 경사로)용: 같은 화살표를 3배 간격으로 듬성듬성
const boostTexSparse = canvasTex(64, 192, (g, w, h) => {
  // 바탕색 없이 화살표만 (물길 색과 따로 놀지 않게)
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 14; g.beginPath(); g.moveTo(12, 46); g.lineTo(32, 22); g.lineTo(52, 46); g.stroke();
  g.strokeStyle = 'rgba(255,214,60,1)'; g.lineWidth = 8; g.beginPath(); g.moveTo(12, 46); g.lineTo(32, 22); g.lineTo(52, 46); g.stroke();
});
boostTexSparse.wrapS = boostTexSparse.wrapT = THREE.RepeatWrapping;
const boostMat = new THREE.MeshBasicMaterial({ map: boostTex, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const boostMatSparse = new THREE.MeshBasicMaterial({ map: boostTexSparse, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const forkSignTex = canvasTex(64, 64, (g) => {   // 갈림길 표지: 노란 동그라미 + "?" (어느 쪽이 빠른 길일까?)
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffd43b'; g.beginPath(); g.arc(32, 32, 25, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e8590c'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 32, 35);
});

// 폭포 물줄기 / 폭포 아래 거품
const fallTex = canvasTex(64, 128, (g, w, h) => {
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(255,255,255,${0.5 + (i % 3) * 0.15})`;
    g.fillRect((i * 23) % w, (i * 37) % h, 3 + (i % 3) * 2, 22 + (i % 4) * 12);
  }
});
fallTex.wrapS = fallTex.wrapT = THREE.RepeatWrapping;
const fallMat = new THREE.MeshBasicMaterial({ map: fallTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
const cliffWaterMat = new THREE.MeshBasicMaterial({ color: 0x7cc8f2, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });   // ⛰️ 절벽 물줄기 바탕
const foamTex = canvasTex(64, 64, (g, w, h) => {
  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.5})`;
    g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 0, Math.PI * 2); g.fill();
  }
});
foamTex.wrapS = foamTex.wrapT = THREE.RepeatWrapping;
const foamMat = new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
// 꼭짓점마다 'fade'(0~1) 만큼만 보이는 재질: 폭포 끝이 물길로 스르르 이어지게 (그라데이션)
function fadeVariant(mat, key) {
  const m = mat.clone();
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute float fade;\nvarying float vFade;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = fade;');
    sh.fragmentShader = 'varying float vFade;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', 'gl_FragColor.a *= vFade;\n#include <dithering_fragment>');
  };
  m.customProgramCacheKey = () => 'fade_' + key;
  return m;
}
const fallFadeMat = fadeVariant(fallMat, 'fall'), foamFadeMat = fadeVariant(foamMat, 'foam');
function setFade(mesh, i0, i1, f) {   // ribbon 꼭짓점(샘플마다 2개)에 fade 값
  const al = []; for (let i = i0; i <= i1; i++) { const v = clamp(f(i), 0, 1); al.push(v, v); }
  mesh.geometry.setAttribute('fade', new THREE.Float32BufferAttribute(al, 1));
  return mesh;
}

const shieldMat = new THREE.MeshBasicMaterial({ color: 0x3fb8ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });

const pondTex = canvasTex(256, 256, (g, w, h) => {
  const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, '#2c7cc9'); grd.addColorStop(0.55, '#4597dc'); grd.addColorStop(0.85, '#79c2f0'); grd.addColorStop(1, '#9ddcfa');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 4;
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, r = 30 + (i * 37) % 80;
    g.beginPath(); g.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 12 + i % 3 * 5, 0.3, 2.2); g.stroke();
  }
});

function emojiTex(draw) { return canvasTex(64, 64, draw); }
const heartTex = emojiTex(g => {
  g.fillStyle = '#ff7fa0'; g.strokeStyle = '#fff'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(32, 54);
  g.bezierCurveTo(4, 34, 6, 10, 22, 10); g.bezierCurveTo(28, 10, 32, 16, 32, 20);
  g.bezierCurveTo(32, 16, 36, 10, 42, 10); g.bezierCurveTo(58, 10, 60, 34, 32, 54);
  g.closePath(); g.fill(); g.stroke();
});
const starTex = emojiTex(g => {
  g.fillStyle = '#ffd84d'; g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 12 : 27, a = -Math.PI / 2 + i * Math.PI / 5;
    g.lineTo(32 + Math.cos(a) * r, 34 + Math.sin(a) * r);
  }
  g.closePath(); g.fill(); g.stroke();
});

// ---------- 정적 배경 (호수, 구름) ----------
const lakeMat = new THREE.MeshToonMaterial({ color: 0x4f8fd6, gradientMap: gradTex });
const lake = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), lakeMat);   // 진한 파란 호수 (물길과 구분)
lake.rotation.x = -Math.PI / 2; lake.position.y = LAKE_Y; lake.receiveShadow = true;
scene.add(lake);

const cloudMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradTex });

// ---------- 배경 테마: 5의 배수 레벨 = 밤, 그 바로 앞 레벨 = 노을, 나머지 = 낮 ----------
const THEMES = {
  day:    { bg: SKY,      fog: [55, 150], hemi: [0xffffff, 0xb8d8c0, 0.75], sun: [0xfff4e0, 0.75], sunOff: [8, 20, 6],  lake: 0x4f8fd6, cloud: 0xffffff, glow: 0 },
  sunset: { bg: 0xf59a7a, fog: [30, 110], hemi: [0xffe6d2, 0x6f78c8, 0.7], sun: [0xffb784, 0.75], sunOff: [16, 8, 3], lake: 0x5b5fb0, cloud: 0xffb7a8, glow: 0 },
  night:  { bg: 0x18213f, fog: [25, 95],  hemi: [0x8090e0, 0x303a66, 0.55], sun: [0xb8c4ff, 0.5],  sunOff: [-6, 18, 4], lake: 0x1d3566, cloud: 0x5a6496, glow: 1.1 },
};
const themeFor = n => (n % 5 === 0 ? 'night' : n % 5 === 4 ? 'sunset' : 'day');
const sunOff = new THREE.Vector3(8, 20, 6);
const duckGlow = new THREE.PointLight(0xfff0c0, 0, 7, 1.5);   // 밤에 오리 주변을 비추는 따뜻한 등불
scene.add(duckGlow);
// ---------- 풍경(바이옴): 10레벨마다 바뀜. 위의 낮/노을/밤과 겹쳐서 적용 ----------
const BIOMES = [
  { id: 'lake',     lake: 0x2f6fc0, sky: 0xbfe6ff, cloud: 0xffffff },   //  1~10 🏞️ 호수 (조금 진한 파랑)
  { id: 'meadow',   lake: 0x5aa9dc, sky: 0xcdeeff, cloud: 0xffffff },   // 11~20 🌼 꽃 들판
  { id: 'mountain', lake: 0x3d9bb8, sky: 0xb1daf3, cloud: 0xffffff },   // 21~30 ⛰️ 산
  { id: 'canyon',   lake: 0x2fb3ad, sky: 0xffdcb6, cloud: 0xfff1e0 },   // 31~40 🏜️ 계곡
  { id: 'forest',   lake: 0x2e8780, sky: 0xc6ecdc, cloud: 0xf4fff8 },   // 41~50 🌲 숲
  { id: 'snow',     lake: 0x3a7fb8, sky: 0xe4f2fb, cloud: 0xffffff },   // 51~60 ❄️ 설원 (호수는 깊은 겨울 바다색: 연한 물길과 구분되게)
];
const biomeFor = n => BIOMES[Math.min(BIOMES.length - 1, Math.floor((n - 1) / 10))];
function applyTheme(name, biome) {
  const T = THEMES[name], B = biome || BIOMES[0];
  const mix = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();
  // 낮: 바이옴 색 그대로 / 노을·밤: 바이옴 색에 노을·밤 색을 섞음
  const k = name === 'day' ? 0 : name === 'sunset' ? 0.6 : 0.78;
  const bg = name === 'day' ? B.sky : T.bg;
  scene.background.setHex(bg);
  scene.fog.color.setHex(bg); scene.fog.near = T.fog[0]; scene.fog.far = T.fog[1];
  hemi.color.setHex(T.hemi[0]); hemi.groundColor.setHex(T.hemi[1]); hemi.intensity = T.hemi[2];
  sun.color.setHex(T.sun[0]); sun.intensity = T.sun[1]; sunOff.set(...T.sunOff);
  lakeMat.color.setHex(mix(B.lake, T.lake, k)); cloudMat.color.setHex(mix(B.cloud, T.cloud, k));
  duckGlow.intensity = T.glow;
}
// 반딧불·별빛용 동그란 빛
const steamTex = canvasTex(64, 64, (g, w, h) => {   // ♨️ 김: 가장자리가 흐릿한 흰 구름 덩이
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});
const glowTex = canvasTex(64, 64, (g, w, h) => {
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,250,200,0.9)'); grd.addColorStop(1, 'rgba(255,240,150,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});
const fireflyTex = canvasTex(64, 64, (g, w, h) => {
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,220,1)'); grd.addColorStop(0.3, 'rgba(220,255,120,0.85)'); grd.addColorStop(1, 'rgba(180,255,80,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});
const clouds = [];
for (let i = 0; i < 14; i++) {
  const c = new THREE.Group();
  const n = 3 + (i % 3);
  for (let k = 0; k < n; k++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(1.4 + Math.random() * 1.2, 10, 8), cloudMat);
    s.position.set(k * 1.7 - n * 0.8, Math.random() * 0.6, Math.random() * 1.2);
    c.add(s);
  }
  c.position.set((Math.random() - 0.5) * 160, 16 + Math.random() * 10, (Math.random() - 0.5) * 160);
  c.userData.speed = 0.4 + Math.random() * 0.6;
  scene.add(c); clouds.push(c);
}

// ---------- 오리 모델 ----------
function addOutlined(group, geo, mat, pos, scale, outline = true, e = 0.024) {
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(pos); if (scale) m.scale.copy(scale);
  m.castShadow = false;   // 오리는 그림자 없음
  group.add(m);
  if (outline) {
    // 윤곽선: 부품의 자식으로 붙여서 날개 퍼덕임·깃털 기울기를 같이 따라감.
    // 두께를 일정하게(+0.024) 해서 작은 부품(깃털·날개)도 윤곽이 또렷하게
    const sc = scale || V(1, 1, 1);
    const o = new THREE.Mesh(geo, outlineMat);
    o.scale.set((sc.x + e) / sc.x, (sc.y + e) / sc.y, (sc.z + e) / sc.z);
    m.add(o);
  }
  return m;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const sph = new THREE.SphereGeometry(1, 20, 14);
const sphLow = new THREE.SphereGeometry(1, 10, 8);
const sphHi = new THREE.SphereGeometry(1, 36, 26);   // 오리 몸·머리용 매끈한 구
const sphMid = new THREE.SphereGeometry(1, 18, 14);
sphHi.userData.keep = sphMid.userData.keep = true;

// 오리 전용 재질: 4단계 부드러운 툰 음영 + 가장자리 림 라이트(테두리가 은은하게 밝아짐)
const duckGrad = new THREE.DataTexture(new Uint8Array([150, 200, 235, 255]), 4, 1, THREE.LuminanceFormat);
duckGrad.minFilter = duckGrad.magFilter = THREE.NearestFilter; duckGrad.needsUpdate = true;
const duckMatCache = {};
function duckToon(color, rim = 0.32) {
  const key = color + '_' + rim;
  if (duckMatCache[key]) return duckMatCache[key];
  const m = new THREE.MeshToonMaterial({ color, gradientMap: duckGrad });
  m.onBeforeCompile = sh => {
    sh.uniforms.rimStr = { value: rim };
    sh.fragmentShader = 'uniform float rimStr;\n' + sh.fragmentShader.replace('#include <dithering_fragment>',
      `float rimF = 1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0);
       gl_FragColor.rgb += vec3(1.0, 0.97, 0.85) * smoothstep(0.55, 0.95, rimF) * rimStr;
       #include <dithering_fragment>`);
  };
  m.customProgramCacheKey = () => 'duckRim' + rim;
  return (duckMatCache[key] = m);
}

const eyeMat = new THREE.MeshBasicMaterial({ color: 0x2b1d14 });
const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const blushMat = new THREE.MeshBasicMaterial({ color: 0xff8fab, transparent: true, opacity: 0.75 });
const irisMat = new THREE.MeshBasicMaterial({ color: 0x6b4a2e });
const nostrilMat = new THREE.MeshBasicMaterial({ color: 0xb4581c });

// 소용돌이 무늬 (나선)
const whirlTex = canvasTex(128, 128, (g, w, h) => {
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(40,110,190,0.85)'); grd.addColorStop(0.7, 'rgba(90,170,230,0.55)'); grd.addColorStop(1, 'rgba(160,220,255,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(64, 64, 64, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineCap = 'round';
  for (let arm = 0; arm < 3; arm++) {
    g.lineWidth = 5; g.beginPath();
    for (let t = 0; t < 1; t += 0.02) {
      const a = arm * Math.PI * 2 / 3 + t * Math.PI * 3, r = 6 + t * 54;
      const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
      t === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }
});
const whirlMat = new THREE.MeshBasicMaterial({ map: whirlTex, transparent: true, depthWrite: false });
const fountainTex = canvasTex(64, 128, (g, w, h) => {   // 물기둥 무늬: 세로 물줄기 + 거품 점 (위로 흘러가게 애니메이션)
  g.fillStyle = 'rgba(200,238,255,0.75)'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(255,255,255,${0.35 + (i % 3) * 0.2})`; g.fillRect((i * 37) % w, 0, 3 + (i % 3) * 2, h); }
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc((i * 53) % w, (i * 29) % h, 1.5 + (i % 3), 0, Math.PI * 2); g.fill(); }
});
fountainTex.wrapS = fountainTex.wrapT = THREE.RepeatWrapping; fountainTex.repeat.set(2, 1.5);
const fountainMat = new THREE.MeshBasicMaterial({ map: fountainTex, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false });   // 분수 물기둥
const fountainCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
const fountainBoilMat = new THREE.MeshBasicMaterial({ color: 0xe9f8ff, transparent: true, opacity: 0.95 });
const fountainTopMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });

// 꽃게 (좌우로 왔다 갔다)
function makeFrog() {   // 🐸 앞(-z)이 오리 쪽
  const g = new THREE.Group(), green = toon(0x6cc24a);
  addOutlined(g, sphLow, green, V(0, 0.14, 0), V(0.2, 0.14, 0.22), true, 0.02);
  const belly = new THREE.Mesh(sphLow, toon(0xd9f2a6)); belly.scale.set(0.15, 0.08, 0.12); belly.position.set(0, 0.1, -0.1); g.add(belly);
  for (const sx of [-1, 1]) {
    addOutlined(g, sphLow, toon(0xffffff), V(sx * 0.09, 0.27, -0.1), V(0.065, 0.065, 0.065), true, 0.015);
    const pu = new THREE.Mesh(sphLow, new THREE.MeshBasicMaterial({ color: 0x222222 })); pu.scale.setScalar(0.033); pu.position.set(sx * 0.09, 0.28, -0.155); g.add(pu);
    const leg = new THREE.Mesh(sphLow, green); leg.scale.set(0.07, 0.05, 0.13); leg.position.set(sx * 0.17, 0.06, 0.04); g.add(leg);
    const arm = new THREE.Mesh(sphLow, green); arm.scale.set(0.04, 0.06, 0.04); arm.position.set(sx * 0.1, 0.05, -0.15); g.add(arm);
  }
  const cheek = new THREE.Mesh(sphLow, toon(0xff9fb6)); cheek.scale.set(0.12, 0.02, 0.02); cheek.position.set(0, 0.17, -0.2); g.add(cheek);   // 웃는 입
  return g;
}
function makeCrab() {   // 🦀 무서운 꽃게: 가시 돋친 검붉은 등껍질, 크고 뾰족한 집게(딱딱), 화난 눈썹, 이빨
  const g = new THREE.Group();
  const shell = toon(0xb3261e), dark = toon(0x7a140e), claw = toon(0xd2402a), tip = toon(0x3a0d0a);
  addOutlined(g, sph, shell, V(0, 0.2, 0), V(0.46, 0.2, 0.34));                       // 넓적한 등껍질
  for (const [x, z, s] of [[0, -0.05, 1], [-0.2, 0.02, 0.8], [0.2, 0.02, 0.8], [-0.1, 0.16, 0.7], [0.1, 0.16, 0.7], [0, 0.2, 0.6]]) {   // 등 가시
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05 * s, 0.16 * s, 6), dark);
    sp.position.set(x, 0.36 + (0.1 - Math.abs(x)) * 0.25, z); g.add(sp);
  }
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(sx * 0.46, 0.22, -0.2); arm.userData.sx = sx; g.add(arm);   // 집게 팔 (좌우로 휘두름)
    addOutlined(arm, sphLow, claw, V(sx * 0.06, 0, 0), V(0.18, 0.13, 0.15));
    const lower = addOutlined(arm, new THREE.ConeGeometry(0.07, 0.34, 7), claw, V(sx * 0.1, -0.02, -0.24), null);   // 아래 집게날
    lower.rotation.x = -Math.PI / 2;
    const jaw = new THREE.Group(); jaw.position.set(sx * 0.1, 0.06, -0.1); arm.add(jaw);                     // 위 집게날 (딱딱 여닫음)
    const upper = addOutlined(jaw, new THREE.ConeGeometry(0.06, 0.3, 7), claw, V(0, 0, -0.14), null);
    upper.rotation.x = -Math.PI / 2;
    for (const c of [lower, upper]) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 5), tip); t.position.y = 0.17; c.add(t); }   // 검은 집게 끝
    arm.userData.jaw = jaw;
    for (let k = 0; k < 3; k++) {   // 뾰족한 다리 3쌍
      const leg = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.36, 5), dark);
      leg.position.set(sx * 0.48, 0.1, -0.02 + k * 0.13); leg.rotation.z = sx * 1.15; g.add(leg);
    }
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6), dark);
    stalk.position.set(sx * 0.12, 0.44, -0.16); g.add(stalk);
    const eye = new THREE.Mesh(sphLow, toon(0xfff2a8)); eye.scale.setScalar(0.075); eye.position.set(sx * 0.12, 0.54, -0.17); g.add(eye);   // 노르스름한 눈
    const pupil = new THREE.Mesh(sphLow, eyeMat); pupil.scale.set(0.02, 0.045, 0.02); pupil.position.set(sx * 0.12, 0.54, -0.24); g.add(pupil);   // 세로로 찢어진 눈동자
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.04), tip);   // 화난 눈썹 (안쪽이 아래로)
    brow.position.set(sx * 0.13, 0.63, -0.2); brow.rotation.z = sx * 0.55; g.add(brow);
  }
  for (let k = -2; k <= 2; k++) {   // 삐죽삐죽 이빨
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.06, 4), shineMat);
    tooth.position.set(k * 0.05, 0.16, -0.33); tooth.rotation.x = Math.PI; g.add(tooth);
  }
  return g;
}

// 귀여운 오리: 큰 머리(2등신), 반짝이는 큰 눈 + 깜빡임, 볼터치, 머리 깃털, 작은 부리
function makeDuck(opts = {}) {
  const body = opts.body || 0xffd84d, bill = opts.bill || 0xff9a3c;
  const root = new THREE.Group();
  const bob = new THREE.Group(); root.add(bob);
  const B = duckToon(body), Bi = duckToon(bill, 0.2);
  const belly = new THREE.Color(body).lerp(new THREE.Color(0xfff6d0), 0.38).getHex();   // 배·볼은 살짝 밝은 크림색
  addOutlined(bob, sphHi, B, V(0, 0.22, 0.04), V(0.4, 0.31, 0.44));                 // 몸통 (작고 동글)
  addOutlined(bob, sphMid, duckToon(belly, 0.2), V(0, 0.23, -0.23), V(0.24, 0.17, 0.18), false);   // 앞가슴 밝은 털
  const tail = addOutlined(bob, sphMid, B, V(0, 0.4, 0.42), V(0.12, 0.1, 0.15));    // 꼬리
  tail.rotation.x = -0.6;
  const tail2 = addOutlined(bob, sphMid, B, V(0, 0.47, 0.5), V(0.06, 0.06, 0.09));  // 꼬리 끝 살짝 위로
  tail2.rotation.x = -0.9;
  addOutlined(bob, sphHi, B, V(0, 0.74, -0.2), V(0.34, 0.32, 0.32));                // 큰 머리
  addOutlined(bob, sphMid, duckToon(belly, 0.15), V(0, 0.665, -0.41), V(0.16, 0.1, 0.1), false);  // 부리 주변 밝은 얼굴
  // 머리 깃털 3가닥
  const tufts = [];
  [[0, 1.08, -0.16, 0], [-0.06, 1.05, -0.12, 0.5], [0.06, 1.05, -0.12, -0.5]].forEach(([x, y, z, r]) => {
    const t = addOutlined(bob, sphMid, B, V(x, y, z), V(0.04, 0.1, 0.04));
    t.rotation.z = r; t.rotation.x = -0.3; tufts.push(t);
  });
  // 부리: 위아래 두 겹으로 살짝 웃는 모양 + 콧구멍
  const up = addOutlined(bob, sphMid, Bi, V(0, 0.68, -0.52), V(0.12, 0.045, 0.1));
  up.rotation.x = -0.15;
  addOutlined(bob, sphMid, duckToon(0xf08a2c, 0.15), V(0, 0.645, -0.5), V(0.09, 0.03, 0.08), false);
  for (const sx of [-1, 1]) {
    const n = new THREE.Mesh(sphLow, nostrilMat); n.scale.set(0.012, 0.007, 0.01); n.position.set(sx * 0.035, 0.712, -0.6); bob.add(n);
  }
  // 날개: 몸보다 조금 진한 노랑 + 윤곽선, 끝에 깃털 두 겹
  const wingCol = opts.wing || 0xf2b01e, W = duckToon(wingCol, 0.25);
  const tip = duckToon(new THREE.Color(wingCol).multiplyScalar(0.9).getHex(), 0.2);
  const wingL = addOutlined(bob, sphHi, W, V(-0.39, 0.28, 0.06), V(0.08, 0.15, 0.25));
  const wingR = addOutlined(bob, sphHi, W, V(0.39, 0.28, 0.06), V(0.08, 0.15, 0.25));
  for (const w of [wingL, wingR]) for (const [y, z] of [[-0.35, 0.55], [-0.05, 0.8]]) {
    const f = new THREE.Mesh(sphMid, tip); f.scale.set(0.9, 0.45, 0.35); f.position.set(0, y, z); w.add(f);   // 날개 끝 깃털 (날개 크기 기준)
  }
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(sx * 0.135, 0.79, -0.475);
    eye.rotation.y = sx * -0.35;
    const pupil = new THREE.Mesh(sphMid, eyeMat); pupil.scale.set(0.065, 0.085, 0.04); eye.add(pupil);
    const iris = new THREE.Mesh(sphMid, irisMat); iris.scale.set(0.045, 0.04, 0.01); iris.position.set(0, -0.032, -0.033); eye.add(iris);   // 눈 아래쪽 갈색 반사
    const s1 = new THREE.Mesh(sphMid, shineMat); s1.scale.set(0.026, 0.028, 0.01); s1.position.set(-sx * 0.018, 0.03, -0.037); eye.add(s1);
    const s2 = new THREE.Mesh(sphMid, shineMat); s2.scale.setScalar(0.012); s2.position.set(sx * 0.02, -0.028, -0.04); eye.add(s2);
    bob.add(eye); eyes.push(eye);
    const blush = new THREE.Mesh(sphMid, blushMat);
    blush.scale.set(0.075, 0.04, 0.02); blush.position.set(sx * 0.22, 0.665, -0.44); blush.rotation.y = sx * -0.6;
    bob.add(blush);
  }
  if (opts.bow) { // 엄마 오리 리본
    addOutlined(bob, sphLow, toon(0xff7fa0), V(-0.1, 1.04, -0.12), V(0.1, 0.065, 0.045), false);
    addOutlined(bob, sphLow, toon(0xff7fa0), V(0.1, 1.04, -0.12), V(0.1, 0.065, 0.045), false);
    addOutlined(bob, sphLow, toon(0xff5f88), V(0, 1.04, -0.12), V(0.045, 0.045, 0.045), false);
  }
  root.userData = { bob, wingL, wingR, eyes, tufts, blinkT: 1 + Math.random() * 3 };
  const s = opts.scale || 1; root.scale.setScalar(s);
  return root;
}
// 🏁 라이벌 오리: 🐥 꼬마 경주 오리(주황+빨간 머리띠) / 😎 번개 오리(하늘색+선글라스) / 👑 챔피언 오리(보라+금관)
function makeRival(kind, body) {
  const d = makeDuck({ body: body || (kind === 'champ' ? 0xc6a4ff : kind === 'bolt' ? 0x7cc8ff : 0xffb35c) });
  const bob = d.userData.bob;
  if (kind === 'kid') {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.315, 0.045, 8, 28), toon(0xff4d5a)); band.rotation.x = Math.PI / 2 - 0.25; band.position.set(0, 0.9, -0.2); bob.add(band);
    const knot = new THREE.Mesh(sphLow, toon(0xff4d5a)); knot.scale.set(0.08, 0.06, 0.1); knot.position.set(0, 0.95, 0.12); bob.add(knot);
  } else if (kind === 'bolt') {
    const black = toon(0x1d1d28);
    for (const sx of [-1, 1]) { const lens = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.03), black); lens.position.set(sx * 0.13, 0.8, -0.5); lens.rotation.y = sx * -0.3; bob.add(lens); }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.02), black); bridge.position.set(0, 0.82, -0.53); bob.add(bridge);
  } else {
    const gold = toon(0xffcf3a), crown = new THREE.Group(); crown.position.set(0, 1.0, -0.18); bob.add(crown);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.12, 14, 1, true), gold); crown.add(ring);
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2, sp = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 5), gold); sp.position.set(Math.cos(a) * 0.17, 0.11, Math.sin(a) * 0.17); crown.add(sp); }
  }
  return d;
}
const flagTex = label => canvasTex(256, 48, (g, w, h) => {   // 체크무늬 + 글자 현수막
  for (let x = 0; x < w / 12; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#222' : '#fff'; g.fillRect(x * 12, y * 12, 12, 12); }
  g.fillStyle = 'rgba(255,255,255,.88)'; g.fillRect(w / 2 - 62, 6, 124, 36);
  g.fillStyle = '#e8590c'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, w / 2, 25);
});
const startTex = flagTex('START'), finishTex = flagTex('FINISH');
const checkerTex = canvasTex(64, 64, (g) => { for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) { g.fillStyle = (x + y) % 2 ? '#222' : '#fff'; g.fillRect(x * 8, y * 8, 8, 8); } });
const checkerMat = new THREE.MeshBasicMaterial({ map: checkerTex, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
// 눈 깜빡임 + 몸 말랑말랑 (모든 오리 공통)
function cuteIdle(d, dt, t) {
  const u = d.userData;
  u.blinkT -= dt;
  let k = 1;
  if (u.blinkT < 0.12) k = 0.12;
  if (u.blinkT < 0) u.blinkT = 2 + Math.random() * 3;
  for (const e of u.eyes) e.scale.y = k;
  const sq = Math.sin(t * 8.4) * 0.035;
  u.bob.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
}

// ---------- 파티클 (물보라, 하트/별 폭죽) ----------
const particles = [];
const dropGeo = new THREE.SphereGeometry(1, 6, 4);
const dropMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
const dropPool = [], spritePool = [];
function spawnDrop(x, y, z, vx, vy, vz, size, life, mat) {
  const m = dropPool.pop() || new THREE.Mesh(dropGeo, dropMat);
  m.material = mat || dropMat;
  m.position.set(x, y, z); m.visible = true; scene.add(m);
  particles.push({ m, vx, vy, vz, life, max: life, size, grav: 9, kind: 'drop' });
}
function spawnSprite(tex, x, y, z, vx, vy, vz, size, life, grav = 2.2) {
  let s = spritePool.pop();
  if (!s) s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
  s.material.map = tex; s.material.opacity = 1; s.material.needsUpdate = true;
  s.position.set(x, y, z); scene.add(s);
  particles.push({ m: s, vx, vy, vz, life, max: life, size, grav, kind: 'sprite' });
}
function burst(x, y, z, n, power, size, life = 0.7) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * power;
    spawnDrop(x, y, z, Math.cos(a) * r, power * (0.8 + Math.random()), Math.sin(a) * r, size * (0.6 + Math.random() * 0.6), life * (0.7 + Math.random() * 0.6));
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.m);
      (p.kind === 'drop' ? dropPool : spritePool).push(p.m);
      particles.splice(i, 1); continue;
    }
    p.vy -= p.grav * dt;
    p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
    const k = p.life / p.max;
    if (p.kind === 'drop') p.m.scale.setScalar(p.size * (0.3 + 0.7 * k));
    else { p.m.scale.setScalar(p.size * (0.6 + 0.4 * Math.sin(Math.min(1, (1 - k) * 4) * Math.PI / 2))); p.m.material.opacity = Math.min(1, k * 2.5); }
  }
}

// ---------- 트랙 생성 ----------
// 🙂 보통 / 🔥 어려움: 차이는 물길 폭. 어려움 = 원래 폭, 보통 = 레벨 4부터 점점 넓어져 레벨 20~ 은 1.24배
const isHard = () => save.diff === 'hard';
const widthMul = n => isHard() ? 1 : 1 + 0.24 * clamp((n - 3) / 17, 0, 1);
// 🛣️ 보통 난이도: 바깥쪽에 벽이 없는 코너는 바깥쪽이 살짝 높게 기울임 (원심력을 조금 버텨 줌)
// bank = 옆으로 1 갈 때 높아지는 양 (+ 면 왼쪽이 높음). 코너 앞뒤로 부드럽게 기울었다 펴짐
const BANK_MAX = Math.tan(Math.PI / 6), BANK_G = 4.5;   // 최대 30° / 안쪽으로 미는 세기
function bankTrack(S) {
  const N = S.length, raw = new Float32Array(N), plain = q => !(q.fall || q.ramp || q.gap || q.jet || q.lift || q.slide || q.loopZone || q.fork || q.stone || q.cliff || q.pool || q.land || q.race || q.hop || q.rail || q.ih > 0.02);
  for (let i = 4; i < N - 4; i++) {
    const s = S[i], a = S[i - 4], b = S[i + 4];
    if (!plain(s)) continue;
    const bend = (b.tx - a.tx) * s.nx + (b.tz - a.tz) * s.nz;   // + : 왼쪽으로 휨 → 바깥 = 오른쪽
    if (Math.abs(bend) < 0.06) continue;
    const outerWall = bend > 0 ? s.wr : s.wl;
    if (outerWall) continue;
    raw[i] = -clamp(bend * 2.6, -BANK_MAX, BANK_MAX);   // 바깥쪽이 높아지도록
  }
  let cur = raw;
  for (let pass = 0; pass < 2; pass++) {   // 앞뒤 12칸 평균으로 부드럽게 (두 번)
    const out = new Float32Array(N); let acc = 0;
    for (let i = 0; i < N; i++) {
      acc += cur[Math.min(N - 1, i + 12)] - (i - 13 >= 0 ? cur[i - 13] : 0);
      if (i === 0) { acc = 0; for (let k = 0; k <= 12; k++) acc += cur[k]; }
      out[i] = acc / 25;
    }
    cur = out;
  }
  for (let i = 0; i < N; i++) if (Math.abs(cur[i]) > 0.004 && plain(S[i])) S[i].bank = cur[i];
}
function sampleTrack(def) {
  const out = []; const STEP = 0.25, WM = widthMul(def.no || 1);
  let x = 0, y = 0, z = 0, th = -Math.PI / 2, d = 0;   // 동쪽(화면 오른쪽)으로 출발
  const push = (p, slope = 0, flags = {}) => {
    const fx = -Math.sin(th), fz = -Math.cos(th);
    out.push({ x, y, z, tx: fx, tz: fz, nx: fz, nz: -fx, d, slope,   // n = 진행 방향의 왼쪽
      fall: p.t === 'F' || !!flags.fall, lift: !!flags.lift, vlift: !!flags.vlift, rail: !!flags.rail, rlane: flags.rlane || 0, rlaneW: flags.rlaneW || 0, ramp: !!flags.ramp, gap: !!flags.gap || !!p.hopGap, jet: !!flags.jet, big: !!flags.big, loopIn: !!flags.loopIn, loopZone: !!p.loop, cliff: !!flags.cliff, pool: !!flags.pool, land: !!p.land, slide: !!p.slide, stone: !!p.stone, so: p.stone ? p.so : 0, hop: !!p.hopGap, race: !!p.race,
      fork: !!p.fork, fside: p.fork ? p.fside : 0, fv: p.fork ? p.fv || 'classic' : '', ih: (flags.ih || 0) * WM, ic: (flags.ic || 0) * WM, fast: !!flags.fast,   // 🔀 갈림길: 가운데 섬 반폭(ih), 빠른 쪽(fside)
      w: (p.w || def.width) / 2 * WM,
      wl: p.walls === 'both' || p.walls === 'L',
      wr: p.walls === 'both' || p.walls === 'R' });
  };
  push(def.pieces[0]);
  for (const p of def.pieces) {
    const len = p.t === 'C' ? Math.abs(p.angle * Math.PI / 180) * p.radius : p.len;
    const n = Math.max(1, Math.round(len / STEP)), ds = len / n;
    const dth = p.t === 'C' ? (p.angle * Math.PI / 180) / n : 0;
    const y0 = y;
    for (let i = 0; i < n; i++) {
      th += dth / 2; x += -Math.sin(th) * ds; z += -Math.cos(th) * ds; th += dth / 2; d += ds;
      let slope = 0;
      if (p.t === 'J') {   // 점프대: 경사로로 올라갔다가 → 물길이 끊긴 구간(gap)
        const u = (i + 1) * ds;
        if (u <= p.ramp + 1e-6) { const v = u / p.ramp; y = y0 + p.h * v * v; push(p, 0, { ramp: true, jet: !!p.jet }); }
        else { y = y0; push(p, 0, { gap: true }); }
        continue;
      }
      if (p.t === 'CL') {   // ⛰️ 절벽: 짧은 빈 공간(떨어지는 곳) → 아래 깊은 웅덩이
        const u = (i + 1) * ds;
        y = y0 - p.drop;
        push(p, 0, u <= p.gap + 1e-6 ? { gap: true, cliff: true } : { pool: u <= p.gap + p.poolLen });
        continue;
      }
      if (p.t === 'L') {   // 🎯 멀리뛰기: 가속 경사로 → 아래로 내려간 넓은 빈 공간
        const u = (i + 1) * ds;
        if (u <= p.ramp + 1e-6) { const v = u / p.ramp; y = y0 + p.h * v * v; push(p, 0, { ramp: true, jet: true }); }
        else { y = y0 - p.drop; push(p, 0, { gap: true, big: true }); }
        continue;
      }
      if (p.liftUp) {   // 🛗 물 엘리베이터 오르막 (나선 슬라이드 뒤)
        const v = (i + 1) / n;
        y = y0 + p.rise * v * v * (3 - 2 * v); push(p, -p.rise * 6 * v * (1 - v) / len, { lift: true });
        continue;
      }
      if (p.slide) {   // 🛝 워터슬라이드: 일정하게 쭉 내려감
        const u = (i + 1) / n;
        y = y0 - p.drop * u; push(p, p.drop / len);
        continue;
      }
      if (p.t === 'V') {   // 🎢 골짜기: 앞 35% 는 깊은 폭포, 뒤 65% 는 물 엘리베이터로 다시 올라감
        const u = (i + 1) / n, A = p.A || 0.35;
        if (u <= A) { const v = u / A; y = y0 - p.depth * v * v * (3 - 2 * v); push(p, p.depth * 6 * v * (1 - v) / (A * len), { fall: true }); }
        else { const v = (u - A) / (1 - A); y = y0 - p.depth * (1 - v * v * (3 - 2 * v)); push(p, -p.depth * 6 * v * (1 - v) / ((1 - A) * len), { lift: true, vlift: true }); }
        continue;
      }
      if (p.t === 'F') { // 부드러운 S자 낙차 (가운데가 가장 가파름)
        const u = (i + 1) / n;
        y = y0 - p.drop * (u * u * (3 - 2 * u));
        slope = p.drop * 6 * u * (1 - u) / len;
      }
      if (p.cart) {   // 🚃 광산 기차 레일: 승강장(평평) → 언덕 두 번 오르내림 → 끝(평평). 가운데쯤에서 레일이 둘로 갈라졌다 다시 합쳐짐
        const u = (p.cu0 ?? 0) + (i + 1) / n * ((p.cu1 ?? 1) - (p.cu0 ?? 0)), v = clamp((u - 0.05) / 0.9, 0, 1);   // u: 레일 전체에서의 위치
        const hill = uu => { const vv = clamp((uu - 0.05) / 0.9, 0, 1); return uu < 0.05 || uu > 0.95 ? 0 : 2.0 * Math.sin(Math.PI * vv) + 1.0 * Math.sin(5 * Math.PI * vv); };
        y = y0 + hill(u) - hill(p.cu0 ?? 0);   // 오르락내리락 언덕 여러 개 (y0 = 이 조각 시작 높이라서 그 높이의 언덕만큼 빼 줌 → 조각 이음매가 매끈)
        const sm01 = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
        const env = sm01((v - 0.32) / 0.1) * sm01((0.74 - v) / 0.1), tt = clamp((v - 0.32) / 0.42, 0, 1);
        // rlane: 빠른 레일 (가깝게 나란히) / rlaneW: 🪙 코인 레일 (바깥으로 크게 빙 돌아감)
        push(p, 0, { rail: true, rlane: 0.85 * env, rlaneW: 0.95 * env + 3.4 * Math.sin(Math.PI * tt) ** 1.3 });
        continue;
      }
      if (p.loop) {   // 🎢 루프 직선: 앞 45%는 가속 물살, 55% 지점에서 루프 관으로 들어감
        const dd = (i + 1) * ds;
        push(p, 0, { jet: dd < len * 0.45, loopIn: dd >= len * 0.55 && dd - ds < len * 0.55 });
        continue;
      }
      if (p.fork) {   // 섬은 앞뒤 끝이 뾰족하게 (물길이 넓어진 뒤에 시작)
        const dd = (i + 1) * ds, r = x => { const u = clamp((x - 2) / 3, 0, 1); return u * u * (3 - 2 * u); };
        const ns = p.ns ?? 0.38, mid = clamp((dd / len - ns) / 0.17, 0, 1), sq = mid * mid * (3 - 2 * mid) * r(len - dd);
        push(p, 0, { ih: p.ih * r(dd) * r(len - dd), ic: p.fside * (p.sq ?? 0.65) * sq, fast: dd / len > ns + 0.07 && len - dd > 3.5 });
        continue;
      }
      push(p, slope);
    }
  }
  // 폭 변화를 부드럽게
  const raw = out.map(s => s.w);
  for (let i = 0; i < out.length; i++) {
    let sum = 0, c = 0;
    for (let k = -8; k <= 8; k++) { const j = i + k; if (j >= 0 && j < out.length) { sum += raw[j]; c++; } }
    out[i].w = sum / c;
  }
  return out;
}

// 샘플을 따라 리본 메쉬 생성: offA/offB(s) = 법선 방향 오프셋, yA/yB = 높이
function ribbon(samples, i0, i1, offA, yA, offB, yB, mat, vScale) {
  const pos = [], uv = [], idx = [];
  for (let i = i0; i <= i1; i++) {
    const s = samples[i];
    const a = offA(s), b = offB(s);
    const bk = s.bank || 0;   // 🛣️ 기울어진 코너: 옆으로 갈수록 높이가 달라짐
    pos.push(s.x + s.nx * a, s.y + yA + bk * a, s.z + s.nz * a, s.x + s.nx * b, s.y + yB + bk * b, s.z + s.nz * b);
    const v = vScale ? s.d / vScale : 0;
    uv.push(0, v, 1, v);
    if (i < i1) { const k = (i - i0) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

// 🌊 물 표면은 기울기(경사 코너·비탈)와 상관없이 같은 밝기로: 법선을 모두 위로
// (툰 셰이딩이 기울어진 면을 다른 단계로 칠해서 코너만 물색이 달라 보였음)
function flatUp(mesh) {
  const nm = mesh.geometry.attributes.normal;
  for (let i = 0; i < nm.count; i++) nm.setXYZ(i, 0, 1, 0);
  nm.needsUpdate = true; return mesh;
}

// 플래그가 켜진 연속 구간 [시작, 끝] 목록
function runs(samples, key) {
  const r = []; let st = -1;
  for (let i = 0; i < samples.length; i++) {
    const on = samples[i][key] && (i === 0 || true);
    if (on && st < 0) st = i;
    if ((!on || i === samples.length - 1) && st >= 0) { r.push([st, on ? i : i - 1]); st = -1; }
  }
  return r.filter(([a, b]) => b > a);
}

const WALL_T = 0.32, WALL_H = 0.5, BASE_D = 0.9;
const stoneMat = () => toon(0xd9cbb4, { side: THREE.DoubleSide });
const woodMat = () => toon(0xc98f5a, { side: THREE.DoubleSide });

function buildLevelWorld(def) {
  const levelNo = def.no, RACE = def.race || 0;   // 🏁 RACE = 레이스 스테이지 번호 (0 = 보통 레벨)
  LAKE_Y = def.lakeY ?? lakeYFor(levelNo);
  const theme = def.theme || themeFor(levelNo), biome = biomeFor(levelNo);
  autumn = biome.id === 'mountain' && !def.race;   // 🍁 21~30: 단풍
  applyTheme(theme, biome);
  const rainy = !RACE && isRainy(levelNo);
  if (rainy) applyRainTint(theme);
  setWeather(rainy ? 'rain' : biome.id === 'snow' ? 'snow' : biome.id === 'mountain' ? 'leaves' : biome.id === 'meadow' ? 'petals' : 'none', theme === 'night');   // 설원 밤은 함박눈 · 🌸 11~20 꽃잎
  lake.position.y = LAKE_Y;
  const group = new THREE.Group();
  const samples = sampleTrack(def);
  const N = samples.length;
  if (!isHard() && !def.race) bankTrack(samples);   // 🙂 보통: 벽 없는 코너는 바깥쪽이 살짝 높게
  // 도착 섬(잔디) 위를 지나는 마지막 물길: 나무 난간 대신 돌로 된 물가로 자연스럽게 연못과 이어짐
  {
    const e = samples[N - 1], c = { x: e.x + e.tx * 4.8, z: e.z + e.tz * 4.8 };
    for (const sm of samples) sm.island = Math.hypot(sm.x - c.x, sm.z - c.z) < 4.8 + 3.4;
  }
  // 물길(물·바닥·돌 측면·난간)이 그림자를 드리우고 받음. 예전엔 castShadow 가 빠져서 기둥 그림자만 보였음
  const add = m => { m.receiveShadow = true; m.castShadow = true; group.add(m); return m; };

  // 물 표면 + 바닥 + 측면 (돌 수로). 점프대의 끊어진 구간(gap)은 비워 둠
  const solid = runs(samples.map(s => ({ x: !s.gap && !s.stone && !s.rail })), 'x');
  const deepWater = levelNo >= 50 && !RACE;   // 🌊 레벨 50~: 물이 너무 밝아 보여서 더 짙은 물 + 군데군데 짙은 얼룩
  for (const [a, b] of solid) {
    add(flatUp(ribbon(samples, a, b, s => s.w, 0.02, s => -s.w, 0.02, waterMatFor(theme, deepWater), 4)));
    if (deepWater) addWaterPatches(group, samples, a, b);
    add(ribbon(samples, a, b, s => s.w, -0.35, s => -s.w, -0.35, toon(0xf3e2b8, { side: THREE.DoubleSide })));
    add(ribbon(samples, a, b, s => s.w, 0.0, s => s.w, -BASE_D, stoneMat()));
    add(ribbon(samples, a, b, s => -s.w, 0.0, s => -s.w, -BASE_D, stoneMat()));
    add(ribbon(samples, a, b, s => s.w, -BASE_D, s => -s.w, -BASE_D, stoneMat()));
  }
  const cliffSplash = [];   // ⛰️ 절벽 물줄기가 떨어지는 곳 (물보라)
  // 끊어진 곳의 앞뒤 단면 + 점프대 끝 나무 발판
  for (let i = 1; i < N; i++) {
    const enter = samples[i].gap && !samples[i - 1].gap, leave = !samples[i].gap && samples[i - 1].gap;
    if (!enter && !leave) continue;
    const sm = samples[enter ? i - 1 : i];
    if (sm.stone) continue;                          // 징검다리 돌은 따로 그림
    if (enter && samples[i].cliff) {                 // ⛰️ 절벽: 위 물길 끝에서 웅덩이 아래까지 바위 절벽 + 떨어지는 물줄기
      const low = samples[i].y, H = sm.y - low + BASE_D;
      const rock = new THREE.Mesh(new THREE.BoxGeometry(sm.w * 2 + WALL_T * 2 + 0.3, H, 0.7), toon(0x9c8f80));
      rock.position.set(sm.x + sm.tx * 0.2, sm.y - H / 2 + 0.02, sm.z + sm.tz * 0.2); rock.rotation.y = Math.atan2(-sm.tx, -sm.tz); add(rock);
      for (let k = 0; k < 4; k++) {   // 울퉁불퉁 바위
        const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35 + k * 0.08, 0), toon(0x8a7e70));
        const o = (k / 3 - 0.5) * sm.w * 1.6; b.position.set(sm.x + sm.nx * o + sm.tx * 0.5, sm.y - H * (0.3 + 0.15 * k), sm.z + sm.nz * o + sm.tz * 0.5); add(b);
      }
      // 💦 절벽 끝에서 쏟아지는 물줄기: 앞으로 살짝 휘어 나가며 아래 웅덩이까지 떨어짐 (하얀 줄무늬가 아래로 흐름)
      const drop = sm.y - low, arc = [];
      let dd = 0;
      for (let k = 0; k <= 14; k++) {
        const u = k / 14, out = 0.7 * Math.min(1, u * 4) + 0.3 * u, y = sm.y + 0.04 - drop * Math.pow(u, 1.5);
        const q = { ...sm, x: sm.x + sm.tx * out, z: sm.z + sm.tz * out, y, w: sm.w * (0.92 + 0.12 * u) };
        if (arc.length) { const pq = arc[arc.length - 1]; dd += Math.hypot(q.x - pq.x, q.y - pq.y, q.z - pq.z); }
        q.d = dd; arc.push(q);
      }
      const sheet = ribbon(arc, 0, arc.length - 1, q => q.w, -0.02, q => -q.w, -0.02, cliffWaterMat); sheet.renderOrder = 1; group.add(sheet);   // 파란 물 막
      const streak = ribbon(arc, 0, arc.length - 1, q => q.w, 0, q => -q.w, 0, fallMat, 1.2); streak.renderOrder = 2; group.add(streak);   // 그 위로 하얀 물줄기가 흘러내림
      // 💦 떨어지는 곳 물보라: 출렁이는 거품 덩어리 + (실행 중) 튀어 오르는 물방울·피어오르는 물안개·퍼지는 물결
      const e = arc[arc.length - 1], blobs = [];
      for (let k = 0; k < 7; k++) {
        const f = new THREE.Mesh(sphLow, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
        const lat = (k / 6 - 0.5) * sm.w * 1.7, fw = 0.15 + (k % 2) * 0.35;
        f.position.set(e.x + sm.nx * lat + sm.tx * fw, low + 0.08, e.z + sm.nz * lat + sm.tz * fw); group.add(f);
        blobs.push({ m: f, ph: k * 1.7, s: 0.32 + (k % 3) * 0.08 });
      }
      const foamRing = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }));
      foamRing.rotation.x = -Math.PI / 2; foamRing.scale.set(sm.w * 1.15, 1.1, 1); foamRing.position.set(e.x + sm.tx * 0.5, low + 0.06, e.z + sm.tz * 0.5);
      foamRing.rotation.z = Math.atan2(sm.tx, sm.tz); group.add(foamRing);
      const rings = [];
      for (let k = 0; k < 3; k++) {   // 퍼져 나가는 물결 고리
        const r = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
        r.rotation.x = -Math.PI / 2; r.position.set(e.x + sm.tx * 0.6, low + 0.07, e.z + sm.tz * 0.6); group.add(r); rings.push({ m: r, t: k / 3 });
      }
      cliffSplash.push({ x: e.x, y: low, z: e.z, nx: sm.nx, nz: sm.nz, tx: sm.tx, tz: sm.tz, w: sm.w, blobs, ring: foamRing, rings });
      continue;
    }
    if (samples[enter ? i : i - 1].hop) {            // 징검다리 앞뒤 수로 끝: 단면만
      const f2 = new THREE.Mesh(new THREE.BoxGeometry(sm.w * 2 + WALL_T * 2, BASE_D + 0.02, 0.18), stoneMat());
      f2.position.set(sm.x, sm.y - BASE_D / 2, sm.z); f2.rotation.y = Math.atan2(-sm.tx, -sm.tz); add(f2);
      continue;
    }
    const face = new THREE.Mesh(new THREE.BoxGeometry(sm.w * 2 + WALL_T * 2, sm.y - (sm.y - BASE_D) + 0.02 + (enter ? 0 : 0), 0.18), stoneMat());
    face.position.set(sm.x, sm.y - BASE_D / 2, sm.z); face.rotation.y = Math.atan2(-sm.tx, -sm.tz); add(face);
    if (enter) {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(sm.w * 2 + WALL_T * 2, 0.12, 0.35), woodMat());
      lip.position.set(sm.x - sm.tx * 0.1, sm.y + 0.04, sm.z - sm.tz * 0.1); lip.rotation.y = Math.atan2(-sm.tx, -sm.tz); add(lip);
      // 점프 표시: 경사로 위 노란 화살표
      const arrow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 3), new THREE.MeshBasicMaterial({ color: 0xffd84d, transparent: true, opacity: 0.9 }));
      const sa = samples[Math.max(0, i - 5)];
      arrow.rotation.order = 'YXZ'; arrow.rotation.y = Math.atan2(-sa.tx, -sa.tz); arrow.rotation.x = -Math.PI / 2; arrow.rotation.z = Math.PI / 2;
      arrow.position.set(sa.x, sa.y + 0.06, sa.z); group.add(arrow);
    }
  }

  // 난간 (나무) / 위험 구간 거품 표시
  const posts = [];
  for (const side of ['wl', 'wr']) {
    const sg = side === 'wl' ? 1 : -1;
    for (const [a, b] of runs(samples.map(s => ({ x: s[side] && !s.island && !s.gap })), 'x')) {
      const inner = s => sg * s.w, outer = s => sg * (s.w + WALL_T);
      add(ribbon(samples, a, b, inner, WALL_H, outer, WALL_H, woodMat()));
      add(ribbon(samples, a, b, inner, -0.05, inner, WALL_H, woodMat()));
      add(ribbon(samples, a, b, outer, -BASE_D, outer, WALL_H, toon(0xb47a48, { side: THREE.DoubleSide })));
      add(ribbon(samples, a, b, outer, -BASE_D, inner, -BASE_D, stoneMat()));
      for (let i = a; i <= b; i += 8) posts.push([samples[i], sg]);
      if ((b - a) % 8) posts.push([samples[b], sg]);
    }
    for (const [a, b] of runs(samples.map(s => ({ x: !s[side] && !s.island && !s.gap && !s.stone && !s.rail })), 'x')) {
      if (b - a < 2) continue;
      const foam = ribbon(samples, a, b, s => sg * (s.w - 0.18), 0.04, s => sg * s.w, 0.04,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
      group.add(foam);
    }
  }
  // 섬 위 물가: 크기가 조금씩 다른 둥근 돌이 줄지어 있음
  for (let i = 0; i < N; i += 3) {
    const sm = samples[i];
    if (!sm.island) continue;
    for (const sg of [1, -1]) {
      const r = new THREE.Mesh(sphLow, toon((i / 3 + (sg > 0 ? 1 : 0)) % 2 ? 0xe8ddca : 0xd9ccb4));
      const sc = 0.3 + ((i * 7 + (sg > 0 ? 3 : 0)) % 5) * 0.035;
      r.scale.set(sc, 0.22, sc);
      const o = sg * (sm.w + 0.18);
      r.position.set(sm.x + sm.nx * o, sm.y + 0.04, sm.z + sm.nz * o);
      r.castShadow = true; add(r);
    }
  }
  if (posts.length) {
    const pg = new THREE.CylinderGeometry(0.2, 0.22, 0.75, 8);
    const im = new THREE.InstancedMesh(pg, toon(0xb47a48), posts.length);
    const m4 = new THREE.Matrix4();
    posts.forEach(([s, sg], i) => {
      const o = sg * (s.w + WALL_T / 2);
      m4.makeTranslation(s.x + s.nx * o, s.y + WALL_H - 0.3 + 0.375, s.z + s.nz * o);
      im.setMatrixAt(i, m4);
    });
    im.castShadow = true; group.add(im);
  }

  // 출발점 뒤: 막힌 벽 대신 뒤에서 물이 흘러 들어오는 물길을 길게 그려 둠 (보이기만, 들어갈 수는 없음)
  const s0 = samples[0];
  {
    let M = 120;   // 0.25 간격 → 30칸
    for (let k = 1; k <= 120 && M === 120; k++) {   // 다른 물길과 겹치기 전까지만
      const bx = s0.x - s0.tx * 0.25 * k, bz = s0.z - s0.tz * 0.25 * k;
      for (let j = 40; j < N; j += 2) { const q = samples[j]; if (Math.abs(q.y - s0.y) < 2.6 && (q.x - bx) ** 2 + (q.z - bz) ** 2 < (q.w + s0.w + 1.2) ** 2) { M = Math.max(0, k - 6); break; } }
    }
    if (M >= 4) {
      const back = [];
      for (let k = M; k >= 0; k--) back.push({ ...s0, x: s0.x - s0.tx * 0.25 * k, z: s0.z - s0.tz * 0.25 * k, d: s0.d - 0.25 * k, wl: true, wr: true });
      const e = back.length - 1;
      const backPostGeo = new THREE.CylinderGeometry(0.2, 0.22, 0.75, 8), backPostMat = toon(0xb47a48);
      add(flatUp(ribbon(back, 0, e, q => q.w, 0.02, q => -q.w, 0.02, waterMatFor(theme, deepWater), 4)));   // 시작점 뒤 물길도 같은 물색
      if (deepWater) addWaterPatches(group, back, 0, e);
      add(ribbon(back, 0, e, q => q.w, -0.35, q => -q.w, -0.35, toon(0xf3e2b8, { side: THREE.DoubleSide })));
      add(ribbon(back, 0, e, q => q.w, -BASE_D, q => -q.w, -BASE_D, stoneMat()));
      for (const sg of [1, -1]) {
        const inner = q => sg * q.w, outer = q => sg * (q.w + WALL_T);
        add(ribbon(back, 0, e, inner, WALL_H, outer, WALL_H, woodMat()));
        add(ribbon(back, 0, e, inner, -0.05, inner, WALL_H, woodMat()));
        add(ribbon(back, 0, e, outer, -BASE_D, outer, WALL_H, toon(0xb47a48, { side: THREE.DoubleSide })));
        add(ribbon(back, 0, e, outer, -BASE_D, inner, -BASE_D, stoneMat()));
        for (let i = 0; i < e; i += 8) {   // 난간 기둥
          const q = back[i], o = sg * (q.w + WALL_T / 2), pm = new THREE.Mesh(backPostGeo, backPostMat);
          pm.position.set(q.x + q.nx * o, q.y + WALL_H - 0.3 + 0.375, q.z + q.nz * o); pm.castShadow = true; add(pm);
        }
      }
      for (let i = 0; i < e - 6; i += 28) {   // 받침 기둥
        const q = back[i], h = q.y - BASE_D - LAKE_Y;
        const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 1, 10), toon(0xcdbda3)); pl.scale.y = h; pl.position.set(q.x, LAKE_Y + h / 2, q.z); add(pl);
      }
    }
  }

  // 🎢 세로 루프: 들어가는 줄(왼쪽)에서 위로 한 바퀴 돌아 옆 줄(오른쪽)로 내려오는 초록 관 + 물
  const loops = [];
  samples.forEach((s, i) => {
    if (!s.loopIn) return;
    const L = { idx: i, x: s.x, y: s.y, z: s.z, tx: s.tx, tz: s.tz, nx: s.nx, nz: s.nz, R: 3.0, lat0: -0.5 * s.w, lat1: 0.5 * s.w, hw: Math.min(0.85, 0.5 * s.w - 0.04) };   // 들어가는 관·나오는 관이 물길 폭을 반씩 꽉 채움
    loops.push(L);
    const M = 72;
    const tealM = toon(0x2bb3a3, { side: THREE.DoubleSide, transparent: true, opacity: 0.45, depthWrite: false }), railM = toon(0x1f8f83, { side: THREE.DoubleSide, transparent: true, opacity: 0.6, depthWrite: false });   // 반투명 관 → 위에서도 안의 오리가 보임
    const strip = (fn, mat) => {   // fn(θ) → [왼쪽 점, 오른쪽 점]
      const pos = [], ix = [];
      for (let k = 0; k <= M; k++) { const [a, b] = fn(k / M * Math.PI * 2); pos.push(...a, ...b); if (k < M) { const q = k * 2; ix.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(ix); g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); add(m); return m;
    };
    const P3 = (th, side, inward, out) => {   // 루프 위 한 점: side = 옆으로(±hw), inward = 관 안쪽으로
      const p = loopPoint(L, th, null), ix = -Math.sin(th), iy = Math.cos(th);   // 안쪽(원 중심) 방향 (앞·위 평면)
      return [p.x + L.nx * side + L.tx * ix * (inward - out), p.y + iy * (inward - out), p.z + L.nz * side + L.tz * ix * (inward - out)];
    };
    strip(th => [P3(th, L.hw, 0.03, 0), P3(th, -L.hw, 0.03, 0)], new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));   // 물
    strip(th => [P3(th, L.hw + 0.12, 0, 0.12), P3(th, -L.hw - 0.12, 0, 0.12)], tealM);   // 관 바닥(바깥)
    for (const sg of [1, -1]) strip(th => [P3(th, sg * (L.hw + 0.06), 0, 0.12), P3(th, sg * (L.hw + 0.06), 0.5, 0)], railM);   // 양옆 벽
    for (const sg of [1, -1]) {   // 받침 다리: 물길 양옆 난간 위에서 루프 꼭대기까지
      const top = loopPoint(L, Math.PI, null), bx = s.x + s.nx * sg * (s.w + WALL_T / 2), bz = s.z + s.nz * sg * (s.w + WALL_T / 2);
      const h = top.y + 0.1 - s.y, leg = new THREE.Mesh(decoGeo.cyl, toon(0xd9534f)); leg.scale.set(0.12, h, 0.12); leg.position.set(bx, s.y + h / 2, bz); add(leg);
    }
    { const top = loopPoint(L, Math.PI, null), bar = new THREE.Mesh(decoGeo.cyl, toon(0xd9534f)); bar.scale.set(0.1, s.w * 2 + WALL_T, 0.1); bar.position.set(s.x, top.y + 0.1, s.z); bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(s.nx, 0, s.nz)); add(bar); }
  });

  // 작은 폭포: 하얀 물줄기 + 아래쪽 거품
  const falls = [];
  for (const [a, b] of runs(samples, 'fall')) {
    // 위·아래 끝은 그라데이션: 물줄기가 위에서 서서히 나타나고, 아래에선 거품 속으로 스르르 사라짐
    const TOP = 5, BOT = 10, i0 = Math.max(0, a - TOP), i1 = Math.min(N - 1, b + BOT);
    const streak = setFade(ribbon(samples, i0, i1, s => s.w, 0.05, s => -s.w, 0.05, fallFadeMat, 1.2), i0, i1,
      i => i < a ? smooth01((i - i0) / TOP) : i > b ? 1 - smooth01((i - b) / BOT) : 1);
    streak.renderOrder = 2; group.add(streak);
    const e = Math.min(N - 1, b + 2);
    const f0 = Math.max(0, b - 3), foamEnd = Math.min(N - 1, b + 22);   // 거품: 폭포 아래에서 진하게 생겼다가 물살 따라 옅어짐
    const foam = setFade(ribbon(samples, f0, foamEnd, s => s.w, 0.055, s => -s.w, 0.055, foamFadeMat, 2), f0, foamEnd,
      i => i < b + 2 ? smooth01((i - f0) / 5) : 1 - smooth01((i - b - 2) / (foamEnd - b - 2)));
    foam.renderOrder = 3; group.add(foam);
    falls.push({ x: samples[e].x, y: samples[e].y, z: samples[e].z, s: samples[e] });
  }

  // 🎯 멀리뛰기 가속 경사로: 노란 화살표 물살
  for (const [a, b] of runs(samples, 'jet')) group.add(ribbon(samples, Math.max(0, a - 8), b, s => s.w - 0.15, 0.05, s => -s.w + 0.15, 0.05, boostMatSparse, 3.3));
  // 🎢 물 엘리베이터: 골짜기 오르막에 위로 흐르는 화살표 (물살이 오리를 밀어 올림)
  for (const [a, b] of runs(samples, 'lift')) group.add(ribbon(samples, a, b, s => s.w - 0.15, 0.05, s => -s.w + 0.15, 0.05, boostMatSparse, 3.3));
  // ⛰️ 절벽 아래 깊은 웅덩이: 바닥을 짙은 파랑으로 (깊어 보이게) + 하얀 물거품 테
  for (const [a, b] of runs(samples, 'pool')) {
    // 웅덩이 끝쪽(물살 따라 아래쪽)으로 갈수록 짙은 파랑이 옅어져 보통 물길과 자연스럽게 이어짐
    const F = Math.max(8, Math.min(40, Math.floor((b - a) * 0.6))), fadeAt = i => 1 - smooth01((i - (b - F)) / F);
    const floor = ribbon(samples, a, b, s => s.w, -0.18, s => -s.w, -0.18, toon(0xffffff, { side: THREE.DoubleSide, vertexColors: true }));
    const cDeep = new THREE.Color(0x0f3f78), cSand = new THREE.Color(0xf3e2b8), cols = [];
    for (let i = a; i <= b; i++) { const c = cSand.clone().lerp(cDeep, fadeAt(i)); cols.push(c.r, c.g, c.b, c.r, c.g, c.b); }
    floor.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); add(floor);
    const deep = ribbon(samples, a, b, s => s.w, 0.03, s => -s.w, 0.03, poolTintMat, 1);   // 물 위로 짙은 파랑을 덧칠 (깊은 물)
    const al = []; for (let i = a; i <= b; i++) { const f = fadeAt(i); al.push(f, f); }
    deep.geometry.setAttribute('fade', new THREE.Float32BufferAttribute(al, 1));
    deep.renderOrder = 2; group.add(deep);
    group.add(ribbon(samples, a, Math.min(b, a + 6), s => s.w, 0.04, s => -s.w, 0.04, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }), 1));
  }
  // 🪨 징검다리 돌기둥: 호수에서 솟은 둥근 돌 위로 폴짝폴짝
  for (const [a, b] of runs(samples, 'stone')) {
    const sm = samples[(a + b) >> 1], r = Math.max((b - a) * 0.125 + 0.3, sm.w + 0.12), h = sm.y - LAKE_Y;
    const x = sm.x + sm.nx * sm.so, z = sm.z + sm.nz * sm.so;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.3, h, 11), toon(0xa59f95)); col.position.set(x, LAKE_Y + h / 2 - 0.03, z); add(col);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r, 0.1, 11), toon(0xc9c3b8)); top.position.set(x, sm.y - 0.06, z); add(top);
    const moss = new THREE.Mesh(new THREE.TorusGeometry(r * 0.98, 0.06, 6, 22), toon(0x7cc46a)); moss.rotation.x = Math.PI / 2; moss.position.set(x, sm.y - 0.08, z); add(moss);
  }
  // 아치 다리 기둥 (아래로 다른 물길이 지나가는 곳은 비움: 나선 슬라이드)
  const pillarGeo = new THREE.CylinderGeometry(0.55, 0.75, 1, 10);
  for (let i = 10; i < N - 10; i += 28) {
    const s = samples[i];
    if (s.gap || s.ramp || s.stone || s.rail) continue;
    if (samples.some(q => q.y < s.y - 1.5 && (q.x - s.x) ** 2 + (q.z - s.z) ** 2 < (s.w + q.w + 1) ** 2)) continue;
    const h = s.y - BASE_D - LAKE_Y;
    const p = new THREE.Mesh(pillarGeo, toon(0xcdbda3));
    p.scale.y = h; p.position.set(s.x, LAKE_Y + h / 2, s.z);
    p.castShadow = true; add(p);
  }

  // 도착지: 연못 + 잔디 섬 + 오리 가족
  const sE = samples[N - 1];
  const EY = sE.y;  // 도착지 높이 (폭포만큼 내려가 있음)
  const PR = 4.8;
  const pondC = { x: sE.x + sE.tx * PR, y: EY, z: sE.z + sE.tz * PR };
  const islandH = EY - LAKE_Y;
  const island = new THREE.Mesh(new THREE.CylinderGeometry(PR + 3.2, PR + 4.2, islandH, 28), toon(0x9ee08a));
  island.position.set(pondC.x, LAKE_Y + islandH / 2 - 0.03, pondC.z); add(island);
  const cliff = new THREE.Mesh(new THREE.CylinderGeometry(PR + 3.25, PR + 4.25, islandH - 0.6, 28, 1, true), toon(0xd9b98c));
  cliff.position.set(pondC.x, LAKE_Y + (islandH - 0.6) / 2 - 0.03, pondC.z); add(cliff);
  const pond = new THREE.Mesh(new THREE.CircleGeometry(PR, 64), makePondMat(theme));   // 💧 반짝이며 일렁이는 연못 물 (셰이더)
  pond.rotation.x = -Math.PI / 2; pond.position.set(pondC.x, EY, pondC.z); add(pond);
  // 물가 하얀 물결 테 + 연잎·꽃 + 부들 (연못이 더 살아 있게)
  const inA0 = Math.atan2(sE.z - pondC.z, sE.x - pondC.x), mouth = 2 * Math.asin(Math.min(0.9, (sE.w + 0.5) / PR));   // 물길이 들어오는 곳은 하얀 물가 테를 비움
  const shore = new THREE.Mesh(new THREE.RingGeometry(PR - 0.32, PR + 0.02, 64, 1, -inA0 + mouth / 2, Math.PI * 2 - mouth), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
  {   // 🌊 물길 끝 → 연못: 물길 물빛이 연못 물빛으로 길고 부드럽게 바뀜. 입구는 부채꼴로 퍼지며 연못 안쪽까지 스며들 듯 옅어짐 (옆 가장자리도 흐릿하게)
    const K = Math.min(28, N - 2), E = 16, a0 = N - 1 - K, tint = new THREE.Color(THEME_WATER[theme] || 0xffffff);
    const cA = new THREE.Color(0.74, 0.93, 1.0).multiply(deepWater ? waterMatDeep.color : new THREE.Color(1, 1, 1)), cB = new THREE.Color(0.62, 0.89, 0.99), cC = new THREE.Color(0.36, 0.70, 0.94);   // 물길 → 연못 가장자리 → 연못 안쪽
    const rows = [];
    for (let j = 0; j <= K; j++) { const q = samples[a0 + j], u = j / K; rows.push({ x: q.x, y: q.y, z: q.z, nx: q.nx, nz: q.nz, w: q.w * (1 + 0.3 * smooth01((u - 0.5) / 0.5)), a: smooth01(u), side: 0, c: cA.clone().lerp(cB, smooth01(u)) }); }
    for (let k = 1; k <= E; k++) { const u = k / E; rows.push({ x: sE.x + sE.tx * 0.25 * k, y: EY, z: sE.z + sE.tz * 0.25 * k, nx: sE.nx, nz: sE.nz, w: sE.w * (1.3 + 0.6 * u), a: 1 - smooth01(u), side: smooth01(u), c: cB.clone().lerp(cC, u) }); }
    const C = 9, pos = [], fade = [], col = [], idx = [];
    rows.forEach((r, j) => {
      for (let c = 0; c < C; c++) {
        const u = c / (C - 1) * 2 - 1, edge = 1 - smooth01((Math.abs(u) - 0.3) / 0.7);
        pos.push(r.x + r.nx * u * r.w, r.y + 0.035, r.z + r.nz * u * r.w);
        fade.push(r.a * (1 - r.side + r.side * edge)); col.push(r.c.r * tint.r, r.c.g * tint.g, r.c.b * tint.b);
        if (j < rows.length - 1 && c < C - 1) { const q = j * C + c; idx.push(q, q + C, q + 1, q + 1, q + C, q + C + 1); }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('fade', new THREE.Float32BufferAttribute(fade, 1)); geo.setAttribute('mcol', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      vertexShader: 'attribute float fade; attribute vec3 mcol; varying float vF; varying vec3 vC; void main(){ vF = fade; vC = mcol; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying float vF; varying vec3 vC; void main(){ gl_FragColor = vec4(vC, vF); }',
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 2; group.add(mesh);
  }
  shore.rotation.x = -Math.PI / 2; shore.position.set(pondC.x, EY + 0.012, pondC.z); group.add(shore);
  const prng = mulberry(def.no * 3 + 11);
  const shopCtx0p = RACE ? null : { c: pondC, PR, EY, momA: Math.atan2(sE.z - pondC.z, sE.x - pondC.x) + Math.PI, home: levelNo === LEVELS.length || null };
  const inA = Math.atan2(sE.z - pondC.z, sE.x - pondC.x);
  if (levelNo !== LEVELS.length) {
    for (let i = 0; i < 7; i++) {   // 연잎 (몇 개엔 분홍·흰 꽃)
      const a = inA + Math.PI * 0.35 + prng() * Math.PI * 1.3, r = 2.9 + prng() * 1.3;
      const lx = pondC.x + Math.cos(a) * r, lz = pondC.z + Math.sin(a) * r, sz = 0.3 + prng() * 0.22;
      if (shopCtx0p && shopBlocked(lx, lz, shopCtx0p)) continue;   // 🛍️ 백조·분수·선착장 자리엔 연잎 없음
      const pad = new THREE.Mesh(new THREE.CircleGeometry(sz, 16, 0.3, Math.PI * 2 - 0.55), toon(prng() < 0.5 ? 0x6fc46a : 0x5cb85c, { side: THREE.DoubleSide }));
      pad.rotation.x = -Math.PI / 2; pad.rotation.z = prng() * 6; pad.position.set(lx, EY + 0.025, lz); group.add(pad);
      if (i % 3 === 0) {
        const fc = i % 2 ? 0xffffff : 0xff9fb6;
        for (let k = 0; k < 5; k++) { const pet = new THREE.Mesh(sphLow, toon(fc)); const pa = k / 5 * Math.PI * 2; pet.scale.set(0.07, 0.04, 0.035); pet.position.set(lx + Math.cos(pa) * 0.06, EY + 0.09, lz + Math.sin(pa) * 0.06); pet.rotation.y = -pa; group.add(pet); }
        const core = new THREE.Mesh(sphLow, toon(0xffd84d)); core.scale.setScalar(0.04); core.position.set(lx, EY + 0.11, lz); group.add(core);
      }
    }
    for (let i = 0; i < 3; i++) {   // 부들 무리 (들어오는 물길과 가족 쪽은 피해서)
      const a = inA + Math.PI * [0.42, -0.42, 0.68][i] + (prng() - 0.5) * 0.2;   // 엄마 오리 쪽(반대편)은 비움
      add(makeReeds(pondC.x + Math.cos(a) * (PR + 0.25), EY, pondC.z + Math.sin(a) * (PR + 0.25), i + def.no));
    }
  }
  world0Shore = shore;
  let steam = null;
  if (biome.id === 'snow' && !RACE) {   // ♨️ 겨울(51~60): 도착 연못에서 따뜻한 김이 모락모락
    steam = [];
    for (let k = 0; k < 24; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (PR - 0.8);
      sp.userData = { x: pondC.x + Math.cos(a) * r, z: pondC.z + Math.sin(a) * r, ph: k / 24, sp: 0.16 + Math.random() * 0.08, dx: (Math.random() - 0.5) * 0.6 };
      group.add(sp); steam.push(sp);
    }
  }
  // 연못 테두리 돌
  for (let i = 0; i < 22; i++) {
    const a = i / 22 * Math.PI * 2;
    const ix = pondC.x + Math.cos(a) * PR, iz = pondC.z + Math.sin(a) * PR;
    if ((ix - sE.x) ** 2 + (iz - sE.z) ** 2 < (sE.w + 0.9) ** 2) continue; // 물길 입구는 비움
    const r = new THREE.Mesh(sphLow, toon([0x86817a, 0x938d85, 0x7a756e][i % 3]));   // 회색 돌 (조금씩 다른 톤, 낮에도 너무 하얗지 않게 진하게)
    r.scale.set(0.45 + Math.random() * 0.2, 0.25, 0.45 + Math.random() * 0.2);
    r.position.set(ix, EY + 0.05, iz); r.castShadow = true; add(r);
    const sh = new THREE.Mesh(blobGeo, blobMat);   // 돌 밑 그림자 (바깥쪽으로 살짝 번짐)
    sh.rotation.x = -Math.PI / 2; sh.scale.set(r.scale.x * 3, r.scale.z * 3, 1);
    sh.position.set(ix + Math.cos(a) * 0.12, EY + 0.015, iz + Math.sin(a) * 0.12); sh.renderOrder = 1; group.add(sh);
  }
  // 꽃 & 나무
  const rng = mulberry(def.no + 7);
  const shopCtx0 = RACE ? null : { c: pondC, PR, EY, momA: Math.atan2(sE.z - pondC.z, sE.x - pondC.x) + Math.PI, home: levelNo === LEVELS.length || null };
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2, rr = PR + 0.9 + rng() * 2.2;
    const fx = pondC.x + Math.cos(a) * rr, fz = pondC.z + Math.sin(a) * rr;
    if (shopCtx0 && shopBlocked(fx, fz, shopCtx0)) continue;   // 🛍️ 산 물건 자리엔 나무·꽃 없음
    if (samples.some(sm => sm.island && (sm.x - fx) ** 2 + (sm.z - fz) ** 2 < (sm.w + 1.2) ** 2)) continue;
    if (i < 4) { add(makeTree(fx, EY, fz, 0.8 + rng() * 0.4)); continue; }
    const f = new THREE.Mesh(sphLow, toon([0xff9fb6, 0xffffff, 0xffd84d, 0xc7a8ff][i % 4]));
    f.scale.setScalar(0.14); f.position.set(fx, EY + 0.12, fz); add(f);
  }
  // 풍경 장식: 바이옴마다 다름 (물길 아래·근처에는 안 놓음)
  decorateBiome(biome.id, group, samples, rng, add);

  // 오리 가족: 엄마 + 아기 4마리. 들어오는 물길 반대편에 반원으로
  // 마지막 레벨은 가족 대신, 다 자란 오리가 혼자 살아갈 새 보금자리(오리 집·부들·연잎)
  const family = [];
  const inAng = Math.atan2(sE.z - pondC.z, sE.x - pondC.x);
  const momA = inAng + Math.PI;
  const finalLevel = levelNo === LEVELS.length;
  let homeAt = null, homeCtx = null;
  if (finalLevel) {
    const HOME_R = PR + 1.25;  // 집 가운데 (1.4배 크기, 앞면이 연못가에 닿음)
    const hx = pondC.x + Math.cos(momA) * HOME_R, hz = pondC.z + Math.sin(momA) * HOME_R;
    const home = makeHome(); home.scale.setScalar(1.4); home.position.set(hx, EY, hz);
    home.rotation.y = Math.atan2(pondC.x - hx, pondC.z - hz);   // 문이 연못을 바라봄
    group.add(home); homeAt = { x: hx, z: hz }; homeCtx = { c: pondC, PR, EY, momA, home };
    {   // 🏡 마지막 레벨에 도착하면 언제나: 동화 같은 특별 보금자리 (예전엔 별 120개 꾸미기 보상)
      decorateDreamHome(group, home, pondC, PR, EY, momA, add);
    }
    for (let i = 0; i < 9; i++) {                                // 부들(갈대) 무리
      const a = momA + (i - 4) * 0.42 + (i % 2) * 0.1;
      if (Math.abs(i - 4) <= 1) continue;                        // 집 문 앞은 비워 둠
      if (Math.abs(Math.atan2(Math.sin(a - inAng), Math.cos(a - inAng))) < 0.9) continue;
      add(makeReeds(pondC.x + Math.cos(a) * (PR + 0.35), EY, pondC.z + Math.sin(a) * (PR + 0.35), i));
    }
    for (let i = 0; i < 6; i++) {                                // 연잎 + 분홍 꽃
      const a = i * 1.05 + 0.4, r = 1.6 + (i % 3) * 0.9;
      const lx = pondC.x + Math.cos(a) * r, lz = pondC.z + Math.sin(a) * r;
      const pad = new THREE.Mesh(new THREE.CircleGeometry(0.42, 14, 0.3, Math.PI * 2 - 0.6), toon(0x6fc46a, { side: THREE.DoubleSide }));
      pad.rotation.x = -Math.PI / 2; pad.rotation.z = a; pad.position.set(lx, EY + 0.03, lz); group.add(pad);
      if (i % 2 === 0) { const fl = new THREE.Mesh(sphLow, toon(0xff9fb6)); fl.scale.set(0.13, 0.09, 0.13); fl.position.set(lx, EY + 0.1, lz); group.add(fl); }
    }
  }
  if (!finalLevel) {
  const mom = makeDuck({ scale: 1.7, bow: true, body: 0xfff3c4, wing: 0xf5dc8c });
  mom.position.set(pondC.x + Math.cos(momA) * 2.2, EY, pondC.z + Math.sin(momA) * 2.2);
  group.add(mom); family.push({ duck: mom, phase: 0, baseY: EY, mom: true });
  for (let i = 0; i < 4; i++) {
    const a = momA + (i - 1.5) * 0.55;
    const r = i % 2 ? 3.3 : 2.9;
    const d = makeDuck({ scale: 0.62 });
    d.position.set(pondC.x + Math.cos(a) * r, EY, pondC.z + Math.sin(a) * r);
    group.add(d); family.push({ duck: d, phase: i * 0.9 + 0.5, baseY: EY });
  }
  }
  for (const f of family) { // 연못 중앙을 바라보게
    const dx = pondC.x - f.duck.position.x, dz = pondC.z - f.duck.position.z;
    f.duck.rotation.y = Math.atan2(-dx, -dz);
  }
  if (!finalLevel && !RACE) homeCtx = { c: pondC, PR, EY, momA, home: null };   // 🛍️ 가족 연못에도 상점 물건 (집 꾸미기는 빼고)
  const arrive = finalLevel
    ? { x: pondC.x, z: pondC.z }   // 마지막: 호수(연못) 한가운데
    : { x: pondC.x + Math.cos(momA) * 0.4, z: pondC.z + Math.sin(momA) * 0.4 };

  // 타임어택 제한 시간: 코스 길이 ÷ 유속 × 배수 + 2초
  const n = def.no;
  const total = samples[N - 1].d;
  // 레벨 1~20: 1.25 → 0.95, 레벨 21~40: 0.95 → 0.9
  // 레벨 1~5: 0.95 → 0.75 (그냥 떠내려가면 아슬아슬), 6~60: 0.80 → 0.90 (앞으로 기울여 속도를 내야 함)
  // 뒤쪽 레벨일수록 코너가 많아 빨리 가기 어려워서 배수를 조금씩 올림
  const factor = n <= 5 ? 0.95 - 0.05 * (n - 1) : 0.8 + 0.1 * Math.min(1, (n - 6) / 54);
  let limit = Math.ceil(total / (def.baseFlow || def.flow) * factor + 2);

  // 5의 배수 레벨: 코스 중간에 기다리는 아기 오리들 (닿으면 줄줄이 따라옴)
  const babies = [];
  if ((levelNo % 5 === 0 && levelNo !== LEVELS.length) || RACE) {   // 마지막 레벨은 혼자 떠나는 길이라 아기 오리 없음
    const count = RACE ? 2 + RACE : Math.min(10, levelNo / 5 + 2);   // 5:3, 10:4, ... 40~60: 10 / 레이스: 3~8
    for (let j = 0; j < count; j++) {
      let i = Math.round(30 + (N - 60) * (j + 0.5) / count);
      while (samples[i].fall || samples[i].gap || samples[i].ramp || samples[i].fork || samples[i].stone || samples[i].rail || (i > 0 && samples[i - 1].fall)) i += 6;
      const sb = samples[i];
      const off = (rng() - 0.5) * 0.9 * sb.w;   // 가운데에서 살짝 비껴서
      const d = makeDuck({ scale: 0.55 });
      d.position.set(sb.x + sb.nx * off, sb.y + (sb.bank || 0) * off, sb.z + sb.nz * off);
      d.rotation.y = Math.atan2(sb.tx, sb.tz);   // 다가오는 오리를 바라봄
      group.add(d);
      const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }));
      mark.scale.setScalar(0.45); mark.position.set(0, 1.9, 0); d.add(mark);
      babies.push({ duck: d, mark, state: 'wait', phase: j * 1.3, x: d.position.x, y: d.position.y, z: d.position.z, yaw: d.rotation.y, idx: i });
    }
  }

  // 방패 아이템: 레벨 3부터 조금씩 (3~14: 1개, 15~26: 2개, 27~38: 3개, 39~60: 4개)
  // 난간 없는 위험 구간 바로 앞에 놓임
  const items = [];
  const nItems = levelNo < 3 || RACE ? 0 : Math.min(4, 1 + Math.floor((levelNo - 3) / 12));   // 3:1, 15:2, 27:3, 39~60: 4
  if (nItems) {
    // 방패가 쓸모 있는 곳에만: 먹은 뒤 방패가 유지되는 동안(5초) 지나갈 거리 안에
    // 난간 없는 곳이 충분히(3칸 이상) 있어야 함. 그런 곳이 없으면 방패 수를 줄임 (빈 곳에 억지로 안 놓음)
    const openAt = sm => (!sm.wl || !sm.wr) && !sm.island && !sm.gap && !sm.ramp;
    const LEAD = 14;                                                       // 위험 구간 약 3.5 앞에 놓음
    const cover = Math.round(SHIELD_TIME * def.flow * 1.15 / 0.25);        // 방패 유지 동안 가는 샘플 수
    const cands = [];
    for (let i = 20 + LEAD; i < N - 20; i++) {
      if (!openAt(samples[i]) || openAt(samples[i - 1])) continue;         // 난간 없는 구간이 시작되는 곳
      let open = 0;
      for (let k = i; k < Math.min(N - 1, i - LEAD + cover); k++) if (openAt(samples[k])) open++;
      if (open >= 12) cands.push({ i, open });
    }
    cands.sort((a, b) => b.open - a.open);                                 // 위험한 곳부터, 서로 겹치지 않게
    const picks = [];
    for (const c of cands) {
      if (picks.length >= nItems) break;
      if (picks.every(p => Math.abs(p - (c.i - LEAD)) > cover)) picks.push(c.i - LEAD);
    }
    picks.sort((a, b) => a - b);
    for (let i of picks) {
      i = clamp(i, 10, N - 10);
      while ((samples[i].fall || samples[i].gap || samples[i].ramp || samples[i].fork || samples[i].stone || samples[i].rail) && i < N - 10) i++;
      const si = samples[i];
      const m = new THREE.Group();
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), toon(0x6fd3ff));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      ring.rotation.x = Math.PI / 2;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true, depthWrite: false, opacity: 0.6 }));
      halo.scale.setScalar(1.3);
      m.add(gem, ring, halo);
      m.position.set(si.x, si.y + 0.6, si.z);
      group.add(m);
      items.push({ mesh: m, gem, ring, x: si.x, y: si.y, z: si.z, taken: false, idx: i });
    }
  }
  // 방패 벽: 물길 양쪽 전체에 투명한 하늘색 벽 (아이템 먹으면 보임)
  const shieldWalls = [];
  for (const [a, b] of solid) for (const sg of [1, -1]) {
    const m = ribbon(samples, a, b, s => sg * s.w, -0.05, s => sg * s.w, 0.95, shieldMat);
    m.visible = false; group.add(m); shieldWalls.push(m);
  }

  // 🔀 갈림길(레벨 16~): 가운데 잔디 섬. 한쪽은 ⚡빠른 물살(바깥 난간 없음), 반대쪽은 느리지만 안전
  for (const [a, b] of runs(samples.map(s => ({ x: s.ih > 0.01 })), 'x')) {
    const fs = samples[Math.floor((a + b) / 2)].fside;
    add(ribbon(samples, a, b, s => s.ic + s.ih, 0.32, s => s.ic - s.ih, 0.32, toon(0x8fd67a, { side: THREE.DoubleSide })));
    add(ribbon(samples, a, b, s => s.ic + s.ih, -0.05, s => s.ic + s.ih, 0.32, stoneMat()));
    add(ribbon(samples, a, b, s => s.ic - s.ih, -0.05, s => s.ic - s.ih, 0.32, stoneMat()));
    // ⚡ 화살표는 섬 중간(빠른 쪽이 좁아지는 곳)부터 → 입구에서는 어느 쪽이 빠른지 모름
    for (const [fa, fb] of runs(samples.map((q, k) => ({ x: k >= a && k <= b && q.fast })), 'x'))
      group.add(ribbon(samples, fa, fb, q => q.ic + fs * (q.ih + 0.1), 0.045, q => fs * (q.w - 0.1), 0.045, boostMatSparse, 3.9));   // 화살표는 1/3 만 (듬성듬성)
    for (let i = a + 8, j = 0; i < b - 8; i += 7, j++) {   // 섬 위 덤불·꽃
      const sm = samples[i];
      if (sm.ih < 0.45) continue;
      if (j % 3 === 1) {
        const bush = new THREE.Mesh(sphLow, toon(0x5fbf5a)); bush.scale.set(0.42, 0.32, 0.42);
        bush.position.set(sm.x + sm.nx * sm.ic, sm.y + 0.4, sm.z + sm.nz * sm.ic); bush.castShadow = true; group.add(bush);
      } else for (const sg of [1, -1]) {
        const o = sm.ic + sg * sm.ih * 0.45, fl = new THREE.Mesh(sphLow, toon([0xff9fb6, 0xffffff, 0xffd84d][(j + (sg > 0 ? 1 : 0)) % 3]));
        fl.scale.setScalar(0.1); fl.position.set(sm.x + sm.nx * o, sm.y + 0.42, sm.z + sm.nz * o); group.add(fl);
      }
    }
    const sn = samples[Math.min(b, a + 13)];   // 섬 앞쪽 표지판: 빠른 길 방향으로 기울어진 ⚡
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.1, 6), toon(0x9b6a3c));
    post.position.set(sn.x, sn.y + 0.85, sn.z); post.castShadow = true; group.add(post);
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: forkSignTex, transparent: true, depthWrite: false }));
    sign.scale.setScalar(0.75); sign.position.set(sn.x, sn.y + 1.55, sn.z); group.add(sign);
  }

  // ---------- 장애물 ----------
  // 통나무(레벨 7~), 소용돌이(13~), 꽃게(30~). 레벨이 오를수록 개수 증가.
  // 아이템·아기 오리·폭포 근처와 코너는 피해서 직선 구간에 놓음
  const busy = [];
  items.forEach(it => busy.push(it.idx)); babies.forEach(b => busy.push(b.idx));
  samples.forEach((sm, i) => { if (sm.fall || sm.ramp || sm.gap || sm.fork || sm.lift || sm.land || sm.slide || sm.stone || sm.race || sm.pool || sm.loopZone || sm.rail) busy.push(i); });
  for (const [, b] of runs(samples, 'rail')) for (let k = b + 1; k <= b + 48 && k < N; k++) busy.push(k);   // 🚃 기차에서 내려 착지하는 곳 앞엔 장애물 없음
  const CLIFF_RUN = 100;   // ⛰️ 절벽 앞 도움닫기 구간(약 25칸)엔 장애물 없음 → 마음껏 가속
  for (const [a] of runs(samples.map(q => ({ x: q.gap && q.cliff })), 'x')) for (let k = Math.max(0, a - CLIFF_RUN); k < a; k++) busy.push(k);
  const straightAt = i => { const a = samples[Math.max(0, i - 10)], b = samples[Math.min(N - 1, i + 10)]; return a.tx * b.tx + a.tz * b.tz > 0.97; };
  // i 주변(±10)에 난간이 있는지: side = 1(왼쪽), -1(오른쪽), 0(양쪽)
  const walledAt = (i, side = 0) => {
    for (let k = i - 10; k <= i + 10; k++) {
      const sm = samples[clamp(k, 0, N - 1)];
      if ((side >= 0 && !sm.wl) || (side <= 0 && !sm.wr)) return false;
    }
    return true;
  };
  function pickSpots(count, gap, okAt, straight = straightAt) {
    const out = [];
    for (let j = 0; j < count; j++) {
      const base = Math.round(40 + (N - 100) * (j + 0.5) / count);
      for (let k = 0; k < 160; k++) {
        const i = clamp(base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 3, 40, N - 60);
        if (busy.every(b => Math.abs(b - i) >= gap) && straight(i) && okAt(i)) { out.push(i); busy.push(i); break; }
      }
    }
    return out;
  }
  const nLogs = RACE ? 1 + Math.floor(RACE / 2) : levelNo < 7 ? 0 : Math.min(6, 1 + Math.floor((levelNo - 7) / 6));       // 통나무 묶음 수: 7:1, 13:2 ... 37~: 6
  const nWhirls = RACE ? RACE : levelNo < 13 ? 0 : Math.min(5, 1 + Math.floor((levelNo - 13) / 8));   // 13:1, 21:2 ... 45~: 5
  const nCrabs = levelNo < 30 || RACE ? 0 : Math.min(5, 1 + Math.floor((levelNo - 30) / 6));    // 30:1, 36:2 ... 54~: 5
  const logs = [], whirls = [], crabs = [];
  // 통나무: 2~3개를 번갈아 좌우에 놓아 지그재그로 피해 가게. 양쪽 난간이 있는 직선에만 (피하다 바로 추락하지 않게)
  const LOG_GAP = levelNo < 30 ? 15 : 13;                  // 통나무 사이 간격 (샘플 수, 0.25 씩 → 약 3.3~3.8)
  // 통나무가 막는 쪽 = side, 지나가는 쪽(-side)에는 난간이 있어야 함 (피하다 바로 추락하지 않게)
  const nearCliff = k => { for (let j = k - 8; j <= k + CLIFF_RUN + 16; j++) { const q = samples[j]; if (q && (q.pool || q.loopZone || (q.gap && q.cliff))) return true; } return false; };   // 루프 구간도   // 절벽·웅덩이 근처엔 통나무 없음
  const logOk = (k, side) => { const sm = samples[k]; return sm && !sm.fall && !sm.ramp && !sm.gap && !sm.fork && !nearCliff(k) && walledAt(k, -side); };
  const logPlan = new Map();                               // 자리 → [통나무 수, 첫 통나무 쪽]
  const logRun = i => {
    const tries = RACE ? [1] : levelNo < 25 ? [2] : rng() < 0.6 ? [3, 2] : [2, 3];   // 레벨 25부터 3개 묶음도 (안 되면 2개) / 레이스는 하나씩
    for (const cnt of tries) {
      if (i + LOG_GAP * (cnt - 1) >= N - 40) continue;
      const a = samples[i], b = samples[i + LOG_GAP * (cnt - 1)];
      if (a.tx * b.tx + a.tz * b.tz < 0.6) continue;      // 너무 급하게 꺾이는 곳은 피함
      for (const first of rng() < 0.5 ? [1, -1] : [-1, 1]) {
        let ok = true;
        for (let j = 0, sd = first; j < cnt && ok; j++, sd = -sd) ok = logOk(i + j * LOG_GAP, sd);
        if (ok) { logPlan.set(i, [cnt, first]); return true; }
      }
    }
    return false;
  };
  let logCount = 0;
  for (const i of pickSpots(nLogs, 20, logRun, () => true)) {
    let [cnt, side] = logPlan.get(i);
    for (let j = 0; j < cnt; j++, side = -side) {
      const li = i + j * LOG_GAP, sm = samples[li];
      if (j) busy.push(li);
      const a = side * sm.w, full = side * sm.w * 0.08, b = a + (full - a) * (j === 1 || RACE ? 0.7 : 0.8) * 0.8;   // 첫 통나무는 80%, 연속 통나무의 두 번째·레이스 통나무는 70% 길이 → 모두 다시 80%로 줄임 (64% / 56%)
      const lr = RACE ? 0.21 : 0.3;   // 통나무 굵기 (레이스는 70%)
      const L = Math.abs(a - b), mid = (a + b) / 2;
      const g = new THREE.Group();
      const bk = sm.bank || 0;   // 🛣️ 기울어진 물 위에서도 물에 떠 있게: 높이 + 기울기를 물 표면에 맞춤
      g.position.set(sm.x + sm.nx * mid, sm.y + bk * mid + 0.12, sm.z + sm.nz * mid);
      g.rotation.order = 'YXZ'; g.rotation.set(0, Math.atan2(-sm.tx, -sm.tz), Math.atan(-bk));   // 로컬 x = 오른쪽(-n)
      const log = addOutlined(g, new THREE.CylinderGeometry(1, 1, 1, 14), toon(0x9b6a3c), V(0, 0, 0), V(lr, L, lr));
      log.rotation.z = Math.PI / 2;
      for (const e of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.CircleGeometry(lr * 0.9, 14), toon(0xe8c38e, { side: THREE.DoubleSide }));
        cap.position.x = e * (L / 2 + 0.002); cap.rotation.y = Math.PI / 2; g.add(cap);
      }
      const leaf = new THREE.Mesh(sphLow, toon(0x7fd17a)); leaf.scale.set(0.18, 0.05, 0.11); leaf.position.set(L * 0.2, 0.3, 0); g.add(leaf);
      group.add(g);
      logs.push({ g, ax: sm.x + sm.nx * a, az: sm.z + sm.nz * a, bx: sm.x + sm.nx * b, bz: sm.z + sm.nz * b, y: sm.y, idx: li, side, phase: rng() * 6, lo: Math.min(a, b), hi: Math.max(a, b), r: lr });
      logCount++;
    }
  }
  for (const i of pickSpots(nWhirls, 24, i => walledAt(i))) {   // 소용돌이: 양쪽 난간 있는 직선에만 (시간 손해용)
    // 한쪽으로 치우치게 놓아서 반대쪽으로 비켜 갈 수 있게 (가운데를 다 막지 않음)
    const sm = samples[i], R = Math.min(1.05, sm.w * 0.6), off = (rng() < 0.5 ? 1 : -1) * (sm.w - R - 0.05);
    const x = sm.x + sm.nx * off, z = sm.z + sm.nz * off, wy = sm.y + (sm.bank || 0) * off;
    const m = new THREE.Mesh(new THREE.CircleGeometry(R, 32), whirlMat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, wy + 0.045 + Math.abs(sm.bank || 0) * R, z); group.add(m);
    whirls.push({ m, x, z, y: wy, R, idx: i, lat: off, inside: false });
  }
  for (const i of pickSpots(nCrabs, 20, () => true)) {      // 꽃게: 물길을 가로질러 왔다 갔다
    const sm = samples[i], c = makeCrab();
    c.rotation.y = Math.atan2(sm.tx, sm.tz);               // 다가오는 오리를 바라봄
    group.add(c);
    crabs.push({ g: c, s: sm, amp: sm.w - 0.5, speed: 1.6 + rng() * 0.8, phase: rng() * 6, x: sm.x, y: sm.y, z: sm.z, lat: 0, idx: i, hitT: -9 });
  }
  // ⛲ 분수(레벨 25~): 물길 한쪽에서 가끔 물기둥이 솟음. 솟는 중에 지나가면 약 2초 동안 물기둥 위에 떠 있음
  const nFount = levelNo < 25 || RACE ? 0 : Math.min(4, 1 + Math.floor((levelNo - 25) / 8));   // 25:1, 33:2, 41:3, 49~: 4
  const fountains = [];
  for (const i of pickSpots(nFount, 22, () => true)) {
    const sm = samples[i], off = (rng() < 0.5 ? 1 : -1) * sm.w * (0.15 + rng() * 0.35);
    const x = sm.x + sm.nx * off, z = sm.z + sm.nz * off, g = new THREE.Group(), fy = sm.y + (sm.bank || 0) * off;   // 기울어진 코너면 그 자리 물 높이에
    g.position.set(x, fy, z); group.add(g);
    const FR = 0.6;   // 분수 크기 (구멍 반지름)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(FR, 0.11, 8, 24), toon(0xbfc8d2)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; g.add(ring);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(FR - 0.07, 24), new THREE.MeshBasicMaterial({ color: 0x2a6fb0 })); hole.rotation.x = -Math.PI / 2; hole.position.y = 0.06; g.add(hole);
    const boil = [];   // 구멍 안에서 끓듯이 부풀었다 톡 터지는 거품
    for (let k = 0; k < 10; k++) {
      const b = new THREE.Mesh(sphLow, fountainBoilMat); b.position.y = 0.07; g.add(b);
      boil.push({ m: b, ph: rng(), sp: 0.8 + rng() * 0.8, r: 0 });
    }
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, FR - 0.02, 1, 20, 1, true), fountainMat); col.position.y = 0.5; col.scale.y = 0.001; col.visible = false; g.add(col);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1, 12, 1, true), fountainCoreMat); core.visible = false; g.add(core);
    const cap = new THREE.Group(); cap.visible = false; g.add(cap);   // 물기둥 꼭대기 물보라 (꿈틀꿈틀)
    for (let k = 0; k < 9; k++) { const b = new THREE.Mesh(sphLow, fountainTopMat); const a = k / 9 * Math.PI * 2, rr = k % 3 === 0 ? 0.12 : 0.42; b.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr); b.userData.base = 0.22 + (k % 3) * 0.05; cap.add(b); }
    fountains.push({ g, col, core, cap, ring, boil, R: FR, x, z, y: fy, idx: i, H: 2.8, h: 0, phase: 'idle', t: 1.5 + rng() * 3 });
  }
  // 물레방아(레벨 20~): 커다란 나무 바퀴가 물길을 가로질러 돌고, 날개가 물에 잠길 때 지나가면 튕겨 나감
  const nMills = levelNo < 20 || RACE ? 0 : Math.min(4, 1 + Math.floor((levelNo - 20) / 10));   // 20:1, 30:2, 40:3, 50~: 4
  const mills = [];
  // 날개는 오리를 앞뒤로만 밀어서 떨어뜨리지 않음 → 난간 없이 짧은 직선이면 어디든
  const shortStraight = i => { const a = samples[Math.max(0, i - 6)], b = samples[Math.min(N - 1, i + 6)]; return a.tx * b.tx + a.tz * b.tz > 0.95; };
  for (const i of pickSpots(nMills, 20, () => true, shortStraight)) {
    const sm = samples[i], R = 1.5, H = 1.45;
    const g = new THREE.Group();
    g.position.set(sm.x, sm.y, sm.z); g.rotation.y = Math.atan2(-sm.tx, -sm.tz);   // 로컬 -z = 앞, x = 오른쪽
    const span = sm.w * 2 + 0.1;
    for (const sx of [-1, 1]) {   // 양쪽 난간 위 기둥
      const post = addOutlined(g, new THREE.BoxGeometry(1, 1, 1), toon(0x9b6a3c), V(sx * (sm.w + WALL_T / 2 + 0.05), (H + 0.2) / 2, 0), V(0.22, H + 0.2, 0.22));
      post.castShadow = true;
    }
    const wheel = new THREE.Group(); wheel.position.y = H; g.add(wheel);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, span + 0.5, 12), toon(0x8a5a32));
    hub.rotation.z = Math.PI / 2; wheel.add(hub);
    // 물길 폭을 3등분: 가운데는 비우고(늘 지나갈 수 있음), 양쪽 날개는 서로 직각(90°)으로 엇갈려 돎
    for (const sd of [-1, 1]) for (let k = 0; k < 2; k++) {   // sd: 로컬 x(-1 왼쪽, +1 오른쪽) / 한쪽에 날개 2개 (마주 보게)
      const arm = new THREE.Group(); arm.rotation.x = k * Math.PI + (sd > 0 ? Math.PI / 2 : 0); wheel.add(arm);
      const blade = addOutlined(arm, new THREE.BoxGeometry(1, 1, 1), toon(0xc98f5a), V(sd * span / 3, -R * 0.55, 0), V(span / 3 - 0.04, R * 0.9, 0.12));
      blade.castShadow = true;
      for (const x of [sd * (span / 2 + 0.12), sd * (span / 6 - 0.02)]) {   // 날개 양 끝 살
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.08, R, 0.08), toon(0x8a5a32));
        spoke.position.set(x, -R / 2, 0); arm.add(spoke);
      }
    }
    group.add(g);
    mills.push({ g, wheel, s: sm, x: sm.x, y: sm.y, z: sm.z, R, H, w: sm.w, omega: 1.0 + rng() * 0.3, phase: rng() * 6, theta: 0, idx: i, hitT: -9 });
  }
  // 🔀 갈림길의 안전한(느린) 길에는 장애물을 더: 소용돌이 + 왔다 갔다 하는 꽃게
  let forkExtra = 0;
  for (const [a, b] of runs(samples.map(q => ({ x: q.fast })), 'x')) {
    const fs = samples[a].fside, sg = -fs;
    const laneW = q => q.w - q.ih - sg * q.ic, laneC = q => (q.ic + sg * q.ih + sg * q.w) / 2;
    const whirlAt = f => { // 소용돌이: 안전한 길 한쪽에 붙어서 (반대쪽으로 비켜 갈 수 있음)
      const i = a + Math.round((b - a) * f), sm = samples[i], R = Math.min(0.85, laneW(sm) * 0.3);
      const off = laneC(sm) + (rng() < 0.5 ? 1 : -1) * (laneW(sm) / 2 - R - 0.05);
      const x = sm.x + sm.nx * off, z = sm.z + sm.nz * off;
      const m = new THREE.Mesh(new THREE.CircleGeometry(R, 32), whirlMat);
      m.rotation.x = -Math.PI / 2; m.position.set(x, sm.y + 0.045, z); group.add(m);
      whirls.push({ m, x, z, y: sm.y, R, idx: i, lat: off, inside: false });
    };
    const crabAt = f => { // 꽃게: 안전한 길 안에서만 좌우로
      const i = a + Math.round((b - a) * f), sm = samples[i], c = makeCrab();
      c.rotation.y = Math.atan2(sm.tx, sm.tz); group.add(c);
      crabs.push({ g: c, s: sm, c: laneC(sm), amp: Math.max(0.2, laneW(sm) / 2 - 0.5), speed: 1.6 + rng() * 0.8, phase: rng() * 6, x: sm.x, y: sm.y, z: sm.z, lat: 0, idx: i, hitT: -9 });
    };
    const fv = samples[a].fv;
    if (fv === 'long') { whirlAt(0.15); crabAt(0.45); whirlAt(0.78); forkExtra += 4.5; }
    else if (fv === 'short') { crabAt(0.55); forkExtra += 1.5; }
    else if (fv === 'wide') { crabAt(0.3); crabAt(0.75); forkExtra += 3; }
    else { whirlAt(0.22); crabAt(0.72); forkExtra += 3; }
  }
  // ⚡ 가속 물살 패드(레벨 8~): 양쪽 난간 있는 직선에 화살표 물살. 지나가면 잠깐 쌩~
  const nBoost = RACE ? 3 + 2 * RACE : levelNo < 8 ? 0 : Math.min(4, 1 + Math.floor((levelNo - 8) / 12));   // 레이스: 가속 패드 5~15개   // 8:1, 20:2, 32:3, 44~: 4
  const boosts = [];
  for (const i of pickSpots(nBoost, 14, i => walledAt(i, 1) || walledAt(i, -1), shortStraight)) {   // 패드가 붙는 쪽에 난간이 있으면 됨
    const L = walledAt(i, 1), R = walledAt(i, -1), sd = L && R ? (rng() < 0.5 ? 1 : -1) : L ? 1 : -1;
    const sm = samples[i], hw = Math.min(0.62, sm.w * 0.42), off = sd * (sm.w - hw - 0.12);   // 길 왼쪽이나 오른쪽 가장자리(난간 쪽)에 붙어서
    group.add(ribbon(samples, i - 5, i + 5, () => off + hw, 0.045, () => off - hw, 0.045, boostMat, 1.3));
    boosts.push({ idx: i, off, hw, hitT: -9 });
  }
  // 🏁 라이벌 레이스: 출발·결승 아치 + 가장자리 가속 패드 3개 + 라이벌 오리 (레벨대마다 다른 라이벌)
  let race = null;
  {
    const rr = runs(samples, 'race')[0];
    if (rr) {
      const [a, b] = rr;
      for (const [f, sd] of [[0.28, 1], [0.52, -1], [0.76, 1]]) {   // 좌우 엇갈린 가속 패드: 잘 밟아야 이김
        const i = a + Math.round((b - a) * f), sm = samples[i], hw = Math.min(0.62, sm.w * 0.42), off = sd * (sm.w - hw - 0.12);
        group.add(ribbon(samples, i - 5, i + 5, () => off + hw, 0.045, () => off - hw, 0.045, boostMat, 1.3));
        boosts.push({ idx: i, off, hw, hitT: -9 });
      }
      for (const [i, fin] of [[a, false], [b, true]]) {   // 아치: 기둥 2개 + 체크무늬 현수막
        const sm = samples[i], arch = new THREE.Group();
        arch.position.set(sm.x, sm.y, sm.z); arch.rotation.y = Math.atan2(-sm.tx, -sm.tz);
        for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.3, 8), toon(0xffffff)); post.position.set(sx * (sm.w + 0.25), 1.15, 0); arch.add(post); }
        const banner = new THREE.Sprite(new THREE.SpriteMaterial({ map: fin ? finishTex : startTex, depthWrite: false }));   // 카메라를 향하는 현수막
        banner.scale.set(Math.min(3.2, sm.w * 2 + 0.6), 0.6, 1); banner.position.y = 2.3; arch.add(banner); group.add(arch);
        const line = ribbon(samples, i - 2, i + 2, s => s.w, 0.05, s => -s.w, 0.05, checkerMat, 1);   // 물 위 체크무늬 출발·결승선
        line.renderOrder = 3; group.add(line);
      }
      const kind = levelNo >= 45 ? 'champ' : levelNo >= 30 ? 'bolt' : 'kid';
      const rival = makeRival(kind); rival.scale.setScalar(growScale(levelNo));
      const s0 = samples[a - 4];
      rival.position.set(s0.x, s0.y, s0.z); rival.rotation.y = Math.atan2(-s0.tx, -s0.tz); group.add(rival);
      race = { a, b, kind, rival, st: 'wait', t: 0, d: s0.d, lane: 0.6 * s0.w, lat: 0.6 * s0.w, bumpT: -9, extra: { kid: 2.4, bolt: 3.0, champ: 3.4 }[kind], reward: { kid: 5, bolt: 7, champ: 10 }[kind] };
    }
  }
  // 🏁 레이스 스테이지 상대 오리들: 출발선에 나란히. 오리마다 속도가 달라 순위 다툼
  const racers = [];
  if (RACE) {
    const s0 = samples[START_I], kinds = ['kid', 'bolt', 'champ', 'kid', 'bolt', 'champ'];
    const bodies = [0xffb35c, 0x7cc8ff, 0xc6a4ff, 0x8ce99a, 0xff9fc0, 0xffe066], icons = ['🐥', '😎', '👑', '🍀', '🌸', '⭐'];
    // 출발선에 나란히: 오리 크기만큼 간격을 두고 한 줄에 최대한, 넘치면 뒷줄로. 나(가운데 칸)도 같은 줄
    const sc = growScale(levelNo), lineD = samples[START_I + 4].d, gapX = 1.1 * sc, span = s0.w * 1.7;
    const perRow = Math.max(2, Math.min(RACE + 1, Math.floor(span / gapX) + 1));
    const slots = [];
    for (let k = 0; k < RACE + 1; k++) {
      const row = Math.floor(k / perRow), inRow = Math.min(perRow, RACE + 1 - row * perRow), c = k % perRow;
      const w = Math.min(span, gapX * (inRow - 1));
      slots.push({ lat: inRow === 1 ? 0 : -w / 2 + w * c / (inRow - 1), d: lineD - 0.8 * sc - row * 1.3 * sc, row });
    }
    const me = slots.filter(q => q.row === 0).reduce((a, q) => Math.abs(q.lat) < Math.abs(a.lat) ? q : a);   // 나는 맨 앞줄 가운데
    raceStart = { lat: me.lat, d: me.d };
    const others = slots.filter(q => q !== me);
    for (let j = 0; j < RACE; j++) {
      const g = makeRival(kinds[j], bodies[j]); g.scale.setScalar(sc); group.add(g);
      const q = others[j], f = RACE === 1 ? 0.5 : j / (RACE - 1);
      racers.push({ g, icon: icons[j], lane: q.lat, lat: q.lat, d: q.d, idx: START_I,
        extra: 1.5 + f * (1.4 + 0.22 * RACE) + rng() * 0.2, ph: rng() * 6, done: false });
    }
  }
  const rings = [], raceObs = [];
  if (RACE) {
    {   // 🏁 출발선: 물길을 가로지르는 하얀 선 하나
      const line = ribbon(samples, START_I + 4, START_I + 6, s => s.w, 0.06, s => -s.w, 0.06, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 1);
      line.renderOrder = 6; group.add(line);
    }
    {   // 결승선: 체크무늬
      const i = N - 12, line = ribbon(samples, i - 2, i + 2, s => s.w, 0.05, s => -s.w, 0.05, checkerMat, 1); line.renderOrder = 3; group.add(line);
    }
    for (const [a, b] of runs(samples, 'gap')) {   // 💫 점프 중 통과하는 큰 링 (가운데쯤, 좌우로 조금 비켜서)
      const top = samples[a - 1], m = samples[(a + b) >> 1], lat = (rng() * 2 - 1) * Math.min(1.1, m.w - 1.6);
      const cx = m.x + m.nx * lat, cz = m.z + m.nz * lat, cy = top.y + 0.75;
      const g = new THREE.Group(); g.position.set(cx, cy, cz); g.rotation.y = Math.atan2(-m.tx, -m.tz);
      const tor = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.11, 10, 36), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
      const glow = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.2, 8, 36), new THREE.MeshBasicMaterial({ color: 0xfff3a0, transparent: true, opacity: 0.35, depthWrite: false }));
      g.add(tor); g.add(glow); group.add(g);
      rings.push({ g, x: cx, y: cy, z: cz, tx: m.tx, tz: m.tz, nx: m.nx, nz: m.nz, idx: (a + b) >> 1, taken: false });
    }
  }
  const waves = [];
  if (RACE) {
    const waveMat = toon(0x3fb4ea), foamMat = toon(0xffffff);   // 물보다 진한 파랑 + 하얀 거품 (잘 보이게)
    for (const i of pickSpots(2 + RACE, 26, () => true, shortStraight)) {
      const g = new THREE.Group(), sm = samples[i], side = rng() < 0.5 ? 1 : -1, hw = sm.w / 2;
      const roll = new THREE.Group(); g.add(roll);   // 앞뒤로 넘실대는 몸통
      const blobs = [];
      for (let k = 0; k < 4; k++) {   // 물마루 4덩이가 차례로 출렁 (가운데가 조금 높게)
        const x = -hw + (k + 0.5) * hw / 2, hk = 1 - Math.abs(k - 1.5) * 0.12;
        const body = new THREE.Mesh(sphMid, waveMat); body.scale.set(hw * 0.34, 0.36 * hk, 0.46); body.position.set(x, 0.08, 0); roll.add(body);
        const foam = new THREE.Mesh(sphMid, foamMat); foam.scale.set(hw * 0.3, 0.12, 0.24); foam.position.set(x, 0.36 * hk, -0.16); roll.add(foam);
        blobs.push({ body, foam, hk, ph: k * 1.25 });
      }
      const lip = new THREE.Mesh(new THREE.TorusGeometry(hw * 0.92, 0.07, 6, 24, Math.PI), foamMat);   // 앞쪽으로 말리는 하얀 물보라 테
      lip.rotation.x = Math.PI / 2 + 0.6; lip.scale.set(1, 0.35, 1); lip.position.set(0, 0.33, -0.3); roll.add(lip);
      g.visible = false; group.add(g);
      waves.push({ g, roll, blobs, lip, hw, idx: i, side, d0: sm.d + 9, d1: sm.d - 4, d: 0, t: rng() * 2, on: false, hitT: -9, big: false, ph: rng() * 6 });
    }
  }
  const gapArcs = runs(samples, 'gap').map(([a, b]) => ({ a, b, y0: samples[Math.max(0, a - 1)].y, y1: samples[Math.min(N - 1, b + 1)].y, d0: samples[Math.max(0, a - 1)].d, d1: samples[Math.min(N - 1, b + 1)].d }));
  // 🐸 개구리(레벨 4~): 난간 옆 연잎 위에 앉아 있다가 오리가 다가오면 호수로 폴짝 (보는 재미, 부딪히지 않음)
  const frogs = [];
  // 🪨 자갈밭 (레벨 10~): 물길 폭의 절반쯤을 덮는 얕은 자갈. 지나가면 조금 느려짐 → 반대쪽으로 비켜 가면 됨
  const gravels = [];
  const nGravel = RACE || levelNo < 10 ? 0 : Math.min(4, 1 + Math.floor((levelNo - 10) / 12));   // 10:1, 22:2, 34:3, 46~: 4
  const GR = 11;   // 가운데에서 앞뒤로 11칸 (길이 약 5.5)
  const grng = mulberry(levelNo * 31 + 5);   // 다른 배치(rng)를 바꾸지 않게 따로
  const gravelOk = i => {
    for (let k = i - GR - 6; k <= i + GR + 6; k++) { const q = samples[k]; if (!q || q.fall || q.ramp || q.gap || q.fork || q.lift || q.land || q.slide || q.stone || q.pool || q.loopZone || q.island || q.jet || q.rail) return false; }
    return !nearCliff(i) && [...logs, ...whirls, ...crabs, ...mills, ...fountains, ...boosts].every(o => Math.abs(o.idx - i) > GR + 10);
  };
  const pebbleGeo = new THREE.DodecahedronGeometry(1, 0);
  const pebCols = [0x9a9186, 0xb8ada0, 0x7d746b, 0xc9bfae, 0x8f8070, 0xa89c8e];
  for (const i of pickSpots(nGravel, GR + 14, gravelOk, k => { const a = samples[k - GR - 4], b = samples[k + GR + 4]; return !!a && !!b && a.tx * b.tx + a.tz * b.tz > 0.9; })) {   // 거의 곧은 길에만 (급한 커브 X)
    for (let k = i - GR; k <= i + GR; k++) busy.push(k);
    const side = grng() < 0.5 ? 1 : -1, i0 = i - GR, i1 = i + GR;
    const inner = [];
    for (let k = i0; k <= i1; k++) {   // 바깥쪽은 물가까지, 안쪽 경계는 반타원 + 살짝 울퉁불퉁 (바닥판 없이 돌만)
      const q = samples[k], u = (k - i) / GR, e = Math.sqrt(Math.max(0, 1 - u * u));
      const inn = q.w * (1 - e * (0.98 + 0.06 * Math.sin(k * 0.9 + i)));
      inner.push(inn);
    }
    // 자갈 알갱이 (InstancedMesh 하나로)
    const cnt = Math.round(GR * 2 * samples[i].w * 3.4), im = new THREE.InstancedMesh(pebbleGeo, toon(0xffffff), cnt), m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), col = new THREE.Color();
    let n = 0;
    for (let tries = 0; n < cnt && tries < cnt * 4; tries++) {
      const k = i0 + Math.floor(grng() * (i1 - i0 + 1)), q = samples[k], inn = inner[k - i0];
      if (q.w - inn < 0.15) continue;
      const r = 0.06 + grng() * 0.09, along = (grng() - 0.5) * 0.25;
      const lat = side * Math.min(q.w - r * 1.1 - 0.06, inn + 0.08 + grng() * (q.w - inn - 0.12));   // 돌이 물길 밖으로 삐져나오지 않게
      qt.setFromEuler(new THREE.Euler(grng() * 3, grng() * 3, grng() * 3));
      m4.compose(V(q.x + q.nx * lat + q.tx * along, q.y + (q.bank || 0) * lat + 0.03 + r * 0.25, q.z + q.nz * lat + q.tz * along), qt, V(r, r * (0.55 + grng() * 0.3), r * (0.8 + grng() * 0.4)));
      im.setMatrixAt(n, m4); im.setColorAt(n, col.setHex(pebCols[Math.floor(grng() * pebCols.length)])); n++;
    }
    im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    group.add(im);
    gravels.push({ i0, i1, side, inner, idx: i });
  }
  const nFrogs = levelNo < 4 ? 0 : Math.min(6, 2 + Math.floor(levelNo / 12));
  for (let j = 0; j < nFrogs; j++) {
    let i = Math.round(30 + (N - 80) * (j + 0.5) / nFrogs), tries = 0;
    const sg = rng() < 0.5 ? 1 : -1, side = sg > 0 ? 'wl' : 'wr';
    const bad = k => !samples[k][side] || samples[k].island || samples[k].fork || busy.some(b => Math.abs(b - k) < 8);
    while (tries++ < 40 && i < N - 20 && bad(i)) i += 3;
    if (i >= N - 20 || bad(i)) continue;
    const sm = samples[i], lat = sg * (sm.w - 0.42), x = sm.x + sm.nx * lat, z = sm.z + sm.nz * lat, fy = sm.y + (sm.bank || 0) * lat;
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.42, 14, 0.3, Math.PI * 2 - 0.6), toon(0x5cb85c, { side: THREE.DoubleSide }));
    pad.rotation.x = -Math.PI / 2; pad.rotation.z = rng() * 6; pad.position.set(x, fy + 0.04, z); group.add(pad);
    const g = makeFrog(); g.scale.setScalar(1.4); g.position.set(x, fy + 0.05, z); g.rotation.y = Math.atan2(sm.tx, sm.tz); group.add(g);
    frogs.push({ g, pad, x, y: fy + 0.05, z, idx: i, s: sm, sg, state: 'sit', vx: 0, vy: 0, vz: 0, phase: rng() * 6 });
  }
  limit += Math.ceil((race ? 3 : 0) + forkExtra + nFount * 2.5 + logCount * 1.2 + nWhirls * 3 + nCrabs * 2 + nMills * 2.5 + gravels.length * 1);   // 장애물 때문에 늦어지는 만큼 더
  const limit0 = Math.ceil(limit * 0.85 * (1 + 0.12 * clamp((levelNo - 6) / 30, 0, 1)));   // 예전 제한 시간 (⭐시간 미션 기준)
  limit = Math.ceil(limit * 0.85 * 0.8 * (1 + 0.12 * clamp((levelNo - 6) / 30, 0, 1)));   // 0.8: 전체 시간 20% 더 줄임
  // ⏱ 레벨 1~5는 손으로 맞춘 시간 (그냥 떠내려가기 기준: 1은 넉넉히 통과, 2부터 조금씩 앞으로 밀어야 함)
  //   측정: 떠내려가기 17.6 / 28.7 / 24.4 / 39.6 / 27.2초, 적당히 밀기 7.8 / 13.1 / 12.8 / 20.5 / 14.8초
  if (!RACE && levelNo <= 5) limit = LIMIT_1_5[levelNo - 1];
  if (RACE) limit = 99999;   // 레이스는 시간 제한 없음 (순위로 겨룸)   // 15% 줄임. 대신 길이 좁고 난간 없는 곳이 많아진 만큼 최대 12% 돌려줌

  // 🌙 밤: 호수 위에 반짝이는 별빛 (반사)
  let lakeStars = null;
  if (theme === 'night') {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < N; i += 8) { const sm = samples[i]; minX = Math.min(minX, sm.x); maxX = Math.max(maxX, sm.x); minZ = Math.min(minZ, sm.z); maxZ = Math.max(maxZ, sm.z); }
    const pos = [];
    for (let i = 0; i < 260; i++) pos.push(lerp(minX - 30, maxX + 30, rng()), LAKE_Y + 0.05, lerp(minZ - 30, maxZ + 30, rng()));
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lakeStars = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTex, size: 0.9, transparent: true, depthWrite: false, opacity: 0.8, color: 0xdfe6ff }));
    group.add(lakeStars);
  }

  // ⏰ 시계 아이템(레벨 21~): 코스 90% 쯤에 숨어 있다가, 80~88% 지점에서 남은 시간이 빠듯할 때만 나타남
  //    먹으면 제한 시간이 늘어남 (21~34: +5초, 35~49: +7초, 50~: +10초)
  let clock = null;
  if (levelNo >= 21 && !RACE) {
    const bonus = levelNo >= 50 ? 10 : levelNo >= 35 ? 7 : 5;
    const taken = [...logs, ...whirls, ...crabs, ...mills].map(o => o.idx);
    let i = Math.round(N * 0.9);
    while (i < N - 30 && (samples[i].fall || samples[i].ramp || samples[i].gap || samples[i].fork || samples[i - 4].fall || taken.some(k => Math.abs(k - i) < 14))) i += 3;
    if (i < N - 30) {
      const sm = samples[i], g = new THREE.Group();
      g.visible = false;   // 시간이 빠듯할 때만 나타남
      const face = new THREE.Group(); face.position.y = 0.8; g.add(face);
      addOutlined(face, new THREE.CylinderGeometry(1, 1, 1, 24), toon(0xfffdf5), V(0, 0, 0), V(0.36, 0.1, 0.36), true, 0.03).rotation.x = Math.PI / 2;   // 시계 판
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.06, 8, 28), toon(0xff5a5f)); face.add(rim);                                        // 빨간 테
      for (const sx of [-1, 1]) addOutlined(face, sphLow, toon(0xff5a5f), V(sx * 0.24, 0.33, 0), V(0.11, 0.09, 0.09), true, 0.025);           // 위쪽 종 두 개
      const handM = new THREE.MeshBasicMaterial({ color: 0x3b2a1e });
      const hH = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.17, 0.02), handM); hH.position.set(0, 0.07, 0.065); face.add(hH);
      const hM = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.25, 0.02), handM); hM.geometry.translate(0, 0.11, 0); hM.position.set(0, 0, 0.07); face.add(hM);
      const dot = new THREE.Mesh(sphLow, handM); dot.scale.setScalar(0.04); dot.position.z = 0.07; face.add(dot);
      for (const sz of [1, -1]) { const back = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), toon(0xfffdf5)); back.position.z = sz * 0.052; if (sz < 0) back.rotation.y = Math.PI; face.add(back); }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: 0xffd43b }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.12; g.add(ring);
      g.position.set(sm.x, sm.y, sm.z); group.add(g);
      clock = { g, face, hand: hM, ring, x: sm.x, y: sm.y, z: sm.z, idx: i, bonus, taken: false, shown: false, skip: false };
    }
  }
  // 🪙 코인: 코스 곳곳에 5개씩 줄지어 (레벨이 오를수록 줄 수 증가). 하트를 다 잃었을 때 모은 코인으로 이어하기
  const coins = [];
  const coinGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 18); coinGeo.rotateX(Math.PI / 2);
  const coinMat = toon(0xffc83d, { emissive: 0x5a3c00 }), coinOutlineMat = new THREE.MeshBasicMaterial({ color: 0x6b3f00, side: THREE.BackSide });
  const objIdx = [...logs, ...whirls, ...crabs, ...mills, ...fountains, ...boosts].map(o => o.idx);
  for (const gv of gravels) for (let k = gv.i0; k <= gv.i1; k += 4) objIdx.push(k);   // 자갈밭 위엔 코인 없음
  const coinFree = k => { const q = samples[k]; return !!q && k < N - 50 && !q.rail && !q.gap && !q.ramp && !q.fall && !q.lift && !q.fork && !q.land && !q.slide && !q.stone && !q.race && !q.pool && !q.loopZone && objIdx.every(o => Math.abs(o - k) > 7); };
  const addCoin = (k, off) => {
    const q = samples[k], m = new THREE.Mesh(coinGeo, coinMat), x = q.x + q.nx * off, z = q.z + q.nz * off;
    const cy = q.y + (q.bank || 0) * off;
    const ol = new THREE.Mesh(coinGeo, coinOutlineMat); ol.scale.set(1.2, 1.2, 1.9); m.add(ol);   // 짙은 갈색 테두리: 물 위에서도 또렷하게
    m.position.set(x, cy + 0.42, z); m.castShadow = true; group.add(m);
    coins.push({ m, x, y: cy, z, idx: k, taken: false });
  };
  const nCoinRows = Math.min(8, 4 + Math.floor(levelNo / 12));
  for (let j = 0; j < nCoinRows; j++) {
    const per = j % 2 ? 2 : 3, rowOk = k => Array.from({ length: per }, (_, c) => c * 4).every(c => coinFree(k + c));   // 한 줄에 3개·2개 번갈아
    let i = Math.round(30 + (N - 90) * (j + 0.5) / nCoinRows), tries = 0;
    while (tries++ < 30 && !rowOk(i)) i += 3;
    if (!rowOk(i)) continue;
    const wave = rng() < 0.5, side = rng() * 2 - 1, ph = rng() * 6;
    for (let c = 0; c < per; c++) {
      const q = samples[i + c * 4], lim = q.w - 0.45;
      addCoin(i + c * 4, clamp(wave ? Math.sin(c * 0.9 + ph) * lim * 0.7 : side * lim * 0.6, -lim, lim));
    }
  }
  for (const [a, b] of runs(samples.map(q => ({ x: q.fast })), 'x')) {   // 긴 섬·짧은 섬 갈림길: 빠른 길에 코인 보상
    const fv = samples[a].fv, fs = samples[a].fside;
    if (fv !== 'long' && fv !== 'short') continue;
    for (let k = a + 3; k < b - 2; k += 8) { const q = samples[k]; addCoin(k, (q.ic + fs * q.ih + fs * q.w) / 2); }
  }
  // 🚃 광산 기차: 승강장 + 레일(침목·받침 다리) + 기차 1칸 + 갈림 레일 (한쪽 🪙 코인, 한쪽 ⚡ 빠른 길) + 끝 범퍼
  const carts = [];
  for (const [a, b] of runs(samples, 'rail')) {
    const crng = mulberry(levelNo * 53 + a);
    const coinSide = crng() < 0.5 ? 1 : -1;   // 코인 레일 쪽 (1 = 왼쪽)
    const iron = toon(0x6c6f78), wood = toon(0x8a5a32), dark = toon(0x5c3b1e);
    const laneOf = (s, side) => side * (side === coinSide ? s.rlaneW : s.rlane);   // 갈림 구간에서 각 레일 가운데 (그 밖에선 0). 코인 레일은 바깥으로 크게 돎
    const RY = 0.16;   // 레일 윗면 높이
    for (const side of [1, -1]) {
      for (const g of [-CART_GAUGE, CART_GAUGE]) {   // 레일 두 줄 (쇠)
        add(ribbon(samples, a, b, s => laneOf(s, side) + g + 0.035, RY, s => laneOf(s, side) + g - 0.035, RY, iron));
        add(ribbon(samples, a, b, s => laneOf(s, side) + g + 0.035, RY - 0.07, s => laneOf(s, side) + g + 0.035, RY, iron));
        add(ribbon(samples, a, b, s => laneOf(s, side) + g - 0.035, RY - 0.07, s => laneOf(s, side) + g - 0.035, RY, iron));
      }
    }
    const tieGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = a; i <= b; i += 2) {   // 침목: 갈림 구간에선 레일마다 하나씩
      const s = samples[i], yaw = Math.atan2(-s.tx, -s.tz);
      for (const side of s.rlane > 0.05 ? [1, -1] : [1]) {
        const lat = laneOf(s, side), t = new THREE.Mesh(tieGeo, wood);
        t.scale.set(CART_GAUGE * 2 + 0.36, 0.08, 0.16); t.position.set(s.x + s.nx * lat, s.y + RY - 0.11, s.z + s.nz * lat); t.rotation.y = yaw; add(t);
      }
      if ((i - a) % 20 === 0) {   // 나무 받침 다리 (호수 쪽 아래로, 듬성듬성)
        for (const side of s.rlane > 0.05 ? [1, -1] : [1]) for (const g of [-1, 1]) {
          const lat = laneOf(s, side) + g * (CART_GAUGE + 0.12), h = s.y - BASE_D - LAKE_Y + 0.6;
          if (h < 0.5) continue;
          const leg = new THREE.Mesh(tieGeo, dark); leg.scale.set(0.13, h, 0.13);
          leg.position.set(s.x + s.nx * lat, s.y + RY - 0.15 - h / 2, s.z + s.nz * lat); leg.rotation.y = yaw; add(leg);
        }
      }
    }
    // 승강장(나무 발판) + 기둥 + 등불, 물길 끝 단면
    const s0 = samples[a], yaw0 = Math.atan2(-s0.tx, -s0.tz), st = samples[Math.min(b, a + 10)];
    const deck = new THREE.Mesh(new THREE.BoxGeometry(s0.w * 2 + 0.6, 0.16, 2.8), toon(0xc98f5a));
    deck.position.set(s0.x + s0.tx * 1.2, s0.y + 0.02, s0.z + s0.tz * 1.2); deck.rotation.y = yaw0; add(deck);
    for (const sg of [1, -1]) {
      const px = s0.x + s0.tx * 1.2 + s0.nx * sg * (s0.w + 0.15), pz = s0.z + s0.tz * 1.2 + s0.nz * sg * (s0.w + 0.15);
      const post = new THREE.Mesh(tieGeo, dark); post.scale.set(0.16, 1.9, 0.16); post.position.set(px, s0.y + 0.95, pz); add(post);
      const lamp = new THREE.Mesh(sphLow, new THREE.MeshBasicMaterial({ color: 0xffd76a })); lamp.scale.setScalar(0.13); lamp.position.set(px, s0.y + 1.95, pz); group.add(lamp);
    }
    const beam = new THREE.Mesh(tieGeo, dark); beam.scale.set(s0.w * 2 + 0.6, 0.16, 0.2); beam.position.set(s0.x + s0.tx * 1.2, s0.y + 1.85, s0.z + s0.tz * 1.2); beam.rotation.y = yaw0; add(beam);
    const signT = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTex('⛏️🚃'), transparent: true, depthWrite: false }));
    signT.scale.set(1.3, 0.65, 1); signT.position.set(s0.x + s0.tx * 1.2, s0.y + 2.35, s0.z + s0.tz * 1.2); group.add(signT);
    for (const [k, sg] of [[a, 1], [b, -1]]) {   // 물길이 끝나고 다시 시작하는 곳 단면
      const q = samples[k], face = new THREE.Mesh(new THREE.BoxGeometry(q.w * 2 + WALL_T * 2, BASE_D + 0.02, 0.18), stoneMat());
      face.position.set(q.x - q.tx * sg * 0.05, q.y - BASE_D / 2, q.z - q.tz * sg * 0.05); face.rotation.y = Math.atan2(-q.tx, -q.tz); add(face);
    }
    // 갈림 레일 표지판 (갈라지기 조금 앞): 코인 쪽 🪙, 빠른 쪽 ⚡
    let sp = a; while (sp < b && samples[sp].rlane < 0.05) sp++;
    let ep = sp; while (ep < b && samples[ep].rlane > 0.05) ep++;
    const sgn = samples[Math.max(a, sp - 14)];
    for (const side of [1, -1]) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTex(side === coinSide ? '🪙' : '⚡'), transparent: true, depthWrite: false }));
      spr.scale.setScalar(0.8); spr.position.set(sgn.x + sgn.nx * side * 1.15, sgn.y + 1.3, sgn.z + sgn.nz * side * 1.15); group.add(spr);
    }
    // 🪙 코인 레일: 갈림 구간 내내 코인 줄 / ⚡ 빠른 레일: 화살표
    for (let i = sp + 8; i < ep - 6; i += 14) {   // 코인은 예전의 2/3
      const s = samples[i], lat = laneOf(s, coinSide), m = new THREE.Mesh(coinGeo, coinMat), x = s.x + s.nx * lat, z = s.z + s.nz * lat;
      const ol = new THREE.Mesh(coinGeo, coinOutlineMat); ol.scale.set(1.2, 1.2, 1.9); m.add(ol);
      m.position.set(x, s.y + 1.05, z); m.castShadow = true; group.add(m);
      coins.push({ m, x, y: s.y + 0.6, z, idx: i, taken: false });
    }
    group.add(ribbon(samples, sp + 2, ep - 2, s => laneOf(s, -coinSide) + 0.28, RY + 0.01, s => laneOf(s, -coinSide) - 0.28, RY + 0.01, boostMatSparse, 3.3));
    // 끝 범퍼 (빨강·흰 줄무늬)
    const se = samples[b - 2], bump = new THREE.Mesh(new THREE.BoxGeometry(CART_GAUGE * 2 + 0.5, 0.45, 0.3), toon(0xe03131));
    bump.position.set(se.x, se.y + RY + 0.2, se.z); bump.rotation.y = Math.atan2(-se.tx, -se.tz); add(bump);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(CART_GAUGE * 2 + 0.52, 0.12, 0.32), toon(0xffffff)); stripe.position.copy(bump.position); stripe.rotation.copy(bump.rotation); add(stripe);
    // 기차 1칸
    const cart = makeMineCart(); group.add(cart);
    const k = { a, b, sp, ep, coinSide, cart, exitI: b - 7, samples };
    placeCartAt(k, a + 4, 0);
    carts.push(k);
  }
  // 🎯 멀리뛰기 과녁: 착지 수영장 위, 보통 속도로 날아오면 떨어질 자리 근처 (좌우는 랜덤)
  const targets = [];
  for (const [ga, gb] of runs(samples.map(q => ({ x: q.gap && q.big })), 'x')) {
    let la = gb + 1, lb = la; while (lb + 1 < N && samples[lb + 1].land) lb++;
    if (!samples[la] || !samples[la].land) continue;
    const top = samples[ga - 1], land = samples[la], h = top.y - land.y;
    // 과녁은 경사로를 향해 힘껏 가속해야 닿는 거리 (그냥 흘러가면 약 3.5~6, 끝까지 가속하면 약 10~14.5 → 과녁 약 8~11.5)
    const dist = clamp(3.3 * def.flow + 0.9, 10, 13);   // 예전보다 1.5칸 더 멀리 (뒤로): 끝까지 힘껏 가속해야 가운데에 닿음
    const i = clamp(ga + Math.round(dist / 0.25), la + 6, lb - 10), sm = samples[i];
    const off = (rng() * 2 - 1) * Math.max(0, sm.w - 2.1);
    const x = sm.x + sm.nx * off, z = sm.z + sm.nz * off, tg = new THREE.Group();
    tg.position.set(x, sm.y + 0.06, z); tg.rotation.x = -Math.PI / 2;
    [[1.75, 1.15, 0xffffff], [1.15, 0.55, 0xff5a5f], [0.55, 0, 0xffd43b]].forEach(([r1, r0, col], k) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false }));
      m.position.z = k * 0.004; m.renderOrder = 3 + k; tg.add(m);   // 투명한 물보다 나중에 그려서 잘 보이게
    });
    group.add(tg);
    targets.push({ g: tg, x, z, y: sm.y, idx: i, done: false });
  }
  for (const [a, b] of runs(samples, 'hop')) {   // 🪨 징검다리 틈마다 공중에 코인 1개
    const m = (a + b) >> 1, nx = samples[b + 1];
    if (nx && nx.stone) addCoin(m, nx.so * 0.6);
  }
  // 🛝 워터슬라이드: 가속 화살표 + 코인을 굽이굽이 줄지어
  for (const [a, b] of runs(samples, 'slide')) {
    group.add(ribbon(samples, a, b, s => s.w - 0.15, 0.05, s => -s.w + 0.15, 0.05, boostMatSparse, 3.3));
    for (let k = a + 6; k < b - 2; k += 7) { const q = samples[k]; addCoin(k, Math.sin((k - a) * 0.09) * (q.w - 0.55)); }
  }
  // 💧 물 위에 얹는 반투명 무늬(화살표·소용돌이·분수 물기둥)는 물보다 나중에 그림
  // (투명한 물길 덩어리와 거리 순서로 섞여 그려지면 물에 덮여 안 보이던 곳이 있었음)
  const overWater = new Set([boostMat, boostMatSparse, whirlMat, fountainMat, fountainCoreMat, fountainBoilMat, fountainTopMat]);
  group.traverse(o => { if (o.isMesh && overWater.has(o.material)) o.renderOrder = Math.max(o.renderOrder, 2); });
  return { carts, cliffSplash, gravels, loops, steam, theme, biome: biome.id, lakeStars, group, samples, total, family, homeAt, homeCtx, pondC, pond, arrive, falls, limit, babies, items, shieldWalls, logs, whirls, crabs, mills, lakeY: LAKE_Y, clock, fountains, boosts, frogs, coins, limit0, targets, race, raceK: RACE, racers, gapArcs, rings, waves,
    raceObs: RACE ? [...logs.map(L => ({ idx: L.idx, lo: L.lo, hi: L.hi })), ...whirls.map(w => ({ idx: w.idx, lo: w.lat - w.R, hi: w.lat + w.R }))] : [] };
}

// 다 자란 오리의 새 보금자리: 작은 나무 오리 집
// 꽃 한 송이 (꽃잎 5장 + 노란 가운데 + 줄기)
function makeFlower(col, s = 1) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(decoGeo.cyl, toon(0x5fae4e)); stem.scale.set(0.018, 0.22, 0.018); stem.position.y = 0.11; g.add(stem);
  const head = new THREE.Group(); head.position.y = 0.23; g.add(head);
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * Math.PI * 2, p = new THREE.Mesh(sphLow, toon(col));
    p.scale.set(0.065, 0.022, 0.045); p.position.set(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06); p.rotation.y = -a; head.add(p);
  }
  const c = new THREE.Mesh(sphLow, toon(0xffc93c)); c.scale.setScalar(0.035); c.position.y = 0.012; head.add(c);
  g.scale.setScalar(s);
  return g;
}
// 튤립 (줄기 + 잎 + 컵 모양 꽃)
function makeTulip(col, s = 1) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(decoGeo.cyl, toon(0x5fae4e)); stem.scale.set(0.02, 0.3, 0.02); stem.position.y = 0.15; g.add(stem);
  const leaf = new THREE.Mesh(sphLow, toon(0x6cc46d)); leaf.scale.set(0.03, 0.13, 0.06); leaf.position.set(0.035, 0.1, 0); leaf.rotation.z = -0.4; g.add(leaf);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.045, 0.13, 7), toon(col)); cup.position.y = 0.34; g.add(cup);
  for (let k = 0; k < 3; k++) { const tip = new THREE.Mesh(decoGeo.cone, toon(col)); tip.scale.set(0.035, 0.06, 0.035); tip.position.set(Math.cos(k * 2.1) * 0.045, 0.42, Math.sin(k * 2.1) * 0.045); g.add(tip); }
  g.scale.setScalar(s);
  return g;
}
// 🏡 별 120개 보상: 흰 울타리 · 튤립 꽃밭 · 꽃 넝쿨 아치 · 반짝이 전구 · 가랜드 · 랜턴 · 우체통 · 풍선 · 연못가 꽃
function decorateDreamHome(group, home, c, PR, EY, momA, add) {
  const pol = (da, r, y = 0) => V(c.x + Math.cos(momA + da) * r, EY + y, c.z + Math.sin(momA + da) * r);
  const put = (m, da, r, y = 0) => { m.position.copy(pol(da, r, y)); m.rotation.y = Math.atan2(c.x - m.position.x, c.z - m.position.z); group.add(m); return m; };
  const pastel = [0xff8fb1, 0xffffff, 0xffd84d, 0xc7a8ff, 0xff9f6b, 0x8fdcc0];
  const bulbs = [0xfff1a8, 0xffb3c7, 0xb5e8ff, 0xd7c2ff, 0xffd59e].map(cl => new THREE.MeshBasicMaterial({ color: cl }));
  // 집: 창문에 따뜻한 불 + 문 앞을 비추는 작은 불빛
  if (home.userData.win) home.userData.win.material = new THREE.MeshBasicMaterial({ color: 0xffe28a });
  const lamp = new THREE.PointLight(0xffc874, 1.1, 10, 1.6); lamp.position.copy(pol(0, PR + 0.2, 2.0)); group.add(lamp);
  // 흰 나무 울타리 (집 뒤쪽을 감싸는 반원) + 기둥마다 반짝이 전구
  const R = PR + 3.0, white = toon(0xfffaf0);
  for (let da = -0.78; da <= 0.781; da += 0.09) {
    const post = put(new THREE.Mesh(decoGeo.cyl7, white), da, R, 0.32); post.scale.set(0.055, 0.64, 0.055);
    const tip = put(new THREE.Mesh(decoGeo.cone, white), da, R, 0.7); tip.scale.set(0.07, 0.12, 0.07);
    if (da < 0.77) {
      const a = pol(da, R), b = pol(da + 0.09, R), mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b);
      for (const y of [0.2, 0.48]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.03), white);
        rail.position.set(mid.x, EY + y, mid.z); rail.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x); group.add(rail);
      }
    }
    const bulb = new THREE.Mesh(sphLow, bulbs[Math.round((da + 1) * 11) % bulbs.length]); bulb.scale.setScalar(0.06); bulb.position.copy(pol(da, R, 0.82)); group.add(bulb);
  }
  // 튤립 꽃밭: 집 양옆, 울타리 안쪽에 세 줄
  const tulipCols = [0xff5d7a, 0xff9fb6, 0xffd84d, 0xffffff, 0xb28dff];
  let n = 0;
  for (const side of [-1, 1]) for (let row = 0; row < 3; row++) for (let k = 0; k < 7; k++) {
    const da = side * (0.27 + k * 0.065 + (row % 2) * 0.03), r = R - 0.4 - row * 0.32;
    put(makeTulip(tulipCols[(n++) % tulipCols.length], 1.15 + ((k + row) % 3) * 0.12), da, r);
  }
  // 연못 쪽 양옆 랜턴 기둥 + 둘 사이에 알록달록 가랜드(삼각 깃발)
  const poles = [];
  for (const sx of [-1, 1]) {
    const da = sx * 0.62, r = PR + 0.6;   // 집(1.4배) 높이에 맞춘 랜턴 기둥. 가랜드 줄이 집 앞(연못 위)으로 지나가게 양옆으로 넓게
    const pole = put(new THREE.Mesh(decoGeo.cyl, toon(0x8a5a35)), da, r, 1.26); pole.scale.set(0.065, 2.52, 0.065);
    put(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.26), new THREE.MeshBasicMaterial({ color: 0xffe9a8 })), da, r, 2.66);
    const cap = put(new THREE.Mesh(decoGeo.cone, toon(0x6b4a2e)), da, r, 2.88); cap.scale.set(0.24, 0.19, 0.24);
    poles.push(pol(da, r, 2.4));
  }
  const flagCols = [0xff6b8b, 0xffd84d, 0x74c0fc, 0x8ce99a, 0xc7a8ff];
  const lineAng = Math.atan2(poles[1].x - poles[0].x, poles[1].z - poles[0].z);
  for (let k = 0; k <= 10; k++) {
    const u = k / 10, p = poles[0].clone().lerp(poles[1], u); p.y -= Math.sin(u * Math.PI) * 0.45;   // 아래로 살짝 처진 줄
    if (k < 10) {
      const q = poles[0].clone().lerp(poles[1], u + 0.05); q.y -= Math.sin((u + 0.05) * Math.PI) * 0.45;
      const fl = new THREE.Mesh(decoGeo.cone, toon(flagCols[k % flagCols.length], { side: THREE.DoubleSide }));
      fl.scale.set(0.16, 0.29, 0.025); fl.rotation.set(Math.PI, lineAng + Math.PI / 2, 0);
      fl.position.set(q.x, q.y - 0.16, q.z); group.add(fl);
    }
    const bb = new THREE.Mesh(sphLow, bulbs[k % bulbs.length]); bb.scale.setScalar(0.055); bb.position.copy(p); group.add(bb);
  }
  // 우체통 (빨간 우편함 + 노란 깃발)
  const mail = new THREE.Group();
  const mp = new THREE.Mesh(decoGeo.cyl, toon(0x8a5a35)); mp.scale.set(0.04, 0.6, 0.04); mp.position.y = 0.3; mail.add(mp);
  addOutlined(mail, new THREE.BoxGeometry(1, 1, 1), toon(0xff5a5f), V(0, 0.68, 0), V(0.22, 0.18, 0.32), true, 0.03);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.08), toon(0xffd84d)); flag.position.set(0.13, 0.78, 0.05); mail.add(flag);
  put(mail, 0.85, PR + 0.9);
  // 풍선 세 개 (집 옆 울타리에 묶임)
  const balloons = new THREE.Group();
  [[0xff6b8b, -0.18, 1.55], [0x74c0fc, 0.05, 1.75], [0xffd84d, 0.22, 1.5]].forEach(([cl, x, y]) => {
    addOutlined(balloons, sph, toon(cl), V(x, y, 0), V(0.17, 0.21, 0.17), true, 0.025);
    const str = new THREE.Mesh(decoGeo.cyl, new THREE.MeshBasicMaterial({ color: 0xffffff })); str.scale.set(0.006, y - 0.2, 0.006); str.position.set(x / 2, (y - 0.2) / 2 + 0.2, 0); str.rotation.z = -x * 0.4; balloons.add(str);
  });
  put(balloons, -0.62, R - 0.05, 0.5);
  // 연못가를 따라 꽃 (집 쪽 반원)
  for (let k = 0; k < 30; k++) {
    const da = (k / 29 - 0.5) * 2.4;
    if (Math.abs(da) < 0.26) continue;   // 집 자리 비움
    put(makeFlower(pastel[k % pastel.length], 1.3 + (k % 3) * 0.15), da, PR + 0.45 + (k % 2) * 0.25);
  }
  // 집 양옆 분홍 꽃 핀 나무
  for (const da of [-0.95, 0.95]) {
    const tr = add(makeTree(c.x + Math.cos(momA + da) * (PR + 2.2), EY, c.z + Math.sin(momA + da) * (PR + 2.2), 0.85));
    for (let k = 0; k < 6; k++) { const bl = new THREE.Mesh(sphLow, toon(0xffb3c7)); bl.scale.setScalar(0.12); bl.position.set(Math.cos(k) * 0.55, 1.5 + (k % 3) * 0.25, Math.sin(k) * 0.55); tr.add(bl); }
  }
}
function makeHome() {
  const g = new THREE.Group();
  const wood = toon(0xe0aa6a), roofC = toon(0xe8735a), dark = toon(0x6b4a2e);
  g.userData.roofMat = roofC;   // 🛍️ 상점에서 지붕 색을 바꿈
  const body = addOutlined(g, new THREE.BoxGeometry(1, 1, 1), wood, V(0, 0.6, 0), V(1.7, 1.2, 1.5));
  body.castShadow = true;
  for (const sx of [-1, 1]) {                                     // 박공 지붕
    const r = addOutlined(g, new THREE.BoxGeometry(1, 1, 1), roofC, V(sx * 0.48, 1.5, 0), V(1.18, 0.14, 1.75));
    r.rotation.z = -sx * 0.62; r.castShadow = true;
  }
  const tri = new THREE.Shape(); tri.moveTo(-0.85, 0); tri.lineTo(0.85, 0); tri.lineTo(0, 0.62); tri.lineTo(-0.85, 0);
  const gableGeo = new THREE.ExtrudeGeometry(tri, { depth: 1.5, bevelEnabled: false }); gableGeo.translate(0, 0, -0.75);
  const gable = new THREE.Mesh(gableGeo, wood); gable.position.set(0, 1.2, 0); g.add(gable);   // 지붕 아래 삼각벽 (앞뒤 박공)
  const door = new THREE.Mesh(new THREE.CircleGeometry(0.33, 18), dark);   // 둥근 문 (앞 = +z)
  door.position.set(0, 0.55, 0.756); g.add(door);
  const win = new THREE.Mesh(new THREE.CircleGeometry(0.14, 14), toon(0xfff3b0));
  win.position.set(0, 1.0, 0.757); g.add(win); g.userData.win = win;
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 1.1), toon(0xc98f5a));      // 물로 내려가는 판자
  ramp.position.set(0, 0.2, 1.25); ramp.rotation.x = 0.36; g.add(ramp);
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.4, 0.22), toon(0xc2b294));
  chimney.position.set(0.45, 1.85, -0.3); g.add(chimney);
  const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }));
  heart.scale.setScalar(0.5); heart.position.set(0, 2.35, 0); g.add(heart);
  return g;
}
// 부들(갈대) 한 무리
function makeReeds(x, y, z, seed) {
  const g = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const h = 0.9 + ((seed * 3 + k) % 4) * 0.15;
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, h, 5), toon(0x6fb85a));
    st.position.set((k - 1) * 0.14, h / 2, (k % 2) * 0.1); st.rotation.z = (k - 1) * 0.12; g.add(st);
    const top = new THREE.Mesh(sphLow, toon(0x8b5a35));
    top.scale.set(0.06, 0.16, 0.06); top.position.set((k - 1) * 0.14 + (k - 1) * 0.12 * -h / 2 * 0.1, h - 0.05, (k % 2) * 0.1); g.add(top);
  }
  g.position.set(x, y, z);
  return g;
}

// ---------- 바이옴 풍경 만들기 ----------
const decoGeo = {
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14), cyl7: new THREE.CylinderGeometry(1, 1.12, 1, 7), cone: new THREE.ConeGeometry(1, 1, 7),
  ico: new THREE.IcosahedronGeometry(1, 0),
  frust: new THREE.CylinderGeometry(0.45 * 1.015, 1.015, 1, 7, 1, true),   // 원뿔 아랫부분을 살짝 덮는 띠
};
for (const g of Object.values(decoGeo)) g.userData.keep = true;   // 레벨 바뀔 때 지우지 않는 공용 모양
// ---------- 🛍️ 오리 상점: 코인으로 물건을 사서 마지막 레벨 내 집 연못가를 꾸밈 ----------
// da = 집 방향(momA)에서 벌어진 각도, r = 연못 가운데에서 거리 (PR 기준 +/-), pond = 연못 위에 둥실
const SHOP = [
  { id: 'parasol', cat: 'yard', icon: '⛱️', price: 30, da: 1.5, r: 1.95, ko: '파라솔', en: 'Parasol' },
  { id: 'chairs', cat: 'yard', icon: '🏖️', price: 25, da: 1.5, r: 1.2, ko: '비치 의자', en: 'Beach Chairs' },
  { id: 'bbq', cat: 'yard', icon: '🍖', price: 40, da: -1.45, r: 1.6, ko: '바베큐 그릴', en: 'BBQ Grill' },
  { id: 'picnic', cat: 'yard', icon: '🧺', price: 35, da: -1.9, r: 1.5, ko: '피크닉 테이블', en: 'Picnic Table' },
  { id: 'bonfire', cat: 'yard', icon: '🔥', price: 45, da: -2.4, r: 1.9, clear: 2.6, ko: '모닥불', en: 'Campfire' },
  { id: 'swing', cat: 'yard', icon: '🎠', price: 50, da: 2.05, r: 2.0, ko: '그네', en: 'Swing' },
  { id: 'slide', cat: 'yard', icon: '🛝', price: 60, da: 2.55, r: 1.8, ko: '미끄럼틀', en: 'Slide' },
  { id: 'pots', cat: 'yard', icon: '🌻', price: 15, da: -1.1, r: 1.5, ko: '해바라기 화분', en: 'Sunflower Pots' },
  { id: 'dock', cat: 'pond', icon: '🪵', price: 40, da: -0.8, r: 0, fda: -1.5, ko: '나무 선착장', en: 'Wooden Dock' },
  { id: 'swan', cat: 'pond', icon: '🦢', price: 55, da: -1.15, r: -1.7, fda: -2.05, fr: -1.8, ko: '백조 보트', en: 'Swan Boat' },
  { id: 'fountain', cat: 'pond', icon: '⛲', price: 50, da: 0.9, r: -1.9, fda: 2.0, fr: -2.6, ko: '연못 분수', en: 'Pond Fountain' },
  { id: 'lamps', cat: 'house', icon: '🏮', price: 30, ko: '현관 등불', en: 'Porch Lamps' },
  { id: 'flowerbox', cat: 'house', icon: '🌷', price: 20, ko: '창문 꽃상자', en: 'Window Flowers' },
  { id: 'smoke', cat: 'house', icon: '💨', price: 15, ko: '굴뚝 연기', en: 'Chimney Smoke' },
  { id: 'roof_blue', cat: 'roof', icon: '🟦', price: 20, color: 0x5b9bf0, ko: '파란 지붕', en: 'Blue Roof' },
  { id: 'roof_green', cat: 'roof', icon: '🟩', price: 20, color: 0x5cbf6a, ko: '초록 지붕', en: 'Green Roof' },
  { id: 'roof_purple', cat: 'roof', icon: '🟪', price: 25, color: 0xa47be0, ko: '보라 지붕', en: 'Purple Roof' },
  { id: 'roof_pink', cat: 'roof', icon: '🩷', price: 25, color: 0xff8fb8, ko: '분홍 지붕', en: 'Pink Roof' },
];
const SHOP_CATS = ['yard', 'pond', 'house', 'roof'];
const shopName = it => (LANG === 'en' ? it.en : it.ko);
function shopSave() {
  if (!save.shop) save.shop = { owned: {}, off: {}, roof: '' };
  return save.shop;
}
const shopOn = id => { const s = shopSave(); return !!s.owned[id] && !s.off[id]; };
// 집 둘레 자리 (월드 좌표)
function shopSpot(it, ctx) {   // 가족 연못(ctx.home 없음)에선 가족과 겹치지 않는 자리(fda·fr)로
  const fam = !ctx.home, a = ctx.momA + (fam && it.fda !== undefined ? it.fda : it.da), r = ctx.PR + (fam && it.fr !== undefined ? it.fr : it.r);
  return { x: ctx.c.x + Math.cos(a) * r, z: ctx.c.z + Math.sin(a) * r };
}
// 산 물건이 놓일 자리 근처엔 나무를 심지 않음
function shopBlocked(x, z, ctx) {
  return SHOP.some(it => it.da !== undefined && shopOn(it.id) && (p => (p.x - x) ** 2 + (p.z - z) ** 2 < (it.clear || 1.6) ** 2)(shopSpot(it, ctx)));
}
function sm(g, geo, col, x, y, z, sx, sy, sz, basic) {   // 작은 부품 하나
  const m = new THREE.Mesh(geo, basic ? new THREE.MeshBasicMaterial({ color: col }) : toon(col));
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = !basic; g.add(m); return m;
}
const BOX = new THREE.BoxGeometry(1, 1, 1); BOX.userData.keep = true;
const SHOP_BUILD = {
  parasol(g) {
    sm(g, decoGeo.cyl, 0xffffff, 0, 0.85, 0, 0.035, 1.7, 0.035);
    const cols = [0xff5d7a, 0xffffff];
    for (let k = 0; k < 8; k++) {   // 빨강·하양 줄무늬 우산
      const seg = new THREE.Mesh(new THREE.ConeGeometry(1, 0.38, 3, 1, true, k * Math.PI / 4, Math.PI / 4), toon(cols[k % 2], { side: THREE.DoubleSide }));
      seg.position.y = 1.7; seg.scale.setScalar(1.05); g.add(seg);
    }
    sm(g, sphLow, 0xffffff, 0, 1.9, 0, 0.06, 0.06, 0.06);
  },
  chairs(g) {
    for (const sx of [-0.45, 0.45]) {
      const c = new THREE.Group(); c.position.x = sx; g.add(c);
      sm(c, BOX, 0x74c0fc, 0, 0.22, 0.12, 0.42, 0.05, 0.75);                                  // 앉는 판
      const back = sm(c, BOX, 0xffffff, 0, 0.42, -0.36, 0.42, 0.05, 0.5); back.rotation.x = 1.0;   // 등받이
      for (const lx of [-0.18, 0.18]) for (const lz of [-0.2, 0.42]) sm(c, BOX, 0xd9d2c3, lx, 0.1, lz, 0.04, 0.2, 0.04);
      sm(c, BOX, 0xffd84d, 0, 0.255, 0.1, 0.36, 0.02, 0.6);                                   // 노란 수건
    }
  },
  bbq(g) {
    for (let k = 0; k < 3; k++) { const a = k * 2.1; const leg = sm(g, decoGeo.cyl, 0x444444, Math.cos(a) * 0.18, 0.25, Math.sin(a) * 0.18, 0.025, 0.5, 0.025); leg.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25); }
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toon(0x2f2f35)); bowl.position.y = 0.6; g.add(bowl);
    sm(g, decoGeo.cyl, 0x9aa0a6, 0, 0.6, 0, 0.31, 0.015, 0.31);                               // 석쇠
    for (let k = 0; k < 3; k++) sm(g, sphLow, 0xb5532f, -0.12 + k * 0.12, 0.64, 0.02 * k, 0.09, 0.04, 0.05);   // 소시지
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0x2f2f35)); lid.position.set(0, 0.62, -0.3); lid.rotation.x = -1.2; g.add(lid);
    const puffs = [];
    for (let k = 0; k < 3; k++) { const p = sm(g, sphLow, 0xeeeeee, 0, 0.8, 0, 0.08, 0.08, 0.08); p.material.transparent = true; puffs.push(p); }
    g.userData.anim = t => puffs.forEach((p, k) => { const u = (t * 0.5 + k / 3) % 1; p.position.set(Math.sin(u * 6 + k) * 0.06, 0.75 + u * 0.9, 0); p.scale.setScalar(0.06 + u * 0.12); p.material.opacity = 0.8 * (1 - u); });
  },
  picnic(g) {
    sm(g, BOX, 0xc98f5a, 0, 0.48, 0, 1.1, 0.06, 0.62);                                         // 탁자
    sm(g, BOX, 0xff6b6b, 0, 0.515, 0, 0.9, 0.012, 0.5);                                       // 빨간 식탁보
    for (const sx of [-0.45, 0.45]) for (const sz of [-0.22, 0.22]) sm(g, BOX, 0xa87444, sx, 0.23, sz, 0.06, 0.46, 0.06);
    for (const sz of [-0.55, 0.55]) { sm(g, BOX, 0xc98f5a, 0, 0.27, sz, 1.1, 0.05, 0.22); for (const sx of [-0.45, 0.45]) sm(g, BOX, 0xa87444, sx, 0.13, sz, 0.05, 0.26, 0.05); }
    const melon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI), toon(0xff5d6c, { side: THREE.DoubleSide })); melon.position.set(-0.2, 0.53, 0); melon.rotation.x = -Math.PI / 2; g.add(melon);
    sm(g, decoGeo.cyl, 0xd9a35a, 0.25, 0.6, 0, 0.13, 0.17, 0.13);                              // 바구니
    sm(g, BOX, 0x8a5a35, 0.25, 0.75, 0, 0.02, 0.02, 0.24).rotation.x = 0;
  },
  bonfire(g) {
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; sm(g, sphLow, 0x77736c, Math.cos(a) * 0.38, 0.06, Math.sin(a) * 0.38, 0.12, 0.08, 0.12); }
    // 🪵 장작: 바닥에 엇갈려 놓은 굵은 통나무 2개 + 그 위로 원뿔처럼 기대 세운 장작 5개 (나뭇결 갈색 + 밝은 단면)
    const log = (len, r, col) => { const L = new THREE.Group(); const body = new THREE.Mesh(decoGeo.cyl, toon(col)); body.scale.set(r, len, r); L.add(body); body.castShadow = true;
      for (const e of [-1, 1]) { const cap = new THREE.Mesh(new THREE.CircleGeometry(r * 0.92, 10), toon(0xc9955a, { side: THREE.DoubleSide })); cap.rotation.x = Math.PI / 2; cap.position.y = e * (len / 2 + 0.002); L.add(cap); }
      g.add(L); return L; };
    for (const [ry, col] of [[0.5, 0x4a2a14], [-0.6, 0x3f2410]]) { const L = log(0.72, 0.06, col); L.position.y = 0.06; L.rotation.order = 'YXZ'; L.rotation.set(Math.PI / 2, ry, 0); }
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * Math.PI * 2 + 0.3, L = log(0.5, 0.045, k % 2 ? 0x55301a : 0x432612);
      L.rotation.order = 'YXZ'; L.rotation.set(-0.55, a, 0);   // 가운데로 기울어진 장작 (윗끝이 모임)
      L.position.set(Math.sin(a) * 0.14, 0.24, Math.cos(a) * 0.14);
    }
    const f0 = sm(g, decoGeo.cone, 0xff5a2a, 0, 0.42, 0, 0.15, 0.5, 0.15, true), f1 = sm(g, decoGeo.cone, 0xff8a2a, 0, 0.42, 0, 0.12, 0.45, 0.12, true), f2 = sm(g, decoGeo.cone, 0xffe066, 0, 0.36, 0, 0.07, 0.3, 0.07, true);
    // 따뜻한 빛: 주황 불빛 + 둥근 빛 번짐 + 위로 튀는 불티
    const light = new THREE.PointLight(0xff9a40, 1.0, 9, 1.6); light.position.y = 1.1; g.add(light);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffa040, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(1.6); glow.position.y = 0.4; g.add(glow);
    const sparks = [];
    for (let k = 0; k < 6; k++) { const p = sm(g, sphLow, k % 2 ? 0xffd04a : 0xff7a2a, 0, 0.5, 0, 0.025, 0.025, 0.025, true); p.material.transparent = true; sparks.push(p); }
    g.scale.setScalar(3);   // 🔥 크게 (예전의 3배)
    g.userData.anim = t => {
      f0.scale.y = 0.5 + Math.sin(t * 9) * 0.07; f1.scale.y = 0.45 + Math.sin(t * 11) * 0.06; f2.scale.y = 0.3 + Math.sin(t * 15 + 1) * 0.05; f1.rotation.y = t * 2; f0.rotation.y = -t * 1.3;
      light.intensity = 0.9 + Math.sin(t * 13) * 0.12 + Math.sin(t * 7.3) * 0.08; glow.material.opacity = 0.5 + Math.sin(t * 9) * 0.08;
      sparks.forEach((p, k) => { const u = (t * 0.6 + k / 6) % 1; p.position.set(Math.sin(k * 2.3 + u * 4) * 0.12, 0.45 + u * 0.8, Math.cos(k * 1.7 + u * 3) * 0.12); p.material.opacity = 1 - u; });
    };
  },
  swing(g) {
    for (const sx of [-0.65, 0.65]) for (const sz of [-1, 1]) { const p = sm(g, decoGeo.cyl, 0xe8735a, sx, 0.65, sz * 0.22, 0.04, 1.35, 0.04); p.rotation.x = sz * 0.3; }
    const bar = sm(g, decoGeo.cyl, 0xe8735a, 0, 1.3, 0, 0.04, 1.4, 0.04); bar.rotation.z = Math.PI / 2;
    const seat = new THREE.Group(); seat.position.y = 1.3; g.add(seat);
    for (const sx of [-0.18, 0.18]) sm(seat, decoGeo.cyl, 0xffffff, sx, -0.45, 0, 0.01, 0.9, 0.01, true);
    sm(seat, BOX, 0x74c0fc, 0, -0.9, 0, 0.45, 0.05, 0.22);
    g.userData.anim = t => { seat.rotation.x = Math.sin(t * 1.6) * 0.35; };
  },
  slide(g) {
    sm(g, BOX, 0xffd84d, 0, 0.9, -0.55, 0.6, 0.06, 0.5);                                      // 꼭대기 발판
    for (const sx of [-0.27, 0.27]) for (const sz of [-0.78, -0.32]) sm(g, decoGeo.cyl, 0x74c0fc, sx, 0.45, sz, 0.035, 0.9, 0.035);
    for (let k = 0; k < 4; k++) sm(g, BOX, 0x74c0fc, 0, 0.18 + k * 0.2, -0.82, 0.5, 0.03, 0.04);   // 사다리
    const sl = sm(g, BOX, 0xff6b8b, 0, 0.47, 0.3, 0.5, 0.05, 1.35); sl.rotation.x = 0.72;          // 미끄럼판
    for (const sx of [-0.26, 0.26]) { const rail = sm(g, BOX, 0xff4f78, sx, 0.53, 0.3, 0.04, 0.1, 1.35); rail.rotation.x = 0.72; }
  },
  pots(g) {
    for (const [x, z, h] of [[-0.35, 0, 0.9], [0, 0.15, 1.1], [0.35, 0, 0.8]]) {
      sm(g, decoGeo.cyl7, 0xd9824a, x, 0.13, z, 0.15, 0.26, 0.15);
      sm(g, decoGeo.cyl, 0x6fb85a, x, 0.26 + h / 2, z, 0.02, h, 0.02);
      const head = new THREE.Group(); head.position.set(x, 0.26 + h, z + 0.03); head.rotation.x = -0.3; g.add(head);
      for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; sm(head, sphLow, 0xffd23f, Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0, 0.07, 0.07, 0.03); }
      sm(head, sphLow, 0x7a4a26, 0, 0, 0.01, 0.09, 0.09, 0.04);
    }
  },
  dock(g, ctx) {   // 연못가에서 연못 안쪽으로 뻗은 나무 판자 (+z = 연못 쪽)
    for (let k = 0; k < 9; k++) sm(g, BOX, k % 2 ? 0xc98f5a : 0xb57d4c, 0, 0.1, -0.2 + k * 0.28, 0.9, 0.06, 0.25);
    for (const sx of [-0.45, 0.45]) for (const z of [0.4, 1.3, 2.1]) sm(g, decoGeo.cyl, 0x8a5a35, sx, 0.05, z, 0.05, 0.4, 0.05);
  },
  swan(g) {
    const b = new THREE.Group(); g.add(b);
    sm(b, sph, 0xffffff, 0, 0.18, 0, 0.42, 0.22, 0.6);
    sm(b, sph, 0xffffff, 0, 0.3, -0.3, 0.3, 0.2, 0.3);                                         // 꼬리 쪽 깃
    const n1 = sm(b, decoGeo.cyl, 0xffffff, 0, 0.55, 0.38, 0.07, 0.6, 0.07); n1.rotation.x = 0.25;
    sm(b, sph, 0xffffff, 0, 0.9, 0.48, 0.12, 0.11, 0.15);
    sm(b, decoGeo.cone, 0xff9f43, 0, 0.88, 0.66, 0.05, 0.16, 0.05).rotation.x = Math.PI / 2;
    for (const sx of [-0.06, 0.06]) sm(b, sphLow, 0x222222, sx * 1.6, 0.94, 0.56, 0.02, 0.02, 0.02);
    sm(b, sph, 0xffd0de, 0, 0.32, 0.02, 0.3, 0.06, 0.38);                                      // 분홍 자리
    g.userData.anim = t => { b.position.y = Math.sin(t * 1.8) * 0.04; b.rotation.z = Math.sin(t * 1.3) * 0.05; };
    g.userData.spin = true;
  },
  fountain(g) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.12, 8, 24), toon(0xe9e4da)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.08; g.add(ring);
    sm(g, decoGeo.cyl, 0xe9e4da, 0, 0.35, 0, 0.12, 0.7, 0.12);
    sm(g, decoGeo.cyl, 0xe9e4da, 0, 0.72, 0, 0.35, 0.06, 0.35);
    const jets = [];
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; const j = sm(g, sphLow, 0xbfe8ff, Math.cos(a) * 0.45, 0.5, Math.sin(a) * 0.45, 0.05, 0.05, 0.05, true); j.userData.a = a; jets.push(j); }
    const top = sm(g, decoGeo.cone, 0xbfe8ff, 0, 1.0, 0, 0.12, 0.5, 0.12, true); top.material.transparent = true; top.material.opacity = 0.8;
    g.userData.anim = t => { top.scale.y = 0.45 + Math.sin(t * 8) * 0.06; jets.forEach((j, k) => { const u = (t * 0.9 + k / 6) % 1; const r = 0.1 + u * 0.55; j.position.set(Math.cos(j.userData.a) * r, 0.78 + Math.sin(u * Math.PI) * 0.35 - u * 0.5, Math.sin(j.userData.a) * r); }); };
  },
};
// 집 꾸미기: 지붕 색 / 현관 등불 / 창문 꽃상자 / 굴뚝 연기
function decorateShopHouse(home, out) {
  const s = shopSave(), u = home.userData;
  const roof = SHOP.find(it => it.id === s.roof && s.owned[it.id]);
  if (u.roofMat) u.roofMat.color.setHex(roof ? roof.color : 0xe8735a);
  if (shopOn('lamps')) for (const sx of [-0.62, 0.62]) {
    const g = new THREE.Group(); g.position.set(sx, 0, 0.95); home.add(g); out.push(g);
    sm(g, decoGeo.cyl, 0x4a3a2e, 0, 0.45, 0, 0.03, 0.9, 0.03);
    sm(g, BOX, 0xffe9a8, 0, 0.98, 0, 0.14, 0.18, 0.14, true);
    sm(g, decoGeo.cone, 0x4a3a2e, 0, 1.12, 0, 0.12, 0.1, 0.12);
  }
  if (shopOn('flowerbox')) {
    const g = new THREE.Group(); home.add(g); out.push(g);
    for (const sx of [-0.55, 0.55]) {
      sm(g, BOX, 0xffffff, sx, 0.88, 0.8, 0.42, 0.12, 0.12);
      for (let k = 0; k < 4; k++) sm(g, sphLow, [0xff5d7a, 0xffd84d, 0xff9fb6, 0xc7a8ff][k], sx - 0.15 + k * 0.1, 0.98, 0.8, 0.05, 0.05, 0.05);
    }
  }
  if (shopOn('smoke')) {
    const g = new THREE.Group(); g.position.set(0.45, 2.05, -0.3); home.add(g); out.push(g);
    const puffs = [];
    for (let k = 0; k < 4; k++) { const p = sm(g, sphLow, 0xf2f2f2, 0, 0, 0, 0.1, 0.1, 0.1); p.material.transparent = true; puffs.push(p); }
    g.userData.anim = t => puffs.forEach((p, k) => { const u = (t * 0.35 + k / 4) % 1; p.position.set(Math.sin(u * 5 + k) * 0.08 + u * 0.25, u * 1.1, 0); p.scale.setScalar(0.07 + u * 0.16); p.material.opacity = 0.85 * (1 - u); });
  }
}
// 산 물건들을 집 둘레에 놓음 (살 때마다 다시 그림)
function placeShopDecor(w) {
  if (!w || !w.homeCtx) return;
  if (w.shopGroup) { w.group.remove(w.shopGroup); }
  for (const o of w.shopHouseParts || []) o.parent && o.parent.remove(o);
  const ctx = w.homeCtx, grp = new THREE.Group(), anims = [];
  w.shopGroup = grp; w.shopHouseParts = []; w.group.add(grp);
  for (const it of SHOP) {
    if (it.da === undefined || !shopOn(it.id)) continue;
    const g = new THREE.Group(), p = shopSpot(it, ctx);
    SHOP_BUILD[it.id](g, ctx);
    g.position.set(p.x, ctx.EY + (it.cat === 'pond' ? 0.02 : 0), p.z);
    g.rotation.y = Math.atan2(ctx.c.x - p.x, ctx.c.z - p.z);   // 연못 쪽을 바라봄
    if (it.id === 'dock') { const a = ctx.momA + (!ctx.home && it.fda !== undefined ? it.fda : it.da); g.position.set(ctx.c.x + Math.cos(a) * (ctx.PR + 0.2), ctx.EY + 0.02, ctx.c.z + Math.sin(a) * (ctx.PR + 0.2)); }
    if (it.id === 'swan') g.rotation.y += Math.PI / 2;
    grp.add(g);
    if (g.userData.anim) anims.push(g);
  }
  if (ctx.home) decorateShopHouse(ctx.home, w.shopHouseParts);
  for (const g of w.shopHouseParts) if (g.userData.anim) anims.push(g);
  w.shopAnims = anims;
}
function updateShopDecor() {
  if (world && world.steam) for (const sp of world.steam) {   // ♨️ 김: 수면에서 피어올라 커지며 옅어짐
    const u = sp.userData, k = (elapsed * u.sp + u.ph) % 1;
    sp.position.set(u.x + u.dx * k, world.pondC.y + 0.15 + k * 2.2, u.z);
    sp.scale.setScalar(1.3 + k * 2.8); sp.material.opacity = 0.75 * Math.sin(k * Math.PI);
  }
  if (!world || !world.shopAnims) return;
  for (const g of world.shopAnims) g.userData.anim(elapsed);
}

// ---------- 상점 화면 ----------
let shopFromTitle = false, shopPrev = null;
function openShop() {
  shopFromTitle = titleScene; shopPrev = levelIdx;
  loadLevel(LEVELS.length - 1);   // 마지막 레벨 내 집 연못가에서 보며 고르기
  const c = world.pondC;
  Object.assign(P, { x: c.x, y: c.y, z: c.z, vx: 0, vz: 0, vy: 0 });
  P.yaw = Math.atan2(-(world.homeAt.x - c.x), -(world.homeAt.z - c.z)) + Math.PI;
  state = 'shop'; shopT0 = elapsed;
  renderShop();
  show('#shop');
}
let shopT0 = 0;
function renderShop() {
  const s = shopSave();
  $('#shopCoins').textContent = `🪙 ${save.coins || 0}`;
  const box = $('#shopList'); box.innerHTML = '';
  for (const cat of SHOP_CATS) {
    const h = document.createElement('div'); h.className = 'shop-cat'; h.textContent = t('shopCat_' + cat); box.appendChild(h);
    const grid = document.createElement('div'); grid.className = 'look-grid shop-grid'; box.appendChild(grid);
    for (const it of SHOP.filter(x => x.cat === cat)) {
      const own = !!s.owned[it.id], on = it.cat === 'roof' ? s.roof === it.id : own && !s.off[it.id];
      const b = document.createElement('button');
      b.className = 'look-btn' + (on ? ' on' : '') + (!own && (save.coins || 0) < it.price ? ' poor' : '');
      b.innerHTML = `<span class="look-icon">${it.icon}</span><span class="look-name">${shopName(it)}</span>` +
        `<span class="look-sub">${own ? (on ? t('shopPlaced') : t('shopStored')) : '🪙 ' + it.price}</span>`;
      b.onclick = () => shopTap(it);
      grid.appendChild(b);
    }
  }
}
function shopTap(it) {
  const s = shopSave();
  if (!s.owned[it.id]) {
    if ((save.coins || 0) < it.price) { Sfx.bump(); showToast(t('shopPoor', it.price - (save.coins || 0)), 1400); return; }
    save.coins -= it.price; s.owned[it.id] = true; delete s.off[it.id];
    if (it.cat === 'roof') s.roof = it.id;
    Sfx.coin(); setTimeout(() => Sfx.power(), 120);
    showToast(t('shopBought', it.icon, shopName(it)), 1400);
  } else {
    Sfx.click();
    if (it.cat === 'roof') s.roof = s.roof === it.id ? '' : it.id;   // 다시 누르면 원래 빨간 지붕
    else if (s.off[it.id]) delete s.off[it.id]; else s.off[it.id] = true;
  }
  persist(); updateCoinsHud(true);
  placeShopDecor(world); renderShop();
  if (shopOn(it.id) || s.roof === it.id) {   // 놓인 자리에 반짝
    const ctx = world.homeCtx, p = it.da !== undefined ? shopSpot(it, ctx) : world.homeAt || ctx.c;
    for (let k = 0; k < 12; k++) spawnSprite(starTex, p.x, ctx.EY + 1, p.z, (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.25, 0.8);
  }
}
function closeShop() {
  Sfx.click();
  if (shopFromTitle) { state = 'levels'; showTitleScene(); }
  else loadLevel(Math.min(shopPrev ?? save.unlocked - 1, save.unlocked - 1));
  openLevels();
}
function shopTopFrac() {
  const sh = document.querySelector('#shop .panel'), a = appEl.getBoundingClientRect();
  if (!sh || !a.height || $('#shop').classList.contains('hidden')) return 1;
  return Math.min(1, Math.max(0, (sh.getBoundingClientRect().top - a.top) / a.height));
}
function shopCam() {   // 집과 연못 둘레를 천천히 돌며 보여 줌
  const c = world.pondC, h = world.homeAt;
  const mx = c.x + (h.x - c.x) * 0.3, mz = c.z + (h.z - c.z) * 0.3;
  const a0 = Math.atan2(c.x - h.x, c.z - h.z), a = a0 + (elapsed - shopT0) * 0.12;
  camTarget.set(mx + Math.sin(a) * 16, c.y + 11, mz + Math.cos(a) * 16);
  lookTarget.set(mx, c.y + 0.6, mz);
}

function makePine(x, y, z, s, snowy) {
  const t = new THREE.Group();
  const trunk = new THREE.Mesh(decoGeo.cyl, toon(0x8a5a35)); trunk.scale.set(0.16, 0.7, 0.16); trunk.position.y = 0.35; t.add(trunk);
  const k0 = Math.floor(Math.abs(x * 5 + z * 11)) % 4;   // 단풍철엔 넷 중 셋은 붉고 노랗게 (하나는 늘 푸른 소나무)
  const greens = snowy ? [0x4f8f6a, 0x5a9e76, 0x67ad83] : autumn && k0 < 3 ? AUTUMN[k0] : [0x2f8a4c, 0x3a9c58, 0x4aae66];
  for (let k = 0; k < 3; k++) {
    const c = new THREE.Mesh(decoGeo.cone, toon(greens[k])); c.scale.set(0.85 - k * 0.2, 1.0 - k * 0.15, 0.85 - k * 0.2); c.position.y = 1.0 + k * 0.55; c.castShadow = true; t.add(c);
    if (snowy) { const sn = new THREE.Mesh(decoGeo.cone, snowCapMat); sn.scale.set(0.42 - k * 0.1, 0.35, 0.42 - k * 0.1); sn.position.y = 1.36 + k * 0.55; t.add(sn); }
  }
  t.position.set(x, y, z); t.scale.setScalar(s);
  return t;
}
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };
const snowCapMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
function decorateBiome(id, group, samples, rng, add) {
  const N = samples.length;
  // 물길에서 충분히 떨어진 자리만 (r = 장식 반지름)
  // 도착 섬(연못 + 가족)과 도착 후 빙 도는 카메라 길에도 안 겹치게: 섬 반지름 약 9 + 카메라 거리 여유
  const eS = samples[N - 1], pcx = eS.x + eS.tx * 4.8, pcz = eS.z + eS.tz * 4.8;
  const farFromTrack = (x, z, r) => { if ((x - pcx) ** 2 + (z - pcz) ** 2 < (r + 11.5) ** 2) return false; for (let j = 0; j < N; j += 4) { const sm = samples[j]; if ((sm.x - x) ** 2 + (sm.z - z) ** 2 < (r + sm.w + 2) ** 2) return false; } return true; };
  const trackDist = (x, z) => { let d = 1e9; for (let j = 0; j < N; j += 4) d = Math.min(d, Math.hypot(samples[j].x - x, samples[j].z - z)); return d; };
  // 물길 가까이 있는 큰 장식은 물길보다 낮게 (앞길을 가리지 않게). 멀리 있는 것만 높게 솟을 수 있음
  const maxTop = (x, z, r, want) => { const d = trackDist(x, z) - r; const trackH = -W - 1.2; return d < 16 ? Math.min(want, Math.max(1.5, trackH)) : want; };
  const spot = (minOff, maxOff, r) => {
    for (let tries = 0; tries < 12; tries++) {
      const sm = samples[Math.floor(rng() * N)], side = rng() < 0.5 ? 1 : -1, off = minOff + rng() * (maxOff - minOff);
      const x = sm.x + sm.nx * off * side, z = sm.z + sm.nz * off * side;
      if (farFromTrack(x, z, r)) return { x, z };
    }
    return null;
  };
  const W = LAKE_Y;   // 호수 수면 높이
  const count = n => Math.round(n * Math.max(1, N / 500));
  if (id === 'lake') {                     // 🏞️ 잔디 섬 + 나무 + 연잎
    for (let i = 0; i < count(14); i++) {
      const p = spot(9, 23, 4); if (!p) continue;
      add(at(new THREE.Mesh(new THREE.CylinderGeometry(2 + rng() * 2, 2.6 + rng() * 2, 0.8, 14), toon(0xa8e494)), p.x, W + 0.2, p.z));
      add(makeTree(p.x, W + 0.6, p.z, 0.9 + rng() * 0.6));
      if (rng() < 0.6) { const lily = new THREE.Mesh(new THREE.CircleGeometry(0.7, 12), toon(0x7ccf7a, { side: THREE.DoubleSide })); lily.rotation.x = -Math.PI / 2; lily.position.set(p.x + 4, W + 0.02, p.z + 2); add(lily); }
    }
  } else if (id === 'meadow') {            // 🌼 꽃이 핀 둥근 언덕 + 동글 덤불
    const flowerCols = [0xff9fb6, 0xffffff, 0xffd84d, 0xc7a8ff, 0xff8a65];
    for (let i = 0; i < count(24); i++) {
      const r = 2.2 + rng() * 2.4, p = spot(5, 18, r + 0.5); if (!p) continue;
      const hill = new THREE.Mesh(sphLow, toon(0x9fdc7c)); hill.scale.set(r, 1.2 + rng() * 1.2, r); hill.position.set(p.x, W, p.z); add(hill);
      for (let k = 0; k < 9; k++) {
        const a = rng() * Math.PI * 2, rr = rng() * r * 0.75;
        const f = new THREE.Mesh(sphLow, toon(flowerCols[k % flowerCols.length])); f.scale.setScalar(0.2);
        f.position.set(p.x + Math.cos(a) * rr, W + hill.scale.y * Math.sqrt(Math.max(0, 1 - (rr / r) ** 2)) + 0.05, p.z + Math.sin(a) * rr); group.add(f);
      }
      if (rng() < 0.6) { const bush = new THREE.Mesh(sphLow, toon(0x6cc46d)); bush.scale.set(0.9, 0.7, 0.9); bush.position.set(p.x + r * 0.6, W + 0.6, p.z - r * 0.3); add(bush); }
    }
  } else if (id === 'mountain') {          // ⛰️ 눈 덮인 큰 산 + 소나무
    for (let i = 0; i < count(10); i++) {
      const r = 4.5 + rng() * 5.5, p = spot(9, 30, r); if (!p) continue;
      const h = maxTop(p.x, p.z, r, 9 + rng() * 13);
      const m = new THREE.Mesh(decoGeo.cone, toon([0xc9673d, 0xd98a40, 0xb85a3a, 0xc98a4a][i % 4])); m.scale.set(r, h, r); m.position.set(p.x, W + h / 2, p.z); m.rotation.y = rng() * 3; add(m);   // 🍁 단풍 든 산
      const band = new THREE.Mesh(decoGeo.frust, toon([0xe8a33c, 0xd9482f, 0xf0b545, 0xe0703a][i % 4], { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));   // 산허리 단풍 띠 (색이 다른 숲)
      band.scale.set(r, h * 0.55, r); band.position.set(p.x, W + h * 0.275, p.z); band.rotation.y = m.rotation.y; add(band); band.castShadow = band.receiveShadow = false;
      m.castShadow = m.receiveShadow = false;   // 큰 산은 그림자 X (오리를 따라 움직이는 그림자 범위 때문에 깜빡임)
      // 눈 모자: 산 표면과 딱 겹치면 멀리서 깜빡여서(z-fighting) 살짝 더 두껍게 + 앞에 그리도록 오프셋
      const cap = new THREE.Mesh(decoGeo.cone, snowCapMat); cap.scale.set(r * 0.4, h * 0.37, r * 0.4); cap.position.set(p.x, W + h * 0.82 + h * 0.006, p.z); cap.rotation.y = m.rotation.y; add(cap); cap.castShadow = cap.receiveShadow = false;
    }
    for (let i = 0; i < count(26); i++) { const p = spot(5, 16, 1.2); if (p) add(makePine(p.x, W, p.z, 1.4 + rng() * 0.8, false)); }
  } else if (id === 'canyon') {            // 🏜️ 층층이 붉은 바위 기둥 (메사)
    const reds = [0xd9774a, 0xe8935c, 0xc8653f, 0xf0a56c];
    for (let i = 0; i < count(26); i++) {
      const r = 1.8 + rng() * 3, p = spot(5, 20, r); if (!p) continue;
      const total = maxTop(p.x, p.z, r, -W + 1 + rng() * 6);   // 멀리 있는 바위만 물길보다 높게
      let y = W; const layers = 3 + Math.floor(rng() * 2);
      for (let k = 0; k < layers; k++) {
        const h = total / layers, rr = r * (1 - k * 0.12);
        const m = new THREE.Mesh(decoGeo.cyl7, toon(reds[(i + k) % reds.length])); m.scale.set(rr, h, rr); m.position.set(p.x, y + h / 2, p.z); m.rotation.y = rng() * 3; add(m);
        y += h;
      }
      if (rng() < 0.5) { const cactus = new THREE.Mesh(decoGeo.cyl, toon(0x5a9e5a)); cactus.scale.set(0.18, 0.8, 0.18); cactus.position.set(p.x, y + 0.4, p.z); add(cactus); }
    }
  } else if (id === 'forest') {            // 🌲 소나무가 빽빽한 섬
    for (let i = 0; i < count(20); i++) {
      const r = 2.2 + rng() * 2.4, p = spot(5, 18, r + 0.5); if (!p) continue;
      add(at(new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.6, 0.8, 14), toon(0x5fae62)), p.x, W + 0.2, p.z));
      for (let k = 0; k < 5; k++) { const a = rng() * Math.PI * 2, rr = rng() * r * 0.75; add(makePine(p.x + Math.cos(a) * rr, W + 0.6, p.z + Math.sin(a) * rr, 1.1 + rng() * 0.9, false)); }
    }
  } else if (id === 'snow') {              // ❄️ 눈 덮인 섬 + 눈 맞은 소나무 + 빙산
    for (let i = 0; i < count(18); i++) {
      const r = 2 + rng() * 2.2, p = spot(5, 18, r + 0.5); if (!p) continue;
      add(at(new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.6, 0.8, 14), toon(0xf4f9ff)), p.x, W + 0.2, p.z));
      for (let k = 0; k < 3; k++) { const a = rng() * Math.PI * 2, rr = rng() * r * 0.7; add(makePine(p.x + Math.cos(a) * rr, W + 0.6, p.z + Math.sin(a) * rr, 1.0 + rng() * 0.7, true)); }
    }
    for (let i = 0; i < count(16); i++) {
      const r = 1.1 + rng() * 1.8, p = spot(5, 20, r); if (!p) continue;
      const ice = new THREE.Mesh(decoGeo.ico, toon(i % 2 ? 0xe8f6ff : 0xc9e8fb)); ice.scale.set(r, r * (0.8 + rng() * 0.8), r); ice.position.set(p.x, W + r * 0.3, p.z); ice.rotation.set(rng(), rng() * 3, rng()); add(ice);
    }
  }
}

let autumn = false;   // 🍁 산(21~30) 레벨: 나무·산이 단풍 색
const AUTUMN = [[0xe8603c, 0xf08a3e, 0xd9482f], [0xf2b33d, 0xf5c84f, 0xe89a2c], [0xe07a35, 0xd9532e, 0xf0a33f]];
function makeTree(x, y, z, s) {
  const t = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.2, 7), toon(0xb07a4a));
  trunk.position.y = 0.6; t.add(trunk);
  const cols = autumn ? AUTUMN[Math.floor(Math.abs(x * 7 + z * 13)) % 3] : [0x7fd17a, 0x92dc84, 0x6cc46d];
  for (let k = 0; k < 3; k++) {
    const b = new THREE.Mesh(sphLow, toon(cols[k]));
    b.scale.setScalar(0.85 - k * 0.15); b.position.set((k - 1) * 0.35, 1.5 + k * 0.45, (k % 2) * 0.2);
    b.castShadow = true; t.add(b);
  }
  t.position.set(x, y, z); t.scale.setScalar(s);
  return t;
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- 입력: 자이로 / 조이스틱 / 키보드 ----------
const input = { x: 0, y: 0 };
let controlMode = 'joy';      // 'gyro' | 'joy'
let gyroAvailable = false;
const tilt = { beta: null, gamma: null, b0: 0, g0: 0 };
window.addEventListener('deviceorientation', e => {
  if (e.beta == null || e.gamma == null) return;
  tilt.beta = e.beta; tilt.gamma = e.gamma;
});
function calibrate() { if (tilt.beta != null) { tilt.b0 = tilt.beta; tilt.g0 = tilt.gamma; } }

async function detectGyro() {
  if (typeof DeviceOrientationEvent === 'undefined') return false;
  if (typeof DeviceOrientationEvent.requestPermission === 'function') { // iOS 13+
    try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return false; }
    catch (e) { return false; }
  }
  if (tilt.beta != null) return true;
  return new Promise(res => {
    const h = e => { if (e.beta != null && e.gamma != null) { cleanup(); res(true); } };
    const cleanup = () => window.removeEventListener('deviceorientation', h);
    window.addEventListener('deviceorientation', h);
    setTimeout(() => { cleanup(); res(tilt.beta != null); }, 900);
  });
}

function gyroInput() {
  if (tilt.beta == null) return [0, 0];
  let db = tilt.beta - tilt.b0, dg = tilt.gamma - tilt.g0;
  const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  let x, y;
  if (ang === 90) { x = db; y = dg; }
  else if (ang === -90 || ang === 270) { x = -db; y = -dg; }
  else { x = dg; y = -db; }
  const f = v => { const a = Math.abs(v); return a < GYRO_DEAD_DEG ? 0 : Math.sign(v) * Math.min(1, (a - GYRO_DEAD_DEG) / GYRO_FULL_DEG); };
  return [f(x), f(y)];
}

// 조이스틱
const joyZone = $('#joyZone'), joy = $('#joy'), knob = $('#joyKnob');
const joyVec = { x: 0, y: 0 }; let joyId = null;
function joyMove(e) {
  const r = joy.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2 - 10;
  let dx = e.clientX - cx, dy = e.clientY - cy;
  const L = Math.hypot(dx, dy); if (L > R) { dx *= R / L; dy *= R / L; }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  joyVec.x = dx / R; joyVec.y = -dy / R;
}
joyZone.addEventListener('pointerdown', e => { joyId = e.pointerId; joyZone.setPointerCapture(e.pointerId); joyMove(e); e.preventDefault(); });
joyZone.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyMove(e); });
function joyReset() { joyId = null; joyVec.x = joyVec.y = 0; knob.style.transform = ''; }
const joyEnd = e => { if (e.pointerId === joyId) joyReset(); };
joyZone.addEventListener('pointerup', joyEnd); joyZone.addEventListener('pointercancel', joyEnd);
// 조이스틱을 누른 채로 팝업이 뜨거나 화면이 바뀌면 손 뗀 신호가 안 와서 계속 기울어진 채로 남던 문제 방지
joyZone.addEventListener('lostpointercapture', joyEnd);
window.addEventListener('blur', joyReset);

const keys = {};
window.addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'Escape' && state === 'playing') pauseGame(); });
window.addEventListener('keyup', e => { keys[e.code] = false; });

function readInput() {
  let x = 0, y = 0;
  if (controlMode === 'gyro') [x, y] = gyroInput();
  else { x = joyVec.x; y = joyVec.y; }
  x += (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
  y += (keys.ArrowUp || keys.KeyW ? 1 : 0) - (keys.ArrowDown || keys.KeyS ? 1 : 0);
  const L = Math.hypot(x, y); if (L > 1) { x /= L; y /= L; }
  input.x = x; input.y = y;
}

function setControlMode(m) {
  controlMode = m;
  joyReset();
  joyZone.classList.toggle('hidden', m !== 'joy' || !inGame());
  $('#btnControl').textContent = m === 'joy' ? (gyroAvailable ? t('ctrlToTilt') : t('ctrlJoy')) : t('ctrlToJoy');
  $('#btnControl').disabled = !gyroAvailable;
  $('#btnControl').style.opacity = gyroAvailable ? 1 : 0.6;
  $('#btnCalib').classList.toggle('hidden', m !== 'gyro');
  if (m === 'gyro') calibrate();
}

// ---------- 게임 상태 ----------
let state = 'title';   // title | levels | countdown | playing | paused | falling | win | failed
let levelIdx = 0, world = null;
let duck = makeDuck({ scale: 1.25 }); scene.add(duck);

// ---------- 오리 꾸미기: 별을 모으면 하나씩 열림 ----------
// slot 이 같은 것끼리는 하나만 (모자류는 head). home 은 입는 게 아니라 120★ 엔딩 보상
const LOOKS = [
  // cat: 꾸미기 화면에서 묶어 보여 주는 줄 (분류마다 6가지). hue: 같은 이모지를 색만 바꿔 보여 줄 때
  // need: 열리는 별 개수 (전체 최대 198개). 원래 있던 꾸미기는 예전보다 높아지지 않게 (이미 연 걸 잃지 않게). 아직 안 열린 건 코인으로 바로 살 수도 있음 (lookPrice)
  { id: 'bow',      slot: 'head',  cat: 'bow',     need: 5,   icon: '🎀' },
  { id: 'flower',   slot: 'head',  cat: 'bow',     need: 12,  icon: '🌼' },
  { id: 'heartpin', slot: 'head',  cat: 'bow',     need: 24,  icon: '❤️' },
  { id: 'starpin',  slot: 'head',  cat: 'bow',     need: 40,  icon: '⭐' },
  { id: 'bowblue',  slot: 'head',  cat: 'bow',     need: 62,  icon: '🎀', hue: 190 },
  { id: 'cherry',   slot: 'head',  cat: 'bow',     need: 88,  icon: '🍒' },
  { id: 'tube',     slot: 'body',  cat: 'tube',    need: 15,  icon: '🛟' },
  { id: 'tubedot',  slot: 'body',  cat: 'tube',    need: 22,  icon: '🛟', hue: 200 },
  { id: 'tubemint', slot: 'body',  cat: 'tube',    need: 34,  icon: '🛟', hue: 120 },
  { id: 'melon',    slot: 'body',  cat: 'tube',    need: 55,  icon: '🍉' },
  { id: 'donut',    slot: 'body',  cat: 'tube',    need: 80,  icon: '🍩' },
  { id: 'float',    slot: 'body',  cat: 'tube',    need: 112, icon: '🏳️‍🌈' },
  { id: 'hat',      slot: 'head',  cat: 'hat',     need: 28,  icon: '👒' },
  { id: 'cap',      slot: 'head',  cat: 'hat',     need: 45,  icon: '🧢' },
  { id: 'beanie',   slot: 'head',  cat: 'hat',     need: 66,  icon: '🧶' },
  { id: 'santa',    slot: 'head',  cat: 'hat',     need: 80,  icon: '🎅' },
  { id: 'propeller', slot: 'head', cat: 'hat',     need: 104, icon: '🚁' },
  { id: 'party',    slot: 'head',  cat: 'hat',     need: 120, icon: '🥳' },
  { id: 'round',    slot: 'face',  cat: 'glasses', need: 30,  icon: '👓' },
  { id: 'glasses',  slot: 'face',  cat: 'glasses', need: 38,  icon: '🕶️' },
  { id: 'goggles',  slot: 'face',  cat: 'glasses', need: 58,  icon: '🥽' },
  { id: 'stargl',   slot: 'face',  cat: 'glasses', need: 76,  icon: '🌟' },
  { id: 'nerd',     slot: 'face',  cat: 'glasses', need: 96,  icon: '🤓' },
  { id: 'heartgl',  slot: 'face',  cat: 'glasses', need: 110, icon: '💖' },
  { id: 'bell',     slot: 'neck',  cat: 'scarf',   need: 50,  icon: '🔔' },
  { id: 'scarf',    slot: 'neck',  cat: 'scarf',   need: 70,  icon: '🧣' },
  { id: 'tie',      slot: 'neck',  cat: 'scarf',   need: 92,  icon: '👔' },
  { id: 'pearl',    slot: 'neck',  cat: 'scarf',   need: 108, icon: '🦪' },
  { id: 'lei',      slot: 'neck',  cat: 'scarf',   need: 136, icon: '🌺' },
  { id: 'bowtie',   slot: 'neck',  cat: 'scarf',   need: 145, icon: '🦋' },
  { id: 'crown',    slot: 'head',  cat: 'special', need: 100, icon: '👑' },
  { id: 'rainbow',  slot: 'fx',    cat: 'special', need: 130, icon: '🌈' },
  { id: 'gold',     slot: 'color', cat: 'special', need: 160, icon: '✨' },
  { id: 'wings',    slot: 'back',  cat: 'special', need: 170, icon: '🪽' },
  { id: 'hearts',   slot: 'fx',    cat: 'special', need: 185, icon: '💕' },
];
const LOOK_CATS = ['bow', 'tube', 'hat', 'glasses', 'scarf', 'special'];
const HAT_IDS = ['hat', 'crown', 'santa', 'party', 'cap', 'beanie', 'propeller'];   // 쓰면 머리 깃털을 숨기는 것
const totalStars = () => Object.values(save.missions || {}).reduce((a, m) => a + starCount(m), 0);
// 테스트 모드: 꾸미기 전부 열기. 주소 뒤에 ?unlock=1 → 켜짐, ?unlock=0 → 꺼짐 (이 브라우저에 저장됨). 별 기록은 그대로
let TEST_UNLOCK = false;
try {
  if (!DEV_BUILD) throw 0;   // 출시 앱(안드로이드)에서는 테스트 모드 없음
  const q = new URLSearchParams(location.search).get('unlock');
  if (q === '1') localStorage.setItem('duckwaterway.unlockAll', '1');
  if (q === '0') localStorage.removeItem('duckwaterway.unlockAll');
  TEST_UNLOCK = localStorage.getItem('duckwaterway.unlockAll') === '1';
} catch (e) {}
const lookUnlocked = l => TEST_UNLOCK || totalStars() >= l.need || !!(save.looksBought && save.looksBought[l.id]);
const lookPrice = l => Math.max(20, Math.round(l.need * 0.8 / 5) * 5);   // 🪙 별이 모자랄 때 코인으로 바로 사기 (별 1개 ≈ 코인 0.8개)
const lookBuyable = l => l.slot !== 'home';   // 꾸며진 내 집은 엔딩 보상이라 별로만
const rainbowMats = [0xff6b6b, 0xffa94d, 0xffe066, 0x69db7c, 0x4dabf7, 0xb197fc].map(c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95 }));
let rainbowI = 0;
const heartFxMats = [0xff4f8b, 0xff8fb8, 0xffc2d8, 0xe64980].map(c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95 }));

// 튜브: 빨강·흰색 줄무늬 (구명 튜브 느낌)
const tubeTex = canvasTex(128, 16, (g, w, h) => {
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#e8323c'; g.fillRect(i * 16, 0, 16, h); }
});
// 하늘색 땡땡이 튜브
const dotTex = canvasTex(128, 32, (g, w, h) => {
  g.fillStyle = '#4dabf7'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff';
  for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { g.beginPath(); g.arc(i * 16 + 8 + j * 8, j * 16 + 8, 4, 0, Math.PI * 2); g.fill(); }
});
// 고깔모자 줄무늬 (분홍·하늘)
const partyTex = canvasTex(16, 64, (g, w, h) => {
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#74c0fc' : '#ff6b9a'; g.fillRect(0, i * 8, w, 8); }
});
// 하트 안경 렌즈 모양
const mintTex = canvasTex(128, 16, (g, w, h) => {   // 민트 줄무늬 튜브
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#38d9a9'; g.fillRect(i * 16, 0, 16, h); }
});
const starGeo = (() => {   // ⭐ 다섯 꼭지 별 (머리핀·별 안경)
  const s = new THREE.Shape();
  for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 0.45 : 1; k ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false });
  geo.center(); geo.userData.keep = true;
  return geo;
})();
const heartGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, -0.9);
  s.bezierCurveTo(-0.2, -0.6, -1, -0.2, -1, 0.35);
  s.bezierCurveTo(-1, 0.85, -0.45, 1.05, 0, 0.6);
  s.bezierCurveTo(0.45, 1.05, 1, 0.85, 1, 0.35);
  s.bezierCurveTo(1, -0.2, 0.2, -0.6, 0, -0.9);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false, curveSegments: 10 });
  geo.center(); geo.userData.keep = true;
  return geo;
})();
function makeAccessory(id) {
  const g = new THREE.Group();
  const M = c => toon(c);
  if (id === 'bow') {
    addOutlined(g, sphLow, M(0xff7fa0), V(-0.11, 1.07, -0.14), V(0.11, 0.07, 0.05));
    addOutlined(g, sphLow, M(0xff7fa0), V(0.11, 1.07, -0.14), V(0.11, 0.07, 0.05));
    addOutlined(g, sphLow, M(0xff5f88), V(0, 1.07, -0.14), V(0.05, 0.05, 0.05));
  } else if (id === 'tube') {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.13, 12, 28), new THREE.MeshToonMaterial({ map: tubeTex, gradientMap: gradTex }));
    m.rotation.x = Math.PI / 2; m.position.y = 0.2; g.add(m);
    const o = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.15, 12, 28), outlineMat); o.rotation.x = Math.PI / 2; o.position.y = 0.2; g.add(o);
  } else if (id === 'hat') {
    // 머리 꼭대기에 딱 맞게 씌우고, 머리 위를 기준으로 살짝 기울임. 진한 윤곽 + 남색 띠로 노란 오리와 구분
    const hat = new THREE.Group(); hat.position.set(0, 0.98, -0.2); hat.rotation.set(-0.08, 0, 0.16); g.add(hat);
    const straw = M(0xe8c27a), E = 0.045;
    addOutlined(hat, new THREE.CylinderGeometry(1, 1, 1, 24), straw, V(0, 0, 0), V(0.46, 0.035, 0.46), true, E);           // 챙
    addOutlined(hat, new THREE.CylinderGeometry(0.82, 1, 1, 24), straw, V(0, 0.12, 0), V(0.24, 0.21, 0.24), true, E);      // 모자 몸통
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24), M(0x3b5bdb)); band.position.set(0, 0.06, 0); band.scale.set(0.245, 0.07, 0.245); hat.add(band);
    addOutlined(hat, sphLow, M(0xff7fa0), V(0.2, 0.07, -0.13), V(0.06, 0.06, 0.04), true, 0.02);                            // 띠에 꽃 장식
  } else if (id === 'glasses') {
    const dark = new THREE.MeshBasicMaterial({ color: 0x1e1e2a });
    for (const sx of [-1, 1]) {
      const lens = new THREE.Mesh(sphLow, dark); lens.scale.set(0.095, 0.075, 0.03); lens.position.set(sx * 0.135, 0.79, -0.515); lens.rotation.y = sx * -0.35; g.add(lens);
      const shine = new THREE.Mesh(sphLow, shineMat); shine.scale.set(0.025, 0.015, 0.01); shine.position.set(sx * 0.135 - 0.03, 0.81, -0.545); g.add(shine);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), dark); bridge.position.set(0, 0.8, -0.535); g.add(bridge);
  } else if (id === 'scarf') {
    addOutlined(g, new THREE.TorusGeometry(1, 0.32, 10, 24), M(0xff6b6b), V(0, 0.5, -0.12), V(0.27, 0.27, 0.22)).rotation.x = Math.PI / 2;
    const tail = addOutlined(g, new THREE.BoxGeometry(1, 1, 1), M(0xff6b6b), V(0.14, 0.38, -0.32), V(0.1, 0.22, 0.04));
    tail.rotation.z = 0.25;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M(0xffffff)); stripe.scale.set(0.105, 0.035, 0.045); stripe.position.set(0.12, 0.31, -0.32); stripe.rotation.z = 0.25; g.add(stripe);
  } else if (id === 'crown') {
    // 진한 주황빛 금색 + 빨간 벨벳 + 진한 윤곽. 머리 꼭대기에 얹고 그 자리 기준으로 살짝 기울임
    const crown = new THREE.Group(); crown.position.set(0, 1.0, -0.2); crown.rotation.z = -0.14; g.add(crown);
    const gold = M(0xffa21a), E = 0.04;
    addOutlined(crown, sphLow, M(0xd6336c), V(0, 0.06, 0), V(0.19, 0.12, 0.19), true, E);                                // 벨벳
    addOutlined(crown, new THREE.CylinderGeometry(1, 0.92, 1, 16, 1, true), gold, V(0, 0.05, 0), V(0.235, 0.14, 0.235), true, E);   // 테
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.028, 8, 24), M(0xfff0b3)); rim.rotation.x = Math.PI / 2; rim.position.y = -0.015; crown.add(rim);
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * Math.PI * 2;
      addOutlined(crown, new THREE.ConeGeometry(1, 1, 6), gold, V(Math.sin(a) * 0.225, 0.17, Math.cos(a) * 0.225), V(0.055, 0.13, 0.055), true, 0.03);
      addOutlined(crown, sphLow, M(0xfff0b3), V(Math.sin(a) * 0.225, 0.25, Math.cos(a) * 0.225), V(0.035, 0.035, 0.035), true, 0.02);
      addOutlined(crown, sphLow, M([0xff3b6b, 0x2f9bff, 0x2fc96a][k % 3]), V(Math.sin(a) * 0.24, 0.05, Math.cos(a) * 0.24), V(0.035, 0.035, 0.02), false);
    }
  } else if (id === 'bowblue') {
    // 하늘색 큰 리본 + 흰 땡땡이, 머리 위에서 살짝 옆으로 기울임
    const b = new THREE.Group(); b.position.set(0.06, 1.07, -0.14); b.rotation.z = -0.25; g.add(b);
    const blue = M(0x4dabf7), dot = M(0xffffff);
    for (const sx of [-1, 1]) {
      addOutlined(b, sphLow, blue, V(sx * 0.13, 0, 0), V(0.13, 0.085, 0.055));
      for (const [dx, dy] of [[0.07, 0.03], [0.14, -0.03], [0.17, 0.035]]) {
        const d = new THREE.Mesh(sphLow, dot); d.scale.set(0.022, 0.022, 0.012); d.position.set(sx * dx, dy, -0.05); b.add(d);
      }
    }
    addOutlined(b, sphLow, M(0x1c7ed6), V(0, 0, 0), V(0.055, 0.055, 0.055));
  } else if (id === 'flower') {
    // 데이지 꽃핀: 머리 오른쪽 위에 위로 향하게
    const f = new THREE.Group(); f.position.set(0.17, 1.02, -0.2); f.rotation.set(-0.35, 0, -0.35); g.add(f);
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2;
      const p = addOutlined(f, sphLow, M(0xffffff), V(Math.cos(a) * 0.075, 0, Math.sin(a) * 0.075), V(0.055, 0.022, 0.032), true, 0.02);
      p.rotation.y = -a;
    }
    addOutlined(f, sphLow, M(0xff9f1c), V(0, 0.012, 0), V(0.045, 0.03, 0.045), true, 0.02);
  } else if (id === 'tubedot') {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.13, 12, 28), new THREE.MeshToonMaterial({ map: dotTex, gradientMap: gradTex }));
    m.rotation.x = Math.PI / 2; m.position.y = 0.2; g.add(m);
    const o = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.15, 12, 28), outlineMat); o.rotation.x = Math.PI / 2; o.position.y = 0.2; g.add(o);
  } else if (id === 'donut') {
    // 도넛 튜브: 빵 + 분홍 크림 + 알록달록 스프링클
    const base = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.13, 12, 28), M(0xd9984f)); base.rotation.x = Math.PI / 2; base.position.y = 0.2; g.add(base);
    const o = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.15, 12, 28), outlineMat); o.rotation.x = Math.PI / 2; o.position.y = 0.2; g.add(o);
    const ice = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.115, 12, 28), M(0xff8fb8)); ice.rotation.x = Math.PI / 2; ice.position.y = 0.245; g.add(ice);
    const cols = [0xffffff, 0x4dabf7, 0xffe066, 0x69db7c, 0xb197fc];
    for (let k = 0; k < 18; k++) {
      const a = k / 18 * Math.PI * 2 + (k % 3) * 0.12, r = 0.44 + ((k * 7) % 5 - 2) * 0.03;
      const sp = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M(cols[k % cols.length]));
      sp.scale.set(0.05, 0.016, 0.016); sp.position.set(Math.cos(a) * r, 0.345, Math.sin(a) * r); sp.rotation.y = k * 1.3; g.add(sp);
    }
  } else if (id === 'santa') {
    // 빨간 산타 모자: 흰 털 테두리 + 옆으로 축 처진 끝 + 흰 방울
    const h = new THREE.Group(); h.position.set(0, 1.0, -0.19); h.rotation.set(-0.1, 0, 0.1); g.add(h);
    const red = M(0xe03131), fur = M(0xffffff);
    addOutlined(h, new THREE.CylinderGeometry(0.62, 1, 1, 20), red, V(0, 0.16, 0), V(0.23, 0.27, 0.23), true, 0.04);
    const tip = new THREE.Group(); tip.position.set(0, 0.28, 0); tip.rotation.z = -1.05; h.add(tip);
    addOutlined(tip, new THREE.ConeGeometry(1, 1, 18), red, V(0, 0.12, 0), V(0.145, 0.27, 0.145), true, 0.035);
    addOutlined(tip, sphLow, fur, V(0, 0.27, 0), V(0.075, 0.075, 0.075), true, 0.03);
    addOutlined(h, new THREE.TorusGeometry(1, 0.28, 10, 24), fur, V(0, 0.03, 0), V(0.245, 0.245, 0.24), true, 0.035).rotation.x = Math.PI / 2;
  } else if (id === 'party') {
    // 줄무늬 고깔모자 + 방울, 살짝 옆으로 비스듬히
    const h = new THREE.Group(); h.position.set(0.04, 1.0, -0.2); h.rotation.z = -0.22; g.add(h);
    addOutlined(h, new THREE.ConeGeometry(1, 1, 18), new THREE.MeshToonMaterial({ map: partyTex, gradientMap: gradTex }), V(0, 0.18, 0), V(0.16, 0.38, 0.16), true, 0.04);
    addOutlined(h, sphLow, M(0xffe066), V(0, 0.4, 0), V(0.065, 0.065, 0.065), true, 0.03);
    addOutlined(h, new THREE.TorusGeometry(1, 0.35, 8, 20), M(0xffffff), V(0, 0, 0), V(0.16, 0.16, 0.12), true, 0.03).rotation.x = Math.PI / 2;
  } else if (id === 'round') {
    // 동그란 갈색 테 안경 + 살짝 비치는 렌즈
    const frame = M(0x6b4226), lensM = new THREE.MeshBasicMaterial({ color: 0xd8f1ff, transparent: true, opacity: 0.45 });
    for (const sx of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.016, 8, 20), frame); ring.position.set(sx * 0.135, 0.79, -0.52); ring.rotation.y = sx * -0.35; g.add(ring);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.075, 18), lensM); lens.position.set(sx * 0.135, 0.79, -0.525); lens.rotation.y = Math.PI + sx * -0.35; g.add(lens);
      const shine = new THREE.Mesh(sphLow, shineMat); shine.scale.set(0.022, 0.013, 0.01); shine.position.set(sx * 0.135 - 0.03, 0.815, -0.545); g.add(shine);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), frame); bridge.position.set(0, 0.8, -0.54); g.add(bridge);
  } else if (id === 'heartgl') {
    // 분홍 하트 안경
    const pink = new THREE.MeshBasicMaterial({ color: 0xff4f8b });
    for (const sx of [-1, 1]) {
      const hm = addOutlined(g, heartGeo, pink, V(sx * 0.14, 0.79, -0.52), V(0.1, 0.1, 0.1), true, 0.03);
      hm.rotation.y = sx * -0.35;
      const shine = new THREE.Mesh(sphLow, shineMat); shine.scale.set(0.022, 0.015, 0.01); shine.position.set(sx * 0.14 - 0.035, 0.815, -0.55); g.add(shine);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), M(0xd6336c)); bridge.position.set(0, 0.8, -0.54); g.add(bridge);
  } else if (id === 'bell') {
    // 빨간 방울 목걸이
    addOutlined(g, new THREE.TorusGeometry(1, 0.13, 8, 24), M(0xe03131), V(0, 0.5, -0.12), V(0.27, 0.27, 0.22)).rotation.x = Math.PI / 2;
    addOutlined(g, sphLow, M(0xffc61a), V(0, 0.45, -0.47), V(0.085, 0.085, 0.085), true, 0.03);
    const slit = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x5a3a10 }));
    slit.scale.set(0.08, 0.014, 0.02); slit.position.set(0, 0.43, -0.55); g.add(slit);
    const shine = new THREE.Mesh(sphLow, shineMat); shine.scale.set(0.02, 0.02, 0.01); shine.position.set(-0.03, 0.48, -0.545); g.add(shine);
  } else if (id === 'bowtie') {
    // 파란 땡땡이 나비넥타이
    const t = new THREE.Group(); t.position.set(0, 0.46, -0.36); g.add(t);
    const blue = M(0x4c6ef5);
    for (const sx of [-1, 1]) {
      const w = addOutlined(t, new THREE.ConeGeometry(1, 1, 4), blue, V(sx * 0.08, 0, 0), V(0.075, 0.13, 0.04), true, 0.03);
      w.rotation.z = sx * Math.PI / 2;
      const d = new THREE.Mesh(sphLow, M(0xffffff)); d.scale.set(0.018, 0.018, 0.01); d.position.set(sx * 0.1, 0.015, -0.035); t.add(d);
    }
    addOutlined(t, sphLow, M(0x364fc7), V(0, 0, -0.005), V(0.038, 0.04, 0.035), true, 0.025);
  } else if (id === 'heartpin') {
    // 빨간 하트 머리핀: 머리 오른쪽 위
    const f = new THREE.Group(); f.position.set(0.17, 1.03, -0.2); f.rotation.set(-0.2, 0.3, -0.4); g.add(f);
    addOutlined(f, heartGeo, M(0xf03e3e), V(0, 0, 0), V(0.09, 0.09, 0.09), true, 0.03);
    const sh = new THREE.Mesh(sphLow, shineMat); sh.scale.set(0.02, 0.014, 0.01); sh.position.set(-0.035, 0.03, -0.03); f.add(sh);
  } else if (id === 'starpin') {
    // 노란 별 머리핀
    const f = new THREE.Group(); f.position.set(0.16, 1.04, -0.2); f.rotation.set(-0.2, 0.3, -0.35); g.add(f);
    addOutlined(f, starGeo, M(0xffd43b), V(0, 0, 0), V(0.1, 0.1, 0.1), true, 0.03);
  } else if (id === 'cherry') {
    // 체리 머리핀: 빨간 열매 두 개 + 초록 꼭지 + 잎
    const f = new THREE.Group(); f.position.set(0.15, 1.02, -0.18); f.rotation.z = -0.35; g.add(f);
    for (const sx of [-1, 1]) {
      addOutlined(f, sphLow, M(0xe03131), V(sx * 0.06, 0, 0), V(0.055, 0.055, 0.055), true, 0.025);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.13, 5), M(0x2f9e44)); st.position.set(sx * 0.03, 0.08, 0); st.rotation.z = -sx * 0.45; f.add(st);
    }
    addOutlined(f, sphLow, M(0x51cf66), V(0.04, 0.15, 0), V(0.05, 0.02, 0.03), true, 0.02).rotation.z = 0.5;
  } else if (id === 'tubemint') {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.13, 12, 28), new THREE.MeshToonMaterial({ map: mintTex, gradientMap: gradTex }));
    m.rotation.x = Math.PI / 2; m.position.y = 0.2; g.add(m);
    const o = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.15, 12, 28), outlineMat); o.rotation.x = Math.PI / 2; o.position.y = 0.2; g.add(o);
  } else if (id === 'melon') {
    // 수박 튜브: 초록 껍질 + 빨간 속 + 까만 씨
    const rind = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.13, 12, 28), M(0x2b8a3e)); rind.rotation.x = Math.PI / 2; rind.position.y = 0.2; g.add(rind);
    const o = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.15, 12, 28), outlineMat); o.rotation.x = Math.PI / 2; o.position.y = 0.2; g.add(o);
    const white = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.118, 12, 28), M(0xe9fac8)); white.rotation.x = Math.PI / 2; white.position.y = 0.235; g.add(white);
    const red = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.1, 12, 28), M(0xff6b6b)); red.rotation.x = Math.PI / 2; red.position.y = 0.26; g.add(red);
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2 + (k % 2) * 0.2, r = 0.44 + (k % 3 - 1) * 0.045;
      const sd = new THREE.Mesh(sphLow, M(0x212529)); sd.scale.set(0.022, 0.012, 0.014); sd.position.set(Math.cos(a) * r, 0.355, Math.sin(a) * r); sd.rotation.y = -a; g.add(sd);
    }
  } else if (id === 'float') {
    // 무지개 튜브: 여섯 가지 색 조각
    const cols = [0xff6b6b, 0xffa94d, 0xffe066, 0x69db7c, 0x4dabf7, 0xb197fc];
    for (let k = 0; k < 6; k++) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.13, 12, 6, Math.PI / 3 + 0.01), M(cols[k]));
      m.rotation.set(Math.PI / 2, 0, k * Math.PI / 3); m.position.y = 0.2; g.add(m);
    }
    const o = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.15, 12, 28), outlineMat); o.rotation.x = Math.PI / 2; o.position.y = 0.2; g.add(o);
  } else if (id === 'cap') {
    // 파란 야구 모자: 챙은 앞(부리 쪽)으로
    const h = new THREE.Group(); h.position.set(0, 0.97, -0.2); h.rotation.x = -0.12; g.add(h);
    addOutlined(h, new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M(0x1c7ed6), V(0, 0, 0), V(0.25, 0.2, 0.25), true, 0.04);
    addOutlined(h, new THREE.CylinderGeometry(1, 1, 1, 20, 1, false, -Math.PI / 2, Math.PI), M(0x1864ab), V(0, 0.01, -0.12), V(0.22, 0.025, 0.24), true, 0.035);
    addOutlined(h, sphLow, M(0xffffff), V(0, 0.2, 0), V(0.035, 0.025, 0.035), true, 0.02);
    const badge = new THREE.Mesh(sphLow, M(0xffd43b)); badge.scale.set(0.06, 0.05, 0.02); badge.position.set(0, 0.1, -0.235); h.add(badge);
  } else if (id === 'beanie') {
    // 털실 비니: 줄무늬 + 방울
    const h = new THREE.Group(); h.position.set(0, 0.96, -0.2); h.rotation.z = 0.08; g.add(h);
    addOutlined(h, new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M(0xf76707), V(0, 0, 0), V(0.25, 0.26, 0.25), true, 0.04);
    for (const [y, r] of [[0.1, 0.235], [0.18, 0.19]]) { const st = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 6, 22), M(0xffffff)); st.rotation.x = Math.PI / 2; st.position.y = y; h.add(st); }
    addOutlined(h, new THREE.TorusGeometry(1, 0.35, 8, 22), M(0xd9480f), V(0, 0.01, 0), V(0.25, 0.25, 0.22), true, 0.03).rotation.x = Math.PI / 2;
    addOutlined(h, sphLow, M(0xffffff), V(0, 0.29, 0), V(0.075, 0.075, 0.075), true, 0.03);
  } else if (id === 'propeller') {
    // 🚁 프로펠러 헬멧: 분홍 헬멧 + 까만 테두리·끈 + 꼭대기에서 빙글빙글 도는 노란 프로펠러
    // 앞쪽을 살짝 들어 올려(뒤로 기울여) 안경과 겹치지 않게
    const h = new THREE.Group(); h.position.set(0, 0.88, -0.19); h.rotation.x = 0.3; g.add(h);
    // 🌈 빨주노초파남보 조각이 옆으로 빙 둘러 (비치볼처럼)
    const RB = [0xff4d4d, 0xff9f1c, 0xffe14d, 0x51cf66, 0x339af0, 0x3b5bdb, 0x9c5de6];
    for (let k = 0; k < 7; k++) { const seg = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 12, k * Math.PI * 2 / 7, Math.PI * 2 / 7, 0, Math.PI / 2), toon(RB[k])); seg.scale.setScalar(0.34); h.add(seg); }
    const hol = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), outlineMat); hol.scale.setScalar(0.355); h.add(hol);   // 윤곽선
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 8, 30), M(0x2b2b33)); rim.rotation.x = Math.PI / 2; h.add(rim);   // 까만 테두리
    for (const sx of [-1, 1]) {
      const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.34, 6), M(0x2b2b33));   // 턱끈
      strap.position.set(sx * 0.29, -0.13, -0.08); strap.rotation.set(0.45, 0, sx * -0.25); h.add(strap);
      const bolt = new THREE.Mesh(sphLow, M(0xced4da)); bolt.scale.setScalar(0.03); bolt.position.set(sx * 0.335, 0.03, 0); h.add(bolt);
    }
    const top = new THREE.Mesh(sphLow, M(0x7a4a2a)); top.scale.set(0.07, 0.03, 0.05); top.position.set(0.03, 0.335, -0.06); h.add(top);   // 꼭대기 갈색 점
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8), M(0xdee2e6)); post.position.y = 0.43; h.add(post);
    const prop = new THREE.Group(); prop.position.y = 0.54; h.add(prop);
    addOutlined(prop, sphLow, M(0xffd43b), V(0, 0, 0), V(0.045, 0.035, 0.045), true, 0.02);
    for (const sx of [-1, 1]) { const bl = addOutlined(prop, sphLow, M(0xffe066), V(sx * 0.2, 0, 0), V(0.19, 0.012, 0.05), true, 0.02); bl.rotation.x = sx * 0.3; }
    g.userData.prop = prop;
  } else if (id === 'goggles') {
    // 수경: 하늘색 렌즈 + 노란 끈
    const rim = M(0x343a40), lensM = new THREE.MeshBasicMaterial({ color: 0x74c0fc, transparent: true, opacity: 0.75 });
    for (const sx of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.025, 8, 20), rim); ring.position.set(sx * 0.135, 0.79, -0.52); ring.rotation.y = sx * -0.35; g.add(ring);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.08, 18), lensM); lens.position.set(sx * 0.135, 0.79, -0.53); lens.rotation.y = Math.PI + sx * -0.35; g.add(lens);
      const shine = new THREE.Mesh(sphLow, shineMat); shine.scale.set(0.025, 0.015, 0.01); shine.position.set(sx * 0.135 - 0.03, 0.815, -0.55); g.add(shine);
    }
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.022, 6, 30), M(0xfcc419)); strap.position.set(0, 0.8, -0.22); strap.rotation.x = Math.PI / 2; strap.scale.set(1, 1.05, 1); g.add(strap);
  } else if (id === 'stargl') {
    // 별 모양 노란 안경
    for (const sx of [-1, 1]) {
      const sm = addOutlined(g, starGeo, new THREE.MeshBasicMaterial({ color: 0xffd43b }), V(sx * 0.14, 0.79, -0.52), V(0.11, 0.11, 0.1), true, 0.03);
      sm.rotation.y = sx * -0.35;
      const shine = new THREE.Mesh(sphLow, shineMat); shine.scale.set(0.022, 0.015, 0.01); shine.position.set(sx * 0.14 - 0.03, 0.815, -0.55); g.add(shine);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), M(0xf59f00)); bridge.position.set(0, 0.8, -0.54); g.add(bridge);
  } else if (id === 'nerd') {
    // 두꺼운 까만 네모 안경
    const blk = new THREE.MeshBasicMaterial({ color: 0x1e1e2a }), lensM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
    for (const sx of [-1, 1]) {
      const e = new THREE.Group(); e.position.set(sx * 0.135, 0.79, -0.52); e.rotation.y = sx * -0.35; g.add(e);
      for (const [x, y, w, h] of [[0, 0.065, 0.19, 0.032], [0, -0.065, 0.19, 0.032], [0.08, 0, 0.032, 0.16], [-0.08, 0, 0.032, 0.16]]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), blk); b.position.set(x, y, 0); e.add(b);
      }
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.11), lensM); lens.position.z = -0.005; lens.rotation.y = Math.PI; e.add(lens);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.03), blk); bridge.position.set(0, 0.81, -0.54); g.add(bridge);
  } else if (id === 'tie') {
    // 빨간 넥타이: 목 매듭 + 가슴으로 내려오는 넓은 끝
    const red = M(0xe03131);
    addOutlined(g, new THREE.TorusGeometry(1, 0.12, 8, 24), M(0xffffff), V(0, 0.5, -0.12), V(0.27, 0.27, 0.22)).rotation.x = Math.PI / 2;   // 하얀 셔츠 깃
    addOutlined(g, new THREE.BoxGeometry(1, 1, 1), red, V(0, 0.46, -0.4), V(0.07, 0.06, 0.05), true, 0.025);
    const tl = addOutlined(g, new THREE.ConeGeometry(1, 1, 4), red, V(0, 0.3, -0.43), V(0.075, 0.26, 0.03), true, 0.025);
    tl.rotation.set(-0.35, Math.PI / 4, Math.PI);
    const st = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M(0xffe066)); st.scale.set(0.09, 0.018, 0.035); st.position.set(0, 0.3, -0.455); st.rotation.set(-0.35, 0, 0.5); g.add(st);
  } else if (id === 'pearl') {
    // 진주 목걸이
    for (let k = 0; k < 22; k++) {
      const a = k / 22 * Math.PI * 2;
      const p = new THREE.Mesh(sphLow, M(0xfff8f0)); p.scale.setScalar(0.04); p.position.set(Math.sin(a) * 0.29, 0.5 - Math.max(0, -Math.cos(a)) * 0.06, -0.12 + Math.cos(a) * -0.25); g.add(p);
    }
    addOutlined(g, sphLow, M(0xffc9de), V(0, 0.42, -0.4), V(0.055, 0.055, 0.05), true, 0.02);
  } else if (id === 'lei') {
    // 하와이 꽃목걸이: 알록달록 꽃이 목을 빙 둘러
    const cols = [0xff6b9d, 0xffd43b, 0xb197fc, 0xff8787, 0x63e6be];
    for (let k = 0; k < 14; k++) {
      const a = k / 14 * Math.PI * 2, x = Math.sin(a) * 0.3, z = -0.12 + Math.cos(a) * -0.26, y = 0.5 - Math.max(0, -Math.cos(a)) * 0.05;
      const fl = new THREE.Group(); fl.position.set(x, y, z); fl.lookAt(x * 3, y, z * 3 + 0.24); g.add(fl);
      for (let q = 0; q < 5; q++) { const b = q / 5 * Math.PI * 2; addOutlined(fl, sphLow, M(cols[k % cols.length]), V(Math.cos(b) * 0.04, Math.sin(b) * 0.04, 0), V(0.035, 0.035, 0.02), q === 0, 0.015); }
      const c = new THREE.Mesh(sphLow, M(0xfff3bf)); c.scale.setScalar(0.022); c.position.z = 0.01; fl.add(c);
    }
  } else if (id === 'wings') {
    g.userData.wings = [];
    // 🪽 등 뒤 하얀 천사 날개 (깃털 세 겹)
    for (const sx of [-1, 1]) {
      const w = new THREE.Group(); w.position.set(sx * 0.13, 0.46, 0.25);   // 날개 뿌리가 등(몸통 위쪽 뒤) 표면에 붙게
      w.rotation.set(0.35, sx * -0.5, sx * 0.55); g.add(w); g.userData.wings.push({ w, sx });   // 날개 끝이 위·뒤로 향하게
      for (let k = 0; k < 3; k++) addOutlined(w, sphLow, M(k ? 0xf8f9fa : 0xffffff), V(sx * (0.12 + k * 0.1), 0.02 + k * 0.07, 0), V(0.2 - k * 0.04, 0.1 - k * 0.015, 0.035), true, 0.025);   // 바깥쪽 깃털일수록 위로
    }
  }
  return g;
}
// 지금 착용 중인 꾸미기를 플레이어 오리에 입힘 (황금 오리는 오리를 새로 만듦)
function applyLook() {
  const gold = save.equip.color === 'gold' && lookUnlocked(LOOKS.find(l => l.id === 'gold'));
  if (!!duck.userData.gold !== gold) {
    const sc = duck.scale.x, pos = duck.position.clone(), rot = duck.rotation.clone(), vis = duck.visible;
    scene.remove(duck);
    duck = gold ? makeDuck({ scale: 1, body: 0xe39b17, wing: 0xb87708, bill: 0xff6f1a }) : makeDuck({ scale: 1 });   // 황금 오리: 진한 호박색 금빛
    duck.userData.gold = gold;
    duck.scale.setScalar(sc); duck.position.copy(pos); duck.rotation.copy(rot); duck.visible = vis;
    scene.add(duck);
  }
  const bob = duck.userData.bob;
  if (duck.userData.acc) bob.remove(duck.userData.acc);
  const acc = new THREE.Group();
  for (const slot of ['head', 'body', 'face', 'neck', 'back']) {
    const id = save.equip[slot], l = LOOKS.find(x => x.id === id);
    if (l && lookUnlocked(l)) acc.add(makeAccessory(id));
  }
  bob.add(acc); duck.userData.acc = acc;
  duck.userData.prop = (acc.children.find(c => c.userData.prop) || { userData: {} }).userData.prop || null;
  duck.userData.angel = (acc.children.find(c => c.userData.wings) || { userData: {} }).userData.wings || null;   // 🪽 천사 날개 (살랑살랑 펄럭임)   // 🚁 프로펠러 (매 프레임 회전)
  const hatOn = HAT_IDS.includes(save.equip.head) && lookUnlocked(LOOKS.find(l => l.id === save.equip.head));
  for (const tf of duck.userData.tufts) tf.visible = !hatOn;   // 모자·왕관을 쓰면 머리 깃털이 삐져나오지 않게
}
function lookName(l) { return t('look_' + l.id); }
// 오리 성장: 10레벨마다 한 단계씩 커짐 (1~10: 아기 오리 크기 → 51~60: 다 자란 크기)
const growStage = n => Math.min(5, Math.floor((n - 1) / 10));
const growScale = n => 0.62 + (1.25 - 0.62) * growStage(n) / 5;
const P = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, idx: 0, lat: 0, prog: 0, yaw: 0, roll: 0, spin: 0 };
let elapsed = 0, timeT = 0, splashT = 0, countT = 0, lastBump = 0, celebrateT = 0;
let hearts = MAX_HEARTS_BASE, shieldT = 0;
const camF = { x: 0, z: -1 };   // 카메라 앞 방향(고정: 북쪽) → 조작 기준
const inGame = () => ['countdown', 'playing', 'paused', 'falling', 'respawning', 'win', 'failed'].includes(state);

function loadLevel(i) {
  if (world) {
    scene.remove(world.group);
    world.group.traverse(o => { if (o.geometry && o.geometry !== sph && o.geometry !== sphLow && !o.geometry.userData.keep) o.geometry.dispose(); });
  }
  levelIdx = i; titleScene = false; clearTitleSky(); suspended = null; iceberg = null; iceT = 6;
  world = buildLevelWorld(LEVELS[i]);
  world.missions = missionsFor(i + 1, world);
  duck.scale.setScalar(growScale(LEVELS[i].race ? LEVELS[i].no : i + 1));
  scene.add(world.group);
  placeShopDecor(world);   // 🛍️ 마지막 레벨: 상점에서 산 물건들
  resetDuck();
}

// 첫 화면: 출발점 대신, 레벨 1 도착 연못에서 엄마·아기 오리들과 함께 있는 모습
let titleScene = false;
function showTitleScene() {
  if (titleScene && world) return;   // 이미 첫 화면 연못이면 그대로
  loadLevel(0);
  const c = world.pondC, m = world.family[0] ? world.family[0].duck.position : c;
  let ux = m.x - c.x, uz = m.z - c.z; const L = Math.hypot(ux, uz) || 1; ux /= L; uz /= L;   // 연못 가운데 → 엄마 방향
  titleDir = { x: -ux, z: -uz };                                                           // 카메라는 반대쪽(가족 정면)
  // 엄마 바로 옆, 아기들 사이에 서서 카메라 쪽을 봄
  Object.assign(P, { x: c.x + ux * (L - 0.6) - uz * 0.95, y: c.y, z: c.z + uz * (L - 0.6) + ux * 0.95, vx: 0, vy: 0, vz: 0 });
  P.yaw = Math.atan2(ux, uz);
  duck.position.set(P.x, P.y, P.z); duck.rotation.set(0, P.yaw, 0);
  // 게임 중에 찾는 아기 오리(하트 표시) 4마리: 카메라 쪽 앞 물가(START 버튼 위 빈자리)에
  titleKids = [];
  for (let j = 0; j < 4; j++) {
    const side = (j - 1.5) * 0.85, fwd = 0.5 + (j % 2) * 0.45;
    const d = makeDuck({ scale: 0.55 * 0.7 });   // 게임 속 아기 오리의 70% 크기
    d.position.set(c.x + titleDir.x * fwd - titleDir.z * side, c.y, c.z + titleDir.z * fwd + titleDir.x * side);
    d.rotation.y = Math.atan2(-titleDir.x, -titleDir.z) + Math.PI;   // 카메라 쪽을 봄
    const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }));
    mark.scale.setScalar(0.45); mark.position.set(0, 1.9, 0); d.add(mark);
    d.userData.mark = mark; d.userData.ph = j * 1.3; d.userData.ki = j;
    world.group.add(d); titleKids.push(d);
  }
  // 오리마다 기준 자리 + 천천히 돌아다닐 궤적(서로 다른 속도·크기)
  const ducks = [...world.family.map(f => f.duck), duck, ...titleKids];
  titleWander = ducks.map((d, k) => ({ d, hx: d.position.x, hz: d.position.z, y: d.position.y,
    ax: 0.55 + (k % 3) * 0.15, az: 0.35 + ((k + 1) % 3) * 0.12, w1: 0.16 + k * 0.025, w2: 0.11 + ((k * 7) % 5) * 0.02, ph: k * 1.7, yaw: d.rotation.y, player: d === duck, kid: titleKids.includes(d), ki: d.userData.ki, mom: !!(world.family[0] && d === world.family[0].duck) }));
  titleScene = true; titleSel = 0; titleDrag = null;
  titleRing = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9 }));
  titleRing.rotation.x = Math.PI / 2; titleRing.visible = false; world.group.add(titleRing);   // 오리를 누르면 발밑에 노란 고리
  titleCam(); camera.position.copy(camTarget); lookCur.copy(lookTarget); camera.lookAt(lookCur);
  setupTitleSky();
}
let titleDir = { x: 0, z: 1 }, titleWander = [], titleKids = [];
// 첫 화면 오리들: 각자 자리 근처를 8자 모양으로 천천히 헤엄치며 가는 쪽을 바라봄
function wanderTitleDucks(dt) {
  const t = elapsed;
  for (const d of titleKids) {   // 아기 오리: 말랑말랑 + 하트 둥실
    cuteIdle(d, dt, elapsed + d.userData.ph);
    d.userData.mark.position.y = 1.9 + Math.sin(elapsed * 3 + d.userData.ph) * 0.12;
  }
  for (const w of titleWander) {   // 각자 자리 근처 8자 궤적 쪽으로 천천히
    if (w.x === undefined) { w.x = w.d.position.x; w.z = w.d.position.z; }
    let tx = w.hx + Math.sin(t * w.w1 + w.ph) * w.ax, tz = w.hz + Math.sin(t * w.w2 * 2 + w.ph * 1.3) * w.az;
    if (w.kid) {   // 아기 오리 4마리: 화면 가운데 아래(START 위)에서 작은 타원을 따라 한 줄로 졸졸
      const u = t * 0.3 - w.ki * 0.75;
      let dx = camera.position.x - lookCur.x, dz = camera.position.z - lookCur.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const ex = lookCur.x + dx * 2.6, ez = lookCur.z + dz * 2.6, lx = -dz, lz = dx;   // 카메라가 바라보는 선 위 → 좌우로 흔들려도 화면 가운데
      tx = ex + lx * Math.cos(u) * 1.0 + dx * Math.sin(u) * 0.45;
      tz = ez + lz * Math.cos(u) * 1.0 + dz * Math.sin(u) * 0.45;
    }
    if (w.player && w.goal) {   // 🐤 눌러서 정한 곳으로 헤엄쳐 감
      tx = w.goal.x; tz = w.goal.z;
      if (!w.fast && Math.hypot(tx - w.x, tz - w.z) < 0.12) { w.hx = tx; w.hz = tz; w.ph = -t * w.w1; w.goal = null; }   // 도착하면 그 자리가 새 집
    }
    const k = damp(w.kid ? 4 : w.player && w.goal ? (w.fast ? 7 : 1.8) : 1.2, dt);
    w.px = w.x; w.pz = w.z;
    w.x += (tx - w.x) * k; w.z += (tz - w.z) * k;
  }
  for (let i = 0; i < titleWander.length; i++) for (let j = i + 1; j < titleWander.length; j++) {   // 서로 부딪히지 않게 살짝 밀어냄
    const a = titleWander[i], b = titleWander[j];
    const minD = (a.d.scale.x + b.d.scale.x) * (a.kid && b.kid ? 0.5 : 0.62);   // 아기 줄은 바짝 붙어도 됨
    let dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz) || 1e-4;
    if (d < minD) { const push = (minD - d) / 2; dx /= d; dz /= d; a.x -= dx * push; a.z -= dz * push; b.x += dx * push; b.z += dz * push; }
  }
  for (const w of titleWander) {
    const vx = w.x - w.px, vz = w.z - w.pz;
    if (w.mom) {   // 엄마 오리는 항상 앞(카메라 쪽)을 봄
      const sw = Math.sin(t * 0.32 + 0.8), look = 0.85 * Math.sign(sw) * Math.min(1, Math.abs(sw) * 2.4);   // 왼쪽·앞·오른쪽을 번갈아 두리번 (잠깐씩 멈춰서)
      let d = Math.atan2(-(camera.position.x - w.x), -(camera.position.z - w.z)) + look - w.yaw;   // 카메라 쪽 기준
      d = Math.atan2(Math.sin(d), Math.cos(d)); w.yaw += d * damp(3, dt);
    } else if (vx * vx + vz * vz > 1e-8) {   // 가는 방향을 바라봄 (얼굴은 로컬 -z)
      let d = Math.atan2(-vx, -vz) - w.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); w.yaw += d * damp(2.5, dt);
    }
    if (w.player) {
      P.x = w.x; P.z = w.z; P.yaw = w.yaw;
      w.hop = Math.max(0, (w.hop || 0) - dt);
      P.y = w.y + (w.hop > 0 ? Math.sin((1 - w.hop / 0.4) * Math.PI) * 0.4 : 0);   // 누르면 폴짝
      if (titleRing) {
        titleSel = Math.max(0, titleSel - dt);
        titleRing.visible = titleSel > 0;
        titleRing.position.set(w.x, w.y + 0.06, w.z);
        titleRing.scale.setScalar(duck.scale.x * (1 + Math.sin(elapsed * 6) * 0.08));
        titleRing.material.opacity = Math.min(1, titleSel) * 0.9;
      }
    }
    else { w.d.position.x = w.x; w.d.position.z = w.z; w.d.rotation.y = w.yaw; }
  }
}
// ---------- 💧 연못 물: 깊은 가운데 → 얕은 가장자리, 일렁이는 빛 무늬(코스틱), 잔물결, 반짝임 ----------
let world0Shore = null;
function makePondMat(theme) {
  const tint = new THREE.Color(theme === 'night' ? 0x7486c4 : theme === 'sunset' ? 0xffdccc : 0xffffff);
  const m = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, tint: { value: tint } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float time; uniform vec3 tint; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float r = length(p);
        vec3 deep = vec3(0.13, 0.45, 0.80), mid = vec3(0.27, 0.64, 0.92), shallow = vec3(0.62, 0.89, 0.99);
        vec3 col = mix(deep, mid, smoothstep(0.0, 0.62, r));
        col = mix(col, shallow, smoothstep(0.72, 1.0, r));
        col += (1.0 - smoothstep(0.0, 0.5, r)) * 0.04;   // 가운데 살짝 밝게 (하늘 반사)
        gl_FragColor = vec4(col * tint, 1.0);
      }`,
  });
  m.color = tint;   // 예전처럼 .color.setHex(...) 로 노을·밤 색을 입힐 수 있게
  return m;
}
// 첫 화면: 헤엄치는 오리마다 퍼져 나가는 물결 고리
const rippleGeo = new THREE.RingGeometry(0.34, 0.4, 36), ripplePool = [];
for (let i = 0; i < 18; i++) {
  const m = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.visible = false; m.userData.life = 0; scene.add(m); ripplePool.push(m);
}
function spawnRipple(x, y, z, s) {
  const m = ripplePool.find(q => !q.visible); if (!m) return;
  m.position.set(x, y + 0.02, z); m.visible = true; m.userData.life = 0; m.userData.s = s || 1;
}
function updatePondRipples(dt) {
  for (const m of ripplePool) {
    if (!m.visible) continue;
    const L = (m.userData.life += dt), k = L / 1.6;
    if (k >= 1 || !(state === 'title' || state === 'levels' || state === 'win' || state === 'countdown')) { m.visible = false; continue; }
    m.scale.setScalar(m.userData.s * (0.8 + k * 3.2)); m.material.opacity = 0.55 * (1 - k);
  }
  if ((state === 'title' || state === 'levels') && titleScene && world) {
    for (const w of titleWander) {
      w.rip = (w.rip || Math.random()) - dt;
      const v = w.px !== undefined ? Math.hypot(w.x - w.px, w.z - w.pz) / Math.max(dt, 1e-3) : 0;
      if (w.rip <= 0) { w.rip = v > 0.3 ? 0.45 : 1.4 + Math.random(); spawnRipple(w.x, world.pondC.y, w.z, w.d.scale.x * (w.mom ? 0.8 : 1.4)); }
    }
  }
  if (state === 'win' && world && world.pondC) {   // 🏁 도착한 연못에서도: 연못 위 오리들(나·엄마·아기들) 둘레에 물결 고리
    const c = world.pondC, ducks = [duck, ...world.family.map(f => f.duck), ...(world.babies || []).map(b => b.duck)];
    for (const d of ducks) {
      if (!d || !d.visible) continue;
      const p = d.position;
      if ((p.x - c.x) ** 2 + (p.z - c.z) ** 2 > 4.6 ** 2 || Math.abs(p.y - c.y) > 0.6) continue;
      const u = d.userData, v = u.rpx !== undefined ? Math.hypot(p.x - u.rpx, p.z - u.rpz) / Math.max(dt, 1e-3) : 0;
      u.rpx = p.x; u.rpz = p.z;
      u.rip = (u.rip === undefined ? Math.random() : u.rip) - dt;
      if (u.rip <= 0) { u.rip = v > 0.3 ? 0.45 : 1.4 + Math.random(); spawnRipple(p.x, c.y, p.z, d.scale.x * (d === duck ? 1.4 : 1.2)); }
    }
  }
}
// ---------- 🐤 첫 화면: 주인공 오리를 눌러 끌어서 옮기거나, 누른 뒤 연못을 톡 치면 그쪽으로 헤엄쳐 감 ----------
const titleRay = new THREE.Raycaster(), titlePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), titleHit = new THREE.Vector3();
let titleDrag = null, titleSel = 0, titleRing = null;
const POND_R = 4.8;
function titlePointer(e) {   // 화면 좌표 → 연못 수면 위의 점 (연못 안쪽으로 제한)
  const r = renderer.domElement.getBoundingClientRect();
  titleRay.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const c = world.pondC; titlePlane.constant = -c.y;
  if (!titleRay.ray.intersectPlane(titlePlane, titleHit)) return null;
  let dx = titleHit.x - c.x, dz = titleHit.z - c.z; const d = Math.hypot(dx, dz), R = POND_R - 0.7;
  const inPond = d <= POND_R + 0.4;
  if (d > R) { dx *= R / d; dz *= R / d; }
  return { x: c.x + dx, z: c.z + dz, inPond };
}
function duckUnderPointer(e) {   // 화면에서 주인공 오리 근처를 눌렀는지
  const r = renderer.domElement.getBoundingClientRect();
  const v = new THREE.Vector3(P.x, P.y + 0.5 * duck.scale.x, P.z).project(camera);
  const sx = (v.x + 1) / 2 * r.width + r.left, sy = (1 - v.y) / 2 * r.height + r.top;
  return Math.hypot(e.clientX - sx, e.clientY - sy) < Math.max(42, r.width * 0.1);
}
const titleMe = () => titleWander.find(w => w.player);
window.addEventListener('pointerdown', e => {
  if (state !== 'title' || !titleScene || !world || e.target.closest('button')) return;
  const me = titleMe(); if (!me) return;
  if (duckUnderPointer(e)) {   // 오리를 누름: 꽥! 하고 폴짝, 끌면 따라옴
    titleDrag = e.pointerId; titleSel = 2; me.hop = 0.4;
    Sfx.init(); Sfx.quack(1.25);
    return;
  }
  {   // 연못을 톡 치면 그쪽으로 헤엄쳐 감
    const p = titlePointer(e);
    if (p && p.inPond) {
      me.goal = p; me.fast = false; titleSel = 1.5;
      burst(p.x, world.pondC.y + 0.05, p.z, 8, 1.2, 0.06, 0.5); Sfx.splash(0.08);
    }
  }
});
// 🏁 가족에게 도착한 뒤에도: 연못을 톡 치면 그쪽으로 헤엄쳐 감 (결과창 판·버튼을 누른 건 빼고)
window.addEventListener('pointerdown', e => {
  if (state !== 'win' || !world || !world.pondC || e.target.closest('button') || e.target.closest('.panel')) return;
  const p = titlePointer(e);
  if (!p || !p.inPond) return;
  world.arrive = { x: p.x, z: p.z };
  burst(p.x, world.pondC.y + 0.05, p.z, 8, 1.2, 0.06, 0.5); Sfx.splash(0.08);
});
window.addEventListener('pointermove', e => {
  if (e.pointerId !== titleDrag || state !== 'title' || !world) return;
  const p = titlePointer(e), me = titleMe();
  if (p && me) { me.goal = p; me.fast = true; titleSel = 2; }
});
const titleDragEnd = e => { if (e.pointerId === titleDrag) { titleDrag = null; const me = titleMe(); if (me) me.fast = false; } };
window.addEventListener('pointerup', titleDragEnd); window.addEventListener('pointercancel', titleDragEnd);

// ---------- 🌅🌙 첫 화면 하늘: 실제 시각에 따라 저녁(17~20시)엔 노을, 밤(20~6시)엔 별·달이 뜬 밤바다 ----------
const titleTimeTheme = () => {
  if (window.__titleTheme) return window.__titleTheme;   // 테스트용
  try { const f = localStorage.getItem('duckwaterway.titleTheme'); if (f) return f; } catch (e) {}   // 테스트용 고정 (이 값이 없으면 실제 시각)
  const h = new Date().getHours();
  return h >= 20 || h < 6 ? 'night' : h >= 17 ? 'sunset' : 'day';
};
let titleSky = null;
const vGrad = stops => canvasTex(4, 256, (g, w, h) => { const grd = g.createLinearGradient(0, 0, 0, h); for (const [p, c] of stops) grd.addColorStop(p, c); g.fillStyle = grd; g.fillRect(0, 0, w, h); });
const sunTex = canvasTex(128, 128, (g) => {
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,248,215,1)'); grd.addColorStop(0.28, 'rgba(255,214,140,1)'); grd.addColorStop(0.34, 'rgba(255,170,110,0.55)'); grd.addColorStop(1, 'rgba(255,140,110,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
});
const moonTex = canvasTex(128, 128, (g) => {
  const grd = g.createRadialGradient(64, 64, 20, 64, 64, 64);
  grd.addColorStop(0, 'rgba(220,230,255,0.5)'); grd.addColorStop(1, 'rgba(160,180,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fff7da'; g.beginPath(); g.arc(64, 64, 24, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(214,200,160,0.55)';
  for (const [x, y, r] of [[56, 58, 5], [71, 70, 4], [60, 74, 3], [72, 55, 2.5]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
});
const glitterTex = canvasTex(64, 256, (g, w, h) => {   // 수면에 비치는 빛 (해·달 쪽이 밝고 앞으로 올수록 흐려짐)
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * h, k = 1 - y / h, ww = (6 + Math.random() * 20) * (0.35 + k);
    g.fillStyle = `rgba(255,255,255,${(0.25 + Math.random() * 0.5) * k})`;
    g.fillRect(w / 2 - ww / 2 + (Math.random() - 0.5) * 18 * (0.4 + k), y, ww, 1.5 + Math.random() * 2);
  }
});
// 🏝️ 메인 바다의 섬들: 멀리 큰 섬, 가까이 작은 섬 → 원근감 (멀수록 안개에 흐려짐)
let titleIslands = null;
function makeIsland(r, h, nTrees, seed) {
  const g = new THREE.Group(), rnd = mulberry(seed);
  const sand = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.2, 0.6, 22), toon(0xf1dfae)); sand.position.y = 0.05; g.add(sand);
  const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(0x78c466)); hill.scale.y = h / r; hill.position.y = 0.3; g.add(hill);
  if (r > 6) {   // 큰 섬: 봉우리 하나 더 + 바위 절벽
    const peak = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0x66b558)); peak.scale.y = (h * 1.5) / (r * 0.55); peak.position.set(r * 0.25, 0.3, -r * 0.15); g.add(peak);
    const cliff = new THREE.Mesh(new THREE.DodecahedronGeometry(r * 0.3, 0), toon(0xb9ad9b)); cliff.scale.set(1, 0.8, 1); cliff.position.set(-r * 0.6, 0.6, r * 0.35); g.add(cliff);
  }
  for (let i = 0; i < nTrees; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * r * 0.6, x = Math.cos(a) * d, z = Math.sin(a) * d;
    const y = 0.3 + h * Math.sqrt(Math.max(0, 1 - (d / r) ** 2)) - 0.2, ts = (r > 6 ? 2.2 : 1) * (0.8 + rnd() * 0.5);
    g.add(makeTree(x, y, z, ts));
  }
  for (let i = 0; i < 3; i++) {   // 물가 바위
    const a = rnd() * Math.PI * 2, rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r * 0.09 + 0.2, 0), toon(0xa9a59e));
    rock.position.set(Math.cos(a) * r * 1.08, 0.2, Math.sin(a) * r * 1.08); g.add(rock);
  }
  return g;
}
function setupTitleIslands() {
  if (titleIslands) scene.remove(titleIslands);
  const g = new THREE.Group(), c = world.pondC, fx = -titleDir.x, fz = -titleDir.z, rx = fz, rz = -fx;
  for (const [fwd, side, r, h, nt, sd] of [[88, -26, 15, 5, 7, 11], [70, 30, 9, 3.2, 4, 12], [40, 17, 3.2, 1.4, 2, 13], [33, -14, 2.2, 1, 1, 14], [50, -21, 1.6, 0.7, 1, 15]]) {
    const isl = makeIsland(r, h, nt, sd);
    isl.position.set(c.x + fx * fwd + rx * side, LAKE_Y, c.z + fz * fwd + rz * side); isl.rotation.y = sd;
    g.add(isl);
  }
  // 섬은 멀리 있으니 카메라가 좌우로 살랑여도 조금만 움직이게: 카메라 위치를 중심으로 묶어 두고 카메라를 대부분 따라가게 함
  const C0 = camera.position.clone();
  for (const isl of g.children) isl.position.sub(new THREE.Vector3(C0.x, 0, C0.z));
  g.position.set(C0.x, 0, C0.z);
  g.userData = { C0, yaw0: Math.atan2(lookCur.x - C0.x, lookCur.z - C0.z) };
  scene.add(g); titleIslands = g;
}
function updateTitleIslands() {
  const g = titleIslands; if (!g) return;
  const { C0, yaw0 } = g.userData, cam = camera.position;
  g.position.set(C0.x + (cam.x - C0.x) * 0.85, 0, C0.z + (cam.z - C0.z) * 0.85);   // 위치는 85% 따라감
  const yaw = Math.atan2(lookCur.x - cam.x, lookCur.z - cam.z);
  g.rotation.y = Math.atan2(Math.sin(yaw - yaw0), Math.cos(yaw - yaw0)) * 0.9;   // 방향은 90% 따라감 → 화면에선 아주 살짝만 움직임
}
function clearTitleSky() {
  if (titleIslands) { scene.remove(titleIslands); titleIslands = null; }
  if (!titleSky) return;
  scene.remove(titleSky.g); scene.remove(titleSky.refl); if (titleSky.sea) scene.remove(titleSky.sea); titleSky = null;
}
function setupTitleSky() {
  clearTitleSky();
  setupTitleIslands();
  const kind = titleTimeTheme();
  if (kind === 'day') {   // ☀️ 낮: 메인에 들어올 때마다 랜덤 날씨 (맑음·비·눈·낙엽·꽃잎)
    const wk = ['none', 'rain', 'snow', 'leaves', 'petals'][Math.floor(Math.random() * 5)];
    if (wk === 'rain') applyRainTint('day');
    else {   // 맑은 낮: 하늘·바다를 더 진하고 선명하게 (안개도 멀리 → 먼 섬이 덜 뿌옇게)
      scene.background.setHex(0x7cc6ff); scene.fog.color.setHex(0x9ad3ff);
      scene.fog.near = 45; scene.fog.far = 240;
      lakeMat.color.setHex(0x2a74c8);
    }
    setWeather(wk, false);
    return;
  }
  setWeather('none');
  const night = kind === 'night';
  applyTheme(kind, BIOMES[0]);
  world.theme = kind;   // 밤이면 반딧불도 날아다님
  world.pond.material.color.setHex(night ? 0x7f8fc8 : 0xffe6dc);   // 연못 물빛도 밤·노을 색으로
  const horizon = night ? 0x1b2547 : 0xffc56e;
  scene.background.setHex(horizon); scene.fog.color.setHex(horizon);
  if (!night) { scene.fog.near = 60; scene.fog.far = 320; }   // 노을: 바다가 수평선까지 보이게
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(220, 32, 20), new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false,
    map: vGrad(night ? [[0, '#03071a'], [0.3, '#0b1433'], [0.47, '#16203f'], [0.5, '#1b2547'], [1, '#1b2547']]
                     : [[0, '#c93a3a'], [0.34, '#e04a36'], [0.4, '#f0623a'], [0.44, '#fb823f'], [0.475, '#ffa84e'], [0.495, '#ffc66e'], [0.5, '#ffc56e'], [1, '#ffc56e']]) }));   // 노을: 화면에 보이는 아래쪽 하늘에 진한 주황 → 노란 수평선 그라데이션
  dome.renderOrder = -2; g.add(dome);
  // 해·달: 카메라가 좌우로 살랑여도 늘 화면 안에 (해는 수평선 가운데, 달은 왼쪽 위 하늘)
  const orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: night ? moonTex : sunTex, transparent: true, depthWrite: false, fog: false }));
  orb.scale.setScalar(night ? 40 : 70); orb.renderOrder = -1; g.add(orb);
  let stars = null;
  if (night) {
    const pos = [];
    for (let i = 0; i < 420; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.asin(0.04 + Math.random() * 0.96) * (0.4 + Math.random() * 0.6) + 0.04, R = 200;
      pos.push(Math.cos(a) * Math.cos(e) * R, Math.sin(e) * R, Math.sin(a) * Math.cos(e) * R);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    stars = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTex, size: 5, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false, color: 0xf2f4ff }));
    stars.renderOrder = -1; g.add(stars);
  }
  // 수면에 길게 비치는 해·달빛
  const refl = new THREE.Group();
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(night ? 9 : 16, 150), new THREE.MeshBasicMaterial({ map: glitterTex, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending, color: night ? 0xc8d6ff : 0xffc690, opacity: night ? 0.55 : 0.75 }));
  strip.rotation.x = -Math.PI / 2; strip.position.z = -85; refl.add(strip);   // 앞(-z)이 해·달 쪽
  scene.add(g); scene.add(refl);
  // 노을: 먼 바다(수평선)까지 수면을 이어 그려서 해의 아래쪽 2/3가 바다 뒤로 가려지게
  let sea = null;
  if (!night) {
    sea = new THREE.Mesh(new THREE.RingGeometry(95, 214, 64, 1), lakeMat);   // 호수와 같은 재질 → 이음매 없이 수평선까지 바다
    sea.rotation.x = -Math.PI / 2; scene.add(sea);
  }
  titleSky = { g, refl, stars, kind, orb, sea, az: night ? 0.14 : -0.1, el: night ? 0.19 : 0.035 };
  updateTitleSky();
}
function updateTitleSky() {
  if (!titleSky) return;
  if (state !== 'title' && state !== 'levels') { clearTitleSky(); return; }
  const S = titleSky, D = 190;
  S.g.position.copy(camera.position);
  S.refl.position.set(camera.position.x, LAKE_Y + 0.03, camera.position.z);
  // 하늘(별·달·해)은 아주 멀리 있으니 카메라가 좌우로 살랑여도 화면에서는 아주 살짝만 움직이게 (카메라 회전을 97% 따라감)
  const camYaw = Math.atan2(lookCur.x - camera.position.x, lookCur.z - camera.position.z);
  if (S.yaw0 === undefined) S.yaw0 = camYaw;
  const dYaw = Math.atan2(Math.sin(camYaw - S.yaw0), Math.cos(camYaw - S.yaw0)) * 0.97;
  if (S.stars) S.stars.rotation.y = dYaw;
  const yaw = S.yaw0 + dYaw - S.az;   // 처음 화면 가운데 방향에서 살짝 옆
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  let el = S.el, dist = D;
  if (S.sea) {   // 🌅 해: 수평선(먼 바다 끝)에 2/3가 걸리게 → 위 1/3만 보임
    S.sea.position.set(camera.position.x, LAKE_Y + 0.02, camera.position.z);
    dist = 210;
    const hor = -Math.atan((camera.position.y - LAKE_Y) / 214), r = (S.orb.scale.x / 2 * 0.31) / dist;   // 수평선 높이, 해 반지름(각도)
    el = hor - r / 3;
  }
  S.orb.position.set(dx * dist * Math.cos(el), dist * Math.sin(el), dz * dist * Math.cos(el));
  S.refl.rotation.y = Math.atan2(-dx, -dz);
  if (titleSky.stars) titleSky.stars.material.opacity = 0.75 + Math.sin(elapsed * 1.7) * 0.2;
}
function titleCam() {   // 가족 정면에서 좌우로 천천히 살랑 (뒤로는 돌지 않음)
  const c = world.pondC, m = titleWander[0] ? { x: titleWander[0].hx, z: titleWander[0].hz } : c;
  const a = Math.atan2(titleDir.x, titleDir.z) + Math.sin(elapsed * 0.18) * 0.7;
  const fx = (c.x + m.x) / 2, fz = (c.z + m.z) / 2;
  camTarget.set(fx + Math.sin(a) * 8.6, c.y + 3.6, fz + Math.cos(a) * 8.6);   // 호수가 넉넉히 보이게 조금 뒤로
  lookTarget.set(fx, c.y + 1.0, fz);   // 가족이 화면 가운데쯤 오게
}

const START_I = 4;    // 출발 위치
let raceStart = null;   // 레이스 출발 자리 (출발선 바로 뒤, 다른 오리들과 나란히)
function resetDuck() {
  let si = START_I, lat0 = 0;
  if (world.raceK && raceStart) { while (si < world.samples.length - 1 && world.samples[si + 1].d <= raceStart.d) si++; lat0 = raceStart.lat; }
  const s = world.samples[si];
  Object.assign(P, { x: s.x + s.nx * lat0, y: s.y, z: s.z + s.nz * lat0, vx: 0, vy: 0, vz: 0, idx: si, lat: lat0, prog: s.d, roll: 0, spin: 0, slope: 0, inFall: false, air: false, held: null, boostT: 0, forkSide: 0, inFast: false, bigAir: false, onSlide: false, cliffAir: false, diveT: 0, skip: 0, loop: null, loopCool: 0, onGravel: false, vliftRun: false, postLiftT: 0, cart: null, cartCool: 0 });
  P.yaw = Math.atan2(-s.tx, -s.tz);
  duck.visible = true; duck.rotation.set(0, P.yaw, 0); duck.position.set(P.x, P.y, P.z);
  resetAmbient();
  snapCamera();
  timeT = 0; celebrateT = 0; shieldT = 0; hearts = maxHearts(); updateHeartsHud();
  heartItem = null; heartTimer = HEART_CHECK; heartSpawns = 0;
  trail.length = 0; babyGot = 0; updateBabyHud(); resetStats();
  for (const f of world.family) f.duck.position.y = f.baseY;
  resetEagle();
  for (const k of world.carts || []) placeCartAt(k, k.a + 4, 0);   // 🚃 기차는 승강장으로
}

function nearestIdx(x, z, hint) {
  const S = world.samples;
  let best = hint, bd = Infinity;
  for (let i = Math.max(0, hint - 24); i <= Math.min(S.length - 1, hint + 40); i++) {
    const d = (S[i].x - x) ** 2 + (S[i].z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// 점프 중 (공중): 물살 영향 없이 날아가다가, 물길 위에 내려앉거나 끊어진 곳으로 떨어짐
function airStep(dt, ax, az) {
  const S = world.samples;
  const airK = P.bigAir ? 0.55 : P.hopAir ? 0.9 : 0.2;   // 징검다리 폴짝 땐 좌우를 잘 맞출 수 있게   // 🎯 멀리뛰기 땐 날아가며 과녁 쪽으로 더 잘 틀 수 있음
  P.vx += ax * airK * dt; P.vz += az * airK * dt;
  P.x += P.vx * dt; P.z += P.vz * dt;
  P.vy -= JUMP_G * dt; P.y += P.vy * dt;
  P.idx = nearestIdx(P.x, P.z, P.idx);
  const s = S[P.idx];
  const dx = P.x - s.x, dz = P.z - s.z, along = dx * s.tx + dz * s.tz, lat = dx * s.nx + dz * s.nz;
  P.lat = lat; P.prog = s.d + along;
  const sy = s.y + (s.bank || 0) * ((P.x - s.x) * s.nx + (P.z - s.z) * s.nz);
  if (!s.gap && P.y <= sy) {                       // 착지
    P.air = false; P.y = sy; P.vy = 0;
    if (Math.abs(lat - (s.so || 0)) > s.w + 0.05) { P.hopAir = false; startFall(); return; }
    if (P.hopAir) { P.hopAir = false; Sfx.bump(); burst(P.x, P.y + 0.05, P.z, 6, 1.2, 0.06, 0.35); return; }   // 돌 위에 톡
    if (P.cliffAir) {   // ⛰️ 웅덩이에 착수
      P.cliffAir = false;
      if (P.cliffFast) {   // 빠르면: 물수제비처럼 통통 튀며 그대로 달림
        P.vy = 1.6; P.air = true;
        Sfx.splash(0.5); burst(P.x, P.y + 0.1, P.z, 12, 2, 0.08, 0.45);
        showToast(t('cliffFast'), 1300);
        return;
      }
      P.diveT = CLIFF_DIVE; P.vx *= 0.15; P.vz *= 0.15;   // 느리면: 풍덩! 깊은 물에 잠깐 빠졌다가 떠오름
      Sfx.plop(); burst(P.x, P.y + 0.1, P.z, 26, 3.2, 0.12, 0.8);
      showToast(t('cliffSlow'), 1300);
      return;
    }
    Sfx.splash(0.6); burst(P.x, P.y + 0.1, P.z, 16, 2.4, 0.1, 0.6);
    if (P.bigAir) { P.bigAir = false; scoreLanding(); }
  } else if (s.gap && P.y < s.y - 0.5) {            // 끊어진 곳으로 퐁당
    P.air = false; stats.jumpFails++; startFall(true);
  }
}

// ---------- 🚃 광산 기차 ----------
const CART_GAUGE = 0.3;   // 레일 두 줄 사이 반폭
const CART_Y = 0.42;      // 기차 안에 앉은 오리 높이 (레일 샘플 높이 기준)
const glyphTexCache = {};
function glyphTex(txt) {   // 이모지 글자 텍스처 (표지판용)
  if (glyphTexCache[txt]) return glyphTexCache[txt];
  const c = document.createElement('canvas'); c.width = 128 * Math.max(1, [...txt].length > 2 ? 2 : 1); c.height = 128;
  const g = c.getContext('2d'); g.font = '96px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(txt, c.width / 2, 70);
  return (glyphTexCache[txt] = new THREE.CanvasTexture(c));
}
function makeMineCart() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const rust = toon(0xb5651d), band = toon(0x4a4e57), inside = toon(0x5c3b1e);
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); body.add(b); return b; };
  // 오리가 쏙 들어가 앉을 만큼 큼직하게 (폭 1.2 · 길이 1.5)
  const W = 1.2, L = 1.5, H = 0.5, Y = 0.55;
  box(W, 0.06, L, inside, 0, 0.3, 0);                                   // 바닥
  for (const sx of [-1, 1]) box(0.08, H, L, rust, sx * W / 2, Y, 0);     // 옆판
  for (const sz of [-1, 1]) box(W, H, 0.08, rust, 0, Y, sz * L / 2);     // 앞뒤판
  for (const y of [Y - H / 2 + 0.06, Y + H / 2 - 0.04]) {                // 쇠 띠
    for (const sx of [-1, 1]) box(0.1, 0.06, L + 0.02, band, sx * (W / 2 + 0.01), y, 0);
    for (const sz of [-1, 1]) box(W + 0.02, 0.06, 0.1, band, 0, y, sz * (L / 2 + 0.01));
  }
  const ol = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, H + 0.04, L + 0.04), outlineMat); ol.position.y = Y; ol.scale.setScalar(1.02); body.add(ol);
  const wheels = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 12), band);
    w.rotation.z = Math.PI / 2; w.position.set(sx * (CART_GAUGE + 0.02), 0.22, sz * 0.5); body.add(w); wheels.push(w);
    const hub = new THREE.Mesh(sphLow, toon(0xffd43b)); hub.scale.setScalar(0.04); hub.position.set(sx * (CART_GAUGE + 0.065), 0.22, sz * 0.5); body.add(hub);
  }
  g.userData = { body, wheels };
  return g;
}
// 기차를 레일 샘플 i (+ 다음 샘플 쪽으로 frac) 의 옆 위치 lat 에 놓고 경사만큼 앞뒤로 기울임
function placeCartAt(k, i, lat, frac = 0, smooth = 0) {
  const SS = k.samples;
  const s = SS[i], n = SS[Math.min(i + 1, SS.length - 1)], f = frac;
  const x = s.x + (n.x - s.x) * f, y = s.y + (n.y - s.y) * f, z = s.z + (n.z - s.z) * f;
  const pa = SS[Math.max(0, i - 3)], pb = SS[Math.min(SS.length - 1, i + 3)];
  const pitch = Math.atan2(pb.y - pa.y, Math.hypot(pb.x - pa.x, pb.z - pa.z) || 1);
  k.cart.position.set(x + s.nx * lat, y, z + s.nz * lat);
  const ta = SS[Math.max(0, i - 4)], tb = SS[Math.min(SS.length - 1, i + 4)];
  const bend = (tb.tx - ta.tx) * s.nx + (tb.tz - ta.tz) * s.nz;   // + : 왼쪽으로 휨
  const yaw = Math.atan2(-s.tx, -s.tz), roll = clamp(-bend * 1.1, -0.35, 0.35);   // 커브에서 바깥쪽으로 살짝 기욺
  k.cart.rotation.order = 'YXZ';
  if (smooth) {   // 타는 중: 기울기·방향이 샘플마다 툭툭 바뀌지 않게 부드럽게 따라감
    const r = k.cart.rotation, kk = Math.min(1, smooth * 10);
    let dy = yaw - r.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    r.set(r.x + (pitch - r.x) * kk, r.y + dy * kk, r.z + (roll - r.z) * kk);
  } else k.cart.rotation.set(pitch, yaw, roll);
}
// 기차 타는 중: 레일을 따라 자동으로 굴러감. 내리막에서 빨라지고 오르막에서 느려짐. 갈라지기 전에 좌우로 기울여 레일 선택
function cartStep(dt, ax, az) {
  const C = P.cart, k = C.k, S = world.samples, def = LEVELS[levelIdx];
  let s = S[C.i];
  const lin = (ax * s.nx + az * s.nz) / INPUT_ACC;   // + = 왼쪽으로 기울임
  if (C.i < k.sp - 2 && Math.abs(lin) > 0.25) {
    const ch = lin > 0 ? 1 : -1;
    if (ch !== C.choice) { C.choice = ch; Sfx.click(); }
  }
  const nx = S[Math.min(C.i + 1, k.b)], dy = (nx.y - s.y) / Math.max(0.05, nx.d - s.d);
  const onFast = C.i >= k.sp && C.i <= k.ep && C.choice === -k.coinSide && s.rlane > 0.3;
  C.v += -dy * 16 * dt;                                       // 내리막 가속, 오르막 감속 (쌩쌩)
  if (onFast) C.v += 10 * dt;                                 // ⚡ 빠른 레일
  const vMin = def.flow * 2.4;
  if (C.v < vMin) C.v += (vMin - C.v) * Math.min(1, 2.5 * dt);   // 오르막에서 너무 느려지면 부드럽게 다시 붙음 (뚝 멈칫하지 않게)
  C.v = clamp(C.v, def.flow * 1.6, onFast ? 28 : 21);         // 예전의 2배 속도
  if (onFast && !C.fastFx) { C.fastFx = true; Sfx.whoosh(); }
  const lk = C.choice === k.coinSide ? 'rlaneW' : 'rlane';   // 고른 레일의 옆 위치
  const s1 = S[Math.min(C.i + 1, k.b)], dl = (s1[lk] - s[lk]) / Math.max(0.05, s1.d - s.d);
  const coinSlow = lk === 'rlaneW' ? 1 - 0.2 * clamp((s.rlaneW - 0.3) / 1.5, 0, 1) : 1;   // 🪙 코인 레일은 빙 돌아가는 만큼 더 오래 걸림 (서서히)
  C.d += C.v * coinSlow * dt / Math.sqrt(1 + dl * dl);
  while (C.i < k.b && S[C.i + 1].d <= C.d) C.i++;
  s = S[C.i];
  const n = S[Math.min(C.i + 1, k.b)], f = clamp((C.d - s.d) / Math.max(0.01, n.d - s.d), 0, 1);
  const lat = C.choice * (s[lk] + (n[lk] - s[lk]) * f);
  placeCartAt(k, C.i, lat, f, dt);
  P.x = k.cart.position.x; P.z = k.cart.position.z; P.y = k.cart.position.y + CART_Y;
  P.vx = s.tx * C.v; P.vz = s.tz * C.v; P.vy = 0;
  P.idx = C.i; P.lat = lat; P.prog = C.d; P.slope = 0;
  for (const w of k.cart.userData.wheels) w.rotation.x += C.v * dt / 0.13;   // 바퀴 굴러감
  C.clack -= C.v * dt;
  if (C.clack <= 0) { C.clack = 1.6; Sfx.clack(); }            // 덜컹
  if (C.i >= k.exitI) {   // 🏁 끝 범퍼에 쿵 → 오리만 앞으로 붕 날아서 물길로 풍덩
    P.cart = null; P.cartCool = 1.2;
    const v = clamp(C.v, def.flow * 1.4, def.flow * 2.2);
    P.vx = s.tx * v; P.vz = s.tz * v; P.vy = 3.2; P.air = true;
    Sfx.bump(); Sfx.quack(1.5); burst(P.x, P.y, P.z, 10, 2, 0.08, 0.5);
  }
}

// 🎢 루프 위의 점: θ = 0(입구, 바닥) → π(꼭대기) → 2π(출구, 바닥). 옆으로는 입구 줄(lat0) → 출구 줄(lat1)로 옮겨 감
const LOOP_T = 1.8;
function loopPoint(L, th, startLat) {
  const u = th / (Math.PI * 2), sm = u * u * (3 - 2 * u);
  let lat = L.lat0 + (L.lat1 - L.lat0) * sm;
  if (startLat !== null && startLat !== undefined && th < 1.2) { const k = th / 1.2; lat = startLat + (lat - startLat) * k * k * (3 - 2 * k); }   // 들어간 자리에서 관 줄로 부드럽게
  const f = L.R * Math.sin(th), up = L.R * (1 - Math.cos(th));
  return { x: L.x + L.tx * f + L.nx * lat, y: L.y + up, z: L.z + L.tz * f + L.nz * lat };
}
// 🎯 멀리뛰기 착지 점수: 과녁 가운데에 가까울수록 코인 많이
function scoreLanding() {
  const tg = (world.targets || []).find(q => Math.abs(q.idx - P.idx) < 40);
  if (!tg) return;
  const d = Math.hypot(P.x - tg.x, P.z - tg.z);
  const c = d < 0.6 ? 5 : d < 1.2 ? 3 : d < 1.8 ? 1 : 0;
  if (c) {
    save.coins = (save.coins || 0) + c; stats.coins += c; updateCoinsHud(true);
    for (let k = 0; k < c; k++) setTimeout(() => Sfx.coin(), k * 90);
    for (let k = 0; k < 6 + c * 2; k++) spawnSprite(starTex, P.x, P.y + 0.6, P.z, (Math.random() - 0.5) * 4, 2.5 + Math.random() * 2.5, (Math.random() - 0.5) * 4, 0.3, 0.9);
    showToast(t(c === 5 ? 'jumpBull' : c === 3 ? 'jumpGood' : 'jumpOk', c), 1800);
    if (c === 5) Sfx.power();
  } else showToast(t('jumpLand'), 1300);
}
// 💦 벽 없는 커브에서 오리가 물길 끝에 아슬아슬 붙으면, 오리가 밀어낸 물이 가장자리 밖으로 넘쳐 흘러내림
const spillMat = new THREE.MeshBasicMaterial({ color: 0xcdeeff, transparent: true, opacity: 0.9 }), spillMat2 = new THREE.MeshBasicMaterial({ color: 0x7cc8f2, transparent: true, opacity: 0.85 });
let spillSfxT = 0;
const gravelDustMat = new THREE.MeshBasicMaterial({ color: 0xa89c8e }); let gravelSfxT = 0;
function spillEdge(S, s, sg, lc, over, dt) {
  const a = S[Math.max(0, P.idx - 4)], b = S[Math.min(S.length - 1, P.idx + 4)];
  const bend = ((b.tx - a.tx) * s.nx + (b.tz - a.tz) * s.nz);   // + : 왼쪽으로 휘는 길
  const curve = Math.abs(bend);
  if (curve < 0.05) return;
  const outer = Math.sign(bend) !== sg;   // 바깥쪽 가장자리일수록 더 많이 넘침
  const spd = Math.hypot(P.vx, P.vz);
  const near = clamp((over + 0.55) / 0.55, 0, 1);
  const rate = near * clamp(spd / 3, 0.4, 1.6) * clamp(curve / 0.25, 0.4, 1) * (outer ? 150 : 60);
  let n = rate * dt; n = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
  const ex = s.x + s.nx * (lc + sg * s.w), ez = s.z + s.nz * (lc + sg * s.w);
  const va = P.vx * s.tx + P.vz * s.tz;
  for (let i = 0; i < n; i++) {
    const back = (Math.random() - 0.3) * 1.3, out = 0.9 + Math.random() * 1.8;
    spawnDrop(ex - s.tx * back + s.nx * sg * 0.05, s.y + (s.bank || 0) * (lc + sg * s.w) + 0.05 + Math.random() * 0.12, ez - s.tz * back + s.nz * sg * 0.05,
      s.nx * sg * out + s.tx * va * 0.45, 0.9 + Math.random() * 1.8 * near, s.nz * sg * out + s.tz * va * 0.45,
      0.11 + Math.random() * 0.11, 0.6 + Math.random() * 0.5, Math.random() < 0.6 ? spillMat : spillMat2);
  }
  if (Math.random() < rate * dt * 0.25) {   // 하얀 물거품이 가장자리에서 부풀었다 사라짐
    const back = (Math.random() - 0.2) * 1.2;
    spawnSprite(steamTex, ex - s.tx * back, s.y + 0.15, ez - s.tz * back, s.nx * sg * 0.9 + s.tx * va * 0.4, 0.6, s.nz * sg * 0.9 + s.tz * va * 0.4, 0.7 + Math.random() * 0.5 * near, 0.45, 2.5);
  }
  spillSfxT -= dt;
  if (n > 0 && near > 0.45 && spillSfxT <= 0) { spillSfxT = 0.28 + Math.random() * 0.2; Sfx.splash(0.05 + 0.07 * near); }
}

function physicsStep(dt) {
  const def = LEVELS[levelIdx];
  const S = world.samples;
  let s = S[P.idx];
  if (P.boostT > 0) P.boostT = Math.max(0, P.boostT - dt);

  // 카메라 기준 방향으로 입력 → 힘
  const fx = camF.x, fz = camF.z, rx = -fz, rz = fx;
  const ax = (rx * input.x + fx * input.y) * INPUT_ACC;
  const az = (rz * input.x + fz * input.y) * INPUT_ACC;
  if (P.held) {   // ⛲ 분수 위에 둥실 (조작 불가) → 시간이 지나면 아래로 떨어져 다시 출발
    const h = P.held, f = h.f;
    h.t += dt;
    P.x += (f.x - P.x) * damp(6, dt); P.z += (f.z - P.z) * damp(6, dt);
    P.y = f.y + f.h + 0.05 + Math.sin(h.t * 7) * 0.08; P.vx = P.vz = 0; P.vy = 0;
    P.yaw += dt * 4;   // 물기둥 위에서 빙글빙글
    if (h.t >= FOUNTAIN_HOLD) { P.held = null; P.air = true; P.vy = 0.5; f.phase = 'idle'; f.t = 3 + Math.random() * 2; }
    return;
  }
  if (P.loopCool > 0) P.loopCool -= dt;
  if (P.cartCool > 0) P.cartCool -= dt;
  if (!P.cart && !P.air && !(P.cartCool > 0) && s.rail && world.carts) {   // 🚃 승강장에 닿으면 기차에 쏙
    const k = world.carts.find(q => P.idx >= q.a && P.idx <= q.b);
    if (k && P.idx < k.exitI) {
      const i = Math.max(P.idx, k.a + 4);
      P.cart = { k, i, d: S[i].d, v: Math.max(def.flow * 2.4, Math.hypot(P.vx, P.vz)), choice: P.lat > 0.3 ? 1 : P.lat < -0.3 ? -1 : k.coinSide, clack: 0.5, fastFx: false };
      Sfx.bump(); Sfx.quack(1.3); burst(P.x, P.y + 0.3, P.z, 8, 1.6, 0.07, 0.4);
      if (!world.cartHint) { world.cartHint = true; showToast(t('cartToast'), 2200); }
    }
  }
  if (P.cart) { cartStep(dt, ax, az); return; }
  if (P.loop) {   // 🎢 루프 타는 중: 관을 따라 자동으로 한 바퀴 (조작 없음)
    const Lp = P.loop, L = Lp.L;
    Lp.th += (Math.PI * 2 / LOOP_T) * dt * (1.15 - 0.3 * Math.sin(Lp.th / 2));   // 꼭대기에서 살짝 느려짐
    if (Lp.th >= Math.PI * 2) {
      const sE = S[L.idx];
      P.loop = null; P.loopCool = 1.2;
      P.x = L.x + L.nx * L.lat1; P.z = L.z + L.nz * L.lat1; P.y = sE.y; P.lat = L.lat1;
      P.vx = L.tx * Lp.spd; P.vz = L.tz * Lp.spd; P.vy = 0; P.boostT = 0.6;
      P.idx = nearestIdx(P.x, P.z, P.idx);
      Sfx.splash(0.5); burst(P.x, P.y + 0.1, P.z, 18, 2.6, 0.1, 0.6);
      return;
    }
    const p = loopPoint(L, Lp.th, Lp.lat0);
    P.x = p.x; P.y = p.y; P.z = p.z; P.vx = L.tx * Lp.spd; P.vz = L.tz * Lp.spd;
    if (Math.random() < dt * 30) spawnDrop(P.x, P.y + 0.2, P.z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, 0.06, 0.35);
    return;
  }
  if (P.diveT > 0) {   // 🌊 웅덩이 속에 잠깐 쏙 → 보글보글 → 떠오름
    P.diveT -= dt;
    const k = 1 - Math.max(0, P.diveT) / CLIFF_DIVE;
    P.y = s.y - Math.min(1, k / 0.18, (1 - k) / 0.25) * 2.3; P.vx *= 0.9; P.vz *= 0.9;   // 머리 끝까지 쏙 잠겼다가 (오리 키 ≈ 1.8)
    if (Math.random() < dt * 25) spawnDrop(P.x + (Math.random() - 0.5) * 0.5, s.y + 0.05, P.z + (Math.random() - 0.5) * 0.5, 0, 0.8 + Math.random(), 0, 0.05, 0.4);
    if (P.diveT <= 0) { P.y = s.y; P.vx = s.tx * def.flow * 0.7; P.vz = s.tz * def.flow * 0.7; Sfx.quack(1.3); burst(P.x, P.y + 0.2, P.z, 12, 2, 0.08, 0.5); }
    return;
  }
  if (P.air) { airStep(dt, ax, az); if (state === 'playing') checkEnd(); return; }

  // 소용돌이 안에서는 물살이 거의 오리를 밀어주지 못함 → 확실히 느려짐
  let whirlK = 0;
  for (const w of world.whirls) {
    const d = Math.hypot(w.x - P.x, w.z - P.z), R = w.R + 0.15;
    if (d < R && Math.abs(w.y - P.y) < 1) whirlK = Math.max(whirlK, 1 - d / R);
  }

  // 물살: 오리 속도를 흐름 속도로 끌어당김 (부력/관성 느낌)
  // 옆 물살: 물길을 따라 좌우로 천천히 바뀌는 흐름 (레벨이 오를수록 강해짐)
  // ⚡ 빨라지는 물살: 가속 패드를 밟았거나 갈림길의 빠른 쪽. 갈림길의 안전한 쪽은 조금 느림
  let flowMul = 1;
  if (s.fast && s.fside) {
    const fast = (P.lat - s.ic) * s.fside > 0;
    if (fast) { P.boostT = Math.max(P.boostT, 0.35); if (!P.inFast) Sfx.whoosh(); }
    else flowMul = 0.78;   // 안전한 길은 확실히 느림
    P.inFast = fast;
  } else P.inFast = false;
  if (P.boostT > 0) flowMul = 1 + BOOST_K * Math.min(1, P.boostT / 0.35);
  if (P.inFast) flowMul = Math.max(flowMul, 1 + BOOST_K * 2);   // 🔀 갈림길 빠른 길: 가속 화살표 물살은 보통 가속의 2배 (+150%)
  if (s.lift) flowMul = Math.max(flowMul, s.vlift ? 5.4 : 2.7);   // 🎢 물 엘리베이터 (빠른 오르막 물살). 골짜기(긴 내리막 뒤) 오르막은 그 2배
  if (s.jet || (S[P.idx + 8] && S[P.idx + 8].jet)) { if (P.boostT < 0.1) Sfx.whoosh(); P.boostT = Math.max(P.boostT, 0.6); }   // 🎯 멀리뛰기 직전: 쌩~
  if (!world.cliffHint && S[P.idx + 24] && S[P.idx + 24].cliff) { world.cliffHint = true; showToast(t('cliffHint'), 1800); }
  if (s.slide) {   // 🛝 워터슬라이드: 물살이 아주 빠름
    flowMul = Math.max(flowMul, 1.75);
    if (!P.onSlide) { P.onSlide = true; Sfx.whoosh(); showToast(t('slideToast'), 1400); }
  } else P.onSlide = false;
  let onGravel = false;   // 🪨 자갈밭: 물살이 약하고 바닥에 걸려서 조금 느려짐
  for (const gv of world.gravels) {
    if (P.idx < gv.i0 || P.idx > gv.i1) continue;
    if (P.lat * gv.side > gv.inner[P.idx - gv.i0] - DUCK_R * 0.6) onGravel = true;
  }
  if (onGravel) {
    flowMul *= 0.72;
    const k = Math.exp(-1.0 * dt); P.vx *= k; P.vz *= k;
    const sp = Math.hypot(P.vx, P.vz);
    if (Math.random() < dt * 14 * Math.min(1, sp / 2)) spawnDrop(P.x + (Math.random() - 0.5) * 0.6, P.y + 0.05, P.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2, 0.05, 0.35, gravelDustMat);
    gravelSfxT -= dt;
    if (gravelSfxT <= 0 && sp > 0.6) { gravelSfxT = 0.16 + Math.random() * 0.1; Sfx.gravel(); }
    if (!P.onGravel) { stats.gravel++; if (!world.gravelHint) { world.gravelHint = true; showToast(t('gravelToast'), 1500); } }
  }
  P.onGravel = onGravel;
  const flow = def.flow * flowMul;
  const cross = s.stone ? 0 : (def.cross || 0) * Math.sin(s.d * 0.32 + 1.3) * Math.min(1, s.d / 8);   // 징검다리 위엔 옆 물살 없음
  const flowK = 1 - 0.85 * Math.min(1, whirlK * 2.5);
  if (s.bank) { P.vx -= s.nx * BANK_G * s.bank * dt; P.vz -= s.nz * BANK_G * s.bank * dt; }   // 🛣️ 기울어진 코너: 낮은 안쪽으로 살짝 밀림
  P.vx += (s.tx * flow * flowK + s.nx * cross - P.vx) * WATER_DRAG * dt + ax * dt;
  P.vz += (s.tz * flow * flowK + s.nz * cross - P.vz) * WATER_DRAG * dt + az * dt;
  for (const w of world.whirls) {   // 소용돌이: 가운데로 끌어당기며 빙글빙글 + 느려짐
    const dx = w.x - P.x, dz = w.z - P.z, d = Math.hypot(dx, dz), R = w.R + 0.15;
    if (d < R && Math.abs(w.y - P.y) < 1) {
      const k = 1 - d / R, ux = dx / (d || 1), uz = dz / (d || 1);
      P.vx += (ux * 4.5 - uz * 8) * k * dt; P.vz += (uz * 4.5 + ux * 8) * k * dt;
      const slow = 1 - 3.2 * Math.min(1, k * 2) * dt; P.vx *= slow; P.vz *= slow;
      if (!w.inside) { w.inside = true; Sfx.whoosh(); stats.whirls++; }
    } else w.inside = false;
  }
  if (s.lift) {   // 🎢 오르막: 내리막에서 붙은 속도가 중력에 깎이듯 줄어듦 (너무 빨리 튀어 나가지 않게)
    const va = P.vx * s.tx + P.vz * s.tz, cap = def.flow * (s.vlift ? 6.0 : 3.0);
    if (va > cap) { const k = (va - cap) * Math.min(1, 3.5 * dt); P.vx -= s.tx * k; P.vz -= s.tz * k; }
  }
  if (s.slope > 0) { // 폭포 경사: 앞으로 쭉 미끄러지며 빨라짐
    P.vx += s.tx * s.slope * FALL_BOOST * dt; P.vz += s.tz * s.slope * FALL_BOOST * dt;
  }
  P.x += P.vx * dt; P.z += P.vz * dt;

  P.idx = nearestIdx(P.x, P.z, P.idx);
  s = S[P.idx];
  let dx = P.x - s.x, dz = P.z - s.z;
  const along = dx * s.tx + dz * s.tz;
  let lat = dx * s.nx + dz * s.nz;

  // 🎢 골짜기 오르막 끝: 빠르게 올라온 힘으로 잠깐 붕~ 떠올랐다 착지 (그 뒤엔 빨리 원래 속도로)
  if (P.vliftRun && !s.vlift && !s.gap && !s.ramp && !P.air) {
    const va = P.vx * s.tx + P.vz * s.tz;
    let clear = true; for (let k = P.idx; k < Math.min(S.length, P.idx + 40); k++) if (S[k].gap || S[k].ramp || S[k].fall || S[k].stone) { clear = false; break; }
    if (clear && va > def.flow * 2.2) {
      P.vliftRun = false; P.postLiftT = 1.6;
      P.vx *= 0.75; P.vz *= 0.75;   // 위로 튀는 만큼 앞으로는 조금 덜 (다음 직선 안에 착지)
      P.air = true; P.vy = 3.4; P.y = s.y; P.lat = lat; P.prog = s.d + along;
      Sfx.whoosh(); Sfx.quack(1.5); burst(P.x, P.y + 0.1, P.z, 12, 2.2, 0.08, 0.5);
      return;
    }
  }
  P.vliftRun = !!s.vlift;
  if (P.postLiftT > 0) {   // 붕 뜬 뒤: 너무 빠른 속도는 금방 줄여서 다음 코너에서 날아가지 않게
    P.postLiftT -= dt;
    const va = P.vx * s.tx + P.vz * s.tz, cap = def.flow * 1.6;
    if (va > cap) { const k = (va - cap) * Math.min(1, 2.2 * dt); P.vx -= s.tx * k; P.vz -= s.tz * k; }
  }

  // 점프대 끝을 지나 끊어진 곳에 들어서면 → 앞으로 가던 속도만큼 날아오름
  if (s.gap && s.hop) {   // 🪨 징검다리: 다음 돌까지 일정하게 폴짝 (좌우는 직접 맞춤)
    const vl = P.vx * s.nx + P.vz * s.nz;
    P.vx = s.tx * HOP_V + s.nx * vl; P.vz = s.tz * HOP_V + s.nz * vl;
    P.air = true; P.vy = HOP_VY; P.hopAir = true; P.y = s.y;
    Sfx.quack(1.55);
    if (!world.stoneHint) { world.stoneHint = true; showToast(t('stoneToast'), 1800); }
    return;
  }
  if (s.loopIn && !P.loop && !(P.loopCool > 0) && world.loops) {   // 🎢 루프 입구: 관으로 쏙 → 한 바퀴
    const L = world.loops.find(q => q.idx === P.idx) || world.loops.find(q => Math.abs(q.idx - P.idx) < 3);
    if (L) {
      const va = Math.max(0, P.vx * s.tx + P.vz * s.tz);
      P.loop = { L, th: 0, lat0: P.lat, spd: Math.max(va, def.flow * 1.6) };
      Sfx.whoosh(); Sfx.quack(1.4);
      if (!world.loopHint) { world.loopHint = true; showToast(t('loopToast'), 1500); }
      return;
    }
  }
  if (s.gap && s.cliff) {   // ⛰️ 절벽 끝: 그대로 아래 웅덩이로 떨어짐. 최고 속도의 80% 이상이면 웅덩이를 스치듯 건너감
    const va = Math.max(0, P.vx * s.tx + P.vz * s.tz);
    P.air = true; P.vy = 0.8; P.cliffAir = true; P.cliffFast = va >= 0.8 * (def.flow + CLIFF_VMAX_ADD);
    Sfx.quack(1.2);
    return;
  }
  if (s.gap) {
    const va = Math.max(0, P.vx * s.tx + P.vz * s.tz);
    P.air = true; P.y = P.rampY || s.y; P.vy = va * JUMP_VY; P.bigAir = s.big;
    Sfx.quack(1.3);
    return;
  }

  // 출발점 뒤로는 못 감
  if (P.idx === 0 && along < 0) {
    P.x -= along * s.tx; P.z -= along * s.tz;
    const va = P.vx * s.tx + P.vz * s.tz;
    if (va < 0) { P.vx -= va * s.tx; P.vz -= va * s.tz; }
  }

  // 좌/우 경계 처리
  const lim = s.w - DUCK_R, lc = s.so || 0;   // lc: 징검다리 돌 가운데 (좌우로 엇갈림)
  for (const sg of [1, -1]) {
    const hasWall = (sg === 1 ? s.wl : s.wr) || s.island || shieldT > 0;   // 방패 중·섬 위 물가는 벽처럼
    const over = (lat - lc) * sg - lim;
    if (!hasWall && over > -0.55 && !s.gap && !s.cliff && (lat - lc) * sg <= s.w + 0.05) spillEdge(S, s, sg, lc, over, dt);   // 💦 벽 없는 커브 끝: 물이 넘침
    if (over <= 0) continue;
    if (hasWall) {
      P.x -= s.nx * sg * over; P.z -= s.nz * sg * over; lat = lc + sg * lim;
      const vn = (P.vx * s.nx + P.vz * s.nz) * sg;
      if (vn > 0) {
        P.vx -= s.nx * sg * vn * (1 + WALL_REST); P.vz -= s.nz * sg * vn * (1 + WALL_REST);
        if (vn > 1.2 && elapsed - lastBump > 0.25) {
          lastBump = elapsed; Sfx.bump(); stats.bumps++;
          burst(P.x + s.nx * sg * 0.3, P.y + 0.2, P.z + s.nz * sg * 0.3, 6, 1.6, 0.07, 0.45);
        }
      }
    } else if ((lat - lc) * sg > s.w + 0.05) {
      startFall(); return;
    }
  }
  // 🔀 갈림길 가운데 섬: 섬에 들어서기 전에 있던 쪽 길로만 다님 (섬에 부딪히면 튕김)
  if (s.ih > 0.02) {
    const sg = P.forkSide || (lat >= 0 ? 1 : -1), lim2 = s.ih + DUCK_R, over = lim2 - (lat - s.ic) * sg;
    if (over > 0) {
      P.x += s.nx * sg * over; P.z += s.nz * sg * over; lat = s.ic + sg * lim2;
      const vn = -(P.vx * s.nx + P.vz * s.nz) * sg;
      if (vn > 0) {
        P.vx += s.nx * sg * vn * (1 + WALL_REST); P.vz += s.nz * sg * vn * (1 + WALL_REST);
        if (vn > 1.2 && elapsed - lastBump > 0.25) { lastBump = elapsed; Sfx.bump(); stats.bumps++; }
      }
    }
  } else P.forkSide = lat >= 0 ? 1 : -1;
  P.lat = lat;
  P.prog = s.d + along;
  for (const b of world.boosts) {   // ⚡ 가속 패드
    if (Math.abs(P.idx - b.idx) > 5 || Math.abs(lat - b.off) > b.hw + 0.2) continue;
    if (elapsed - b.hitT > 1) {
      Sfx.whoosh(); burst(P.x, P.y + 0.2, P.z, 10, 2, 0.07, 0.45);
      P.vx += s.tx * 1.5; P.vz += s.tz * 1.5; stats.boosts++;
      if (P.boostT < 0.5 && !(world.race && world.race.st === 'run')) showToast(t('boostToast'), 900);   // 레이스 중엔 진행 막대를 가리지 않게
    }
    b.hitT = elapsed; P.boostT = BOOST_T;
  }
  // 물길 높이 (샘플 사이 보간)
  const nb = S[clamp(P.idx + (along >= 0 ? 1 : -1), 0, S.length - 1)];
  const span = Math.abs(nb.d - s.d) || 1;
  P.y = lerp(s.y, nb.y, clamp(Math.abs(along) / span, 0, 1)) + (s.bank || 0) * lat;   // 기울어진 코너: 옆 높이만큼
  P.slope = s.slope;
  if (s.ramp) P.rampY = P.y;
  for (const m of world.mills) {   // 물레방아: 물에 잠긴 날개에 부딪히면 뒤로 크게 튕겨 나감
    const mx = P.x - m.x, mz = P.z - m.z;
    const ma = mx * m.s.tx + mz * m.s.tz, ml = mx * m.s.nx + mz * m.s.nz;
    if (Math.abs(ml) > m.w + 0.3 || Math.abs(ma) > m.R + 0.6 || Math.abs(m.y - P.y) > 1) continue;
    // 오리 몸(아래·가운데·머리 높이) 중 어디든 날개와 겹치면 부딪힘. 오리가 클수록 머리도 높음
    const sc = duck.scale.x, hs = [0.15, 0.5 * sc, 0.85 * sc], span = m.w * 2 + 0.1, lx = -ml;   // lx: 로컬 x (오른쪽 +)
    for (let k = 0; k < 4; k++) {
      const sd = k < 2 ? -1 : 1;   // 3등분: 가운데는 빈칸, 양쪽 날개는 90° 엇갈림
      if (Math.abs(lx - sd * span / 3) > span / 6 + DUCK_R * 0.6) continue;   // 오리가 그쪽 칸에 걸쳐 있지 않으면 안 부딪힘
      let phi = m.theta + (k % 2) * Math.PI + (sd > 0 ? Math.PI / 2 : 0);
      phi = Math.atan2(Math.sin(phi), Math.cos(phi));          // 0 = 바로 아래를 향함
      if (Math.cos(phi) <= 0.05) continue;                      // 위쪽을 향한 날개
      let pa = 0, best = 1e9;
      for (const h of hs) {   // 그 높이에서 날개의 앞뒤 위치 (날개 끝이 그 높이까지 내려와야 함)
        const down = m.H - h;
        if (down <= 0 || Math.cos(phi) * m.R < down) continue;
        const p = down * Math.tan(phi);
        if (Math.abs(ma - p) < Math.abs(best)) { best = ma - p; pa = p; }
      }
      const pd = best, minD = 0.08 + DUCK_R * 0.85;
      if (Math.abs(pd) >= minD) continue;
      const sg = pd >= 0 ? 1 : -1;
      P.x += m.s.tx * (pa + sg * minD - ma); P.z += m.s.tz * (pa + sg * minD - ma);
      const va = P.vx * m.s.tx + P.vz * m.s.tz;
      const kick = shieldT > 0 ? 1.2 : 3.2;
      const nv = sg > 0 ? Math.max(va, 1.5) : -kick;            // 뒤에서 부딪히면 뒤로 튕김
      P.vx += m.s.tx * (nv - va); P.vz += m.s.tz * (nv - va);
      if (elapsed - m.hitT > 0.5) {
        m.hitT = elapsed; stats.millHits++;
        Sfx.bump(); Sfx.quack(1.4);
        burst(P.x, P.y + 0.4, P.z, 10, 2.2, 0.09, 0.5);
      }
    }
  }
  for (const L of world.logs) {   // 통나무: 부딪히면 튕겨 나감 (방패 중엔 멈추기만)
    if (Math.abs(L.y - P.y) > 1) continue;
    const ex = L.bx - L.ax, ez = L.bz - L.az;
    const t = clamp(((P.x - L.ax) * ex + (P.z - L.az) * ez) / (ex * ex + ez * ez), 0, 1);
    const cx = L.ax + ex * t, cz = L.az + ez * t;
    let nx = P.x - cx, nz = P.z - cz; const d = Math.hypot(nx, nz), minD = (L.r || 0.3) + DUCK_R;
    if (d >= minD) continue;
    if (d < 1e-4) { nx = -s.tx; nz = -s.tz; } else { nx /= d; nz /= d; }
    P.x = cx + nx * minD; P.z = cz + nz * minD;
    const vn = P.vx * nx + P.vz * nz;
    if (vn < 0) {
      stats.logHits++;
      const shield = shieldT > 0;
      P.vx -= nx * vn * (shield ? 1 : 1.6); P.vz -= nz * vn * (shield ? 1 : 1.6);
      if (!shield) { P.vx += nx * 1.2; P.vz += nz * 1.2; }
      if (-vn > 0.8 && elapsed - lastBump > 0.25) {
        lastBump = elapsed; Sfx.bump();
        burst(cx, P.y + 0.3, cz, 8, 1.8, 0.08, 0.5);
      }
    }
  }
  for (const f of world.fountains) {   // ⛲ 물기둥이 솟는 중에 닿으면 위로 붕 (방패 중엔 괜찮음)
    if (f.phase !== 'erupt' || f.h < 0.8 || shieldT > 0 || Math.abs(f.y - P.y) > 1) continue;
    if ((P.x - f.x) ** 2 + (P.z - f.z) ** 2 < (f.R + DUCK_R) ** 2) {
      P.held = { f, t: 0 }; stats.fountains++;
      f.t = Math.max(f.t, FOUNTAIN_HOLD + 0.2);   // 떠 있는 동안 물기둥 유지
      Sfx.whoosh(); Sfx.quack(1.5);
      burst(f.x, f.y + 0.4, f.z, 18, 3, 0.1, 0.7);
      showToast(t('fountainToast'), 1400);
      break;
    }
  }
  for (const c of world.crabs) {   // 꽃게: 부딪히면 옆으로 밀려남
    const dx = P.x - c.x, dz = P.z - c.z, d = Math.hypot(dx, dz), minD = 0.45 + DUCK_R;
    if (d >= minD || Math.abs(c.y - P.y) > 1) continue;
    const ux = dx / (d || 1), uz = dz / (d || 1);
    P.x = c.x + ux * minD; P.z = c.z + uz * minD;
    if (elapsed - c.hitT > 0.6) {
      c.hitT = elapsed; stats.crabHits++;
      const kick = shieldT > 0 ? 1.5 : 3;
      P.vx += ux * kick; P.vz += uz * kick;
      Sfx.bump(); Sfx.quack(1.45);
      burst(c.x, P.y + 0.4, c.z, 8, 2, 0.08, 0.5);
      c.snapT = 0.4;   // 집게 딱!
      if (shieldT <= 0 && state === 'playing' && elapsed - crabHeartT >= 1) {   // 🦀 꼬집히면 하트 반 개 (한 번 꼬집힌 뒤 1초 동안은 또 부딪혀도 하트 그대로)
        crabHeartT = elapsed;
        hearts = Math.max(0, hearts - 0.5); updateHeartsHud(true);
        if (hearts <= 0) { P.fallIdx = P.idx; outOfHearts(); return; }
        showToast(t('crabToast', hearts), 1300);
      }
    }
  }
  const ck = world.clock;   // ⏰ 시계: 코스 80~88% 지점에서 지금 속도로는 시간이 빠듯하면 앞(90%)에 나타남
  if (ck && !ck.shown && !ck.skip && state === 'playing') {
    const f = P.prog / world.total;
    if (f >= 0.88 || P.idx > ck.idx - 12) ck.skip = true;   // 여유 있게 지나왔으면 이번 판엔 안 나옴
    else if (f >= 0.8) {
      const left = world.limit - timeT, pace = P.prog / Math.max(timeT, 1), need = (world.total - P.prog) / Math.max(pace, 0.5);
      if (left < need * 1.15 + 2) {
        ck.shown = true; ck.g.visible = true; ck.popT = elapsed;
        Sfx.power(); showToast(t('clockAppear'), 1600);
      }
    }
  }
  if (ck && ck.shown && !ck.taken && (ck.x - P.x) ** 2 + (ck.z - P.z) ** 2 < 1.0 && Math.abs(ck.y - P.y) < 1) {
    ck.taken = true; ck.g.visible = false;
    world.limit += ck.bonus;
    Sfx.power();
    burst(ck.x, ck.y + 0.8, ck.z, 16, 2.4, 0.09, 0.7);
    showToast(t('clockToast', ck.bonus), 1500);
  }
  for (const it of world.items) {   // 방패 아이템 줍기
    if (!it.taken && (it.x - P.x) ** 2 + (it.z - P.z) ** 2 < 0.95 * 0.95 && Math.abs(it.y - P.y) < 1) takeItem(it);
  }
  if (s.fall) P.inFall = true;
  else if (P.inFall) { // 폭포 아래 착수: 첨벙!
    P.inFall = false;
    Sfx.splash(0.6); Sfx.quack(1.15);
    burst(P.x, P.y + 0.1, P.z, 18, 2.6, 0.1, 0.6);
  }
  checkEnd();
}
function checkEnd() {
  if (P.prog >= world.total - 0.2) startWin();
  else if (timeT >= world.limit) timeUp();
}

function startFall(keepVy) {
  state = 'falling';
  P.fallIdx = P.idx; stats.falls++;
  if (!keepVy) P.vy = 2.5;
  P.spin = (Math.random() < 0.5 ? -1 : 1) * 6;
  Sfx.quack(1.25);
}
// ---------- 미션: 레벨마다 3개, 성공한 미션 하나당 별 1개 ----------
// 한 번 성공한 미션은 저장되어 계속 별로 남음 (나머지는 다음 도전에서 채우면 됨)
const stats = { coins: 0, boosts: 0, falls: 0, bumps: 0, logHits: 0, crabHits: 0, whirls: 0, items: 0, millHits: 0, jumpFails: 0, fountains: 0, gravel: 0 };
const FOUNTAIN_HOLD = 1.5;
let crabHeartT = -9;   // 🦀 마지막으로 꽃게 때문에 하트를 잃은 때 // 분수 위에 떠 있는 시간(초)
function resetStats() { for (const k in stats) stats[k] = 0; }
function missionsFor(n, W) {
  if (W.raceK) {   // 🏁 레이스: N등 안에 들기 / 아기 오리 데려가기 / 1등 (레이스 1은 가속 패드)
    const k = W.raceK, list = [{ id: 'place', v: Math.max(1, Math.ceil((k + 1) / 2)) }];
    if (W.babies.length) list.push({ id: 'babies', v: Math.ceil(W.babies.length * 0.8) });
    list.push(k === 1 ? { id: 'boost', v: 3 } : { id: 'win' });
    return list;
  }
  const list = [
    // ⏱ 시간 미션: 레벨 1~3은 제한 시간의 55·65·75%, 그 뒤로는 82% 안에 도착 (테스트 봇 최고 기록 기준으로 아슬아슬하게)
    // ⭐시간 미션: 레벨 1~3은 예전 시간 그대로, 그 뒤로는 (20% 줄인) 제한 시간의 90% 안에 도착
    { id: 'time', v: n <= 5 ? STAR_1_5[n - 1] : Math.ceil(W.limit * 0.9) },
    { id: 'nofall' },                                // 💗 한 번도 안 떨어지기
  ];
  const extra = [];                                  // 세 번째 미션은 레벨에 있는 것 중에서
  if (W.babies.length) extra.push({ id: 'babies', v: Math.ceil(W.babies.length * 0.7) });
  else {
    if (W.samples.some(s => s.gap)) extra.push({ id: 'jump' });
    if (W.crabs.length) extra.push({ id: 'crab' });
    if (W.whirls.length) extra.push({ id: 'whirl' });
    if (W.boosts.length) extra.push({ id: 'boost', v: Math.min(2, W.boosts.length) });   // (예전 '통나무 안 부딪히기'는 너무 어려워서 바꿈)
    // 🪙 레벨 21부터는 '방패 먹기'(너무 쉬움) 대신 길 위 코인 몇 개 이상 모으기 (코인의 70%)
    if (n > 20 && W.coins.length >= 10) extra.push({ id: 'coins', v: Math.round(W.coins.length * 0.7) });
    else if (W.items.length) extra.push({ id: 'item' });
    if (!extra.length) extra.push({ id: 'bumps', v: 3 });
  }
  list.push(extra[n % extra.length]);
  return list;
}
const missionText = m => t('m_' + m.id, m.v);
function missionDone(m, tm) {
  switch (m.id) {
    case 'time': return tm <= m.v;
    case 'nofall': return stats.falls === 0;
    case 'babies': return babyGot >= m.v;
    case 'crab': return stats.crabHits === 0;
    case 'mill': return stats.millHits === 0;
    case 'jump': return stats.jumpFails === 0;
    case 'whirl': return stats.whirls === 0;
    case 'boost': return stats.boosts >= m.v;
    case 'item': return stats.items > 0;
    case 'coins': return (stats.coinPick || 0) >= m.v;
    case 'bumps': return stats.bumps <= m.v;
    case 'place': return (world.racePlace || 99) <= m.v;
    case 'win': return world.racePlace === 1;
  }
  return false;
}
const starCount = mask => (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);
const starsHtml = (k, cls) => `<span class="stars ${cls || ''}">` + [0, 1, 2].map(i => `<b class="${i < k ? 'on' : ''}">★</b>`).join('') + '</span>';
function missionListHtml(results, savedMask) {
  return '<span class="mission-list">' + world.missions.map((m, i) => {
    const ok = results ? results[i] : (savedMask >> i) & 1;
    return `<span class="${ok ? 'ok' : ''}">${ok ? '⭐' : '☆'} ${missionText(m)}</span>`;
  }).join('') + '</span>';
}

// 🏁 레이스 결과: 순위 → 코인, 미션 별(레이스 별은 따로 저장: 꾸미기 별에는 안 들어감)
const raceRec = k => ((save.race || {})[k]) || { mask: 0, best: 0 };
function raceWin(tm) {
  const k = world.raceK, total = world.racers.length + 1;
  const place = 1 + world.racers.filter(r => r.done).length;
  world.racePlace = place;
  const results = world.missions.map(m => missionDone(m, tm));
  const runMask = results.reduce((a, ok, i) => a | (ok ? 1 << i : 0), 0);
  save.race = save.race || {};
  const rec = raceRec(k), prevMask = rec.mask;
  save.race[k] = { mask: rec.mask | runMask, best: rec.best ? Math.min(rec.best, place) : place };
  const reward = [0, 10 + 2 * k, 6 + k, 4][place] || 2;
  save.coins = (save.coins || 0) + reward; stats.coins += reward; updateCoinsHud(true);
  persist();
  $('#raceBar').classList.add('hidden');
  joyZone.classList.add('hidden'); joyReset();
  $('#hint').classList.add('hidden'); $('#btnControl').style.visibility = 'hidden'; $('#btnCalib').style.visibility = 'hidden';
  const savedMask = save.race[k].mask;
  const showResult = () => {
    if (state !== 'win') return;
    showPopup({
      icon: ['', '🥇', '🥈', '🥉'][place] || '🏁', title: t('raceDone', k),
      text: `<span class="race-place">${t('placeBig', place, total)}</span>` + starsHtml(starCount(runMask), 'big pop') +
        `${tm.toFixed(1)}s<br>🪙 +${stats.coins}` + missionListHtml(results) +
        (savedMask !== runMask ? `<span class="saved-stars">${t('starsSaved')} ${starsHtml(starCount(savedMask), 'small')}</span>` : ''),
      buttons: [[t('playAgain'), () => startLevel(levelIdx)], [t('levels'), () => openLevels(), true]],
    });
  };
  setTimeout(() => {
    if (state !== 'win') return;
    const b = $('#btnFinalResult'); b.classList.remove('hidden');
    b.onclick = () => { Sfx.click(); b.classList.add('hidden'); showResult(); };
  }, 1500);
}
let winT0 = 0, winA0 = 0;
const FINAL_ORBIT = 28;  // 도착하면 이 시간(초)에 한 바퀴씩, 계속 천천히 돌림 (예전의 절반 속도)
// 레벨 n을 깬 적이 있는지: 다음 레벨이 열렸거나(보통), 기록이 남아 있으면(마지막 60레벨은 다음이 없어서 기록으로 판단)
const levelCleared = n => save.unlocked > n || !!(save.best && save.best[n]) || !!(save.bestN && save.bestN[n]);
function startWin() {
  state = 'win'; celebrateT = 0; winT0 = elapsed;
  winA0 = Math.atan2(camera.position.x - world.pondC.x, camera.position.z - world.pondC.z);   // 지금 카메라 쪽에서 회전 시작
  Sfx.win(); setTimeout(() => Sfx.quack(1.1), 350);
  const tm = Math.round(timeT * 10) / 10;
  if (world.raceK) return raceWin(tm);
  const n = levelIdx + 1;
  const bestMap = bestFor();
  const prevBest = bestMap[n];
  const record = !prevBest || tm < prevBest;
  if (record) bestMap[n] = tm;
  save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, n + 1));
  const results = world.missions.map(m => missionDone(m, tm));
  const runMask = results.reduce((a, ok, i) => a | (ok ? 1 << i : 0), 0);
  const savedMask = (save.missions[n] || 0) | runMask;
  const starsBefore = totalStars();
  save.missions[n] = savedMask;
  const starsAfter = totalStars();
  const newLooks = LOOKS.filter(l => l.need > starsBefore && l.need <= starsAfter && !(save.looksBought || {})[l.id]);   // 이번에 새로 열린 꾸미기
  persist();
  const isLast = levelIdx === LEVELS.length - 1;
  if (isLast) { $('#hud').classList.add('hidden'); joyZone.classList.add('hidden'); joyReset(); }   // 한 바퀴 도는 동안은 화면만
  const showResult = () => {
    if (state !== 'win') return;
    const last = levelIdx === LEVELS.length - 1;
    showPopup({
      icon: last ? '🏡' : '',   // 결과 화면 위 하트 아이콘은 뺌
      title: last ? t('winTitleLast') : t('winTitle'),
      text: starsHtml(starCount(runMask), 'big pop') +
        t('clearLine', n, tm.toFixed(1)) + (record ? '<br>' + t('newBest') : '') + (stats.coins ? `<br>🪙 +${stats.coins}` : '') +
        missionListHtml(results) +
        (savedMask !== runMask ? `<span class="saved-stars">${t('starsSaved')} ${starsHtml(starCount(savedMask), 'small')}</span>` : '') +
        newLooks.map(l => `<span class="new-look">${t('newLook', l.icon, lookName(l))}</span>`).join('') +
        (last ? '<br>' + t('allDone') : ''),
      buttons: last
        ? [[t('levels'), () => openLevels()], [t('playAgain'), () => startLevel(levelIdx), true], [`${t('wardrobe')} ⭐${totalStars()}`, () => { openLevels(); openWardrobe(); }, 'pill-btn wardrobe-btn']]
        : [[t('nextLevel'), () => startLevel(levelIdx + 1)], [t('playAgain'), () => startLevel(levelIdx), true], [t('levels'), () => openLevels(), true], [`${t('wardrobe')} ⭐${totalStars()}`, () => { openLevels(); openWardrobe(); }, 'pill-btn wardrobe-btn']],
    });
  };
  joyZone.classList.add('hidden'); joyReset();   // 도착하면 조이스틱·안내·조작 버튼은 숨김 (결과 보기 버튼 자리)
  $('#hint').classList.add('hidden'); $('#btnControl').style.visibility = 'hidden'; $('#btnCalib').style.visibility = 'hidden';
  setTimeout(() => {   // 모든 레벨: 도착 장면을 보다가 '결과 보기' 버튼을 누르면 결과 (마지막 레벨은 화면이 계속 돎)
    if (state !== 'win') return;
    const b = $('#btnFinalResult');
    b.classList.remove('hidden');
    b.onclick = () => { Sfx.click(); b.classList.add('hidden'); showResult(); };
  }, isLast ? 2500 : 1500);
}
function timeUp() { // 타임어택 실패
  state = 'failed';
  Sfx.fail();
  showPopup({ icon: '⏰', title: t('timeUpTitle'), text: t('timeUpText', world.limit),
    buttons: [[t('restartNow'), () => startLevel(levelIdx)], [t('levels'), () => openLevels(), true]] });
}
// 떨어지면 하트 1개를 잃고 떨어진 자리 근처에서 다시 출발. 하트가 0이 되면 레벨 처음부터.
function landInLake() {
  duck.visible = false;
  Sfx.plop();
  burst(P.x, LAKE_Y + 0.1, P.z, 26, 4.5, 0.18, 1.0);
  hearts = Math.max(0, hearts - 1);
  updateHeartsHud(true);
  if (hearts > 0) {
    state = 'respawning';
    showToast(t('plopToast', hearts), 1400);
    setTimeout(() => { if (state === 'respawning') respawn(); }, 900);
    return;
  }
  outOfHearts();
}
function outOfHearts() {   // 하트를 모두 잃음 → 코인으로 이어하기 또는 처음부터
  state = 'failed';
  Sfx.fail();
  persist();
  const coins = save.coins || 0, can = coins >= CONTINUE_COST;
  showPopup({ icon: '💔', title: t('noHeartsTitle'),
    text: can ? t('continueText', CONTINUE_COST, coins) : t('noHeartsText') + `<br><span class="coin-need">${t('needCoins', CONTINUE_COST, coins)}</span>`,
    buttons: can ? [[t('continueBtn', CONTINUE_COST), () => continueRun()], [t('restartNow'), () => startLevel(levelIdx), true], [t('levels'), () => openLevels(), true]]
                 : [[t('restartNow'), () => startLevel(levelIdx)], [t('levels'), () => openLevels(), true]] });
  // (예전엔 2.6초 뒤 저절로 다시 시작했지만, 레벨 선택 버튼을 누를 수 있게 이제는 직접 고름)
}
// 🪙 이어하기: 코인을 내고 하트를 다시 가득 채워 떨어진 자리 근처에서 계속
const CONTINUE_COST = 20;
function continueRun() {
  if (state !== 'failed' || (save.coins || 0) < CONTINUE_COST) return;
  save.coins -= CONTINUE_COST; persist(); updateCoinsHud(true);
  hearts = maxHearts(); updateHeartsHud(true);
  show(null); setControlMode(controlMode); lastT = performance.now();
  heartSpawns = HEART_MAX_PER_LEVEL;   // 이어한 뒤엔 하트 아이템은 더 안 나옴
  respawn();
  showToast(t('continueToast'), 1500);
}
function updateCoinsHud(bump) {
  const el = $('#hudCoins'); el.textContent = `🪙 ${save.coins || 0}`;
  if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}
function updateCoins() {
  if (!world || !world.coins) return;
  for (const c of world.coins) {
    if (c.taken) continue;
    c.m.rotation.y = elapsed * 3 + c.idx * 0.35;
    if (state !== 'playing' || Math.abs(c.idx - P.idx) > 6) continue;
    if ((c.x - P.x) ** 2 + (c.z - P.z) ** 2 < 0.7 * 0.7 && Math.abs(c.y - P.y) < 1) {
      c.taken = true; c.m.visible = false;
      save.coins = (save.coins || 0) + 1; stats.coins++; stats.coinPick = (stats.coinPick || 0) + 1;
      Sfx.coin(); updateCoinsHud(true);
      for (let k = 0; k < 3; k++) spawnSprite(starTex, c.x, c.y + 0.5, c.z, (Math.random() - 0.5) * 2, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.22, 0.5);
    }
  }
}
function respawn() {
  const S = world.samples;
  let i = Math.max(START_I, (P.fallIdx || START_I) - 10);
  if (S[P.fallIdx] && (S[P.fallIdx].gap || S[P.fallIdx].ramp || S[P.fallIdx].stone)) {   // 점프·징검다리 실패 → 그 앞에서 다시
    i = P.fallIdx; while (i > START_I && (S[i].gap || S[i].ramp || S[i].stone)) i--;
    i = Math.max(START_I, i - 16);
  }
  const s = S[i], flow = LEVELS[levelIdx].flow;
  Object.assign(P, { x: s.x, y: s.y, z: s.z, vx: s.tx * flow * 0.5, vz: s.tz * flow * 0.5, vy: 0, idx: i, lat: 0, prog: s.d, roll: 0, spin: 0, slope: 0, inFall: false, air: false, held: null, boostT: 0, forkSide: 0, inFast: false, bigAir: false, onSlide: false, hopAir: false, cliffAir: false, diveT: 0, skip: 0, loop: null, loopCool: 0, onGravel: false, vliftRun: false, postLiftT: 0, cart: null, cartCool: 0 });
  P.yaw = Math.atan2(-s.tx, -s.tz);
  duck.visible = true; duck.rotation.set(0, P.yaw, 0); duck.userData.bob.rotation.set(0, 0, 0);
  trail.length = 0;   // 따라오던 아기 오리들도 바로 뒤로
  let k = 0;
  for (const b of world.babies) if (b.state === 'follow') { k++; b.x = s.x - s.tx * k; b.z = s.z - s.tz * k; b.y = s.y; }
  shieldT = Math.max(shieldT, 1.5);   // 다시 출발 직후 잠깐 보호
  for (const k of world.carts || []) if (i < k.exitI) placeCartAt(k, Math.max(k.a + 4, Math.min(i, k.exitI - 1)), 0);   // 🚃 기차 앞에서 다시 출발하면 기차도 제자리
  burst(P.x, P.y + 0.2, P.z, 14, 2, 0.08, 0.5);
  Sfx.quack(1.3);
  state = 'playing';
  trySpawnHeart(0.25); heartTimer = HEART_CHECK;   // 하트가 3개 이하면 앞쪽에 하트 아이템이 나올 수도
}

// ---------- 하트 아이템: 하트가 3개 이하일 때 랜덤하게 앞쪽에 나타남 (먹으면 +1) ----------
const HEART_CHECK = 16;         // 몇 초마다 나올지 검사
const HEART_MAX_PER_LEVEL = 2;  // 한 레벨에 최대 몇 번까지 나올지
let heartItem = null, heartTimer = HEART_CHECK, heartSpawns = 0;
function trySpawnHeart(chance) {
  if (!world || heartItem || hearts > 3 || hearts >= maxHearts() || heartSpawns >= HEART_MAX_PER_LEVEL || Math.random() > chance) return;
  const S = world.samples, N = S.length;
  let i = P.idx + 40 + Math.floor(Math.random() * 25);   // 10~16 정도 앞
  while (i < N - 20 && (S[i].fall || S[i - 1].fall || S[i].gap || S[i].ramp || S[i].fork || S[i].stone || S[i].rail)) i += 4;
  if (i >= N - 20) return;
  const s = S[i], off = (Math.random() - 0.5) * 0.8 * s.w;
  const g = new THREE.Group();
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }));
  spr.scale.setScalar(0.85); spr.position.y = 0.75; g.add(spr);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: 0xff7fa0 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.12; g.add(ring);
  const x = s.x + s.nx * off, z = s.z + s.nz * off;
  const hy = s.y + (s.bank || 0) * off;
  g.position.set(x, hy, z); world.group.add(g);
  heartItem = { g, spr, ring, x, y: hy, z, idx: i }; heartSpawns++;
}
function removeHeartItem() { if (heartItem) { world.group.remove(heartItem.g); heartItem = null; } }
function updateHeartItem(dt) {
  if (state === 'playing') {
    heartTimer -= dt;
    if (heartTimer <= 0) { heartTimer = HEART_CHECK; trySpawnHeart(0.3); }
  }
  const h = heartItem;
  if (!h) return;
  h.spr.position.y = 0.75 + Math.sin(elapsed * 3) * 0.12;
  h.spr.scale.setScalar(0.85 + Math.sin(elapsed * 6) * 0.06);
  h.ring.rotation.z += dt * 2;
  if (state !== 'playing') return;
  if ((h.x - P.x) ** 2 + (h.z - P.z) ** 2 < 0.95 * 0.95 && Math.abs(h.y - P.y) < 1) {
    hearts = Math.min(maxHearts(), hearts + 1);
    updateHeartsHud(true);
    Sfx.heal();
    for (let k = 0; k < 7; k++) spawnSprite(heartTex, h.x, h.y + 0.7, h.z, (Math.random() - 0.5) * 2.5, 2 + Math.random() * 2, (Math.random() - 0.5) * 2.5, 0.35, 0.9);
    showToast(t('heartToast'), 1300);
    removeHeartItem();
  } else if (P.idx > h.idx + 24) removeHeartItem();   // 지나쳐 버리면 사라짐
}
function takeItem(it) {
  it.taken = true; it.mesh.visible = false;
  shieldT = SHIELD_TIME; stats.items++;
  Sfx.power();
  for (let i = 0; i < 8; i++) spawnSprite(starTex, it.x, it.y + 0.6, it.z, (Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.35, 0.8);
  showToast(t('shieldToast', SHIELD_TIME), 1600);
}
let toastTimer = null;
function showToast(text, ms) {
  const h = $('#hint'); h.textContent = text; h.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => h.classList.add('hidden'), ms);
}
function heartsHtml() {   // ❤️ 한 개 / 반 개(💔 대신 반쪽만 빨간 하트) / 🤍 빈 하트
  return Array.from({ length: maxHearts() }, (_, i) => hearts >= i + 1 ? '<span>❤️</span>' : hearts >= i + 0.5 ? '<span class="half-heart">🤍</span>' : '<span>🤍</span>').join('');
}
function updateHeartsHud(hit) {
  const el = $('#hudHearts');
  el.innerHTML = heartsHtml();
  if (hit) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}

// ---------- 카메라 ----------
// 고정 방향 카메라: 항상 남쪽에서 북쪽(화면 위)을 바라봄.
// 물길이 남쪽(화면 아래)으로 꺾이면 오리가 카메라를 향해 와서 얼굴이 보임.
const CAM_UP = 9.5, CAM_BACK = 9.5;   // 멀리서 넓게 보기
const camTarget = new THREE.Vector3(), lookTarget = new THREE.Vector3(), lookCur = new THREE.Vector3();
const look = { x: 0, z: 0 };   // 진행 방향으로 미리 보여주는 오프셋
// ---------- 날씨: ❄️ 설원(51~60)은 눈, ⛰️ 산(21~30)은 낙엽이 흩날림 ----------
// 오리(카메라가 보는 곳) 주변 상자 안에서만 떨어지고, 상자 밖으로 나가면 반대편으로 되돌려서 계속 재사용 (가벼움)
const WX = 15, WY0 = -3, WY1 = 14;   // 상자: 좌우·앞뒤 ±15, 높이 -3 ~ +14
const W_MAX = 1000;
const wPos = new Float32Array(W_MAX * 3), wCol = new Float32Array(W_MAX * 3), wPh = new Float32Array(W_MAX), wSp = new Float32Array(W_MAX);
const wGeo = new THREE.BufferGeometry();
wGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3));
wGeo.setAttribute('color', new THREE.BufferAttribute(wCol, 3));
const snowTex = canvasTex(32, 32, (g, w, h) => {
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.45, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});
const leafTex = canvasTex(32, 32, (g) => {   // 하얀 잎 모양 (색은 낙엽마다 정점 색으로 입힘)
  g.translate(16, 16); g.rotate(-0.6);
  g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(0, 0, 13, 7, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(120,70,30,0.55)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-13, 0); g.lineTo(12, 0); g.stroke();
});
const snowMat = new THREE.PointsMaterial({ size: 0.2, map: snowTex, transparent: true, depthWrite: false, vertexColors: true });
const leafMat = new THREE.PointsMaterial({ size: 0.6, map: leafTex, transparent: true, depthWrite: false, alphaTest: 0.25, vertexColors: true });
const weatherPts = new THREE.Points(wGeo, snowMat);
weatherPts.frustumCulled = false; weatherPts.visible = false; scene.add(weatherPts);
let weather = { kind: 'none', n: 0, fall: 1, sway: 0.5, init: false };

// 🌧️ 비 오는 레벨: 설원·첫 5레벨·마지막 레벨을 빼고 일부 레벨에 비 (레벨 번호로 정해져서 항상 같은 레벨)
//    → 12, 19, 26, 33, 40, 47
const isRainy = n => n >= 6 && n < 60 && biomeFor(n).id !== 'snow' && (n * 37 + 11) % 7 === 0;
function applyRainTint(theme) {   // 하늘·안개는 잿빛으로, 햇빛은 약하게, 구름은 회색
  const k = theme === 'night' ? 0.25 : 0.5, gray = new THREE.Color(theme === 'night' ? 0x2a3140 : 0x8794a3);
  scene.background.lerp(gray, k); scene.fog.color.lerp(gray, k);
  scene.fog.near *= 0.8; scene.fog.far *= 0.85;
  sun.intensity *= 0.55; hemi.intensity *= 0.88;
  cloudMat.color.lerp(new THREE.Color(0x8e98a3), 0.6);
  lakeMat.color.lerp(new THREE.Color(0x3c5268), 0.25);
}
const RAIN_MAX = 700;
const rPos = new Float32Array(RAIN_MAX * 6), rSp = new Float32Array(RAIN_MAX);
const rGeo = new THREE.BufferGeometry(); rGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
const rainLines = new THREE.LineSegments(rGeo, new THREE.LineBasicMaterial({ color: 0xdfeeff, transparent: true, opacity: 0.55, depthWrite: false }));
rainLines.frustumCulled = false; rainLines.visible = false; scene.add(rainLines);
let rainInit = false;
function updateRain(dt) {
  if (!rainLines.visible) return;
  const cx = lookCur.x, cy = lookCur.y, cz = lookCur.z, span = WY1 - WY0, wind = 2.2;
  for (let i = 0; i < RAIN_MAX; i++) {
    const k = i * 6;
    if (!rainInit) { rPos[k] = cx + (Math.random() * 2 - 1) * WX; rPos[k + 1] = cy + WY0 + Math.random() * span; rPos[k + 2] = cz + (Math.random() * 2 - 1) * WX; rSp[i] = 15 + Math.random() * 6; }
    const vy = rSp[i];
    rPos[k] += wind * dt; rPos[k + 1] -= vy * dt;
    if (rPos[k + 1] < cy + WY0) rPos[k + 1] += span;
    if (rPos[k] < cx - WX) rPos[k] += WX * 2; else if (rPos[k] > cx + WX) rPos[k] -= WX * 2;
    if (rPos[k + 2] < cz - WX) rPos[k + 2] += WX * 2; else if (rPos[k + 2] > cz + WX) rPos[k + 2] -= WX * 2;
    // 빗줄기: 떨어지는 방향으로 짧은 선
    rPos[k + 3] = rPos[k] - wind * 0.045; rPos[k + 4] = rPos[k + 1] + vy * 0.045; rPos[k + 5] = rPos[k + 2];
  }
  rainInit = true;
  rGeo.attributes.position.needsUpdate = true;
  // 물 위에 톡톡 튀는 빗방울
  if (world && (state === 'playing' || state === 'countdown' || state === 'win') && Math.random() < dt * 40) {
    const S = world.samples, sm = S[Math.min(S.length - 1, Math.max(0, P.idx + Math.floor(Math.random() * 40) - 8))];
    const off = (Math.random() * 2 - 1) * sm.w * 0.9;
    spawnDrop(sm.x + sm.nx * off, sm.y + 0.05, sm.z + sm.nz * off, 0, 0.9 + Math.random() * 0.6, 0, 0.035, 0.22);
  }
}

// ---------- 🐟🐦 길가 이벤트: 물고기 점프 · 새 떼 · 🐸 개구리 (게임에는 영향 없음, 보는 재미) ----------
const fishPool = [];
for (const col of [0xff9f43, 0xb8c7d6]) {   // 주황 붕어, 은빛 물고기 (머리 = +z)
  const g = new THREE.Group(), m = toon(col);
  addOutlined(g, sphLow, m, V(0, 0, 0), V(0.12, 0.16, 0.34), true, 0.02);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.26, 4), m); tail.rotation.x = Math.PI / 2; tail.scale.set(0.3, 1, 1); tail.position.z = -0.42; g.add(tail);
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.16, 4), m); fin.scale.set(0.3, 1, 1); fin.position.set(0, 0.17, -0.02); g.add(fin);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(sphLow, new THREE.MeshBasicMaterial({ color: 0x222222 })); e.scale.setScalar(0.03); e.position.set(sx * 0.1, 0.04, 0.2); g.add(e); }
  g.visible = false; scene.add(g);
  fishPool.push({ g, on: false, t: 0, T: 1, h: 1, a: null, b: null });
}
const flock = { g: new THREE.Group(), birds: [], on: false, t: 0, T: 1, a: null, b: null, y: 0 };
flock.g.visible = false; scene.add(flock.g);
[[0, 0], [-0.9, -0.8], [0.9, -0.8], [-1.8, -1.6], [1.8, -1.6]].forEach(([ox, oz], k) => {   // V자 편대 (머리 = +z)
  const b = new THREE.Group(); b.position.set(ox, Math.sin(k) * 0.2, oz);
  const body = new THREE.Mesh(sphLow, toon(0xffffff)); body.scale.set(0.13, 0.11, 0.3); body.castShadow = true; b.add(body);
  const head = new THREE.Mesh(sphLow, toon(0xffffff)); head.scale.setScalar(0.1); head.position.set(0, 0.06, 0.26); b.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 5), toon(0xffa94d)); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.05, 0.38); b.add(beak);
  const wings = [];
  for (const sx of [-1, 1]) {
    const pv = new THREE.Group(); pv.position.set(sx * 0.08, 0.04, 0); b.add(pv);
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.025, 0.2), toon(0xf1f3f5)); w.position.x = sx * 0.31; w.castShadow = true; pv.add(w);
    wings.push([pv, sx]);
  }
  flock.g.add(b); flock.birds.push({ b, wings, ph: k * 0.7 });
});
let fishT = 4, birdT = 8;
function resetAmbient() {
  for (const f of fishPool) { f.on = false; f.g.visible = false; }
  flock.on = false; flock.g.visible = false;
  fishT = 3 + Math.random() * 3; birdT = 6 + Math.random() * 6;
  if (world && world.frogs) for (const f of world.frogs) { f.state = 'sit'; f.g.visible = true; f.g.position.set(f.x, f.y, f.z); f.g.rotation.x = 0; }
}
const FISH_HIGH = 2.5;   // 물길이 호수보다 이만큼 넘게 높으면 물길 안에서만 튀어오름
function spawnFish() {
  const S = world.samples, N = S.length;
  const i = Math.min(N - 30, P.idx + 26 + Math.floor(Math.random() * 26));
  const sm = S[i], f = fishPool.find(q => !q.on);
  if (!sm || !f || sm.island || sm.y - LAKE_Y < 0.9) return;
  const sg = Math.random() < 0.5 ? 1 : -1, fw = (Math.random() * 2 - 1) * 1.5;
  if (sm.y - LAKE_Y > FISH_HIGH) {   // 물길이 높이 떠 있으면: 호수에서 날아오르지 않고 물길 안에서만 폴짝
    if (sm.fork || sm.fall || sm.lift || sm.gap || sm.ramp) return;
    const reach = Math.max(0.3, sm.w - 0.35), fw2 = fw * 0.4;
    f.a = { x: sm.x + sm.nx * sg * reach + sm.tx * fw2, z: sm.z + sm.nz * sg * reach + sm.tz * fw2 };
    f.b = { x: sm.x - sm.nx * sg * reach - sm.tx * fw2, z: sm.z - sm.nz * sg * reach - sm.tz * fw2 };
    f.base = sm.y + 0.02; f.h = 0.8 + Math.random() * 0.5;
  } else {
    const reach = sm.w + 2.2 + Math.random() * 1.5;
    f.a = { x: sm.x + sm.nx * sg * reach + sm.tx * fw, z: sm.z + sm.nz * sg * reach + sm.tz * fw };
    f.b = { x: sm.x - sm.nx * sg * reach - sm.tx * fw, z: sm.z - sm.nz * sg * reach - sm.tz * fw };
    f.base = LAKE_Y; f.h = sm.y - LAKE_Y + 1.2 + Math.random() * 0.7;
  }
  f.t = 0; f.T = 1.1 + f.h * 0.09; f.on = true; f.g.visible = true;
  burst(f.a.x, f.base + 0.05, f.a.z, 8, 1.6, 0.07, 0.5); Sfx.splash(0.1);
}
function spawnBirds() {
  const S = world.samples, sm = S[Math.min(S.length - 1, P.idx + 14)];
  let fx = lookCur.x - camera.position.x, fz = lookCur.z - camera.position.z; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
  const sg = Math.random() < 0.5 ? 1 : -1, rx = -fz * sg, rz = fx * sg, D = 17;
  flock.a = { x: sm.x - rx * D, z: sm.z - rz * D }; flock.b = { x: sm.x + rx * D, z: sm.z + rz * D };
  flock.y = sm.y + 2.4 + Math.random() * 0.8; flock.t = 0; flock.T = (2 * D) / 4.6; flock.on = true; flock.g.visible = true;
  const n = 3 + Math.floor(Math.random() * 3);
  flock.birds.forEach((q, k) => { q.b.visible = k < n; });
}
function updateAmbient(dt) {
  if (world && state === 'playing') {
    fishT -= dt; birdT -= dt;
    if (fishT <= 0) { fishT = 4.5 + Math.random() * 5; spawnFish(); }
    if (birdT <= 0) { birdT = 11 + Math.random() * 9; if (world.theme !== 'night' && !flock.on) spawnBirds(); }
  }
  for (const f of fishPool) if (f.on) {
    f.t += dt; const u = f.t / f.T;
    if (u >= 1) { f.on = false; f.g.visible = false; burst(f.b.x, f.base + 0.05, f.b.z, 8, 1.6, 0.07, 0.5); continue; }
    const at = v => [lerp(f.a.x, f.b.x, v), f.base + 4 * f.h * v * (1 - v), lerp(f.a.z, f.b.z, v)];
    const p0 = at(u), p1 = at(Math.min(1, u + 0.02));
    f.g.position.set(p0[0], p0[1], p0[2]); f.g.lookAt(p1[0], p1[1], p1[2]); f.g.rotateY(Math.sin(elapsed * 22) * 0.18);   // 꼬리 살랑
  }
  if (flock.on) {
    flock.t += dt; const u = flock.t / flock.T;
    if (u >= 1) { flock.on = false; flock.g.visible = false; }
    else {
      flock.g.position.set(lerp(flock.a.x, flock.b.x, u), flock.y + Math.sin(u * 6) * 0.25, lerp(flock.a.z, flock.b.z, u));
      flock.g.lookAt(flock.b.x, flock.g.position.y, flock.b.z);
      for (const q of flock.birds) for (const [pv, sx] of q.wings) pv.rotation.z = sx * Math.sin(elapsed * 9 + q.ph) * 0.65;
    }
  }
  if (world && world.frogs) for (const f of world.frogs) {
    if (f.state === 'sit') {
      f.g.scale.set(1.4, 1.4 * (1 + Math.sin(elapsed * 3 + f.phase) * 0.05), 1.4);   // 숨쉬기
      const ahead = f.idx - P.idx;
      if (state === 'playing' && ahead < 17 && ahead > -6) {   // 오리가 다가오면 바깥 호수로 폴짝
        f.state = 'jump';
        f.vx = f.s.nx * f.sg * 2.1 + f.s.tx * 0.4; f.vz = f.s.nz * f.sg * 2.1 + f.s.tz * 0.4; f.vy = 3.8;
        f.g.rotation.y = Math.atan2(f.vx, f.vz) + Math.PI;   // 뛰는 쪽을 바라봄 (앞 = -z)
        burst(f.x, f.y + 0.05, f.z, 5, 1.2, 0.05, 0.35);
      }
    } else if (f.state === 'jump') {
      f.vy -= 9 * dt;
      const q = f.g.position; q.x += f.vx * dt; q.y += f.vy * dt; q.z += f.vz * dt;
      f.g.rotation.x = clamp(-f.vy * 0.12, -0.5, 0.5);
      f.g.scale.set(1.4, 1.6, 1.4);
      if (q.y < LAKE_Y + 0.05) { f.state = 'gone'; f.g.visible = false; burst(q.x, LAKE_Y + 0.05, q.z, 7, 1.4, 0.06, 0.45); }
    }
  }
}
function setWeather(kind, heavy) {
  weather = { kind, n: kind === 'snow' ? (heavy ? 1000 : 520) : kind === 'leaves' ? 280 : kind === 'petals' ? 260 : 0, fall: kind === 'snow' ? (heavy ? 1.7 : 1.15) : kind === 'petals' ? 0.7 : 0.9, sway: kind === 'snow' ? 0.5 : kind === 'petals' ? 1.7 : 1.4, init: false };
  rainLines.visible = kind === 'rain'; rainInit = false;
  weatherPts.visible = weather.n > 0;
  if (!weather.n) return;
  weatherPts.material = kind === 'snow' ? snowMat : leafMat;
  snowMat.size = heavy ? 0.32 : 0.26;
  const leafCols = [[0.95, 0.55, 0.15], [0.9, 0.3, 0.15], [0.98, 0.78, 0.25], [0.75, 0.45, 0.2]];
  const petalCols = [[1, 0.72, 0.8], [1, 0.85, 0.9], [1, 0.62, 0.74], [1, 0.95, 0.97]];   // 🌸 벚꽃잎: 연분홍·흰색
  for (let i = 0; i < weather.n; i++) {
    const c = kind === 'snow' ? [1, 1, 1] : kind === 'petals' ? petalCols[i % petalCols.length] : leafCols[i % leafCols.length];
    wCol[i * 3] = c[0]; wCol[i * 3 + 1] = c[1]; wCol[i * 3 + 2] = c[2];
    wPh[i] = Math.random() * 10; wSp[i] = 0.7 + Math.random() * 0.6;
  }
  wGeo.attributes.color.needsUpdate = true;
  wGeo.setDrawRange(0, weather.n);
}
function updateWeather(dt) {
  if (!weather.n) return;
  const cx = lookCur.x, cy = lookCur.y, cz = lookCur.z;
  if (!weather.init) {   // 처음엔 상자 안에 골고루 뿌림
    for (let i = 0; i < weather.n; i++) {
      wPos[i * 3] = cx + (Math.random() * 2 - 1) * WX; wPos[i * 3 + 1] = cy + WY0 + Math.random() * (WY1 - WY0); wPos[i * 3 + 2] = cz + (Math.random() * 2 - 1) * WX;
    }
    weather.init = true;
  }
  const t = elapsed, span = WY1 - WY0;
  for (let i = 0; i < weather.n; i++) {
    const k = i * 3, ph = wPh[i], sp = wSp[i];
    wPos[k + 1] -= weather.fall * sp * dt;
    wPos[k] += (Math.sin(t * 1.3 * sp + ph) * weather.sway + (weather.kind === 'leaves' || weather.kind === 'petals' ? 0.5 : 0.15)) * dt;   // 살랑살랑 + 바람
    wPos[k + 2] += Math.cos(t * 1.1 * sp + ph * 1.7) * weather.sway * 0.6 * dt;
    if (wPos[k + 1] < cy + WY0) wPos[k + 1] += span;
    if (wPos[k + 1] > cy + WY1) wPos[k + 1] -= span;
    if (wPos[k] < cx - WX) wPos[k] += WX * 2; else if (wPos[k] > cx + WX) wPos[k] -= WX * 2;
    if (wPos[k + 2] < cz - WX) wPos[k + 2] += WX * 2; else if (wPos[k + 2] > cz + WX) wPos[k + 2] -= WX * 2;
  }
  wGeo.attributes.position.needsUpdate = true;
}

function lookAheadGoal() {
  const S = world.samples, a = S[Math.min(S.length - 1, P.idx + 12)];
  // 세로 화면이라 좌우는 조금만, 앞뒤는 더 많이 미리 보여 줌. 오리는 화면 가운데보다 살짝 아래
  return { x: a.tx * 1.6, z: a.tz * 3 - 3 };
}
// 📷 다른 물길이 오리를 가리는지: 오리 → 카메라 사이 몇 점(카메라 자리 포함)에 다른 구간의 물길(바닥~난간 높이)이 있으면 가림
function segBlocked(cx, cy, cz) {
  const S = world && world.samples; if (!S) return false;
  if (!world.sgrid) {   // 샘플 위치를 2칸 격자에 담아 둠 (빨리 찾기)
    const gmap = new Map();
    S.forEach((q, i) => { if (q.gap) return; const key = Math.floor(q.x / 2) + ',' + Math.floor(q.z / 2); if (!gmap.has(key)) gmap.set(key, []); gmap.get(key).push(i); });
    world.sgrid = gmap;
  }
  const ox = P.x, oy = P.y + 0.5, oz = P.z;
  for (let k = 1; k <= 10; k++) {
    const t = k / 10, qx = ox + (cx - ox) * t, qy = oy + (cy - oy) * t, qz = oz + (cz - oz) * t;
    const gx = Math.floor(qx / 2), gz = Math.floor(qz / 2);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const list = world.sgrid.get((gx + a) + ',' + (gz + b)); if (!list) continue;
      for (const i of list) {
        if (Math.abs(i - P.idx) < 40) continue;   // 오리가 있는 근처 구간은 빼고
        const q = S[i];
        if (qy < q.y - BASE_D - 0.25 || qy > q.y + WALL_H + 0.3) continue;
        if ((qx - q.x) ** 2 + (qz - q.z) ** 2 < (q.w + WALL_T + 0.25) ** 2) return true;
      }
    }
  }
  return false;
}
let camLow = 0, camLowHold = 0, camLowUp = 2.4, camLowBack = 4.6, camLowSide = 0;   // 0 = 평소 높은 카메라, 1 = 윗길 아래로 낮게 내려온 카메라
function cameraGoal() {
  const lx = P.x + look.x, lz = P.z + look.z;
  // 🌀 360° 회전길 아래처럼 윗길이 오리를 가리면: 카메라가 천천히 낮고 가까이 내려와 윗길 밑으로 비춤 (벗어나면 다시 올라감)
  const live = state === 'playing' || state === 'countdown' || state === 'falling';
  if (live && segBlocked(lx, P.y + CAM_UP, lz + CAM_BACK)) {
    camLowHold = 0.6;
    const sc = duck.scale.x;   // 낮은 자리 후보 중 오리가 트여 보이는 첫 자리 (뒤쪽 → 옆쪽)
    for (const [u, bk, sx] of [[2.2, 4.4, 0], [1.6, 3.6, 0], [1.2, 3.0, 0], [1.6, 3.2, 2.4], [1.6, 3.2, -2.4], [1.0, 2.4, 0]]) {
      const cu = u + 0.6 * sc, cb = bk + 0.8 * sc;
      if (!segBlocked(P.x + sx, P.y + cu, P.z + cb)) { camLowUp = cu; camLowBack = cb; camLowSide = sx; break; }
    }
  } else camLowHold -= 1 / 60;
  camLow += ((camLowHold > 0 ? 1 : 0) - camLow) * 0.05;
  // 🎢 루프 근처(가속 물살부터 나온 직후까지): 보는 방향은 그대로 두고 카메라만 살짝 뒤로 물러나 오리를 따라감 (시점 전환 없음)
  const Lz = world && world.loops && world.loops.length ? (P.loop ? P.loop.L : world.loops.find(q => P.idx > q.idx - 60 && P.idx < q.idx + 30)) : null;
  if (Lz) {
    const z = 1.75, cx = P.x, cy = P.y + 0.5, cz = P.z;   // 보는 각도는 그대로, 오리를 따라 같이 움직임 (멈춰 있으면 심심해서)
    camTarget.set(cx, cy + CAM_UP * z, cz + CAM_BACK * z);
    lookTarget.set(cx, cy, cz);
    return;
  }
  const k = camLow * camLow * (3 - 2 * camLow);
  camTarget.set(lx + (P.x + camLowSide - lx) * k, P.y + CAM_UP + (camLowUp - CAM_UP) * k, lz + CAM_BACK + (P.z + camLowBack - lz - CAM_BACK) * k);
  lookTarget.set(lx + (P.x - lx) * k, P.y + 0.4 * k, lz + (P.z - lz) * k);
}
function snapCamera() {
  const g = lookAheadGoal(); look.x = g.x; look.z = g.z;
  cameraGoal(); camera.position.copy(camTarget); lookCur.copy(lookTarget); camera.lookAt(lookCur);
}
let viewOff = 0;
// 꾸미기 창 윗부분이 화면 위에서 몇 % 위치인지 (창이 없으면 1)
function wdTopFrac() {
  const sh = document.querySelector('#wardrobe .panel'), a = appEl.getBoundingClientRect();
  if (!sh || !a.height || $('#wardrobe').classList.contains('hidden')) return 1;
  return Math.min(1, Math.max(0, (sh.getBoundingClientRect().top - a.top) / a.height));
}
// 오리가 바라보는 물길 앞쪽 방향 (카메라가 있을 쪽)
function wardrobeDir() {
  const S = world && world.samples;
  if (!S) return { x: 0, z: -1 };
  const c = world.pondC;
  if (c && (P.x - c.x) ** 2 + (P.z - c.z) ** 2 < 4.8 ** 2 && Math.abs(P.y - c.y) < 1) {   // 도착 연못에서: 엄마(또는 집) 반대쪽에서 보기 → 가리지 않게
    const m = world.family[0] ? world.family[0].duck.position : world.homeAt || c;
    let dx = P.x - m.x, dz = P.z - m.z, l = Math.hypot(dx, dz);
    if (l < 0.3) { dx = P.x - c.x; dz = P.z - c.z; l = Math.hypot(dx, dz) || 1; }
    return { x: dx / l, z: dz / l };
  }
  const a = S[Math.min(S.length - 1, P.idx + 4)];
  const l = Math.hypot(a.tx, a.tz) || 1;
  return { x: a.tx / l, z: a.tz / l };
}
function updateCamera(dt) {
  if (state === 'playing' || state === 'countdown') {
    const g = lookAheadGoal(), k = damp(1.8, dt);
    look.x = lerp(look.x, g.x, k); look.z = lerp(look.z, g.z, k);
  }
  if (state === 'wardrobe') {   // 꾸미기 화면: 물길 앞쪽(트인 쪽)에서 오리 얼굴을 정면으로. 벽에 가리지 않게 살짝 위에서
    const sc = duck.scale.x, f = wardrobeDir();
    const visH = Math.max(0.25, wdTopFrac());                       // 꾸미기 창 위로 보이는 화면 비율
    const ang = THREE.MathUtils.degToRad(camera.fov) * visH;
    const dist = Math.max(1.6 * sc, (1.35 * sc / 0.68) / (2 * Math.tan(ang / 2)));   // 모자까지 포함해 보이는 칸의 60% 정도 크기
    const el = 0.38, cy = P.y + 0.68 * sc;
    camTarget.set(P.x + f.x * dist * Math.cos(el), cy + dist * Math.sin(el), P.z + f.z * dist * Math.cos(el));
    lookTarget.set(P.x, cy, P.z);
  } else if (state === 'shop' && world.homeAt) {   // 🛍️ 상점: 내 집 연못가를 빙 둘러 보여 줌
    shopCam();
  } else if ((state === 'title' || state === 'levels') && titleScene) {   // 첫 화면(과 그 위에 뜬 레벨 화면): 연못에서 가족과 함께
    titleCam();
  } else if (state === 'title' || state === 'levels') {
    const t = elapsed * 0.15;
    camTarget.set(P.x + Math.sin(t) * 6, P.y + 3.5, P.z + Math.cos(t) * 6);
    lookTarget.set(P.x, P.y + 0.5, P.z);
  } else if (state === 'falling' || state === 'failed' || state === 'respawning') {
    lookTarget.set(P.x, Math.max(P.y, world.lakeY + 1), P.z);
  } else if (state === 'win') {   // 도착: 연못(가족·집) 둘레를 천천히 계속 돎. 도착 순간의 카메라 방향에서 출발
    const c = world.pondC, last = levelIdx === LEVELS.length - 1;
    const h = last ? (world.homeAt || c) : (world.family[0] ? world.family[0].duck.position : c);
    const mx = c.x + (h.x - c.x) * 0.25, mz = c.z + (h.z - c.z) * 0.25;   // 연못 가운데 오리 중심, 집·가족도 함께 보이게
    const tt = elapsed - winT0, a = winA0 + Math.PI * 2 * (tt < 2 ? tt * tt / 4 : tt - 1) / FINAL_ORBIT;   // 처음 2초는 살살 출발
    const R = last ? 10 : 9, H = last ? 6 : 5.5;
    camTarget.set(mx + Math.sin(a) * R, c.y + H, mz + Math.cos(a) * R);
    lookTarget.set(mx, c.y + 0.7, mz);
  } else cameraGoal();
  camera.position.lerp(camTarget, damp(state === 'win' ? 2.5 : 4, dt));
  lookCur.lerp(lookTarget, damp(5, dt));
  camera.lookAt(lookCur);
  // 꾸미기 화면에서는 화면을 위로 밀어 오리가 꾸미기 창 위 빈 공간 가운데에 오게
  const W = appEl.clientWidth, H = appEl.clientHeight;
  const offGoal = state === 'wardrobe' ? H * (1 - wdTopFrac()) / 2 : state === 'shop' ? H * (1 - shopTopFrac()) / 2 : 0;
  viewOff = lerp(viewOff, offGoal, damp(5, dt));
  if (Math.abs(viewOff) > 0.5) camera.setViewOffset(W, H, 0, viewOff, W, H);
  else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  // 그림자 범위를 그림자 텍셀 간격에 맞춰 옮김 → 오리가 움직여도 그림자 가장자리가 지글거리지 않음
  const TX = 48 / 1024 * 4, sx = Math.round(P.x / TX) * TX, sz = Math.round(P.z / TX) * TX, sy = Math.round(P.y / TX) * TX;
  sun.position.set(sx + sunOff.x, sy + sunOff.y, sz + sunOff.z); sun.target.position.set(sx, sy, sz);
  duckGlow.position.set(P.x, P.y + 1.6, P.z + 0.6);
}

// ---------- 오리 애니메이션 ----------
function animateDuck(dt) {
  const u = duck.userData;
  if (u.prop) u.prop.rotation.y += dt * (state === 'playing' ? 16 + Math.hypot(P.vx, P.vz) * 2 : 9);   // 🚁 빠를수록 더 빨리 돎
  if (u.angel) for (const a of u.angel) { const f = Math.sin(elapsed * 5.5); a.w.rotation.z = a.sx * (0.55 + f * 0.18); a.w.rotation.y = a.sx * (-0.5 + f * 0.08); }   // 🪽 살짝 펄럭
  cuteIdle(duck, dt, elapsed);
  if (duck.userData.gold && duck.visible && Math.random() < dt * 6) {   // ✨ 황금 오리 주위 반짝이
    const sc = duck.scale.x, a = Math.random() * Math.PI * 2;
    spawnSprite(starTex, P.x + Math.cos(a) * 0.55 * sc, P.y + (0.3 + Math.random() * 0.8) * sc, P.z + Math.sin(a) * 0.55 * sc, 0, 0.6, 0, 0.22 * sc, 0.7);
  }
  const sp = Math.hypot(P.vx, P.vz);
  if (state === 'playing' || state === 'countdown' || state === 'win') {
    if (sp > 0.3) {
      const target = Math.atan2(-P.vx, -P.vz);
      let d = target - P.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      P.yaw += d * damp(6, dt);
    }
    // 통통 + 갸우뚱
    P.roll = lerp(P.roll, -input.x * 0.28 + Math.sin(elapsed * 3.1) * 0.08, damp(6, dt));
    duck.position.set(P.x, P.y, P.z);
    duck.rotation.order = 'YXZ';
    duck.rotation.set(P.loop ? P.loop.th : 0, P.loop ? Math.atan2(-P.loop.L.tx, -P.loop.L.tz) : P.yaw, 0);   // 🎢 루프: 앞으로 한 바퀴 뒤집힘
    u.bob.position.y = Math.abs(Math.sin(elapsed * 4.2)) * 0.06;
    u.bob.rotation.z = P.roll;
    u.bob.rotation.x = -input.y * 0.12 + Math.sin(elapsed * 4.2) * 0.04 - Math.atan(P.slope || 0) * 0.9;
    if (state === 'countdown' && world && !world.raceK) {   // 🏊 출발 전: 물살을 거슬러 제자리에서 열심히 헤엄 (앞뒤·좌우로 살랑, 발차기 물보라)
      const s0 = world.samples[P.idx], sc = duck.scale.x;
      const fw = Math.sin(elapsed * 1.4) * 0.22 * sc, lt = Math.sin(elapsed * 0.9 + 1) * 0.16 * sc;
      duck.position.set(P.x + s0.tx * fw + s0.nx * lt, P.y, P.z + s0.tz * fw + s0.nz * lt);
      u.bob.position.y = Math.abs(Math.sin(elapsed * 7)) * 0.05;
      u.bob.rotation.x = 0.1 + Math.sin(elapsed * 7) * 0.05;   // 앞으로 살짝 숙이고 콕콕
      u.bob.rotation.z = Math.sin(elapsed * 0.9 + 1) * 0.1;
      ripT -= dt;
      if (ripT <= 0) { ripT = 0.5; spawnRipple(duck.position.x, P.y, duck.position.z, sc * 1.3); }
    }
    const flap = state === 'win' || P.air || P.held ? Math.sin(elapsed * 22) * 0.8 : Math.sin(elapsed * 6) * 0.12;   // 점프 중엔 파닥파닥
    u.wingL.rotation.z = -flap; u.wingR.rotation.z = flap;

    // 물보라 이펙트
    splashT -= dt;
    if (splashT <= 0 && !P.air && !P.cart) {
      splashT = state === 'countdown' ? 0.12 : 0.07;   // 출발 전엔 발차기 물보라만 조금
      const dp = duck.position, bx = dp.x + Math.sin(P.yaw) * 0.45, bz = dp.z + Math.cos(P.yaw) * 0.45;
      const rx = Math.cos(P.yaw) * 0.32, rz = -Math.sin(P.yaw) * 0.32;
      for (const sg of [-1, 1]) spawnDrop(bx + rx * sg, P.y + 0.1, bz + rz * sg, rx * sg * 1.6 + (Math.random() - 0.5) * 0.4, 1.4 + Math.random(), rz * sg * 1.6, 0.06 + Math.random() * 0.03, 0.4,
        save.equip.fx === 'rainbow' ? rainbowMats[(rainbowI++) % rainbowMats.length] : save.equip.fx === 'hearts' && lookUnlocked(LOOKS.find(l => l.id === 'hearts')) ? heartFxMats[(rainbowI++) % heartFxMats.length] : null);   // 🌈 무지개 / 💕 하트빛 물보라
    }
  } else if (state === 'falling') {
    duck.position.set(P.x, P.y, P.z);
    duck.rotation.y += P.spin * dt; u.bob.rotation.z += P.spin * 0.4 * dt;
    u.wingL.rotation.z = -Math.sin(elapsed * 30) * 0.9; u.wingR.rotation.z = Math.sin(elapsed * 30) * 0.9;
  } else { // title / levels / wardrobe: 제자리 둥실
    duck.position.set(P.x, P.y, P.z);
    if (state === 'wardrobe') {   // 카메라를 보고 좌우로 천천히 몸을 돌려 옆모습까지 보여 줌
      const f = wardrobeDir(), face = Math.atan2(-f.x, -f.z);
      duck.rotation.set(0, face + Math.sin(elapsed * 0.8) * 0.8, 0);
    } else duck.rotation.set(0, P.yaw, 0);
    u.bob.position.y = Math.abs(Math.sin(elapsed * 2.6)) * 0.05;
    u.bob.rotation.z = Math.sin(elapsed * 1.7) * 0.12;
  }
}

// ---------- 아기 오리 모으기 (5의 배수 레벨) ----------
let ripT = 0;        // 출발 전 물결 고리 간격
const trail = [];     // 주인공 오리가 지나간 길 (따라오는 아기 오리용)
let babyGot = 0;
function recordTrail() {
  const l = trail[trail.length - 1];
  if (!l || (l.x - P.x) ** 2 + (l.z - P.z) ** 2 > 0.01) {
    trail.push({ x: P.x, y: P.y, z: P.z });
    if (trail.length > 500) trail.shift();
  }
}
function trailPoint(dist) { // 오리 뒤로 dist 만큼 떨어진 길 위의 점
  let acc = 0, px = P.x, py = P.y, pz = P.z;
  for (let i = trail.length - 1; i >= 0; i--) {
    const t = trail[i], d = Math.hypot(t.x - px, t.z - pz);
    if (acc + d >= dist) { const k = (dist - acc) / (d || 1); return { x: lerp(px, t.x, k), y: lerp(py, t.y, k), z: lerp(pz, t.z, k) }; }
    acc += d; px = t.x; py = t.y; pz = t.z;
  }
  return { x: px, y: py, z: pz };
}
function updateBabyHud() {
  const el = $('#hudBabies'), n = world.babies.length;
  el.classList.toggle('hidden', !n);
  el.textContent = `🐥 ${babyGot}/${n}`;
}
function pickBaby(b) {
  b.state = 'follow'; b.mark.visible = false; babyGot++;
  Sfx.quack(1.7); setTimeout(() => Sfx.beep(true), 120);
  for (let i = 0; i < 6; i++) spawnSprite(heartTex, b.x, b.y + 0.8, b.z, (Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2, 0.35, 0.9);
  updateBabyHud();
  const el = $('#hudBabies'); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}
function updateBabies(dt) {
  if (!world || !world.babies.length) return;
  let k = 0;
  for (const b of world.babies) {
    const u = b.duck.userData;
    cuteIdle(b.duck, dt, elapsed + b.phase);
    if (b.state === 'wait') { // 제자리에서 통통 + 날개 파닥 (여기 있어요!)
      b.duck.position.y = b.y + Math.abs(Math.sin(elapsed * 3 + b.phase)) * 0.1;
      b.mark.position.y = 1.9 + Math.sin(elapsed * 4 + b.phase) * 0.15;
      const w = Math.sin(elapsed * 12 + b.phase) * 0.6;
      u.wingL.rotation.z = -w; u.wingR.rotation.z = w;
      if (state === 'playing' && (b.x - P.x) ** 2 + (b.z - P.z) ** 2 < 0.95 * 0.95 && Math.abs(b.y - P.y) < 1) pickBaby(b);
    } else {                   // 줄줄이 따라오기
      k++;
      const tp = trailPoint(0.95 * k + 0.25);
      const dx = tp.x - b.x, dz = tp.z - b.z, f = damp(9, dt);
      b.x += dx * f; b.z += dz * f; b.y = lerp(b.y, tp.y, f);
      if (dx * dx + dz * dz > 1e-4) {
        let d = Math.atan2(-dx, -dz) - b.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        b.yaw += d * damp(8, dt);
      }
      const party = state === 'win';
      b.duck.position.set(b.x, b.y + Math.abs(Math.sin(elapsed * (party ? 9 : 6) + b.phase)) * (party ? 0.4 : 0.05), b.z);
      b.duck.rotation.y = b.yaw;
      const w = Math.sin(elapsed * (party ? 20 : 7) + b.phase) * (party ? 0.9 : 0.15);
      u.wingL.rotation.z = -w; u.wingR.rotation.z = w;
    }
  }
}

function animateFamily(dt) {
  if (!world) return;
  if ((state === 'title' || state === 'levels') && titleScene) wanderTitleDucks(dt);
  updateTitleSky(); updateTitleIslands();
  const party = state === 'win';
  for (const f of world.family) {
    const u = f.duck.userData;
    cuteIdle(f.duck, dt, elapsed + f.phase);
    const t = elapsed * (party ? (f.mom ? 5 : 9) : 2.2) + f.phase;   // 엄마는 천천히·살짝만 들썩 (아기들은 신나게 폴짝)
    f.duck.position.y = f.baseY + (party ? Math.abs(Math.sin(t)) * (f.mom ? 0.08 : 0.55) : Math.abs(Math.sin(t)) * 0.05);
    u.bob.rotation.z = Math.sin(t * 0.5) * (party ? (f.mom ? 0.12 : 0.3) : 0.1);
    const flap = party ? Math.sin(elapsed * (f.mom ? 10 : 20) + f.phase) * (f.mom ? 0.45 : 0.9) : Math.sin(t) * 0.1;
    u.wingL.rotation.z = -flap; u.wingR.rotation.z = flap;
  }
  if (party) {
    celebrateT += dt;
    if (celebrateT < 3.5 && Math.random() < dt * 14) {
      const c = world.pondC, a = Math.random() * Math.PI * 2, r = Math.random() * 3;
      spawnSprite(Math.random() < 0.55 ? heartTex : starTex, c.x + Math.cos(a) * r, 1 + Math.random(), c.z + Math.sin(a) * r,
        (Math.random() - 0.5) * 2, 3 + Math.random() * 3, (Math.random() - 0.5) * 2, 0.5 + Math.random() * 0.4, 1.4);
    }
  }
}

// ---------- 메인 루프 ----------
let lastT = performance.now(), acc = 0;
const FIXED = 1 / 120;
// 📱 게임 중 화면 꺼짐 방지: 기울기로 조종하면 화면을 안 만져서 폰이 어두워지거나 꺼질 수 있음
// 게임(카운트다운·플레이·떨어짐) 중에만 Screen Wake Lock 을 켜고, 일시정지·메뉴·결과 화면에선 끔
let wakeLock = null, wakeBusy = false, wakeRetryT = 0;
let nativeAwake = null;   // 앱(안드로이드)에서는 네이티브로 화면 켜 둠 (KeepAwake 플러그인 · build-apk.sh 가 넣음)
function updateWakeLock() {
  const want = !document.hidden && (state === 'playing' || state === 'countdown' || state === 'falling' || state === 'respawning');
  const KA = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.KeepAwake;
  if (KA && KA.set) { if (want !== nativeAwake) { nativeAwake = want; KA.set({ on: want }).catch(() => {}); } return; }
  if (wakeBusy || !navigator.wakeLock || want === !!wakeLock || (want && performance.now() < wakeRetryT)) return;
  wakeBusy = true;
  if (want) navigator.wakeLock.request('screen').then(l => { wakeLock = l; l.addEventListener('release', () => { if (wakeLock === l) wakeLock = null; }); }).catch(() => { wakeRetryT = performance.now() + 5000; }).finally(() => { wakeBusy = false; });   // 안 되면 5초 뒤 다시
  else { const l = wakeLock; wakeLock = null; l.release().catch(() => {}).finally(() => { wakeBusy = false; }); }
}
function frame(now) {
  requestAnimationFrame(frame);
  updateWakeLock();
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  tick(dt);
  updateShopDecor();
  lake.position.x = camera.position.x; lake.position.z = camera.position.z;   // 🌊 호수가 카메라를 따라감 → 코스가 멀리 가도(레벨 48 등) 바다 끝이 안 보임
  renderer.render(scene, camera);
}
function tick(dt) {
  if (state === 'paused') return;
  elapsed += dt;
  readInput();

  if (state === 'countdown') {
    const prev = Math.ceil(countT);
    countT -= dt;
    const cur = Math.ceil(countT);
    if (countT <= 0) {
      state = 'playing'; calibrate();
      if (world && !world.raceK) {   // 헤엄치던 자리에서 그대로 출발 (물살을 타고 살짝 앞으로)
        const s0 = world.samples[P.idx];
        P.x = duck.position.x; P.z = duck.position.z;
        P.vx = s0.tx * LEVELS[levelIdx].flow * 0.4; P.vz = s0.tz * LEVELS[levelIdx].flow * 0.4;
      }
      showCount(t('go'), true); Sfx.beep(true);
      setTimeout(() => $('#countdown').classList.add('hidden'), 600);
    } else if (cur !== prev) { showCount(String(cur), false); Sfx.beep(false); }
  }

  if (state === 'playing') {
    const hold = updateRace(dt);   // 🏁 레이스 카운트다운 중엔 오리도 시간도 멈춤
    if (!hold) {
      timeT += dt;
      acc += dt;
      while (acc >= FIXED && state === 'playing') { physicsStep(FIXED); acc -= FIXED; }
    } else acc = 0;
    updateHud();
  } else acc = 0;
  if (world && world.race && world.race.st === 'run' && state !== 'playing' && state !== 'paused') endRace(false, true);
  updateRacers(dt); updateRings(dt); updateWaves(dt); updateIcebergs(dt); updateEagle(dt);   // 레이스 중 물에 빠지면 진 걸로

  if (state === 'falling' || state === 'respawning') timeT += dt;   // 떨어진 동안에도 시간은 흐름
  if (state === 'playing' || state === 'falling' || state === 'respawning') {   // ⏱ 누적 플레이 시간 (10초마다 저장)
    save.playTime = (save.playTime || 0) + dt;
    if ((playSaveT += dt) >= 10) { playSaveT = 0; persist(); }
  }
  // 방패: 남은 시간 줄이기 + 벽 보이기 (끝나기 1.5초 전부터 깜빡)
  if (state === 'playing' && shieldT > 0) shieldT = Math.max(0, shieldT - dt);
  updateHeartItem(dt);
  updateCoins();
  {   // 🛝 슬라이드 속도감: 시야가 넓어지고 양옆으로 물보라
    const on = state === 'playing' && P.onSlide;
    const goal = on ? 9 : 0; fovBoost += (goal - fovBoost) * damp(on ? 3 : 2, dt);
    const f = baseFov + fovBoost; if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); }
    if (on && Math.random() < dt * 30) spawnDrop(P.x + (Math.random() - 0.5) * 0.8, P.y + 0.1, P.z + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 2, 1.5 + Math.random(), (Math.random() - 0.5) * 2, 0.07, 0.4);
    if (world && world.targets) for (const tg of world.targets) tg.g.children[2].scale.setScalar(1 + Math.sin(elapsed * 5) * 0.08);   // 과녁 가운데가 콩닥
  }
  if (world) {
    const on = shieldT > 0 && (state === 'playing' || state === 'countdown');
    for (const m of world.shieldWalls) m.visible = on;
    shieldMat.opacity = shieldT < 1.5 ? (Math.sin(elapsed * 20) > 0 ? 0.2 : 0.6) : 0.55;
    const sh = $('#hudShield');
    sh.classList.toggle('hidden', !on);
    if (on) sh.textContent = `🛡️ ${Math.ceil(shieldT)}`;
    for (const L of world.logs) L.g.position.y = L.y + 0.12 + Math.sin(elapsed * 2 + L.phase) * 0.04;   // 통나무 둥실
    for (const w of world.whirls) w.m.rotation.z += dt * 3.2;
    for (const m of world.mills) { m.theta = m.phase + elapsed * m.omega; m.wheel.rotation.x = m.theta; }   // 물레방아 회전                                         // 소용돌이 회전
    fountainTex.offset.y -= dt * 2.2;   // 물기둥 무늬가 위로 흘러감
    boostTex.offset.y -= dt * 2.4;      // ⚡ 화살표가 앞으로 흘러감
    boostTexSparse.offset.y -= dt * 2.4 * 1.1 / 3.3;   // 같은 속도로 (타일이 3배 길어서)
    boostMat.opacity = boostMatSparse.opacity = 0.78 + Math.sin(elapsed * 6) * 0.14;
    if (state === 'playing' && P.boostT > 0.05 && !P.air && Math.random() < dt * 35)   // 빨라진 동안 뒤로 물보라
      spawnDrop(P.x + Math.sin(P.yaw) * 0.45 + (Math.random() - 0.5) * 0.4, P.y + 0.08, P.z + Math.cos(P.yaw) * 0.45 + (Math.random() - 0.5) * 0.4, 0, 1 + Math.random(), 0, 0.06, 0.35);
    for (const f of world.fountains) {   // ⛲ 쉬기 → 보글보글(예고) → 솟구침 → 쉬기 (시간은 매번 랜덤)
      f.t -= dt;
      if (f.t <= 0) {
        if (f.phase === 'idle') { f.phase = 'warn'; f.t = 0.9; }
        else if (f.phase === 'warn') { f.phase = 'erupt'; f.t = 1.4 + Math.random() * 0.8; Sfx.splash(0.4); }
        else { f.phase = 'idle'; f.t = 2.5 + Math.random() * 3.5; }
      }
      const want = f.phase === 'erupt' ? f.H : 0;
      f.h += (want - f.h) * damp(f.phase === 'erupt' ? 9 : 5, dt);
      const up = f.h > 0.05;
      f.col.visible = f.cap.visible = f.core.visible = up;
      if (up) {   // 물기둥: 굵기가 꿀렁꿀렁, 안쪽 심은 더 빠르게 흔들림
        const wob = 1 + Math.sin(elapsed * 13 + f.x) * 0.07 + Math.sin(elapsed * 7.3) * 0.04;
        f.col.scale.set(wob, f.h, wob); f.col.position.y = f.h / 2;
        f.core.scale.set(2 - wob, f.h * 1.04, 2 - wob); f.core.position.y = f.h * 0.52;
        f.cap.position.y = f.h; f.cap.rotation.y += dt * 4;
        f.cap.children.forEach((b, k) => { b.scale.setScalar(b.userData.base * (1 + Math.sin(elapsed * 11 + k * 1.9) * 0.3)); b.position.y = Math.abs(Math.sin(elapsed * 9 + k)) * 0.12; });
      }
      // 구멍 안 물이 끓는 듯: 거품이 부풀었다가 톡 터지고 다른 자리에서 다시 생김 (예고 땐 크고 빠르게)
      const boilK = f.phase === 'warn' ? 2.6 : f.phase === 'erupt' ? 1.6 : 1;
      for (const b of f.boil) {
        b.ph += dt * b.sp * boilK;
        if (b.ph >= 1) { b.ph -= 1; const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * (f.R - 0.15); b.m.position.x = Math.cos(a) * rr; b.m.position.z = Math.sin(a) * rr; }
        const sz = Math.sin(b.ph * Math.PI) * (f.phase === 'warn' ? 0.13 : 0.08);
        b.m.scale.set(sz, sz * 0.6, sz); b.m.visible = sz > 0.01;
      }
      f.ring.scale.setScalar(f.phase === 'warn' ? 1 + Math.abs(Math.sin(elapsed * 14)) * 0.12 : 1);
      if (f.phase === 'warn' && Math.random() < dt * 35) spawnDrop(f.x + (Math.random() - 0.5) * f.R, f.y + 0.1, f.z + (Math.random() - 0.5) * f.R, 0, 1.4 + Math.random(), 0, 0.06, 0.3);   // 보글보글 예고
      else if (f.phase === 'idle' && Math.random() < dt * 4) spawnDrop(f.x + (Math.random() - 0.5) * f.R, f.y + 0.08, f.z + (Math.random() - 0.5) * f.R, 0, 0.6, 0, 0.04, 0.25);   // 평소에도 살짝 보글
      if (f.phase === 'erupt' && f.h > 0.5 && Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2;
        spawnDrop(f.x, f.y + f.h, f.z, Math.cos(a) * 2, 1.5 + Math.random() * 1.8, Math.sin(a) * 2, 0.08, 0.7);
      }
    }
    for (const c of world.crabs) {                                                                    // 꽃게 옆걸음
      c.lat = (c.c || 0) + Math.sin(elapsed * c.speed + c.phase) * c.amp;
      c.x = c.s.x + c.s.nx * c.lat; c.z = c.s.z + c.s.nz * c.lat;
      c.g.position.set(c.x, c.y + (c.s.bank || 0) * c.lat + 0.02 + Math.abs(Math.sin(elapsed * 9 + c.phase)) * 0.05, c.z);
      c.snapT = Math.max(0, (c.snapT || 0) - dt);
      for (const ch of c.g.children) if (ch.userData.sx) {
        ch.rotation.z = ch.userData.sx * Math.sin(elapsed * 7 + c.phase) * 0.35;
        ch.userData.jaw.rotation.x = c.snapT > 0 ? 0.05 : 0.15 + Math.max(0, Math.sin(elapsed * 9 + c.phase * 2)) * 0.45;   // 딱딱 여닫음 (꼬집을 땐 꽉)
      }
    }
    if (world.clock && !world.clock.taken) {   // 시계 둥실 + 좌우로 살랑 + 분침 빙글
      const c = world.clock;
      const sc = c.popT ? Math.min(1, (elapsed - c.popT) / 0.4) : 1; c.g.scale.setScalar(sc * (1 + Math.sin(Math.min(1, sc) * Math.PI) * 0.3));   // 나타날 때 뿅
      c.face.position.y = 0.8 + Math.sin(elapsed * 3) * 0.1;
      c.face.rotation.y = Math.sin(elapsed * 1.6) * 0.5;
      c.hand.rotation.z = -elapsed * 4;
      c.ring.rotation.z += dt * 1.5;
    }
    for (const it of world.items) if (!it.taken) {   // 아이템 둥실둥실 + 빙글
      it.mesh.position.y = it.y + 0.6 + Math.sin(elapsed * 3 + it.x) * 0.12;
      it.gem.rotation.y += dt * 2.5;
      it.ring.rotation.z += dt * 1.5;
    }
  }

  if (state === 'falling') {
    P.vy -= GRAVITY * dt;
    P.x += P.vx * 0.7 * dt; P.z += P.vz * 0.7 * dt; P.y += P.vy * dt;
    if (P.y < LAKE_Y) landInLake();
  }
  if (state === 'win') { // 엄마 곁으로 헤엄쳐 가기
    const a = world.arrive;
    const k = damp(1.6, dt);
    P.vx = (a.x - P.x) * 1.6; P.vz = (a.z - P.z) * 1.6;
    P.x = lerp(P.x, a.x, k); P.z = lerp(P.z, a.z, k);
    if (Math.hypot(P.vx, P.vz) < 0.4) { // 다 오면 엄마 쪽 보기
      const m = world.homeAt || world.family[0].duck.position;   // 엄마(또는 내 집) 쪽 보기
      P.vx = (m.x - P.x) * 0.5; P.vz = (m.z - P.z) * 0.5;
    }
  }

  animateDuck(dt);
  animateFamily(dt);
  if (state === 'playing' || state === 'win' || state === 'countdown') recordTrail();
  updateBabies(dt);
  updateParticles(dt);
  waterTex.offset.y -= (world ? LEVELS[levelIdx].flow : 2) * dt / 4;
  fallTex.offset.y -= dt * 2.2;
  foamTex.offset.y -= dt * 0.8; foamTex.offset.x = Math.sin(elapsed * 1.3) * 0.05;
  if (world) for (const f of world.falls) { // 폭포 아래 물보라 (가까울 때만)
    if ((f.x - P.x) ** 2 + (f.z - P.z) ** 2 > 900 || Math.random() > dt * 18) continue;
    const o = (Math.random() - 0.5) * 2 * f.s.w;
    spawnDrop(f.x + f.s.nx * o, f.y + 0.05, f.z + f.s.nz * o, (Math.random() - 0.5) * 0.8, 1.5 + Math.random() * 1.5,
      (Math.random() - 0.5) * 0.8, 0.07 + Math.random() * 0.06, 0.6);
  }
  if (world && world.cliffSplash) for (const c of world.cliffSplash) {   // ⛰️ 절벽 아래 물보라
    if ((c.x - P.x) ** 2 + (c.z - P.z) ** 2 > 1600) continue;
    for (const b of c.blobs) {   // 거품 덩어리가 부글부글 출렁
      const k = 1 + Math.sin(elapsed * 7 + b.ph) * 0.18 + Math.sin(elapsed * 11.3 + b.ph * 2) * 0.08;
      b.m.scale.set(b.s * 1.4 * k, b.s * 0.7 * (2 - k), b.s * k);
    }
    c.ring.material.opacity = 0.4 + Math.sin(elapsed * 5) * 0.08;
    for (const r of c.rings) {
      r.t = (r.t + dt / 1.4) % 1;
      r.m.scale.setScalar(c.w * (0.5 + r.t * 1.6)); r.m.material.opacity = 0.6 * (1 - r.t) * Math.min(1, r.t * 6);
    }
    const lat = () => (Math.random() - 0.5) * 2 * c.w * 0.9;
    let n = dt * 70; n = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    for (let i = 0; i < n; i++) {   // 높이 튀어 오르는 물방울 (앞·옆으로 퍼짐)
      const o = lat(), sp = 0.8 + Math.random() * 1.6;
      spawnDrop(c.x + c.nx * o + c.tx * 0.3, c.y + 0.1, c.z + c.nz * o + c.tz * 0.3,
        c.tx * sp * (0.4 + Math.random()) + c.nx * (Math.random() - 0.5) * 1.6, 2.6 + Math.random() * 3.2, c.tz * sp * (0.4 + Math.random()) + c.nz * (Math.random() - 0.5) * 1.6,
        0.07 + Math.random() * 0.1, 0.7 + Math.random() * 0.5);
    }
    if (Math.random() < dt * 9) {   // 피어오르는 하얀 물안개
      const o = lat();
      spawnSprite(steamTex, c.x + c.nx * o + c.tx * 0.4, c.y + 0.3, c.z + c.nz * o + c.tz * 0.4, c.tx * 0.5 + (Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 0.6, c.tz * 0.5 + (Math.random() - 0.5) * 0.4, 1.4 + Math.random() * 1.2, 1.4, -0.3);
    }
  }
  if (world) {
    world.pond.rotation.z += dt * 0.04;   // 연못 물결이 천천히 돎
    if (world.pond.material.uniforms) world.pond.material.uniforms.time.value = elapsed;
    if (world0Shore) world0Shore.material.opacity = 0.28 + Math.sin(elapsed * 1.6) * 0.1;   // 물가 물결 테가 숨쉬듯
  }
  updatePondRipples(dt);
  for (const c of clouds) { c.position.x += c.userData.speed * dt; if (c.position.x > 90) c.position.x = -90; }
  // ❄️ 눈은 updateWeather()에서 하얀 눈송이로 내림 (예전 노르스름한 빛 눈은 지움)
  if (world && world.theme === 'night') {   // 🌙 별빛 반짝 + 오리 주변 반딧불 (눈 오는 설원엔 반딧불 없음)
    if (world.lakeStars) world.lakeStars.material.opacity = 0.6 + Math.sin(elapsed * 2.3) * 0.25;
    if (world.biome !== 'snow' && !rainLines.visible && Math.random() < dt * 5) {   // 눈·비 오는 날엔 반딧불 없음
      const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 4;
      spawnSprite(fireflyTex, P.x + look.x + Math.cos(a) * r, P.y + 0.4 + Math.random() * 1.6, P.z + look.z + Math.sin(a) * r,
        (Math.random() - 0.5) * 0.4, 0.15 + Math.random() * 0.2, (Math.random() - 0.5) * 0.4, 0.3, 2.6, 0);
    }
  }
  updateCamera(dt);
  updateWeather(dt);
  updateRain(dt);
  updateAmbient(dt);
}

// ---------- UI ----------
function show(id) {
  $('#btnFinalResult').classList.add('hidden');
  for (const s of ['#title', '#levels', '#popup', '#wardrobe', '#shop']) $(s).classList.toggle('hidden', s !== id);
  $('#hudHearts').style.visibility = id === '#popup' && (state === 'paused' || state === 'win') ? 'hidden' : '';   // 일시정지·결과 화면에선 남은 하트 숨김
  $('#raceBar').style.visibility = id ? 'hidden' : '';   // 팝업·메뉴 화면 위로 레이스 상태바가 나오지 않게
}
// ---------- 🏁 레이스 스테이지: 상대 오리들 ----------
function updateRacers(dt) {
  if (!world || !world.racers || !world.racers.length) return;
  const S = world.samples, total = world.total, flow = LEVELS[levelIdx].flow;
  const moving = state === 'playing' || state === 'falling' || state === 'respawning' || state === 'win';
  let order = world.racers.filter(r => r.done).length;
  for (const r of world.racers) {
    if (moving && !r.done) {
      const mul = clamp(1 + (P.prog - r.d) * 0.04, 0.9, 1.2);   // 고무줄: 뒤처지면 힘껏 따라옴
      const sc = S[r.idx];   // 구간마다 오리처럼: 슬라이드·폭포·가속 경사로에선 빨라짐
      const zone = sc.slide ? 1.55 : sc.jet || sc.gap ? 1.45 : sc.slope > 0 ? 1.3 : sc.lift ? 1.15 : 1;
      if (r.slowT > 0) r.slowT -= dt;
      r.d += (flow + r.extra) * mul * zone * (r.slowT > 0 ? 0.45 : 1) * dt;   // 파도 맞으면 잠깐 느려짐
      if (r.d >= total - 0.3) { r.done = true; r.d = total - 0.3; r.lane = ((order % 3) - 1) * 0.55 * S[S.length - 1].w; order++; }
    }
    let i = r.idx; while (i < S.length - 1 && S[i + 1].d <= r.d) i++; while (i > 0 && S[i].d > r.d) i--; r.idx = i;
    const s = S[i];
    if (!r.done && Math.random() < dt * 0.25) r.lane = (Math.random() * 2 - 1) * 0.55 * s.w;   // 가끔 줄을 바꿈
    if (!r.done && world.waves) for (const w of world.waves) {
      if (w.on && w.d > r.d && w.d - r.d < 4 && r.lane * w.side > 0 && ((r.ph * 10) | 0) % 3) r.lane = -w.side * 0.45 * s.w;   // 셋 중 둘은 피함
    }
    if (!r.done) for (const o of world.raceObs) {   // 앞에 통나무·소용돌이가 있으면 비어 있는 쪽으로 비켜 감
      if (o.idx <= i || o.idx > i + 16 || r.lane < o.lo - 0.6 || r.lane > o.hi + 0.6) continue;
      r.lane = (o.lo + o.hi) / 2 > 0 ? o.lo - 0.75 : o.hi + 0.75;
    }
    r.lat += (r.lane + (r.done ? 0 : Math.sin(elapsed * 0.6 + r.ph) * 0.12 * s.w) - r.lat) * Math.min(1, dt * 2);
    r.lat = clamp(r.lat, -s.w + 0.55, s.w - 0.55);
    // 샘플(0.25 간격) 사이를 이어서 부드럽게 (그냥 샘플 위치에 두면 뚝뚝 끊겨 보임)
    const s2 = S[Math.min(S.length - 1, i + 1)], fr = s2 === s ? 0 : clamp((r.d - s.d) / ((s2.d - s.d) || 1), 0, 1);
    const cx = lerp(s.x, s2.x, fr), cz = lerp(s.z, s2.z, fr), nx = lerp(s.nx, s2.nx, fr), nz = lerp(s.nz, s2.nz, fr);
    let y = lerp(s.y, s2.y, fr);
    if (s.gap) { const g = world.gapArcs.find(q => i >= q.a && i <= q.b); if (g) { const u = clamp((r.d - g.d0) / (g.d1 - g.d0), 0, 1); y = lerp(g.y0, g.y1, u) + Math.sin(u * Math.PI) * 0.9; } }
    r.x = cx + nx * r.lat; r.z = cz + nz * r.lat; r.y = y;
    r.g.position.set(r.x, y, r.z);
    let dy = Math.atan2(-s.tx, -s.tz) - r.g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); r.g.rotation.y += dy * Math.min(1, dt * 8);
    cuteIdle(r.g, dt, elapsed + r.ph);
    const u = r.g.userData, fl = r.done ? Math.sin(elapsed * 8 + r.ph) * 0.6 : Math.sin(elapsed * 18 + r.ph) * 0.6; u.wingL.rotation.z = -fl; u.wingR.rotation.z = fl;
  }
  for (let a = 0; a < world.racers.length; a++) for (let b = a + 1; b < world.racers.length; b++) {   // 상대 오리끼리 겹치지 않게
    const A = world.racers[a], B = world.racers[b];
    if (Math.abs(A.d - B.d) < 0.8 && Math.abs(A.lat - B.lat) < 0.75) { const p = (0.75 - Math.abs(A.lat - B.lat)) / 2, sg = A.lat >= B.lat ? 1 : -1; A.lat += sg * p; B.lat -= sg * p; }
  }
  if (state === 'playing' && !P.air) for (const r of world.racers) {   // 나와 부딪히면 서로 살짝 밀어냄 (하트는 안 줄어듦)
    const dx = P.x - r.x, dz = P.z - r.z, dd = Math.hypot(dx, dz);
    if (dd < 0.75 && Math.abs(P.y - r.y) < 0.8) {
      const s = world.samples[P.idx], side = (dx * s.nx + dz * s.nz) >= (r.lat - P.lat) * 0 ? 1 : -1, push = 0.75 - dd;
      P.x += s.nx * side * push * 0.6; P.z += s.nz * side * push * 0.6; r.lat -= side * push * 0.5;
      if (elapsed - (r.bumpT || -9) > 0.5) { r.bumpT = elapsed; Sfx.duckBump(); }
    }
  }
}
function updateRings(dt) {   // 💫 점프 링: 반짝 돌다가 날아서 통과하면 코인
  if (!world || !world.rings || !world.rings.length) return;
  for (const R of world.rings) {
    if (R.taken) { R.g.scale.multiplyScalar(1 + dt * 4); R.g.children.forEach(m => { m.material.transparent = true; m.material.opacity = Math.max(0, m.material.opacity - dt * 2.5); }); continue; }
    R.g.children[1].material.opacity = 0.25 + Math.sin(elapsed * 6) * 0.15;
    if (state !== 'playing' || !P.air || Math.abs(P.idx - R.idx) > 14) continue;
    const dx = P.x - R.x, dz = P.z - R.z, along = dx * R.tx + dz * R.tz, lat = dx * R.nx + dz * R.nz, up = P.y + 0.35 - R.y;
    if (Math.abs(along) < 0.4 && Math.hypot(lat, up) < 1.1) {
      R.taken = true; stats.rings = (stats.rings || 0) + 1;
      save.coins = (save.coins || 0) + 2; stats.coins += 2; updateCoinsHud(true);
      Sfx.power(); setTimeout(() => Sfx.coin(), 120);
      for (let k = 0; k < 12; k++) spawnSprite(starTex, R.x, R.y, R.z, (Math.random() - 0.5) * 4, (Math.random() - 0.3) * 3, (Math.random() - 0.5) * 4, 0.3, 0.8);
      showToast(t('ringToast'), 1100);
    }
  }
}
// 🌊 파도: 오리가 가까이 오면 앞쪽에서 물길 한쪽 절반을 따라 밀려옴 → 맞으면 확 느려짐 (반대쪽으로 피하면 됨)
const WAVE_V = 3.2;
function updateWaves(dt) {
  if (!world || !world.waves || !world.waves.length) return;
  const S = world.samples;
  for (const w of world.waves) {
    const near = w.d0 - P.prog;
    if (!w.on) {
      w.t -= dt;
      if (state === 'playing' && near > 2 && near < 16 && w.t <= 0) {
        w.on = true; w.d = w.d0; w.hit = false;
        w.big = Math.random() < 0.3;   // 🌊 가끔 두 배 크기 큰 파도
        if (w.big && near < 14) Sfx.whoosh();
      }
      w.g.visible = false; continue;
    }
    if (state === 'playing') w.d -= WAVE_V * (w.big ? 0.85 : 1) * dt;   // 물살을 거슬러 앞에서 다가옴 (큰 파도는 조금 느리게, 묵직하게)
    if (w.d < w.d1) { w.on = false; w.t = 1.2 + Math.random() * 1.5; w.g.visible = false; continue; }
    let i = w.idx; while (i < S.length - 1 && S[i + 1].d <= w.d) i++; while (i > 0 && S[i].d > w.d) i--;
    const s = S[i], lat = w.side * s.w / 2, grow = Math.min(1, (w.d0 - w.d) / 1.5) * Math.min(1, (w.d - w.d1) / 1.5);
    w.g.visible = true;
    w.g.position.set(s.x + s.nx * lat, s.y + 0.05 + Math.sin(elapsed * 9) * 0.03, s.z + s.nz * lat);
    w.g.rotation.y = Math.atan2(-s.tx, -s.tz);
    const B = w.big ? 2 : 1;   // 큰 파도: 높이·두께 2배
    w.g.scale.set(w.big ? 1.15 : 1, Math.max(0.05, grow) * B, B);
    // 출렁출렁: 덩이마다 위상이 달라 물결이 옆으로 흐르듯, 몸통은 앞뒤로 넘실
    for (const b of w.blobs) {
      const k = Math.sin(elapsed * 7 + b.ph + w.ph);
      b.body.scale.y = 0.36 * b.hk * (1 + 0.28 * k); b.body.position.y = 0.08 + 0.05 * k;
      b.foam.position.y = 0.36 * b.hk * (1 + 0.28 * k) + 0.05 * k; b.foam.scale.x = w.hw * (0.27 + 0.05 * Math.sin(elapsed * 11 + b.ph));
    }
    w.roll.rotation.x = 0.12 + Math.sin(elapsed * 5 + w.ph) * 0.12;
    w.lip.scale.y = 0.3 + 0.12 * Math.sin(elapsed * 9 + w.ph);
    // 물보라: 꼭대기에서 앞쪽(오리 쪽)으로 튐. 큰 파도는 훨씬 많이
    const sprayN = (w.big ? 40 : 18) * dt * grow;
    for (let n = Math.floor(sprayN) + (Math.random() < sprayN % 1 ? 1 : 0); n > 0; n--) {
      const o = (Math.random() - 0.5) * s.w * 0.9;
      spawnDrop(w.g.position.x + s.nx * o, s.y + 0.35 * B, w.g.position.z + s.nz * o, -s.tx * (1.5 + Math.random()) + (Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 1.5 * B, -s.tz * (1.5 + Math.random()) + (Math.random() - 0.5) * 0.6, w.big ? 0.09 : 0.065, 0.45);
    }
    // 나와 부딪힘: 파도가 있는 쪽 절반에서 앞뒤로 가까우면
    if (state === 'playing' && !P.air && grow > 0.5 && P.lat * w.side > (w.big ? 0 : 0.15) && Math.abs(P.prog - w.d) < 0.5 * B && elapsed - w.hitT > 0.8) {
      w.hitT = elapsed;
      const va = P.vx * s.tx + P.vz * s.tz, cut = va * (w.big ? 0.95 : 0.65);   // 보통 파도 -65%, 큰 파도는 거의 멈춤 + 뒤로 밀림
      P.vx -= s.tx * cut; P.vz -= s.tz * cut; P.boostT = 0;
      if (w.big) { P.vx -= s.tx * 1.6; P.vz -= s.tz * 1.6; Sfx.bump(); }
      Sfx.splash(w.big ? 0.9 : 0.5); burst(P.x, P.y + 0.3, P.z, w.big ? 28 : 14, w.big ? 3.2 : 2.2, 0.09, 0.6);
      if (w.big) showToast(t('bigWaveToast'), 1400);
      else if (!world.waveHint) { world.waveHint = true; showToast(t('waveToast'), 1500); }
    }
    for (const r of world.racers) {   // 상대 오리도 맞으면 잠깐 느려짐
      if (r.done || r.lat * w.side < 0.15 || Math.abs(r.d - w.d) > 0.5 || elapsed - (r.waveT || -9) < 0.8) continue;
      r.waveT = elapsed; r.slowT = w.big ? 1.4 : 0.7;
    }
  }
}
// 🧊 설원 레벨(51~): 가끔 뒤에서 작은 빙산이 빠르게 미끄러져 와 앞질러 감. 부딪히면 하트 반 개
// ---------- 🦅 독수리 (레벨 30~): 판마다 랜덤하게 한 번, 뒤에서 날아와 쫓아옴 ----------
// 천천히 가면 따라잡혀서 한 번 치고 날아감 (하트 반 개). 열심히 앞으로 헤엄치면 따돌림
// 🦅 독수리(레벨 30~) · 🐦 까마귀(레벨 20~)
// 이야기: 물길 옆 기둥 위에 앉아 있다가 → 오리가 다가오면 고개를 돌려 쳐다보고
//        → 오리가 지나가면 날아올라 뒤를 쫓아옴. 천천히 가면 덮침 (독수리: 하트 -½, 까마귀: 코인을 훔쳐 감)
const EAGLE_FROM = 30, CROW_FROM = 20, EAGLE_CHANCE = 0.7, EAGLE_START = 11;
const BIRD = {
  eagle: { perchH: 1.0, giveup: 6.5, speed: 2.3, warn: 'eagleWarn', miss: 'eagleMiss', block: 'eagleBlock', look: 'eagleLook', feather: 0x8a5a2b },
  crow:  { perchH: 0.9, giveup: 6, speed: 2.5, warn: 'crowWarn',  miss: 'crowMiss',  block: 'crowBlock',  look: 'crowLook',  feather: 0x2b2b33 },
};
const PERCH_PITCH = -0.12, LEG = 0.44;   // 앉아 있을 때 몸 기울기 · 발~몸 가운데
let eagle = null;
const eagleTmp = new THREE.Vector3(), eagleTmp2 = new THREE.Vector3();
function makeBird(kind) {
  const crow = kind === 'crow';
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const brown = toon(crow ? 0x1c1a24 : 0x6b4423), dark = toon(crow ? 0x0b0b0e : 0x47290f), white = toon(crow ? 0x2a2633 : 0xf7f3ea), beakC = toon(crow ? 0x2a2a30 : 0xf2b705);
  addOutlined(body, sph, brown, V(0, 0, 0), V(0.34, 0.3, 0.72));
  addOutlined(body, sph, white, V(0, 0.16, -0.68), V(0.25, 0.24, 0.27));
  const beak = new THREE.Mesh(new THREE.ConeGeometry(crow ? 0.08 : 0.09, crow ? 0.38 : 0.26, 8), beakC); beak.rotation.x = -Math.PI / 2 - (crow ? 0.28 : 0.35); beak.position.set(0, 0.1, crow ? -1.0 : -0.97); body.add(beak);
  if (crow) {   // 끝이 아래로 휜 갈고리 부리 + 머리 위 뾰족 깃털
    const hook = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 6), beakC); hook.rotation.x = -Math.PI * 0.8; hook.position.set(0, 0.02, -1.17); body.add(hook);
    for (let k = 0; k < 4; k++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.26 - k * 0.03, 5), toon(0x0b0b0e)); sp.position.set((k - 1.5) * 0.06, 0.42 - k * 0.02, -0.6 + k * 0.1); sp.rotation.x = 0.6 + k * 0.15; sp.rotation.z = (k - 1.5) * 0.25; body.add(sp); }
  }
  for (const sx of [-1, 1]) {
    if (crow) {   // 😈 까마귀: 빨갛게 빛나는 눈 + 잔뜩 찌푸린 굵은 눈썹
      const glow = new THREE.Mesh(sphLow, new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.35, depthWrite: false })); glow.scale.setScalar(0.1); glow.position.set(sx * 0.14, 0.23, -0.82); body.add(glow);
      const eye = new THREE.Mesh(sphLow, new THREE.MeshBasicMaterial({ color: 0xff3b1f })); eye.scale.set(0.06, 0.045, 0.04); eye.position.set(sx * 0.14, 0.23, -0.86); body.add(eye);
      const pupil = new THREE.Mesh(sphLow, new THREE.MeshBasicMaterial({ color: 0x1a0000 })); pupil.scale.set(0.014, 0.036, 0.02); pupil.position.set(sx * 0.14, 0.23, -0.895); body.add(pupil);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.045, 0.06), toon(0x0b0b0e)); brow.position.set(sx * 0.12, 0.29, -0.84); brow.rotation.z = sx * 0.62; body.add(brow);
    } else {
      const eye = new THREE.Mesh(sphLow, toon(0x1a1a1a)); eye.scale.setScalar(0.045); eye.position.set(sx * 0.14, 0.24, -0.84); body.add(eye);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.05), dark); brow.position.set(sx * 0.13, 0.3, -0.83); brow.rotation.z = sx * 0.35; body.add(brow);
    }
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.22, 6), beakC); leg.position.set(sx * 0.13, -0.32, 0.12); body.add(leg);
    const claw = new THREE.Mesh(sphLow, beakC); claw.scale.set(0.07, 0.04, 0.1); claw.position.set(sx * 0.13, -0.44, 0.08); body.add(claw);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.4), crow ? dark : white); tail.position.set(0, 0.02, 0.84); tail.rotation.x = -0.15; body.add(tail);
  const wings = [];
  for (const sx of [-1, 1]) {
    const pv = new THREE.Group(); pv.position.set(sx * 0.26, 0.1, -0.05); body.add(pv);
    addOutlined(pv, sph, brown, V(sx * 0.62, 0, 0), V(0.66, 0.05, 0.32));
    addOutlined(pv, sph, dark, V(sx * 1.12, 0, 0.08), V(0.32, 0.04, 0.22));
    if (crow) for (let k = 0; k < 4; k++) {   // 너덜너덜 날카로운 날개 끝 깃털
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.42, 4), dark); f.rotation.z = -sx * Math.PI / 2; f.rotation.y = sx * (k - 1.5) * 0.28;
      f.position.set(sx * (1.38 + (k % 2) * 0.05), 0, 0.02 + (k - 1.5) * 0.12); f.scale.y = 1 - Math.abs(k - 1.5) * 0.18; pv.add(f);
    }
    wings.push({ pv, sx });
  }
  const shadow = new THREE.Mesh(blobGeo, blobMat); shadow.rotation.x = -Math.PI / 2;
  g.userData = { body, wings, shadow, sc: crow ? 0.88 : 0.95 };
  g.scale.setScalar(g.userData.sc);
  return g;
}
// 기둥을 세울 자리: 코스 at 지점부터, 앞뒤로 점프·절벽·루프·기차·갈림길·폭포가 없고 평평한 직선 물길
function findPerch(at) {
  const S = world.samples, N = S.length;
  const bad = q => q.gap || q.cliff || q.loopZone || q.ramp || q.rail || q.fork || q.stone || q.fall || q.slide || q.lift || q.jet || q.island || q.pool || Math.abs(q.bank || 0) > 0.02;
  const okAt = i => {
    for (let k = i - 12; k < i + 44; k++) if (k < 0 || k >= N || bad(S[k])) return false;   // 기둥 앞뒤 (쳐다보고 날아오를 때까지)
    return Math.abs(S[i + 8].tx * S[i].nx + S[i + 8].tz * S[i].nz) < 0.2;   // 거의 곧은 곳
  };
  const i0 = S.findIndex(q => q.d >= at * world.total);
  for (let i = i0; i > 0 && i < N * 0.75; i += 3) if (okAt(i)) return i;
  for (let i = Math.round(N * 0.15); i < i0; i += 3) if (okAt(i)) return i;   // 그 뒤에 없으면 앞쪽에서
  return -1;
}
function resetEagle() {   // 판 시작마다: 이번 판에 나올지, 어떤 새인지, 어디 기둥에 앉아 있을지
  if (eagle) { world.group.remove(eagle.g); world.group.remove(eagle.g.userData.shadow); if (eagle.post) world.group.remove(eagle.post); eagle = null; }
  const n = levelIdx + 1;
  if (!world || world.raceK || n < CROW_FROM || Math.random() > EAGLE_CHANCE) return;
  const kind = n < EAGLE_FROM || Math.random() < 0.4 ? 'crow' : 'eagle';
  const g = makeBird(kind); g.visible = false; g.userData.shadow.visible = false;
  world.group.add(g); world.group.add(g.userData.shadow);
  eagle = { kind, cfg: BIRD[kind], g, phase: 'wait', at: 0.22 + Math.random() * 0.4, dist: EAGLE_START, t: 0, flap: 0, lat: 0, pitch: PERCH_PITCH, yaw: 0 };
  const pi = findPerch(eagle.at);
  if (pi < 0) return;   // 앉을 데가 없으면 예전처럼 하늘에서 갑자기 나타남
  const S = world.samples, s = S[pi], side = Math.random() < 0.5 ? 1 : -1, lat = side * (s.w + 0.45), PERCH_H = eagle.cfg.perchH;   // 난간 바로 바깥 기둥
  const post = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, PERCH_H + BASE_D, 10), toon(0x8a5a2b));
  pole.position.y = (PERCH_H - BASE_D) / 2; post.add(pole);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.06, 10), toon(0x6b4423)); cap.position.y = PERCH_H; post.add(cap);
  post.position.set(s.x + s.nx * lat, s.y, s.z + s.nz * lat);
  post.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  world.group.add(post);
  Object.assign(eagle, { phase: 'perch', post, pi, side, feet: new THREE.Vector3(post.position.x, s.y + PERCH_H + 0.03, post.position.z), yaw: Math.atan2(side * s.nx, side * s.nz) });
  g.visible = true;
}
function eagleBehind(dist) {   // 오리 뒤로 물길을 따라 dist만큼 떨어진 곳
  const S = world.samples, i = Math.max(0, P.idx - Math.round(dist / 0.25)), s = S[i];
  return { s, x: s.x + s.nx * P.lat, z: s.z + s.nz * P.lat };
}
function chaseOk() {   // 지금 쫓아오기 시작해도 되는지 (점프·절벽·루프·기차 앞이면 다음에)
  if (state !== 'playing' || P.air || P.loop || P.held || P.diveT > 0 || P.cart) return false;
  const S = world.samples;
  for (let i = P.idx; i < Math.min(S.length, P.idx + 48); i++) if (S[i].gap || S[i].cliff || S[i].loopZone || S[i].ramp || S[i].rail) return false;
  return true;
}
function startChase(e) {
  e.phase = 'chase'; e.t = 0;
  Sfx[e.kind](); showToast(t(e.cfg.warn), 1800);
}
function updatePerch(e, dt) {   // 🪵 기둥 위: 앉아 있기 → 쳐다보기 → 날아오르기
  const g = e.g, ud = g.userData, S = world.samples, ps = S[e.pi], sc = ud.sc;
  const ahead = ps.d - P.prog;   // 오리가 기둥까지 남은 거리 (지나가면 음수)
  if (e.phase === 'perch' && ahead < 7 && ahead > -3 && state === 'playing') {   // 👀 오리를 휙 쳐다봄
    e.phase = 'look'; e.t = 0; showToast(t(e.cfg.look), 1400);
  } else if (e.phase === 'look' && ahead > 12) e.phase = 'perch';   // 오리가 뒤로 떨어져 다시 출발하면 다시 가만히 앉아 있음
  if (e.phase === 'look') {
    e.t += dt;
    if (ahead < -4 && P.prog / world.total < 0.82 && chaseOk()) { e.phase = 'takeoff'; e.t = 0; Sfx.whoosh(); }
  }
  let pitchGoal = PERCH_PITCH, yawGoal = Math.atan2(e.side * ps.nx, e.side * ps.nz);
  if (e.phase === 'perch') {   // 기둥 위에 가만히 앉아 물길 쪽을 보며 살짝살짝 고개를 끄덕임
    pitchGoal = PERCH_PITCH + Math.sin(elapsed * 1.6) * 0.05;
  } else {   // 고개를 들고 오리를 바라봄 (고개 갸웃)
    pitchGoal = 0.12 + Math.sin(elapsed * 1.7) * 0.05;
    yawGoal = Math.atan2(-(P.x - e.feet.x), -(P.z - e.feet.z));
  }
  e.pitch += (pitchGoal - e.pitch) * damp(e.phase === 'perch' ? 5 : 9, dt);
  let dy = yawGoal - e.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); e.yaw += dy * damp(6, dt);
  // 발을 기둥 위에 붙인 채로 몸을 숙임: 몸 가운데 = 발 + (숙인 만큼 앞·위)
  const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw), up = LEG * Math.cos(e.pitch) * sc, fwd = -LEG * Math.sin(e.pitch) * sc;
  let lift = 0;
  if (e.phase === 'takeoff') {   // 🪽 퍼덕이며 위로 → 쫓아오기
    e.t += dt; lift = e.t * e.t * 3.2 + e.t * 1.5;
  }
  g.position.set(e.feet.x + fx * fwd, e.feet.y + up + lift, e.feet.z + fz * fwd);
  g.rotation.y = e.yaw; ud.body.rotation.x = e.phase === 'takeoff' ? e.pitch * Math.max(0, 1 - e.t) - 0.2 * e.t : e.pitch;
  const fly = e.phase === 'takeoff';
  for (const w of ud.wings) { w.pv.rotation.y = fly ? 0 : -w.sx * 1.5; w.pv.rotation.z = fly ? w.sx * Math.sin(e.flap * 13) * 0.7 : -w.sx * 0.12; }   // 앉아 있을 땐 날개를 뒤로 접음
  ud.shadow.visible = false;
  if (fly && (e.t > 0.9 || !chaseOk())) { e.dist = clamp(P.prog - ps.d, 4, EAGLE_START); startChase(e); }
}
function updateEagle(dt) {
  const e = eagle;
  if (!e || !world) return;
  const g = e.g, sh = g.userData.shadow, S = world.samples, flow = LEVELS[levelIdx].flow, cfg = e.cfg;
  if (state === 'paused') return;
  e.flap += dt;
  if (e.phase === 'perch' || e.phase === 'look' || e.phase === 'takeoff') { g.updateMatrixWorld(true); updatePerch(e, dt); if (e.phase !== 'chase') return; }
  if (e.phase === 'wait') {
    if (P.prog / world.total < e.at || !chaseOk()) return;
    if (P.prog / world.total > 0.82) { e.phase = 'done'; return; }
    e.dist = EAGLE_START;
    const b = eagleBehind(e.dist); g.position.set(b.x, b.s.y + 7, b.z); g.visible = true; sh.visible = true;
    startChase(e);
  }
  if (e.phase === 'done') return;
  const ud = g.userData;
  if (e.phase === 'chase') {
    sh.visible = true;
    for (const w of ud.wings) w.pv.rotation.y = 0;
    if (state === 'falling' || state === 'respawning' || state === 'failed' || state === 'win') { e.phase = 'leave'; e.t = 0; }
    else if (state === 'playing' && !P.air && !P.loop && !P.held && !(P.diveT > 0)) {
      const s = S[P.idx], va = P.vx * s.tx + P.vz * s.tz;
      e.t += dt;
      e.dist = clamp(e.dist - (flow + cfg.speed - va) * dt, 0, EAGLE_START + 3);   // 새는 물살보다 조금 빠름 → 그냥 떠가면 따라잡힘
      if (e.dist <= 0.5) {   // 덮침!
        e.phase = 'leave'; e.t = 0; e.hit = true;
        const sg = P.lat > 0 ? -1 : 1;   // 가운데 쪽으로 툭 (벽 없는 길에서 떨어지지 않게)
        P.vx = P.vx * 0.55 + s.nx * sg * 1.6; P.vz = P.vz * 0.55 + s.nz * sg * 1.6;
        Sfx.swoop(); Sfx.bump(); Sfx.quack(1.5);
        burst(P.x, P.y + 0.5, P.z, 14, 2.4, 0.09, 0.6);
        for (let i = 0; i < 10; i++) spawnDrop(P.x, P.y + 0.7, P.z, (Math.random() - 0.5) * 2.5, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 2.5, 0.06, 0.9, toon(cfg.feather));   // 깃털
        const steal = e.kind === 'crow' ? Math.min(3, stats.coins, save.coins || 0) : 0;
        if (shieldT > 0) showToast(t(cfg.block), 1400);
        else if (steal > 0) {   // 🐦 까마귀: 이번 판에 모은 코인을 몇 개 훔쳐 감
          save.coins -= steal; stats.coins -= steal; updateCoinsHud(true); persist();
          showToast(t('crowSteal', steal), 1600);
        } else {
          hearts = Math.max(0, hearts - 0.5); updateHeartsHud(true);
          if (hearts <= 0) { P.fallIdx = P.idx; outOfHearts(); }
          else showToast(t(e.kind === 'crow' ? 'crowHit' : 'eagleHit', hearts), 1500);
        }
      } else if (e.t > cfg.giveup) {   // 따돌림 성공
        e.phase = 'leave'; e.t = 0; Sfx[e.kind](); showToast(t(cfg.miss), 1500);
      }
    }
    const b = eagleBehind(e.dist), k = e.dist / EAGLE_START;
    const gy = b.s.y + 0.55 + 6.4 * k * k + Math.sin(e.flap * 3) * 0.15;
    // 화면 밖이면 오리 쪽으로 당겨서 화면 가장자리에 보이게 (카메라는 고정된 각도라 '뒤'가 화면 밖일 때가 많음)
    const tgt = eagleTmp.set(b.x, gy, b.z), py = P.y + 0.4;
    for (let f = 1; f > 0.2; f -= 0.08) {
      eagleTmp2.set(P.x + (b.x - P.x) * f, py + (gy - py) * f, P.z + (b.z - P.z) * f).project(camera);
      if (Math.abs(eagleTmp2.x) < 0.82 && eagleTmp2.y < 0.7 && eagleTmp2.y > -0.75) { tgt.set(P.x + (b.x - P.x) * f, py + (gy - py) * f, P.z + (b.z - P.z) * f); break; }
    }
    g.position.x += (tgt.x - g.position.x) * damp(8, dt); g.position.z += (tgt.z - g.position.z) * damp(8, dt);
    g.position.y += (tgt.y - g.position.y) * damp(6, dt);
    const dx = P.x - g.position.x, dz = P.z - g.position.z;
    g.rotation.y = Math.atan2(-dx, -dz);
    ud.body.rotation.x = -0.15 - 0.5 * (1 - k);   // 다가올수록 아래로 내리꽂음
  } else if (e.phase === 'leave') {   // 앞·위로 휙 날아가 사라짐
    e.t += dt;
    const fx = -Math.sin(g.rotation.y), fz = -Math.cos(g.rotation.y);
    g.position.x += fx * 11 * dt; g.position.z += fz * 11 * dt; g.position.y += (2 + e.t * 6) * dt;
    ud.body.rotation.x += (0.35 - ud.body.rotation.x) * damp(4, dt);
    if (e.t > 2.4) { e.phase = 'done'; g.visible = false; sh.visible = false; return; }
  }
  const tuck = e.phase === 'chase' && e.dist < 3 ? 0.35 : 1;   // 내리꽂을 땐 날개를 접듯이
  for (const w of ud.wings) w.pv.rotation.z = w.sx * (Math.sin(e.flap * (e.kind === 'crow' ? 14 : 11)) * 0.6 * tuck + (tuck < 1 ? 0.45 : 0.05));
  const si = nearestIdx(g.position.x, g.position.z, P.idx), ss = S[si], hgt = Math.max(0, g.position.y - ss.y);
  sh.position.set(g.position.x, ss.y + 0.06, g.position.z);
  sh.scale.setScalar(clamp(2.6 - hgt * 0.22, 0.8, 2.4)); sh.material = blobMat;
}

let iceberg = null, iceT = 6;
function makeIceberg() {
  const g = new THREE.Group();
  const ice = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), toon(0xdff6ff)); ice.scale.set(1.1, 0.85, 1); ice.position.y = 0.18; g.add(ice);
  const top = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), toon(0xf6fdff)); top.position.set(0.1, 0.62, 0.05); top.rotation.set(0.3, 0.5, 0.2); g.add(top);
  const blue = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), toon(0x9fd8f5)); blue.position.set(-0.3, 0.05, -0.15); g.add(blue);
  return g;
}
function updateIcebergs(dt) {
  if (!world || world.raceK || world.biome !== 'snow' || levelIdx + 1 < 51) return;
  const S = world.samples;
  if (!iceberg) {
    if (state !== 'playing' || P.cart || P.loop) return;   // 🚃 기차·루프 타는 중엔 안 옴
    iceT -= dt;
    if (iceT > 0) return;
    iceT = 7 + Math.random() * 7;
    const startI = P.idx - 44, endI = P.idx + 90;
    if (startI < 5 || endI >= S.length - 10) return;
    for (let i = startI; i < endI; i++) if (S[i].gap || S[i].ramp || S[i].fork || S[i].stone || S[i].rail || S[i].loopZone) return;   // 끊어진 곳·갈림길·기차 레일·루프가 있으면 이번엔 안 옴
    const g = makeIceberg(); world.group.add(g);
    const lane = [-0.55, 0, 0.55][Math.floor(Math.random() * 3)];
    iceberg = { g, d: S[startI].d, idx: startI, lane, v: LEVELS[levelIdx].flow * 2.3 + 2, warned: false, hit: false, spin: (Math.random() - 0.5) * 2 };
    return;
  }
  const B = iceberg;
  if (state === 'playing' || state === 'falling' || state === 'respawning') B.d += B.v * dt;
  let i = B.idx; while (i < S.length - 1 && S[i + 1].d <= B.d) i++; B.idx = i;
  if (S[i].rail || S[i].gap || S[i].loopZone) {   // 물길이 끝나는 곳(기차 레일 등)에 닿으면 첨벙 하고 사라짐
    burst(B.g.position.x, B.g.position.y + 0.2, B.g.position.z, 14, 2.2, 0.08, 0.5);
    world.group.remove(B.g); iceberg = null; return;
  }
  const s = S[i], s2 = S[Math.min(S.length - 1, i + 1)], fr = clamp((B.d - s.d) / ((s2.d - s.d) || 1), 0, 1);
  const lat = B.lane * s.w, x = lerp(s.x, s2.x, fr) + s.nx * lat, z = lerp(s.z, s2.z, fr) + s.nz * lat, y = lerp(s.y, s2.y, fr);
  B.g.position.set(x, y + Math.sin(elapsed * 6) * 0.03, z); B.g.rotation.y += B.spin * dt;
  if (Math.random() < dt * 20) spawnDrop(x + (Math.random() - 0.5) * 0.6, y + 0.1, z + (Math.random() - 0.5) * 0.6, -s.tx * 1.5, 0.8 + Math.random(), -s.tz * 1.5, 0.06, 0.35);
  if (!B.warned && P.prog - B.d < 7) { B.warned = true; Sfx.whoosh(); showToast(t('icebergWarn'), 1300); }   // 다가오면 경고
  if (!B.hit && state === 'playing' && !P.air && Math.hypot(P.x - x, P.z - z) < 0.6 + DUCK_R && Math.abs(P.y - y) < 1) {
    B.hit = true;
    const nx = P.x - x, nz = P.z - z, L = Math.hypot(nx, nz) || 1;
    // 🧊 하트는 안 잃는 대신 쾅! 하고 앞쪽으로 크게 밀려남 (옆으로는 조금만 → 바로 떨어지진 않게)
    P.vx += nx / L * 2.2 + s.tx * 7; P.vz += nz / L * 2.2 + s.tz * 7; P.boostT = 0;
    Sfx.bump(); Sfx.splash(0.5); Sfx.quack(1.5); burst(P.x, P.y + 0.4, P.z, 22, 3.2, 0.1, 0.6);
    showToast(t('icebergHit'), 1400);
  }
  if (B.d > P.prog + 26 || i >= S.length - 12) { world.group.remove(B.g); iceberg = null; }
}
const racePlaceNow = () => world.racePlace || 1 + world.racers.filter(r => r.done || r.d > P.prog).length;   // 들어온 뒤엔 그 순위 고정
function setupRaceBar() {
  const bar = $('#raceBar');
  $('#hint').classList.toggle('in-race', !!world.raceK);   // 레이스 땐 알림을 상태바 아래로
  if (!world.raceK) { bar.classList.add('hidden'); return; }
  bar.querySelector('.rb-track').innerHTML = world.racers.map((r, j) => `<span class="rb-icon rb-r" data-j="${j}">${r.icon}</span>`).join('') +
    '<span id="rbMe" class="rb-icon rb-me">🐤</span><span class="rb-flag"></span>';
  bar.classList.remove('hidden');
}
function updateRaceBar2() {
  const S = world.samples, d0 = S[START_I].d, d1 = world.total, f = v => clamp((v - d0) / (d1 - d0), 0, 1) * 100 + '%';
  const me = $('#rbMe'); if (me) me.style.left = f(P.prog);
  for (const el of document.querySelectorAll('#raceBar .rb-r')) el.style.left = f(world.racers[+el.dataset.j].d);
}
// ---------- 🏁 라이벌 레이스 ----------
const RIVAL_ICON = { kid: '🐥', bolt: '😎', champ: '👑' };
function updateRace(dt) {
  const R = world && world.race;
  if (!R || R.st === 'done' && R.gone) return false;
  const S = world.samples, sb = S[R.b];
  const place = () => {   // 라이벌 위치: 물길을 따라 거리 R.d 만큼
    let i = clamp(R.a + Math.round((R.d - S[R.a].d) / 0.25), 0, S.length - 1);
    while (i < S.length - 1 && S[i + 1].d <= R.d) i++; while (i > 0 && S[i].d > R.d) i--;
    const s = S[i]; R.idx = i;
    R.lat = clamp(R.lat, -s.w + 0.5, s.w - 0.5);
    const x = s.x + s.nx * R.lat, z = s.z + s.nz * R.lat;
    R.rival.position.set(x, s.y, z);
    let dy = Math.atan2(-s.tx, -s.tz) - R.rival.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); R.rival.rotation.y += dy * Math.min(1, dt * 8);
    cuteIdle(R.rival, dt, elapsed);
    const u = R.rival.userData, fl = Math.sin(elapsed * (R.st === 'run' ? 20 : 6)) * (R.st === 'run' ? 0.7 : 0.12); u.wingL.rotation.z = -fl; u.wingR.rotation.z = fl;
  };
  if (R.st === 'wait') {
    place();
    if (P.idx >= R.a - 3) {   // 출발선 도착 → 3, 2, 1, 출발!
      R.st = 'count'; R.t = 0; R.lat = (P.lat >= 0 ? -1 : 1) * 0.5 * S[R.a].w; R.d = S[R.a].d - 0.3;
      P.vx = P.vz = 0; Sfx.quack(0.9); showToast(t('raceReady', t('rival_' + R.kind)), 2100);
      $('#raceBar').classList.remove('hidden'); $('#rbRival').textContent = RIVAL_ICON[R.kind];
      showCount('3', false); Sfx.beep(false); R.shown = 3;
    }
    return false;
  }
  if (R.st === 'count') {
    R.t += dt; P.vx = P.vz = 0; place();
    const k = 3 - Math.floor(R.t / 0.75);
    if (k >= 1 && k < R.shown) { R.shown = k; showCount(String(k), false); Sfx.beep(false); }
    if (R.t >= 2.25) {
      R.st = 'run'; showCount(t('go'), true); Sfx.beep(true); Sfx.whoosh();
      setTimeout(() => $('#countdown').classList.add('hidden'), 600);
    }
    updateRaceBar(R);
    return true;
  }
  if (R.st === 'run') {
    const gap = P.prog - R.d;   // 내가 앞서면 +
    const mul = clamp(1 + gap * 0.05, 0.86, 1.18);   // 고무줄: 너무 벌어지지 않게 (끝까지 엎치락뒤치락)
    R.d += (LEVELS[levelIdx].flow + R.extra) * mul * dt;
    R.lat += (Math.sin(elapsed * 0.7 + 1) * 0.3 * S[R.idx || R.a].w - R.lat) * Math.min(1, dt * 0.8);
    place();
    const dx = P.x - R.rival.position.x, dz = P.z - R.rival.position.z, dd = Math.hypot(dx, dz);   // 부딪히면 서로 살짝 밀어냄
    if (dd < 0.75 && Math.abs(P.y - R.rival.position.y) < 1) {
      const s = S[P.idx], side = (dx * s.nx + dz * s.nz) >= 0 ? 1 : -1, push = (0.75 - dd);
      P.x += s.nx * side * push * 0.6; P.z += s.nz * side * push * 0.6; R.lat -= side * push * 0.4;
      if (elapsed - R.bumpT > 0.5) { R.bumpT = elapsed; Sfx.duckBump(); }
    }
    updateRaceBar(R);
    if (P.prog >= sb.d) endRace(true);
    else if (R.d >= sb.d) endRace(false);
    return false;
  }
  if (R.st === 'done') {   // 끝난 뒤: 라이벌은 조금 더 가다가 작아지며 사라짐
    R.t += dt; R.d += LEVELS[levelIdx].flow * 0.8 * dt; place();
    const k = clamp(1 - (R.t - 2) / 0.6, 0, 1); R.rival.scale.setScalar(growScale(levelIdx + 1) * k);
    if (k <= 0) { R.rival.visible = false; R.gone = true; }
  }
  return false;
}
function updateRaceBar(R) {
  const S = world.samples, d0 = S[R.a].d, d1 = S[R.b].d, f = v => clamp((v - d0) / (d1 - d0), 0, 1) * 100 + '%';
  $('#rbMe').style.left = f(P.prog); $('#rbRival').style.left = f(R.d);
}
function endRace(win, fell) {
  const R = world.race;
  R.st = 'done'; R.t = 0; R.won = win;
  setTimeout(() => $('#raceBar').classList.add('hidden'), 1200);
  if (win) {
    save.coins = (save.coins || 0) + R.reward; stats.coins += R.reward; updateCoinsHud(true);
    for (let k = 0; k < 4; k++) setTimeout(() => Sfx.coin(), k * 110);
    Sfx.power();
    for (let k = 0; k < 16; k++) spawnSprite(starTex, P.x, P.y + 0.8, P.z, (Math.random() - 0.5) * 5, 3 + Math.random() * 3, (Math.random() - 0.5) * 5, 0.32, 1.1);
    showToast(t('raceWin', R.reward), 2200);
  } else if (!fell) { Sfx.quack(0.8); showToast(t('raceLose'), 2000); }
}
function showCount(txt, go) {
  const el = $('#countdown'); el.textContent = txt; el.classList.remove('hidden', 'go');
  void el.offsetWidth; el.classList.add('go');
}
function updateHud() {
  const p = clamp((P.prog - world.samples[START_I].d) / (world.total - world.samples[START_I].d), 0, 1);
  $('#progFill').style.width = (p * 100) + '%';
  $('#progDuck').style.left = (p * 100) + '%';
  const el = $('#hudTime');
  if (world.raceK) {   // 🏁 레이스: 지금 순위
    el.textContent = t('placeHud', racePlaceNow(), world.racers.length + 1); el.classList.remove('urgent'); el.classList.add('race');
    updateRaceBar2();
    return;
  }
  el.classList.remove('race');
  const left = Math.max(0, world.limit - timeT);   // 타임어택: 남은 시간
  el.textContent = Math.ceil(left);   // 초 단위만
  el.classList.toggle('urgent', left < 5);
}
function showPopup({ icon, title, text, buttons }) {
  $('#popIcon').textContent = icon || ''; $('#popIcon').style.display = icon ? '' : 'none';   // 아이콘 없으면 자리도 비우지 않음
  $('#popTitle').textContent = title; $('#popText').innerHTML = text;
  const box = $('#popButtons'); box.innerHTML = '';
  for (const [label, fn, secondary] of buttons) {
    const b = document.createElement('button'); b.textContent = label;
    if (secondary) b.className = typeof secondary === 'string' ? secondary : 'secondary';   // 문자열이면 그 클래스 그대로
    b.onclick = () => { Sfx.click(); fn(b); };
    box.appendChild(b);
  }
  joyZone.classList.add('hidden'); joyReset();
  show('#popup');
}

// 레벨 선택: 20개씩 페이지로 나눠 보여줌
const PAGE_SIZE = 20;
let levelPage = 0;
// 열린 레벨이 있는 페이지까지만 보여 줌 (다음 페이지는 그 첫 레벨이 열려야 나타남)
const pageCount = () => Math.min(Math.ceil(LEVELS.length / PAGE_SIZE), Math.floor((Math.max(1, save.unlocked) - 1) / PAGE_SIZE) + 1);
function openLevels() {
  state = 'levels';
  $('#hud').classList.add('hidden'); joyZone.classList.add('hidden');
  levelPage = Math.min(pageCount() - 1, Math.floor((save.unlocked - 1) / PAGE_SIZE));   // 진행 중인 페이지부터
  $('#btnWardrobe').textContent = `${t('wardrobe')} ⭐${totalStars()}`;
  renderLevelPage();
  show('#levels');   // 뒤 배경은 그대로 (첫 화면 연못 / 하던 코스 위에 레벨 화면이 뜸)
  if (!world) loadLevel(save.unlocked - 1);
}
// 최고 기록: 어려움은 save.best (예전 기록 그대로), 보통은 save.bestN
function bestFor() { if (isHard()) return save.best; return save.bestN || (save.bestN = {}); }
function renderDiff() {
  for (const b of document.querySelectorAll('#diffToggle button')) b.classList.toggle('on', b.dataset.d === (isHard() ? 'hard' : 'normal'));
}
for (const b of document.querySelectorAll('#diffToggle button')) b.onclick = () => {
  const d = b.dataset.d;
  if ((d === 'hard') === isHard()) return;
  Sfx.click(); save.diff = d; persist(); renderDiff(); renderLevelPage();
  if (world && !inGame() && !suspended && state !== 'levels') loadLevel(levelIdx);   // 이어할 게임이 있으면 코스는 그대로 (다음 판부터 적용)
};
// ▶ 이어하기: 일시정지 → 레벨 선택으로 나온 경우, 멈춰 둔 그 게임을 그 자리에서 계속
let suspended = null;
function resumeSuspended() {
  if (!suspended || !world) return;
  const prev = suspended.prev; suspended = null;
  $('#hud').classList.remove('hidden');
  show(null); state = prev; lastT = performance.now(); setControlMode(controlMode);
}
function renderRaceRow() {   // 🏁 이 페이지의 레이스 (레벨 10·20 … 을 깨면 열림)
  const row = $('#raceRow'); row.innerHTML = '';
  for (const k of [levelPage * 2 + 1, levelPage * 2 + 2]) {
    if (k > 6) continue;
    const open = TEST_UNLOCK || levelCleared(10 * k), rec = raceRec(k);
    const b = document.createElement('button');
    b.className = 'race-btn' + (open ? '' : ' locked');
    b.innerHTML = `<span class="rn">${t('raceName', k)}</span>` + (open
      ? `<span class="rs">${starsHtml(starCount(rec.mask), 'small')}${rec.best ? ' ' + t('raceBest', rec.best) : ''}</span>`
      : `<span class="rs">🔒 ${t('raceLocked', 10 * k)}</span>`);
    if (open) b.onclick = () => { Sfx.click(); startLevel(99 + k); };
    row.appendChild(b);
  }
}
function renderLevelPage() {
  renderDiff(); renderRaceRow();
  $('#btnContinue').classList.toggle('hidden', !suspended);
  if (suspended) $('#btnContinue').textContent = t('continuePlay', levelIdx + 1);
  const from = levelPage * PAGE_SIZE, to = Math.min(LEVELS.length, from + PAGE_SIZE);
  $('#pgLabel').textContent = `${from + 1} ~ ${to}`;
  $('#pgPrev').disabled = levelPage === 0;
  $('#pgNext').disabled = levelPage >= pageCount() - 1;
  $('#pgPrev').style.visibility = levelPage === 0 ? 'hidden' : '';
  $('#pgNext').style.visibility = levelPage >= pageCount() - 1 ? 'hidden' : '';   // 아직 안 열린 페이지는 화살표도 숨김
  const grid = $('#levelGrid'); grid.innerHTML = '';
  for (let i = from; i < to; i++) {
    const n = i + 1, locked = n > save.unlocked;
    const b = document.createElement('button');
    b.className = 'level-btn' + (locked ? ' locked' : '');
    b.innerHTML = `<span class="num">${locked ? '🔒' : n}</span>` +
      (locked ? '' : starsHtml(starCount(save.missions[n] || 0), 'small')) +
      `<span class="best">${bestFor()[n] ? bestFor()[n].toFixed(1) + 's' : (locked ? '' : '-')}</span>`;
    b.onclick = () => { Sfx.click(); startLevel(i); };
    grid.appendChild(b);
  }
}
$('#btnContinue').onclick = () => { Sfx.click(); resumeSuspended(); };
$('#pgPrev').onclick = () => { if (levelPage > 0) { Sfx.click(); levelPage--; renderLevelPage(); } };
$('#pgNext').onclick = () => { if (levelPage < pageCount() - 1) { Sfx.click(); levelPage++; renderLevelPage(); } };

const levelLabel = () => world && world.raceK ? t('raceName', world.raceK) : `Level ${levelIdx + 1}`;
function startLevel(i) {
  $('#btnControl').style.visibility = ''; $('#btnCalib').style.visibility = '';   // 도착 때 숨긴 조작 버튼 되살림
  Sfx.init(); Sfx.setSong(LEVELS[i].theme || themeFor(i + 1)); Sfx.bgmStart();
  loadLevel(i);
  $('#raceBar').classList.add('hidden'); setupRaceBar();
  particles.slice().forEach(p => { p.life = 0; });
  show(null);
  $('#hud').classList.remove('hidden');
  const L = LEVELS[i];
  $('#hudLevel').textContent = `${levelLabel()} · ${t(isHard() ? 'diffHard' : 'diffNormal')}`; updateCoinsHud();
  state = 'countdown'; countT = 3;
  snapCamera();
  setControlMode(controlMode);
  showCount('3', false); Sfx.beep(false);
  updateHud();
  setTimeout(() => Sfx.quack(), 200);
  const hint = $('#hint');
  if (L.race) {
    hint.textContent = t('hintRace', L.race + 1);
    hint.classList.remove('hidden');
    setTimeout(() => hint.classList.add('hidden'), 3500);
  } else if (i === 0) {
    hint.textContent = controlMode === 'gyro' ? t('hintGyro') : t('hintJoy');
    hint.classList.remove('hidden');
    setTimeout(() => hint.classList.add('hidden'), 6000);
  } else if (L.pieces.some(p => p.walls === 'none') && i === 1) {
    hint.textContent = t('hintCross');
    hint.classList.remove('hidden');
    setTimeout(() => hint.classList.add('hidden'), 5000);
  } else if (i + 1 === LEVELS.length || (i > 0 && i % 10 === 0)) {
    hint.textContent = i + 1 === LEVELS.length ? t('hintFinal') : t('hintGrow');
    hint.classList.remove('hidden');
    setTimeout(() => hint.classList.add('hidden'), 5000);
  } else if ([7, 8, 13, 16, 20, 21, 25, 30, 35].includes(i + 1)) {
    hint.textContent = t({ 7: 'hintLog', 8: 'hintBoost', 13: 'hintWhirl', 16: 'hintFork', 20: 'hintMill', 21: 'hintClock', 25: 'hintFountain', 30: 'hintCrab', 35: 'hintJump' }[i + 1]);
    hint.classList.remove('hidden');
    setTimeout(() => hint.classList.add('hidden'), 5000);
  } else if ((i + 1) % 5 === 0 && i > 0) {
    hint.textContent = t('hintBabies', world.babies.length);
    hint.classList.remove('hidden');
    setTimeout(() => hint.classList.add('hidden'), 5000);
  } else if (L.pieces.some(p => p.t === 'F') && (i + 1) % 5 === 1) {
    const nf = L.pieces.filter(p => p.t === 'F').length;
    hint.textContent = t('hintFalls', nf);
    hint.classList.remove('hidden');
    setTimeout(() => hint.classList.add('hidden'), 5000);
  } else hint.classList.add('hidden');
}

let playSaveT = 0;
function pauseGame() {
  if (state !== 'playing' && state !== 'countdown') return;
  const prev = state; state = 'paused';
  persist();
  showPauseMenu(prev);
}
function showPauseMenu(prev) {
  showPopup({
    icon: '', title: t('pauseTitle'), text: `${levelLabel()} · ${t(isHard() ? 'diffHard' : 'diffNormal')}` + missionListHtml(null, world.raceK ? raceRec(world.raceK).mask : save.missions[levelIdx + 1] || 0),
    buttons: [
      [t('resume'), () => { show(null); state = prev; lastT = performance.now(); setControlMode(controlMode); }],
      [t('restart'), () => startLevel(levelIdx), true],
      [t('levels'), () => { suspended = { prev }; openLevels(); }, true],   // 하던 게임은 멈춘 채로 보관 → 레벨 화면에서 이어하기
      [musicLabel(), b => { Sfx.setMusic(!Sfx.isMusicOn()); b.textContent = musicLabel(); }, true],
    ],
  });
  // 언어 선택: 한국어 / English (바꾸면 화면의 모든 글자가 즉시 바뀜)
  const row = document.createElement('div');
  row.className = 'lang-row';
  row.innerHTML = `<span>${t('language')}</span>`;
  for (const [code, label] of [['ko', '한국어'], ['en', 'English']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = LANG === code ? 'on' : '';
    b.onclick = () => {
      Sfx.click();
      setLang(code);
      setControlMode(controlMode);   // 조작 버튼 글자도 갱신
      $('#joyZone').classList.add('hidden');
      showPauseMenu(prev);
    };
    row.appendChild(b);
  }
  $('#popButtons').appendChild(row);
  const pt = document.createElement('div');   // ⏱ 누적 플레이 시간: 맨 아래
  pt.className = 'play-time'; pt.textContent = t('playTime', save.playTime || 0);
  $('#popButtons').appendChild(pt);
  const pp = document.createElement('a');   // 🔒 개인정보처리방침 (앱에선 휴대폰 브라우저로 열림)
  pp.className = 'privacy-link'; pp.href = PRIVACY_URL; pp.target = '_blank'; pp.rel = 'noopener'; pp.textContent = t('privacy');
  $('#popButtons').appendChild(pp);
}
const musicLabel = () => Sfx.isMusicOn() ? t('musicOn') : t('musicOff');

$('#btnStart').onclick = async () => {
  Sfx.init(); Sfx.click(); Sfx.quack();
  gyroAvailable = await detectGyro();
  controlMode = gyroAvailable ? 'gyro' : 'joy';   // PRD 4: 자이로 기본, 미지원/거부 시 조이스틱
  try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('portrait').catch(() => {}); } catch (e) {}
  openLevels();
};
// 🎨 메인 화면 테마 선택 (앱에서도 보임). 기본은 시스템 = 실제 시각에 따라 낮·노을·밤
(() => {
  const box = $('#themeTest');
  const cur = () => { try { return localStorage.getItem('duckwaterway.titleTheme') || ''; } catch (e) { return ''; } };
  const mark = () => { for (const b of box.querySelectorAll('button')) b.classList.toggle('on', b.dataset.t === cur()); };
  for (const b of box.querySelectorAll('button')) b.onclick = () => {
    try { if (b.dataset.t) localStorage.setItem('duckwaterway.titleTheme', b.dataset.t); else localStorage.removeItem('duckwaterway.titleTheme'); } catch (e) {}
    Sfx.click(); mark();
    if (state === 'title') { titleScene = false; showTitleScene(); }   // 바로 다시 그림
  };
  mark();
})();
$('#btnBackTitle').onclick = () => { Sfx.click(); state = 'title'; showTitleScene(); show('#title'); };

// ---------- 꾸미기 화면 ----------
let wdFromTitle = false;
function openWardrobe() {
  wdFromTitle = titleScene;
  state = 'wardrobe';
  if (titleScene) loadLevel(save.unlocked - 1);   // 꾸미기는 코스 위에서 (오리 정면 카메라)
  renderWardrobe();
  show('#wardrobe');
}
function renderWardrobe() {
  const total = totalStars();
  $('#wdStars').textContent = t('starsTotal', total, 60 * 3 + 6 * 3) + `  ·  🪙 ${save.coins || 0}`;   // 레벨 60개 + 레이스 6개, 각 별 3개
  const next = [...LOOKS].sort((a, b) => a.need - b.need).find(l => l.need > total && !lookUnlocked(l));
  $('#wdNext').textContent = TEST_UNLOCK ? t('testUnlock') : next ? t('nextUnlock', next.icon, lookName(next), next.need - total) : t('allUnlocked');
  const grid = $('#wdGrid'); grid.innerHTML = '';
  // 리본·튜브·모자·안경·목도리는 분류 버튼 하나씩 → 누르면 3가지가 팝업. 특별 아이템은 버튼 하나씩 그대로
  for (const cat of LOOK_CATS.filter(c => c !== 'special')) {
    const items = LOOKS.filter(x => x.cat === cat), opened = items.filter(lookUnlocked);
    const worn = items.find(l => save.equip[l.slot] === l.id && lookUnlocked(l));
    const pick = worn || opened[0];
    const b = document.createElement('button');
    b.className = 'look-btn cat-btn' + (opened.length ? '' : ' locked') + (worn ? ' on' : '');
    const hue = pick && pick.hue ? ` style="filter:hue-rotate(${pick.hue}deg)"` : '';
    b.innerHTML = `<span class="look-icon"${hue}>${pick ? pick.icon : '🔒'}</span><span class="look-name">${t('cat_' + cat)}</span>` +
      `<span class="look-sub">${worn ? lookName(worn) : opened.length ? `${opened.length}/${items.length}` : '⭐ ' + Math.min(...items.map(l => l.need))}</span>`;
    b.onclick = () => { Sfx.click(); openLookPop(cat); };
    grid.appendChild(b);
  }
  for (const l of LOOKS.filter(x => x.cat === 'special')) grid.appendChild(lookButton(l));
  if (wdPopCat) renderLookPop();
}
// 꾸미기 버튼 하나
function lookButton(l) {
  const open = lookUnlocked(l), on = save.equip[l.slot] === l.id;
  const b = document.createElement('button');
  b.className = 'look-btn' + (open ? '' : ' locked') + (on ? ' on' : '') + (l.slot === 'home' ? ' reward' : '');
  const hue = open && l.hue ? ` style="filter:hue-rotate(${l.hue}deg)"` : '';
  b.innerHTML = `<span class="look-icon"${hue}>${open ? l.icon : '🔒'}</span><span class="look-name">${lookName(l)}</span>` +
    `<span class="look-sub">${!open ? '⭐ ' + l.need : l.slot === 'home' ? t('homeReward') : on ? t('equipped') : ''}</span>` +
    (!open && lookBuyable(l) ? `<span class="look-buy">${t('lookBuy', lookPrice(l))}</span>` : '');
  if (!open && lookBuyable(l)) {   // 🪙 아직 안 열린 꾸미기: 코인으로 바로 사기
    b.classList.add('buy'); if ((save.coins || 0) < lookPrice(l)) b.classList.add('poor');
    b.onclick = () => {
      const price = lookPrice(l), have = save.coins || 0;
      if (have < price) { Sfx.bump(); showToast(t('lookPoor', price - have), 1400); return; }
      save.coins = have - price; (save.looksBought = save.looksBought || {})[l.id] = true;
      if (l.slot !== 'home') save.equip[l.slot] = l.id;   // 산 건 바로 입어 봄
      persist(); updateCoinsHud(true); applyLook(); renderWardrobe();
      Sfx.coin(); setTimeout(() => Sfx.power(), 120); Sfx.quack(1.2); burst(P.x, P.y + 0.8, P.z, 14, 2, 0.07, 0.6);
      showToast(t('lookBought', l.icon, lookName(l)), 1500);
    };
  }
  if (open && l.slot !== 'home') b.onclick = () => {
    Sfx.click();
    save.equip[l.slot] = on ? null : l.id;   // 같은 걸 다시 누르면 벗기
    persist(); applyLook(); renderWardrobe();
    if (!on) { Sfx.quack(1.2); burst(P.x, P.y + 0.8, P.z, 10, 1.8, 0.07, 0.6); }
  };
  return b;
}
// 분류 팝업: 그 분류의 3가지 중에서 고르기 (고른 뒤에도 열려 있어서 바로 비교 가능)
let wdPopCat = null;
function openLookPop(cat) { wdPopCat = cat; renderLookPop(); $('#wdPop').classList.remove('hidden'); }
function closeLookPop() { wdPopCat = null; $('#wdPop').classList.add('hidden'); }
function renderLookPop() {
  $('#wdPopTitle').textContent = t('cat_' + wdPopCat);
  const box = $('#wdPopItems'); box.innerHTML = '';
  for (const l of LOOKS.filter(x => x.cat === wdPopCat)) box.appendChild(lookButton(l));
}
$('#wdPop').onclick = e => { if (e.target.id === 'wdPop') { Sfx.click(); closeLookPop(); } };
$('#btnWdPopClose').onclick = () => { Sfx.click(); closeLookPop(); };
$('#btnWardrobe').onclick = () => { Sfx.click(); openWardrobe(); };
$('#btnShop').onclick = () => { Sfx.click(); openShop(); };
$('#btnShopBack').onclick = () => closeShop();
$('#btnWardrobeBack').onclick = () => { Sfx.click(); closeLookPop(); if (wdFromTitle) { state = 'levels'; showTitleScene(); } openLevels(); };
$('#btnPause').onclick = () => { Sfx.click(); pauseGame(); };
$('#btnControl').onclick = () => { Sfx.click(); if (gyroAvailable) setControlMode(controlMode === 'gyro' ? 'joy' : 'gyro'); };
$('#btnCalib').onclick = () => { Sfx.click(); calibrate(); };
const muteBtn = $('#btnMute');
const syncMute = () => { muteBtn.textContent = Sfx.isMuted() ? '🔇' : '🔊'; };
muteBtn.onclick = () => { Sfx.init(); Sfx.setMuted(!Sfx.isMuted()); syncMute(); };
syncMute();

// 📱 안드로이드 뒤로 가기 버튼 (앱에서만): 게임 중엔 일시정지, 메뉴에선 한 단계 뒤로, 첫 화면에서만 앱 종료
(() => {
  const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (!App || !App.addListener) return;
  App.addListener('backButton', () => {
    if (state === 'playing' || state === 'countdown') { pauseGame(); return; }
    if (state === 'paused') { const b = document.querySelector('#popButtons button'); if (b) b.click(); return; }   // 계속하기
    if (state === 'wardrobe') { if (wdPopCat) closeLookPop(); else $('#btnWardrobeBack').click(); return; }
    if (state === 'shop') { closeShop(); return; }
    if (state === 'levels') { $('#btnBackTitle').click(); return; }
    if (state === 'title') App.exitApp();
    // 도착·실패 화면에선 아무것도 안 함 (실수로 앱이 꺼지지 않게)
  });
})();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pauseGame(); Sfx.suspend(); } else Sfx.resume();
});

let baseFov = 72, fovBoost = 0;
const appEl = $('#app');
function resize() {
  const w = appEl.clientWidth, h = appEl.clientHeight;   // 앱 프레임 크기 기준
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  baseFov = w / h < 0.8 ? 72 : 56; camera.fov = baseFov + fovBoost;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
applyLang();   // 저장된 언어로 첫 화면 글자 채우기
applyLook();   // 저장된 꾸미기 입히기
resize();

// 타이틀 배경: 레벨 1 연못에서 가족과 함께
showTitleScene();
requestAnimationFrame(frame);

// 디버그/테스트용 훅
if (DEV_BUILD) window.__duck = { P, get state() { return state; }, startLevel, LEVELS, input, keys, tick, respawn, get heartItem() { return heartItem; }, get hearts() { return hearts; }, get shieldT() { return shieldT; }, get world() { return world; }, get duck() { return duck; }, camera, renderer, scene, THREE, applyLook, get save() { return save; }, get iceberg() { return iceberg; }, get eagle() { return eagle; }, setIceT(v) { iceT = v; } };
})();
