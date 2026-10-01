import * as THREE from 'three';
import { Tweens, makeElectron, lerp } from '../utils.js';
import { setupStage } from '../lib/stage.js';
import { LabelSet } from '../lib/labels.js';
import * as M from '../lib/materials.js';
import { mesh, ribbonGeometry } from '../lib/geom.js';
import { buildMotherboard, MB, POS } from '../models/motherboard.js';
import { buildHdd, HDD } from '../models/hdd.js';

/**
 * 存储层级:一台真实电脑的内部
 * 主板(CPU / 内存 / M.2 SSD / 芯片组)+ 通过 SATA 线连接的机械硬盘
 * 演示一次数据从硬盘 / SSD 一路搬到 CPU 寄存器的完整旅程
 */
const BY = 0.6;                         // 主板离地高度(铜柱)
const BT = BY + MB.T + 0.03;            // 走线高度
const HDD_POS = new THREE.Vector3(25, 0.2, 3);

const TIERS = [
  { key: 'rf', name: '寄存器', ns: 0.3, cap: '~1 KB', like: '0.3 秒' },
  { key: 'l1', name: 'L1 缓存', ns: 1, cap: '48 KB/核', like: '1 秒' },
  { key: 'l2', name: 'L2 缓存', ns: 4, cap: '2 MB/核', like: '4 秒' },
  { key: 'l3', name: 'L3 缓存', ns: 12, cap: '32 MB', like: '12 秒' },
  { key: 'dram', name: '内存 DRAM', ns: 80, cap: '32 GB', like: '1.3 分钟' },
  { key: 'ssd', name: 'NVMe SSD', ns: 80e3, cap: '1 TB', like: '22 小时' },
  { key: 'hdd', name: '机械硬盘', ns: 8e6, cap: '8 TB', like: '93 天' },
];
const fmt = ns => ns < 1000 ? `${+ns.toFixed(1)} ns` : ns < 1e6 ? `${+(ns / 1e3).toFixed(1)} µs` : `${+(ns / 1e6).toFixed(2)} ms`;

export class HierarchyScene {
  constructor({ camera, controls, ui, env }) {
    this.scene = new THREE.Scene();
    this.ui = ui;
    this.camera = camera;
    this.controls = controls;
    this.tweens = new Tweens();
    this.labels = new LabelSet();
    this.bloom = { strength: 0.9, radius: 0.5 };
    this.time = 0;
    this.busy = false;
    this.elapsed = 0;
    this.tierState = {};

    setupStage(this.scene, env, { shadowBox: 26, shadowCenter: [7, 0, 1], mapSize: 4096, keyPos: [6, 30, 16], floorRadius: 80 });

    this.buildPc();
    this.buildDieOverlay();

    // 数据包
    this.packet = makeElectron(0.16, 0xffd479);
    this.packet.visible = false;
    this.scene.add(this.packet);

    this.views = [
      { label: '整机', pos: [21, 32, 43], target: [9, 0, 2] },
      { label: 'CPU 晶粒', pos: [-2.4, 4.6, -1.6], target: [-3.0, 1.1, -5.0], onSelect: () => this.liftIhs(true) },
      { label: '内存', pos: [13, 9, 3], target: [5.5, 2.2, -4.6] },
      { label: 'M.2 SSD', pos: [-4, 6, 12], target: [-5.6, 0.9, 5.1] },
      { label: '机械硬盘', pos: [30, 9, 14], target: [24, 1.2, 3] },
    ];
    ui.setViews(this.views, 0);
    camera.position.set(...this.views[0].pos);
    controls.target.set(...this.views[0].target);
    controls.minDistance = 1.2;
    controls.maxDistance = 90;

    ui.setInfo('存储层级 (Memory Hierarchy)', `
      <p>计算机采用<b>金字塔式的多级存储</b>,在速度、容量、价格之间取得平衡。越靠近 CPU 越快、越小、越贵:</p>
      <table>
        <tr><th>层级</th><th>位置</th><th>延迟</th><th>若 1ns = 1 秒</th></tr>
        ${TIERS.map(t => `<tr><td>${t.name}</td><td>${{ rf: 'CPU 核心内', l1: 'CPU 核心内', l2: 'CPU 核心旁', l3: 'CPU 晶粒中央', dram: '内存条', ssd: 'M.2 插槽', hdd: 'SATA 线另一端' }[t.key]}</td><td>${fmt(t.ns)}</td><td>${t.like}</td></tr>`).join('')}
      </table>
      <p>CPU 要数据时<b>由近及远</b>逐级查找:寄存器 → L1 → L2 → L3 → 内存 → 硬盘。找到后把数据<b>逐级向上复制</b>,让"最常用的数据离 CPU 最近"——这就是<b>缓存</b>的思想。</p>
      <p>👉 点击右侧按钮观看数据的完整旅程。可点"CPU 晶粒"视角揭开顶盖看芯片内部。</p>
    `);

    ui.setActions([
      { label: '▶ 从机械硬盘读取', onClick: () => this.journey('hdd') },
      { label: '⚡ 从 SSD 读取', onClick: () => this.journey('ssd') },
      { label: '💡 缓存命中', onClick: () => this.cacheHit() },
      { label: '🔧 揭开 / 盖上 CPU 顶盖', onClick: () => this.liftIhs(!this.ihsUp) },
    ]);
    this.updateHud();
  }

  /* ================================================================ */
  buildPc() {
    const mb = buildMotherboard();
    mb.group.position.y = BY;
    this.scene.add(mb.group);
    this.mb = mb;
    // 铜柱
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a85a, metalness: 1, roughness: 0.3 });
    [[-11.4, -11.4], [-11.4, 1.0], [-11.4, 11.4], [11.4, -11.4], [11.4, 1.0], [11.4, 11.4]].forEach(([x, z]) =>
      mesh(new THREE.CylinderGeometry(0.3, 0.3, BY, 6), brass, x, BY / 2, z, this.scene));

    // 机械硬盘(合盖)
    const hdd = buildHdd({ cover: true });
    hdd.group.position.copy(HDD_POS);
    hdd.group.rotation.y = Math.PI;
    hdd.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(hdd.group);
    this.hdd = hdd;
    // 活动指示灯
    this.hddLed = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0x113311 }));
    this.hddLed.position.set(HDD_POS.x - HDD.L / 2 + 0.2, 1.4, HDD_POS.z + 3.6);
    this.scene.add(this.hddLed);

    // SATA 数据线(红色扁线)
    const port = mb.sataPort.clone().add(new THREE.Vector3(0, BY, 0));
    const hddConn = new THREE.Vector3(HDD_POS.x - HDD.L / 2 - 0.35, 0.37, HDD_POS.z + 2.45);
    this.cablePts = [
      port.clone().add(new THREE.Vector3(0.4, 0, 0)),
      port.clone().add(new THREE.Vector3(1.4, -0.1, 0)),
      new THREE.Vector3(port.x + 2.4, 0.08, port.z - 0.3),
      new THREE.Vector3(hddConn.x - 1.6, 0.08, hddConn.z + 0.2),
      hddConn.clone().add(new THREE.Vector3(-0.5, 0, 0)),
    ];
    const cableCurve = new THREE.CatmullRomCurve3(this.cablePts, false, 'centripetal');
    const red = new THREE.MeshPhysicalMaterial({ color: 0xb3161e, roughness: 0.45, clearcoat: 0.5 });
    mesh(ribbonGeometry(cableCurve.getPoints(60), 0.75, 0.1), red, 0, 0, 0, this.scene);
    const plug = M.plastic(0x15161a, 0.5);
    mesh(new THREE.BoxGeometry(1.0, 0.45, 1.0), plug, port.x + 0.45, port.y, port.z, this.scene);
    mesh(new THREE.BoxGeometry(1.0, 0.45, 1.0), plug, hddConn.x - 0.45, hddConn.y, hddConn.z, this.scene);

    // 标注
    const L = this.labels, V = (x, y, z) => new THREE.Vector3(x, y, z), D = 70;
    L.callout(this.scene, 'CPU(含寄存器 + L1/L2/L3 缓存)', V(-3, BT + 0.6, -5), V(-3.5, 6.5, -2), { cls: 'gold', maxDist: D });
    L.callout(this.scene, '内存条 DRAM', V(6.9, BT + 3.2, -9), V(3, 4.5, -3), { cls: 'cyan', sub: '32 GB · 断电即失', maxDist: D });
    L.callout(this.scene, 'M.2 NVMe 固态硬盘', V(-3.5, BT + 0.6, 5.1), V(-4, 4.5, 4), { cls: 'green', sub: 'PCIe 直连 CPU', maxDist: D });
    L.callout(this.scene, '芯片组 PCH', V(POS.pch.x, BT + 1.0, POS.pch.z), V(1.5, 4.5, 3.5), { sub: '管理 SATA / USB 等慢速设备', maxDist: D });
    L.callout(this.scene, 'SATA 接口', V(port.x, port.y, port.z), V(0.5, 3.6, 2.6), { maxDist: D });
    L.callout(this.scene, '机械硬盘', V(HDD_POS.x, HDD.H + 0.3, HDD_POS.z), V(2, 4.6, -2), { cls: 'red', sub: '8 TB · 最慢最便宜', maxDist: D });
    L.callout(this.scene, '显卡插槽 PCIe x16', V(-8, BT + 1.1, 2.8), V(-4, 3.5, 2), { maxDist: D });
    L.callout(this.scene, '供电模组 VRM', V(-3, BT + 2.2, -10.3), V(-2, 3.5, -3), { maxDist: D });
  }

  /** CPU 晶粒上的层级高亮 + 标注 */
  buildDieOverlay() {
    const cpu = this.mb.cpu;
    this.cpuOrigin = new THREE.Vector3(POS.cpu.x, BY + MB.T, POS.cpu.z);
    this.ihsBase = cpu.ihs.position.clone();
    this.ihsUp = false;
    this.regions = {};
    const colors = { rf: 0xff5fa2, l1: 0xb98cff, l2: 0x5aa8ff, l3: 0x3fe0c5, imc: 0xffa040 };
    for (const [k, col] of Object.entries(colors)) {
      const r = cpu.regionRect(k);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(3), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.copy(r.c).add(new THREE.Vector3(0, 0.004, 0));
      cpu.group.add(m);
      this.regions[k] = { mat, world: r.c.clone().add(this.cpuOrigin).add(new THREE.Vector3(0, 0.05, 0)), col };
    }
    const L = this.labels, D = 7.5;
    const lab = (k, text, sub, off) => L.callout(cpu.group, text, cpu.regionCenter(k), off, { cls: 'big', sub, maxDist: D });
    lab('rf', '寄存器堆', '< 1 ns · 约 1 KB', new THREE.Vector3(-0.5, 0.45, -0.35));
    lab('l1', 'L1 缓存', '~1 ns · 48 KB', new THREE.Vector3(-0.75, 0.35, 0.3));
    lab('l2', 'L2 缓存', '~4 ns · 2 MB', new THREE.Vector3(0.2, 0.5, -0.65));
    lab('l3', 'L3 缓存(所有核心共享)', '~12 ns · 32 MB', new THREE.Vector3(0.9, 0.4, 0.55));
    lab('imc', '内存控制器', '通往内存条', new THREE.Vector3(-0.9, 0.35, 0.75));
    L.callout(cpu.group, '一个 CPU 核心', cpu.regionCenter('core0'), new THREE.Vector3(0.5, 0.6, -0.75), { maxDist: D });
  }

  /* ================================================================ */
  lock() { this.busy = true; this.ui.setButtonsEnabled(false); }
  unlock() { this.busy = false; this.ui.setButtonsEnabled(true); }

  async liftIhs(up) {
    if (up === this.ihsUp) return;
    this.ihsUp = up;
    const ihs = this.mb.cpu.ihs;
    const from = ihs.position.clone(), fromR = ihs.rotation.z;
    const to = up ? this.ihsBase.clone().add(new THREE.Vector3(4.6, 2.2, 0)) : this.ihsBase.clone();
    const toR = up ? -0.5 : 0;
    await this.tweens.to(1.2, t => {
      ihs.position.lerpVectors(from, to, t);
      ihs.position.y += Math.sin(t * Math.PI) * 1.2;
      ihs.rotation.z = lerp(fromR, toR, t);
    });
  }

  flashRegion(k, color = null, dur = 0.7) {
    const r = this.regions[k];
    r.mat.color.set(color ?? r.col).multiplyScalar(3);
    return this.tweens.to(dur, t => { r.mat.opacity = Math.sin(t * Math.PI) * 0.85; });
  }

  /** 沿路径移动数据包,并留下发光轨迹 */
  async travel(points, dur, color = 0xffd479, small = false) {
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const p = this.packet;
    p.visible = true;
    p.scale.setScalar(small ? 0.28 : 1);
    p.material.color.set(color).multiplyScalar(10);
    p.children[0].material.color.set(color);
    const trailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending });
    const trail = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, points.length * 12), small ? 0.012 : 0.045, 6), trailMat);
    this.scene.add(trail);
    const n = trail.geometry.index.count;
    trail.geometry.setDrawRange(0, 0);
    trailMat.opacity = 0.8;
    await this.tweens.to(dur, t => {
      p.position.copy(curve.getPoint(t));
      trail.geometry.setDrawRange(0, Math.floor(n * t / 6) * 6);
    });
    this.tweens.to(1.2, t => { trailMat.opacity = 0.8 * (1 - t); }).then(() => {
      this.scene.remove(trail);
      trail.geometry.dispose();
      trailMat.dispose();
    });
  }

  /* 世界坐标路径 */
  pathCpuToDimm() {
    const c = this.cpuOrigin;
    return [c.clone().add(new THREE.Vector3(0, 0.4, 0)), new THREE.Vector3(-0.6, BT, -5.0), new THREE.Vector3(3.9, BT, -5.0), new THREE.Vector3(5.1, BT + 1.2, -4.6), new THREE.Vector3(5.1, BT + 3.0, -4.6)];
  }
  pathPchToCpu() {
    const c = this.cpuOrigin;
    return [new THREE.Vector3(POS.pch.x, BT + 1.0, POS.pch.z), new THREE.Vector3(4.0, BT, 5.0), new THREE.Vector3(4.0, BT, 1.0), new THREE.Vector3(-0.2, BT, -1.2), new THREE.Vector3(-0.2, BT, -2.4), c.clone().add(new THREE.Vector3(0, 0.4, 0))];
  }
  pathHddToPch() {
    const pts = [new THREE.Vector3(HDD_POS.x, HDD.H + 0.4, HDD_POS.z), new THREE.Vector3(HDD_POS.x - 4, 1.6, HDD_POS.z + 2.2)];
    [...this.cablePts].reverse().forEach(p => pts.push(p.clone().add(new THREE.Vector3(0, 0.12, 0))));
    pts.push(new THREE.Vector3(10.8, BT, POS.sata.z - 0.8), new THREE.Vector3(6.4, BT, 6.8), new THREE.Vector3(POS.pch.x, BT + 1.0, POS.pch.z));
    return pts;
  }
  pathSsdToCpu() {
    const c = this.cpuOrigin;
    return [new THREE.Vector3(POS.m2.x + 1.5, BT + 0.6, POS.m2.z), new THREE.Vector3(-4.0, BT, 3.2), new THREE.Vector3(-4.0, BT, -1.0), new THREE.Vector3(-3.4, BT, -2.4), c.clone().add(new THREE.Vector3(0, 0.4, 0))];
  }
  pathDie(keys) { return keys.map(k => this.regions[k].world.clone()); }

  setTier(key, state) {
    if (state === null) delete this.tierState[key];
    else this.tierState[key] = state;
    this.updateHud();
  }

  addTime(ns, dur = 0.6) {
    const from = this.elapsed, to = this.elapsed + ns;
    return this.tweens.to(dur, t => { this.elapsed = from + (to - from) * t; this.updateHud(); });
  }

  resetRun() {
    this.tierState = {};
    this.elapsed = 0;
    this.updateHud();
  }

  async toDie() {
    this.ui.setActiveView(1);
    await Promise.all([this.ui.flyTo(this.views[1].pos, this.views[1].target, 1.8), this.liftIhs(true)]);
  }

  async journey(src) {
    if (this.busy) return;
    this.lock();
    this.resetRun();
    const ui = this.ui;
    ui.status('① CPU 执行一条指令,需要一个数据 → 先在芯片内部由近及远查找', 0);
    await this.toDie();

    // 逐级未命中
    const order = ['rf', 'l1', 'l2', 'l3'];
    for (let i = 0; i < order.length; i++) {
      const k = order[i];
      const tier = TIERS.find(t => t.key === k);
      if (i > 0) await this.travel(this.pathDie([order[i - 1], k]), 0.45, 0xff6b6b, true);
      else { this.packet.position.copy(this.regions[k].world); this.packet.scale.setScalar(0.28); this.packet.visible = true; }
      ui.status(`查找 ${tier.name} …… <b style="color:#ff8080">未命中 (Miss)</b>`, 0);
      this.setTier(k, 'miss');
      await Promise.all([this.flashRegion(k, 0xff4040, 0.6), this.addTime(tier.ns, 0.5)]);
    }
    await this.travel(this.pathDie(['l3', 'imc']), 0.5, 0xff6b6b, true);

    if (src === 'hdd') {
      // 内存也没有 → 缺页
      ui.setActiveView(0);
      this.flyWide();
      ui.status('② 经内存控制器去内存条查找……<b style="color:#ff8080">也没有</b> → 触发"缺页",操作系统向硬盘发起读请求', 0);
      await this.travel(this.pathCpuToDimm(), 1.4, 0xff6b6b);
      this.setTier('dram', 'miss');
      await this.addTime(80, 0.4);
      await this.travel([...this.pathCpuToDimm()].reverse().concat([...this.pathPchToCpu()].reverse().slice(1)), 2.0, 0xff6b6b);
      await this.travel([...this.pathHddToPch()].reverse(), 2.2, 0xff6b6b);
      // 硬盘机械动作
      ui.status('③ 机械硬盘:磁头寻道 + 等待盘片转到位 ≈ <b>8 ms</b>。在 CPU 看来,这相当于等了 <b>3 个月</b>!', 0);
      this.setTier('hdd', 'on');
      this.packet.visible = false;
      const led = this.hddLed.material.color;
      await Promise.all([
        this.addTime(8e6, 3.2),
        this.tweens.to(3.2, t => { led.set(Math.sin(t * 60) > 0 ? 0x40ff70 : 0x113311).multiplyScalar(Math.sin(t * 60) > 0 ? 6 : 1); }),
      ]);
      led.set(0x113311);
      this.setTier('hdd', 'hit');
      ui.status('④ 数据经 SATA 线 → 芯片组 → CPU,由 DMA 直接写入<b>内存</b>(同时以 4 KB 为单位,把相邻数据也一起读进来)', 0);
      await this.travel(this.pathHddToPch(), 2.2, 0xffd479);
      await this.travel(this.pathPchToCpu().concat(this.pathCpuToDimm().slice(1)), 2.0, 0xffd479);
    } else {
      ui.setActiveView(0);
      this.flyWide();
      ui.status('② 内存里也没有 → 操作系统向 <b>NVMe SSD</b> 发起读请求(SSD 经 PCIe 直连 CPU,不绕芯片组)', 0);
      await this.travel(this.pathCpuToDimm(), 1.2, 0xff6b6b);
      this.setTier('dram', 'miss');
      await this.addTime(80, 0.4);
      await this.travel([...this.pathCpuToDimm()].reverse().concat([...this.pathSsdToCpu()].reverse().slice(1)), 2.0, 0xff6b6b);
      ui.status('③ SSD:主控查映射表、从 NAND 读出一页并 ECC 纠错 ≈ <b>80 µs</b> —— 比机械硬盘快 100 倍,但仍比内存慢 1000 倍', 0);
      this.setTier('ssd', 'on');
      this.packet.visible = false;
      await this.addTime(80e3, 2.2);
      this.setTier('ssd', 'hit');
      ui.status('④ 数据经 PCIe 通道进入 CPU,由 DMA 写入<b>内存</b>', 0);
      await this.travel(this.pathSsdToCpu().concat(this.pathCpuToDimm().slice(1)), 2.2, 0xffd479);
    }
    this.setTier('dram', 'hit');
    await this.addTime(80, 0.3);

    // 逐级向上复制
    ui.status('⑤ CPU 从内存读取:数据被<b>逐级复制</b>到 L3 → L2 → L1,最后进入寄存器参与运算', 0);
    await this.travel([...this.pathCpuToDimm()].reverse(), 1.2, 0xffd479);
    await this.toDie();
    const up = ['imc', 'l3', 'l2', 'l1', 'rf'];
    for (let i = 1; i < up.length; i++) {
      await this.travel(this.pathDie([up[i - 1], up[i]]), 0.55, 0xffd479, true);
      const k = up[i];
      this.setTier(k, 'hit');
      this.flashRegion(k, 0x60ff9a, 0.8);
    }
    this.packet.visible = false;
    const total = fmt(this.elapsed);
    ui.status(`✅ 完成!总耗时 <b>${total}</b>,其中 99.9% 花在${src === 'hdd' ? '机械硬盘' : 'SSD'}上。现在数据已在各级缓存里 —— 下次再用就是"缓存命中",只需 1 ns`, 12000);
    this.unlock();
  }

  flyWide() {
    return this.ui.flyTo(this.views[0].pos, this.views[0].target, 1.8);
  }

  async cacheHit() {
    if (this.busy) return;
    this.lock();
    this.resetRun();
    this.ui.status('缓存命中:CPU 需要的数据刚刚用过,还在 L1 缓存里……', 0);
    await this.toDie();
    this.packet.position.copy(this.regions.l1.world);
    this.packet.scale.setScalar(0.28);
    this.packet.visible = true;
    this.setTier('rf', 'miss');
    await this.flashRegion('rf', 0xff4040, 0.5);
    this.setTier('l1', 'hit');
    this.flashRegion('l1', 0x60ff9a, 0.9);
    await this.addTime(1, 0.4);
    await this.travel(this.pathDie(['l1', 'rf']), 0.6, 0x60ff9a, true);
    this.packet.visible = false;
    this.ui.status('✅ L1 命中,只需约 <b>1 ns</b>!程序访问数据有"局部性"(刚用过的、相邻的很快还会用),所以 L1 命中率通常超过 90%,这正是电脑"感觉很快"的秘诀', 10000);
    this.unlock();
  }

  updateHud() {
    const rows = TIERS.map(t => {
      const w = Math.max(6, ((Math.log10(t.ns) + 1) / 8) * 100);
      const st = this.tierState[t.key] || '';
      return `<div class="tier ${st}"><span class="name">${t.name}</span><span class="bar" style="width:${w}%"></span><span class="lat">${fmt(t.ns)}</span></div>`;
    }).join('');
    this.ui.setHud(`
      <h3>🏛️ 存储层级 · 访问延迟</h3>
      <div class="ladder">${rows}</div>
      <div class="row" style="margin-top:8px"><span>本次累计耗时</span><b>${this.elapsed ? fmt(this.elapsed) : '—'}</b></div>
      <div class="muted">条长为对数刻度:每格相差 10 倍</div>
    `);
  }

  update(dt) {
    this.time += dt;
    this.tweens.update(dt);
  }

  dispose() { this.tweens.clear(); }
}
