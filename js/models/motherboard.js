import * as THREE from 'three';
import * as M from '../lib/materials.js';
import { instanced, mesh, RoundedBoxGeometry } from '../lib/geom.js';
import { canvasTex, pcbBase, silk, silkRect, drawVia, rng } from '../lib/textures.js';
import { buildCpuSocket } from './cpu.js';
import { buildDimm, buildDimmSlot } from './dimm.js';
import { buildM2Ssd, buildM2Socket, M2 } from './m2ssd.js';

/**
 * Micro-ATX 主板(244 × 244 mm,1 单位 = 1 cm)
 * 板面坐标:x ∈ [-12.2, 12.2],z ∈ [-12.2, 12.2](z 负方向 = 板子"上方",后置 I/O 在左侧)
 * 返回各关键部件位置,用于数据流动画
 */
export const MB = { S: 24.4, T: 0.16 };
export const POS = {
  cpu: new THREE.Vector3(-3.0, 0, -5.0),
  dimmX: [4.2, 5.1, 6.0, 6.9],
  dimmZ: -4.6,
  pch: new THREE.Vector3(4.5, 0, 6.8),
  m2: new THREE.Vector3(-5.65, 0, 5.1),
  sata: new THREE.Vector3(11.55, 0, 7.6),
};

export function buildMotherboard() {
  const g = new THREE.Group();
  const { S, T } = MB;
  const half = S / 2;
  const toPx = (x, z) => [((x + half) / S) * 2048, ((z + half) / S) * 2048];
  const k = 2048 / S;

  const tex = canvasTex(2048, 2048, (ctx, w, h) => {
    const r = rng(42);
    pcbBase(ctx, w, h, { mask: '#15171c', seed: 21, traceColor: 'rgba(150,160,180,0.09)', traces: 260, traceWidth: 2.2 });
    // 内存总线:等长蛇形走线
    ctx.strokeStyle = 'rgba(170,180,200,0.16)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const [x0, y0] = toPx(-0.6, -8.4 + i * 0.3);
      const [x1] = toPx(3.9, 0);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      for (let x = x0; x < x1; x += 14) {
        const wiggle = (x > x0 + 120 && x < x0 + 260 && i % 3 === 0) ? ((x / 14) % 2 ? 8 : -8) : 0;
        ctx.lineTo(x, y0 + wiggle);
      }
      ctx.stroke();
    }
    // PCIe / DMI 差分对
    ctx.strokeStyle = 'rgba(170,180,200,0.14)';
    for (let i = 0; i < 16; i++) {
      const [x0, y0] = toPx(-4.6 + i * 0.12, -2.4);
      const [, y1] = toPx(0, 2.5);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const [x0, y0] = toPx(-0.4 + i * 0.12, -2.4);
      const [x1, y1] = toPx(3.6 + i * 0.12, 5.2);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + 120); ctx.lineTo(x1, y1 - 200); ctx.lineTo(x1, y1); ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const [x0, y0] = toPx(6.3, 6.4 + i * 0.12);
      const [x1] = toPx(10.8, 0);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
    }
    // 丝印
    const lab = (t, x, z, size = 26, rot = 0) => { const [a, b] = toPx(x, z); silk(ctx, t, a, b, size, { rot }); };
    lab('CPU1  LGA1851', -5.4, -1.6, 24);
    ['DDR5_A1', 'DDR5_A2', 'DDR5_B1', 'DDR5_B2'].forEach((t, i) => lab(t, POS.dimmX[i] - 0.2, 3.0, 18, -Math.PI / 2));
    lab('PCIEX16_1', -11.0, 3.9, 22);
    lab('M2_1  (CPU)  PCIe 5.0 x4', -10.5, 6.7, 20);
    lab('PCIEX1_1', -11.0, 9.3, 20);
    lab('SATA6G_1-4', 9.0, 10.0, 20);
    lab('ATX_24P', 9.4, -8.3, 20);
    lab('CPU_8P', -9.6, -10.3, 18);
    lab('STORAGE LAB  Z890M-EDU', 0.6, 11.2, 34);
    lab('BAT', -2.9, 11.5, 18);
    // 元件丝印框 + 过孔阵列
    const [ax, ay] = toPx(-5.5, -7.8);
    silkRect(ctx, ax, ay, 5.0 * k, 5.6 * k, { corner: false });
    for (let i = 0; i < 400; i++) drawVia(ctx, ...toPx(-12 + r() * 24, -12 + r() * 24), 3);
    // 安装孔
    [[-11.4, -11.4], [-11.4, 1.0], [-11.4, 11.4], [11.4, -11.4], [11.4, 1.0], [11.4, 11.4]].forEach(([x, z]) => {
      const [a, b] = toPx(x, z);
      ctx.fillStyle = 'rgba(210,180,100,0.9)';
      ctx.beginPath(); ctx.arc(a, b, 0.42 * k, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a0a0a';
      ctx.beginPath(); ctx.arc(a, b, 0.2 * k, 0, Math.PI * 2); ctx.fill();
    });
  });
  const pm = M.pcb(tex, { bump: 0.4 });
  const board = mesh(new THREE.BoxGeometry(S, T, S), [M.fr4(), M.fr4(), pm, pm, M.fr4(), M.fr4()], 0, T / 2, 0, g);
  void board;

  const black = M.plastic(0x141519, 0.5);
  const darkAlu = M.brushedAluminum({ color: 0x3a3e46, roughness: 0.45, anodized: true });
  const steel = M.stainless({ color: 0xb6bbc3, roughness: 0.32 });

  /* ---- CPU 插座 + CPU ---- */
  const cpu = buildCpuSocket();
  cpu.group.position.set(POS.cpu.x, T, POS.cpu.z);
  g.add(cpu.group);

  /* ---- 供电散热片(带鳍片) ---- */
  const heatsink = (x, z, w, d, h, finsAlongX) => {
    const hg = new THREE.Group();
    hg.position.set(x, T, z);
    mesh(new RoundedBoxGeometry(w, 0.5, d, 2, 0.05), darkAlu, 0, 0.5, 0, hg);
    const fins = [];
    const n = Math.floor((finsAlongX ? w : d) / 0.32);
    for (let i = 0; i < n; i++) {
      const t = -((finsAlongX ? w : d) / 2) + 0.16 + i * 0.32;
      fins.push(finsAlongX ? { x: t, y: 0.75 + h / 2, z: 0 } : { x: 0, y: 0.75 + h / 2, z: t });
    }
    hg.add(instanced(finsAlongX ? new THREE.BoxGeometry(0.12, h, d) : new THREE.BoxGeometry(w, h, 0.12), darkAlu, fins));
    // 下方电感
    const chokes = [];
    const m = Math.floor((finsAlongX ? w : d) / 1.0);
    for (let i = 0; i < m; i++) {
      const t = -((finsAlongX ? w : d) / 2) + 0.5 + i * 1.0;
      chokes.push(finsAlongX ? { x: t, y: 0.15, z: d / 2 + 0.5 } : { x: w / 2 + 0.5, y: 0.15, z: t });
    }
    hg.add(instanced(new THREE.BoxGeometry(0.75, 0.3, 0.75), new THREE.MeshStandardMaterial({ color: 0x4a4e55, roughness: 0.6, metalness: 0.3 }), chokes));
    g.add(hg);
  };
  heatsink(-3.2, -10.3, 8.4, 1.6, 1.4, true);
  heatsink(-8.8, -5.0, 1.6, 7.0, 1.4, false);

  /* ---- 后置 I/O 挡罩 ---- */
  mesh(new RoundedBoxGeometry(2.6, 3.4, 10.6, 3, 0.12), darkAlu, -10.9, T + 1.7, -6.7, g);
  // 接口(USB / 网口)开口
  const ports = [];
  for (let i = 0; i < 6; i++) ports.push({ x: -12.25, y: T + 0.8 + (i % 2) * 1.0, z: -10.8 + Math.floor(i / 2) * 2.0 });
  g.add(instanced(new THREE.BoxGeometry(0.1, 0.6, 1.4), M.plastic(0x2255aa, 0.5), ports));

  /* ---- 内存插槽 + 内存条 ---- */
  const dimms = [];
  POS.dimmX.forEach((x, i) => {
    const slot = buildDimmSlot();
    slot.rotation.y = Math.PI / 2;
    slot.position.set(x, T, POS.dimmZ);
    g.add(slot);
    if (i === 1 || i === 3) {
      const d = buildDimm({ seed: 3 + i });
      d.group.rotation.y = Math.PI / 2;
      d.group.position.set(x, T + 0.2, POS.dimmZ);
      g.add(d.group);
      dimms.push(d);
    }
  });

  /* ---- 24 针供电 / CPU 8 针 ---- */
  mesh(new RoundedBoxGeometry(1.0, 1.5, 5.3, 2, 0.06), black, 11.3, T + 0.75, -4.6, g);
  mesh(new RoundedBoxGeometry(1.0, 1.3, 2.0, 2, 0.06), black, -9.4, T + 0.65, -11.3, g);

  /* ---- PCIe 插槽 ---- */
  const pcie = (x0, len, z, armored) => {
    mesh(new THREE.BoxGeometry(len, 1.1, 0.75), armored ? steel : black, x0 + len / 2, T + 0.55, z, g);
    mesh(new THREE.BoxGeometry(len - 0.4, 0.02, 0.2), M.plastic(0x050505, 0.9), x0 + len / 2, T + 1.11, z, g);
    mesh(new THREE.BoxGeometry(0.5, 1.2, 0.8), black, x0 + len + 0.25, T + 0.6, z, g);
  };
  pcie(-11.6, 8.9, 2.8, true);
  pcie(-11.6, 2.5, 9.0, false);

  /* ---- M.2 SSD ---- */
  const sock = buildM2Socket();
  sock.position.set(POS.m2.x - M2.L / 2 - 0.3, T, POS.m2.z);
  g.add(sock);
  const ssd = buildM2Ssd({ label: false });
  ssd.group.position.set(POS.m2.x, T + 0.42, POS.m2.z);
  g.add(ssd.group);
  mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.42, 6), new THREE.MeshStandardMaterial({ color: 0xc9a85a, metalness: 1, roughness: 0.3 }), POS.m2.x + M2.L / 2, T + 0.21, POS.m2.z, g);
  mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.08, 20), steel, POS.m2.x + M2.L / 2, T + 0.42 + 0.12, POS.m2.z, g);

  /* ---- 芯片组散热片 ---- */
  const pchTex = canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#34383f';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let i = -h; i < w; i += 18) { ctx.beginPath(); ctx.moveTo(i, h); ctx.lineTo(i + h, 0); ctx.stroke(); }
    ctx.fillStyle = 'rgba(220,226,235,0.85)';
    ctx.font = 'bold 54px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('STORAGE LAB', w / 2, h / 2 + 10);
    ctx.font = '30px "Segoe UI", Arial';
    ctx.fillText('Z890 CHIPSET', w / 2, h / 2 + 60);
  });
  const pchTop = new THREE.MeshPhysicalMaterial({ map: pchTex, metalness: 0.7, roughness: 0.4, clearcoat: 0.4 });
  mesh(new THREE.BoxGeometry(3.4, 0.9, 3.4), [darkAlu, darkAlu, pchTop, darkAlu, darkAlu, darkAlu], POS.pch.x, T + 0.45, POS.pch.z, g);

  /* ---- SATA 接口 ×4(直角) ---- */
  const sataG = new THREE.Group();
  sataG.position.set(POS.sata.x, T, POS.sata.z);
  mesh(new RoundedBoxGeometry(1.3, 1.25, 3.4, 2, 0.05), black, 0, 0.62, 0, sataG);
  const slots = [];
  for (let i = 0; i < 4; i++) slots.push({ x: 0.66, y: 0.33 + (i % 2) * 0.6, z: -0.8 + Math.floor(i / 2) * 1.6 });
  sataG.add(instanced(new THREE.BoxGeometry(0.04, 0.3, 0.9), M.plastic(0x050506, 0.9), slots));
  g.add(sataG);

  /* ---- 纽扣电池 + 音频电容 + 其他小件 ---- */
  mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.25, 40), black, -2.2, T + 0.12, 10.0, g);
  mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.32, 48), M.turnedMetal({ color: 0xc8ccd2 }), -2.2, T + 0.3, 10.0, g);
  const goldCap = new THREE.MeshStandardMaterial({ color: 0xc2a24a, metalness: 0.7, roughness: 0.35 });
  const capPos = [];
  for (let i = 0; i < 6; i++) capPos.push({ x: -10.8 + (i % 3) * 0.9, y: T + 0.5, z: 10.6 + Math.floor(i / 3) * 0.9 });
  g.add(instanced(new THREE.CylinderGeometry(0.32, 0.32, 1.0, 20), goldCap, capPos));
  const solid = [];
  for (let i = 0; i < 10; i++) solid.push({ x: -8.0 + i * 0.8, y: T + 0.42, z: -12.0 + 0.5 + (i % 2) * 0.1 });
  for (let i = 0; i < 6; i++) solid.push({ x: 1.2, y: T + 0.42, z: -1.6 - i * 0.75 });
  g.add(instanced(new THREE.CylinderGeometry(0.28, 0.28, 0.85, 20), M.turnedMetal({ color: 0x9aa0aa }), solid));
  // 安装螺丝
  const screws = [[-11.4, -11.4], [-11.4, 1.0], [-11.4, 11.4], [11.4, -11.4], [11.4, 1.0], [11.4, 11.4]].map(([x, z]) => ({ x, y: T + 0.05, z }));
  g.add(instanced(new THREE.CylinderGeometry(0.35, 0.35, 0.1, 20), steel, screws));

  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, cpu, dimms, ssd, sataPort: new THREE.Vector3(POS.sata.x + 0.7, T + 0.33, POS.sata.z - 0.8) };
}
