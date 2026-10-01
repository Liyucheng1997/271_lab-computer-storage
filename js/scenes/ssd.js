import * as THREE from 'three';
import { Tweens, makeElectron, lerp } from '../utils.js';
import { setupStage } from '../lib/stage.js';
import { LabelSet } from '../lib/labels.js';
import * as M from '../lib/materials.js';
import { mesh, extrudeFlat, halfShell, instanced } from '../lib/geom.js';
import { canvasTex, pcbBase, silk } from '../lib/textures.js';
import { buildM2Ssd, buildM2Socket, M2 } from '../models/m2ssd.js';

/**
 * 固态硬盘 SSD:
 *  工位 A —— M.2 2280 NVMe 固态硬盘插在主板上
 *  工位 B —— 3D NAND 堆叠结构剖面(垂直沟道穿过多层字线 + 台阶状字线接触)
 *  工位 C —— 单个电荷捕获 (Charge Trap) 存储单元的放大剖面
 */
const A_X = -30, B_X = 0, C_X = 22;

// 工位 B 尺寸
const HOLES = 5, ROWS = 3, PITCH = 1.3;
const NL = 8;                         // 导电层:SGS, WL0..WL5, SGD
const TC = 0.36, TO = 0.2;            // 导电层 / 氧化层厚度
const SY0 = 1.0;                      // 堆叠底面
const R_CORE = 0.14, R_CH = 0.24, R_TUN = 0.29, R_NIT = 0.4, R_BLK = 0.48;
const layerY = i => SY0 + TO + i * (TC + TO);           // 第 i 导电层底面
const STACK_TOP = SY0 + NL * (TC + TO) + TO;
const N_WL = 6;

// 工位 C 尺寸(放大的单元)
const CR = { core: 0.7, ch: 1.15, tun: 1.38, nit: 1.95, blk: 2.25 };
const C_TO = 0.75, C_TW = 1.25, C_Y0 = 0.6;
const cLayerY = i => C_Y0 + C_TO + i * (C_TW + C_TO);   // 第 i 字线底面
const C_TOP = C_Y0 + 3 * (C_TW + C_TO) + C_TO;

export class SsdScene {
  constructor({ camera, controls, ui, env }) {
    this.scene = new THREE.Scene();
    this.ui = ui;
    this.camera = camera;
    this.tweens = new Tweens();
    this.labels = new LabelSet();
    this.bloom = { strength: 0.7, radius: 0.45 };
    this.time = 0;
    this.busy = false;
    this.pe = 0;                       // 擦写次数
    this.cellProgrammed = false;
    this.pages = Array.from({ length: N_WL * ROWS }, () => 'free');

    this.stage = setupStage(this.scene, env, {
      shadowBox: 34, shadowCenter: [-4, 0, 0], mapSize: 4096, keyPos: [10, 30, 20], floorRadius: 90,
    });

    this.buildModule();
    this.buildStack();
    this.buildCell();

    this.views = [
      { label: 'M.2 固态硬盘', pos: [A_X + 4, 13, 14], target: [A_X, 0.6, 0] },
      { label: '3D NAND 堆叠', pos: [B_X + 6.5, 10.5, 14.5], target: [B_X - 1.2, 2.8, -1.2] },
      { label: '单元剖面', pos: [C_X + 3.5, 8.5, 17.5], target: [C_X, 3.8, 0] },
    ];
    ui.setViews(this.views, 1);
    camera.position.set(...this.views[1].pos);
    controls.target.set(...this.views[1].target);
    controls.minDistance = 2;
    controls.maxDistance = 100;

    ui.setInfo('固态硬盘 SSD (3D NAND 闪存) 的工作原理', `
      <p>SSD 没有任何机械部件:主控芯片 + 若干颗 <b>NAND 闪存</b>芯片 + DRAM 缓存。数据存在闪存单元里:</p>
      <p>· <b>写入(编程)</b>:字线加约 <b>20 V</b> 高压,电子借<b>量子隧穿</b>穿过几纳米厚的隧穿氧化层,被<b>氮化硅电荷捕获层</b>(老式为"浮栅")困住<br>
      · 捕获层四周都是绝缘体,电子<b>断电也跑不掉</b>,可保存数年 —— 非易失性的来源<br>
      · <b>读取</b>:被困电子提高了晶体管的<b>阈值电压</b>,施加参考电压看沟道是否导通,即可判断 0/1<br>
      · <b>擦除</b>:衬底加高压,把电子从捕获层拉出</p>
      <p>现代 NAND 是 <b>3D 堆叠</b>的:200 多层字线叠在一起,圆柱形沟道垂直贯穿,每个"沟道 × 字线"交点就是一个单元。</p>
      <p>⚠️ 闪存<b>按页写入(~16 KB),按块擦除(数 MB)</b>,不能原地覆盖 → 主控用 <b>FTL</b> 做"异地更新"和<b>垃圾回收</b>;高压隧穿会逐渐损伤氧化层,TLC 单元只能擦写约 <b>3000 次</b>。</p>
    `);

    ui.setActions([
      { label: '⚡ 单元:编程(电子隧穿)', onClick: () => this.program() },
      { label: '🔍 单元:读取(阈值电压)', onClick: () => this.readCell() },
      { label: '🧹 单元:擦除', onClick: () => this.eraseCell() },
      { label: '🔌 单元:断电保持', onClick: () => this.powerOff() },
      { label: '📄 写入一页', onClick: () => this.writePage() },
      { label: '✏️ 修改数据(异地更新)', onClick: () => this.updatePage() },
      { label: '🧱 垃圾回收 + 块擦除', onClick: () => this.gcErase() },
    ]);
    this.updateHud();
  }

  /* ================================================================ */
  /*  工位 A:M.2 SSD                                                  */
  /* ================================================================ */
  buildModule() {
    const g = new THREE.Group();
    g.position.set(A_X, 0, 0);
    this.scene.add(g);
    const S = 2;                       // 放大 2 倍便于观察
    const tex = canvasTex(1024, 512, (ctx, w, h) => {
      pcbBase(ctx, w, h, { mask: '#15171c', seed: 12, traceColor: 'rgba(160,170,190,0.10)', traces: 130 });
      silk(ctx, 'M.2_1 (CPU)  PCIe 4.0 x4', 40, 470, 22);
    });
    const pm = M.pcb(tex, { bump: 0.5 });
    mesh(new THREE.BoxGeometry(22, 0.16, 10), [M.fr4(), M.fr4(), pm, pm, M.fr4(), M.fr4()], 0, 0.08, 0, g);
    const sock = buildM2Socket();
    sock.scale.setScalar(S);
    sock.position.set(-M2.L * S / 2 - 0.35, 0.16, 0);
    g.add(sock);
    const ssd = buildM2Ssd();
    ssd.group.scale.setScalar(S);
    ssd.group.position.set(0, 0.16 + 0.42, 0);
    g.add(ssd.group);
    // 铜螺柱 + 螺丝
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a85a, metalness: 1, roughness: 0.3 });
    mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.42, 6), brass, M2.L * S / 2, 0.37, 0, g);
    mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.12, 24), new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 1, roughness: 0.3 }), M2.L * S / 2, 0.16 + 0.42 + 0.16 + 0.06, 0, g);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    const L = this.labels, V = (x, y, z) => new THREE.Vector3(x, y, z), D = 32;
    const y = 0.58 + M2.T * S;
    const P = ssd.parts;
    L.callout(g, '主控芯片', V(P.ctrl.x * S, y + 0.2, 0), V(-1.0, 2.8, 1.4), { cls: 'cyan', sub: 'FTL 映射 / 磨损均衡 / ECC 纠错', maxDist: D });
    L.callout(g, 'DRAM 缓存', V(P.dram.x * S, y + 0.16, 0.5), V(0.2, 2.4, 2.6), { sub: '存放逻辑→物理地址映射表', maxDist: D });
    L.callout(g, 'NAND 闪存 ×2', V(P.nand1.x * S, y + 0.26, -0.6), V(1.4, 3.0, -1.8), { cls: 'gold', sub: '每颗 512 GB · 232 层 3D TLC', maxDist: D });
    L.callout(g, 'M.2 插座 (M-Key)', V(-M2.L * S / 2 - 0.4, 0.9, -2.2), V(-1.6, 1.6, -1.4), { sub: 'PCIe 4.0 ×4 ≈ 8 GB/s', maxDist: D });
    L.callout(g, '固定螺丝', V(M2.L * S / 2, 0.9, 0), V(1.6, 1.6, 0.8), { maxDist: D });
    L.text(g, '工位 A · M.2 2280 NVMe 固态硬盘(放大 2 倍)', V(0, 7.0, -3), { cls: 'title', maxDist: 46 });
  }

  /* ================================================================ */
  /*  工位 B:3D NAND 堆叠剖面                                        */
  /* ================================================================ */
  holeX(c) { return (c - (HOLES - 1) / 2) * PITCH; }
  rowZ(s) { return -s * PITCH; }

  buildStack() {
    const g = new THREE.Group();
    g.position.set(B_X, 0, 0);
    this.scene.add(g);
    const xR = 3.6, zBack = -(ROWS - 1) * PITCH - 0.95;
    const leftOf = i => -3.6 - (NL - 1 - i) * 0.62;   // 越下层越长 → 台阶

    // 衬底 + 公共源线
    mesh(new THREE.BoxGeometry(xR - leftOf(0) + 1.2, SY0, -zBack + 0.6), M.silicon(0x3a404c), (xR + leftOf(0)) / 2, SY0 / 2, zBack / 2 + 0.1, g);
    mesh(new THREE.BoxGeometry(xR - leftOf(0) + 0.4, 0.08, -zBack), new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.8, roughness: 0.35 }), (xR + leftOf(0)) / 2, SY0 - 0.02, zBack / 2, g);

    const layerShape = (left) => {
      const s = new THREE.Shape();
      s.moveTo(left, zBack);
      s.lineTo(xR, zBack);
      s.lineTo(xR, 0);
      for (let c = HOLES - 1; c >= 0; c--) {
        const cx = this.holeX(c);
        s.lineTo(cx + R_BLK, 0);
        s.absarc(cx, 0, R_BLK, 0, -Math.PI, true);
      }
      s.lineTo(left, 0);
      s.closePath();
      for (let r = 1; r < ROWS; r++) for (let c = 0; c < HOLES; c++) {
        s.holes.push(new THREE.Path().absarc(this.holeX(c), this.rowZ(r), R_BLK, 0, Math.PI * 2, true));
      }
      return s;
    };

    const ox = M.oxide(0xcfe3f5, 0.38);
    const contactMat = new THREE.MeshStandardMaterial({ color: 0xb0b6c0, metalness: 1, roughness: 0.25 });
    const copperMat = new THREE.MeshStandardMaterial({ color: 0xc58b52, metalness: 1, roughness: 0.3 });
    this.layers = [];
    for (let i = 0; i < NL; i++) {
      const left = leftOf(i);
      mesh(extrudeFlat(layerShape(left), TO, { curveSegs: 20 }), ox, 0, layerY(i) - TO, 0, g).castShadow = false;
      const mat = new THREE.MeshStandardMaterial({ color: 0x8f97a3, metalness: 0.95, roughness: 0.32, emissive: 0xffa040, emissiveIntensity: 0 });
      const m = mesh(extrudeFlat(layerShape(left), TC, { curveSegs: 20 }), mat, 0, layerY(i), 0, g);
      this.layers.push({ mesh: m, mat, left });
      // 台阶接触柱 + 顶部金属走线
      const cx = left + 0.32;
      const h = STACK_TOP + 0.5 - layerY(i) - TC;
      mesh(new THREE.CylinderGeometry(0.11, 0.11, h, 12), contactMat, cx, layerY(i) + TC + h / 2, zBack / 2, g);
      mesh(new THREE.BoxGeometry(0.22, 0.1, 1.2), copperMat, cx, STACK_TOP + 0.55, zBack / 2 + 0.5, g);
    }
    mesh(extrudeFlat(layerShape(leftOf(NL - 1)), TO, { curveSegs: 20 }), ox, 0, STACK_TOP - TO, 0, g).castShadow = false;

    // 垂直沟道:前排为剖开的半圆柱,可看到同心结构
    const H = STACK_TOP - SY0 + 0.3;
    const yc = SY0 + H / 2;
    const shells = [
      { r0: 0, r1: R_CORE, mat: new THREE.MeshStandardMaterial({ color: 0xe8eef5, roughness: 0.3 }) },                    // 核心氧化物
      { r0: R_CORE, r1: R_CH, mat: new THREE.MeshStandardMaterial({ color: 0x6c5a7a, roughness: 0.4, metalness: 0.3 }) },  // 多晶硅沟道
      { r0: R_CH, r1: R_TUN, mat: new THREE.MeshStandardMaterial({ color: 0xbfe0ff, roughness: 0.2 }) },                  // 隧穿氧化层
      { r0: R_TUN, r1: R_NIT, mat: new THREE.MeshStandardMaterial({ color: 0x9c7a3c, roughness: 0.35, metalness: 0.2 }) }, // 氮化硅
      { r0: R_NIT, r1: R_BLK, mat: new THREE.MeshStandardMaterial({ color: 0xd8e6f2, roughness: 0.25 }) },                // 阻挡氧化层
    ];
    const backCyl = new THREE.CylinderGeometry(R_BLK, R_BLK, H, 28);
    for (let c = 0; c < HOLES; c++) {
      shells.forEach(sh => mesh(halfShell(sh.r0, sh.r1, H, { seg: 40 }), sh.mat, this.holeX(c), yc, 0, g));
      for (let r = 1; r < ROWS; r++) mesh(backCyl, shells[3].mat, this.holeX(c), yc, this.rowZ(r), g);
    }
    // 沟道顶部插塞 + 位线
    const plugs = [];
    for (let c = 0; c < HOLES; c++) for (let r = 1; r < ROWS; r++) plugs.push({ x: this.holeX(c), y: STACK_TOP + 0.3, z: this.rowZ(r) });
    g.add(instanced(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 14), contactMat, plugs));
    this.bitlines = [];
    for (let c = 0; c < HOLES; c++) {
      const m = mesh(new THREE.BoxGeometry(0.2, 0.12, -zBack + 0.3), new THREE.MeshStandardMaterial({ color: 0xc58b52, metalness: 1, roughness: 0.3, emissive: 0xffc04a, emissiveIntensity: 0 }),
        this.holeX(c), STACK_TOP + 0.6, zBack / 2 - 0.1, g);
      this.bitlines.push(m);
    }

    // 剖面上的单元标记(前排沟道 × 字线 WL0..5)
    this.cellMarks = [];
    const markGeo = new THREE.PlaneGeometry(R_NIT - R_TUN - 0.02, TC * 0.9);
    for (let k = 0; k < N_WL; k++) {
      const row = [];
      const y = layerY(k + 1) + TC / 2;
      for (let c = 0; c < HOLES; c++) {
        const mat = new THREE.MeshBasicMaterial({ color: 0x2a2416 });
        for (const side of [-1, 1]) {
          const p = new THREE.Mesh(markGeo, mat);
          p.position.set(this.holeX(c) + side * (R_TUN + R_NIT) / 2, y, 0.004);
          g.add(p);
        }
        row.push({ mat, programmed: false });
      }
      this.cellMarks.push(row);
    }

    // 编程用电子
    this.stackElectrons = [];
    for (let i = 0; i < 12; i++) {
      const e = makeElectron(0.05, 0xffd479, 9);
      e.visible = false;
      g.add(e);
      this.stackElectrons.push(e);
    }

    const L = this.labels, V = (x, y, z) => new THREE.Vector3(x, y, z), D = 30;
    const names = ['SGS 源极选择栅', 'WL0', 'WL1', 'WL2', 'WL3', 'WL4', 'WL5', 'SGD 漏极选择栅'];
    names.forEach((n, i) => {
      L.text(g, n, V(xR + 0.9, layerY(i) + TC / 2, 0.1), { cls: i === 0 || i === NL - 1 ? '' : 'violet', maxDist: D });
    });
    L.callout(g, '垂直沟道孔', V(this.holeX(1), STACK_TOP + 0.1, -0.2), V(-1.0, 2.6, 1.2), { cls: 'cyan', sub: '贯穿所有字线 · 一串单元 = 一个"NAND 串"', maxDist: D });
    L.callout(g, '台阶结构', V(leftOf(1) + 0.3, layerY(1) + TC, zBack / 2), V(-1.6, 3.0, 1.6), { sub: '每层字线各自引出接触柱', maxDist: D });
    L.callout(g, '位线', V(this.holeX(4), STACK_TOP + 0.66, zBack / 2), V(2.2, 1.6, -0.8), { cls: 'gold', maxDist: D });
    L.callout(g, '公共源线', V(leftOf(0) + 1.0, SY0, 0.2), V(-1.2, -0.8, 2.2), { maxDist: D });
    L.callout(g, '电荷捕获层 (Si₃N₄)', V(this.holeX(0) - (R_TUN + R_NIT) / 2, layerY(3) + TC / 2, 0.01), V(-2.6, -1.6, 2.6), { cls: 'gold', sub: '亮 = 已捕获电子 (编程)', maxDist: D });
    L.text(g, '工位 B · 3D NAND 堆叠剖面(真实芯片 200+ 层)', V(-1.5, STACK_TOP + 2.4, -1.2), { cls: 'title', maxDist: 46 });
  }

  /* ================================================================ */
  /*  工位 C:单个电荷捕获单元                                        */
  /* ================================================================ */
  buildCell() {
    const g = new THREE.Group();
    g.position.set(C_X, 0, 0);
    this.scene.add(g);
    const half = 4.6, depth = 4.2;
    mesh(new THREE.BoxGeometry(half * 2, C_Y0, depth), M.silicon(0x3a404c), 0, C_Y0 / 2, -depth / 2, g);

    const slab = (h) => {
      const s = new THREE.Shape();
      s.moveTo(-half, -depth);
      s.lineTo(half, -depth);
      s.lineTo(half, 0);
      s.lineTo(CR.blk, 0);
      s.absarc(0, 0, CR.blk, 0, -Math.PI, true);
      s.lineTo(-half, 0);
      s.closePath();
      return extrudeFlat(s, h, { curveSegs: 40 });
    };
    const ox = M.oxide(0xcfe3f5, 0.45);
    this.cellGates = [];
    for (let i = 0; i < 3; i++) {
      mesh(slab(C_TO), ox, 0, cLayerY(i) - C_TO, 0, g).castShadow = false;
      const mat = new THREE.MeshStandardMaterial({ color: 0x8f97a3, metalness: 0.95, roughness: 0.3, emissive: 0xffa040, emissiveIntensity: 0 });
      mesh(slab(C_TW), mat, 0, cLayerY(i), 0, g);
      this.cellGates.push(mat);
    }
    mesh(slab(C_TO), ox, 0, C_TOP - C_TO, 0, g).castShadow = false;

    const H = C_TOP - C_Y0, yc = C_Y0 + H / 2;
    const layers = [
      [0, CR.core, 0xe8eef5],
      [CR.core, CR.ch, 0x6c5a7a],
      [CR.ch, CR.tun, 0xbfe0ff],
      [CR.tun, CR.nit, 0x9c7a3c],
      [CR.nit, CR.blk, 0xd8e6f2],
    ];
    layers.forEach(([r0, r1, col]) => {
      const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.3, metalness: col === 0x6c5a7a ? 0.3 : 0.05, emissive: 0x66ccff, emissiveIntensity: 0 });
      mesh(halfShell(r0, r1, H, { seg: 64 }), mat, 0, yc, 0, g);
      if (r0 === CR.ch) this.tunnelMat = mat;
    });

    // 沟道里的自由电子 + 捕获层中的电子
    this.chElectrons = [];
    for (let i = 0; i < 16; i++) {
      const e = makeElectron(0.09, 0x55ccff);
      const side = i % 2 ? 1 : -1;
      e.userData.home = new THREE.Vector3(side * lerp(CR.core + 0.12, CR.ch - 0.12, Math.random()), lerp(C_Y0 + 0.4, C_TOP - 0.4, (i + 0.5) / 16), 0.12);
      e.position.copy(e.userData.home);
      g.add(e);
      this.chElectrons.push(e);
    }
    this.trapped = [];
    const midY = cLayerY(1);
    for (let i = 0; i < 10; i++) {
      const e = makeElectron(0.09, 0xffd479);
      const side = i % 2 ? 1 : -1;
      e.userData.home = new THREE.Vector3(side * lerp(CR.tun + 0.12, CR.nit - 0.12, Math.random()), midY + 0.15 + (Math.floor(i / 2) / 4) * (C_TW - 0.3), 0.12);
      e.position.copy(e.userData.home);
      e.visible = false;
      g.add(e);
      this.trapped.push(e);
    }
    // 隧穿氧化层损伤点(随擦写次数增加)
    this.damage = [];
    const dGeo = new THREE.SphereGeometry(0.045, 8, 6), dMat = M.emissive(0xff4040, 5);
    for (let i = 0; i < 24; i++) {
      const d = new THREE.Mesh(dGeo, dMat);
      const side = i % 2 ? 1 : -1;
      d.position.set(side * lerp(CR.ch + 0.03, CR.tun - 0.03, Math.random()), lerp(C_Y0 + 0.5, C_TOP - 0.5, Math.random()), 0.06);
      d.visible = false;
      g.add(d);
      this.damage.push(d);
    }

    const L = this.labels, V = (x, y, z) => new THREE.Vector3(x, y, z), D = 26;
    const ly = C_TOP - 0.4;
    L.callout(g, '多晶硅沟道', V(-(CR.core + CR.ch) / 2, ly, 0.02), V(-2.6, 2.2, 1.4), { cls: 'cyan', sub: '电子在这里流动', maxDist: D });
    L.callout(g, '隧穿氧化层 (~5 nm)', V((CR.ch + CR.tun) / 2, ly - 0.6, 0.02), V(3.2, 2.6, 1.6), { sub: '高压下电子可"穿墙"而过', maxDist: D });
    L.callout(g, '电荷捕获层 Si₃N₄', V(-(CR.tun + CR.nit) / 2, cLayerY(1) + 0.2, 0.02), V(-3.6, 0.4, 2.2), { cls: 'gold', sub: '电子被困在这里 = 已编程', maxDist: D });
    L.callout(g, '阻挡氧化层', V((CR.nit + CR.blk) / 2, cLayerY(0) + 0.6, 0.02), V(3.0, -1.0, 2.0), { maxDist: D });
    L.callout(g, '字线(控制栅,钨)', V(3.6, cLayerY(1) + C_TW, -1), V(1.8, 1.8, 1.4), { cls: 'violet', sub: '中间这一层 = 本单元', maxDist: D });
    L.callout(g, '核心氧化物', V(0, C_TOP, -0.3), V(0.6, 1.6, 0.4), { maxDist: D });
    L.text(g, '工位 C · 电荷捕获型闪存单元(放大约 1000 万倍)', V(0, C_TOP + 2.6, -1), { cls: 'title', maxDist: 44 });
  }

  /* ================================================================ */
  /*  单元演示                                                         */
  /* ================================================================ */
  lock() { this.busy = true; this.ui.setButtonsEnabled(false); }
  unlock() { this.busy = false; this.ui.setButtonsEnabled(true); }

  async goView(i) {
    const v = this.views[i];
    if (this.camera.position.distanceTo(new THREE.Vector3(...v.target)) > 21) {
      this.ui.setActiveView(i);
      await this.ui.flyTo(v.pos, v.target, 1.6);
    }
  }

  gateGlow(i, v) { this.cellGates[i].emissiveIntensity = v; }

  async program() {
    if (this.busy) return;
    if (this.cellProgrammed) { this.ui.status('这个单元已经编程过了。闪存不能直接覆盖写 —— 先"擦除"再写'); return; }
    this.lock();
    await this.goView(2);
    this.ui.status('编程:中间字线加 <b>~20 V</b> 高压,其余字线加通过电压。强电场把沟道里的电子"拽"过隧穿氧化层 —— 量子隧穿 (F-N 隧穿)', 0);
    await this.tweens.to(0.6, t => { this.gateGlow(1, t * 1.6); this.gateGlow(0, t * 0.3); this.gateGlow(2, t * 0.3); });
    const midY = cLayerY(1) + C_TW / 2;
    const movers = this.chElectrons
      .filter(e => !e.userData.away)
      .sort((a, b) => Math.abs(a.userData.home.y - midY) - Math.abs(b.userData.home.y - midY))
      .slice(0, this.trapped.length);
    await Promise.all(movers.map((e, i) => {
      const target = this.trapped[i].userData.home;
      const from = e.position.clone();
      const mid = new THREE.Vector3(Math.sign(target.x) * (CR.ch - 0.05), target.y, 0.12);
      return this.tweens.to(1.2, t => {
        if (t < 0.5) e.position.lerpVectors(from, mid, t * 2);
        else e.position.lerpVectors(mid, target, (t - 0.5) * 2);
        if (t > 0.4 && t < 0.65) this.tunnelMat.emissiveIntensity = 1.2;
      }, { delay: 0.2 + i * 0.12 }).then(() => { e.visible = false; e.userData.away = true; this.trapped[i].visible = true; });
    }));
    this.tunnelMat.emissiveIntensity = 0;
    await this.tweens.to(0.5, t => { this.gateGlow(1, 1.6 * (1 - t)); this.gateGlow(0, 0.3 * (1 - t)); this.gateGlow(2, 0.3 * (1 - t)); });
    this.cellProgrammed = true;
    this.wear();
    this.ui.status('✅ 电子被困在氮化硅捕获层里!四周都是绝缘体,撤掉电压后它们也逃不出去 —— 这个单元现在存储的是 <b>0</b>(已编程)', 8000);
    this.updateHud();
    this.unlock();
  }

  async eraseCell() {
    if (this.busy) return;
    if (!this.cellProgrammed) { this.ui.status('捕获层里没有电子(已是擦除状态 = 1),先"编程"再试擦除'); return; }
    this.lock();
    await this.goView(2);
    this.ui.status('擦除:字线接地、衬底(沟道)加 <b>~20 V</b>,电场反向,电子被拉回沟道(同时有空穴注入中和)', 0);
    const back = this.chElectrons.filter(e => e.userData.away);
    await Promise.all(this.trapped.map((e, i) => {
      const from = e.userData.home.clone();
      const tgt = back[i] ? back[i].userData.home : from;
      return this.tweens.to(1.0, t => {
        e.position.lerpVectors(from, tgt, t);
        if (t > 0.3 && t < 0.6) this.tunnelMat.emissiveIntensity = 1.2;
      }, { delay: i * 0.08 }).then(() => {
        e.visible = false;
        e.position.copy(from);
        if (back[i]) { back[i].visible = true; back[i].userData.away = false; back[i].position.copy(back[i].userData.home); }
      });
    }));
    this.tunnelMat.emissiveIntensity = 0;
    this.cellProgrammed = false;
    this.pe++;
    this.wear();
    this.ui.status(`✅ 擦除完成,单元恢复为 <b>1</b>。擦写次数 ${this.pe}。每次高压隧穿都会在氧化层里留下缺陷(红点),这就是闪存寿命有限的原因`, 8000);
    this.updateHud();
    this.unlock();
  }

  wear() {
    const n = Math.min(this.damage.length, Math.floor(this.pe * 1.5));
    this.damage.forEach((d, i) => { d.visible = i < n; });
  }

  async readCell() {
    if (this.busy) return;
    this.lock();
    await this.goView(2);
    this.ui.status('读取:上下字线加"通过电压"(无论存什么都导通),本单元字线加<b>参考电压</b>,再看整串是否有电流', 0);
    await this.tweens.to(0.5, t => { this.gateGlow(0, t * 0.6); this.gateGlow(2, t * 0.6); this.gateGlow(1, t * 0.35); });
    const midY0 = cLayerY(1);
    const free = this.chElectrons.filter(e => !e.userData.away);
    this.ui.scope.show('NAND 串电流(感测放大器)', { min: -0.1, max: 1.1, len: 160 });
    const conduct = !this.cellProgrammed;
    const startY = free.map(e => e.position.y);
    const lo = C_Y0 + 0.4, hi = C_TOP - 0.4, span = hi - lo;
    await this.tweens.to(3.0, t => {
      free.forEach((e, i) => {
        let y = startY[i] + t * 6;
        if (conduct) y = lo + ((y - lo) % span + span) % span;
        else if (startY[i] < midY0) y = Math.min(y, midY0 - 0.15 - (i % 4) * 0.2);   // 停在本单元下方
        else y = Math.min(y, hi - (i % 3) * 0.15);
        e.position.y = y;
      });
      this.ui.scope.push(conduct ? Math.min(1, t * 4) * (0.95 + Math.random() * 0.05) : 0.03 + Math.random() * 0.02);
    }, { ease: x => x });
    free.forEach(e => {
      const from = e.position.clone();
      this.tweens.to(0.6, t => e.position.lerpVectors(from, e.userData.home, t));
    });
    await this.tweens.to(0.6, t => { this.gateGlow(0, 0.6 * (1 - t)); this.gateGlow(2, 0.6 * (1 - t)); this.gateGlow(1, 0.35 * (1 - t)); });
    this.ui.status(conduct
      ? '✅ 有电流 → 本单元阈值电压低(捕获层没有电子)→ 读出 <b>1</b>'
      : '✅ 无电流 → 被困电子屏蔽了栅极电场、抬高了阈值电压,参考电压打不开沟道 → 读出 <b>0</b>', 8000);
    await this.tweens.sleep(1.2);
    this.ui.scope.hide();
    this.unlock();
  }

  async powerOff() {
    if (this.busy) return;
    if (!this.cellProgrammed) { this.ui.status('先"编程"让捕获层存入电子,再演示断电效果'); return; }
    this.lock();
    await this.goView(2);
    const st = this.stage;
    const base = { k: st.key.intensity, r: st.rim.intensity, f: st.fill.intensity, h: st.hemi.intensity, e: this.scene.environmentIntensity };
    const dim = k => {
      st.key.intensity = base.k * k; st.rim.intensity = base.r * k; st.fill.intensity = base.f * k; st.hemi.intensity = base.h * k;
      this.scene.environmentIntensity = base.e * k;
    };
    this.ui.status('🔌 断电!SSD 完全失去供电……沟道里的自由电子散去', 0);
    await this.tweens.to(1.2, t => {
      dim(1 - t * 0.85);
      this.chElectrons.forEach(e => { if (!e.userData.away) e.scale.setScalar(Math.max(0.01, 1 - t)); });
    });
    this.ui.status('几年过去了……黄色电子仍被绝缘层牢牢困在捕获层里(高温会加速电子逃逸,所以 SSD 不宜长期断电高温存放)', 0);
    await this.tweens.sleep(3.0);
    await this.tweens.to(1.0, t => {
      dim(0.15 + t * 0.85);
      this.chElectrons.forEach(e => { if (!e.userData.away) e.scale.setScalar(Math.max(0.01, t)); });
    });
    this.ui.status('✅ 重新上电:被困电子一个没少,数据完好!对比 DRAM 断电即失,这就是闪存"非易失"的原因', 8000);
    this.unlock();
  }

  /* ================================================================ */
  /*  页 / 块 演示(FTL)                                             */
  /* ================================================================ */
  pageName(p) { return `WL${Math.floor(p / ROWS)}·串${p % ROWS}`; }

  async programPage(p) {
    const k = Math.floor(p / ROWS), s = p % ROWS;
    const layer = this.layers[k + 1];
    const bits = Array.from({ length: HOLES }, () => (Math.random() > 0.45 ? 0 : 1));
    this.pages[p] = 'busy';
    this.updateHud();
    this.bitlines.forEach((b, c) => { b.material.emissiveIntensity = bits[c] ? 0.9 : 0; });
    await this.tweens.to(0.5, t => { layer.mat.emissiveIntensity = t * 1.4; });
    if (s === 0) {
      // 前排可见:位线为 0 的单元,电子从沟道隧穿进捕获层
      const y = layerY(k + 1) + TC / 2;
      const jobs = [];
      bits.forEach((b, c) => {
        if (b) return;
        [-1, 1].forEach((side, j) => {
          const e = this.stackElectrons.find(x => !x.visible);
          if (!e) return;
          e.visible = true;
          const from = new THREE.Vector3(this.holeX(c) + side * (R_CORE + R_CH) / 2, y, 0.06);
          const to = new THREE.Vector3(this.holeX(c) + side * (R_TUN + R_NIT) / 2, y, 0.06);
          e.position.copy(from);
          jobs.push(this.tweens.to(0.7, t => e.position.lerpVectors(from, to, t), { delay: c * 0.08 + j * 0.05 }).then(() => {
            e.visible = false;
            const m = this.cellMarks[k][c];
            m.programmed = true;
            m.mat.color.set(0xffc04a).multiplyScalar(5);
          }));
        });
      });
      await Promise.all(jobs);
    } else {
      await this.tweens.sleep(0.8);
    }
    await this.tweens.to(0.4, t => { layer.mat.emissiveIntensity = 1.4 * (1 - t); });
    this.bitlines.forEach(b => { b.material.emissiveIntensity = 0; });
    this.pages[p] = 'valid';
    this.updateHud();
  }

  async writePage() {
    if (this.busy) return;
    const p = this.pages.indexOf('free');
    if (p < 0) { this.ui.status('这个块已经没有空闲页了!只能先"垃圾回收 + 块擦除" →', 6000); return; }
    this.lock();
    await this.goView(1);
    const k = Math.floor(p / ROWS), s = p % ROWS;
    this.ui.status(`写入一页 (${this.pageName(p)}):字线 WL${k} 加编程高压,位线为 0 的单元被注入电子,为 1 的被"禁止编程"。一页 ≈ 16 KB${s ? '(这一页在后排串上,剖面里看不到)' : ''}`, 0);
    await this.programPage(p);
    this.ui.status(`✅ 页 ${this.pageName(p)} 写入完成(绿色 = 有效数据)。页必须按顺序写,写过的页不能再改写`, 7000);
    this.unlock();
  }

  async updatePage() {
    if (this.busy) return;
    const old = this.pages.indexOf('valid');
    if (old < 0) { this.ui.status('还没有有效数据,先"写入一页"'); return; }
    const p = this.pages.indexOf('free');
    if (p < 0) { this.ui.status('没有空闲页可用于异地更新 → 先"垃圾回收 + 块擦除"', 6000); return; }
    this.lock();
    await this.goView(1);
    this.ui.status(`修改数据:闪存不能原地覆盖!主控把新数据写到空闲页 ${this.pageName(p)},再把旧页 ${this.pageName(old)} 标记为<b>无效</b>,并更新映射表 (FTL)`, 0);
    await this.programPage(p);
    this.pages[old] = 'invalid';
    this.updateHud();
    this.ui.status('✅ 异地更新完成。旧页(红色)仍占着空间,要等整个块被擦除才能回收 —— 这就是 SSD 需要"垃圾回收"的原因', 8000);
    this.unlock();
  }

  async gcErase() {
    if (this.busy) return;
    if (!this.pages.some(s => s !== 'free')) { this.ui.status('这个块是空的,先写入一些页再演示'); return; }
    this.lock();
    await this.goView(1);
    const valid = this.pages.filter(s => s === 'valid').length;
    this.ui.status(`垃圾回收:先把块中仍有效的 ${valid} 页搬到别的块(这些额外写入叫"写放大"),然后对整块执行擦除`, 0);
    await this.tweens.sleep(2.2);
    this.ui.status('块擦除:所有字线接地,衬底加 ~20 V —— <b>整个块</b>所有单元的电子同时被拉出,一次清空数 MB', 0);
    const marks = this.cellMarks.flat();
    await this.tweens.to(1.6, t => {
      const f = Math.sin(t * Math.PI * 5) * 0.5 + 0.5;
      this.layers.forEach(l => { l.mat.emissive.setHex(0x66aaff); l.mat.emissiveIntensity = f * 0.6 * (1 - t); });
      marks.forEach(m => { if (m.programmed) m.mat.color.setHex(0xffc04a).multiplyScalar(5 * (1 - t) + 0.2); });
    });
    marks.forEach(m => { m.programmed = false; m.mat.color.setHex(0x2a2416); });
    this.layers.forEach(l => { l.mat.emissive.setHex(0xffa040); l.mat.emissiveIntensity = 0; });
    this.pages.fill('free');
    this.pe++;
    this.wear();
    this.updateHud();
    this.ui.status(`✅ 整块已擦除,擦写次数 +1(${this.pe})。主控的<b>磨损均衡</b>会把写入分散到所有块,避免某些块先坏掉`, 8000);
    this.unlock();
  }

  updateHud() {
    const cells = this.pages.map((st, i) => `<div class="pg ${st}">${this.pageName(i)}</div>`).join('');
    const life = Math.max(0, 100 - this.pe / 30).toFixed(2);
    this.ui.setHud(`
      <h3>⚡ 闪存块 #0 页状态</h3>
      <div class="pagemap" style="grid-template-columns: repeat(${ROWS}, 1fr)">${cells}</div>
      <div class="legend"><span><i style="background:rgba(70,90,130,.6)"></i>空闲</span><span><i style="background:rgba(60,200,130,.8)"></i>有效</span><span><i style="background:rgba(220,80,80,.7)"></i>无效</span></div>
      <div class="row" style="margin-top:6px"><span>擦写次数 (P/E)</span><b>${this.pe} / 3000</b></div>
      <div class="row"><span>剩余寿命</span><b>${life}%</b></div>
      <div class="row"><span>剖面单元状态</span><b>${this.cellProgrammed ? '已编程 = 0' : '已擦除 = 1'}</b></div>
    `);
  }

  update(dt) {
    this.time += dt;
    this.tweens.update(dt);
    if (!this.busy) {
      const jig = (e, i) => {
        if (!e.visible) return;
        const h = e.userData.home;
        e.position.x = h.x + Math.sin(this.time * 2.6 + i * 2.3) * 0.04;
        e.position.y = h.y + Math.cos(this.time * 2.1 + i * 1.9) * 0.06;
      };
      this.chElectrons.forEach(jig);
      this.trapped.forEach(jig);
    }
  }

  dispose() { this.tweens.clear(); }
}
