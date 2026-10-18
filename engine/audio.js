// 音（WebAudio で合成：足音・水音・風・遠くの電車・鳥・トビ・秋の虫・猫・チャイム）。最初の操作で init() を呼ぶ。
export function createAudio({ volume = 0.55 } = {}) {
  let actx = null, master = null, noiseBuf = null, waterGain = null, enabled = true;
  const beds = {}; // 鳴らし続けるノイズ（風・遠くの電車の響き）。音量だけ変える

  function init() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    master = actx.createGain();
    master.gain.value = enabled ? volume : 0;
    master.connect(actx.destination);
    // 水音：ローパスをかけたノイズを鳴らし続け、音量だけ変える
    const src = actx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const lp = actx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 520;
    waterGain = actx.createGain(); waterGain.gain.value = 0;
    src.connect(lp).connect(waterGain).connect(master);
    src.start();
    // 風（中域を通したノイズ）と、遠くの電車の響き（低域）
    for (const [name, type, freq, q] of [['wind', 'bandpass', 420, 0.5], ['rumble', 'lowpass', 110, 0.7]]) {
      const s = actx.createBufferSource();
      s.buffer = noiseBuf; s.loop = true;
      const f = actx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = actx.createGain(); g.gain.value = 0;
      s.connect(f).connect(g).connect(master);
      s.start(0, Math.random() * 1.5);
      beds[name] = g;
    }
  }

  // surface: 'wood'（橋）| 'grass'（芝生）| 'stone'（石畳など）
  function footstep(surface = 'stone') {
    if (!actx || !enabled) return;
    const t = actx.currentTime;
    const s = actx.createBufferSource(); s.buffer = noiseBuf;
    const f = actx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = surface === 'wood' ? 420 : surface === 'grass' ? 2600 : 1100 + Math.random() * 300;
    f.Q.value = surface === 'wood' ? 4 : 1.3;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(surface === 'grass' ? 0.1 : 0.22, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (surface === 'wood' ? 0.16 : 0.1));
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random() * 1.5, 0.2);
  }

  function tone(type, f0, f1, dur, vol, delay = 0) {
    if (!actx || !enabled) return;
    const t = actx.currentTime + delay;
    const osc = actx.createOscillator(); osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  return {
    init, footstep, tone,
    chirp() { const f = 2600 + Math.random() * 1200; tone('sine', f, f * 1.4, 0.09, 0.05); tone('sine', f * 1.1, f * 1.5, 0.08, 0.04, 0.13); },
    meow() { tone('triangle', 620, 820, 0.18, 0.12); tone('triangle', 820, 420, 0.4, 0.12, 0.17); },
    chime() { tone('sine', 1320, 1318, 0.5, 0.08); tone('sine', 990, 988, 0.6, 0.07, 0.18); },
    // 秋の虫（コオロギ・スズムシの短いトリル）
    cricket(pitch = 1) {
      const f = (4200 + Math.random() * 500) * pitch, n = 3 + (Math.random() * 4 | 0);
      for (let i = 0; i < n; i++) tone('sine', f, f * 1.01, 0.035, 0.02, i * 0.055);
    },
    // トビの鳴き声（ピーヒョロロ）
    kite() {
      tone('sine', 2100, 2900, 0.28, 0.035);
      for (let i = 0; i < 4; i++) tone('sine', 2700 - i * 120, 2000 - i * 120, 0.16, 0.03 - i * 0.004, 0.36 + i * 0.17);
    },
    // 鳴らし続ける音（'wind' | 'rumble'）の大きさへ、なめらかに近づける
    setBed(name, target, dt) {
      const g = beds[name];
      if (g) g.gain.value += (target - g.gain.value) * Math.min(1, dt * 2);
    },
    // 水辺までの近さに応じた水音の大きさ（0〜）へ、なめらかに近づける
    setWater(target, dt) {
      if (waterGain) waterGain.gain.value += (target - waterGain.gain.value) * Math.min(1, dt * 3);
    },
    get enabled() { return enabled; },
    setEnabled(on) { enabled = on; if (master) master.gain.value = on ? volume : 0; }
  };
}
