import * as THREE from 'three';
import * as M from '../lib/materials.js';
import { rrectShape, rrectPath, extrudeFlat, planarUV, ribbonGeometry, updateRibbon, mesh, instanced, RoundedBoxGeometry } from '../lib/geom.js';
import { stickerTexture, coilTexture, flexTexture, chipTexture, canvasTex, pcbBase, silk, rng } from '../lib/textures.js';

/**
 * 3.5 英寸机械硬盘(1 单位 = 1 cm)
 * 外形 147 × 101.6 × 26.1 mm;3 张 95 mm 盘片;旋转音圈电机驱动的磁头组件
 *
 * 坐标:X 为长边,Z 为短边,Y 向上;底座底面 y = 0
 */
export const HDD = {
  L: 14.7,
  W: 10.16,
  H: 2.61,
  C: new THREE.Vector2(-2.25, 0),     // 盘片中心 (x, z)
  P: new THREE.Vector2(3.9, 1.9),     // 磁头臂转轴 (x, z)
  ARM: 5.2,                            // 转轴到磁头距离
  R_OUT: 4.75,
  R_IN: 1.25,
  T: 0.127,                            // 盘片厚度
  PLATTER_Y: [0.85, 1.27, 1.69],       // 各盘片中心高度
  ARM_Y: [0.64, 1.06, 1.48, 1.9],      // 各层磁头臂高度
  FLOOR: 0.32,
  TRACK_MIN: 2.0,
  TRACK_MAX: 4.6,
  PARK_R: 5.08,
};

export function armAngleForRadius(r) {
  const dx = HDD.P.x - HDD.C.x, dz = HDD.P.y - HDD.C.y;
  const D = Math.hypot(dx, dz);
  const phi = Math.atan2(dz, dx);
  const k = (D * D + HDD.ARM * HDD.ARM - r * r) / (2 * HDD.ARM);
  return -phi - Math.acos(THREE.MathUtils.clamp(k / D, -1, 1));
}

/** 指定臂角时,磁头相对盘片中心的位置 (x, z) */
export function headPos(theta, out = new THREE.Vector2()) {
  return out.set(HDD.P.x - HDD.ARM * Math.cos(theta), HDD.P.y + HDD.ARM * Math.sin(theta));
}

export function buildHdd({ cover = true, pcbBottom = true, label = true } = {}) {
  const root = new THREE.Group();
  root.name = 'HDD';
  const { L, W, H, C, P } = HDD;

  const mats = {
    base: M.castAluminum({ color: 0xb8bec7 }),
    cover: M.stainless({ color: 0xc8cdd4, roughness: 0.3 }),
    platter: M.platterMaterial(),
    platterEdge: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.35 }),
    hub: M.turnedMetal({ color: 0xd2d6dc, roughness: 0.22 }),
    arm: M.brushedAluminum({ color: 0xb9bec6, roughness: 0.35, repeat: [1, 1] }),
    susp: M.stainless({ color: 0xd8dce2, roughness: 0.2 }),
    slider: M.ceramic(0x2a2d33),
    coil: new THREE.MeshStandardMaterial({ map: coilTexture(), metalness: 0.85, roughness: 0.35 }),
    overmold: M.plastic(0x1b1c20, 0.5),
    yoke: new THREE.MeshPhysicalMaterial({ color: 0xd4d8de, metalness: 1, roughness: 0.18, clearcoat: 0.4 }),
    magnet: M.darkMetal(0x3a3d43, 0.5),
    flex: new THREE.MeshPhysicalMaterial({ map: flexTexture(), roughness: 0.35, metalness: 0.1, clearcoat: 0.6, side: THREE.DoubleSide }),
    ramp: M.plastic(0x2a2c31, 0.45),
    screw: new THREE.MeshStandardMaterial({ color: 0x6d737c, metalness: 1, roughness: 0.35 }),
    hole: new THREE.MeshStandardMaterial({ color: 0x18191c, metalness: 0.6, roughness: 0.7 }),
    filter: M.plastic(0xe8e8e4, 0.85),
  };

  /* ---------------- 底座(压铸铝) ---------------- */
  const base = new THREE.Group();
  root.add(base);
  const floorShape = rrectShape(L, W, 0.35);
  mesh(extrudeFlat(floorShape, HDD.FLOOR, { bevel: 0.02 }), mats.base, 0, 0, 0, base);

  const wallH = H - 0.08 - HDD.FLOOR;
  const wallShape = rrectShape(L, W, 0.35);
  const innerW = L - 0.4, innerD = W - 0.36;
  wallShape.holes.push(rrectPath(innerW, innerD, 0.25));
  mesh(extrudeFlat(wallShape, wallH, { bevel: 0.015 }), mats.base, 0, HDD.FLOOR, 0, base);

  // 盘片两侧的弧形导流角块
  const R = 4.92, xi = -innerW / 2, zi = innerD / 2;
  for (const sz of [1, -1]) {
    const s = new THREE.Shape();
    const dxw = Math.sqrt(R * R - zi * zi);
    const dzw = Math.sqrt(Math.max(0, R * R - (xi - C.x) ** 2));
    const a1 = Math.atan2(sz * zi, -dxw);
    const a2 = Math.atan2(sz * dzw, xi - C.x);
    s.moveTo(xi, sz * zi);
    s.lineTo(C.x - dxw, sz * zi);
    s.absarc(C.x, 0, R, a1, a2, sz < 0);
    s.lineTo(xi, sz * dzw);
    s.closePath();
    mesh(extrudeFlat(s, wallH - 0.35, { curveSegs: 32 }), mats.base, 0, HDD.FLOOR, 0, base);
  }
  // 弧形导流隔墙(避开磁头臂扫过的区域与停泊坡道)
  for (const [a0, a1] of [[0.5, 1.25], [-1.32, -0.82]]) {
    const s = new THREE.Shape();
    s.absarc(C.x, 0, R + 0.2, a0, a1, false);
    s.absarc(C.x, 0, R, a1, a0, true);
    s.closePath();
    mesh(extrudeFlat(s, 1.95, { curveSegs: 24 }), mats.base, 0, HDD.FLOOR, 0, base);
  }
  // 底座内部加强筋
  [[5.2, -3.6, 0.18, 2.4, 0.4], [-0.2, -4.2, 2.0, 0.18, 0.5], [6.6, 3.6, 0.18, 1.6, 0.6]].forEach(([x, z, w, d, h]) => {
    mesh(new THREE.BoxGeometry(w, h, d), mats.base, x, HDD.FLOOR + h / 2, z, base);
  });

  // 螺丝孔 / 螺丝
  const screwPos = [
    [-L / 2 + 0.38, -W / 2 + 0.38], [-L / 2 + 0.38, W / 2 - 0.38], [L / 2 - 0.38, -W / 2 + 0.38], [L / 2 - 0.38, W / 2 - 0.38],
    [-0.5, -W / 2 + 0.2], [-0.5, W / 2 - 0.2], [L / 2 - 0.2, 0], [-L / 2 + 0.2, 0],
  ];

  /* ---------------- 主轴电机与盘片 ---------------- */
  const spindle = new THREE.Group();
  spindle.position.set(C.x, 0, C.y);
  root.add(spindle);
  // 固定的电机座
  mesh(new THREE.CylinderGeometry(1.7, 1.75, 0.3, 64), mats.hub, 0, HDD.FLOOR + 0.15, 0, spindle);

  const platterGroup = new THREE.Group();      // 随转速旋转
  spindle.add(platterGroup);
  const hubTop = HDD.PLATTER_Y[2] + HDD.T / 2;
  mesh(new THREE.CylinderGeometry(HDD.R_IN, HDD.R_IN, hubTop - 0.62, 64), mats.hub, 0, 0.62 + (hubTop - 0.62) / 2, 0, platterGroup);
  mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.08, 64), mats.hub, 0, HDD.PLATTER_Y[0] - HDD.T / 2 - 0.04, 0, platterGroup);

  const ringTop = new THREE.RingGeometry(HDD.R_IN, HDD.R_OUT, 160, 1);
  ringTop.rotateX(-Math.PI / 2);
  const ringBot = new THREE.RingGeometry(HDD.R_IN, HDD.R_OUT, 160, 1);
  ringBot.rotateX(Math.PI / 2);
  const edge = new THREE.CylinderGeometry(HDD.R_OUT, HDD.R_OUT, HDD.T, 160, 1, true);
  const platters = [];
  HDD.PLATTER_Y.forEach((y, i) => {
    const g = new THREE.Group();
    g.position.y = y;
    const top = mesh(ringTop, mats.platter, 0, HDD.T / 2, 0, g);
    mesh(ringBot, mats.platter, 0, -HDD.T / 2, 0, g);
    mesh(edge, mats.platterEdge, 0, 0, 0, g);
    platterGroup.add(g);
    platters.push({ group: g, top });
    // 盘片间隔环
    if (i < 2) {
      const gap = HDD.PLATTER_Y[i + 1] - y - HDD.T;
      mesh(new THREE.CylinderGeometry(1.5, 1.5, gap, 64), mats.hub, 0, y + HDD.T / 2 + gap / 2, 0, platterGroup);
    }
  });

  // 压盘夹具(碟形)+ 6 颗梅花螺丝
  const clampProfile = [
    new THREE.Vector2(0.0, 0.0), new THREE.Vector2(1.78, 0.0), new THREE.Vector2(1.8, 0.02),
    new THREE.Vector2(1.6, 0.05), new THREE.Vector2(1.2, 0.09), new THREE.Vector2(0.5, 0.11), new THREE.Vector2(0.0, 0.11),
  ];
  mesh(new THREE.LatheGeometry(clampProfile, 96), mats.hub, 0, hubTop, 0, platterGroup);
  const torx = new THREE.CylinderGeometry(0.13, 0.13, 0.05, 6);
  const clampScrews = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    clampScrews.push({ x: Math.cos(a) * 0.95, y: hubTop + 0.12, z: Math.sin(a) * 0.95, ry: a });
  }
  platterGroup.add(instanced(torx, mats.screw, clampScrews));
  platterGroup.add(instanced(new THREE.CylinderGeometry(0.06, 0.06, 0.052, 6), mats.hole,
    clampScrews.map(t => ({ ...t, y: t.y + 0.002 }))));
  mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 48), mats.screw, 0, hubTop + 0.12, 0, platterGroup);

  // 伺服扇区(盘面上隐约可见的弧形"辐条"),同时体现旋转
  const servo = buildServoWedges();
  servo.position.y = HDD.PLATTER_Y[2] + HDD.T / 2 + 0.002;
  platterGroup.add(servo);

  /* ---------------- 音圈电机磁铁(固定) ---------------- */
  const thIn = armAngleForRadius(HDD.TRACK_MIN - 0.1);
  const thOut = armAngleForRadius(HDD.PARK_R + 0.1);
  {
    const psi0 = Math.min(-thIn, -thOut) - 0.62, psi1 = Math.max(-thIn, -thOut) + 0.62;
    const s = new THREE.Shape();
    s.absarc(P.x, P.y, 2.75, psi0, psi1, false);
    s.absarc(P.x, P.y, 1.05, psi1, psi0, true);
    s.closePath();
    const yokeGeo = extrudeFlat(s, 0.2, { bevel: 0.02, curveSegs: 40 });
    const magGeo = extrudeFlat(s, 0.26, { curveSegs: 40 });
    mesh(yokeGeo, mats.yoke, 0, HDD.FLOOR, 0, base);
    mesh(magGeo, mats.magnet, 0, HDD.FLOOR + 0.2, 0, base);
    mesh(magGeo, mats.magnet, 0, 1.68, 0, base);
    const topYoke = mesh(yokeGeo, mats.yoke, 0, 1.94, 0, base);
    topYoke.name = 'vcmTopYoke';
    // 磁轭支柱
    const pa = (psi0 + psi1) / 2;
    [psi0 + 0.12, psi1 - 0.12].forEach(a => {
      mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.62, 20), mats.yoke, P.x + Math.cos(a) * 2.45, HDD.FLOOR + 0.2 + 0.81, P.y + Math.sin(a) * 2.45, base);
    });
    void pa;
  }

  /* ---------------- 磁头组件(随音圈电机摆动) ---------------- */
  const actuator = new THREE.Group();
  actuator.position.set(P.x, 0, P.y);
  root.add(actuator);
  // 轴承筒
  mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.0, 40), mats.hub, 0, HDD.FLOOR + 1.0, 0, root).position.set(P.x, HDD.FLOOR + 1.0, P.y);
  mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.14, 6), mats.screw, 0, HDD.FLOOR + 2.07, 0, root).position.set(P.x, HDD.FLOOR + 2.07, P.y);
  // E 型块主体
  const eShape = new THREE.Shape();
  eShape.moveTo(0.95, -0.55);
  eShape.lineTo(0.95, 0.55);
  eShape.absarc(0, 0, 0.75, Math.PI * 0.2, Math.PI * 1.8, false);
  eShape.closePath();
  eShape.holes.push(new THREE.Path().absarc(0, 0, 0.52, 0, Math.PI * 2, true));
  mesh(extrudeFlat(eShape, HDD.ARM_Y[3] - HDD.ARM_Y[0] + 0.09, { bevel: 0.02 }), mats.arm, 0, HDD.ARM_Y[0] - 0.045, 0, actuator);

  // 臂:锥形,带减重孔
  const armShape = new THREE.Shape();
  armShape.moveTo(0.1, -0.72);
  armShape.lineTo(-0.9, -0.66);
  armShape.quadraticCurveTo(-2.6, -0.34, -3.45, -0.22);
  armShape.quadraticCurveTo(-3.7, 0, -3.45, 0.22);
  armShape.quadraticCurveTo(-2.6, 0.34, -0.9, 0.66);
  armShape.lineTo(0.1, 0.72);
  armShape.closePath();
  const hole1 = new THREE.Path();
  hole1.moveTo(-1.0, -0.36); hole1.lineTo(-2.55, -0.15); hole1.quadraticCurveTo(-2.68, 0, -2.55, 0.15); hole1.lineTo(-1.0, 0.36); hole1.quadraticCurveTo(-0.86, 0, -1.0, -0.36);
  armShape.holes.push(hole1);
  armShape.holes.push(new THREE.Path().absarc(-3.15, 0, 0.09, 0, Math.PI * 2, true));
  const armGeo = extrudeFlat(armShape, 0.09, { bevel: 0.008, curveSegs: 16 });
  const traceGeo = new THREE.BoxGeometry(2.8, 0.012, 0.07);

  const heads = [];
  const sliderGeo = new RoundedBoxGeometry(0.125, 0.03, 0.1, 1, 0.006);
  HDD.ARM_Y.forEach((ay, ai) => {
    const arm = mesh(armGeo, mats.arm, 0, ay - 0.045, 0, actuator);
    arm.name = 'arm' + ai;
    // 沿臂的柔性走线
    const tr = mesh(traceGeo, mats.flex, -1.9, ay + 0.051, 0.36, actuator);
    tr.rotation.y = -0.08;
    // 每个臂服务上方和/或下方的盘面
    const surfaces = [];
    const below = HDD.PLATTER_Y.find(y => Math.abs((y + HDD.T / 2) - (ay - 0.146)) < 0.1);
    const above = HDD.PLATTER_Y.find(y => Math.abs((y - HDD.T / 2) - (ay + 0.146)) < 0.1);
    if (below !== undefined) surfaces.push({ y: below + HDD.T / 2, dir: -1, platter: HDD.PLATTER_Y.indexOf(below), side: 'top' });
    if (above !== undefined) surfaces.push({ y: above - HDD.T / 2, dir: 1, platter: HDD.PLATTER_Y.indexOf(above), side: 'bottom' });
    surfaces.forEach(sf => {
      const h = buildSuspension(ay, sf, mats, sliderGeo);
      actuator.add(h.group);
      heads.push({ ...h, surface: sf });
    });
  });

  // 音圈(铜线圈 + 黑色包塑)
  const coilShape = new THREE.Shape();
  coilShape.moveTo(0.85, -0.95);
  coilShape.lineTo(2.65, -1.32);
  coilShape.quadraticCurveTo(2.85, 0, 2.65, 1.32);
  coilShape.lineTo(0.85, 0.95);
  coilShape.closePath();
  const coilHole = new THREE.Path();
  coilHole.moveTo(1.2, -0.55);
  coilHole.lineTo(2.3, -0.8);
  coilHole.quadraticCurveTo(2.42, 0, 2.3, 0.8);
  coilHole.lineTo(1.2, 0.55);
  coilHole.closePath();
  coilShape.holes.push(coilHole);
  const coilGeo = extrudeFlat(coilShape, 0.24, { bevel: 0.03, curveSegs: 20 });
  planarUV(coilGeo, 'x', 'z');
  const coilY = (1.68 + HDD.FLOOR + 0.46) / 2;
  mesh(coilGeo, mats.coil, 0, coilY - 0.12, 0, actuator);
  const moldShape = new THREE.Shape();
  moldShape.moveTo(0.6, -0.75); moldShape.lineTo(1.0, -1.0); moldShape.lineTo(1.0, 1.0); moldShape.lineTo(0.6, 0.75); moldShape.closePath();
  mesh(extrudeFlat(moldShape, 0.3, { bevel: 0.02 }), mats.overmold, 0, coilY - 0.15, 0, actuator);
  // 前置放大芯片(贴在 E 块侧面的柔性板上)
  const preampTex = chipTexture(['PREAMP'], { w: 256, h: 256 });
  const preamp = mesh(new THREE.BoxGeometry(0.5, 0.42, 0.05), M.chipMaterials(preampTex).frontZ, 0.15, 1.3, -0.8, actuator);
  preamp.rotation.y = Math.PI;

  /* ---------------- 柔性排线(随臂角度实时形变) ---------------- */
  const bracket = new THREE.Vector3(6.3, 1.25, -0.6);
  mesh(new THREE.BoxGeometry(0.35, 1.3, 1.1), mats.overmold, bracket.x + 0.2, HDD.FLOOR + 0.75, bracket.z, base);
  const flexPts = () => {
    const a = new THREE.Vector3(0.15, 1.25, -0.82).applyAxisAngle(new THREE.Vector3(0, 1, 0), actuator.rotation.y).add(actuator.position);
    const dirA = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), actuator.rotation.y);
    const p1 = a.clone().addScaledVector(dirA, 0.7);
    const end = bracket.clone();
    const p2 = end.clone().add(new THREE.Vector3(-0.9, 0, -0.7));
    const mid = p1.clone().lerp(p2, 0.5).add(new THREE.Vector3(0.25, 0, -0.55));
    const curve = new THREE.CatmullRomCurve3([a, p1, mid, p2, end]);
    return curve.getPoints(48);
  };
  const flexGeo = ribbonGeometry(flexPts(), 0.62, 0.012, { widthAlongUp: true });
  const flex = mesh(flexGeo, mats.flex, 0, 0, 0, root);
  flex.castShadow = false;

  /* ---------------- 停泊坡道 ---------------- */
  {
    const th = armAngleForRadius(HDD.PARK_R);
    const tip = new THREE.Vector3(-HDD.ARM - 0.22, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), th);
    const tipW = new THREE.Vector2(P.x + tip.x, P.y + tip.z);
    const radial = tipW.clone().sub(C).normalize();
    const tangent = new THREE.Vector2(-radial.y, radial.x);
    const ramp = new THREE.Group();
    const center = C.clone().addScaledVector(radial, HDD.R_OUT + 0.42);
    ramp.position.set(center.x, 0, center.y);
    ramp.rotation.y = -Math.atan2(tangent.y, tangent.x);
    mesh(new THREE.BoxGeometry(0.9, 1.75, 0.5), mats.ramp, 0, HDD.FLOOR + 0.875, -0.2, ramp);
    // 每层磁头的坡道指
    HDD.ARM_Y.forEach(ay => {
      const f = mesh(new THREE.BoxGeometry(0.85, 0.05, 0.55), mats.ramp, 0, ay, 0.15, ramp);
      f.rotation.x = 0.0;
    });
    root.add(ramp);
  }

  // 空气循环过滤器
  mesh(new THREE.BoxGeometry(0.16, 1.3, 1.2), mats.filter, -L / 2 + 0.6, HDD.FLOOR + 0.8, 3.9, base);

  /* ---------------- 顶盖 ---------------- */
  const coverGroup = new THREE.Group();
  root.add(coverGroup);
  const coverShape = rrectShape(L, W, 0.35);
  const coverMesh = mesh(extrudeFlat(coverShape, 0.08, { bevel: 0.01 }), mats.cover, 0, H - 0.08, 0, coverGroup);
  planarUV(coverMesh.geometry, 'x', 'z');
  // 顶盖上的冲压凸台
  const boss = new THREE.Shape();
  boss.absarc(C.x, 0, 4.6, 0, Math.PI * 2, false);
  const bossMesh = mesh(extrudeFlat(boss, 0.03, { bevel: 0.03, bevelSegs: 3, curveSegs: 64 }), mats.cover, 0, H - 0.03, 0, coverGroup);
  void bossMesh;
  if (label) {
    const tex = stickerTexture({
      title: 'STORAGE LAB', accent: '#1f4e8c',
      lines: ['HDD 3.5" 7200 RPM', '容量 8 TB · SATA 6 Gb/s · 256 MB Cache', 'Model: SL-8000HDD  S/N: SL7K2Z0491', '请勿打开 · 无尘环境组装'],
    });
    const lbl = mesh(new THREE.PlaneGeometry(7.4, 5.4), M.sticker(tex), 0.9, H + 0.003, 0, coverGroup);
    lbl.rotation.x = -Math.PI / 2;
    lbl.position.set(-2.25, H + 0.034, 0);
    lbl.castShadow = false;
  }
  // 顶盖螺丝
  const cs = screwPos.map(([x, z]) => ({ x, y: H + 0.02, z }));
  cs.push({ x: C.x, y: H + 0.03, z: C.y }, { x: P.x, y: H + 0.03, z: P.y });
  coverGroup.add(instanced(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 20), mats.screw, cs));
  coverGroup.add(instanced(new THREE.CylinderGeometry(0.07, 0.07, 0.065, 6), mats.hole, cs.map(t => ({ ...t, y: t.y + 0.003 }))));
  coverGroup.visible = cover;
  // 无顶盖时露出底座螺丝孔
  base.add(instanced(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 16), mats.hole, screwPos.map(([x, z]) => ({ x, y: HDD.FLOOR + wallH + 0.017, z }))));

  /* ---------------- 底部电路板与 SATA 接口 ---------------- */
  if (pcbBottom) {
    const pcbTex = canvasTex(1024, 704, (ctx, w, h) => {
      pcbBase(ctx, w, h, { mask: '#0f3d27', seed: 5, traces: 90 });
      silk(ctx, 'SL-8000 MAIN PCB  REV C', w * 0.05, h * 0.92, 22);
    });
    const pcbMat = M.pcb(pcbTex);
    const pcbGeo = new THREE.BoxGeometry(L - 1.2, 0.14, W - 0.8);
    const pcbMesh = mesh(pcbGeo, [M.fr4(), M.fr4(), pcbMat, pcbMat, M.fr4(), M.fr4()], 0.4, -0.07, 0, root);
    void pcbMesh;
    // SATA 接口(数据 7 针 + 电源 15 针)
    const conn = new THREE.Group();
    conn.position.set(L / 2 + 0.05, 0.12, -1.4);
    const cmat = M.plastic(0x101114, 0.45);
    mesh(new THREE.BoxGeometry(0.55, 0.62, 3.3), cmat, 0, 0, 0, conn);
    const slot = M.plastic(0x050506, 0.9);
    mesh(new THREE.BoxGeometry(0.1, 0.22, 0.85), slot, 0.24, 0.05, -1.05, conn);
    mesh(new THREE.BoxGeometry(0.1, 0.22, 1.6), slot, 0.24, 0.05, 0.6, conn);
    const pinsD = [], pinsP = [];
    for (let i = 0; i < 7; i++) pinsD.push({ x: 0.25, y: 0.09, z: -1.4 + i * 0.12 });
    for (let i = 0; i < 15; i++) pinsP.push({ x: 0.25, y: 0.09, z: -0.12 + i * 0.105 });
    conn.add(instanced(new THREE.BoxGeometry(0.06, 0.02, 0.05), M.gold(), [...pinsD, ...pinsP]));
    root.add(conn);
    root.userData.sataPort = conn;
  }

  /* ---------------- 运行时接口 ---------------- */
  const api = {
    group: root,
    platterGroup,
    platters,
    actuator,
    heads,
    coverGroup,
    mats,
    servo,
    setArmAngle(theta) {
      actuator.rotation.y = theta;
      updateRibbon(flexGeo, flexPts());
    },
    /** 磁头(滑块)在 root 局部坐标中的位置 */
    headWorld(headIndex = heads.length - 1, out = new THREE.Vector3()) {
      const h = heads[headIndex];
      h.slider.getWorldPosition(out);
      return root.worldToLocal(out);
    },
  };
  api.setArmAngle(armAngleForRadius(HDD.PARK_R));
  return api;
}

/** 悬臂(不锈钢负载梁)+ 滑块 */
function buildSuspension(armY, surface, mats, sliderGeo) {
  const g = new THREE.Group();
  const startX = -3.3, endX = -HDD.ARM - 0.25;
  const len = startX - endX;
  const sliderY = surface.y + surface.dir * -0.018;
  const beamEndY = sliderY + surface.dir * -0.03;
  const dy = beamEndY - armY;
  const s = new THREE.Shape();
  s.moveTo(0, -0.24);
  s.lineTo(-len * 0.82, -0.075);
  s.lineTo(-len, -0.03);
  s.lineTo(-len, 0.03);
  s.lineTo(-len * 0.82, 0.075);
  s.lineTo(0, 0.24);
  s.closePath();
  s.holes.push(new THREE.Path().absarc(-len * 0.25, 0, 0.06, 0, Math.PI * 2, true));
  const beam = new THREE.Mesh(extrudeFlat(s, 0.022, { curveSegs: 8 }), mats.susp);
  beam.castShadow = true;
  beam.receiveShadow = true;
  const pivotG = new THREE.Group();
  pivotG.position.set(startX, armY - 0.011, 0);
  pivotG.rotation.z = Math.asin(THREE.MathUtils.clamp(-dy / len, -1, 1));
  pivotG.add(beam);
  // 侧边加强折边
  [-1, 1].forEach(side => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len * 0.78, 0.05, 0.012), mats.susp);
    rail.position.set(-len * 0.4, 0.025 * -surface.dir + 0.011, side * 0.155);
    rail.rotation.y = side * 0.1;
    pivotG.add(rail);
  });
  g.add(pivotG);
  // 底座板(swage plate)
  const swage = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 0.5), mats.susp);
  swage.position.set(startX + 0.05, armY + surface.dir * 0.06, 0);
  g.add(swage);
  // 滑块
  const slider = new THREE.Mesh(sliderGeo, mats.slider);
  slider.position.set(-HDD.ARM, sliderY, 0);
  slider.castShadow = true;
  g.add(slider);
  return { group: g, slider };
}

/** 伺服扇区:沿磁头运动弧线分布的细辐条 */
function buildServoWedges() {
  const N = 60;
  const pts = [];
  const base = [];
  const v = new THREE.Vector2();
  for (let i = 0; i <= 24; i++) {
    const r = HDD.R_IN + 0.35 + (HDD.R_OUT - HDD.R_IN - 0.4) * (i / 24);
    const th = armAngleForRadius(Math.max(r, 1.5));
    headPos(th, v);
    const rel = v.clone().sub(HDD.C);
    const s = rel.length();
    const scale = r / s;
    base.push(new THREE.Vector2(rel.x * scale, rel.y * scale));
  }
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < base.length - 1; i++) {
      const p = base[i], q = base[i + 1];
      pts.push(p.x * c - p.y * s, 0, p.x * s + p.y * c);
      pts.push(q.x * c - q.y * s, 0, q.x * s + q.y * c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x8890a0, transparent: true, opacity: 0.12, depthWrite: false }));
  return lines;
}
