import * as THREE from 'three';
import * as M from '../lib/materials.js';
import { extrudeUpright, planarUV, instanced, mesh } from '../lib/geom.js';
import { canvasTex, pcbBase, silk, silkRect, chipTexture, stickerTexture, rng } from '../lib/textures.js';

/**
 * DDR5 UDIMM 内存条(1 单位 = 1 cm)
 * 133.35 × 31.25 mm,288 针金手指;8 颗 x8 DRAM 颗粒 + PMIC + SPD Hub
 * 竖直放置:XY 平面,底边(金手指)在 y = 0,厚度沿 Z,正面朝 +Z
 */
export const DIMM = { L: 13.335, H: 3.125, T: 0.127, KEY_X: -0.55 };

export function buildDimm({ seed = 3, label = true } = {}) {
  const g = new THREE.Group();
  g.name = 'DIMM';
  const { L, H, T, KEY_X } = DIMM;

  /* -------- PCB 外形:防呆缺口 + 两端卡扣缺口 -------- */
  const s = new THREE.Shape();
  const x0 = -L / 2, x1 = L / 2;
  const notchW = 0.2, notchD = 0.42;
  const sideY0 = 1.55, sideY1 = 1.9, sideD = 0.22;
  s.moveTo(x0 + 0.12, 0);
  s.lineTo(KEY_X - notchW / 2, 0);
  s.lineTo(KEY_X - notchW / 2, notchD - notchW / 2);
  s.absarc(KEY_X, notchD - notchW / 2, notchW / 2, Math.PI, 0, true);
  s.lineTo(KEY_X + notchW / 2, 0);
  s.lineTo(x1 - 0.12, 0);
  s.lineTo(x1, 0.12);
  s.lineTo(x1, sideY0);
  s.absarc(x1, (sideY0 + sideY1) / 2, (sideY1 - sideY0) / 2, -Math.PI / 2, Math.PI / 2, true);
  s.lineTo(x1, H);
  s.lineTo(x0, H);
  s.lineTo(x0, sideY1);
  s.absarc(x0, (sideY0 + sideY1) / 2, (sideY1 - sideY0) / 2, Math.PI / 2, -Math.PI / 2, true);
  s.lineTo(x0, 0.12);
  s.closePath();
  void sideD;

  const pcbGeo = extrudeUpright(s, T, { curveSegs: 12 });
  planarUV(pcbGeo, 'x', 'y', { flipB: false });

  const r = rng(seed);
  const px = 2048, py = Math.round(2048 * H / L);
  const toPx = (x, y) => [((x - x0) / L) * px, (1 - y / H) * py];
  const chipXs = [-5.7, -4.25, -2.8, -1.35, 1.35, 2.8, 4.25, 5.7];
  const tex = canvasTex(px, py, (ctx, w, h) => {
    pcbBase(ctx, w, h, { mask: '#0f4a2a', seed, traceColor: 'rgba(140,230,160,0.12)', traces: 160, traceWidth: 2 });
    // 金手指区域的镀金走线
    const [, fy] = toPx(0, 0.42);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, fy, w, h - fy);
    // 丝印
    chipXs.forEach((cx, i) => {
      const [a, b] = toPx(cx - 0.55, 2.35);
      const [c, d] = toPx(cx + 0.55, 1.15);
      silkRect(ctx, a, b, c - a, d - b);
      silk(ctx, `U${i + 1}`, a + 4, d + 14, 16);
    });
    const [lx, ly] = toPx(-6.4, 2.85);
    silk(ctx, 'DDR5 UDIMM  16GB 1Rx8  PC5-4800B-UB0', lx, ly, 22);
    const [qx, qy] = toPx(3.2, 2.85);
    silk(ctx, 'REV 1.10   94V-0   E487103', qx, qy, 18);
    const [kx, ky] = toPx(-0.5, 0.7);
    silk(ctx, 'PMIC', kx, ky - 98, 16);
    void r;
  });
  const pcbMat = M.pcb(tex, { bump: 0.6 });
  const edge = M.fr4();
  const pcb = new THREE.Mesh(pcbGeo, [pcbMat, edge]);
  pcb.castShadow = pcb.receiveShadow = true;
  g.add(pcb);

  /* -------- 金手指(两面各 144 针) -------- */
  const pads = [];
  const pitch = 0.085;
  const n = 144;
  const start = -(n - 1) * pitch / 2;
  for (let i = 0; i < n; i++) {
    const x = start + i * pitch;
    if (Math.abs(x - KEY_X) < notchW / 2 + 0.05) continue;
    if (Math.abs(x) > L / 2 - 0.25) continue;
    pads.push({ x, y: 0.2, z: T / 2 + 0.002 });
    pads.push({ x, y: 0.2, z: -T / 2 - 0.002 });
  }
  g.add(instanced(new THREE.BoxGeometry(0.06, 0.34, 0.004), M.gold(), pads, { castShadow: false }));

  /* -------- DRAM 颗粒(FBGA 封装) -------- */
  const chipTex = chipTexture(['D5 16Gb x8', 'DDR5-4800', 'K' + (1000 + (seed * 37) % 8999) + 'A2BCF'], { logo: 'SL', seed });
  const chipMats = M.chipMaterials(chipTex);
  const chipGeo = new THREE.BoxGeometry(1.0, 1.12, 0.12);
  const chips = [];
  chipXs.forEach(cx => {
    const c = mesh(chipGeo, chipMats.frontZ, cx, 1.75, T / 2 + 0.06, g);
    chips.push(c);
  });
  // 焊球阴影条(封装下缘)
  g.add(instanced(new THREE.BoxGeometry(0.96, 1.08, 0.02), M.plastic(0x0a0a0a, 0.9),
    chipXs.map(x => ({ x, y: 1.75, z: T / 2 + 0.008 })), { castShadow: false }));

  /* -------- PMIC + 电感 + 电容 -------- */
  const pmicTex = chipTexture(['PMIC5100', 'P8911'], { w: 256, h: 256, seed: seed + 1 });
  mesh(new THREE.BoxGeometry(0.5, 0.5, 0.09), M.chipMaterials(pmicTex).frontZ, -0.05, 2.35, T / 2 + 0.045, g);
  const inductor = new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.55, metalness: 0.4 });
  [-0.6, 0.5].forEach((x, i) => mesh(new THREE.BoxGeometry(0.32, 0.32, 0.15), inductor, x, 2.35 - i * 0.05, T / 2 + 0.075, g));
  mesh(new THREE.BoxGeometry(0.28, 0.28, 0.13), inductor, -0.05, 1.68, T / 2 + 0.065, g);
  // SPD Hub
  const spdTex = chipTexture(['SPD5118'], { w: 256, h: 256, seed: seed + 2, dot: true });
  mesh(new THREE.BoxGeometry(0.3, 0.3, 0.07), M.chipMaterials(spdTex).frontZ, 0.45, 0.95, T / 2 + 0.035, g);

  // 贴片电容 / 电阻
  const capBody = new THREE.MeshStandardMaterial({ color: 0xa8865a, roughness: 0.6 });
  const resBody = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
  const caps = [], ress = [], ends = [];
  chipXs.forEach(cx => {
    for (let k = 0; k < 4; k++) {
      const x = cx - 0.36 + k * 0.24, y = 0.88;
      (k % 2 ? ress : caps).push({ x, y, z: T / 2 + 0.03 });
      ends.push({ x: x - 0.045, y, z: T / 2 + 0.03 }, { x: x + 0.045, y, z: T / 2 + 0.031 });
    }
    caps.push({ x: cx + 0.62, y: 2.0, z: T / 2 + 0.03, rz: Math.PI / 2 });
    caps.push({ x: cx + 0.62, y: 1.5, z: T / 2 + 0.03, rz: Math.PI / 2 });
  });
  for (let i = 0; i < 10; i++) caps.push({ x: -0.85 + (i % 5) * 0.32, y: 1.25 + Math.floor(i / 5) * 0.16, z: T / 2 + 0.03 });
  const capGeo = new THREE.BoxGeometry(0.1, 0.05, 0.05);
  g.add(instanced(capGeo, capBody, caps));
  g.add(instanced(capGeo, resBody, ress));
  g.add(instanced(new THREE.BoxGeometry(0.02, 0.052, 0.052), M.solder(), ends, { castShadow: false }));

  /* -------- 背面标签 -------- */
  if (label) {
    const st = stickerTexture({ w: 1024, h: 300, title: 'STORAGE LAB  DDR5', accent: '#2a4f86', lines: ['16GB 1Rx8 PC5-4800B', 'SL5U16G48 · 1.1V · CL40'] });
    const lbl = mesh(new THREE.PlaneGeometry(5.6, 1.6), M.sticker(st), 1.8, 1.9, -T / 2 - 0.003, g);
    lbl.rotation.y = Math.PI;
  }

  return { group: g, chips, chipXs };
}

/** 内存插槽(黑色塑料 + 两端白色卡扣) */
export function buildDimmSlot() {
  const g = new THREE.Group();
  const body = M.plastic(0x16171b, 0.5);
  const latch = M.plastic(0xd8d9dc, 0.45);
  const L = 14.6;
  mesh(new THREE.BoxGeometry(L, 0.75, 0.72), body, 0, 0.375, 0, g);
  // 槽口
  mesh(new THREE.BoxGeometry(L - 0.6, 0.02, 0.2), M.plastic(0x050505, 0.9), 0, 0.751, 0, g);
  // 卡扣
  for (const sx of [-1, 1]) {
    const l = new THREE.Group();
    l.position.set(sx * (L / 2 + 0.05), 0.2, 0);
    mesh(new THREE.BoxGeometry(0.45, 1.9, 0.62), latch, 0, 0.95, 0, l);
    mesh(new THREE.BoxGeometry(0.2, 0.5, 0.66), latch, sx * 0.25, 1.75, 0, l);
    l.rotation.z = 0;
    g.add(l);
  }
  return g;
}
