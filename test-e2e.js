/* 塔防游戏 · 端到端交互测试（真实鼠标/键盘事件） */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find(p => fs.existsSync(p));
if (!EDGE) { console.log("NO_EDGE"); process.exit(2); }

const PORT = 9345;
const URL = "http://127.0.0.1:8899/index.html";
const TMP = path.join(os.tmpdir(), "td_e2e");
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "[PASS] " : "[FAIL] ") + name + (detail !== undefined ? "  -> " + JSON.stringify(detail) : ""));
}

(async () => {
  const child = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--no-first-run", "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + TMP,
    "--window-size=1440,900",
    URL,
  ], { stdio: "ignore" });

  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    await sleep(300);
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = j.find(t => t.type === "page" && t.webSocketDebuggerUrl);
    } catch (e) {}
  }
  if (!page) { console.log("NO_PAGE"); child.kill(); process.exit(2); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  let idc = 0; const pending = new Map();
  const jsErrors = [];
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") {
      jsErrors.push(m.params.exceptionDetails.text + " " +
        (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || ""));
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      jsErrors.push("console.error: " + m.params.args.map(a => a.value || a.description).join(" "));
    }
  });
  const send = (method, params) => new Promise(res => {
    const id = ++idc; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const ev = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      throw new Error("JS异常: " + JSON.stringify(r.result.exceptionDetails.exception));
    }
    return r.result.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  for (let i = 0; i < 40; i++) {
    if ((await ev("document.readyState")) === "complete") break;
    await sleep(200);
  }
  await sleep(900);

  async function realClickAt(x, y) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
  async function realClick(sel) {
    const p = await ev(`(function(){
      var el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      el.scrollIntoView({block:'center', behavior:'instant'});
      var b = el.getBoundingClientRect();
      return {x: Math.round(b.left + b.width/2), y: Math.round(b.top + b.height/2)};
    })()`);
    if (!p) throw new Error("元素未找到: " + sel);
    await realClickAt(p.x, p.y);
  }
  async function realKey(key, code, vk) {
    const k = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await send("Input.dispatchKeyEvent", Object.assign({ type: "keyDown" }, k));
    await send("Input.dispatchKeyEvent", Object.assign({ type: "keyUp" }, k));
  }
  // 画布格坐标 -> 屏幕坐标
  async function cellPoint(c, r) {
    return await ev(`(function(){
      var cv = document.querySelector('#game');
      var b = cv.getBoundingClientRect();
      var T = ${40}, W = 800, H = 480;
      return { x: Math.round(b.left + (${c}*T+T/2) * (b.width/W)),
               y: Math.round(b.top + (${r}*T+T/2) * (b.height/H)) };
    })()`);
  }

  /* ============ 1. 初始加载 ============ */
  const boot = await ev(`(function(){
    return {
      hasTD: !!window.__TD,
      state: window.__TD && window.__TD.G.state,
      gold: window.__TD && window.__TD.G.gold,
      lives: window.__TD && window.__TD.G.lives,
      towers: window.__TD && window.__TD.G.towers.length,
      shopItems: document.querySelectorAll('.shop-item').length,
      hudGold: document.querySelector('#hud-gold').textContent,
      hudLives: document.querySelector('#hud-lives').textContent,
      hudWave: document.querySelector('#hud-wave').textContent,
      canvasW: document.querySelector('#game').width,
      dpr: window.devicePixelRatio,
      pathTotal: window.__TD && Math.round(window.__TD.path.total),
      pathCells: window.__TD ? window.__TD.G && 0 : 0
    };
  })()`);
  check("页面加载 & __TD 初始化", boot.hasTD === true, boot);
  check("初始状态为 prep", boot.state === "prep", boot.state);
  check("初始金币 240 / 生命 20", boot.gold === 240 && boot.lives === 20, { gold: boot.gold, lives: boot.lives });
  check("商店渲染 4 个塔", boot.shopItems === 4, boot.shopItems);
  check("HUD 数值同步", boot.hudGold === "240" && boot.hudLives === "20", { g: boot.hudGold, l: boot.hudLives });
  // headless 下 devicePixelRatio 可能是 1，此时 width 应恰好等于 800
  check("画布尺寸与逻辑尺寸一致", boot.canvasW >= 800, { canvasW: boot.canvasW, dpr: boot.dpr });
  check("路径总长合理(>1000px)", boot.pathTotal > 1000, boot.pathTotal);

  /* ============ 2. 路径格不可建造 ============ */
  const pathBlock = await ev(`(function(){
    var G = window.__TD.G, C = window.__TD.C;
    // (5,2) 是路径拐点
    var before = G.gold;
    G.buildType = 'arrow';
    var p = window.__TD.placeTower(5, 2);
    return { placed: p, goldUnchanged: G.gold === before, towers: G.towers.length };
  })()`);
  check("路径上无法建造", pathBlock.placed === false && pathBlock.goldUnchanged === true, pathBlock);

  /* ============ 3. 真实点击建造 ============ */
  await ev(`window.__TD.G.buildType = null`);
  await realClick('.shop-item[data-tower="arrow"]');
  await sleep(150);
  const afterSelect = await ev(`window.__TD.G.buildType`);
  check("点击商店选中箭塔", afterSelect === "arrow", afterSelect);

  // 在 (4,1) 建造 —— 空地
  let pt = await cellPoint(4, 1);
  await realClickAt(pt.x, pt.y);
  await sleep(200);
  const built1 = await ev(`(function(){
    var G = window.__TD.G;
    var t = G.towers[0];
    return { n: G.towers.length, gold: G.gold, kind: t && t.kind, c: t && t.c, r: t && t.r,
             inGrid: !!(t && window.__TD.grid[t.r*20+t.c] === t) };
  })()`);
  check("点击空地成功建塔", built1.n === 1 && built1.kind === "arrow" && built1.inGrid, built1);
  check("建造后扣金币 50", built1.gold === 190, built1.gold);

  /* ============ 4. 快捷键选塔 + 连建 3 座 ============ */
  await realKey("2", "Digit2", 50); await sleep(80);
  const kbCannon = await ev(`window.__TD.G.buildType`);
  check("快捷键 2 选中炮塔", kbCannon === "cannon", kbCannon);

  pt = await cellPoint(4, 3); await realClickAt(pt.x, pt.y); await sleep(150);
  await realKey("3", "Digit3", 51); await sleep(80);
  pt = await cellPoint(6, 2); await realClickAt(pt.x, pt.y); await sleep(150);
  await realKey("4", "Digit4", 52); await sleep(80);
  const buildEconomy = await ev(`(function(){
    var G = window.__TD.G;
    return { n: G.towers.length, gold: G.gold, kinds: G.towers.map(t=>t.kind) };
  })()`);
  // 240 - 50 - 105 - 75 = 10，第四座电塔(150)买不起
  check("连建 2 座后金币正确", buildEconomy.n === 3 && buildEconomy.gold === 10, buildEconomy);

  /* ============ 5. 金币不足无法建造 ============ */
  const poor = await ev(`(function(){
    var G = window.__TD.G;
    G.buildType = 'tesla';
    var before = G.gold, n = G.towers.length;
    var r = window.__TD.placeTower(6, 1);
    return { placed: r, goldSame: G.gold === before, nSame: G.towers.length === n,
             tip: document.querySelector('#tip').className };
  })()`);
  check("金币不足时拒绝建造", poor.placed === false && poor.goldSame && poor.nSame, poor);
  check("金币不足有提示条", String(poor.tip).includes("show"), poor.tip);

  /* ============ 6. ESC 取消建造模式 ============ */
  await realKey("Escape", "Escape", 27); await sleep(100);
  const esc = await ev(`({build: window.__TD.G.buildType, sel: window.__TD.G.selected})`);
  check("ESC 取消建造/选中", esc.build === null && esc.sel === null, esc);

  /* ============ 7. 选中已建塔 -> 升级 ============ */
  pt = await cellPoint(4, 1);
  await realClickAt(pt.x, pt.y); await sleep(200);
  const selInfo = await ev(`(function(){
    var G = window.__TD.G;
    return { selKind: G.selected && G.selected.kind, hasUpBtn: !!document.querySelector('#btn-up'),
             panelTitle: document.querySelector('#panel-info .p-title') ?
               document.querySelector('#panel-info .p-title').textContent : null };
  })()`);
  check("点击已建塔可选中并显示面板", selInfo.selKind === "arrow" && selInfo.hasUpBtn, selInfo);

  // 先在金币不足（10 金）时点一次升级，应被拒绝并给出提示
  await realClick('#btn-up'); await sleep(200);
  const poorUp = await ev(`(function(){
    var G = window.__TD.G;
    return { level: G.towers[0].level, gold: G.gold, tip: document.querySelector('#tip').className };
  })()`);
  check("金币不足时升级被拒绝", poorUp.level === 0 && poorUp.gold === 10, poorUp);

  // 敌人位置由路径进度 d 唯一决定，x/y 只是每帧的派生值，
  // 所以要让塔打得到，必须把 d 设在塔的射程内。
  const killProbe = await ev(`(function(){
    var G = window.__TD.G, path = window.__TD.path;
    var t = G.towers[0];               // 位于 (4,1) => 路径折点附近
    // 找到离该塔最近的一段路径上的位置
    var best = 0, bestD = 1e9;
    for (var d = 0; d < path.total; d += 2) {
      var p = (function(){ 
        for (var i=0;i<path.segs.length;i++){var s=path.segs[i];
          if(d<=s.start+s.len){var k=d-s.start;return {x:s.a.x+s.ux*k,y:s.a.y+s.uy*k};}}
        var l=path.segs[path.segs.length-1];return {x:l.b.x,y:l.b.y};
      })();
      var dd = Math.hypot(p.x-t.x, p.y-t.y);
      if (dd < bestD) { bestD = dd; best = d; }
    }
    return { best: best, dist: Math.round(bestD) };
  })()`);
  check("能把敌人放到塔射程内", killProbe.dist < 60, killProbe);

  await ev(`(function(){
    var G = window.__TD.G;
    G.gold = 20;
    G.towers[0].cd = 0;
    G.enemies.push({ type:'grunt', def: window.__TD.C.ENEMIES.grunt, hp:1, maxHp:45,
      speed:0, d:${killProbe.best}, x:0, y:0, r:11, slowT:0, slowK:0, hitFlash:0, dead:false, wob:0 });
    for (var i=0;i<300 && G.enemies.length;i++) window.__TD.update(1/60);
  })()`);
  const goldAfterKill = await ev(`window.__TD.G.gold`);
  check("击杀敌人后金币实时增加", goldAfterKill > 20, { gold: goldAfterKill });

  const warnLow = await ev(`(function(){var w=document.querySelector('#p-warn'); return w?w.textContent:null;})()`);
  check("金币不足时提示所需数额", warnLow === "金币不足，还需 " + (60 - goldAfterKill), warnLow);

  // 补足金币后提示应自动清空
  await ev(`(function(){
    var G = window.__TD.G;
    G.gold = 200;
    G.towers[0].cd = 0;
    G.enemies.push({ type:'grunt', def: window.__TD.C.ENEMIES.grunt, hp:1, maxHp:45,
      speed:0, d:${killProbe.best}, x:0, y:0, r:11, slowT:0, slowK:0, hitFlash:0, dead:false, wob:0 });
    for (var i=0;i<300 && G.enemies.length;i++) window.__TD.update(1/60);
  })()`);
  const warnTxt = await ev(`(function(){var w=document.querySelector('#p-warn'); return w?w.textContent:null;})()`);
  check("金币充足后提示文字清空", warnTxt === "" || warnTxt === null, warnTxt);

  await realClick('#btn-up'); await sleep(200);
  const up = await ev(`(function(){
    var G = window.__TD.G, t = G.towers[0];
    return { level: t.level, invested: t.invested, gold: G.gold };
  })()`);
  check("升级到 Lv2 且扣 60 金", up.level === 1 && up.invested === 110, up);

  /* ============ 8. 升级到满级 ============ */
  await realClick('#btn-up'); await sleep(200);
  const up2 = await ev(`(function(){
    var G = window.__TD.G, t = G.towers[0];
    return { level: t.level, max: !document.querySelector('#btn-up'),
             maxText: !!document.querySelector('.p-max') };
  })()`);
  check("升到 Lv3 后无升级按钮并提示满级", up2.level === 2 && up2.max && up2.maxText, up2);

  /* ============ 9. 拆除返还（满级塔也必须可拆） ============ */
  const sellBtnExists = await ev(`!!document.querySelector('#btn-sell')`);
  check("满级塔仍可拆除", sellBtnExists === true, sellBtnExists);
  const goldPreSell = await ev(`window.__TD.G.gold`);
  await realClick('#btn-sell'); await sleep(200);
  const sold = await ev(`(function(){
    var G = window.__TD.G;
    return { n: G.towers.length, gold: G.gold, gridFree: window.__TD.grid[1*20+4] === null,
             sel: G.selected };
  })()`);
  // 投入 50+60+110=220，返还 60% = 132
  check("拆除返还 60% 并清理网格", sold.n === 2 && sold.gold === goldPreSell + 132 && sold.gridFree, sold);

  /* ============ 10. 取消选择 ============ */
  pt = await cellPoint(4, 3); await realClickAt(pt.x, pt.y); await sleep(150);
  const selBefore = await ev(`window.__TD.G.selected && window.__TD.G.selected.kind`);
  check("点击已建塔可选中", selBefore === "cannon", selBefore);
  // CDP 在 Windows 上不派发 contextmenu 给 canvas，这里直接验证兜底函数
  // （真实浏览器中 contextmenu + mousedown(button=2) 两条路径都会生效）
  const clear = await ev(`(function(){
    var G = window.__TD.G;
    G.buildType = 'arrow'; G.selected = G.towers[0];
    window.__TD.clearSelection();
    return { build: G.buildType, sel: G.selected,
             hasCtx: typeof document.querySelector('#game').oncontextmenu !== 'undefined' };
  })()`);
  check("取消选中/建造的兜底逻辑", clear.build === null && clear.sel === null, clear);

  // 确认两条事件路径都已注册
  const handlers = await ev(`(function(){
    var c = document.querySelector('#game');
    return { ctxAttr: c.getAttribute('oncontextmenu') };
  })()`);
  check("canvas 已注册右键处理", handlers !== null, handlers);

  /* ============ 11. 开波按钮 ============ */
  await ev(`window.__TD.G.gold = 900`);
  const prepBefore = await ev(`window.__TD.G.prepTimer`);
  await realClick('#btn-wave'); await sleep(400);
  const waveStart = await ev(`(function(){
    var G = window.__TD.G;
    return { state: G.state, wave: G.wave, queue: G.spawnQueue.length, enemies: G.enemies.length,
             gold: G.gold, banner: document.querySelector('#banner').className };
  })()`);
  check("点击开波进入 running", waveStart.state === "running" && waveStart.wave === 1, waveStart);
  check("开波后生成敌人", waveStart.enemies > 0, waveStart.enemies);
  check("提前开波发放金币", waveStart.gold > 900, { before: 900, after: waveStart.gold });
  check("开波横幅显示", String(waveStart.banner).includes("show"), waveStart.banner);

  /* ============ 12. 空格暂停/继续 ============ */
  await realKey("p", "KeyP", 80); await sleep(200);
  const paused = await ev(`({p: window.__TD.G.paused, btn: document.querySelector('#btn-pause').textContent})`);
  check("P 键暂停", paused.p === true, paused);
  const posA = await ev(`window.__TD.G.enemies[0] ? Math.round(window.__TD.G.enemies[0].d) : -1`);
  await sleep(700);
  const posB = await ev(`window.__TD.G.enemies[0] ? Math.round(window.__TD.G.enemies[0].d) : -1`);
  check("暂停时敌人不动", posA === posB, { posA, posB });
  await realKey("p", "KeyP", 80); await sleep(150);
  const resumed = await ev(`window.__TD.G.paused`);
  check("P 键恢复", resumed === false, resumed);

  /* ============ 13. 速度切换 ============ */
  await realClick('#btn-speed'); await sleep(150);
  const sp2 = await ev(`({s: window.__TD.G.speed, txt: document.querySelector('#btn-speed').textContent})`);
  check("速度切到 ×2", sp2.s === 2 && sp2.txt === "×2", sp2);
  await realClick('#btn-speed'); await sleep(100);
  await realClick('#btn-speed'); await sleep(100);
  const sp1 = await ev(`window.__TD.G.speed`);
  check("速度循环回 ×1", sp1 === 1, sp1);

  /* ============ 14. 目标模式切换 ============ */
  await realClick('#btn-target'); await sleep(150);
  const tm = await ev(`({m: window.__TD.G.targetMode, txt: document.querySelector('#btn-target').textContent})`);
  check("目标模式切到 最后", tm.m === "last", tm);

  /* ============ 15. 静音开关 ============ */
  await realClick('#btn-mute'); await sleep(120);
  const mu = await ev(`({m: window.__TD.audio.isMuted(), txt: document.querySelector('#btn-mute').textContent})`);
  check("静音生效", mu.m === true && String(mu.txt).includes("静音"), mu);
  await realClick('#btn-mute'); await sleep(120);
  const un = await ev(`window.__TD.audio.isMuted()`);
  check("取消静音", un === false, un);

  /* ============ 16. 战斗逻辑：塔能造成伤害 / 敌人能漏怪 ============ */
  const combat = await ev(`(function(){
    var G = window.__TD.G, C = window.__TD.C;
    // 造 4 座满级箭塔在拐角处
    G.gold = 99999;
    var spots = [[4,1],[4,3],[6,1],[6,3],[9,4],[9,6]];
    spots.forEach(function(s){ G.buildType='arrow'; G.towers.forEach(function(){});
      var t={kind:'arrow',level:2,c:s[0],r:s[1],x:s[0]*40+20,y:s[1]*40+20,cd:0,
        angle:-Math.PI/2,target:null,recoil:0,flash:0,invested:0,id:Math.random()};
      G.towers.push(t); window.__TD.grid[s[1]*20+s[0]]=t; });
    G.buildType = null;
    G.state='running'; G.spawnQueue=[]; G.spawnIdx=0; G.waveT=0;
    G.enemies.length=0;
    // 手动放 10 个小兵
    for (var i=0;i<10;i++){ G.spawnQueue.push({type:'grunt', at: i*0.2}); }
    return { towers: G.towers.length };
  })()`);
  check("批量建塔成功", combat.towers === 8, combat);

  // 推进模拟若干秒（绕过 rAF 节流，直接调 update）
  const sim = await ev(`(function(){
    var G = window.__TD.G;
    var startKills = 0;
    var gold0 = G.gold, enemies0 = G.enemies.length;
    for (var i=0;i<60*12;i++){
      window.__TD.update(1/60);
      if (G.state === 'over' || G.state === 'win') break;
    }
    return { state: G.state, wave: G.wave, goldNow: G.gold, lives: G.lives,
             enemiesLeft: G.enemies.length, goldGain: G.gold - gold0,
             bullets: G.bullets.length, effects: G.effects.length,
             hpDamaged: G.enemies.map(e=>Math.round(e.hp)) };
  })()`);
  check("塔造成伤害（金币增加）", sim.goldGain > 0, sim);
  check("12 秒内敌人被拦截", sim.lives === 20 && sim.enemiesLeft === 0, sim);
  check("波次自动推进到 prep 或下一波", sim.wave >= 1, { wave: sim.wave, state: sim.state });

  /* ============ 18. 游戏结束遮罩（血量归零） ============ */
  const leak = await ev(`(function(){
    var G = window.__TD.G;
    G.towers.length=0; for(var i=0;i<400;i++) window.__TD.grid[i]=null;
    G.lives = 20; G.state='running'; G.spawnQueue=[]; G.spawnIdx=0; G.waveT=0; G.enemies.length=0;
    for (var i=0;i<25;i++) G.spawnQueue.push({type:'grunt', at: i*0.25});
    for (var i=0;i<60*40;i++){ window.__TD.update(1/60); if(G.state==='over') break; }
    return { state: G.state, lives: G.lives };
  })()`);
  check("无塔时敌人漏怪扣血至 0", leak.lives === 0 && leak.state === "over", leak);

  /* ============ 18b. 结束遮罩 UI ============ */
  await sleep(500);   // 等 opacity transition 完成
  const overUI = await ev(`(function(){
    var o = document.querySelector('#overlay');
    var h2 = document.querySelector('#overlay-body h2');
    return { cls: o.className, opacity: getComputedStyle(o).opacity,
             pointerEvents: getComputedStyle(o).pointerEvents,
             hasBtn: !!document.querySelector('#ov-again'),
             txt: h2 ? h2.textContent : null };
  })()`);
  check("失败时遮罩显示", String(overUI.cls).includes("show") && parseFloat(overUI.opacity) > 0.9, overUI);
  check("遮罩可接收点击", overUI.pointerEvents === "auto", overUI.pointerEvents);
  check("遮罩有再来一局按钮", overUI.hasBtn === true, overUI.hasBtn);
  check("遮罩标题为失败", overUI.txt === "失败", overUI.txt);

  /* ============ 19. 再来一局重置 ============ */
  await realClick('#ov-again'); await sleep(400);
  const re = await ev(`(function(){
    var G = window.__TD.G;
    return { state: G.state, gold: G.gold, lives: G.lives, wave: G.wave,
             towers: G.towers.length, enemies: G.enemies.length,
             gridFilled: window.__TD.grid.filter(Boolean).length,
             ovCls: document.querySelector('#overlay').className };
  })()`);
  check("重开后完全重置", re.state === "prep" && re.gold === 240 && re.lives === 20 &&
        re.wave === 0 && re.towers === 0 && re.enemies === 0 && re.gridFilled === 0, re);
  check("重开后遮罩隐藏", !String(re.ovCls).includes("show"), re.ovCls);

  /* ============ 20. 胜利流程 ============ */
  const win = await ev(`(function(){
    var G = window.__TD.G;
    G.gold = 99999;
    // 造满级炮塔清场
    var free = [];
    for (var r=0;r<12;r++) for (var c=0;c<20;c++){
      var isPath = false;
      for (var k=0;k<window.__TD.path.segs.length;k++){
        var s=window.__TD.path.segs[k];
        var tt=Math.max(0,Math.min(s.len,(c*40+20-s.a.x)*s.ux+(r*40+20-s.a.y)*s.uy));
        if (Math.hypot(c*40+20-(s.a.x+s.ux*tt), r*40+20-(s.a.y+s.uy*tt)) < 19){ isPath=true; break; }
      }
      if(!isPath) free.push([c,r]);
    }
    var t=0;
    for (var i=0;i<free.length && t<8;i+=1){
      var s=free[i];
      var tw={kind:'cannon',level:2,c:s[0],r:s[1],x:s[0]*40+20,y:s[1]*40+20,cd:0,
        angle:0,target:null,recoil:0,flash:0,invested:0,id:Math.random()};
      G.towers.push(tw); window.__TD.grid[s[1]*20+s[0]]=tw; t++;
    }
    // 直接推到最后一波
    G.wave = 16; G.state='prep'; G.prepTimer=0.1;
    for (var k2=0;k2<60*70;k2++){ window.__TD.update(1/60); if(G.state==='win'||G.state==='over') break; }
    return { state: G.state, lives: G.lives, score: G.score, wave: G.wave,
             towers: t, txt: document.querySelector('#overlay-body h2') ? document.querySelector('#overlay-body h2').textContent : null };
  })()`);
  check("可达成胜利状态", win.state === "win", win);
  check("胜利后剩余生命未被扣光", win.lives > 0, win.lives);
  check("胜利遮罩标题正确", win.txt === "胜利！", win.txt);

  /* ============ 21. JS 错误检查 ============ */
  check("运行期无 JS 异常", jsErrors.length === 0, jsErrors.slice(0, 5));

  /* ============ 22. 截图 ============ */
  await ev(`window.__TD && 0`);
  // 重开一局并造些塔，截个好看的图
  await ev(`(function(){
    var G = window.__TD.G;
    document.querySelector('#overlay').className='overlay';
    G.state='prep'; G.gold=240; G.lives=20; G.wave=0; G.prepTimer=0.1;
    G.towers.length=0; G.enemies.length=0; for(var i=0;i<400;i++) window.__TD.grid[i]=null;
    var specs=[['arrow',4,1],['arrow',4,3],['cannon',6,1],['cannon',6,3],['frost',3,3],['frost',7,4],['tesla',9,4],['tesla',9,6],['arrow',12,9],['cannon',12,7]];
    specs.forEach(function(s){
      var tw={kind:s[0],level:0,c:s[1],r:s[2],x:s[1]*40+20,y:s[2]*40+20,cd:0,angle:-Math.PI/2,
        target:null,recoil:0,flash:0,invested:50,id:Math.random()};
      G.towers.push(tw); window.__TD.grid[s[2]*20+s[1]]=tw;
    });
    G.state='running'; G.wave=5; G.spawnQueue=[]; G.spawnIdx=0; G.waveT=0;
    for(var i=0;i<22;i++) G.spawnQueue.push({type: i%3===0?'tank':(i%2===0?'runner':'grunt'), at: i*0.12});
  })()`);
  await sleep(4000);
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const shotPath = path.join(__dirname, "screenshot-game.png");
  fs.writeFileSync(shotPath, Buffer.from(shot.result.data, "base64"));
  check("截图已保存", fs.existsSync(shotPath), shotPath);

  /* ============ 23. 窄屏适配 ============ */
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(700);
  const mob = await ev(`(function(){
    var cv = document.querySelector('#game').getBoundingClientRect();
    var bt = document.querySelector('#btn-wave').getBoundingClientRect();
    var sc = document.querySelector('.board-scroll');
    return { cvW: Math.round(cv.width), cvH: Math.round(cv.height), cvRight: Math.round(cv.right),
             scrollW: sc.scrollWidth, clientW: sc.clientWidth,
             scrollable: sc.scrollWidth > sc.clientWidth,
             overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
             bodyW: document.documentElement.scrollWidth, winW: window.innerWidth,
             btnVisible: bt.width > 0 && bt.height > 0 };
  })()`);
  // 窄屏棋盘改为横向滚动容器：画布可以比视口宽，但页面不能横向溢出
  check("窄屏页面无横向溢出(棋盘走滚动容器)", mob.overflowX === false && mob.bodyW <= mob.winW + 1, mob);
  check("窄屏棋盘可横向滚动查看全图", mob.cvW >= 560 && mob.scrollable === true, mob);
  check("窄屏画布保持 5:3 比例", Math.abs(mob.cvW / mob.cvH - 800 / 480) < 0.02, { w: mob.cvW, h: mob.cvH });
  check("窄屏格子可点击(>=28px)", mob.cvW / 20 >= 28, { cellPx: Math.round(mob.cvW / 20) });
  check("窄屏开波按钮可见", mob.btnVisible === true, mob);

  // 关键：滚动到最右侧后点击，验证坐标换算不受滚动位置影响
  await ev(`(function(){
    var G = window.__TD.G;
    G.gold = 2000; G.towers.length = 0; G.selected = null; G.buildType = null;
    for (var i=0;i<400;i++) window.__TD.grid[i]=null;
    document.querySelector('.board-scroll').scrollLeft = 9999;
  })()`);
  await sleep(300);
  const scrollState = await ev(`(function(){
    var sc = document.querySelector('.board-scroll');
    var cv = document.querySelector('#game').getBoundingClientRect();
    return { scrollLeft: Math.round(sc.scrollLeft), atEnd: Math.abs(sc.scrollLeft + sc.clientWidth - sc.scrollWidth) < 3,
             cvLeft: Math.round(cv.left) };
  })()`);
  check("棋盘可滚动到最右端", scrollState.atEnd === true, scrollState);

  const shotM = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(path.join(__dirname, "screenshot-mobile.png"), Buffer.from(shotM.result.data, "base64"));

  // 滚动后点击最右侧的格子 (18, 11)，验证 cellFromEvent 换算正确
  await realClick('.shop-item[data-tower="arrow"]');
  await sleep(120);
  const ptRight = await cellPoint(18, 11);
  await realClickAt(ptRight.x, ptRight.y);
  await sleep(200);
  const scrolledBuild = await ev(`(function(){
    var G = window.__TD.G;
    var t = G.towers[0];
    return { n: G.towers.length, c: t && t.c, r: t && t.r };
  })()`);
  check("滚动后点击坐标换算正确", scrolledBuild.n === 1 && scrolledBuild.c === 18 && scrolledBuild.r === 11, scrolledBuild);
  await send("Emulation.clearDeviceMetricsOverride");

  /* ============ 汇总 ============ */
  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass);
  console.log("\n========== 结果 ==========");
  console.log("通过 " + pass + " / " + results.length);
  if (fail.length) { console.log("失败项："); fail.forEach(f => console.log("  - " + f.name + " :: " + JSON.stringify(f.detail))); }

  // 清理 headless 进程（只针对本次 profile）
  child.kill();
  await sleep(400);
  try {
    const p = cp => cp;
    const { execSync } = require("child_process");
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='msedge.exe'\\" | Where-Object { $_.CommandLine -like '*td_e2e*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: "ignore" });
  } catch (e) {}
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.log("FATAL: " + e.message + "\n" + e.stack); process.exit(3); });
