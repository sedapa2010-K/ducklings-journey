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
const lakeYFor = n => -1.3 - Math.floor((n - 1) / 5) * 4;   // 1~5: 수면 바로 위(-1.3), 6~10: -5.3, ... 56~60: -45.3
let LAKE_Y = -6;          // 현재 레벨의 호수 높이
const FALL_BOOST = 14;    // 폭포 경사에서 받는 앞쪽 가속
const SHIELD_TIME = 5;    // 방패 아이템: 양쪽 벽이 세워지는 시간(초)
const MAX_HEARTS = 5;     // 하트(목숨) 기본 개수
const JUMP_G = 12;        // 점프 중 중력
const JUMP_VY = 0.6;      // 점프대 끝에서 앞으로 가는 속도 × 이 값 만큼 위로 튀어오름
const GYRO_FULL_DEG = 22; // 이 각도만큼 기울이면 최대 입력
const GYRO_DEAD_DEG = 2.5;

// ---------- 저장 (PRD 6.2: 해금 상태/기록) ----------
const SAVE_KEY = 'duckwaterway.v1';
let save = { unlocked: 1, best: {}, missions: {}, equip: {} };   // missions[레벨] = 성공한 미션 비트(1·2·4)
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (s && s.unlocked) save = Object.assign(save, s);
  if (!save.missions) save.missions = {};
  if (!save.equip) save.equip = {};
  if (save.equip.head === 'beanie') save.equip.head = 'santa';   // 털모자 → 산타 모자로 바뀜
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
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x5a4632, side: THREE.BackSide });

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
  // 흐름 방향 표시 (위쪽 = 물이 흐르는 방향)
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 7; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(w / 2 - 22, 150); g.lineTo(w / 2, 128); g.lineTo(w / 2 + 22, 150); g.stroke();
});
waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
const waterMat = new THREE.MeshToonMaterial({ map: waterTex, gradientMap: gradTex, transparent: true, opacity: 0.93, side: THREE.DoubleSide });

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
const foamTex = canvasTex(64, 64, (g, w, h) => {
  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.5})`;
    g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 0, Math.PI * 2); g.fill();
  }
});
foamTex.wrapS = foamTex.wrapT = THREE.RepeatWrapping;
const foamMat = new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });

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
  day:    { bg: SKY,      fog: [45, 120], hemi: [0xffffff, 0xb8d8c0, 0.75], sun: [0xfff4e0, 0.75], sunOff: [8, 20, 6],  lake: 0x4f8fd6, cloud: 0xffffff, glow: 0 },
  sunset: { bg: 0xf59a7a, fog: [30, 110], hemi: [0xffe6d2, 0x6f78c8, 0.7], sun: [0xffb784, 0.75], sunOff: [16, 8, 3], lake: 0x5b5fb0, cloud: 0xffb7a8, glow: 0 },
  night:  { bg: 0x18213f, fog: [25, 95],  hemi: [0x8090e0, 0x303a66, 0.55], sun: [0xb8c4ff, 0.5],  sunOff: [-6, 18, 4], lake: 0x1d3566, cloud: 0x5a6496, glow: 1.1 },
};
const themeFor = n => (n % 5 === 0 ? 'night' : n % 5 === 4 ? 'sunset' : 'day');
const sunOff = new THREE.Vector3(8, 20, 6);
const duckGlow = new THREE.PointLight(0xfff0c0, 0, 7, 1.5);   // 밤에 오리 주변을 비추는 따뜻한 등불
scene.add(duckGlow);
// ---------- 풍경(바이옴): 10레벨마다 바뀜. 위의 낮/노을/밤과 겹쳐서 적용 ----------
const BIOMES = [
  { id: 'lake',     lake: 0x4f8fd6, sky: 0xbfe6ff, cloud: 0xffffff },   //  1~10 🏞️ 호수
  { id: 'meadow',   lake: 0x5aa9dc, sky: 0xcdeeff, cloud: 0xffffff },   // 11~20 🌼 꽃 들판
  { id: 'mountain', lake: 0x3d9bb8, sky: 0xb1daf3, cloud: 0xffffff },   // 21~30 ⛰️ 산
  { id: 'canyon',   lake: 0x2fb3ad, sky: 0xffdcb6, cloud: 0xfff1e0 },   // 31~40 🏜️ 계곡
  { id: 'forest',   lake: 0x2e8780, sky: 0xc6ecdc, cloud: 0xf4fff8 },   // 41~50 🌲 숲
  { id: 'snow',     lake: 0x8ccbe9, sky: 0xe4f2fb, cloud: 0xffffff },   // 51~60 ❄️ 설원
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

// 꽃게 (좌우로 왔다 갔다)
function makeCrab() {
  const g = new THREE.Group();
  const red = toon(0xff7a59), dark = toon(0xe9553a);
  addOutlined(g, sph, red, V(0, 0.18, 0), V(0.42, 0.2, 0.32));                      // 몸통
  for (const sx of [-1, 1]) {
    const arm = addOutlined(g, sphLow, dark, V(sx * 0.48, 0.2, -0.22), V(0.16, 0.12, 0.14));   // 집게
    arm.userData.sx = sx;
    addOutlined(g, sphLow, dark, V(sx * 0.42, 0.05, 0.12), V(0.12, 0.04, 0.05), false);       // 다리
    addOutlined(g, sphLow, dark, V(sx * 0.4, 0.05, 0.24), V(0.1, 0.04, 0.05), false);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6), dark);
    stalk.position.set(sx * 0.12, 0.42, -0.14); g.add(stalk);
    const eye = new THREE.Mesh(sphLow, shineMat); eye.scale.setScalar(0.07); eye.position.set(sx * 0.12, 0.52, -0.15); g.add(eye);
    const pupil = new THREE.Mesh(sphLow, eyeMat); pupil.scale.setScalar(0.035); pupil.position.set(sx * 0.12, 0.52, -0.21); g.add(pupil);
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
function sampleTrack(def) {
  const out = []; const STEP = 0.25;
  let x = 0, y = 0, z = 0, th = -Math.PI / 2, d = 0;   // 동쪽(화면 오른쪽)으로 출발
  const push = (p, slope = 0, flags = {}) => {
    const fx = -Math.sin(th), fz = -Math.cos(th);
    out.push({ x, y, z, tx: fx, tz: fz, nx: fz, nz: -fx, d, slope,   // n = 진행 방향의 왼쪽
      fall: p.t === 'F', ramp: !!flags.ramp, gap: !!flags.gap,
      w: (p.w || def.width) / 2,
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
        if (u <= p.ramp + 1e-6) { const v = u / p.ramp; y = y0 + p.h * v * v; push(p, 0, { ramp: true }); }
        else { y = y0; push(p, 0, { gap: true }); }
        continue;
      }
      if (p.t === 'F') { // 부드러운 S자 낙차 (가운데가 가장 가파름)
        const u = (i + 1) / n;
        y = y0 - p.drop * (u * u * (3 - 2 * u));
        slope = p.drop * 6 * u * (1 - u) / len;
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
    pos.push(s.x + s.nx * a, s.y + yA, s.z + s.nz * a, s.x + s.nx * b, s.y + yB, s.z + s.nz * b);
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
  const levelNo = def.no;
  LAKE_Y = lakeYFor(levelNo);
  const theme = themeFor(levelNo), biome = biomeFor(levelNo);
  applyTheme(theme, biome);
  lake.position.y = LAKE_Y;
  const group = new THREE.Group();
  const samples = sampleTrack(def);
  const N = samples.length;
  // 도착 섬(잔디) 위를 지나는 마지막 물길: 나무 난간 대신 돌로 된 물가로 자연스럽게 연못과 이어짐
  {
    const e = samples[N - 1], c = { x: e.x + e.tx * 4.8, z: e.z + e.tz * 4.8 };
    for (const sm of samples) sm.island = Math.hypot(sm.x - c.x, sm.z - c.z) < 4.8 + 3.4;
  }
  // 물길(물·바닥·돌 측면·난간)이 그림자를 드리우고 받음. 예전엔 castShadow 가 빠져서 기둥 그림자만 보였음
  const add = m => { m.receiveShadow = true; m.castShadow = true; group.add(m); return m; };

  // 물 표면 + 바닥 + 측면 (돌 수로). 점프대의 끊어진 구간(gap)은 비워 둠
  const solid = runs(samples.map(s => ({ x: !s.gap })), 'x');
  for (const [a, b] of solid) {
    add(ribbon(samples, a, b, s => s.w, 0.02, s => -s.w, 0.02, waterMat, 4));
    add(ribbon(samples, a, b, s => s.w, -0.35, s => -s.w, -0.35, toon(0xf3e2b8, { side: THREE.DoubleSide })));
    add(ribbon(samples, a, b, s => s.w, 0.0, s => s.w, -BASE_D, stoneMat()));
    add(ribbon(samples, a, b, s => -s.w, 0.0, s => -s.w, -BASE_D, stoneMat()));
    add(ribbon(samples, a, b, s => s.w, -BASE_D, s => -s.w, -BASE_D, stoneMat()));
  }
  // 끊어진 곳의 앞뒤 단면 + 점프대 끝 나무 발판
  for (let i = 1; i < N; i++) {
    const enter = samples[i].gap && !samples[i - 1].gap, leave = !samples[i].gap && samples[i - 1].gap;
    if (!enter && !leave) continue;
    const sm = samples[enter ? i - 1 : i];
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
    for (const [a, b] of runs(samples.map(s => ({ x: !s[side] && !s.island && !s.gap })), 'x')) {
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

  // 출발점 마개
  const s0 = samples[0];
  const cap = new THREE.Mesh(new THREE.BoxGeometry(s0.w * 2 + WALL_T * 2, WALL_H + BASE_D + 0.4, 0.6), toon(0xc9b99e));
  cap.position.set(s0.x - s0.tx * 0.3, s0.y + (WALL_H - BASE_D) / 2 + 0.2, s0.z - s0.tz * 0.3);
  cap.rotation.y = Math.atan2(-s0.tx, -s0.tz);
  add(cap);

  // 작은 폭포: 하얀 물줄기 + 아래쪽 거품
  const falls = [];
  for (const [a, b] of runs(samples, 'fall')) {
    const i0 = Math.max(0, a - 1), i1 = Math.min(N - 1, b + 1);
    group.add(ribbon(samples, i0, i1, s => s.w, 0.05, s => -s.w, 0.05, fallMat, 1.2));
    const e = Math.min(N - 1, b + 2);
    const foamEnd = Math.min(N - 1, b + 10);
    group.add(ribbon(samples, e, foamEnd, s => s.w, 0.05, s => -s.w, 0.05, foamMat, 2));
    falls.push({ x: samples[e].x, y: samples[e].y, z: samples[e].z, s: samples[e] });
  }

  // 아치 다리 기둥
  const pillarGeo = new THREE.CylinderGeometry(0.55, 0.75, 1, 10);
  for (let i = 10; i < N - 10; i += 28) {
    const s = samples[i];
    if (s.gap || s.ramp) continue;
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
  const pond = new THREE.Mesh(new THREE.CircleGeometry(PR, 32), new THREE.MeshToonMaterial({ map: pondTex, gradientMap: gradTex }));
  pond.rotation.x = -Math.PI / 2; pond.position.set(pondC.x, EY, pondC.z); add(pond);
  // 연못 테두리 돌
  for (let i = 0; i < 22; i++) {
    const a = i / 22 * Math.PI * 2;
    const ix = pondC.x + Math.cos(a) * PR, iz = pondC.z + Math.sin(a) * PR;
    if ((ix - sE.x) ** 2 + (iz - sE.z) ** 2 < (sE.w + 0.9) ** 2) continue; // 물길 입구는 비움
    const r = new THREE.Mesh(sphLow, toon(0xe8ddca));
    r.scale.set(0.45 + Math.random() * 0.2, 0.25, 0.45 + Math.random() * 0.2);
    r.position.set(ix, EY + 0.05, iz); r.castShadow = true; add(r);
  }
  // 꽃 & 나무
  const rng = mulberry(def.no + 7);
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2, rr = PR + 0.9 + rng() * 2.2;
    const fx = pondC.x + Math.cos(a) * rr, fz = pondC.z + Math.sin(a) * rr;
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
  let homeAt = null;
  if (finalLevel) {
    const hx = pondC.x + Math.cos(momA) * (PR + 1.5), hz = pondC.z + Math.sin(momA) * (PR + 1.5);
    const home = makeHome(); home.position.set(hx, EY, hz);
    home.rotation.y = Math.atan2(pondC.x - hx, pondC.z - hz);   // 문이 연못을 바라봄
    group.add(home); homeAt = { x: hx, z: hz };
    if (lookUnlocked(LOOKS.find(l => l.id === 'home'))) {   // 🏡 별을 전부 모으면: 꽃 아치·꽃밭·작은 나무로 꾸며진 특별 보금자리
      const arch = new THREE.Group();
      const cols = [0xff9fb6, 0xffffff, 0xffd84d, 0xc7a8ff, 0x8fdcc0];
      for (let k = 0; k <= 12; k++) {
        const a = Math.PI * k / 12;
        const f = new THREE.Mesh(sphLow, toon(cols[k % cols.length])); f.scale.setScalar(0.13);
        f.position.set(Math.cos(a) * 0.75, 0.15 + Math.sin(a) * 1.05, 1.0); arch.add(f);
      }
      arch.position.set(hx, EY, hz); arch.rotation.y = home.rotation.y; group.add(arch);
      for (let k = 0; k < 26; k++) {
        const a = momA + (k / 26 - 0.5) * 2.6, r = PR + 0.7 + (k % 3) * 0.55;
        const f = new THREE.Mesh(sphLow, toon(cols[k % cols.length])); f.scale.setScalar(0.12);
        f.position.set(pondC.x + Math.cos(a) * r, EY + 0.1, pondC.z + Math.sin(a) * r); group.add(f);
      }
      for (const da of [-0.9, 0.9]) add(makeTree(pondC.x + Math.cos(momA + da) * (PR + 2.2), EY, pondC.z + Math.sin(momA + da) * (PR + 2.2), 0.8));
    }
    for (let i = 0; i < 9; i++) {                                // 부들(갈대) 무리
      const a = momA + (i - 4) * 0.42 + (i % 2) * 0.1;
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
  const arrive = finalLevel
    ? { x: pondC.x + Math.cos(momA) * (PR - 1.1), z: pondC.z + Math.sin(momA) * (PR - 1.1) }   // 내 집 문 앞
    : { x: pondC.x + Math.cos(momA) * 0.4, z: pondC.z + Math.sin(momA) * 0.4 };

  // 타임어택 제한 시간: 코스 길이 ÷ 유속 × 배수 + 2초
  const n = def.no;
  const total = samples[N - 1].d;
  // 레벨 1~20: 1.25 → 0.95, 레벨 21~40: 0.95 → 0.9
  // 레벨 1~5: 0.95 → 0.75 (그냥 떠내려가면 아슬아슬), 6~60: 0.80 → 0.90 (앞으로 기울여 속도를 내야 함)
  // 뒤쪽 레벨일수록 코너가 많아 빨리 가기 어려워서 배수를 조금씩 올림
  const factor = n <= 5 ? 0.95 - 0.05 * (n - 1) : 0.8 + 0.1 * Math.min(1, (n - 6) / 54);
  let limit = Math.ceil(total / def.flow * factor + 2);

  // 5의 배수 레벨: 코스 중간에 기다리는 아기 오리들 (닿으면 줄줄이 따라옴)
  const babies = [];
  if (levelNo % 5 === 0 && levelNo !== LEVELS.length) {   // 마지막 레벨은 혼자 떠나는 길이라 아기 오리 없음
    const count = Math.min(10, levelNo / 5 + 2);   // 5:3, 10:4, ... 40~60: 10
    for (let j = 0; j < count; j++) {
      let i = Math.round(30 + (N - 60) * (j + 0.5) / count);
      while (samples[i].fall || samples[i].gap || samples[i].ramp || (i > 0 && samples[i - 1].fall)) i += 6;
      const sb = samples[i];
      const off = (rng() - 0.5) * 0.9 * sb.w;   // 가운데에서 살짝 비껴서
      const d = makeDuck({ scale: 0.55 });
      d.position.set(sb.x + sb.nx * off, sb.y, sb.z + sb.nz * off);
      d.rotation.y = Math.atan2(sb.tx, sb.tz);   // 다가오는 오리를 바라봄
      group.add(d);
      const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }));
      mark.scale.setScalar(0.45); mark.position.set(0, 1.9, 0); d.add(mark);
      babies.push({ duck: d, mark, state: 'wait', phase: j * 1.3, x: d.position.x, y: sb.y, z: d.position.z, yaw: d.rotation.y, idx: i });
    }
  }

  // 방패 아이템: 레벨 3부터 조금씩 (3~14: 1개, 15~26: 2개, 27~38: 3개, 39~60: 4개)
  // 난간 없는 위험 구간 바로 앞에 놓임
  const items = [];
  const nItems = levelNo < 3 ? 0 : Math.min(4, 1 + Math.floor((levelNo - 3) / 12));   // 3:1, 15:2, 27:3, 39~60: 4
  if (nItems) {
    const dangerStarts = [];
    for (let i = 20; i < N - 20; i++) {
      const open = !samples[i].wl || !samples[i].wr, prevOpen = !samples[i - 1].wl || !samples[i - 1].wr;
      if (open && !prevOpen) dangerStarts.push(i);
    }
    const picks = [];
    if (dangerStarts.length >= nItems) for (let j = 0; j < nItems; j++) picks.push(dangerStarts[Math.floor((j + 0.5) * dangerStarts.length / nItems)] - 14);
    else for (let j = 0; j < nItems; j++) picks.push(Math.round(20 + (N - 40) * (j + 0.5) / nItems));
    for (let i of picks) {
      i = clamp(i, 10, N - 10);
      while ((samples[i].fall || samples[i].gap || samples[i].ramp) && i < N - 10) i++;
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

  // ---------- 장애물 ----------
  // 통나무(레벨 7~), 소용돌이(13~), 꽃게(30~). 레벨이 오를수록 개수 증가.
  // 아이템·아기 오리·폭포 근처와 코너는 피해서 직선 구간에 놓음
  const busy = [];
  items.forEach(it => busy.push(it.idx)); babies.forEach(b => busy.push(b.idx));
  samples.forEach((sm, i) => { if (sm.fall || sm.ramp || sm.gap) busy.push(i); });
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
  const nLogs = levelNo < 7 ? 0 : Math.min(8, 1 + Math.floor((levelNo - 7) / 5));       // 7:1, 12:2 ... 42~: 8
  const nWhirls = levelNo < 13 ? 0 : Math.min(5, 1 + Math.floor((levelNo - 13) / 8));   // 13:1, 21:2 ... 45~: 5
  const nCrabs = levelNo < 30 ? 0 : Math.min(5, 1 + Math.floor((levelNo - 30) / 6));    // 30:1, 36:2 ... 54~: 5
  const logs = [], whirls = [], crabs = [];
  // 통나무: 한쪽 벽에서 가운데 근처까지 막음. 피해서 지나가는 쪽에는 난간이 있는 곳에만 (피하다 바로 추락하지 않게)
  for (const i of pickSpots(nLogs, 20, i => walledAt(i, 1) || walledAt(i, -1))) {
    const sm = samples[i];
    const passL = walledAt(i, 1), passR = walledAt(i, -1);
    const side = passL && passR ? (rng() < 0.5 ? 1 : -1) : passL ? -1 : 1;   // 통나무는 지나가는 쪽의 반대편
    const a = side * sm.w, b = side * sm.w * 0.08, L = Math.abs(a - b), mid = (a + b) / 2;
    const g = new THREE.Group();
    g.position.set(sm.x + sm.nx * mid, sm.y + 0.12, sm.z + sm.nz * mid);
    g.rotation.y = Math.atan2(-sm.tx, -sm.tz);
    const log = addOutlined(g, new THREE.CylinderGeometry(1, 1, 1, 14), toon(0x9b6a3c), V(0, 0, 0), V(0.3, L, 0.3));
    log.rotation.z = Math.PI / 2;
    for (const e of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.CircleGeometry(0.27, 14), toon(0xe8c38e, { side: THREE.DoubleSide }));
      cap.position.x = e * (L / 2 + 0.002); cap.rotation.y = Math.PI / 2; g.add(cap);
    }
    const leaf = new THREE.Mesh(sphLow, toon(0x7fd17a)); leaf.scale.set(0.18, 0.05, 0.11); leaf.position.set(L * 0.2, 0.3, 0); g.add(leaf);
    group.add(g);
    logs.push({ g, ax: sm.x + sm.nx * a, az: sm.z + sm.nz * a, bx: sm.x + sm.nx * b, bz: sm.z + sm.nz * b, y: sm.y, idx: i, side, phase: rng() * 6 });
  }
  for (const i of pickSpots(nWhirls, 24, i => walledAt(i))) {   // 소용돌이: 양쪽 난간 있는 직선에만 (시간 손해용)
    // 한쪽으로 치우치게 놓아서 반대쪽으로 비켜 갈 수 있게 (가운데를 다 막지 않음)
    const sm = samples[i], R = Math.min(1.05, sm.w * 0.6), off = (rng() < 0.5 ? 1 : -1) * (sm.w - R - 0.05);
    const x = sm.x + sm.nx * off, z = sm.z + sm.nz * off;
    const m = new THREE.Mesh(new THREE.CircleGeometry(R, 32), whirlMat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, sm.y + 0.045, z); group.add(m);
    whirls.push({ m, x, z, y: sm.y, R, idx: i, lat: off, inside: false });
  }
  for (const i of pickSpots(nCrabs, 20, () => true)) {      // 꽃게: 물길을 가로질러 왔다 갔다
    const sm = samples[i], c = makeCrab();
    c.rotation.y = Math.atan2(sm.tx, sm.tz);               // 다가오는 오리를 바라봄
    group.add(c);
    crabs.push({ g: c, s: sm, amp: sm.w - 0.5, speed: 0.9 + rng() * 0.6, phase: rng() * 6, x: sm.x, y: sm.y, z: sm.z, lat: 0, idx: i, hitT: -9 });
  }
  // 물레방아(레벨 20~): 커다란 나무 바퀴가 물길을 가로질러 돌고, 날개가 물에 잠길 때 지나가면 튕겨 나감
  const nMills = levelNo < 20 ? 0 : Math.min(4, 1 + Math.floor((levelNo - 20) / 10));   // 20:1, 30:2, 40:3, 50~: 4
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
    for (let k = 0; k < 3; k++) {
      const arm = new THREE.Group(); arm.rotation.x = k * Math.PI * 2 / 3; wheel.add(arm);
      const blade = addOutlined(arm, new THREE.BoxGeometry(1, 1, 1), toon(0xc98f5a), V(0, -R * 0.55, 0), V(span, R * 0.9, 0.12));
      blade.castShadow = true;
      for (const sx of [-1, 1]) {   // 바퀴 테두리 살
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.08, R, 0.08), toon(0x8a5a32));
        spoke.position.set(sx * (span / 2 + 0.12), -R / 2, 0); arm.add(spoke);
      }
    }
    group.add(g);
    mills.push({ g, wheel, s: sm, x: sm.x, y: sm.y, z: sm.z, R, H, w: sm.w, omega: 1.0 + rng() * 0.3, phase: rng() * 6, theta: 0, idx: i, hitT: -9 });
  }
  limit += Math.ceil(nLogs * 1.5 + nWhirls * 3 + nCrabs * 2 + nMills * 2.5);   // 장애물 때문에 늦어지는 만큼 더

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

  return { theme, biome: biome.id, lakeStars, group, samples, total, family, homeAt, pondC, pond, arrive, falls, limit, babies, items, shieldWalls, logs, whirls, crabs, mills, lakeY: LAKE_Y };
}

// 다 자란 오리의 새 보금자리: 작은 나무 오리 집
function makeHome() {
  const g = new THREE.Group();
  const wood = toon(0xe0aa6a), roofC = toon(0xe8735a), dark = toon(0x6b4a2e);
  const body = addOutlined(g, new THREE.BoxGeometry(1, 1, 1), wood, V(0, 0.6, 0), V(1.7, 1.2, 1.5));
  body.castShadow = true;
  for (const sx of [-1, 1]) {                                     // 박공 지붕
    const r = addOutlined(g, new THREE.BoxGeometry(1, 1, 1), roofC, V(sx * 0.48, 1.5, 0), V(1.18, 0.14, 1.75));
    r.rotation.z = -sx * 0.62; r.castShadow = true;
  }
  const gable = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.95, 0.62, 3, 1), wood);   // 지붕 아래 삼각벽
  gable.rotation.set(Math.PI / 2, 0, 0); gable.scale.set(1, 1.5, 1); gable.position.set(0, 1.42, 0); g.add(gable);
  const door = new THREE.Mesh(new THREE.CircleGeometry(0.33, 18), dark);   // 둥근 문 (앞 = +z)
  door.position.set(0, 0.55, 0.756); g.add(door);
  const win = new THREE.Mesh(new THREE.CircleGeometry(0.14, 14), toon(0xfff3b0));
  win.position.set(0, 1.0, 0.757); g.add(win);
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
};
for (const g of Object.values(decoGeo)) g.userData.keep = true;   // 레벨 바뀔 때 지우지 않는 공용 모양
function makePine(x, y, z, s, snowy) {
  const t = new THREE.Group();
  const trunk = new THREE.Mesh(decoGeo.cyl, toon(0x8a5a35)); trunk.scale.set(0.16, 0.7, 0.16); trunk.position.y = 0.35; t.add(trunk);
  const greens = snowy ? [0x4f8f6a, 0x5a9e76, 0x67ad83] : [0x2f8a4c, 0x3a9c58, 0x4aae66];
  for (let k = 0; k < 3; k++) {
    const c = new THREE.Mesh(decoGeo.cone, toon(greens[k])); c.scale.set(0.85 - k * 0.2, 1.0 - k * 0.15, 0.85 - k * 0.2); c.position.y = 1.0 + k * 0.55; c.castShadow = true; t.add(c);
    if (snowy) { const sn = new THREE.Mesh(decoGeo.cone, toon(0xffffff)); sn.scale.set(0.42 - k * 0.1, 0.35, 0.42 - k * 0.1); sn.position.y = 1.36 + k * 0.55; t.add(sn); }
  }
  t.position.set(x, y, z); t.scale.setScalar(s);
  return t;
}
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };
function decorateBiome(id, group, samples, rng, add) {
  const N = samples.length;
  // 물길에서 충분히 떨어진 자리만 (r = 장식 반지름)
  const farFromTrack = (x, z, r) => { for (let j = 0; j < N; j += 4) { const sm = samples[j]; if ((sm.x - x) ** 2 + (sm.z - z) ** 2 < (r + sm.w + 2) ** 2) return false; } return true; };
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
      const m = new THREE.Mesh(decoGeo.cone, toon([0x7f9c7a, 0x8a9a8f, 0x6f8f78][i % 3])); m.scale.set(r, h, r); m.position.set(p.x, W + h / 2, p.z); m.rotation.y = rng() * 3; add(m);
      const cap = new THREE.Mesh(decoGeo.cone, toon(0xffffff)); cap.scale.set(r * 0.36, h * 0.36, r * 0.36); cap.position.set(p.x, W + h * 0.82, p.z); cap.rotation.y = m.rotation.y; add(cap);
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

function makeTree(x, y, z, s) {
  const t = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.2, 7), toon(0xb07a4a));
  trunk.position.y = 0.6; t.add(trunk);
  const cols = [0x7fd17a, 0x92dc84, 0x6cc46d];
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
// slot 이 같은 것끼리는 하나만 (모자류는 head). home 은 입는 게 아니라 180★ 엔딩 보상
const LOOKS = [
  // cat: 꾸미기 화면에서 묶어 보여 주는 줄. hue: 같은 이모지를 색만 바꿔 보여 줄 때
  { id: 'bow',      slot: 'head',  cat: 'bow',     need: 10,  icon: '🎀' },
  { id: 'flower',   slot: 'head',  cat: 'bow',     need: 15,  icon: '🌼' },
  { id: 'bowblue',  slot: 'head',  cat: 'bow',     need: 90,  icon: '🎀', hue: 190 },
  { id: 'tube',     slot: 'body',  cat: 'tube',    need: 20,  icon: '🛟' },
  { id: 'tubedot',  slot: 'body',  cat: 'tube',    need: 28,  icon: '🛟', hue: 200 },
  { id: 'donut',    slot: 'body',  cat: 'tube',    need: 115, icon: '🍩' },
  { id: 'hat',      slot: 'head',  cat: 'hat',     need: 35,  icon: '👒' },
  { id: 'santa',    slot: 'head',  cat: 'hat',     need: 80,  icon: '🎅' },
  { id: 'party',    slot: 'head',  cat: 'hat',     need: 120, icon: '🥳' },
  { id: 'glasses',  slot: 'face',  cat: 'glasses', need: 50,  icon: '🕶️' },
  { id: 'round',    slot: 'face',  cat: 'glasses', need: 42,  icon: '👓' },
  { id: 'heartgl',  slot: 'face',  cat: 'glasses', need: 110, icon: '💖' },
  { id: 'scarf',    slot: 'neck',  cat: 'scarf',   need: 70,  icon: '🧣' },
  { id: 'bell',     slot: 'neck',  cat: 'scarf',   need: 60,  icon: '🔔' },
  { id: 'bowtie',   slot: 'neck',  cat: 'scarf',   need: 145, icon: '🦋' },
  { id: 'crown',    slot: 'head',  cat: 'special', need: 100, icon: '👑' },
  { id: 'rainbow',  slot: 'fx',    cat: 'special', need: 130, icon: '🌈' },
  { id: 'gold',     slot: 'color', cat: 'special', need: 160, icon: '✨' },
  { id: 'home',     slot: 'home',  cat: 'special', need: 180, icon: '🏡' },
];
const LOOK_CATS = ['bow', 'tube', 'hat', 'glasses', 'scarf', 'special'];
const HAT_IDS = ['hat', 'crown', 'santa', 'party'];   // 쓰면 머리 깃털을 숨기는 것
const totalStars = () => Object.values(save.missions || {}).reduce((a, m) => a + starCount(m), 0);
// 테스트 모드: 꾸미기 전부 열기. 주소 뒤에 ?unlock=1 → 켜짐, ?unlock=0 → 꺼짐 (이 브라우저에 저장됨). 별 기록은 그대로
let TEST_UNLOCK = false;
try {
  const q = new URLSearchParams(location.search).get('unlock');
  if (q === '1') localStorage.setItem('duckwaterway.unlockAll', '1');
  if (q === '0') localStorage.removeItem('duckwaterway.unlockAll');
  TEST_UNLOCK = localStorage.getItem('duckwaterway.unlockAll') === '1';
} catch (e) {}
const lookUnlocked = l => TEST_UNLOCK || totalStars() >= l.need;
const rainbowMats = [0xff6b6b, 0xffa94d, 0xffe066, 0x69db7c, 0x4dabf7, 0xb197fc].map(c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95 }));
let rainbowI = 0;

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
  for (const slot of ['head', 'body', 'face', 'neck']) {
    const id = save.equip[slot], l = LOOKS.find(x => x.id === id);
    if (l && lookUnlocked(l)) acc.add(makeAccessory(id));
  }
  bob.add(acc); duck.userData.acc = acc;
  const hatOn = HAT_IDS.includes(save.equip.head) && lookUnlocked(LOOKS.find(l => l.id === save.equip.head));
  for (const tf of duck.userData.tufts) tf.visible = !hatOn;   // 모자·왕관을 쓰면 머리 깃털이 삐져나오지 않게
}
function lookName(l) { return t('look_' + l.id); }
// 오리 성장: 10레벨마다 한 단계씩 커짐 (1~10: 아기 오리 크기 → 51~60: 다 자란 크기)
const growStage = n => Math.min(5, Math.floor((n - 1) / 10));
const growScale = n => 0.62 + (1.25 - 0.62) * growStage(n) / 5;
const P = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, idx: 0, lat: 0, prog: 0, yaw: 0, roll: 0, spin: 0 };
let elapsed = 0, timeT = 0, splashT = 0, countT = 0, lastBump = 0, celebrateT = 0;
let hearts = MAX_HEARTS, shieldT = 0;
const camF = { x: 0, z: -1 };   // 카메라 앞 방향(고정: 북쪽) → 조작 기준
const inGame = () => ['countdown', 'playing', 'paused', 'falling', 'respawning', 'win', 'failed'].includes(state);

function loadLevel(i) {
  if (world) {
    scene.remove(world.group);
    world.group.traverse(o => { if (o.geometry && o.geometry !== sph && o.geometry !== sphLow && !o.geometry.userData.keep) o.geometry.dispose(); });
  }
  levelIdx = i;
  world = buildLevelWorld(LEVELS[i]);
  world.missions = missionsFor(i + 1, world);
  duck.scale.setScalar(growScale(i + 1));
  scene.add(world.group);
  resetDuck();
}

const START_I = 4;    // 출발 위치
function resetDuck() {
  const s = world.samples[START_I];
  Object.assign(P, { x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, idx: START_I, lat: 0, prog: s.d, roll: 0, spin: 0, slope: 0, inFall: false, air: false });
  P.yaw = Math.atan2(-s.tx, -s.tz);
  duck.visible = true; duck.rotation.set(0, P.yaw, 0); duck.position.set(P.x, P.y, P.z);
  snapCamera();
  timeT = 0; celebrateT = 0; shieldT = 0; hearts = MAX_HEARTS; updateHeartsHud();
  heartItem = null; heartTimer = HEART_CHECK;
  trail.length = 0; babyGot = 0; updateBabyHud(); resetStats();
  for (const f of world.family) f.duck.position.y = f.baseY;
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
  P.vx += ax * 0.2 * dt; P.vz += az * 0.2 * dt;
  P.x += P.vx * dt; P.z += P.vz * dt;
  P.vy -= JUMP_G * dt; P.y += P.vy * dt;
  P.idx = nearestIdx(P.x, P.z, P.idx);
  const s = S[P.idx];
  const dx = P.x - s.x, dz = P.z - s.z, along = dx * s.tx + dz * s.tz, lat = dx * s.nx + dz * s.nz;
  P.lat = lat; P.prog = s.d + along;
  if (!s.gap && P.y <= s.y) {                       // 착지
    P.air = false; P.y = s.y; P.vy = 0;
    if (Math.abs(lat) > s.w + 0.05) { startFall(); return; }
    Sfx.splash(0.6); burst(P.x, P.y + 0.1, P.z, 16, 2.4, 0.1, 0.6);
  } else if (s.gap && P.y < s.y - 0.5) {            // 끊어진 곳으로 퐁당
    P.air = false; stats.jumpFails++; startFall(true);
  }
}

function physicsStep(dt) {
  const def = LEVELS[levelIdx];
  const S = world.samples;
  let s = S[P.idx];

  // 카메라 기준 방향으로 입력 → 힘
  const fx = camF.x, fz = camF.z, rx = -fz, rz = fx;
  const ax = (rx * input.x + fx * input.y) * INPUT_ACC;
  const az = (rz * input.x + fz * input.y) * INPUT_ACC;
  if (P.air) { airStep(dt, ax, az); if (state === 'playing') checkEnd(); return; }

  // 소용돌이 안에서는 물살이 거의 오리를 밀어주지 못함 → 확실히 느려짐
  let whirlK = 0;
  for (const w of world.whirls) {
    const d = Math.hypot(w.x - P.x, w.z - P.z), R = w.R + 0.15;
    if (d < R && Math.abs(w.y - P.y) < 1) whirlK = Math.max(whirlK, 1 - d / R);
  }

  // 물살: 오리 속도를 흐름 속도로 끌어당김 (부력/관성 느낌)
  // 옆 물살: 물길을 따라 좌우로 천천히 바뀌는 흐름 (레벨이 오를수록 강해짐)
  const flow = def.flow;
  const cross = (def.cross || 0) * Math.sin(s.d * 0.32 + 1.3) * Math.min(1, s.d / 8);
  const flowK = 1 - 0.85 * Math.min(1, whirlK * 2.5);
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
  if (s.slope > 0) { // 폭포 경사: 앞으로 쭉 미끄러지며 빨라짐
    P.vx += s.tx * s.slope * FALL_BOOST * dt; P.vz += s.tz * s.slope * FALL_BOOST * dt;
  }
  P.x += P.vx * dt; P.z += P.vz * dt;

  P.idx = nearestIdx(P.x, P.z, P.idx);
  s = S[P.idx];
  let dx = P.x - s.x, dz = P.z - s.z;
  const along = dx * s.tx + dz * s.tz;
  let lat = dx * s.nx + dz * s.nz;

  // 점프대 끝을 지나 끊어진 곳에 들어서면 → 앞으로 가던 속도만큼 날아오름
  if (s.gap) {
    const va = Math.max(0, P.vx * s.tx + P.vz * s.tz);
    P.air = true; P.y = P.rampY || s.y; P.vy = va * JUMP_VY;
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
  const lim = s.w - DUCK_R;
  for (const sg of [1, -1]) {
    const hasWall = (sg === 1 ? s.wl : s.wr) || s.island || shieldT > 0;   // 방패 중·섬 위 물가는 벽처럼
    const over = lat * sg - lim;
    if (over <= 0) continue;
    if (hasWall) {
      P.x -= s.nx * sg * over; P.z -= s.nz * sg * over; lat = sg * lim;
      const vn = (P.vx * s.nx + P.vz * s.nz) * sg;
      if (vn > 0) {
        P.vx -= s.nx * sg * vn * (1 + WALL_REST); P.vz -= s.nz * sg * vn * (1 + WALL_REST);
        if (vn > 1.2 && elapsed - lastBump > 0.25) {
          lastBump = elapsed; Sfx.bump(); stats.bumps++;
          burst(P.x + s.nx * sg * 0.3, P.y + 0.2, P.z + s.nz * sg * 0.3, 6, 1.6, 0.07, 0.45);
        }
      }
    } else if (lat * sg > s.w + 0.05) {
      startFall(); return;
    }
  }
  P.lat = lat;
  P.prog = s.d + along;
  // 물길 높이 (샘플 사이 보간)
  const nb = S[clamp(P.idx + (along >= 0 ? 1 : -1), 0, S.length - 1)];
  const span = Math.abs(nb.d - s.d) || 1;
  P.y = lerp(s.y, nb.y, clamp(Math.abs(along) / span, 0, 1));
  P.slope = s.slope;
  if (s.ramp) P.rampY = P.y;
  for (const m of world.mills) {   // 물레방아: 물에 잠긴 날개에 부딪히면 뒤로 크게 튕겨 나감
    const mx = P.x - m.x, mz = P.z - m.z;
    const ma = mx * m.s.tx + mz * m.s.tz, ml = mx * m.s.nx + mz * m.s.nz;
    if (Math.abs(ml) > m.w + 0.3 || Math.abs(ma) > m.R + 0.6 || Math.abs(m.y - P.y) > 1) continue;
    for (let k = 0; k < 3; k++) {
      let phi = m.theta + k * Math.PI * 2 / 3;
      phi = Math.atan2(Math.sin(phi), Math.cos(phi));          // 0 = 바로 아래를 향함
      if (Math.cos(phi) * m.R < m.H - 0.25) continue;          // 날개가 오리 높이까지 안 내려옴
      const pa = (m.H - 0.25) * Math.tan(phi);                  // 오리 높이에서 날개의 앞뒤 위치
      const pd = ma - pa, minD = 0.12 + DUCK_R;
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
    let nx = P.x - cx, nz = P.z - cz; const d = Math.hypot(nx, nz), minD = 0.3 + DUCK_R;
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
    }
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
const stats = { falls: 0, bumps: 0, logHits: 0, crabHits: 0, whirls: 0, items: 0, millHits: 0, jumpFails: 0 };
function resetStats() { for (const k in stats) stats[k] = 0; }
function missionsFor(n, W) {
  const list = [
    // ⏱ 시간 미션: 레벨 1~3은 제한 시간의 55·65·75%, 그 뒤로는 82% 안에 도착 (테스트 봇 최고 기록 기준으로 아슬아슬하게)
    { id: 'time', v: Math.ceil(W.limit * (n <= 3 ? 0.55 + 0.1 * (n - 1) : 0.82)) },
    { id: 'nofall' },                                // 💗 한 번도 안 떨어지기
  ];
  const extra = [];                                  // 세 번째 미션은 레벨에 있는 것 중에서
  if (W.babies.length) extra.push({ id: 'babies', v: Math.ceil(W.babies.length * 0.7) });
  else {
    if (W.mills.length) extra.push({ id: 'mill' });
    if (W.samples.some(s => s.gap)) extra.push({ id: 'jump' });
    if (W.crabs.length) extra.push({ id: 'crab' });
    if (W.whirls.length) extra.push({ id: 'whirl' });
    if (W.logs.length) extra.push({ id: 'log' });
    if (W.items.length) extra.push({ id: 'item' });
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
    case 'log': return stats.logHits === 0;
    case 'item': return stats.items > 0;
    case 'bumps': return stats.bumps <= m.v;
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

function startWin() {
  state = 'win'; celebrateT = 0;
  Sfx.win(); setTimeout(() => Sfx.quack(1.1), 350);
  const tm = Math.round(timeT * 10) / 10;
  const n = levelIdx + 1;
  const prevBest = save.best[n];
  const record = !prevBest || tm < prevBest;
  if (record) save.best[n] = tm;
  save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, n + 1));
  const results = world.missions.map(m => missionDone(m, tm));
  const runMask = results.reduce((a, ok, i) => a | (ok ? 1 << i : 0), 0);
  const savedMask = (save.missions[n] || 0) | runMask;
  const starsBefore = totalStars();
  save.missions[n] = savedMask;
  const starsAfter = totalStars();
  const newLooks = LOOKS.filter(l => l.need > starsBefore && l.need <= starsAfter);   // 이번에 새로 열린 꾸미기
  persist();
  setTimeout(() => {
    if (state !== 'win') return;
    const last = levelIdx === LEVELS.length - 1;
    showPopup({
      icon: last ? '🏡' : '💛',
      title: last ? t('winTitleLast') : t('winTitle'),
      text: starsHtml(starCount(runMask), 'big pop') +
        t('clearLine', n, tm.toFixed(1)) + (record ? ' ' + t('newBest') : '') +
        `<br>${'❤️'.repeat(hearts)}${'🤍'.repeat(MAX_HEARTS - hearts)}` +
        missionListHtml(results) +
        (savedMask !== runMask ? `<span class="saved-stars">${t('starsSaved')} ${starsHtml(starCount(savedMask), 'small')}</span>` : '') +
        newLooks.map(l => `<span class="new-look">${t('newLook', l.icon, lookName(l))}</span>`).join('') +
        (last ? '<br>' + t('allDone') : ''),
      buttons: last
        ? [[t('levels'), () => openLevels()], [t('playAgain'), () => startLevel(levelIdx), true]]
        : [[t('nextLevel'), () => startLevel(levelIdx + 1)], [t('playAgain'), () => startLevel(levelIdx), true], [t('levels'), () => openLevels(), true]],
    });
  }, 1700);
}
function timeUp() { // 타임어택 실패
  state = 'failed';
  Sfx.fail();
  showPopup({ icon: '⏰', title: t('timeUpTitle'), text: t('timeUpText', world.limit),
    buttons: [[t('restartNow'), () => startLevel(levelIdx)]] });
  setTimeout(() => { if (state === 'failed') startLevel(levelIdx); }, 2200);
}
// 떨어지면 하트 1개를 잃고 떨어진 자리 근처에서 다시 출발. 하트가 0이 되면 레벨 처음부터.
function landInLake() {
  duck.visible = false;
  Sfx.plop();
  burst(P.x, LAKE_Y + 0.1, P.z, 26, 4.5, 0.18, 1.0);
  hearts--;
  updateHeartsHud(true);
  if (hearts > 0) {
    state = 'respawning';
    showToast(t('plopToast', hearts), 1400);
    setTimeout(() => { if (state === 'respawning') respawn(); }, 900);
    return;
  }
  state = 'failed';
  Sfx.fail();
  showPopup({ icon: '💔', title: t('noHeartsTitle'), text: t('noHeartsText'), buttons: [[t('restartNow'), () => startLevel(levelIdx)]] });
  setTimeout(() => { if (state === 'failed') startLevel(levelIdx); }, 1800);
}
function respawn() {
  const S = world.samples;
  let i = Math.max(START_I, (P.fallIdx || START_I) - 10);
  if (S[P.fallIdx] && (S[P.fallIdx].gap || S[P.fallIdx].ramp)) {   // 점프 실패 → 경사로 앞에서 다시 달려오게
    i = P.fallIdx; while (i > START_I && (S[i].gap || S[i].ramp)) i--;
    i = Math.max(START_I, i - 16);
  }
  const s = S[i], flow = LEVELS[levelIdx].flow;
  Object.assign(P, { x: s.x, y: s.y, z: s.z, vx: s.tx * flow * 0.5, vz: s.tz * flow * 0.5, vy: 0, idx: i, lat: 0, prog: s.d, roll: 0, spin: 0, slope: 0, inFall: false, air: false });
  P.yaw = Math.atan2(-s.tx, -s.tz);
  duck.visible = true; duck.rotation.set(0, P.yaw, 0); duck.userData.bob.rotation.set(0, 0, 0);
  trail.length = 0;   // 따라오던 아기 오리들도 바로 뒤로
  let k = 0;
  for (const b of world.babies) if (b.state === 'follow') { k++; b.x = s.x - s.tx * k; b.z = s.z - s.tz * k; b.y = s.y; }
  shieldT = Math.max(shieldT, 1.5);   // 다시 출발 직후 잠깐 보호
  burst(P.x, P.y + 0.2, P.z, 14, 2, 0.08, 0.5);
  Sfx.quack(1.3);
  state = 'playing';
  trySpawnHeart(0.5); heartTimer = HEART_CHECK;   // 하트가 3개 이하면 앞쪽에 하트 아이템이 나올 수도
}

// ---------- 하트 아이템: 하트가 3개 이하일 때 랜덤하게 앞쪽에 나타남 (먹으면 +1) ----------
const HEART_CHECK = 8;          // 몇 초마다 나올지 검사
let heartItem = null, heartTimer = HEART_CHECK;
function trySpawnHeart(chance) {
  if (!world || heartItem || hearts > 3 || hearts >= MAX_HEARTS || Math.random() > chance) return;
  const S = world.samples, N = S.length;
  let i = P.idx + 40 + Math.floor(Math.random() * 25);   // 10~16 정도 앞
  while (i < N - 20 && (S[i].fall || S[i - 1].fall || S[i].gap || S[i].ramp)) i += 4;
  if (i >= N - 20) return;
  const s = S[i], off = (Math.random() - 0.5) * 0.8 * s.w;
  const g = new THREE.Group();
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }));
  spr.scale.setScalar(0.85); spr.position.y = 0.75; g.add(spr);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: 0xff7fa0 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.12; g.add(ring);
  const x = s.x + s.nx * off, z = s.z + s.nz * off;
  g.position.set(x, s.y, z); world.group.add(g);
  heartItem = { g, spr, ring, x, y: s.y, z, idx: i };
}
function removeHeartItem() { if (heartItem) { world.group.remove(heartItem.g); heartItem = null; } }
function updateHeartItem(dt) {
  if (state === 'playing') {
    heartTimer -= dt;
    if (heartTimer <= 0) { heartTimer = HEART_CHECK; trySpawnHeart(0.5); }
  }
  const h = heartItem;
  if (!h) return;
  h.spr.position.y = 0.75 + Math.sin(elapsed * 3) * 0.12;
  h.spr.scale.setScalar(0.85 + Math.sin(elapsed * 6) * 0.06);
  h.ring.rotation.z += dt * 2;
  if (state !== 'playing') return;
  if ((h.x - P.x) ** 2 + (h.z - P.z) ** 2 < 0.95 * 0.95 && Math.abs(h.y - P.y) < 1) {
    hearts = Math.min(MAX_HEARTS, hearts + 1);
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
function updateHeartsHud(hit) {
  const el = $('#hudHearts');
  el.innerHTML = Array.from({ length: MAX_HEARTS }, (_, i) => `<span>${i < hearts ? '❤️' : '🤍'}</span>`).join('');
  if (hit) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}

// ---------- 카메라 ----------
// 고정 방향 카메라: 항상 남쪽에서 북쪽(화면 위)을 바라봄.
// 물길이 남쪽(화면 아래)으로 꺾이면 오리가 카메라를 향해 와서 얼굴이 보임.
const CAM_UP = 9.5, CAM_BACK = 9.5;   // 멀리서 넓게 보기
const camTarget = new THREE.Vector3(), lookTarget = new THREE.Vector3(), lookCur = new THREE.Vector3();
const look = { x: 0, z: 0 };   // 진행 방향으로 미리 보여주는 오프셋
function lookAheadGoal() {
  const S = world.samples, a = S[Math.min(S.length - 1, P.idx + 12)];
  // 세로 화면이라 좌우는 조금만, 앞뒤는 더 많이 미리 보여 줌. 오리는 화면 가운데보다 살짝 아래
  return { x: a.tx * 1.6, z: a.tz * 3 - 3 };
}
function cameraGoal() {
  const lx = P.x + look.x, lz = P.z + look.z;
  camTarget.set(lx, P.y + CAM_UP, lz + CAM_BACK);
  lookTarget.set(lx, P.y, lz);
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
  } else if (state === 'title' || state === 'levels') {
    const t = elapsed * 0.15;
    camTarget.set(P.x + Math.sin(t) * 6, P.y + 3.5, P.z + Math.cos(t) * 6);
    lookTarget.set(P.x, P.y + 0.5, P.z);
  } else if (state === 'falling' || state === 'failed' || state === 'respawning') {
    lookTarget.set(P.x, Math.max(P.y, world.lakeY + 1), P.z);
  } else if (state === 'win') {
    const c = world.pondC;
    camTarget.set(c.x, c.y + 6.5, c.z + 8);
    lookTarget.set(c.x, c.y + 0.5, c.z);
  } else cameraGoal();
  camera.position.lerp(camTarget, damp(state === 'win' ? 1.5 : 4, dt));
  lookCur.lerp(lookTarget, damp(5, dt));
  camera.lookAt(lookCur);
  // 꾸미기 화면에서는 화면을 위로 밀어 오리가 꾸미기 창 위 빈 공간 가운데에 오게
  const W = appEl.clientWidth, H = appEl.clientHeight;
  const offGoal = state === 'wardrobe' ? H * (1 - wdTopFrac()) / 2 : 0;
  viewOff = lerp(viewOff, offGoal, damp(5, dt));
  if (Math.abs(viewOff) > 0.5) camera.setViewOffset(W, H, 0, viewOff, W, H);
  else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  sun.position.set(P.x + sunOff.x, P.y + sunOff.y, P.z + sunOff.z); sun.target.position.set(P.x, P.y, P.z);
  duckGlow.position.set(P.x, P.y + 1.6, P.z + 0.6);
}

// ---------- 오리 애니메이션 ----------
function animateDuck(dt) {
  const u = duck.userData;
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
    duck.rotation.set(0, P.yaw, 0);
    u.bob.position.y = Math.abs(Math.sin(elapsed * 4.2)) * 0.06;
    u.bob.rotation.z = P.roll;
    u.bob.rotation.x = -input.y * 0.12 + Math.sin(elapsed * 4.2) * 0.04 - Math.atan(P.slope || 0) * 0.9;
    const flap = state === 'win' || P.air ? Math.sin(elapsed * 22) * 0.8 : Math.sin(elapsed * 6) * 0.12;   // 점프 중엔 파닥파닥
    u.wingL.rotation.z = -flap; u.wingR.rotation.z = flap;

    // 물보라 이펙트
    splashT -= dt;
    if (splashT <= 0 && state !== 'countdown' && !P.air) {
      splashT = 0.07;
      const bx = P.x + Math.sin(P.yaw) * 0.45, bz = P.z + Math.cos(P.yaw) * 0.45;
      const rx = Math.cos(P.yaw) * 0.32, rz = -Math.sin(P.yaw) * 0.32;
      for (const sg of [-1, 1]) spawnDrop(bx + rx * sg, P.y + 0.1, bz + rz * sg, rx * sg * 1.6 + (Math.random() - 0.5) * 0.4, 1.4 + Math.random(), rz * sg * 1.6, 0.06 + Math.random() * 0.03, 0.4,
        save.equip.fx === 'rainbow' ? rainbowMats[(rainbowI++) % rainbowMats.length] : null);   // 🌈 무지개 물보라
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
  const party = state === 'win';
  for (const f of world.family) {
    const u = f.duck.userData;
    cuteIdle(f.duck, dt, elapsed + f.phase);
    const t = elapsed * (party ? 9 : 2.2) + f.phase;
    f.duck.position.y = f.baseY + (party ? Math.abs(Math.sin(t)) * (f.mom ? 0.35 : 0.55) : Math.abs(Math.sin(t)) * 0.05);
    u.bob.rotation.z = Math.sin(t * 0.5) * (party ? 0.3 : 0.1);
    const flap = party ? Math.sin(elapsed * 20 + f.phase) * 0.9 : Math.sin(t) * 0.1;
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
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  tick(dt);
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
      showCount(t('go'), true); Sfx.beep(true);
      setTimeout(() => $('#countdown').classList.add('hidden'), 600);
    } else if (cur !== prev) { showCount(String(cur), false); Sfx.beep(false); }
  }

  if (state === 'playing') {
    timeT += dt;
    acc += dt;
    while (acc >= FIXED && state === 'playing') { physicsStep(FIXED); acc -= FIXED; }
    updateHud();
  } else acc = 0;

  if (state === 'falling' || state === 'respawning') timeT += dt;   // 떨어진 동안에도 시간은 흐름
  // 방패: 남은 시간 줄이기 + 벽 보이기 (끝나기 1.5초 전부터 깜빡)
  if (state === 'playing' && shieldT > 0) shieldT = Math.max(0, shieldT - dt);
  updateHeartItem(dt);
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
    for (const c of world.crabs) {                                                                    // 꽃게 옆걸음
      c.lat = Math.sin(elapsed * c.speed + c.phase) * c.amp;
      c.x = c.s.x + c.s.nx * c.lat; c.z = c.s.z + c.s.nz * c.lat;
      c.g.position.set(c.x, c.y + 0.02 + Math.abs(Math.sin(elapsed * 9 + c.phase)) * 0.05, c.z);
      for (const ch of c.g.children) if (ch.userData.sx) ch.rotation.z = ch.userData.sx * Math.sin(elapsed * 7 + c.phase) * 0.35;
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
  if (world) world.pond.rotation.z += dt * 0.04;   // 연못 물결이 천천히 돎
  for (const c of clouds) { c.position.x += c.userData.speed * dt; if (c.position.x > 90) c.position.x = -90; }
  if (world && world.biome === 'snow' && Math.random() < dt * 22) {   // ❄️ 펑펑 내리는 눈
    const sx = camera.position.x + (Math.random() - 0.5) * 16, sz = camera.position.z - 3 - Math.random() * 12;
    spawnSprite(glowTex, sx, P.y + 5 + Math.random() * 3, sz, (Math.random() - 0.5) * 0.3, -0.8 - Math.random() * 0.5, 0, 0.16 + Math.random() * 0.1, 5, 0);
  }
  if (world && world.theme === 'night') {   // 🌙 별빛 반짝 + 오리 주변 반딧불
    if (world.lakeStars) world.lakeStars.material.opacity = 0.6 + Math.sin(elapsed * 2.3) * 0.25;
    if (Math.random() < dt * 5) {
      const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 4;
      spawnSprite(fireflyTex, P.x + look.x + Math.cos(a) * r, P.y + 0.4 + Math.random() * 1.6, P.z + look.z + Math.sin(a) * r,
        (Math.random() - 0.5) * 0.4, 0.15 + Math.random() * 0.2, (Math.random() - 0.5) * 0.4, 0.3, 2.6, 0);
    }
  }
  updateCamera(dt);
}

// ---------- UI ----------
function show(id) {
  for (const s of ['#title', '#levels', '#popup', '#wardrobe']) $(s).classList.toggle('hidden', s !== id);
}
function showCount(txt, go) {
  const el = $('#countdown'); el.textContent = txt; el.classList.remove('hidden', 'go');
  void el.offsetWidth; el.classList.add('go');
}
function updateHud() {
  const p = clamp((P.prog - world.samples[START_I].d) / (world.total - world.samples[START_I].d), 0, 1);
  $('#progFill').style.width = (p * 100) + '%';
  $('#progDuck').style.left = (p * 100) + '%';
  const left = Math.max(0, world.limit - timeT);   // 타임어택: 남은 시간
  const el = $('#hudTime');
  el.textContent = Math.ceil(left);   // 초 단위만
  el.classList.toggle('urgent', left < 5);
}
function showPopup({ icon, title, text, buttons }) {
  $('#popIcon').textContent = icon; $('#popTitle').textContent = title; $('#popText').innerHTML = text;
  const box = $('#popButtons'); box.innerHTML = '';
  for (const [label, fn, secondary] of buttons) {
    const b = document.createElement('button'); b.textContent = label;
    if (secondary) b.className = 'secondary';
    b.onclick = () => { Sfx.click(); fn(b); };
    box.appendChild(b);
  }
  joyZone.classList.add('hidden'); joyReset();
  show('#popup');
}

// 레벨 선택: 20개씩 페이지로 나눠 보여줌
const PAGE_SIZE = 20;
let levelPage = 0;
const pageCount = () => Math.ceil(LEVELS.length / PAGE_SIZE);
function openLevels() {
  state = 'levels';
  $('#hud').classList.add('hidden'); joyZone.classList.add('hidden');
  levelPage = Math.min(pageCount() - 1, Math.floor((save.unlocked - 1) / PAGE_SIZE));   // 진행 중인 페이지부터
  $('#btnWardrobe').textContent = `${t('wardrobe')} ⭐${totalStars()}`;
  renderLevelPage();
  show('#levels');
  if (world && levelIdx !== save.unlocked - 1 && !inGame()) { loadLevel(save.unlocked - 1); }
}
function renderLevelPage() {
  const from = levelPage * PAGE_SIZE, to = Math.min(LEVELS.length, from + PAGE_SIZE);
  $('#pgLabel').textContent = `${from + 1} ~ ${to}`;
  $('#pgPrev').disabled = levelPage === 0;
  $('#pgNext').disabled = levelPage >= pageCount() - 1;
  const grid = $('#levelGrid'); grid.innerHTML = '';
  for (let i = from; i < to; i++) {
    const n = i + 1, locked = n > save.unlocked;
    const b = document.createElement('button');
    b.className = 'level-btn' + (locked ? ' locked' : '');
    b.innerHTML = `<span class="num">${locked ? '🔒' : n}</span>` +
      (locked ? '' : starsHtml(starCount(save.missions[n] || 0), 'small')) +
      `<span class="best">${save.best[n] ? save.best[n].toFixed(1) + 's' : (locked ? '' : '-')}</span>`;
    b.onclick = () => { Sfx.click(); startLevel(i); };
    grid.appendChild(b);
  }
}
$('#pgPrev').onclick = () => { if (levelPage > 0) { Sfx.click(); levelPage--; renderLevelPage(); } };
$('#pgNext').onclick = () => { if (levelPage < pageCount() - 1) { Sfx.click(); levelPage++; renderLevelPage(); } };

function startLevel(i) {
  Sfx.init(); Sfx.bgmStart();
  loadLevel(i);
  particles.slice().forEach(p => { p.life = 0; });
  show(null);
  $('#hud').classList.remove('hidden');
  const L = LEVELS[i];
  $('#hudLevel').textContent = `Level ${i + 1}`;
  state = 'countdown'; countT = 3;
  snapCamera();
  setControlMode(controlMode);
  showCount('3', false); Sfx.beep(false);
  updateHud();
  setTimeout(() => Sfx.quack(), 200);
  const hint = $('#hint');
  if (i === 0) {
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
  } else if ([7, 13, 20, 30, 35].includes(i + 1)) {
    hint.textContent = t({ 7: 'hintLog', 13: 'hintWhirl', 20: 'hintMill', 30: 'hintCrab', 35: 'hintJump' }[i + 1]);
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

function pauseGame() {
  if (state !== 'playing' && state !== 'countdown') return;
  const prev = state; state = 'paused';
  showPauseMenu(prev);
}
function showPauseMenu(prev) {
  showPopup({
    icon: '⏸️', title: t('pauseTitle'), text: `Level ${levelIdx + 1}` + missionListHtml(null, save.missions[levelIdx + 1] || 0),
    buttons: [
      [t('resume'), () => { show(null); state = prev; lastT = performance.now(); setControlMode(controlMode); }],
      [t('restart'), () => startLevel(levelIdx), true],
      [t('levels'), () => openLevels(), true],
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
}
const musicLabel = () => Sfx.isMusicOn() ? t('musicOn') : t('musicOff');

$('#btnStart').onclick = async () => {
  Sfx.init(); Sfx.click(); Sfx.quack();
  gyroAvailable = await detectGyro();
  controlMode = gyroAvailable ? 'gyro' : 'joy';   // PRD 4: 자이로 기본, 미지원/거부 시 조이스틱
  try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('portrait').catch(() => {}); } catch (e) {}
  openLevels();
};
$('#btnBackTitle').onclick = () => { Sfx.click(); state = 'title'; show('#title'); };

// ---------- 꾸미기 화면 ----------
function openWardrobe() {
  state = 'wardrobe';
  renderWardrobe();
  show('#wardrobe');
}
function renderWardrobe() {
  const total = totalStars();
  $('#wdStars').textContent = t('starsTotal', total);
  const next = [...LOOKS].sort((a, b) => a.need - b.need).find(l => l.need > total);
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
    `<span class="look-sub">${!open ? '⭐ ' + l.need : l.slot === 'home' ? t('homeReward') : on ? t('equipped') : ''}</span>`;
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
$('#btnWardrobeBack').onclick = () => { Sfx.click(); closeLookPop(); openLevels(); };
$('#btnPause').onclick = () => { Sfx.click(); pauseGame(); };
$('#btnControl').onclick = () => { Sfx.click(); if (gyroAvailable) setControlMode(controlMode === 'gyro' ? 'joy' : 'gyro'); };
$('#btnCalib').onclick = () => { Sfx.click(); calibrate(); };
const muteBtn = $('#btnMute');
const syncMute = () => { muteBtn.textContent = Sfx.isMuted() ? '🔇' : '🔊'; };
muteBtn.onclick = () => { Sfx.init(); Sfx.setMuted(!Sfx.isMuted()); syncMute(); };
syncMute();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pauseGame(); Sfx.suspend(); } else Sfx.resume();
});

const appEl = $('#app');
function resize() {
  const w = appEl.clientWidth, h = appEl.clientHeight;   // 앱 프레임 크기 기준
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 0.8 ? 72 : 56;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
applyLang();   // 저장된 언어로 첫 화면 글자 채우기
applyLook();   // 저장된 꾸미기 입히기
resize();

// 타이틀 배경용으로 레벨 1 로드
loadLevel(Math.max(0, save.unlocked - 1));
snapCamera();
requestAnimationFrame(frame);

// 디버그/테스트용 훅
window.__duck = { P, get state() { return state; }, startLevel, LEVELS, input, keys, tick, respawn, get heartItem() { return heartItem; }, get hearts() { return hearts; }, get shieldT() { return shieldT; }, get world() { return world; }, get duck() { return duck; }, camera, renderer, scene, THREE, applyLook, get save() { return save; } };
})();
