// =====================================================================
// 플레이 스토어 스크린샷 만들기 (헤드리스 Chrome + DevTools 프로토콜, 외부 라이브러리 없음)
// 사용법: python serve.py 를 켜 둔 상태에서
//   node tools/capture-screens.js <출력 폴더> <CSS 폭> <CSS 높이> <배율>
//   예) 7인치 태블릿:  node tools/capture-screens.js store/screenshots/tablet-7in 600 960 2    → 1200×1920
//       10인치 태블릿: node tools/capture-screens.js store/screenshots/tablet-10in 800 1280 2  → 1600×2560
// =====================================================================
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const [outDir, cssW, cssH, dpr] = [process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5] || 2];
if (!outDir || !cssW || !cssH) { console.error('usage: node tools/capture-screens.js <out> <w> <h> [dpr]'); process.exit(1); }
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const URL0 = 'http://localhost:8123/';
const PORT = 9333 + Math.floor(Math.random() * 500);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-shot-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
  let ws, id = 0; const pending = {};
  try {
    let list;
    for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (list.length) break; } catch (e) {} await sleep(200); }
    const page = list.find(t => t.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
    const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result && r.result.result && r.result.result.value; };
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64'));
      console.log('saved', name);
    };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: cssW, height: cssH, deviceScaleFactor: dpr, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    // 진행한 플레이어처럼 보이게: 레벨 60까지 열림, 별·코인·꾸미기
    await send('Page.navigate', { url: URL0 }); await sleep(2500);
    await evalJs(`
      const missions = {}; for (let n = 1; n <= 52; n++) missions[n] = n % 4 ? 7 : 3;
      localStorage.setItem('duckwaterway.v1', JSON.stringify({ unlocked: 60, best: {}, missions, coins: 1280, lang: 'ko',
        equip: { head: 'propeller', body: 'tube', face: 'round', neck: null, fx: 'rainbow', back: 'wings' },
        looksBought: { propeller: true, round: true, wings: true, rainbow: true } }));
      localStorage.setItem('duckwaterway.titleTheme', 'day');`);
    await send('Page.navigate', { url: URL0 }); await sleep(4000);
    const D = 'window.__duck';
    const hideUi = `document.querySelector('#countdown')?.classList.add('hidden');`;
    // 1) 첫 화면
    await shot('1-title');
    // 레벨을 시작해서 오리를 원하는 곳에 놓고 잠깐 진짜로 달리게 한 뒤 찍기
    // 알림 말풍선은 화면을 가리니 스크린샷에선 숨김
    await evalJs(`const st = document.createElement('style'); st.textContent = '#hint { display: none !important; }'; document.head.appendChild(st);`);
    // frames 만큼 게임 시간을 직접 흘린 뒤(헤드리스는 느려서) 그 순간을 그려서 찍음. until(D) 가 참이 되면 거기서 멈춤
    const playAt = async (lvl, pick, frames, extra = '', until = 'null') => {
      await evalJs(`const D = ${D}; D.startLevel(${lvl}); for (let i = 0; i < 400 && D.state !== 'playing'; i++) D.tick(1/60); ${hideUi}
        const S = D.world.samples, flow = D.LEVELS[${lvl}].flow; const i0 = (${pick})(D, S); const s = S[i0];
        Object.assign(D.P, { x: s.x, z: s.z, y: s.y, idx: i0, prog: s.d, vx: s.tx * flow, vz: s.tz * flow, lat: 0 }); ${extra}
        const U = ${until};
        for (let f = 0; f < ${frames}; f++) { if (D.P.cart && D.P.cart.i < D.world.carts[0].sp) D.P.cart.choice = D.world.carts[0].coinSide; D.tick(1/60); if (U && U(D)) break; }
        window.__freeze = true;`);
      await sleep(150);
    };
    // 2) 물길을 헤엄치는 장면 (낮, 폭포 근처)
    await playAt(13, `(D, S) => { const f = S.findIndex(q => q.fall); return Math.max(30, f - 40); }`, 90);
    await shot('2-swim');
    // 3) 🚃 광산 기차 (갈림 레일)
    await playAt(45, `(D, S) => D.world.carts[0].a - 6`, 900, '', `D => D.P.cart && D.P.cart.i > D.world.carts[0].sp + 40`);
    await shot('3-minecart');
    // 4) 🎢 360° 루프
    await playAt(32, `(D, S) => D.world.loops[0].idx - 40`, 600, '', `D => D.P.loop && D.P.loop.th > 2.6`);
    await shot('4-loop');
    // 5) ⛰️ 절벽 다이빙 물보라
    await playAt(22, `(D, S) => S.findIndex(q => q.gap && q.cliff) - 26`, 600, `D.P.vx *= 1.6; D.P.vz *= 1.6;`, `D => D.P.diveT > 0 && D.P.diveT < 1.25`);
    await shot('5-cliff');
    // 6) 🎀 꾸미기
    await evalJs(`const D = ${D}; D.startLevel(6); for (let i = 0; i < 400 && D.state !== 'playing'; i++) D.tick(1/60); ${hideUi}
      for (let f = 0; f < 60; f++) D.tick(1/60);
      document.querySelectorAll('.popup, #pause').forEach(e => e.classList.add('hidden')); document.querySelector('#btnWardrobe').click();`);
    await sleep(3500);
    await shot('6-wardrobe');
    // 7) 🏡 가족을 찾아 도착 (마지막 레벨 집)
    await evalJs(`document.querySelector('#btnWardrobeBack').click();`); await sleep(500);
    await playAt(59, `(D, S) => S.length - 30`, 900, '', `D => D.state === 'win' && (D.__w = (D.__w || 0) + 1) > 150`);
    await shot('7-arrive');
    // 8) 레벨 선택
    await evalJs(`document.querySelectorAll('.popup').forEach(e => e.classList.add('hidden')); const D = ${D}; document.querySelector('#btnBackTitle') ; D.startLevel(0);`);
    await send('Page.navigate', { url: URL0 }); await sleep(3500);
    await evalJs(`document.querySelector('#btnStart')?.click();`); await sleep(2500);
    await shot('8-levels');
  } finally {
    try { ws && ws.close(); } catch (e) {}
    chrome.kill();
    await sleep(500);
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
  }
})().catch(e => { console.error(e); process.exit(1); });
