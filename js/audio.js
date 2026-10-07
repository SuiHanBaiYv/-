/* ============================================================
 *  塔防 · 音效（全部由 WebAudio 实时合成，无外部素材）
 * ============================================================ */
(function () {
  'use strict';
  const A = window.TDC || (window.TDC = {});

  let ctx = null;
  let master = null;
  let muted = false;
  let noiseBuf = null;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);

      // 预生成一段白噪声，供爆炸/命中使用
      const len = Math.floor(ctx.sampleRate * 0.6);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) {
      ctx = null;
      return false;
    }
    return true;
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  /* 基础音：振荡器 + 包络 */
  function tone(opts) {
    if (muted || !ensure()) return;
    resume();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t0 = ctx.currentTime;
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(opts.f0, t0);
    if (opts.f1 && opts.f1 !== opts.f0) {
      o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.f1), t0 + opts.dur);
    }
    const vol = (opts.vol == null ? 0.3 : opts.vol);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (opts.attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    let node = o;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = opts.filter;
      f.frequency.setValueAtTime(opts.filterFreq || 1200, t0);
      o.connect(f); node = f;
    }
    node.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + opts.dur + 0.02);
  }

  /* 噪声：爆炸 / 冰冻碎裂 */
  function noise(opts) {
    if (muted || !ensure()) return;
    resume();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const t0 = ctx.currentTime;
    f.type = opts.filter || 'lowpass';
    f.frequency.setValueAtTime(opts.f0 || 2400, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.f1 || 200), t0 + opts.dur);
    const vol = opts.vol == null ? 0.3 : opts.vol;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.02);
  }

  const sfx = {
    shoot(kind) {
      switch (kind) {
        case 'cannon':
          tone({ type: 'sawtooth', f0: 180, f1: 60, dur: 0.16, vol: 0.16 });
          noise({ f0: 1800, f1: 300, dur: 0.14, vol: 0.1 });
          break;
        case 'frost':
          tone({ type: 'triangle', f0: 1400, f1: 700, dur: 0.14, vol: 0.12 });
          break;
        case 'tesla':
          tone({ type: 'square', f0: 900, f1: 2400, dur: 0.07, vol: 0.09 });
          break;
        default:
          tone({ type: 'square', f0: 760, f1: 480, dur: 0.055, vol: 0.075 });
      }
    },
    explosion() {
      noise({ f0: 2200, f1: 120, dur: 0.32, vol: 0.24 });
      tone({ type: 'sine', f0: 120, f1: 40, dur: 0.28, vol: 0.16 });
    },
    hit() {
      noise({ f0: 5200, f1: 1800, dur: 0.05, vol: 0.05, filter: 'bandpass' });
    },
    enemyDie() {
      tone({ type: 'square', f0: 340, f1: 90, dur: 0.13, vol: 0.11 });
    },
    bossDie() {
      tone({ type: 'sawtooth', f0: 220, f1: 40, dur: 0.9, vol: 0.24 });
      noise({ f0: 1800, f1: 80, dur: 0.8, vol: 0.22 });
    },
    build() {
      tone({ type: 'triangle', f0: 520, f1: 900, dur: 0.11, vol: 0.2 });
    },
    upgrade() {
      [520, 700, 940].forEach((f, i) => setTimeout(() => tone({ type: 'triangle', f0: f, f1: f * 1.1, dur: 0.1, vol: 0.17 }), i * 70));
    },
    sell() {
      tone({ type: 'triangle', f0: 700, f1: 300, dur: 0.13, vol: 0.15 });
    },
    error() {
      tone({ type: 'sawtooth', f0: 190, f1: 120, dur: 0.16, vol: 0.15 });
    },
    coin() {
      tone({ type: 'sine', f0: 1180, f1: 1560, dur: 0.07, vol: 0.07 });
    },
    leak() {
      tone({ type: 'sawtooth', f0: 300, f1: 70, dur: 0.5, vol: 0.26 });
      noise({ f0: 900, f1: 100, dur: 0.4, vol: 0.16 });
    },
    waveStart() {
      [440, 587, 740].forEach((f, i) => setTimeout(() => tone({ type: 'sawtooth', f0: f, f1: f, dur: 0.17, vol: 0.13 }), i * 105));
    },
    waveClear() {
      [660, 880, 1174].forEach((f, i) => setTimeout(() => tone({ type: 'triangle', f0: f, f1: f, dur: 0.19, vol: 0.16 }), i * 95));
    },
    bossWarn() {
      tone({ type: 'sawtooth', f0: 110, f1: 220, dur: 0.7, vol: 0.24 });
      setTimeout(() => tone({ type: 'sawtooth', f0: 110, f1: 220, dur: 0.7, vol: 0.24 }), 780);
    },
    gameOver() {
      [523, 415, 349, 262].forEach((f, i) => setTimeout(() => tone({ type: 'sawtooth', f0: f, f1: f * 0.98, dur: 0.42, vol: 0.2 }), i * 185));
    },
    victory() {
      [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone({ type: 'triangle', f0: f, f1: f, dur: 0.36, vol: 0.19 }), i * 135));
    }
  };

  A.audio = {
    unlock() { ensure(); resume(); },
    play(name, arg) { if (!muted && sfx[name]) { try { sfx[name](arg); } catch (e) { /* 忽略音频异常 */ } } },
    setMuted(v) { muted = !!v; if (master) master.gain.value = v ? 0 : 0.32; },
    isMuted() { return muted; },
    toggleMute() { A.audio.setMuted(!muted); return muted; }
  };
})();
