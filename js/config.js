/* ============================================================
 *  塔防 · 配置表
 *  所有数值集中在这里，方便平衡性调整
 * ============================================================ */
window.TDC = (function () {
  'use strict';

  const TILE = 40;
  const COLS = 20;
  const ROWS = 12;
  const W = COLS * TILE;   // 800
  const H = ROWS * TILE;   // 480

  // 路径拐点（格坐标），首尾在画面外，保证敌人从边缘进、从边缘出
  const WAYPOINTS = [
    [-1, 2], [5, 2], [5, 5], [10, 5], [10, 8], [15, 8], [15, 5], [20, 5]
  ];

  /* ---------------- 防御塔 ---------------- */
  const TOWERS = {
    arrow: {
      key: 'arrow',
      name: '箭塔',
      hotkey: '1',
      color: '#2f6fed',
      accent: '#8fb6ff',
      desc: '高射速单体输出，前期主力。',
      levels: [
        { cost: 50,  dmg: 12, rate: 1.7, range: 3.2, bulletSpeed: 560 },
        { cost: 60,  dmg: 22, rate: 1.95, range: 3.6, bulletSpeed: 600 },
        { cost: 110, dmg: 40, rate: 2.3, range: 4.0, bulletSpeed: 650 }
      ]
    },
    cannon: {
      key: 'cannon',
      name: '炮塔',
      hotkey: '2',
      color: '#b4530a',
      accent: '#f0b27a',
      desc: '范围爆炸，对付成群小兵极强。',
      levels: [
        { cost: 105, dmg: 34, rate: 0.62, range: 3.0, splash: 1.3, bulletSpeed: 330 },
        { cost: 120, dmg: 60, rate: 0.70, range: 3.3, splash: 1.5, bulletSpeed: 360 },
        { cost: 210, dmg: 100, rate: 0.80, range: 3.7, splash: 1.8, bulletSpeed: 400 }
      ]
    },
    frost: {
      key: 'frost',
      name: '冰塔',
      hotkey: '3',
      color: '#0e9aa7',
      accent: '#9de8ef',
      desc: '伤害不高，但大幅减速，为其他塔争取时间。',
      levels: [
        { cost: 75, dmg: 6,  rate: 1.10, range: 2.7, slow: 0.50, slowDur: 1.6, bulletSpeed: 430 },
        { cost: 85, dmg: 11, rate: 1.25, range: 3.0, slow: 0.60, slowDur: 2.0, bulletSpeed: 460 },
        { cost: 150, dmg: 18, rate: 1.45, range: 3.3, slow: 0.70, slowDur: 2.5, bulletSpeed: 500 }
      ]
    },
    tesla: {
      key: 'tesla',
      name: '电塔',
      hotkey: '4',
      color: '#8b3fd6',
      accent: '#d9b6ff',
      desc: '闪电链式伤害，越密集的敌群收益越高。',
      levels: [
        { cost: 150, dmg: 20, rate: 1.15, range: 3.4, chain: 3, chainRange: 2.4, bulletSpeed: 0 },
        { cost: 160, dmg: 34, rate: 1.30, range: 3.7, chain: 4, chainRange: 2.6, bulletSpeed: 0 },
        { cost: 260, dmg: 55, rate: 1.50, range: 4.1, chain: 5, chainRange: 2.8, bulletSpeed: 0 }
      ]
    }
  };
  const TOWER_ORDER = ['arrow', 'cannon', 'frost', 'tesla'];

  /* ---------------- 敌人 ---------------- */
  const ENEMIES = {
    grunt:  { key: 'grunt',  name: '小兵',   hp: 45,  speed: 2.00, reward: 9,   leak: 1,  armor: 0,    r: 11, color: '#e5484d', shape: 'circle' },
    runner: { key: 'runner', name: '疾行者', hp: 32,  speed: 3.60, reward: 11,  leak: 1,  armor: 0,    r: 9,  color: '#f5a524', shape: 'tri'    },
    tank:   { key: 'tank',   name: '重甲兵', hp: 190, speed: 1.25, reward: 24,  leak: 3,  armor: 0.25, r: 15, color: '#8b5cf6', shape: 'square' },
    boss:   { key: 'boss',   name: '首领',   hp: 1100, speed: 0.95, reward: 180, leak: 10, armor: 0.30, r: 23, color: '#e11d48', shape: 'boss'   }
  };

  /* ---------------- 波次 ---------------- */
  // group: { type, count, gap(同组间隔秒), delay(该组延迟秒) }
  const WAVES = [
    { groups: [{ type: 'grunt', count: 8, gap: 0.85 }] },
    { groups: [{ type: 'grunt', count: 11, gap: 0.7 }] },
    { groups: [{ type: 'runner', count: 9, gap: 0.55 }] },
    { groups: [{ type: 'grunt', count: 9, gap: 0.6 }, { type: 'runner', count: 5, gap: 0.5, delay: 3 }] },
    { groups: [{ type: 'tank', count: 3, gap: 1.6 }, { type: 'grunt', count: 9, gap: 0.5, delay: 2 }] },
    { groups: [{ type: 'runner', count: 14, gap: 0.42 }] },
    { groups: [{ type: 'tank', count: 5, gap: 1.2 }, { type: 'runner', count: 8, gap: 0.45, delay: 2.5 }] },
    { boss: true, groups: [{ type: 'boss', count: 1, gap: 1 }, { type: 'grunt', count: 12, gap: 0.45, delay: 2 }] },
    { groups: [{ type: 'grunt', count: 16, gap: 0.4 }, { type: 'runner', count: 7, gap: 0.4, delay: 4 }] },
    { groups: [{ type: 'tank', count: 7, gap: 1.0 }, { type: 'runner', count: 10, gap: 0.35, delay: 2 }] },
    { groups: [{ type: 'runner', count: 20, gap: 0.3 }] },
    { groups: [{ type: 'tank', count: 8, gap: 0.9 }, { type: 'grunt', count: 16, gap: 0.32, delay: 3 }] },
    { groups: [{ type: 'tank', count: 6, gap: 0.8 }, { type: 'runner', count: 16, gap: 0.28, delay: 2 }] },
    { groups: [{ type: 'tank', count: 11, gap: 0.7 }, { type: 'runner', count: 12, gap: 0.3, delay: 4 }] },
    { boss: true, groups: [{ type: 'boss', count: 2, gap: 6 }, { type: 'tank', count: 6, gap: 0.9, delay: 3 }] },
    { boss: true, groups: [{ type: 'boss', count: 3, gap: 5 }, { type: 'tank', count: 8, gap: 0.7, delay: 2 }, { type: 'runner', count: 14, gap: 0.25, delay: 6 }] }
  ];

  const PREPARE_TIME = 22;      // 每波之间的准备秒数
  const EARLY_BONUS_PER_SEC = 2; // 提前开波每秒额外金币

  return {
    TILE, COLS, ROWS, W, H, WAYPOINTS,
    TOWERS, TOWER_ORDER, ENEMIES, WAVES,
    START_GOLD: 240,
    START_LIVES: 20,
    PREPARE_TIME,
    EARLY_BONUS_PER_SEC,
    HP_SCALE_PER_WAVE: 0.06,   // 每波敌人血量成长
    SPEED_SCALE_PER_WAVE: 0.015 // 每波敌人速度成长
  };
})();
