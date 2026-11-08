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

  function coin() { // 🪙 코인: 짧게 띠링
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(1318.5, t, 0.08, 'square', 0.07); tone(1975.5, t + 0.06, 0.16, 'square', 0.07);
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

  // =====================================================================
  // 🎵 배경음악 (Web Audio 합성)
  //  - 믹서: 악기별 채널(음량·좌우 위치) → 리버브(울림)·딜레이(메아리) 보내기 → 컴프레서 → musicBus
  //  - 악기: 겹친 음(디튠)·필터·비브라토로 두껍고 부드러운 소리
  //  - 곡 구성: 인트로 → A → B → 브릿지(C) … 약 1분 길이로 돌고, 인트로 뒤부터 다시 반복
  //  - 사람이 치는 느낌: 타이밍·세기를 아주 조금씩 흔듦, 석양 곡은 스윙
  // 1스텝 = 8분음표, 한 구간 = 32스텝(4마디)
  // =====================================================================
  const BASE = 523.25; // C5
  const st = n => BASE * Math.pow(2, n / 12);
  let bgmTimer = null, step = 0, nextT = 0, song = 'day', mx = null;

  function makeImpulse(sec, decay) {   // 리버브용 잔향 (점점 작아지는 스테레오 잡음)
    const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  function initMixer() {
    if (mx) return;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.25;
    comp.connect(musicBus);
    const dry = ctx.createGain(); dry.connect(comp);
    const revIn = ctx.createGain(), revLp = ctx.createBiquadFilter(), rev = ctx.createConvolver(), revOut = ctx.createGain();
    revLp.type = 'lowpass'; revLp.frequency.value = 4500; rev.buffer = makeImpulse(2.6, 2.6); revOut.gain.value = 0.7;
    revIn.connect(revLp); revLp.connect(rev); rev.connect(revOut); revOut.connect(comp);
    const dlIn = ctx.createGain(), dl = ctx.createDelay(2), fb = ctx.createGain(), dlf = ctx.createBiquadFilter(), dlOut = ctx.createGain();
    dlf.type = 'lowpass'; dlf.frequency.value = 2600; fb.gain.value = 0.3; dlOut.gain.value = 0.45; dl.delayTime.value = 0.57;
    dlIn.connect(dl); dl.connect(dlf); dlf.connect(fb); fb.connect(dl); dlf.connect(dlOut); dlOut.connect(comp); dlOut.connect(revIn);
    const ch = (vol, pan, r, d) => {
      const g = ctx.createGain(); g.gain.value = vol; let out = g;
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
      out.connect(dry);
      const rs = ctx.createGain(); rs.gain.value = r; out.connect(rs); rs.connect(revIn);
      const ds = ctx.createGain(); ds.gain.value = d; out.connect(ds); ds.connect(dlIn);
      return g;
    };
    mx = { revOut, dl, fb, ch: {
      lead: ch(1, 0.08, 0.32, 0.2), keys: ch(1, -0.28, 0.3, 0), pad: ch(1, 0.22, 0.55, 0), bass: ch(1, 0, 0.04, 0),
      kick: ch(1, 0, 0.03, 0), drum: ch(1, 0.08, 0.16, 0), hat: ch(1, -0.32, 0.1, 0), bell: ch(1, 0.32, 0.45, 0.32) } };
  }

  // 악기 하나 = 여러 오실레이터 → (필터) → 음량 엔벨로프 → 채널
  // parts: [파형, 주파수 배수, 디튠(cent), 음량]
  function voice(chn, f, t, { parts, a = 0.01, peak = 0.3, hold = 0.1, rel = 0.15, filt = null, vib = 0 }) {
    const g = ctx.createGain(), end = t + a + hold + rel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    let dest = g;
    if (filt) {
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = filt.q || 0.8;
      fl.frequency.setValueAtTime(filt.from, t); fl.frequency.exponentialRampToValueAtTime(filt.to, t + (filt.time || 0.2));
      fl.connect(g); dest = fl;
    }
    let lfo = null;
    if (vib && hold > 0.18) {   // 긴 음은 살짝 떨림 (비브라토)
      lfo = ctx.createOscillator(); lfo.frequency.value = 5.2;
      const lg = ctx.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(vib, t + 0.25);
      lfo.connect(lg); lfo.start(t); lfo.stop(end + 0.05); lfo.lg = lg;
    }
    for (const [type, mul, det, lv] of parts) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mul; o.detune.value = det;
      if (lfo) lfo.lg.connect(o.detune);
      const pg = ctx.createGain(); pg.gain.value = lv; o.connect(pg); pg.connect(dest);
      o.start(t); o.stop(end + 0.05);
    }
    g.connect(mx.ch[chn]);
  }
  function nz(chn, t, dur, freq, q, peak, type = 'bandpass') {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); env(g, t, 0.002, peak, dur);
    s.connect(f); f.connect(g); g.connect(mx.ch[chn]);
    if (dur > 0.25) s.loop = true;
    s.start(t, dur > 0.25 ? 0 : Math.random() * 0.3); s.stop(t + dur + 0.05);
  }
  // ---- 드럼 ----
  function kick(t, v = 1) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ctx.createGain(); env(g, t, 0.002, 0.95 * v, 0.2);
    o.connect(g); g.connect(mx.ch.kick); o.start(t); o.stop(t + 0.26);
    nz('kick', t, 0.012, 3000, 0.8, 0.12 * v);   // 톡 하는 어택
  }
  function snare(t, v = 1) {
    nz('drum', t, 0.14, 1900, 0.8, 0.4 * v);
    nz('drum', t, 0.09, 6500, 0.6, 0.18 * v, 'highpass');
    voice('drum', 190, t, { parts: [['triangle', 1, 0, 1]], a: 0.002, peak: 0.22 * v, hold: 0, rel: 0.07 });
  }
  const hat = (t, v = 1, open = false) => nz('hat', t, open ? 0.12 : 0.035, 8500, 0.7, (open ? 0.12 : 0.08) * v, 'highpass');
  const rim = (t, v = 1) => { nz('drum', t, 0.025, 3200, 3, 0.25 * v); voice('drum', 820, t, { parts: [['sine', 1, 0, 1]], a: 0.001, peak: 0.08 * v, hold: 0, rel: 0.03 }); };
  const shaker = (t, v = 1) => nz('hat', t, 0.05, 6000, 1.2, 0.05 * v);
  const crash = (t, v = 1) => nz('hat', t, 1.3, 5200, 0.5, 0.09 * v, 'highpass');

  // ---- 곡 데이터 ----
  const R = -1;   // 쉼표
  const SONGS = {
    // ☀️ 낮: 처음 만든 곡 그대로 (playDayClassic). 박자만 여기서 씀
    day: { step: 0.19, rev: 0.55, dly: 3, fb: 0.25 },
    // 🌅 석양: 느긋하고 따뜻한 보사노바 (Fmaj7-Em7-Dm7-Cmaj7 / 브릿지 Bbmaj7-Am7-Gm7-C7)
    sunset: {
      step: 0.27, swing: 0.14, rev: 0.75, dly: 3, fb: 0.3,
      progs: [
        { roots: [5, 4, 2, 0], chords: [[5, 9, 12, 16], [4, 7, 11, 14], [2, 5, 9, 12], [0, 4, 7, 11]] },
        { roots: [10, 9, 7, 0], chords: [[10, 14, 17, 21], [9, 12, 16, 19], [7, 10, 14, 17], [0, 4, 7, 10]] },
      ],
      mels: {
        A: [9, R, 7, 9, 12, R, R, R,   11, R, 9, 7, 4, R, R, R,   5, R, 9, 12, 14, R, 12, R,   11, R, 7, R, 4, R, R, R],
        B: [12, R, 16, R, 14, 12, 9, R,   11, R, 14, R, 12, 11, 7, R,   9, R, 12, R, 14, R, 17, R,   16, R, 14, 12, 11, R, R, R],
        C: [14, R, 12, 14, 17, R, R, R,   16, R, 12, R, 9, R, R, R,   10, R, 14, R, 17, R, 14, R,   16, R, R, R, 10, R, 7, R],
      },
      sections: {
        intro: { p: 0, mel: null, dr: 1, bass: 1, keys: 1 },
        A:  { p: 0, mel: 'A', dr: 2, bass: 1, keys: 1 },
        B:  { p: 0, mel: 'B', dr: 2, bass: 1, keys: 1, pad: 1 },
        C:  { p: 1, mel: 'C', dr: 2, bass: 1, keys: 1, pad: 1 },
        A2: { p: 0, mel: 'A', dr: 2, bass: 1, keys: 1, pad: 1, oct: 1 },
      },
      order: ['intro', 'A', 'B', 'A', 'C', 'C', 'A2', 'B'], loopTo: 1,
    },
    // 🌙 밤: 오르골 자장가 (C-Am-F-G / 브릿지 F-C-Dm-G), 드럼 없이
    night: {
      step: 0.32, swing: 0, rev: 1.05, dly: 3, fb: 0.35,
      progs: [
        { roots: [0, 9, 5, 7], chords: [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]] },
        { roots: [5, 0, 2, 7], chords: [[5, 9, 12], [0, 4, 7], [2, 5, 9], [7, 11, 14]] },
      ],
      mels: {
        A: [7, R, 4, R, 7, R, 12, R,   9, R, 12, R, 9, R, 4, R,   5, R, 9, R, 12, R, 9, R,   7, R, 11, R, 14, R, R, R],
        B: [16, R, 14, R, 12, R, 7, R,   12, R, 9, R, 7, R, 4, R,   9, R, 5, R, 9, R, 12, R,   11, R, 7, R, 2, R, R, R],
        C: [12, R, 9, R, 5, R, 9, R,   7, R, 4, R, 0, R, 4, R,   5, R, 9, R, 14, R, 12, R,   11, R, R, R, 14, R, R, R],
      },
      sections: {
        intro: { p: 0, mel: null, pad: 1, arp: 1 },
        A:  { p: 0, mel: 'A', pad: 1, arp: 1, bass: 1 },
        B:  { p: 0, mel: 'B', pad: 1, arp: 1, bass: 1 },
        C:  { p: 1, mel: 'C', pad: 1, arp: 0, bass: 1 },
        A2: { p: 0, mel: 'A', pad: 1, arp: 1, bass: 1, oct: 1 },
      },
      order: ['intro', 'A', 'B', 'C', 'A2', 'B'], loopTo: 1,
    },
  };
  // 다음 음까지 몇 스텝인지 (음 길이)
  const noteLen = (mel, pos, max) => { let k = 1; while (k < max && pos + k < 32 && mel[pos + k] === R) k++; return k; };
  const hum = () => (Math.random() - 0.5) * 0.01;        // 타이밍 흔들림 (±5ms)
  const vel = () => 0.86 + Math.random() * 0.2;          // 세기 흔들림

  // ---- 낮: 처음 곡 그대로 (신나는 C-G-Am-F + 드럼 + 통통 튀는 베이스, 리버브 없이 바로 출력) ----
  const STEP = 0.19;
  const ROOTS = [0, 7, 9, 5];
  const CHORDS = [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]];
  const MEL_A = [0, 4, 7, 4, 12, -1, 7, -1,   11, -1, 7, 11, 14, 12, 11, -1,
                 9, 12, 16, 12, 9, -1, 7, 9,  5, -1, 9, 12, 9, 7, 5, 4];
  const MEL_B = [12, 12, -1, 12, 14, 16, -1, 12,  14, -1, 11, 7, 11, 14, 19, -1,
                 16, 14, 12, -1, 9, 12, 16, 17,   16, 14, 12, 9, 7, -1, 4, 2];
  function kickC(t) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain(); env(g, t, 0.003, 0.9, 0.16);
    o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.2);
  }
  function snareC(t) {
    noise(t, 0.12, 1800, 0.7, 0.45, 'bandpass', musicBus);
    tone(220, t, 0.06, 'triangle', 0.25, musicBus);
  }
  function hatC(t, open) { noise(t, open ? 0.09 : 0.03, 8000, 0.5, open ? 0.16 : 0.1, 'highpass', musicBus); }
  function playDayClassic(t) {
    const i = step % 64, bar = Math.floor((step % 32) / 8), beat = step % 8;
    if (beat === 0 || beat === 4 || beat === 5) kickC(t);
    if (beat === 2 || beat === 6) snareC(t);
    hatC(t, beat % 2 === 1);
    if (step % 32 === 31) { snareC(t); snareC(t + STEP / 2); }
    const r = ROOTS[bar];
    tone(st(r - 36 + (beat % 2 ? 12 : 0)), t, STEP * 0.8, 'triangle', 0.55, musicBus);
    if (beat % 2 === 1) for (const c of CHORDS[bar]) tone(st(c - 12), t, 0.09, 'square', 0.035, musicBus);
    const m = (i < 32 ? MEL_A : MEL_B)[i % 32];
    if (m >= 0) {
      tone(st(m), t, STEP * 0.85, 'triangle', 0.3, musicBus);
      tone(st(m + 12), t, STEP * 0.5, 'sine', 0.06, musicBus);
    }
  }
  // ---- 석양 ----
  function playSunset(t, c, S) {
    const { sec, pos, bar, beat, root, chord, nextRoot } = c, sp = S.step;
    if (sec.dr >= 1) {
      if (beat === 0 || beat === 3) kick(t, beat === 0 ? 0.85 : 0.6);   // 쿵 . . 쿵 (보사 느낌)
      if (sec.dr >= 2 && (beat === 2 || beat === 6 || (bar % 2 === 1 && beat === 5))) rim(t + hum(), vel());
      shaker(t + hum(), (beat % 2 ? 1 : 0.55) * vel());
    }
    if (sec.bass) {
      const b = (n, h) => voice('bass', st(n - 36), t, { parts: [['triangle', 1, 0, 0.9], ['sine', 0.5, 0, 0.3]], a: 0.006, peak: 0.42 * vel(), hold: h, rel: 0.12, filt: { from: 900, to: 400, time: 0.15 } });
      if (beat === 0) b(root, sp * 2.2);
      if (beat === 3) b(root + 7, sp * 0.8);   // 5도
      if (beat === 4) b(root, sp * 2);
      if (beat === 7) b(nextRoot - 1, sp * 0.6);   // 다음 화음으로 반음 올라가며 이어줌
    }
    if (sec.keys && (beat === 0 || beat === 2 || beat === 5))   // 전자 피아노 느낌 코드
      for (const n of chord) voice('keys', st(n - 12), t + hum(), { parts: [['sine', 1, 0, 1], ['sine', 2, 3, 0.18], ['triangle', 1, -4, 0.2]],
        a: 0.004, peak: (beat === 0 ? 0.045 : 0.03) * vel(), hold: beat === 0 ? sp * 1.4 : 0.02, rel: beat === 0 ? 0.6 : 0.22 });
    if (sec.pad && beat === 0) for (const n of chord)
      voice('pad', st(n - 12), t, { parts: [['sawtooth', 1, -8, 0.5], ['triangle', 1, 8, 0.6]], a: 0.5, peak: 0.016, hold: sp * 6, rel: 0.8, filt: { from: 700, to: 1200, time: sp * 6 } });
    const m = sec.mel ? S.mels[sec.mel][pos] : R;
    if (m !== R) {   // 부드러운 플루트 느낌 멜로디
      const L = noteLen(S.mels[sec.mel], pos, 4) * sp;
      voice('lead', st(m), t + hum(), { parts: [['sine', 1, -4, 0.8], ['triangle', 1, 4, 0.35], ['sine', 2, 0, 0.06]],
        a: 0.03, peak: 0.24 * vel(), hold: L * 0.6, rel: 0.25, vib: 11 });
      nz('lead', t, 0.06, 2400, 1.5, 0.012);   // 숨소리
      if (sec.oct) voice('bell', st(m + 12), t, { parts: [['sine', 1, 0, 1]], a: 0.004, peak: 0.05, hold: 0, rel: 0.5 });
    }
  }
  // ---- 밤 ----
  const box = (f, t, pk) => voice('bell', f, t, { parts: [['sine', 1, 0, 1], ['sine', 2, 2, 0.22], ['sine', 3.01, 0, 0.08], ['sine', 4.2, 0, 0.04]], a: 0.002, peak: pk, hold: 0, rel: 1.3 });   // 오르골 종소리
  function playNight(t, c, S) {
    const { sec, pos, bar, beat, root, chord } = c, sp = S.step;
    if (sec.pad && beat === 0) for (const n of chord)
      voice('pad', st(n - 12), t, { parts: [['sine', 1, -5, 0.7], ['triangle', 1, 5, 0.4]], a: 0.8, peak: 0.032, hold: sp * 6, rel: 1.4 });
    if (sec.bass && (beat === 0 || (bar % 2 === 1 && beat === 4)))
      voice('bass', st(root - 36), t, { parts: [['sine', 1, 0, 1], ['triangle', 1, 0, 0.2]], a: 0.04, peak: 0.3, hold: sp * 2.5, rel: 0.8 });
    if (sec.arp && beat % 2 === 1) box(st(chord[(beat >> 1) % 3]), t + hum(), 0.04 * vel());   // 살랑이는 아르페지오
    if (pos === 0 && Math.random() < 0.6) for (let k = 0; k < 4; k++) box(st(24 + chord[k % 3] + (k > 2 ? 12 : 0)), t + 0.07 * k, 0.012);   // 반짝 풍경 소리
    const m = sec.mel ? S.mels[sec.mel][pos] : R;
    if (m !== R) { box(st(m + 12), t + hum(), 0.17 * vel()); if (sec.oct) box(st(m + 24), t + 0.012, 0.04); }
  }

  function playStep(t) {
    if (song === 'day') return playDayClassic(t);
    const S = SONGS[song], si = Math.floor(step / 32), pos = step % 32;
    const span = S.order.length - S.loopTo;
    const oi = si < S.order.length ? si : S.loopTo + (si - S.loopTo) % span;
    const sec = S.sections[S.order[oi]], bar = Math.floor(pos / 8), beat = pos % 8;
    const pr = S.progs[sec.p], tt = t + (beat % 2 ? S.swing * S.step : 0);
    const c = { sec, pos, bar, beat, root: pr.roots[bar], chord: pr.chords[bar], nextRoot: pr.roots[(bar + 1) % 4] };
    if (song === 'sunset') playSunset(tt, c, S);
    else playNight(tt, c, S);
  }
  function applySong() {   // 곡마다 울림·메아리 정도
    if (!mx) return;
    const S = SONGS[song], now = ctx.currentTime;
    mx.revOut.gain.setTargetAtTime(S.rev, now, 0.3);
    mx.dl.delayTime.setTargetAtTime(S.step * S.dly, now, 0.05);
    mx.fb.gain.setTargetAtTime(S.fb, now, 0.3);
  }
  function setSong(name) {   // 'day' | 'sunset' | 'night'
    if (!SONGS[name] || name === song) return;
    song = name; step = 0;
    if (ctx) applySong();
  }
  function bgmStart() {
    if (!ctx || bgmTimer) return;
    initMixer(); applySong();
    nextT = ctx.currentTime + 0.1;
    bgmTimer = setInterval(() => {
      while (nextT < ctx.currentTime + 0.3) { playStep(nextT); nextT += SONGS[song].step; step++; }
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

  return { init, setSong, quack, splash, bump, plop, win, fail, power, heal, coin, whoosh, click, beep, bgmStart, bgmStop,
           setMuted, isMuted: () => muted, setMusic, isMusicOn: () => musicOn, suspend, resume };
})();
