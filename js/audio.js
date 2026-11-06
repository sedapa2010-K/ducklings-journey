// =====================================================================
// Duckling's Journey - 사운드 (Web Audio 합성: 외부 음원 파일 없음)
// =====================================================================
const Sfx = (() => {
  let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  let muted = false, musicOn = true;
  try { muted = localStorage.getItem('duckwaterway.muted') === '1'; } catch (e) {}
  try { musicOn = localStorage.getItem('duckwaterway.music') !== '0'; } catch (e) {}

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? 0.2 : 0; musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  function quack(pitch = 1) {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let k = 0; k < 2; k++) {
      const t0 = t + k * 0.13;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(620 * pitch, t0);
      o.frequency.exponentialRampToValueAtTime(380 * pitch, t0 + 0.11);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300 * pitch; f.Q.value = 2.5;
      const g = ctx.createGain(); env(g, t0, 0.01, 0.35, 0.11);
      o.connect(f); f.connect(g); g.connect(sfxBus);
      o.start(t0); o.stop(t0 + 0.15);
    }
  }

  function noise(t, dur, freq, q, peak, type = 'bandpass', bus = sfxBus) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); env(g, t, 0.003, peak, dur);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t); s.stop(t + dur + 0.05);
  }

  function splash(vol = 0.25) { if (ctx) noise(ctx.currentTime, 0.12, 1800, 0.8, vol); }

  function bump() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.08);
    const g = ctx.createGain(); env(g, t, 0.003, 0.4, 0.09);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.12);
    noise(t, 0.08, 1500, 1, 0.12);
  }

  function plop() { // 퐁당
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.22);
    const g = ctx.createGain(); env(g, t, 0.005, 0.6, 0.25);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.3);
    noise(t + 0.02, 0.45, 900, 0.6, 0.35, 'lowpass');
  }

  function tone(freq, t, dur, type = 'triangle', peak = 0.3, bus = sfxBus) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain(); env(g, t, 0.01, peak, dur);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }

  function win() {
    if (!ctx) return;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) =>
      tone(f, t + i * 0.11, i === 5 ? 0.6 : 0.18, 'triangle', 0.28));
  }

  function fail() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.25;
    [392, 349.23, 311.13].forEach((f, i) => tone(f, t + i * 0.16, 0.22, 'triangle', 0.18));
  }

  function heal() { // 하트 +1: 따뜻하게 올라가는 소리
    if (!ctx) return;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.07, 0.22, 'sine', 0.22));
  }

  function power() { // 방패 아이템: 위로 올라가는 반짝 소리
    if (!ctx) return;
    const t = ctx.currentTime;
    [659.25, 880, 1174.66, 1567.98].forEach((f, i) => tone(f, t + i * 0.06, 0.16, 'square', 0.12));
    tone(2093, t + 0.26, 0.3, 'sine', 0.15);
  }

  function whoosh() { // 소용돌이: 휘이잉
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(1400, t + 0.25); f.frequency.exponentialRampToValueAtTime(400, t + 0.55);
    const g = ctx.createGain(); env(g, t, 0.05, 0.4, 0.5);
    s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t); s.stop(t + 0.6);
  }

  function click() { if (ctx) tone(880, ctx.currentTime, 0.06, 'sine', 0.15); }
  function beep(high) { if (ctx) tone(high ? 1046.5 : 659.25, ctx.currentTime, 0.15, 'triangle', 0.22); }

  // ---------- BGM: 신나는 4마디 진행(C-G-Am-F) + 드럼 + 통통 튀는 베이스 ----------
  // 1스텝 = 8분음표, 32스텝 = 4마디. 멜로디는 A → B 두 가지가 번갈아 나옴
  const STEP = 0.19;                     // 약 158 BPM
  const ROOTS = [0, 7, 9, 5];            // C, G, Am, F
  const CHORDS = [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]];
  const MEL_A = [0, 4, 7, 4, 12, -1, 7, -1,   11, -1, 7, 11, 14, 12, 11, -1,
                 9, 12, 16, 12, 9, -1, 7, 9,  5, -1, 9, 12, 9, 7, 5, 4];
  const MEL_B = [12, 12, -1, 12, 14, 16, -1, 12,  14, -1, 11, 7, 11, 14, 19, -1,
                 16, 14, 12, -1, 9, 12, 16, 17,   16, 14, 12, 9, 7, -1, 4, 2];
  const BASE = 523.25; // C5
  const st = n => BASE * Math.pow(2, n / 12);
  let bgmTimer = null, step = 0, nextT = 0;

  function kick(t) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain(); env(g, t, 0.003, 0.9, 0.16);
    o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.2);
  }
  function snare(t) {
    noise(t, 0.12, 1800, 0.7, 0.45, 'bandpass', musicBus);
    tone(220, t, 0.06, 'triangle', 0.25, musicBus);
  }
  function hat(t, open) { noise(t, open ? 0.09 : 0.03, 8000, 0.5, open ? 0.16 : 0.1, 'highpass', musicBus); }

  function playStep(t) {
    const i = step % 64, bar = Math.floor((step % 32) / 8), beat = step % 8;
    // 드럼: 쿵 . 짝 . 쿵 쿵 짝 . / 하이햇은 매 박, 뒷박은 살짝 열림
    if (beat === 0 || beat === 4 || beat === 5) kick(t);
    if (beat === 2 || beat === 6) snare(t);
    hat(t, beat % 2 === 1);
    if (step % 32 === 31) { snare(t); snare(t + STEP / 2); }      // 4마디 끝 필인
    // 베이스: 근음 ↔ 옥타브 통통
    const r = ROOTS[bar];
    tone(st(r - 36 + (beat % 2 ? 12 : 0)), t, STEP * 0.8, 'triangle', 0.55, musicBus);
    // 코드 스탭: 뒷박마다 짧게 '짠'
    if (beat % 2 === 1) for (const c of CHORDS[bar]) tone(st(c - 12), t, 0.09, 'square', 0.035, musicBus);
    // 멜로디
    const m = (i < 32 ? MEL_A : MEL_B)[i % 32];
    if (m >= 0) {
      tone(st(m), t, STEP * 0.85, 'triangle', 0.3, musicBus);
      tone(st(m + 12), t, STEP * 0.5, 'sine', 0.06, musicBus);    // 반짝이는 윗 옥타브
    }
  }
  function bgmStart() {
    if (!ctx || bgmTimer) return;
    nextT = ctx.currentTime + 0.1;
    bgmTimer = setInterval(() => {
      while (nextT < ctx.currentTime + 0.3) { playStep(nextT); nextT += STEP; step++; }
    }, 60);
  }
  function bgmStop() { clearInterval(bgmTimer); bgmTimer = null; }

  function setMusic(on) { // 배경음악만 켜고 끄기 (효과음은 그대로)
    musicOn = on;
    try { localStorage.setItem('duckwaterway.music', on ? '1' : '0'); } catch (e) {}
    if (musicBus) musicBus.gain.value = on ? 0.2 : 0;
  }
  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('duckwaterway.muted', m ? '1' : '0'); } catch (e) {}
    if (master) master.gain.value = m ? 0 : 1;
  }
  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  return { init, quack, splash, bump, plop, win, fail, power, heal, whoosh, click, beep, bgmStart, bgmStop,
           setMuted, isMuted: () => muted, setMusic, isMusicOn: () => musicOn, suspend, resume };
})();
