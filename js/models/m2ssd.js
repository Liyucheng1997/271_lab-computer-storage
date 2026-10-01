import * as THREE from 'three';
import * as M from '../lib/materials.js';
import { extrudeFlat, planarUV, instanced, mesh } from '../lib/geom.js';
import { canvasTex, pcbBase, silk, silkRect, chipTexture, stickerTexture } from '../lib/textures.js';

/**
 * M.2 2280 NVMe 固态硬盘(1 单位 = 1 cm)
 * 80 × 22 mm,M-Key 金手指在 -X 端,螺丝半圆缺口在 +X 端
 * 平放:PCB 底面 y = 0,正面朝 +Y
 */
export const M2 = { L: 8.0, W: 2.2, T: 0.08 };

export function buildM2Ssd({ seed = 6, label = true } = {}) {
  const g = new THREE.Group();
  g.name = 'M2SSD';
  const { L, W, T } = M2;
  const x0 = -L / 2, x1 = L / 2;
  const keyZ = 0.62, keyW = 0.12, keyD = 0.42;

  // 外形(shape 的 y → 世界 z)
  const s = new THREE.Shape();
  s.moveTo(x0, -W / 2 + 0.05);
  s.lineTo(x0, keyZ - keyW / 2);
  s.lineTo(x0 + keyD - keyW / 2, keyZ - keyW / 2);
  s.absarc(x0 + keyD - keyW / 2, keyZ, keyW / 2, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(x0, keyZ + keyW / 2);
  s.lineTo(x0, W / 2 - 0.05);
  s.lineTo(x0 + 0.05, W / 2);
  s.lineTo(x1 - 0.1, W / 2);
  s.lineTo(x1, W / 2 - 0.1);
  s.lineTo(x1, 0.175);
  s.absarc(x1, 0, 0.175, Math.PI / 2, -Math.PI / 2, false);
  s.lineTo(x1, -W / 2 + 0.1);
  s.lineTo(x1 - 0.1, -W / 2);
  s.lineTo(x0 + 0.05, -W / 2);
  s.closePath();
  const geo = extrudeFlat(s, T, { curveSegs: 16 });
  planarUV(geo, 'x', 'z');

  const px = 2048, pz = Math.round(2048 * W / L);
  const toPx = (x, z) => [((x - x0) / L) * px, ((z + W / 2) / W) * pz];
  const parts = {
    ctrl: { x: -2.35, z: 0, w: 1.2, d: 1.2 },
    dram: { x: -0.95, z: 0.1, w: 0.8, d: 1.2 },
    nand1: { x: 0.65, z: 0, w: 1.4, d: 1.8 },
    nand2: { x: 2.35, z: 0, w: 1.4, d: 1.8 },
  };
  const tex = canvasTex(px, pz, (ctx, w, h) => {
    pcbBase(ctx, w, h, { mask: '#101215', seed, traceColor: 'rgba(170,180,200,0.10)', traces: 120, traceWidth: 1.8 });
    for (const p of Object.values(parts)) {
      const [a, b] = toPx(p.x - p.w / 2 - 0.05, p.z - p.d / 2 - 0.05);
      const [c, d] = toPx(p.x + p.w / 2 + 0.05, p.z + p.d / 2 + 0.05);
      silkRect(ctx, a, b, c - a, d - b);
    }
    const [tx, ty] = toPx(3.2, -0.95);
    silk(ctx, 'M.2 2280-D2-M  PCIe 4.0 x4', tx - 210, ty, 16);
    const [ux, uy] = toPx(-3.55, 0.95);
    silk(ctx, 'M KEY', ux, uy, 14);
  });
  const pcbMat = M.pcb(tex, { bump: 0.5 });
  const pcb = new THREE.Mesh(geo, [pcbMat, M.fr4()]);
  pcb.castShadow = pcb.receiveShadow = true;
  g.add(pcb);

  // 金手指(正反两面)
  const pads = [];
  const pitch = 0.05;
  for (let i = 0; i < 40; i++) {
    const z = -W / 2 + 0.15 + i * pitch;
    if (z > W / 2 - 0.12) break;
    if (Math.abs(z - keyZ) < keyW / 2 + 0.03) continue;
    pads.push({ x: x0 + 0.13, y: T + 0.002, z });
    if (i % 2) pads.push({ x: x0 + 0.13, y: -0.002, z });
  }
  g.add(instanced(new THREE.BoxGeometry(0.22, 0.004, 0.032), M.gold(), pads, { castShadow: false }));

  // 芯片
  const chip = (p, lines, h, opts) => {
    const t = chipTexture(lines, { seed: seed + lines.length, ...opts });
    const m = mesh(new THREE.BoxGeometry(p.w, h, p.d), M.chipMaterials(t).flatTopY, p.x, T + h / 2, p.z, g);
    return m;
  };
  const meshes = {
    ctrl: chip(parts.ctrl, ['NVMe 2.0', 'PCIe Gen4', 'SL-C780'], 0.1, { logo: 'SL' }),
    dram: chip(parts.dram, ['LPDDR4', '1GB'], 0.08, {}),
    nand1: chip(parts.nand1, ['3D TLC NAND', '512GB', 'SL232L'], 0.13, { logo: 'SL' }),
    nand2: chip(parts.nand2, ['3D TLC NAND', '512GB', 'SL232L'], 0.13, { logo: 'SL' }),
  };
  // 电源芯片 + 电感 + 贴片电容
  const pm = chipTexture(['PMIC'], { w: 256, h: 256 });
  mesh(new THREE.BoxGeometry(0.4, 0.06, 0.4), M.chipMaterials(pm).flatTopY, -3.25, T + 0.03, -0.55, g);
  const ind = new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.55, metalness: 0.4 });
  mesh(new THREE.BoxGeometry(0.3, 0.14, 0.3), ind, -3.25, T + 0.07, 0.35, g);
  const caps = [], ends = [];
  const capSpots = [[-3.4, -0.1], [-3.4, 0.0], [-3.1, -0.1], [-1.6, 0.85], [-1.6, -0.85], [-1.45, 0.85], [-0.3, 0.9], [-0.3, -0.9], [1.5, 0.95], [1.5, -0.95], [3.2, 0.9], [3.2, -0.9], [-1.75, 0.6], [-1.75, -0.6]];
  capSpots.forEach(([x, z]) => {
    caps.push({ x, y: T + 0.025, z });
    ends.push({ x: x - 0.045, y: T + 0.025, z }, { x: x + 0.045, y: T + 0.025, z });
  });
  g.add(instanced(new THREE.BoxGeometry(0.1, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0xa8865a, roughness: 0.6 }), caps));
  g.add(instanced(new THREE.BoxGeometry(0.02, 0.052, 0.052), M.solder(), ends, { castShadow: false }));

  // 背面标签
  if (label) {
    const st = stickerTexture({ w: 1024, h: 300, title: 'STORAGE LAB  NVMe SSD', accent: '#1f4e8c', lines: ['1 TB  ·  M.2 2280  ·  PCIe 4.0 x4', 'SL-NV1000  3.3V 2.5A'] });
    const lbl = mesh(new THREE.PlaneGeometry(4.6, 1.4), M.sticker(st), 0.6, -0.003, 0, g);
    lbl.rotation.x = Math.PI / 2;
  }
  return { group: g, parts, meshes };
}

/** M.2 插座 + 固定螺柱(放在主板上) */
export function buildM2Socket() {
  const g = new THREE.Group();
  const body = M.plastic(0x15161a, 0.45);
  mesh(new THREE.BoxGeometry(0.55, 0.42, 2.5), body, 0, 0.21, 0, g);
  mesh(new THREE.BoxGeometry(0.25, 0.12, 2.25), M.plastic(0x050506, 0.9), 0.2, 0.28, 0, g);
  const pins = [];
  for (let i = 0; i < 34; i++) pins.push({ x: -0.32, y: 0.02, z: -1.05 + i * 0.064 });
  g.add(instanced(new THREE.BoxGeometry(0.14, 0.02, 0.03), M.gold(), pins));
  return g;
}
