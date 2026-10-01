import * as THREE from 'three';
import { Tweens, easeInOut, easeOut, makeElectron, lerp } from '../utils.js';
import { setupStage } from '../lib/stage.js';
import { LabelSet } from '../lib/labels.js';
import * as M from '../lib/materials.js';
import { mesh, extrudeUpright, tube } from '../lib/geom.js';
import { canvasTex } from '../lib/textures.js';
import { buildHdd, HDD, armAngleForRadius, headPos } from '../models/hdd.js';

/**
 * 机械硬盘 HDD:
 *  工位 A —— 开盖的 3.5" 硬盘整机(盘片、主轴、磁头臂、音圈电机、停泊坡道、柔性排线)
 *  工位 B —— 垂直磁记录微观结构(磁性晶粒、软磁底层、写磁极、TMR 读传感器)
 */
const MICRO_X = 30;              // 微观工位位置
const SLOW = 1 / 320;            // 演示时把转速放慢的倍数
const TWO_PI = Math.PI * 2;
const MICRO_CENTER = new THREE.Vector3(MICRO_X, 2, 0);
const wrap = a => ((a % TWO_PI) + TWO_PI) % TWO_PI;

export class HddScene {
  constructor({ camera, controls, ui, env }) {
    this.scene = new THREE.Scene();
    this.ui = ui;
    this.camera = camera;
    this.controls = controls;
    this.tweens = new Tweens();
    this.labels = new LabelSet();
    this.bloom = { strength: 0.7, radius: 0.45 };
    this.exposure = 1.0;
    this.time = 0;
    this.busy = false;
    this.rpm = 7200;
    this.speedMul = 1;
    this.psi = 0;                 // 盘片转角
    this.parked = false;

    setupStage(this.scene, env, {
      shadowBox: 30, shadowCenter: [MICRO_X / 2, 0, 0], mapSize: 4096,
      keyPos: [10, 30, 18], floorRadius: 80,
    });

    this.buildDrive();
    this.buildMicro();
    this.buildOverlay();

    camera.position.set(10, 14, 18);
    controls.target.set(-0.8, 0.8, 0);
    controls.minDistance = 2;
    controls.maxDistance = 90;

    this.views = [
      { label: '整机', pos: [10, 14, 18], target: [-0.8, 0.8, 0] },
      { label: '俯视', pos: [-1.0, 22, 0.6], target: [-1.0, 0, 0] },
      { label: '磁头特写', pos: [-1.6, 3.4, 1.4], target: [0.6, 1.9, -1.9] },
      { label: '音圈电机', pos: [9.5, 6, 6.5], target: [4.8, 1.4, 2.4] },
      { label: '磁记录微观', pos: [MICRO_X - 2.5, 7.5, 13.5], target: [MICRO_X - 0.5, 2.2, 0], onSelect: () => this.enterMicro() },
    ];
    ui.setViews(this.views, 0);

    ui.setInfo('机械硬盘 HDD 的工作原理', `
      <p>HDD 把数据记录在<b>高速旋转的盘片</b>表面极薄的磁性涂层上,靠纯机械动作读写:</p>
      <p>· <b>盘片</b>:铝或玻璃基板,镜面抛光,3.5" 盘直径 95 mm;本模型 3 张盘片 = 6 个记录面<br>
      · <b>主轴电机</b>:5400 / 7200 / 15000 转/分钟(7200 RPM = 每秒 120 圈)<br>
      · <b>磁头</b>:位于悬臂末端的陶瓷<b>滑块</b>,靠盘面高速气流"飞"在盘面上方仅 <b>1~3 纳米</b>处<br>
      · <b>音圈电机 (VCM)</b>:线圈处在两块强磁铁之间,通电后推动整组磁头臂绕轴摆动,完成<b>寻道</b><br>
      · <b>停泊坡道</b>:断电时磁头滑上塑料坡道,避免与盘面接触</p>
      <p>访问一次数据 = <b>寻道</b>(~4~10 ms) + <b>旋转等待</b>(平均半圈,7200 RPM 约 4.2 ms) + <b>传输</b>。
      机械动作是毫秒级的,比 SSD 慢上百倍,但单位容量非常便宜。</p>
      <p>👉 点击"磁记录微观"视角,看比特是怎样写进磁性晶粒里的。</p>
    `);

    ui.setActions([
      { label: '🔍 读取一个随机扇区', onClick: () => this.access('read') },
      { label: '✏️ 写入一个扇区', onClick: () => this.access('write') },
      { label: '🅿️ 磁头停泊 / 加载', onClick: () => this.togglePark() },
      { label: '⚙️ 切换转速', onClick: () => this.toggleRpm() },
      { label: '🔧 合上 / 打开顶盖', onClick: () => this.toggleCover() },
      { label: '🔬 微观:写入 + 读出', onClick: () => this.microDemo() },
    ]);
    this.updateHud();
  }

  /* ================================================================ */
  /*  工位 A:整机                                                     */
  /* ================================================================ */
  buildDrive() {
    const hdd = buildHdd({ cover: true });
    this.hdd = hdd;
    hdd.group.position.y = 0.2;
    hdd.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(hdd.group);

    // 顶盖拆下,平放在硬盘后方
    this.coverOpenPos = new THREE.Vector3(0.5, -HDD.H + 0.08 + 0.005, -12.8);
    this.coverOpenRot = 0.06;
    hdd.coverGroup.position.copy(this.coverOpenPos);
    hdd.coverGroup.rotation.y = this.coverOpenRot;
    this.coverOn = false;

    // 初始:磁头加载到盘面中间磁道
    this.armTheta = armAngleForRadius(3.3);
    hdd.setArmAngle(this.armTheta);
    this.currentR = 3.3;

    // 磁头读写指示光点
    this.headGlow = makeElectron(0.05, 0x66e0ff);
    this.headGlow.visible = false;
    const topHead = hdd.heads[hdd.heads.length - 1];
    topHead.slider.add(this.headGlow);
    this.topHead = topHead;

    const L = this.labels, g = hdd.group, V = (x, y, z) => new THREE.Vector3(x, y, z);
    const D = 42;
    L.callout(g, '盘片', V(HDD.C.x - 2.6, 1.76, 2.6), V(-2.2, 2.6, 2.0), { sub: '玻璃基板 + 磁性记录层 · 镜面', maxDist: D });
    L.callout(g, '主轴电机 + 压盘', V(HDD.C.x, 1.86, 0), V(-1.0, 3.2, -1.2), { sub: '7200 RPM 恒速旋转', maxDist: D });
    L.callout(hdd.actuator, '磁头臂 (E 型块)', V(-2.0, 1.95, 0), V(0.4, 2.4, 0), { sub: '4 臂 · 6 磁头', maxDist: D });
    L.callout(hdd.actuator, '磁头滑块', V(-HDD.ARM, 1.79, 0), V(-0.4, 2.0, 0), { cls: 'gold', sub: '飞行高度 1~3 nm', maxDist: D });
    L.callout(g, '音圈电机 (VCM)', V(5.7, 2.15, 3.1), V(1.6, 2.4, 1.4), { sub: '线圈 + 钕铁硼磁铁', maxDist: D });
    L.callout(g, '停泊坡道', V(2.2, 2.05, -3.2), V(1.6, 1.8, -1.6), { sub: '断电时磁头停在这里', maxDist: D });
    L.callout(g, '柔性排线', V(6.0, 1.9, -0.6), V(1.6, 2.0, -1.4), { sub: '连接前置放大器', maxDist: D });
    L.callout(g, 'SATA 接口', V(7.5, 0.3, -1.4), V(2.0, 0.6, 0.0), { sub: '数据 7 针 + 电源 15 针', maxDist: D });
    L.callout(g, '顶盖', V(this.coverOpenPos.x - 3, this.coverOpenPos.y + HDD.H + 0.05, this.coverOpenPos.z + 2), V(-2, 1.8, 1.5), { sub: '已拆下 · 密封防尘', maxDist: D });
  }

  /** 盘面上的教学叠加层:目标磁道 + 目标扇区 */
  buildOverlay() {
    const yTop = HDD.PLATTER_Y[2] + HDD.T / 2 + 0.004;
    // 静止的目标磁道圈
    this.trackRing = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.03, 160),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0x66e0ff).multiplyScalar(1.6), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
    );
    this.trackRing.rotation.x = -Math.PI / 2;
    this.trackRing.position.set(HDD.C.x, yTop, HDD.C.y);
    this.hdd.group.add(this.trackRing);
    // 跟随盘片旋转的扇区
    this.sectorMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb347).multiplyScalar(3), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    this.sector = new THREE.Mesh(new THREE.RingGeometry(1, 1.1, 24, 1, 0, 0.14), this.sectorMat);
    this.sector.rotation.x = -Math.PI / 2;
    this.sector.position.y = yTop + 0.001;
    this.hdd.platterGroup.add(this.sector);
    this.secLen = 0.14;
  }

  setTarget(r, a0) {
    const w = 0.08;
    this.trackRing.geometry.dispose();
    this.trackRing.geometry = new THREE.RingGeometry(r - 0.012, r + 0.012, 200);
    this.sector.geometry.dispose();
    // RingGeometry 角度 φ 旋转到 XZ 后对应世界角 -φ
    this.sector.geometry = new THREE.RingGeometry(r - w / 2, r + w / 2, 24, 1, -a0 - this.secLen / 2, this.secLen);
  }

  headAngle() {
    const v = headPos(this.armTheta);
    return Math.atan2(v.y - HDD.C.y, v.x - HDD.C.x);
  }

  omega() { return (this.rpm / 60) * TWO_PI * SLOW * this.speedMul; }

  /** 臂摆动:加速-减速 + 末端微小的稳定振荡(track settling) */
  async seekTo(r, dur) {
    const from = this.armTheta, to = armAngleForRadius(r);
    await this.tweens.to(dur, t => {
      this.armTheta = lerp(from, to, t);
      this.hdd.setArmAngle(this.armTheta);
    });
    const amp = (to - from) * 0.025;
    await this.tweens.to(0.35, t => {
      this.armTheta = to + amp * Math.sin(t * Math.PI * 5) * (1 - t);
      this.hdd.setArmAngle(this.armTheta);
    }, { ease: x => x });
    this.armTheta = to;
    this.hdd.setArmAngle(to);
    this.currentR = r;
  }

  async access(kind) {
    if (this.busy) return;
    if (this.coverOn) { this.ui.status('先打开顶盖才能看到内部动作 →「合上 / 打开顶盖」'); return; }
    this.busy = true;
    this.ui.setButtonsEnabled(false);
    const ui = this.ui;

    if (this.parked) await this.loadHeads();

    const r = lerp(HDD.TRACK_MIN + 0.1, HDD.TRACK_MAX - 0.05, Math.random());
    const a0 = Math.random() * TWO_PI;
    const trackNo = Math.round((HDD.TRACK_MAX - r) / (HDD.TRACK_MAX - HDD.TRACK_MIN) * 480000);
    this.setTarget(r, a0);
    this.sectorMat.color.set(kind === 'read' ? 0x66e0ff : 0xffb347).multiplyScalar(3);
    this.trackRing.material.opacity = 0;
    this.sectorMat.opacity = 0;
    await this.tweens.to(0.4, t => { this.trackRing.material.opacity = t * 0.9; this.sectorMat.opacity = t; });

    // ① 寻道
    const dr = Math.abs(r - this.currentR);
    const seekMs = dr < 0.01 ? 0 : 0.8 + 7.5 * Math.sqrt(dr / (HDD.TRACK_MAX - HDD.TRACK_MIN));
    this.hudData = { track: trackNo, seek: seekMs, rot: null, xfer: null };
    this.updateHud();
    ui.status(`① 寻道:音圈电机通电,磁头臂摆向第 ${trackNo.toLocaleString()} 号磁道(真实耗时 ${seekMs.toFixed(1)} ms)`, 0);
    await this.seekTo(r, 0.45 + Math.sqrt(dr) * 0.55);

    // ② 旋转等待
    const h = this.headAngle();
    const diff = wrap(a0 + this.secLen / 2 - this.psi - h);
    const rotMs = diff / TWO_PI * 60000 / this.rpm;
    this.hudData.rot = rotMs;
    this.updateHud();
    ui.status(`② 旋转等待:磁头已对准磁道,等目标扇区随盘片转过来(这次需要转 ${(diff / TWO_PI * 360).toFixed(0)}°,约 ${rotMs.toFixed(2)} ms)`, 0);
    await this.waitAngle(diff);

    // ③ 传输(放慢)
    const xferMs = 0.03;
    this.hudData.xfer = xferMs;
    this.updateHud();
    this.headGlow.visible = true;
    const col = kind === 'read' ? 0x66e0ff : 0xffb347;
    this.headGlow.material.color.set(col).multiplyScalar(10);
    this.headGlow.children[0].material.color.set(col);
    ui.status(kind === 'read'
      ? '③ 读取:扇区从磁头下方掠过,TMR 传感器感知磁化方向的变化 → 还原出 4096 字节数据(演示已放慢)'
      : '③ 写入:写磁极通入脉冲电流,在扇区上留下新的磁化方向(演示已放慢)', 0);
    if (kind === 'read') ui.scope.show('磁头读出信号 (前置放大器输出)', { min: -1.4, max: 1.4, len: 200 });
    else ui.scope.show('写入电流', { min: -1.4, max: 1.4, len: 200, color: '#ffb347' });
    await this.tweens.to(0.25, t => { this.speedMul = 1 - t * 0.93; });
    const passDur = this.secLen * 1.25 / this.omega();
    let level = 1, smooth = 0, last = 0;
    await this.tweens.to(passDur, t => {
      if (t - last > 0.045) { last = t; if (Math.random() > 0.5) level = -level; }
      smooth += (level - smooth) * (kind === 'read' ? 0.35 : 0.9);
      ui.scope.push(smooth + (kind === 'read' ? (Math.random() - 0.5) * 0.12 : 0));
      this.sectorMat.opacity = 0.7 + Math.sin(this.time * 30) * 0.3;
    }, { ease: x => x });
    await this.tweens.to(0.35, t => { this.speedMul = 0.07 + t * 0.93; });
    this.speedMul = 1;
    this.headGlow.visible = false;

    const total = seekMs + rotMs + xferMs;
    ui.status(`✅ ${kind === 'read' ? '读取' : '写入'}完成:寻道 ${seekMs.toFixed(1)} ms + 旋转等待 ${rotMs.toFixed(2)} ms + 传输 ${xferMs} ms ≈ <b>${total.toFixed(1)} ms</b>。同样时间 CPU 能执行约 ${(total * 4e6 / 1e6).toFixed(0)} 千万条指令`, 9000);
    await this.tweens.to(0.8, t => { this.trackRing.material.opacity = 0.9 * (1 - t); this.sectorMat.opacity = 1 - t; }, { delay: 1.5 });
    ui.scope.hide();
    this.busy = false;
    ui.setButtonsEnabled(true);
  }

  /** 等待盘片再转过 angle 弧度 */
  waitAngle(angle) {
    return new Promise(res => { this.pendingAngle = { left: angle, res }; });
  }

  async togglePark() {
    if (this.busy) return;
    this.busy = true;
    this.ui.setButtonsEnabled(false);
    if (this.parked) {
      await this.loadHeads();
      this.ui.status('✅ 磁头已从坡道滑下并"起飞",悬浮在高速气流形成的空气轴承上');
    } else {
      this.ui.status('停泊:磁头臂摆向外圈,悬臂末端的提升片滑上塑料坡道 —— 磁头离开盘面,防止断电或摔落时划伤', 0);
      await this.seekTo(HDD.PARK_R, 1.1);
      this.parked = true;
      this.ui.status('✅ 已停泊。早期硬盘让磁头降落在盘片内圈的"着陆区",现代硬盘几乎都用坡道停泊 (Load/Unload)', 7000);
    }
    this.busy = false;
    this.ui.setButtonsEnabled(true);
  }

  async loadHeads() {
    this.ui.status('加载:盘片达到额定转速后,磁头才从坡道滑下,飞到盘面上', 0);
    await this.seekTo(3.6, 1.0);
    this.parked = false;
  }

  toggleRpm() {
    if (this.busy) return;
    const order = [5400, 7200, 10000, 15000];
    this.rpm = order[(order.indexOf(this.rpm) + 1) % order.length];
    const wait = 60000 / this.rpm / 2;
    this.ui.status(`转速切换为 <b>${this.rpm} RPM</b>(每秒 ${(this.rpm / 60).toFixed(0)} 圈)—— 平均旋转等待 = 半圈 = ${wait.toFixed(2)} ms。转得越快,等待越短`, 6000);
    this.updateHud();
  }

  async toggleCover() {
    if (this.busy) return;
    this.busy = true;
    this.ui.setButtonsEnabled(false);
    const cg = this.hdd.coverGroup;
    const from = cg.position.clone(), fromR = cg.rotation.y;
    const closing = !this.coverOn;
    const to = closing ? new THREE.Vector3(0, 0, 0) : this.coverOpenPos;
    const toR = closing ? 0 : this.coverOpenRot;
    const lift = 7;
    this.ui.status(closing ? '合上顶盖:硬盘内部是密封的(高端型号还充入氦气以减少空气阻力)' : '打开顶盖:⚠️ 真实硬盘开盖会进灰尘,一粒灰尘就比磁头飞行高度大上千倍!', 5000);
    await this.tweens.to(1.8, t => {
      cg.position.lerpVectors(from, to, t);
      cg.position.y += Math.sin(t * Math.PI) * lift;
      cg.rotation.y = lerp(fromR, toR, t);
      cg.rotation.z = Math.sin(t * Math.PI) * 0.25;
    });
    this.coverOn = closing;
    this.busy = false;
    this.ui.setButtonsEnabled(true);
  }

  updateHud() {
    const d = this.hudData;
    const f = (v, n = 2) => v == null ? '—' : v.toFixed(n) + ' ms';
    this.ui.setHud(`
      <h3>⏱️ 访问时间分解(真实值)</h3>
      <div class="row"><span>转速</span><b>${this.rpm} RPM</b></div>
      <div class="row"><span>平均旋转等待</span><b>${(30000 / this.rpm).toFixed(2)} ms</b></div>
      ${d ? `
      <div class="row"><span>目标磁道</span><b>#${d.track.toLocaleString()}</b></div>
      <div class="row"><span>① 寻道</span><b>${f(d.seek, 1)}</b></div>
      <div class="row"><span>② 旋转等待</span><b>${f(d.rot)}</b></div>
      <div class="row"><span>③ 传输 4KB</span><b>${f(d.xfer)}</b></div>
      ${d.xfer != null ? `<div class="row"><span>合计</span><b>${(d.seek + d.rot + d.xfer).toFixed(2)} ms</b></div>` : ''}
      ` : '<div class="muted">点击"读取一个随机扇区"开始</div>'}
      <div class="muted" style="margin-top:6px">画面中盘片转速放慢了约 ${Math.round(1 / SLOW)} 倍</div>
    `);
  }

  /* ================================================================ */
  /*  工位 B:垂直磁记录微观结构                                       */
  /* ================================================================ */
  buildMicro() {
    const g = new THREE.Group();
    g.position.set(MICRO_X, 0, 0);
    this.scene.add(g);
    this.micro = g;
    const LX = 15, LZ = 7;
    const L = this.labels, V = (x, y, z) => new THREE.Vector3(x, y, z);
    const D = 26;

    // 膜层(自下而上)
    const layers = [
      { name: '玻璃基板', h: 1.0, mat: new THREE.MeshPhysicalMaterial({ color: 0x8fb4c4, roughness: 0.08, metalness: 0, transmission: 0.0, transparent: true, opacity: 0.9, clearcoat: 1 }) },
      { name: '软磁底层 (SUL)', h: 0.45, mat: new THREE.MeshStandardMaterial({ color: 0x5b6069, metalness: 0.85, roughness: 0.35 }) },
      { name: '钌中间层 (Ru)', h: 0.12, mat: new THREE.MeshStandardMaterial({ color: 0x9a8a72, metalness: 0.9, roughness: 0.3 }) },
    ];
    let y = 0;
    layers.forEach(l => {
      const m = mesh(new THREE.BoxGeometry(LX, l.h, LZ), l.mat, 0, y + l.h / 2, 0, g);
      l.y = y; y += l.h;
      m.castShadow = true;
    });
    this.recY = y;                      // 记录层底面
    const recH = 0.62;
    // 晶界(非磁性氧化物基质)
    mesh(new THREE.BoxGeometry(LX, recH * 0.98, LZ), new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.8 }), 0, y + recH / 2, 0, g);

    // 磁性晶粒:六棱柱
    const S = 0.36;
    const cols = Math.floor(LX / S), rows = Math.floor(LZ / (S * 0.866));
    this.grainLX = cols * S;
    const grainGeo = new THREE.CylinderGeometry(S * 0.47, S * 0.47, recH, 6);
    const grainMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.0, envMapIntensity: 0.4 });
    // 让实例颜色带一点自发光,磁化方向在任何光照下都清晰可辨
    grainMat.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef USE_COLOR
          totalEmissiveRadiance += vColor.rgb * 0.3;
        #endif`);
    };
    const n = cols * rows;
    const grains = new THREE.InstancedMesh(grainGeo, grainMat, n);
    grains.castShadow = true;
    grains.receiveShadow = true;
    this.grainData = [];
    let k = 0;
    for (let rI = 0; rI < rows; rI++) {
      for (let c = 0; c < cols; c++) {
        const z = -LZ / 2 + S * 0.5 + rI * S * 0.866;
        const base = -this.grainLX / 2 + c * S + (rI % 2) * S * 0.5 + (Math.random() - 0.5) * 0.04;
        const track = z > -1.1 && z < 1.1 ? 1 : (z <= -1.25 ? 0 : (z >= 1.25 ? 2 : -1));
        this.grainData.push({ base, z: z + (Math.random() - 0.5) * 0.04, s: 0.85 + Math.random() * 0.25, m: 1, wraps: 0, track, k: k++ });
      }
    }
    this.grains = grains;
    this.bitLen = S * 3;               // 一个比特 ≈ 3 个晶粒长
    g.add(grains);
    this.offset = 0;
    this.writeBits = null;
    this.grainData.forEach(d => { d.m = d.track < 0 ? (Math.random() > 0.5 ? 1 : -1) : this.storedBit(d, d.base); });
    this.updateGrains(true);

    // 写入的位单元方向箭头(只在中间磁道显示)
    const arrowGeo = (() => {
      const shaft = new THREE.CylinderGeometry(0.035, 0.035, 0.42, 6); shaft.translate(0, -0.06, 0);
      const head = new THREE.ConeGeometry(0.09, 0.2, 10); head.translate(0, 0.24, 0);
      const parts = [shaft, head];
      const merged = new THREE.BufferGeometry();
      // 手工合并
      const pos = [], nor = [], idx = [];
      let off = 0;
      parts.forEach(p => {
        const ni = p.toNonIndexed ? p : p;
        const P = ni.attributes.position.array, N = ni.attributes.normal.array, I = ni.index.array;
        pos.push(...P); nor.push(...N);
        for (const i of I) idx.push(i + off);
        off += P.length / 3;
      });
      merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      merged.setIndex(idx);
      return merged;
    })();
    const nArrows = Math.ceil(this.grainLX / this.bitLen) + 1;
    this.arrows = new THREE.InstancedMesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), nArrows);
    this.arrowCount = nArrows;
    g.add(this.arrows);

    // 碳保护层 + 润滑层(半透明)
    y += recH;
    mesh(new THREE.BoxGeometry(LX, 0.07, LZ), new THREE.MeshStandardMaterial({ color: 0x1b1d22, transparent: true, opacity: 0.18, roughness: 0.5, depthWrite: false, envMapIntensity: 0.2 }), 0, y + 0.035, 0, g).castShadow = false;
    mesh(new THREE.BoxGeometry(LX, 0.03, LZ), new THREE.MeshStandardMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.08, roughness: 0.4, depthWrite: false, envMapIntensity: 0.2 }), 0, y + 0.085, 0, g).castShadow = false;
    this.surfY = y + 0.1;

    /* ---- 磁头(滑块尾端的薄膜读写元件) ---- */
    const headG = new THREE.Group();
    g.add(headG);
    const abs = this.surfY + 0.32;     // 气浮面高度(飞行间隙已夸张放大)
    this.absY = abs;
    const ceramic = M.ceramic(0x2b2e35);
    mesh(new THREE.BoxGeometry(4.6, 2.4, 4.4), ceramic, 4.1, abs + 1.2, 0, headG);
    const alumina = new THREE.MeshPhysicalMaterial({ color: 0xcfd8e3, transparent: true, opacity: 0.16, roughness: 0.1, clearcoat: 1, depthWrite: false });
    const alu = mesh(new THREE.BoxGeometry(3.6, 2.4, 4.4), alumina, 0.0, abs + 1.2, 0, headG);
    alu.castShadow = false;
    const permalloy = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 1, roughness: 0.25 });
    // 读取屏蔽层 S1 / S2 + TMR 传感器
    this.xr = 1.15;
    mesh(new THREE.BoxGeometry(0.16, 1.5, 3.0), permalloy, this.xr + 0.3, abs + 0.75, 0, headG);
    mesh(new THREE.BoxGeometry(0.16, 1.5, 3.0), permalloy, this.xr - 0.3, abs + 0.75, 0, headG);
    const tmr = new THREE.Group();
    tmr.position.set(this.xr, abs, 0);
    const tmrCols = [0x7a5cc7, 0xe0e6f0, 0x3fa7d6];
    tmrCols.forEach((c, i) => mesh(new THREE.BoxGeometry(0.12, 0.1, 0.7), new THREE.MeshStandardMaterial({ color: c, metalness: 0.6, roughness: 0.3, emissive: c, emissiveIntensity: 0.15 }), 0, 0.05 + i * 0.1, 0, tmr));
    headG.add(tmr);
    this.tmrGroup = tmr;
    // 写磁极(主极,尖端收窄)+ 返回极 + 线圈
    this.xw = -0.55;
    const poleShape = new THREE.Shape();
    poleShape.moveTo(-0.18, 0); poleShape.lineTo(0.18, 0); poleShape.lineTo(0.9, 0.9); poleShape.lineTo(0.9, 1.9); poleShape.lineTo(-0.9, 1.9); poleShape.lineTo(-0.9, 0.9); poleShape.closePath();
    const poleGeo = extrudeUpright(poleShape, 0.2);
    poleGeo.rotateY(Math.PI / 2);
    this.poleMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 1, roughness: 0.2, emissive: 0xff8844, emissiveIntensity: 0 });
    mesh(poleGeo, this.poleMat, this.xw, abs, 0, headG);
    const xret = -1.55;
    mesh(new THREE.BoxGeometry(0.22, 1.9, 3.2), permalloy, xret, abs + 0.95, 0, headG);
    mesh(new THREE.BoxGeometry(xret * -1 + this.xw + 0.3, 0.25, 1.6), permalloy, (xret + this.xw) / 2, abs + 1.9 + 0.1, 0, headG);
    this.coilMat = new THREE.MeshStandardMaterial({ color: 0xc8743a, metalness: 0.9, roughness: 0.3, emissive: 0xff7a30, emissiveIntensity: 0 });
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1]) {
        mesh(new THREE.BoxGeometry(0.22, 0.2, 0.22), this.coilMat, (xret + this.xw) / 2, abs + 0.85 + i * 0.32, side * (0.95 + i * 0.05), headG);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95 + i * 0.05, 0.05, 6, 40), this.coilMat);
      ring.position.set((xret + this.xw) / 2, abs + 0.85 + i * 0.32, 0);
      ring.rotation.x = Math.PI / 2;
      ring.scale.set(0.45, 1, 1);
      headG.add(ring);
    }

    // 写入磁场线(主极 → 穿过记录层 → 软磁底层 → 返回极)
    const dashTex = canvasTex(256, 16, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      for (let x = 0; x < w; x += 64) {
        const gr = ctx.createLinearGradient(x, 0, x + 40, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
        ctx.fillStyle = gr; ctx.fillRect(x, 0, 40, h);
      }
    }, { srgb: false });
    dashTex.wrapS = THREE.RepeatWrapping;
    dashTex.repeat.set(4, 1);
    this.fieldTex = dashTex;
    this.fieldMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff9a40).multiplyScalar(7), map: dashTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.fieldLines = new THREE.Group();
    const sulY = layers[1].y + layers[1].h / 2;
    for (const z of [-0.5, 0, 0.5]) {
      for (const depth of [0, 0.12]) {
        const pts = [
          V(this.xw, abs + 0.2, z * 0.4),
          V(this.xw, this.recY + 0.2, z * 0.6),
          V(this.xw - 0.1, sulY - depth, z),
          V((this.xw + xret) / 2 - 0.2, sulY - 0.08 - depth, z * 1.5),
          V(xret - 0.3, sulY - depth, z * 1.8),
          V(xret - 0.05, this.recY + 0.3, z * 1.9),
          V(xret, abs + 0.3, z * 1.9),
        ];
        const m = new THREE.Mesh(tube(pts, 0.03, 80, 6), this.fieldMat);
        this.fieldLines.add(m);
      }
    }
    this.fieldLines.position.copy(headG.position);
    g.add(this.fieldLines);

    // 标注
    const lx = -LX / 2;
    L.callout(g, '玻璃基板', V(lx, 0.5, LZ / 2), V(-1.6, 0.2, 1.4), { maxDist: D });
    L.callout(g, '软磁底层 SUL', V(lx, 1.22, LZ / 2), V(-1.8, 0.7, 1.4), { sub: '为写入磁场提供回路', maxDist: D });
    L.callout(g, '磁性记录层', V(lx + 0.6, this.recY + 0.4, LZ / 2), V(-2.4, 1.6, 1.2), { cls: 'gold', sub: 'CoCrPt 晶粒 · 每粒约 8 nm', maxDist: D });
    L.callout(g, '碳保护层 + 润滑层', V(lx + 1.4, this.surfY, LZ / 2), V(-2.2, 2.6, 0.8), { sub: '总厚度仅 ~3 nm', maxDist: D });
    L.callout(g, '写磁极 (主极)', V(this.xw, abs + 1.2, 0.9), V(-1.8, 3.0, 2.0), { cls: 'gold', sub: '尖端产生极强垂直磁场', maxDist: D });
    L.callout(g, '写线圈', V(-1.05, abs + 1.5, 1.05), V(-3.6, 2.0, 1.4), { sub: '电流方向决定写入 0/1', maxDist: D });
    L.callout(g, 'TMR 读传感器', V(this.xr, abs + 0.15, 0.35), V(1.2, 3.4, 2.2), { cls: 'cyan', sub: '隧穿磁阻:电阻随磁场变化', maxDist: D });
    L.callout(g, '滑块本体 (AlTiC 陶瓷)', V(4.1, abs + 2.4, 0), V(1.4, 1.6, 0), { maxDist: D });
    L.callout(g, '盘片运动方向 ←', V(-LX / 2 + 2, this.surfY, -LZ / 2), V(0, 0.6, -1.0), { line: false, maxDist: D });
    L.callout(g, '中间为当前磁道 · 橙 = 磁化向上 · 蓝 = 向下', V(0, 0, LZ / 2 + 0.6), V(0, -0.6, 0.4), { line: false, maxDist: D, cls: 'title' });
    L.callout(g, '飞行间隙 (已放大)', V(3.2, (abs + this.surfY) / 2, LZ / 2 - 1.2), V(1.5, -0.6, 2.0), { maxDist: D });
  }

  /** 磁道上原有数据:由位单元编号决定(同一个位单元的晶粒磁化一致) */
  storedBit(d, u) {
    const bitIdx = Math.floor(u / this.bitLen) + d.track * 1000;
    const h = Math.sin(bitIdx * 12.9898 + d.track * 78.233) * 43758.5453;
    return (h - Math.floor(h)) > 0.5 ? 1 : -1;
  }

  updateGrains(force = false) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Color(0xe0703a), down = new THREE.Color(0x3b7bd4), mid = new THREE.Color(0x555a63);
    const LX = this.grainLX;
    const yC = this.recY + 0.31;
    const writing = this.writeBits && this.microWriting;
    for (const d of this.grainData) {
      let x = d.base - this.offset;
      const w = Math.floor((x + LX / 2) / LX);
      x -= w * LX;
      if (w !== d.wraps) {
        // 从上游重新进入:换成"磁道上原有的数据"
        d.wraps = w;
        const u = d.base - w * LX;      // 该晶粒在盘面上的绝对坐标
        d.m = d.track < 0 ? (Math.random() > 0.5 ? 1 : -1) : this.storedBit(d, u);
        d.dirty = true;
      }
      if (writing && d.track === 1 && Math.abs(x - this.xw) < 0.2) {
        const nb = this.writeBits(x + this.offset) ;
        if (nb !== d.m) { d.m = nb; d.dirty = true; }
      }
      p.set(x, yC, d.z);
      s.set(d.s, 1, d.s);
      m4.compose(p, q, s);
      this.grains.setMatrixAt(d.k, m4);
      if (d.dirty || force) {
        this.grains.setColorAt(d.k, d.track < 0 ? mid : (d.m > 0 ? up : down));
        d.dirty = false;
      }
      d.x = x;
    }
    this.grains.instanceMatrix.needsUpdate = true;
    if (this.grains.instanceColor) this.grains.instanceColor.needsUpdate = true;

    // 每个位单元一个方向箭头(取该位置中间磁道晶粒的平均磁化)
    if (this.arrows) {
      const bl = this.bitLen;
      const phase = ((this.offset % bl) + bl) % bl;
      const kmin = Math.floor((-LX / 2 + phase) / bl);
      const sums = new Float32Array(this.arrowCount + 1);
      for (const d of this.grainData) {
        if (d.track !== 1) continue;
        const i = Math.floor((d.x + phase) / bl) - kmin;
        if (i >= 0 && i < this.arrowCount) sums[i] += d.m;
      }
      const c = new THREE.Color();
      const ax = new THREE.Vector3(1, 0, 0);
      for (let i = 0; i < this.arrowCount; i++) {
        const x = (i + kmin + 0.5) * bl - phase;
        const visible = x > -LX / 2 + 0.3 && x < LX / 2 - 0.3;
        const dir = sums[i] >= 0 ? 1 : -1;
        q.setFromAxisAngle(ax, dir > 0 ? 0 : Math.PI);
        p.set(x, this.surfY + 0.32, 0);
        s.setScalar(visible ? 1 : 0);
        m4.compose(p, q, s);
        this.arrows.setMatrixAt(i, m4);
        this.arrows.setColorAt(i, c.set(dir > 0 ? 0xffb07a : 0x8ec0ff).multiplyScalar(1.4));
      }
      this.arrows.instanceMatrix.needsUpdate = true;
      if (this.arrows.instanceColor) this.arrows.instanceColor.needsUpdate = true;
    }
  }

  /** TMR 读出信号:读头下方中间磁道晶粒的平均磁化 */
  readSignal() {
    let sum = 0, n = 0;
    for (const d of this.grainData) {
      if (d.track !== 1) continue;
      const dx = d.x - this.xr;
      if (Math.abs(dx) < 0.35) { const w = 1 - Math.abs(dx) / 0.35; sum += d.m * w; n += w; }
    }
    return n ? sum / n : 0;
  }

  enterMicro() {
    if (!this.ui.scope.visible) this.ui.scope.show('TMR 读传感器输出', { min: -1.3, max: 1.3, len: 260, refs: [{ v: 0, label: '0', color: 'rgba(255,255,255,0.25)' }] });
    this.microOn = true;
  }

  async microDemo() {
    if (this.busy) return;
    this.busy = true;
    this.ui.setButtonsEnabled(false);
    this.ui.setActiveView(4);
    await this.ui.flyTo(this.views[4].pos, this.views[4].target, 1.8);
    this.enterMicro();
    this.ui.status('盘片在磁头下方移动(←)。TMR 读传感器检测每个位单元的磁化方向:<b>橙 = 向上,蓝 = 向下</b>,示波器显示读出信号', 0);
    await this.tweens.sleep(4.0);

    // 写入一串数据:1011 0010 ...
    const pattern = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 0, 1, 0, 1];
    const startIdx = Math.floor((this.xw + this.offset) / this.bitLen);
    this.writeBits = u => {
      const idx = Math.floor(u / this.bitLen) - startIdx;
      return pattern[((idx % pattern.length) + pattern.length) % pattern.length] ? 1 : -1;
    };
    this.microWriting = true;
    this.ui.status('写入:线圈通入正/反向电流 → 主极尖端产生向下/向上的强磁场,穿过记录层进入软磁底层再回到返回极,把经过的晶粒磁化成同一方向', 0);
    await this.tweens.to(0.4, t => { this.fieldMat.opacity = t * 0.9; });
    await this.tweens.sleep(6.5);
    this.microWriting = false;
    await this.tweens.to(0.4, t => { this.fieldMat.opacity = 0.9 * (1 - t); });
    this.ui.status('✅ 写入完成。垂直磁记录让磁化方向"竖起来",比特可以排得更密 —— 如今单盘可存 2 TB 以上。断电后磁化方向保持不变,所以 HDD 是非易失存储', 9000);
    this.busy = false;
    this.ui.setButtonsEnabled(true);
  }

  /* ================================================================ */
  update(dt) {
    this.time += dt;
    this.tweens.update(dt);

    // 盘片旋转(俯视逆时针)
    const dA = this.omega() * dt;
    this.psi += dA;
    this.hdd.platterGroup.rotation.y = this.psi;
    if (this.pendingAngle) {
      this.pendingAngle.left -= dA;
      if (this.pendingAngle.left <= 0) { const r = this.pendingAngle.res; this.pendingAngle = null; r(); }
    }

    // 微观:介质移动
    const near = this.camera.position.distanceTo(MICRO_CENTER) < 40;
    if (near || this.microWriting) {
      this.offset += dt * 0.9;
      this.updateGrains();
      if (this.microOn && this.ui.scope.visible) this.ui.scope.push(this.readSignal() + (Math.random() - 0.5) * 0.08);
      const writing = this.microWriting;
      this.fieldTex.offset.x -= dt * 2.5;
      // 写入电流方向 → 磁极发光颜色
      if (writing) {
        const b = this.writeBits(this.xw + this.offset);
        this.poleMat.emissiveIntensity = 0.6;
        this.poleMat.emissive.set(b > 0 ? 0xff8844 : 0x4488ff);
        this.fieldMat.color.set(b > 0 ? 0xff9a40 : 0x5aa0ff).multiplyScalar(7);
        this.coilMat.emissiveIntensity = 0.8 + Math.sin(this.time * 20) * 0.2;
      } else {
        this.poleMat.emissiveIntensity *= 0.9;
        this.coilMat.emissiveIntensity *= 0.9;
      }
    } else if (this.microOn && !near) {
      this.microOn = false;
      if (!this.busy) this.ui.scope.hide();
    }
  }

  dispose() { this.tweens.clear(); }
}
