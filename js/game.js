/* ============================================================
 *  塔防 · 游戏主体
 * ============================================================ */
(function () {
  'use strict';
  const C = window.TDC;
  const audio = C.audio;

  /* ---------------- DOM ---------------- */
  const $ = (s) => document.querySelector(s);
  const canvas = $('#game');
  const ctx = canvas.getContext('2d');
  const els = {
    gold: $('#hud-gold'), lives: $('#hud-lives'), wave: $('#hud-wave'),
    waveName: $('#hud-wave-name'), score: $('#hud-score'),
    waveBtn: $('#btn-wave'), speedBtn: $('#btn-speed'), pauseBtn: $('#btn-pause'),
    muteBtn: $('#btn-mute'), restartBtn: $('#btn-restart'),
    shop: $('#shop'), nextBox: $('#next-box'),
    banner: $('#banner'), overlay: $('#overlay'), overlayBody: $('#overlay-body'),
    panelInfo: $('#panel-info'), tipEl: $('#tip')
  };

  /* ---------------- 画布尺寸 ---------------- */
  const W = C.W, H = C.H, TILE = C.TILE, COLS = C.COLS, ROWS = C.ROWS;
  // 按实际显示宽度反推内部分辨率：无论 CSS 怎么拉伸都保持清晰，
  // 且不设内联 style.width，避免压过响应式布局。
  function fitCanvas() {
    const cssW = canvas.getBoundingClientRect().width || W;
    const scale = Math.max(1, Math.min(cssW / W, 2.5));   // 最多 2.5x，避免超大画布浪费性能
    const px = Math.round(W * scale);
    if (canvas.width !== px) {
      canvas.width = px;
      canvas.height = Math.round(H * scale);
    }
    // 记录当前变换比例，渲染时用它把逻辑坐标映射到像素
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  fitCanvas();
  window.addEventListener('resize', () => { fitCanvas(); });
  // 首屏布局稳定后再校正一次（字体加载/滚动条出现会改变宽度）
  setTimeout(fitCanvas, 300);
  window.addEventListener('load', fitCanvas);

  /* ---------------- 路径几何 ---------------- */
  // 把格坐标拐点展开为像素折线 + 累积长度表
  const path = (function buildPath() {
    const pts = C.WAYPOINTS.map(([c, r]) => ({
      x: c * TILE + TILE / 2,
      y: r * TILE + TILE / 2
    }));
    const segs = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      segs.push({ a, b, len, ux: dx / len, uy: dy / len, start: total });
      total += len;
    }
    return { pts, segs, total };
  })();

  // 距离 d 处的坐标与朝向
  function posAt(d) {
    if (d <= 0) {
      const s = path.segs[0];
      return { x: s.a.x + s.ux * d, y: s.a.y + s.uy * d, ux: s.ux, uy: s.uy };
    }
    for (let i = 0; i < path.segs.length; i++) {
      const s = path.segs[i];
      if (d <= s.start + s.len) {
        const t = d - s.start;
        return { x: s.a.x + s.ux * t, y: s.a.y + s.uy * t, ux: s.ux, uy: s.uy };
      }
    }
    const s = path.segs[path.segs.length - 1];
    const t = s.len;
    return { x: s.b.x, y: s.b.y, ux: s.ux, uy: s.uy };
  }

  // 判定某格是否在路径上（用于禁止建造）
  const pathCells = new Set();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cx = c * TILE + TILE / 2, cy = r * TILE + TILE / 2;
      // 找路径上最近的段，容差 TILE*0.5
      for (let i = 0; i < path.segs.length; i++) {
        const s = path.segs[i];
        const t = Math.max(0, Math.min(s.len, (cx - s.a.x) * s.ux + (cy - s.a.y) * s.uy));
        const px = s.a.x + s.ux * t, py = s.a.y + s.uy * t;
        if (Math.hypot(cx - px, cy - py) < TILE * 0.5 - 1) { pathCells.add(r * COLS + c); break; }
      }
    }
  }

  /* ---------------- 游戏状态 ---------------- */
  const G = {
    state: 'idle',       // idle | prep | running | over | win
    gold: 0, lives: 0, score: 0,
    wave: 0,             // 已开始的波数（0 表示还没开始）
    prepTimer: 0,
    speed: 1,
    paused: false,
    towers: [], enemies: [], bullets: [], effects: [], floaters: [],
    spawnQueue: [],
    selected: null,      // 选中的塔
    buildType: null,     // 待建造的塔类型
    hoverCell: null,
    showRange: false,
    time: 0,
    shake: 0,
    bossWarned: false
  };

  const TOTAL_WAVES = C.WAVES.length;
  const grid = new Array(COLS * ROWS).fill(null);

  /* ---------------- 工具 ---------------- */
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

  function reset() {
    G.state = 'prep';
    G.gold = C.START_GOLD;
    G.lives = C.START_LIVES;
    G.score = 0;
    G.wave = 0;
    G.prepTimer = C.PREPARE_TIME;
    G.towers.length = 0; G.enemies.length = 0; G.bullets.length = 0;
    G.effects.length = 0; G.floaters.length = 0; G.spawnQueue.length = 0;
    G.selected = null; G.buildType = null; G.speed = 1; G.paused = false;
    G.shake = 0; G.bossWarned = false;
    grid.fill(null);
    hideBanner();
    buildShop();
    updateNextBox();
    syncHud();
    updateWaveBtn();
  }

  /* ---------------- HUD ---------------- */
  function syncHud() {
    els.gold.textContent = G.gold;
    els.lives.textContent = G.lives;
    els.wave.textContent = G.wave + ' / ' + TOTAL_WAVES;
    els.score.textContent = G.score;
    const w = C.WAVES[Math.min(G.wave, TOTAL_WAVES - 1)];
    els.waveName.textContent = G.wave === 0 ? '准备中' : (w && w.boss ? '首领波' : '常规波');
    els.waveName.className = 'badge' + (w && w.boss && G.wave > 0 ? ' badge-boss' : '');
    els.speedBtn.textContent = '×' + G.speed;
    els.pauseBtn.textContent = G.paused ? '▶ 继续' : '⏸ 暂停';
    els.pauseBtn.classList.toggle('active', G.paused);
    refreshPanelLive();
  }

  function updateWaveBtn() {
    if (G.state === 'over' || G.state === 'win') { els.waveBtn.disabled = true; return; }
    els.waveBtn.disabled = false;
    if (G.state === 'prep') {
      const bonus = Math.max(0, Math.ceil(G.prepTimer)) * C.EARLY_BONUS_PER_SEC;
      els.waveBtn.innerHTML = '▶ 开始第 ' + (G.wave + 1) + ' 波 <small>提前开波 +' + bonus + ' 金币</small>';
    } else {
      els.waveBtn.innerHTML = '⏳ 战斗中… <small>清空敌人后可提前开波</small>';
      els.waveBtn.disabled = true;
    }
  }

  function banner(main, sub, cls) {
    els.banner.className = 'banner show' + (cls ? ' ' + cls : '');
    els.banner.innerHTML = '<div class="banner-main">' + main + '</div>' +
      (sub ? '<div class="banner-sub">' + sub + '</div>' : '');
    clearTimeout(banner._t);
    banner._t = setTimeout(hideBanner, 1500);
  }
  function hideBanner() { els.banner.className = 'banner'; }

  /* ---------------- 商店 UI ---------------- */
  function buildShop() {
    els.shop.innerHTML = '';
    C.TOWER_ORDER.forEach((key) => {
      const t = C.TOWERS[key];
      const lv = t.levels[0];
      const el = document.createElement('button');
      el.className = 'shop-item';
      el.dataset.tower = key;
      el.innerHTML =
        '<span class="shop-ico" style="background:' + t.color + '"></span>' +
        '<span class="shop-body">' +
          '<span class="shop-name">' + t.name + '<em class="key">' + t.hotkey + '</em></span>' +
          '<span class="shop-meta">DPS ' + Math.round(lv.dmg * lv.rate) + ' · 射程 ' + lv.range.toFixed(1) + '</span>' +
        '</span>' +
        '<span class="shop-cost">' + lv.cost + '<i>金</i></span>';
      el.addEventListener('click', () => selectBuild(key));
      el.addEventListener('mouseenter', () => { G.showRange = true; G.peekType = key; });
      el.addEventListener('mouseleave', () => { G.showRange = false; G.peekType = null; });
      els.shop.appendChild(el);
    });
    syncShopState();
  }

  function syncShopState() {
    const nodes = els.shop.querySelectorAll('.shop-item');
    nodes.forEach((n) => {
      const key = n.dataset.tower;
      const cost = C.TOWERS[key].levels[0].cost;
      n.classList.toggle('active', G.buildType === key);
      n.classList.toggle('poor', G.gold < cost);
    });
  }

  function selectBuild(key) {
    audio.unlock();
    if (G.state === 'over' || G.state === 'win') return;
    if (G.gold < C.TOWERS[key].levels[0].cost) {
      audio.play('error');
      toast('金币不足，还需 ' + (C.TOWERS[key].levels[0].cost - G.gold) + ' 金币');
      return;
    }
    G.buildType = G.buildType === key ? null : key;
    G.selected = null;
    syncShopState();
    renderPanel();
  }

  /* ---------------- 塔信息面板 ---------------- */
  function renderPanel() {
    const p = els.panelInfo;
    if (G.selected) {
      const t = G.selected;
      const def = C.TOWERS[t.kind];
      const lv = def.levels[t.level];
      const next = t.level < 2 ? def.levels[t.level + 1] : null;
      const sellVal = Math.round(t.invested * 0.6);
      p.innerHTML =
        '<div class="p-title" style="color:' + def.color + '">' + def.name +
          '<em class="lvl">Lv.' + (t.level + 1) + '</em></div>' +
        '<div class="p-rows">' +
          row('伤害', lv.dmg) + row('攻速', lv.rate.toFixed(2) + '/s') +
          row('射程', lv.range.toFixed(1)) + row('DPS', Math.round(lv.dmg * lv.rate)) +
          (lv.splash ? row('溅射', lv.splash.toFixed(1)) : '') +
          (lv.slow ? row('减速', Math.round((1 - lv.slow) * 100) + '%') : '') +
          (lv.chain ? row('链数', lv.chain) : '') +
          row('累计投入', t.invested) +
        '</div>' +
        (next
          ? '<div class="p-btns">' +
              '<button class="btn-up" id="btn-up">升级 · ' + next.cost + ' 金</button>' +
              '<button class="btn-sell" id="btn-sell">拆除 +' + sellVal + '</button></div>' +
            '<div class="p-warn" id="p-warn">' + (G.gold < next.cost ? '金币不足，还需 ' + (next.cost - G.gold) : '') + '</div>'
          : '<div class="p-max">已达最高等级</div>' +
            '<div class="p-btns"><button class="btn-sell" id="btn-sell">拆除 +' + sellVal + '</button></div>') +
        '<div class="p-desc">' + def.desc + '</div>';
      const up = document.getElementById('btn-up');
      if (up) up.addEventListener('click', () => upgradeTower(t));
      const sl = document.getElementById('btn-sell');
      if (sl) sl.addEventListener('click', () => sellTower(t));
    } else if (G.buildType) {
      const def = C.TOWERS[G.buildType];
      p.innerHTML =
        '<div class="p-title" style="color:' + def.color + '">' + def.name + ' 建造中</div>' +
        '<div class="p-desc">' + def.desc + '</div>' +
        '<div class="p-hint">点击绿色空地放置 · 按 ESC 取消</div>';
    } else {
      p.innerHTML = '<div class="p-desc">点击底部防御塔选择建造，再点空地放置。点击已建塔可升级或拆除。</div>';
    }
  }
  function row(k, v) { return '<div class="p-row"><span>' + k + '</span><b>' + v + '</b></div>'; }

  // 金币变化时只刷新提示文字，不重建 DOM（避免闪烁 / 丢失按钮焦点）
  function refreshPanelLive() {
    const w = document.getElementById('p-warn');
    if (!w || !G.selected) return;
    const def = C.TOWERS[G.selected.kind];
    if (G.selected.level >= 2) return;
    const cost = def.levels[G.selected.level + 1].cost;
    const lack = Math.max(0, cost - G.gold);
    w.textContent = lack > 0 ? '金币不足，还需 ' + lack : '';
    w.classList.toggle('empty', lack === 0);
  }

  /* ---------------- 建造 / 升级 / 拆除 ---------------- */
  function cellFree(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    if (pathCells.has(r * COLS + c)) return false;
    if (grid[r * COLS + c]) return false;
    return true;
  }

  function placeTower(c, r) {
    const key = G.buildType;
    if (!key) return false;
    const def = C.TOWERS[key];
    const cost = def.levels[0].cost;
    if (!cellFree(c, r)) { audio.play('error'); toast('这里不能建造'); return false; }
    if (G.gold < cost) { audio.play('error'); toast('金币不足'); return false; }
    G.gold -= cost;
    const t = {
      kind: key, level: 0, c, r,
      x: c * TILE + TILE / 2, y: r * TILE + TILE / 2,
      cd: 0, angle: -Math.PI / 2, target: null, recoil: 0, flash: 0, invested: cost, id: Math.random()
    };
    G.towers.push(t);
    grid[r * COLS + c] = t;
    audio.play('build');
    burst(t.x, t.y, 10, def.accent);
    syncHud(); syncShopState();
    // 金币刚好用完时自动取消建造模式，避免误操作
    if (G.gold < cost) { G.buildType = null; syncShopState(); renderPanel(); }
    return true;
  }

  function upgradeTower(t) {
    const def = C.TOWERS[t.kind];
    if (t.level >= 2) return;
    const cost = def.levels[t.level + 1].cost;
    if (G.gold < cost) { audio.play('error'); toast('金币不足'); return; }
    G.gold -= cost;
    t.invested += cost;
    t.level++;
    audio.play('upgrade');
    burst(t.x, t.y, 16, '#ffd76a');
    renderPanel(); syncHud(); syncShopState();
  }

  function sellTower(t) {
    const refund = Math.round(t.invested * 0.6);
    G.gold += refund;
    grid[t.r * COLS + t.c] = null;
    const i = G.towers.indexOf(t);
    if (i >= 0) G.towers.splice(i, 1);
    if (G.selected === t) G.selected = null;
    audio.play('sell');
    burst(t.x, t.y, 12, '#cbd5e1');
    renderPanel(); syncHud(); syncShopState();
  }

  /* ---------------- 波次 ---------------- */
  function waveComposition(waveIdx) {
    const def = C.WAVES[clamp(waveIdx, 0, TOTAL_WAVES - 1)];
    const out = {};
    let t = 0;
    def.groups.forEach((g) => {
      for (let i = 0; i < g.count; i++) {
        out[g.type] = (out[g.type] || 0) + 1;
        t = Math.max(t, (g.delay || 0) + i * g.gap);
      }
    });
    return { counts: out, duration: t, boss: !!def.boss };
  }

  function updateNextBox() {
    const next = Math.min(G.wave, TOTAL_WAVES - 1);
    const info = waveComposition(next);
    const names = { grunt: '小兵', runner: '疾行者', tank: '重甲兵', boss: '首领' };
    const parts = Object.keys(info.counts).map((k) =>
      '<span class="chip' + (k === 'boss' ? ' chip-boss' : '') + '">' + names[k] + ' ×' + info.counts[k] + '</span>');
    els.nextBox.innerHTML = (G.state === 'win' ? '<div class="chip">已全部通关</div>' : parts.join('')) +
      (info.boss ? '<span class="chip chip-boss">⚠ 首领来袭</span>' : '');
  }

  function startWave() {
    if (G.state !== 'prep') return;
    if (G.wave >= TOTAL_WAVES) { endGame(true); return; }
    // 提前开波奖励
    if (G.prepTimer > 0.5) {
      const bonus = Math.floor(G.prepTimer * C.EARLY_BONUS_PER_SEC);
      if (bonus > 0) { G.gold += bonus; addFloater(W / 2, 60, '+' + bonus + ' 金币', '#ffd76a'); }
    }
    const idx = G.wave;
    const def = C.WAVES[idx];
    G.spawnQueue.length = 0;
    def.groups.forEach((g) => {
      for (let i = 0; i < g.count; i++) {
        G.spawnQueue.push({ type: g.type, at: (g.delay || 0) + i * g.gap });
      }
    });
    G.spawnQueue.sort((a, b) => a.at - b.at);
    G.spawnIdx = 0;
    G.waveT = 0;
    G.wave++;
    G.state = 'running';
    G.bossWarned = false;
    const isBoss = !!def.boss;
    banner(isBoss ? '⚠ 首领波' : '第 ' + G.wave + ' 波',
      isBoss ? '首领单位已进入战场' : '敌人正在接近', isBoss ? 'danger' : '');
    if (isBoss) audio.play('bossWarn'); else audio.play('waveStart');
    syncHud(); updateWaveBtn(); updateNextBox();
  }

  function spawnEnemy(type) {
    const base = C.ENEMIES[type];
    const hpMul = 1 + C.HP_SCALE_PER_WAVE * G.wave;
    const spMul = 1 + C.SPEED_SCALE_PER_WAVE * G.wave;
    const e = {
      type, def: base,
      hp: Math.round(base.hp * hpMul), maxHp: Math.round(base.hp * hpMul),
      speed: base.speed * spMul * TILE,
      d: 0, x: posAt(0).x, y: posAt(0).y, r: base.r,
      slowT: 0, slowK: 0, hitFlash: 0, dead: false,
      wob: Math.random() * Math.PI * 2
    };
    G.enemies.push(e);
    if (type === 'boss') {
      G.shake = 8;
      audio.play('bossWarn');
    }
  }

  function finishWave() {
    const reward = 40 + G.wave * 6;
    G.gold += reward;
    G.score += 120 + G.wave * 20;
    addFloater(W / 2, 70, '波次清空  +' + reward + ' 金币', '#ffd76a');
    audio.play('waveClear');
    if (G.wave >= TOTAL_WAVES) { endGame(true); return; }
    G.state = 'prep';
    G.prepTimer = C.PREPARE_TIME;
    G.bossWarned = false;
    syncHud(); updateWaveBtn();
  }

  function endGame(win) {
    G.state = win ? 'win' : 'over';
    G.paused = false;
    if (win) {
      G.score += G.lives * 150 + 800;
      audio.play('victory');
      showOverlay('胜利！', '全部 ' + TOTAL_WAVES + ' 波已清空，基地安全。', true);
    } else {
      audio.play('gameOver');
      showOverlay('失败', '第 ' + G.wave + ' 波时基地被攻破。', false);
    }
    syncHud(); updateWaveBtn();
  }

  function showOverlay(title, sub, win) {
    const best = loadBest();
    if (G.score > best) { try { localStorage.setItem('td_best', String(G.score)); } catch (e) {} }
    els.overlay.className = 'overlay show' + (win ? ' win' : ' lose');
    els.overlayBody.innerHTML =
      '<h2>' + title + '</h2><p>' + sub + '</p>' +
      '<div class="ov-stats">' +
        '<div><span>得分</span><b>' + G.score + '</b></div>' +
        '<div><span>波次</span><b>' + G.wave + '</b></div>' +
        '<div><span>剩余生命</span><b>' + G.lives + '</b></div>' +
        '<div><span>历史最佳</span><b>' + Math.max(best, G.score) + '</b></div>' +
      '</div>' +
      '<button id="ov-again" class="btn-big">再来一局</button>';
    document.getElementById('ov-again').addEventListener('click', () => {
      els.overlay.className = 'overlay';
      reset();
    });
  }
  function loadBest() { try { return parseInt(localStorage.getItem('td_best') || '0', 10) || 0; } catch (e) { return 0; } }

  /* ---------------- 提示条 ---------------- */
  let toastT = null;
  function toast(msg) {
    els.tipEl.textContent = msg;
    els.tipEl.className = 'tip show';
    clearTimeout(toastT);
    toastT = setTimeout(() => { els.tipEl.className = 'tip'; }, 1400);
  }

  /* ---------------- 特效 ---------------- */
  function burst(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(40, 180);
      G.effects.push({
        kind: 'p', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rnd(0.28, 0.6), max: 0.6, color, r: rnd(1.5, 3.5)
      });
    }
  }
  function ring(x, y, radius, color) {
    G.effects.push({ kind: 'r', x, y, r0: 6, r1: radius, life: 0.32, max: 0.32, color });
  }
  function spark(x1, y1, x2, y2, color, life) {
    G.effects.push({ kind: 'z', x1, y1, x2, y2, life: life || 0.16, max: life || 0.16, color });
  }
  function addFloater(x, y, text, color) {
    G.floaters.push({ x, y, text, color, life: 1.0 });
  }

  /* ---------------- 目标选择 ---------------- */
  function pickTarget(t, lv) {
    const range = lv.range * TILE;
    let best = null, bestScore = -Infinity;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d2 = dist2(t.x, t.y, e.x, e.y);
      if (d2 > range * range) continue;
      let s;
      if (G.targetMode === 'first') s = e.d;
      else if (G.targetMode === 'last') s = -e.d;
      else s = -d2;
      if (s > bestScore) { bestScore = s; best = e; }
    }
    return best;
  }
  G.targetMode = 'first';

  /* ---------------- 伤害 ---------------- */
  function damage(e, raw, opts) {
    if (e.dead) return;
    const opts2 = opts || {};
    let dmg = raw * (1 - e.def.armor);
    if (opts2.slow) {
      e.slowT = Math.max(e.slowT, opts2.slowDur);
      e.slowK = Math.max(e.slowK, opts2.slow);
    }
    e.hp -= dmg;
    e.hitFlash = 0.12;
    // 伤害飘字：给独立的横向漂移与初速，避免密集命中时数字叠成一团
    if (G.showDmg && G.floaters.length < 26 && (opts2.big || Math.random() < 0.28)) {
      G.floaters.push({
        x: e.x + rnd(-8, 8), y: e.y - e.r - 4,
        vx: rnd(-34, 34),
        text: String(Math.round(dmg)),
        color: opts2.big ? '#ff9a3c' : '#ffffff',
        life: 0.62, small: true
      });
    }
    if (e.hp <= 0) killEnemy(e);
  }

  function killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    G.gold += e.def.reward;
    G.score += e.def.reward * 2;
    if (e.type === 'boss') {
      G.shake = 16;
      audio.play('bossDie');
      ring(e.x, e.y, 130, '#ff6b8a');
      burst(e.x, e.y, 46, '#ff5c7a');
      addFloater(e.x, e.y - 20, '首领被击溃！', '#ff6b8a');
    } else {
      audio.play('enemyDie');
      burst(e.x, e.y, 10, e.def.color);
    }
    audio.play('coin');
    // 金币实时反映到 HUD，并解锁买不起的塔
    syncHud();
    syncShopState();
  }

  function leak(e) {
    e.dead = true;
    G.lives -= e.def.leak;
    G.shake = 12;
    audio.play('leak');
    addFloater(e.x, e.y, '-' + e.def.leak + ' 生命', '#ff5c5c');
    burst(e.x, e.y, 18, '#ff5c5c');
    if (G.lives <= 0) { G.lives = 0; endGame(false); }
  }

  /* ---------------- 塔开火 ---------------- */
  function fire(t, lv, target) {
    const a = Math.atan2(target.y - t.y, target.x - t.x);
    t.angle = a; t.recoil = 1; t.flash = 0.1;

    if (t.kind === 'tesla') {
      audio.play('shoot', 'tesla');
      let from = { x: t.x, y: t.y - 6 };
      const hit = new Set();
      let cur = target;
      let dmg = lv.dmg;
      for (let i = 0; i < lv.chain && cur; i++) {
        hit.add(cur);
        spark(from.x, from.y, cur.x, cur.y, '#d9b6ff', 0.18);
        damage(cur, dmg, { big: true });
        // 寻找下一个未命中目标
        const cr = lv.chainRange * TILE;
        let next = null, nd = cr * cr;
        for (const e of G.enemies) {
          if (e.dead || hit.has(e)) continue;
          const d2 = dist2(cur.x, cur.y, e.x, e.y);
          if (d2 < nd) { nd = d2; next = e; }
        }
        from = { x: cur.x, y: cur.y };
        cur = next;
        dmg *= 0.78;
      }
      return;
    }

    audio.play('shoot', t.kind);
    const muzzle = 12;
    const mx = t.x + Math.cos(a) * muzzle, my = t.y + Math.sin(a) * muzzle;
    G.bullets.push({
      kind: t.kind, x: mx, y: my, vx: 0, vy: 0, target,
      speed: lv.bulletSpeed, dmg: lv.dmg, splash: lv.splash || 0,
      slow: lv.slow || 0, slowDur: lv.slowDur || 0,
      arc: t.kind === 'cannon', t: 0, life: 2.2, a
    });
  }

  /* ---------------- 更新 ---------------- */
  function update(dt) {
    if (G.state === 'over' || G.state === 'win') return;
    G.time += dt;

    // 准备阶段倒计时
    if (G.state === 'prep') {
      G.prepTimer -= dt;
      if (G.prepTimer <= 0) { G.prepTimer = 0; startWave(); }
    }

    // 出怪
    if (G.state === 'running') {
      G.waveT += dt;
      while (G.spawnIdx < G.spawnQueue.length && G.spawnQueue[G.spawnIdx].at <= G.waveT) {
        spawnEnemy(G.spawnQueue[G.spawnIdx].type);
        G.spawnIdx++;
      }
    }

    // 敌人
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      if (e.dead) { G.enemies.splice(i, 1); continue; }
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowK = 0; }
      if (e.hitFlash > 0) e.hitFlash -= dt;
      const mult = 1 - e.slowK;
      e.d += e.speed * mult * dt;
      const p = posAt(e.d);
      e.x = p.x; e.y = p.y;
      e.wob += dt * 6;
      if (e.d >= path.total) { G.enemies.splice(i, 1); leak(e); }
    }

    // 塔
    for (const t of G.towers) {
      const def = C.TOWERS[t.kind];
      const lv = def.levels[t.level];
      t.cd -= dt;
      if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt * 5);
      if (t.flash > 0) t.flash -= dt;

      let target = t.target;
      if (!target || target.dead || dist2(t.x, t.y, target.x, target.y) > (lv.range * TILE) ** 2) {
        target = pickTarget(t, lv);
        t.target = target;
      }
      if (target) {
        // 炮塔转向更慢，制造手感差异
        const want = Math.atan2(target.y - t.y, target.x - t.x);
        t.angle = lerpAngle(t.angle, want, Math.min(1, dt * (t.kind === 'cannon' ? 7 : 16)));
        if (t.cd <= 0) { fire(t, lv, target); t.cd = 1 / lv.rate; }
      }
    }

    // 子弹
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      b.life -= dt;
      if (b.life <= 0) { G.bullets.splice(i, 1); continue; }

      if (b.kind === 'cannon') {
        // 抛物线：直接朝目标当前位置推进 + 视觉抬升
        const tg = b.target && !b.target.dead ? b.target : b.lastPos || b.target;
        if (b.target && !b.target.dead) b.lastPos = { x: b.target.x, y: b.target.y };
        if (!tg || (tg.x == null)) { G.bullets.splice(i, 1); continue; }
        const a = Math.atan2(tg.y - b.y, tg.x - b.x);
        const step = b.speed * dt;
        const d = dist2(b.x, b.y, tg.x, tg.y);
        if (Math.sqrt(d) <= step + 6) {
          explode(tg.x, tg.y, b.splash, b.dmg);
          G.bullets.splice(i, 1);
        } else {
          b.x += Math.cos(a) * step;
          b.y += Math.sin(a) * step;
          b.arc = true;
        }
        continue;
      }

      const tg = b.target;
      if (!tg || tg.dead) { G.bullets.splice(i, 1); continue; }
      const a = Math.atan2(tg.y - b.y, tg.x - b.x);
      const step = b.speed * dt;
      if (dist2(b.x, b.y, tg.x, tg.y) <= step * step + 4) {
        damage(tg, b.dmg, { slow: b.slow, slowDur: b.slowDur });
        burst(b.x, b.y,
              b.kind === 'frost' ? 6 : 3,
              b.kind === 'frost' ? '#9de8ef' : C.TOWERS[b.kind].accent);
        G.bullets.splice(i, 1);
      } else {
        b.x += Math.cos(a) * step;
        b.y += Math.sin(a) * step;
        b.a = a;
      }
    }

    // 特效
    for (let i = G.effects.length - 1; i >= 0; i--) {
      const f = G.effects[i];
      f.life -= dt;
      if (f.life <= 0) { G.effects.splice(i, 1); continue; }
      if (f.kind === 'p') {
        f.x += f.vx * dt; f.y += f.vy * dt;
        f.vx *= 0.93; f.vy *= 0.93;
      }
    }
    for (let i = G.floaters.length - 1; i >= 0; i--) {
      const f = G.floaters[i];
      f.life -= dt;
      f.y -= 26 * dt;
      if (f.vx) { f.x += f.vx * dt; f.vx *= 0.94; }   // 横向漂移并衰减
      if (f.life <= 0) G.floaters.splice(i, 1);
    }

    // 屏幕震动衰减
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 26);

    // 波次结束判定
    if (G.state === 'running' && G.spawnIdx >= G.spawnQueue.length && G.enemies.length === 0) {
      finishWave();
    }
  }

  function explode(x, y, radius, dmg) {
    audio.play('explosion');
    ring(x, y, radius * TILE, '#ffb457');
    burst(x, y, 18, '#ff9a3c');
    G.shake = Math.min(10, G.shake + 3.5);
    const r2 = (radius * TILE) ** 2;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d2 = dist2(x, y, e.x, e.y);
      if (d2 > r2) continue;
      const falloff = 1 - 0.45 * Math.sqrt(d2) / (radius * TILE);
      damage(e, dmg * falloff, { big: true });
    }
  }

  function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  /* ---------------- 渲染 ---------------- */
  // 预渲染静态地形到离屏 canvas，每帧只 drawImage 一次，性能友好
  const terrain = document.createElement('canvas');
  terrain.width = W; terrain.height = H;
  (function drawTerrain() {
    const g = terrain.getContext('2d');
    // 草地底色
    g.fillStyle = '#6ba04f';
    g.fillRect(0, 0, W, H);

    // 草地纹理（确定性随机，保证每次一致）
    let seed = 20240607;
    const rnd2 = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 460; i++) {
      const x = rnd2() * W, y = rnd2() * H, s = rnd2() * 3 + 1;
      g.fillStyle = rnd2() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
      g.fillRect(x, y, s, s);
    }

    // 道路
    const roadW = TILE * 0.72;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // 阴影
    g.strokeStyle = 'rgba(0,0,0,0.16)';
    g.lineWidth = roadW + 5;
    g.beginPath();
    g.moveTo(path.pts[0].x, path.pts[0].y + 3);
    for (let i = 1; i < path.pts.length; i++) g.lineTo(path.pts[i].x, path.pts[i].y + 3);
    g.stroke();
    // 主体
    g.strokeStyle = '#c8a97a';
    g.lineWidth = roadW;
    g.beginPath();
    g.moveTo(path.pts[0].x, path.pts[0].y);
    for (let i = 1; i < path.pts.length; i++) g.lineTo(path.pts[i].x, path.pts[i].y);
    g.stroke();
    // 中间高光
    g.strokeStyle = '#dcbf93';
    g.lineWidth = roadW * 0.55;
    g.beginPath();
    g.moveTo(path.pts[0].x, path.pts[0].y);
    for (let i = 1; i < path.pts.length; i++) g.lineTo(path.pts[i].x, path.pts[i].y);
    g.stroke();

    // 起点 / 终点标记（画在画面边缘内侧，避免完全跑到画布外看不见）
    const s0 = path.pts[0], s1 = path.pts[path.pts.length - 1];
    const inX0 = clamp(s0.x, 26, W - 26), inX1 = clamp(s1.x, 26, W - 26);
    [[inX0, s0.y, '#3ba55d'], [inX1, s1.y, '#d94a4a']].forEach(([px, py, col]) => {
      // 底座外环
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.beginPath(); g.arc(px, py, TILE * 0.36, 0, Math.PI * 2); g.fill();
      g.fillStyle = col;
      g.beginPath(); g.arc(px, py, TILE * 0.3, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.beginPath(); g.arc(px, py, TILE * 0.16, 0, Math.PI * 2); g.fill();
    });
    // 起点/终点文字标注
    g.font = 'bold 12px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 3;
    [['出', inX0, s0.y - 26], ['入', inX1, s1.y - 26]].forEach(([t, tx, ty]) => {
      g.strokeText(t, tx, ty);
      g.fillText(t, tx, ty);
    });
  })();

  function render() {
    const sh = G.shake;
    ctx.save();
    if (sh > 0.2) ctx.translate(rnd(-sh, sh) * 0.5, rnd(-sh, sh) * 0.5);

    ctx.drawImage(terrain, 0, 0);

    // 建造预览
    if (G.buildType && G.hoverCell) drawBuildGhost();
    else if (G.showRange && G.peekType) {
      const lv = C.TOWERS[G.peekType].levels[0];
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, lv.range * TILE, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 选中塔的射程
    if (G.selected) {
      const lv = C.TOWERS[G.selected.kind].levels[G.selected.level];
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(G.selected.x, G.selected.y, lv.range * TILE, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // 塔（按 y 排序做深度）
    const sorted = G.towers.slice().sort((a, b) => a.y - b.y);
    for (const t of sorted) drawTower(t);

    // 敌人
    for (const e of G.enemies) drawEnemy(e);

    // 子弹
    for (const b of G.bullets) drawBullet(b);

    // 特效
    for (const f of G.effects) {
      const k = 1 - f.life / f.max;
      ctx.save();
      if (f.kind === 'p') {
        ctx.globalAlpha = Math.max(0, 1 - k);
        ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 - k * 0.5), 0, Math.PI * 2); ctx.fill();
      } else if (f.kind === 'r') {
        ctx.globalAlpha = Math.max(0, 1 - k);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r0 + (f.r1 - f.r0) * k, 0, Math.PI * 2); ctx.stroke();
      } else if (f.kind === 'z') {
        ctx.globalAlpha = Math.max(0, 1 - k);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2.4;
        ctx.shadowColor = f.color; ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(f.x1, f.y1);
        // 折线闪电
        const segs = 4;
        for (let i = 1; i < segs; i++) {
          const t = i / segs;
          const nx = f.x1 + (f.x2 - f.x1) * t + rnd(-7, 7);
          const ny = f.y1 + (f.y2 - f.y1) * t + rnd(-7, 7);
          ctx.lineTo(nx, ny);
        }
        ctx.lineTo(f.x2, f.y2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 飘字
    for (const f of G.floaters) {
      ctx.save();
      ctx.globalAlpha = clamp(f.life * 1.6, 0, 1);
      ctx.font = (f.small ? 'bold 13px' : 'bold 19px') + ' system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }

    ctx.restore();
  }

  function drawBuildGhost() {
    const { c, r } = G.hoverCell;
    const x = c * TILE + TILE / 2, y = r * TILE + TILE / 2;
    const def = C.TOWERS[G.buildType];
    const ok = cellFree(c, r);
    const lv = def.levels[0];

    ctx.save();
    ctx.globalAlpha = 0.85;
    // 射程圈
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.strokeStyle = ok ? 'rgba(120,255,170,0.75)' : 'rgba(255,90,90,0.8)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, lv.range * TILE, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
    // 格高亮
    ctx.fillStyle = ok ? 'rgba(120,255,170,0.22)' : 'rgba(255,90,90,0.25)';
    ctx.fillRect(c * TILE + 2, r * TILE + 2, TILE - 4, TILE - 4);
    // 半透明塔身
    const fake = { kind: G.buildType, level: 0, x, y, angle: -Math.PI / 2, recoil: 0, flash: 0, cd: 0 };
    ctx.globalAlpha = ok ? 0.7 : 0.4;
    drawTower(fake);
    ctx.restore();
  }

  function drawTower(t) {
    const def = C.TOWERS[t.kind];
    const lv = def.levels[t.level];
    const x = t.x, y = t.y;
    const kx = t.c != null ? t.c : Math.round((x - TILE / 2) / TILE);
    const ky = t.r != null ? t.r : Math.round((y - TILE / 2) / TILE);
    const bx = t.c != null ? x : kx * TILE + TILE / 2;
    const by = t.r != null ? y : ky * TILE + TILE / 2;

    ctx.save();
    // 底座
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(bx, by + 10, 15, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5c6570';
    roundRect(bx - 14, by - 12, 28, 26, 6); ctx.fill();
    ctx.fillStyle = '#737d8a';
    roundRect(bx - 12, by - 14, 24, 22, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    roundRect(bx - 12, by - 14, 24, 22, 6); ctx.stroke();

    // 等级星标
    if (t.level > 0) {
      ctx.fillStyle = '#ffd76a';
      for (let i = 0; i <= t.level; i++) {
        ctx.beginPath(); ctx.arc(bx - 8 + i * 8, by - 18, 2.6, 0, Math.PI * 2); ctx.fill();
      }
    }

    // 炮塔主体（绕 x,y 旋转）——用独立 save/restore 隔离变换
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t.angle);
    ctx.translate(-t.recoil * 4, 0);
    if (t.kind === 'arrow') {
      ctx.fillStyle = def.color;
      roundRect(-6, -4, 20, 8, 3); ctx.fill();
      ctx.fillStyle = def.accent;
      roundRect(-8, -2, 12, 4, 2); ctx.fill();
      ctx.beginPath(); ctx.arc(2, 0, 4.5, 0, Math.PI * 2); ctx.fill();
    } else if (t.kind === 'cannon') {
      ctx.fillStyle = def.color;
      roundRect(-7, -5.5, 24, 11, 4); ctx.fill();
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = def.accent;
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
    } else if (t.kind === 'frost') {
      ctx.fillStyle = def.color;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const rad = i % 2 === 0 ? 9 : 4.5;
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rad, Math.sin(a) * rad);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = def.accent;
      ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = def.color;
      roundRect(-5, -5, 20, 10, 4); ctx.fill();
      ctx.fillStyle = def.accent;
      ctx.beginPath(); ctx.arc(14, 0, 3.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // 开火闪光（在世界坐标系下画）
    if (t.flash > 0) {
      ctx.save();
      ctx.globalAlpha = t.flash / 0.1;
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.arc(x + Math.cos(t.angle) * 18, y + Math.sin(t.angle) * 18, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawEnemy(e) {
    const x = e.x, y = e.y;
    let col = e.def.color;
    if (e.hitFlash > 0) col = '#ffffff';
    else if (e.slowT > 0) col = mixColor(e.def.color, '#7fd8ff', 0.45);

    ctx.save();
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.beginPath(); ctx.ellipse(x, y + e.r * 0.72, e.r * 0.9, e.r * 0.36, 0, 0, Math.PI * 2); ctx.fill();

    if (e.type === 'boss') {
      const pulse = 1 + Math.sin(G.time * 5) * 0.07;
      ctx.shadowColor = '#ff2d55';
      ctx.shadowBlur = 16;
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + G.time * 0.6;
        const rad = e.r * pulse;
        ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rad, y + Math.sin(a) * rad);
      }
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, e.r * 0.35, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(x, y, e.r * 0.16, 0, Math.PI * 2); ctx.fill();
    } else if (e.def.shape === 'square') {
      const w = e.r * 1.6;
      ctx.fillStyle = col;
      roundRect(x - w / 2, y - w / 2, w, w, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      roundRect(x - w / 2 + 2, y - w / 2 + 2, w - 4, w * 0.34, 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.6;
      roundRect(x - w / 2, y - w / 2, w, w, 3); ctx.stroke();
    } else if (e.def.shape === 'tri') {
      const s = e.r * 1.35;
      // 复用一次 posAt，避免重复计算
      const p = posAt(e.d);
      const a = Math.atan2(p.uy, p.ux);
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(-s * 0.8, -s * 0.85); ctx.lineTo(-s * 0.8, s * 0.85); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.rotate(-a);
      ctx.translate(-x, -y);
    } else {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, e.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.arc(x - e.r * 0.3, y - e.r * 0.3, e.r * 0.36, 0, Math.PI * 2); ctx.fill();
    }

    // 减速霜冻环
    if (e.slowT > 0) {
      ctx.strokeStyle = 'rgba(140,225,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, e.r + 4, 0, Math.PI * 2); ctx.stroke();
    }

    // 血条
    if (e.hp < e.maxHp) {
      const bw = Math.max(20, e.r * 2.3), bh = 4;
      const bx = x - bw / 2, by = y - e.r - (e.type === 'boss' ? 14 : 8);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      const ratio = clamp(e.hp / e.maxHp, 0, 1);
      ctx.fillStyle = ratio > 0.55 ? '#4ade80' : ratio > 0.25 ? '#fbbf24' : '#ef4444';
      ctx.fillRect(bx, by, bw * ratio, bh);
    }
    ctx.restore();
  }

  function drawBullet(b) {
    ctx.save();
    if (b.kind === 'cannon') {
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffb457';
      ctx.beginPath(); ctx.arc(b.x, b.y, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#ffd9a0';
      ctx.beginPath(); ctx.arc(b.x, b.y, 8, 0, Math.PI * 2); ctx.fill();
    } else if (b.kind === 'frost') {
      ctx.fillStyle = '#9de8ef';
      ctx.shadowColor = '#7fe0f0'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(b.x, b.y, 3.6, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#e8f0ff';
      ctx.save();
      ctx.translate(b.x, b.y); ctx.rotate(b.a || 0);
      roundRect(-7, -1.6, 12, 3.2, 1.6); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function mixColor(a, b, t) {
    const pa = hex(a), pb = hex(b);
    const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
    const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
    const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }
  function hex(h) {
    const s = h.replace('#', '');
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  /* ---------------- 主循环 ---------------- */
  const STEP = 1 / 60;
  let acc = 0, last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;   // 切标签页回来不要一次性跳太多
    if (!G.paused) {
      acc += dt * G.speed;
      let guard = 0;
      while (acc >= STEP && guard < 12) { update(STEP); acc -= STEP; guard++; }
      if (acc > STEP) acc = 0;
    }
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ---------------- 输入 ---------------- */
  function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    const y = (e.clientY - rect.top) * (H / rect.height);
    const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return { c, r };
  }

  canvas.addEventListener('mousemove', (e) => { G.hoverCell = cellFromEvent(e); });
  canvas.addEventListener('mouseleave', () => { G.hoverCell = null; });

  canvas.addEventListener('click', (e) => {
    audio.unlock();
    if (G.state === 'over' || G.state === 'win') return;
    const cell = cellFromEvent(e);
    if (!cell) return;
    const existing = grid[cell.r * COLS + cell.c];

    if (G.buildType) {
      if (placeTower(cell.c, cell.r)) renderPanel();
      return;
    }
    if (existing) {
      G.selected = (G.selected === existing) ? null : existing;
      audio.play('hit');
    } else {
      G.selected = null;
    }
    renderPanel();
  });

  // 右键快速取消建造 / 取消选中
  function clearSelection() {
    G.buildType = null; G.selected = null;
    syncShopState(); renderPanel();
  }
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clearSelection();
  });
  // 兜底：部分环境不派发 contextmenu，用右键按下也能取消
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) clearSelection();
  });

  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const map = { '1': 'arrow', '2': 'cannon', '3': 'frost', '4': 'tesla' };
    if (map[k]) { selectBuild(map[k]); e.preventDefault(); return; }
    if (k === 'escape') { G.buildType = null; G.selected = null; syncShopState(); renderPanel(); return; }
    if (k === ' ') {
      e.preventDefault();
      if (G.state === 'prep' && !G.paused) startWave();
      return;
    }
    if (k === 'p') { togglePause(); return; }
    if (k === 'f') { G.speed = G.speed === 1 ? 2 : (G.speed === 2 ? 3 : 1); syncHud(); return; }
    if (k === 't') { G.targetMode = G.targetMode === 'first' ? 'last' : (G.targetMode === 'last' ? 'close' : 'first'); toast('目标优先：' + ({ first: '最前', last: '最后', close: '最近' })[G.targetMode]); return; }
  });

  function togglePause() {
    if (G.state === 'over' || G.state === 'win') return;
    G.paused = !G.paused;
    audio.play(G.paused ? 'hit' : 'build');
    syncHud();
  }

  els.waveBtn.addEventListener('click', () => { audio.unlock(); startWave(); });
  els.speedBtn.addEventListener('click', () => {
    G.speed = G.speed === 1 ? 2 : (G.speed === 2 ? 3 : 1);
    audio.play('hit'); syncHud();
  });
  els.pauseBtn.addEventListener('click', togglePause);
  els.muteBtn.addEventListener('click', () => {
    const m = audio.toggleMute();
    els.muteBtn.textContent = m ? '🔇 静音' : '🔊 音效';
    els.muteBtn.classList.toggle('active', m);
  });
  els.restartBtn.addEventListener('click', () => {
    if (G.state === 'running' || G.state === 'prep') {
      if (!confirm('确定要重新开始吗？当前进度将丢失。')) return;
    }
    els.overlay.className = 'overlay';
    audio.play('sell');
    reset();
  });

  // 目标模式切换按钮
  const tgtBtn = $('#btn-target');
  if (tgtBtn) {
    tgtBtn.addEventListener('click', () => {
      G.targetMode = G.targetMode === 'first' ? 'last' : (G.targetMode === 'last' ? 'close' : 'first');
      tgtBtn.textContent = '🎯 ' + ({ first: '最前', last: '最后', close: '最近' })[G.targetMode];
      audio.play('hit');
    });
  }
  // 伤害数字开关
  G.showDmg = true;
  const dmgChk = $('#chk-dmg');
  if (dmgChk) {
    dmgChk.addEventListener('change', () => { G.showDmg = dmgChk.checked; });
  }

  /* ---------------- 启动 ---------------- */
  reset();
  els.overlay.className = 'overlay';
  // 首屏自动开始准备倒计时
  window.__TD = { G, C, grid, path, audio, placeTower, startWave, update, clearSelection, renderPanel };
})();
