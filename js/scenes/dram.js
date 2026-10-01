import * as THREE from 'three';
import { Tweens, makeElectron, lerp, easeInOut, easeOut } from '../utils.js';
import { setupStage } from '../lib/stage.js';
import { LabelSet } from '../lib/labels.js';
import * as M from '../lib/materials.js';
import { mesh, instanced, RoundedBoxGeometry } from '../lib/geom.js';
import { canvasTex, pcbBase, silk, dramDieTexture } from '../lib/textures.js';
import { buildDimm, buildDimmSlot, DIMM } from '../models/dimm.js';

/**
 * 内存 DRAM:
 *  工位 A —— DDR5 内存条插在主板插槽上
 *  工位 B —— 开封后的 DRAM 晶粒(16 个 Bank)
 *  工位 C —— 8×8 的 1T1C 存储阵列:柱状电容 + 存取晶体管 + 字线/位线 + 灵敏放大器 + 行译码器
 */
const A_X = -34, B_X = -14, C_X = 12;
const N = 8, P = 1.3;                  // 阵列规模与间距
const Y0 = 0.8;                        // 衬底顶面
const CAP_Y = Y0 + 0.78, CAP_H = 3.3;  // 电容底部与高度
const BL_Y = Y0 + 0.5;                 // 位线高度
const HALF = (N - 1) * P / 2;

export class DramScene {
  constructor({ camera, controls, ui, env }) {
    this.scene = new THREE.Scene();
    this.ui = ui;
    this.camera = camera;
    this.tweens = new Tweens();
    this.labels = new LabelSet();
    this.bloom = { strength: 0.7, radius: 0.4 };
    this.time = 0;
    this.busy = false;
    this.sel = { r: 2, c: 5 };
    this.leaking = false;
    this.sinceRefresh = 0;

    setupStage(this.scene, env, {
      shadowBox: 32, shadowCenter: [-10, 0, 0], mapSize: 4096, keyPos: [8, 30, 20], floorRadius: 90,
    });

    this.buildModule();
    this.buildDie();
    this.buildArray();

    camera.position.set(C_X + 5, 15, 20);
    controls.target.set(C_X, 2.0, 0.8);
    controls.minDistance = 2;
    controls.maxDistance = 100;

    this.views = [
      { label: '内存条', pos: [A_X + 6, 9, 15], target: [A_X, 2.2, 0] },
      { label: '芯片晶粒', pos: [B_X + 2, 9, 9], target: [B_X, 0.6, 0] },
      { label: '存储阵列', pos: [C_X + 5, 15, 20], target: [C_X, 2.0, 0.8] },
      { label: '单元特写', pos: [0, 0, 0], target: [0, 0, 0], dyn: true },
    ];
    this.views[3].onSelect = () => {};
    ui.setViews(this.views.map((v, i) => i === 3 ? { ...v, ...this.cellView() } : v), 2);
    this.refreshViewButtons();

    ui.setInfo('内存 DRAM 的工作原理', `
      <p>一根 DDR5 内存条上有 8 颗 DRAM 芯片,每颗芯片里有约 <b>170 亿个</b>存储单元。每个单元只由
      <b>1 个晶体管 + 1 个电容</b>(1T1C)组成,存储 1 个比特:</p>
      <p>· 电容<b>充满电荷 = 1</b>,<b>没有电荷 = 0</b>。现代 DRAM 的电容是细高的<b>圆柱</b>,高宽比超过 50:1<br>
      · <b>字线</b>(行)控制晶体管开关;<b>位线</b>(列)负责电荷进出<br>
      · 读一个单元时,整<b>一行</b>都会被打开、送进<b>灵敏放大器</b>(行缓冲),再由列地址挑出需要的数据</p>
      <p>⚠️ 电容会<b>自然漏电</b>,所以每 <b>64 ms</b> 必须把所有行读出再写回,称为<b>刷新</b>——这就是"动态"(Dynamic)的由来。断电后电荷全部消失,所以内存是<b>易失性</b>存储。</p>
      <p>👉 在存储阵列中<b>点击任意电容</b>可选中目标单元。</p>
    `);

    ui.setActions([
      { label: '⚡ 写入 1(给电容充电)', onClick: () => this.write(1) },
      { label: '⭘ 写入 0(电容放电)', onClick: () => this.write(0) },
      { label: '🔍 读取(激活整行 + 放大)', onClick: () => this.read() },
      { label: '💧 电荷泄漏', onClick: () => this.leak() },
      { label: '🔄 刷新全部行', onClick: () => this.refreshAll() },
    ]);
    this.updateHud('空闲');
  }

  cellView() {
    const p = this.cellPos(this.sel.r, this.sel.c);
    return { pos: [p.x + 2.6, CAP_Y + 2.6, p.z + 4.2], target: [p.x, CAP_Y + 0.6, p.z] };
  }

  refreshViewButtons() {
    this.ui.setViews(this.views.map((v, i) => i === 3 ? { ...v, ...this.cellView() } : v), this._activeView ?? 2);
  }

  /* ================================================================ */
  /*  工位 A:内存条 + 插槽                                           */
  /* ================================================================ */
  buildModule() {
    const g = new THREE.Group();
    g.position.set(A_X, 0, 0);
    this.scene.add(g);

    // 主板局部
    const tex = canvasTex(1024, 640, (ctx, w, h) => {
      pcbBase(ctx, w, h, { mask: '#15171c', seed: 8, traceColor: 'rgba(160,170,190,0.10)', traces: 140 });
      silk(ctx, 'DDR5_A1', 60, 300, 26);
      silk(ctx, 'DDR5_A2', 60, 420, 26);
    });
    const pm = M.pcb(tex, { bump: 0.5 });
    mesh(new THREE.BoxGeometry(18, 0.16, 11), [M.fr4(), M.fr4(), pm, pm, M.fr4(), M.fr4()], 0, 0.08, 0, g);

    const slots = [];
    [-1.0, 1.0].forEach(z => {
      const slot = buildDimmSlot();
      slot.position.set(0, 0.16, z);
      g.add(slot);
      slots.push(slot);
    });
    const dimm = buildDimm({ seed: 4 });
    dimm.group.position.set(0, 0.16 + 0.75 - 0.55, 1.0);
    g.add(dimm.group);
    const dimm2 = buildDimm({ seed: 9 });
    dimm2.group.position.set(0, 0.16 + 0.75 - 0.55, -1.0);
    g.add(dimm2.group);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    const L = this.labels, V = (x, y, z) => new THREE.Vector3(x, y, z), D = 30;
    const yb = dimm.group.position.y, zf = 1.0 + DIMM.T / 2 + 0.12;
    L.callout(g, 'DRAM 颗粒 ×8', V(dimm.chipXs[1], yb + 2.3, zf), V(-1.2, 2.2, 1.2), { cls: 'gold', sub: '每颗 16 Gb · 共 16 GB', maxDist: D });
    L.callout(g, 'PMIC 电源管理', V(-0.05, yb + 2.6, zf), V(0.6, 2.4, 1.6), { sub: 'DDR5 把供电集成到内存条上', maxDist: D });
    L.callout(g, 'SPD Hub', V(0.45, yb + 0.95, zf), V(2.8, -0.2, 2.2), { sub: '存放容量/时序等参数', maxDist: D });
    L.callout(g, '金手指 288 针', V(-4.5, yb + 0.5, zf - 0.1), V(-2.5, -1.4, 2.5), { cls: 'gold', sub: '64 位数据 + 地址/命令', maxDist: D });
    L.callout(g, '防呆缺口', V(DIMM.KEY_X, yb + 0.3, zf - 0.1), V(0.8, -1.6, 2.6), { sub: '防止插反 / 插错代', maxDist: D });
    L.callout(g, '内存插槽', V(6.8, 1.2, 1.4), V(1.5, 1.4, 1.6), { sub: '两端卡扣固定', maxDist: D });
    L.text(g, '工位 A · DDR5 内存条', V(0, 6.2, 0), { cls: 'title', maxDist: 46 });
  }

  /* ================================================================ */
  /*  工位 B:DRAM 晶粒                                               */
  /* ================================================================ */
  buildDie() {
    const g = new THREE.Group();
    g.position.set(B_X, 0, 0);
    this.scene.add(g);
    // 封装基板
    const sub = new THREE.MeshStandardMaterial({ color: 0x2e4a32, roughness: 0.55, metalness: 0.1 });
    mesh(new RoundedBoxGeometry(11, 0.3, 7, 2, 0.08), sub, 0, 0.15, 0, g);
    // 焊球
    const balls = [];
    for (let i = 0; i < 18; i++) for (let j = 0; j < 11; j++) balls.push({ x: -4.9 + i * 0.58, y: -0.08, z: -2.9 + j * 0.58 });
    g.add(instanced(new THREE.SphereGeometry(0.17, 12, 8), M.solder(), balls));
    g.position.y = 0.26;
    // 晶粒
    const dieTex = dramDieTexture();
    const dieMat = M.siliconDie(dieTex);
    const side = new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.4, roughness: 0.4 });
    mesh(new THREE.BoxGeometry(9.4, 0.25, 4.7), [side, side, dieMat, side, side, side], 0, 0.425, 0, g);
    // 键合金线(从中央焊盘到基板)
    const wire = M.gold();
    for (let i = 0; i < 24; i++) {
      const x = -4.0 + i * 0.35;
      for (const sz of [-1, 1]) {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(x, 0.56, sz * 0.05),
          new THREE.Vector3(x, 0.95, sz * 0.9),
          new THREE.Vector3(x + 0.02, 0.6, sz * 2.7),
          new THREE.Vector3(x + 0.03, 0.31, sz * 3.15),
        ]);
        if (i % 2 === 0) mesh(new THREE.TubeGeometry(curve, 16, 0.012, 4), wire, 0, 0, 0, g).castShadow = false;
      }
    }
    // 放大镜头:框出一个 mat
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(0.55, 0.06, 0.42)),
      new THREE.LineBasicMaterial({ color: 0xffd479 })
    );
    frame.position.set(3.05, 0.58, -1.55);
    g.add(frame);
    g.traverse(o => { if (o.isMesh) { o.receiveShadow = true; } });

    const L = this.labels, V = (x, y, z) => new THREE.Vector3(x, y, z), D = 26;
    L.callout(g, 'Bank(存储体)×16', V(-3.3, 0.56, -1.3), V(-1.5, 2.2, -0.6), { cls: 'gold', sub: '4 个 Bank Group,可并行工作', maxDist: D });
    L.callout(g, '中央焊盘 + 外围电路', V(1.0, 0.56, 0), V(1.6, 2.4, 0.8), { sub: '地址译码 / 命令 / I/O', maxDist: D });
    L.callout(g, '一个阵列块 (mat)', V(3.05, 0.6, -1.55), V(2.0, 2.0, -1.2), { cls: 'cyan', sub: '约 1024 × 1024 个单元 → 放大见工位 C', maxDist: D });
    L.callout(g, '键合金线', V(-4.0, 0.9, 1.0), V(-2.2, 1.0, 2.0), { maxDist: D });
    L.text(g, '工位 B · DRAM 晶粒(开封)', V(0, 3.6, 0), { cls: 'title', maxDist: 40 });
  }

  /* ================================================================ */
  /*  工位 C:1T1C 阵列                                               */
  /* ================================================================ */
  cellPos(r, c) { return new THREE.Vector3(C_X + (c - (N - 1) / 2) * P, 0, (r - (N - 1) / 2) * P); }

  buildArray() {
    const g = new THREE.Group();
    g.position.set(C_X, 0, 0);
    this.scene.add(g);
    this.arr = g;
    const W = N * P + 1.0;

    // 硅衬底(带浅沟槽隔离 STI 的暗色表面)
    const si = M.silicon(0x353b47);
    mesh(new THREE.BoxGeometry(W + 5.4, Y0, W + 4.4), si, -1.0, Y0 / 2, 1.0, g);

    const lc = (r, c) => new THREE.Vector3((c - (N - 1) / 2) * P, 0, (r - (N - 1) / 2) * P);

    // 有源区(斜置的硅岛)+ 存储节点接触 + 位线接触
    const active = [], snc = [], blc = [];
    const actLen = 0.95, actAng = Math.atan2(0.62, 0.5);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const p = lc(r, c);
      active.push({ x: p.x + 0.25, y: Y0 + 0.04, z: p.z + 0.31, ry: -actAng + Math.PI / 2 - Math.PI / 2 });
      snc.push({ x: p.x, y: Y0 + 0.39, z: p.z });
      blc.push({ x: p.x + 0.5, y: Y0 + 0.25, z: p.z + 0.62 });
    }
    const actGeo = new THREE.BoxGeometry(0.34, 0.08, actLen);
    actGeo.rotateY(Math.atan2(0.5, 0.62));
    g.add(instanced(actGeo, new THREE.MeshStandardMaterial({ color: 0x5b6676, roughness: 0.35, metalness: 0.3 }), active.map(a => ({ ...a, ry: 0 }))));
    const tungsten = new THREE.MeshStandardMaterial({ color: 0x9aa3b0, metalness: 1, roughness: 0.3 });
    g.add(instanced(new THREE.CylinderGeometry(0.12, 0.14, 0.78, 12), tungsten, snc));
    g.add(instanced(new THREE.CylinderGeometry(0.09, 0.1, 0.5, 10), tungsten, blc));

    // 字线(行,沿 X):埋入式栅极,露出顶部
    this.wl = [];
    for (let r = 0; r < N; r++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x4a4f5c, metalness: 0.8, roughness: 0.35, emissive: 0x9b6bff, emissiveIntensity: 0 });
      const z = lc(r, 0).z + 0.31;
      const m = mesh(new THREE.BoxGeometry(W + 1.6, 0.14, 0.2), mat, -0.8, Y0 + 0.07, z, g);
      this.wl.push(m);
    }
    // 位线(列,沿 Z),高于字线、低于电容
    this.bl = [];
    for (let c = 0; c < N; c++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x8b6a3e, metalness: 0.9, roughness: 0.3, emissive: 0xffc04a, emissiveIntensity: 0 });
      const x = lc(0, c).x + 0.5;
      const m = mesh(new THREE.BoxGeometry(0.16, 0.13, W + 1.6), mat, x, BL_Y, 0.8, g);
      this.bl.push(m);
    }

    // 圆柱形存储电容:TiN 外电极(半透明)+ 内部电荷柱
    this.caps = [];
    this.q = [];
    this.pickables = [];
    const shellGeo = new THREE.CylinderGeometry(0.36, 0.36, CAP_H, 28, 1, true);
    const bottomGeo = new THREE.CircleGeometry(0.36, 28).rotateX(-Math.PI / 2);
    const chargeGeo = new THREE.CylinderGeometry(0.26, 0.26, CAP_H - 0.15, 20);
    chargeGeo.translate(0, (CAP_H - 0.15) / 2, 0);
    const shellMat = new THREE.MeshPhysicalMaterial({
      color: 0xd8b25a, metalness: 0.75, roughness: 0.32, transparent: true, opacity: 0.32,
      side: THREE.DoubleSide, depthWrite: false, clearcoat: 0.5,
    });
    const capBottom = new THREE.MeshStandardMaterial({ color: 0xc9a24f, metalness: 0.9, roughness: 0.35 });
    for (let r = 0; r < N; r++) {
      const row = [], qrow = [];
      for (let c = 0; c < N; c++) {
        const p = lc(r, c);
        const shell = new THREE.Mesh(shellGeo, shellMat);
        shell.position.set(p.x, CAP_Y + CAP_H / 2, p.z);
        shell.userData = { r, c };
        shell.renderOrder = 2;
        g.add(shell);
        this.pickables.push(shell);
        mesh(bottomGeo, capBottom, p.x, CAP_Y + 0.01, p.z, g);
        const cm = new THREE.MeshStandardMaterial({ color: 0x0b1a22, emissive: 0x3fd4ff, emissiveIntensity: 1.6, roughness: 0.3, transparent: true, opacity: 0.92 });
        const charge = new THREE.Mesh(chargeGeo, cm);
        charge.position.set(p.x, CAP_Y + 0.05, p.z);
        g.add(charge);
        const q = Math.random() > 0.5 ? 1 : 0;
        row.push({ shell, charge, mat: cm, leakRate: 0.6 + Math.random() * 0.8 });
        qrow.push(q);
      }
      this.caps.push(row);
      this.q.push(qrow);
    }
    // 上极板(所有电容共用,接 VDD/2)
    const plate = new THREE.MeshPhysicalMaterial({ color: 0xd8b25a, metalness: 0.7, roughness: 0.35, transparent: true, opacity: 0.1, depthWrite: false });
    mesh(new THREE.BoxGeometry(W, 0.14, W), plate, 0, CAP_Y + CAP_H + 0.07, 0, g).castShadow = false;

    // 行译码器 / 字线驱动(左侧)
    const decX = -W / 2 - 1.8;
    const chipDark = new THREE.MeshStandardMaterial({ color: 0x272b34, metalness: 0.5, roughness: 0.45 });
    mesh(new RoundedBoxGeometry(1.6, 0.9, W, 2, 0.06), chipDark, decX, Y0 + 0.45, 0, g);
    this.wlLeds = [];
    for (let r = 0; r < N; r++) {
      const z = lc(r, 0).z + 0.31;
      mesh(new THREE.BoxGeometry(0.9, 0.3, 0.5), new THREE.MeshStandardMaterial({ color: 0x3b4150, metalness: 0.6, roughness: 0.4 }), decX + 0.2, Y0 + 1.05, z, g);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0x302040 }));
      led.position.set(decX - 0.45, Y0 + 1.1, z);
      g.add(led);
      this.wlLeds.push(led);
    }

    // 灵敏放大器(前侧,每条位线一个)
    const saZ = W / 2 + 1.8;
    mesh(new RoundedBoxGeometry(W, 0.7, 1.7, 2, 0.06), chipDark, 0, Y0 + 0.35, saZ, g);
    this.saLeds = [];
    for (let c = 0; c < N; c++) {
      const x = lc(0, c).x + 0.5;
      mesh(new RoundedBoxGeometry(0.8, 0.5, 1.1, 2, 0.05), new THREE.MeshStandardMaterial({ color: 0x334055, metalness: 0.6, roughness: 0.4 }), x, Y0 + 0.95, saZ, g);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshBasicMaterial({ color: 0x223322 }));
      led.position.set(x, Y0 + 1.3, saZ + 0.3);
      g.add(led);
      this.saLeds.push(led);
    }
    // 列选择 / 数据 I/O
    const ioZ = saZ + 1.7;
    mesh(new RoundedBoxGeometry(W, 0.45, 0.9, 2, 0.05), new THREE.MeshStandardMaterial({ color: 0x2b3440, metalness: 0.5, roughness: 0.4 }), 0, Y0 + 0.23, ioZ, g);
    this.ioPos = new THREE.Vector3(C_X + W / 2 + 1.2, Y0 + 0.5, ioZ);

    // 选中单元的高亮环
    this.selRing = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 8, 40), M.emissive(0xffd479, 6));
    this.selRing.rotation.x = Math.PI / 2;
    g.add(this.selRing);
    this.placeSelRing();

    // 电子
    this.electrons = [];
    for (let i = 0; i < 14; i++) {
      const e = makeElectron(0.08, 0x55ccff);
      e.visible = false;
      this.scene.add(e);
      this.electrons.push(e);
    }
    // 泄漏的小电子
    this.leakParticles = [];
    for (let i = 0; i < 40; i++) {
      const e = makeElectron(0.045, 0x55ccff, 6);
      e.visible = false;
      this.scene.add(e);
      this.leakParticles.push({ e, life: 0 });
    }

    this.syncCharges();
    this.blV = new Array(N).fill(0.5);
    this.setBitlines(null);

    const L = this.labels, V = (x, y, z) => new THREE.Vector3(x, y, z), D = 30;
    const p0 = lc(0, N - 1);
    L.callout(g, '存储电容(圆柱形)', V(p0.x + 0.36, CAP_Y + CAP_H * 0.7, p0.z), V(2.2, 1.6, -1.4), { cls: 'gold', sub: 'TiN 电极 + 高介电常数介质 · 亮柱 = 电荷', maxDist: D });
    L.callout(g, '上极板 (接 VDD/2)', V(-HALF, CAP_Y + CAP_H + 0.14, -HALF), V(-1.8, 1.4, -1.2), { maxDist: D });
    L.callout(g, '字线 WL(行)', V(-W / 2 - 0.4, Y0 + 0.14, lc(N - 1, 0).z + 0.31), V(-1.4, 1.6, 2.6), { cls: 'violet', sub: '高电平时打开整行晶体管', maxDist: D });
    L.callout(g, '位线 BL(列)', V(lc(0, N - 1).x + 0.5, BL_Y + 0.07, W / 2 + 0.5), V(2.6, 0.9, 0.8), { cls: 'gold', sub: '电荷进出的通道', maxDist: D });
    L.callout(g, '存取晶体管', V(lc(N - 1, 0).x + 0.25, Y0 + 0.08, lc(N - 1, 0).z + 0.31), V(-1.0, -1.3, 3.4), { sub: '字线 = 栅极 · 斜置有源区', maxDist: D });
    L.callout(g, '行译码器 / 字线驱动', V(decX, Y0 + 0.9, -HALF), V(-1.6, 1.8, -1.6), { cls: 'violet', maxDist: D });
    L.callout(g, '灵敏放大器 (行缓冲)', V(W / 2 - 0.6, Y0 + 1.2, saZ), V(2.6, 1.2, 1.2), { cls: 'green', sub: '把微弱电压差放大为 0 / 1', maxDist: D });
    L.callout(g, '列选择 → 数据 I/O', V(W / 2, Y0 + 0.45, ioZ), V(2.0, 0.4, 1.0), { maxDist: D });
    this.selLabel = L.callout(g, '目标单元', V(0, 0, 0), V(0, 0, 0), { cls: 'gold big', line: false, maxDist: 34 });
    L.text(g, '工位 C · 1T1C 存储阵列(放大约 5000 万倍)', V(0, CAP_Y + CAP_H + 2.6, -1), { cls: 'title', maxDist: 50 });
    this.placeSelRing();
  }

  placeSelRing() {
    const p = this.cellPos(this.sel.r, this.sel.c);
    this.selRing.position.set(p.x - C_X, CAP_Y + 0.08, p.z);
    if (this.selLabel) {
      this.selLabel.lbl.position.set(p.x - C_X, CAP_Y + CAP_H + 0.75, p.z);
      this.labels.setText(this.selLabel, `目标单元 [行 ${this.sel.r}, 列 ${this.sel.c}]`);
    }
  }

  onPick(hit) {
    if (this.busy) return;
    const { r, c } = hit.object.userData;
    this.sel = { r, c };
    this.placeSelRing();
    this.refreshViewButtons();
    this.ui.status(`已选中 第 ${r} 行 · 第 ${c} 列 的单元(当前保存 ${this.q[r][c] > 0.5 ? '1' : '0'},电荷 ${(this.q[r][c] * 100).toFixed(0)}%)`);
  }

  /** 电荷柱的高度与亮度随电荷量变化 */
  syncCharges() {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const q = this.q[r][c];
      const cap = this.caps[r][c];
      cap.charge.scale.y = Math.max(q, 0.015);
      cap.mat.emissiveIntensity = 0.3 + q * 1.6;
      cap.charge.visible = q > 0.01;
      // 电荷不足时变为警示色
      cap.mat.emissive.setHex(q > 0.62 || q < 0.05 ? 0x3fd4ff : 0xff9a3c);
    }
  }

  /** 位线电压:null 表示全部预充电到 VDD/2 */
  setBitlines(values) {
    for (let c = 0; c < N; c++) {
      const v = values ? values[c] : 0.5;
      this.blV[c] = v;
      const m = this.bl[c].material;
      m.emissiveIntensity = v * v * 1.5;         // VDD/2 待命时只微亮
    }
  }

  setWordline(r, on) {
    const m = this.wl[r].material;
    m.emissiveIntensity = on;
    this.wlLeds[r].material.color.set(on > 0.3 ? 0xb48cff : 0x302040).multiplyScalar(on > 0.3 ? 6 : 1);
  }

  setSaLeds(values) {
    this.saLeds.forEach((l, c) => {
      const v = values ? values[c] : null;
      if (v == null) l.material.color.set(0x223322);
      else l.material.color.set(v ? 0x5dff9a : 0x3a1010).multiplyScalar(v ? 6 : 1);
    });
  }

  /** 电子路径:灵敏放大器 → 位线 → 位线接触 → 有源区 → 存储节点 → 电容 */
  cellPath(r, c, intoCap = true) {
    const p = this.cellPos(r, c);
    const xb = p.x + 0.5, zb = p.z + 0.62;
    const saZ = (N * P + 1.0) / 2 + 1.8;
    const pts = [
      new THREE.Vector3(xb, BL_Y + 0.1, saZ - 0.6),
      new THREE.Vector3(xb, BL_Y + 0.1, zb + 0.3),
      new THREE.Vector3(xb, BL_Y - 0.1, zb),
      new THREE.Vector3(xb, Y0 + 0.12, zb),
      new THREE.Vector3(p.x, Y0 + 0.12, p.z),
      new THREE.Vector3(p.x, CAP_Y + 0.1, p.z),
      new THREE.Vector3(p.x, CAP_Y + 1.2, p.z),
    ];
    if (!intoCap) pts.reverse();
    return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
  }

  flowElectrons(curve, n = 10, dur = 1.4, color = 0x55ccff) {
    const list = this.electrons.slice(0, n);
    list.forEach((e, i) => {
      e.visible = true;
      e.material.color.set(color).multiplyScalar(10);
      e.children[0].material.color.set(color);
      e.position.copy(curve.getPoint(0));
      this.tweens.add({
        duration: dur, delay: i * 0.07, ease: x => x,
        onUpdate: t => e.position.copy(curve.getPoint(t)),
        onComplete: () => { e.visible = false; },
      });
    });
    return this.tweens.sleep(dur + n * 0.07);
  }

  lock() { this.busy = true; this.ui.setButtonsEnabled(false); }
  unlock() { this.busy = false; this.ui.setButtonsEnabled(true); }

  async goArray() {
    const v = this.views[2];
    if (this.camera.position.distanceTo(new THREE.Vector3(C_X, 3, 0)) > 26) {
      this.ui.setActiveView(2);
      await this.ui.flyTo(v.pos, v.target, 1.6);
    }
  }

  /** 激活一行:字线开启 → 电荷共享 → 灵敏放大 → 回写 */
  async activate(r, { scopeCol = null, fast = false } = {}) {
    const T = fast ? 0.35 : 1;
    this.updateHud(`ACT 激活第 ${r} 行`);
    // 字线上升
    await this.tweens.to(0.5 * T, t => this.setWordline(r, t * 1.8));
    // 电荷共享:电容电荷与位线(大电容)平分,位线只偏移一点点
    const q0 = this.q[r].slice();
    const target = q0.map(q => 0.5 + (q - 0.5) * 0.35);
    const blT = q0.map(q => 0.5 + (q - 0.5) * 0.12);
    if (!fast) this.ui.status(`② 电荷共享:第 ${r} 行的电容与各自位线连通,位线电压只偏离 VDD/2 约 ±${(0.12 * 0.55 * 1100 / 2).toFixed(0)} mV`, 0);
    await this.tweens.to(0.9 * T, t => {
      for (let c = 0; c < N; c++) this.q[r][c] = lerp(q0[c], target[c], t);
      this.setBitlines(blT.map(v => lerp(0.5, v, t)));
      this.syncCharges();
      if (scopeCol != null) this.ui.scope.push(lerp(0.5, blT[scopeCol], t));
    }, { ease: easeOut });
    if (scopeCol != null) for (let i = 0; i < 12; i++) this.ui.scope.push(blT[scopeCol]);
    // 灵敏放大
    const bits = q0.map(q => (q > 0.5 ? 1 : 0));
    if (!fast) this.ui.status('③ 灵敏放大器检测到微小电压差,正反馈把位线推到满电压:高于 VDD/2 → 1(1.1V),低于 → 0(0V)', 0);
    await this.tweens.to(0.8 * T, t => {
      this.setBitlines(blT.map((v, c) => lerp(v, bits[c], t)));
      if (scopeCol != null) this.ui.scope.push(lerp(blT[scopeCol], bits[scopeCol], t));
    }, { ease: easeInOut });
    this.setSaLeds(bits);
    // 回写
    if (!fast) this.ui.status('④ 回写:满电压的位线同时把这一行的电容重新充满 / 放空 —— 读取本身是"破坏性"的,必须回写', 0);
    const q1 = this.q[r].slice();
    await this.tweens.to(0.8 * T, t => {
      for (let c = 0; c < N; c++) this.q[r][c] = lerp(q1[c], bits[c], t);
      this.syncCharges();
      if (scopeCol != null) this.ui.scope.push(bits[scopeCol]);
    });
    return bits;
  }

  async precharge(r, fast = false) {
    this.updateHud('PRE 预充电');
    const v0 = this.blV.slice();
    await this.tweens.to(fast ? 0.25 : 0.6, t => {
      this.setWordline(r, 1.8 * (1 - t));
      this.setBitlines(v0.map(v => lerp(v, 0.5, t)));
      if (this.ui.scope.visible && !fast) this.ui.scope.push(lerp(v0[this.sel.c], 0.5, t));
    });
    this.setSaLeds(null);
  }

  async read() {
    if (this.busy) return;
    this.lock();
    await this.goArray();
    const { r, c } = this.sel;
    this.ui.scope.show(`位线 BL${c} 电压`, {
      min: -0.05, max: 1.05, len: 220,
      refs: [{ v: 1, label: 'VDD 1.1V' }, { v: 0.5, label: 'VDD/2', color: 'rgba(140,200,255,0.6)' }, { v: 0, label: '0V' }],
    });
    for (let i = 0; i < 20; i++) this.ui.scope.push(0.5);
    this.ui.status('① 预充电:所有位线先被拉到 VDD/2(0.55V)待命', 0);
    this.updateHud('PRE 位线预充电');
    await this.tweens.sleep(1.0);
    this.ui.status(`激活 (ACT):行译码器把第 ${r} 行字线拉高 → 这一整行 ${N} 个晶体管同时导通`, 0);
    const bits = await this.activate(r, { scopeCol: c });
    // 列选择
    this.updateHud(`RD 读取第 ${c} 列`);
    this.ui.status(`⑤ 列选择 (READ):从行缓冲中取出第 ${c} 列的数据 → <b>${bits[c]}</b>,经 I/O 送往内存控制器`, 0);
    const p = this.cellPos(r, c);
    const saZ = (N * P + 1.0) / 2 + 1.8;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(p.x + 0.5, Y0 + 1.3, saZ),
      new THREE.Vector3(p.x + 0.5, Y0 + 0.8, saZ + 1.7),
      this.ioPos.clone(),
      this.ioPos.clone().add(new THREE.Vector3(3, 0.6, 0)),
    ]);
    await this.flowElectrons(curve, 6, 1.4, bits[c] ? 0x5dff9a : 0xff6b6b);
    await this.precharge(r);
    this.ui.status(`✅ 读取完成:结果 = <b>${bits[c]}</b>。真实 DDR5 中 激活→读出 约 30 ns,而且一次会把整行 8 KB 都放进行缓冲`, 8000);
    this.updateHud('空闲');
    await this.tweens.sleep(1.5);
    this.ui.scope.hide();
    this.unlock();
  }

  async write(bit) {
    if (this.busy) return;
    this.lock();
    await this.goArray();
    const { r, c } = this.sel;
    this.ui.status(`写入 ${bit}:先激活第 ${r} 行(整行进入灵敏放大器)…`, 0);
    await this.activate(r, { fast: true });
    this.updateHud(`WR 写入第 ${c} 列`);
    this.ui.status(bit
      ? `写驱动器把位线 BL${c} 强行拉到 1.1V → 电荷经导通的晶体管流入电容(电荷柱升高)`
      : `写驱动器把位线 BL${c} 拉到 0V → 电容里的电荷经晶体管、位线被泄放`, 0);
    const vals = this.blV.slice();
    await this.tweens.to(0.4, t => { vals[c] = lerp(this.blV[c], bit, t); this.setBitlines(vals); });
    const sa = this.q[r].map(q => (q > 0.5 ? 1 : 0)); sa[c] = bit;
    this.setSaLeds(sa);
    const q0 = this.q[r][c];
    const flow = this.flowElectrons(this.cellPath(r, c, !!bit), 12, 1.5, 0x55ccff);
    await this.tweens.to(1.9, t => { this.q[r][c] = lerp(q0, bit, t); this.syncCharges(); });
    await flow;
    await this.precharge(r, true);
    this.ui.status(`✅ 写入完成:第 ${r} 行第 ${c} 列现在保存的是 <b>${bit}</b>。字线关闭后,晶体管断开,电荷被"锁"在电容里`, 7000);
    this.updateHud('空闲');
    this.unlock();
  }

  async leak() {
    if (this.busy) return;
    this.lock();
    await this.goArray();
    this.leaking = true;
    this.updateHud('无刷新 · 电荷泄漏中');
    this.ui.status('停止刷新:电容通过晶体管的亚阈值漏电和结漏电,电荷一点点流失……(时间已放慢约 100 倍)', 0);
    await this.tweens.to(6, () => {}, { ease: x => x });
    this.leaking = false;
    const weak = this.q.flat().filter(q => q > 0.05 && q < 0.62).length;
    this.ui.status(`⚠️ 已有 ${weak} 个单元电荷低于安全阈值(橙色),再不刷新,"1" 就会被误读成 "0"!→ 点击"刷新全部行"`, 9000);
    this.updateHud('危险:需要刷新');
    this.unlock();
  }

  async refreshAll() {
    if (this.busy) return;
    this.lock();
    await this.goArray();
    this.ui.status('刷新 (REF):逐行"激活 + 回写",读出即恢复。真实内存每 64 ms 刷完所有行(DDR5 每次 REF 命令刷新若干行)', 0);
    for (let r = 0; r < N; r++) {
      this.updateHud(`REF 刷新第 ${r} 行`);
      await this.activate(r, { fast: true });
      await this.precharge(r, true);
    }
    this.sinceRefresh = 0;
    this.ui.status('✅ 刷新完成,所有"1"重新充满电。这个过程每秒发生十几次,但会占用约 5~10% 的内存带宽', 7000);
    this.updateHud('空闲');
    this.unlock();
  }

  updateHud(cmd) {
    this.ui.setHud(`
      <h3>🧠 DDR5-4800 时序</h3>
      <div class="row"><span>当前命令</span><b>${cmd}</b></div>
      <div class="row"><span>tRCD 激活→读</span><b>16.6 ns</b></div>
      <div class="row"><span>CL 读延迟</span><b>16.6 ns</b></div>
      <div class="row"><span>tRP 预充电</span><b>16.6 ns</b></div>
      <div class="row"><span>刷新周期 tREFW</span><b>32~64 ms</b></div>
      <div class="muted" style="margin-top:6px">点击阵列中的电容可选择目标单元</div>
    `);
  }

  update(dt) {
    this.time += dt;
    this.tweens.update(dt);
    // 选中环呼吸
    this.selRing.material.color.setHex(0xffd479).multiplyScalar(4 + Math.sin(this.time * 4) * 2);

    // 电荷泄漏
    if (this.leaking) {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const q = this.q[r][c];
        if (q > 0.02) this.q[r][c] = Math.max(0.02, q - dt * 0.085 * this.caps[r][c].leakRate * q);
        if (q > 0.2 && Math.random() < dt * 1.2) this.emitLeak(r, c);
      }
      this.syncCharges();
    }
    for (const p of this.leakParticles) {
      if (!p.e.visible) continue;
      p.life += dt;
      p.e.position.y -= dt * 0.9;
      p.e.position.x += Math.sin(p.life * 6 + p.seed) * dt * 0.2;
      p.e.scale.setScalar(Math.max(0.01, 1 - p.life / 1.6));
      if (p.life > 1.6) p.e.visible = false;
    }
  }

  emitLeak(r, c) {
    const p = this.leakParticles.find(x => !x.e.visible);
    if (!p) return;
    const pos = this.cellPos(r, c);
    p.e.visible = true;
    p.life = 0;
    p.seed = Math.random() * 10;
    p.e.position.set(pos.x + (Math.random() - 0.5) * 0.3, CAP_Y + 0.3 + Math.random() * 0.6, pos.z + (Math.random() - 0.5) * 0.3);
  }

  dispose() { this.tweens.clear(); }
}
