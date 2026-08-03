import * as THREE from 'three';
import { makeTextSprite, Tweens, easeInOut } from '../utils.js';

/**
 * 机械硬盘 HDD 原理:
 * 旋转的盘片(磁性涂层上的磁畴)+ 摆动的磁头臂
 * 演示:寻道 → 旋转等待 → 读取 / 写入(磁畴翻转)
 */
const TRACKS = [2.0, 2.6, 3.2, 3.8];   // 磁道半径
const SEGS = 48;                        // 每条磁道的扇区段数
const PIVOT_X = 6.1;                    // 磁头臂转轴位置
const ARM_LEN = 5.2;                    // 转轴到磁头距离

export class HddScene {
  constructor({ camera, controls, ui }) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e1a);
    this.ui = ui;
    this.tweens = new Tweens();
    this.time = 0;
    this.busy = false;
    this.platterAngle = 0;
    this.rpm = 7200;
    this.armAngle = this.armAngleForRadius(TRACKS[3]);

    camera.position.set(0, 9, 10);
    controls.target.set(0.6, 0, 0);

    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.75));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(4, 12, 6);
    this.scene.add(dir);
    const p1 = new THREE.PointLight(0x6688ff, 30, 40);
    p1.position.set(-6, 5, -4);
    this.scene.add(p1);

    this.buildPlatters();
    this.buildArm();
    this.buildLabels();

    ui.setInfo('机械硬盘 HDD 的工作原理', `
      <p>HDD 把数据记录在<b>盘片表面的磁性涂层</b>上,靠纯机械动作读写:</p>
      <p>· 盘片以 <b>5400~15000 转/分钟</b>高速旋转(本图 7200 RPM)<br>
      · 表面划分为一圈圈<b>磁道</b>,磁道再切成一段段<b>扇区</b>(传统 512B,现代 4KB)<br>
      · 每个比特是一小块<b>磁畴</b>:磁化方向一个朝向代表 0,另一个代表 1(图中蓝/橙两色)<br>
      · <b>磁头</b>悬浮在盘面上方仅约 <b>10 纳米</b>(相当于一架波音 747 贴地 1 毫米飞行!),读取时感应磁场方向,写入时用电磁铁翻转磁畴</p>
      <p>访问一次数据 = <b>寻道</b>(磁头臂摆到目标磁道,~10ms)+ <b>旋转等待</b>(目标扇区转到磁头下方,~4ms)+ 传输。
      机械动作是毫秒级的,比 SSD 慢上百倍 —— 但单位容量便宜得多,适合冷数据和大容量仓储。</p>
    `);

    ui.setActions([
      { label: '🔍 读取一个随机扇区', onClick: () => this.readSector() },
      { label: '✏️ 写入(翻转磁畴)', onClick: () => this.writeSector() },
      { label: '🐢/🐇 切换转速', onClick: () => this.toggleRpm() },
      { label: '🔬 俯视磁畴特写', onClick: () => this.topView(camera, controls) },
    ]);
  }

  // ---------- 盘片 ----------
  buildPlatters() {
    this.platterGroup = new THREE.Group();
    this.scene.add(this.platterGroup);

    const platterMat = new THREE.MeshStandardMaterial({
      color: 0x8a94a8, metalness: 0.9, roughness: 0.18,
      emissive: 0x222833, emissiveIntensity: 0.2,
    });

    // 下层盘片(纯装饰,体现多盘片结构)
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(4.15, 4.15, 0.07, 96), platterMat.clone());
    lower.position.y = -0.75;
    this.platterGroup.add(lower);

    // 主盘片
    const platter = new THREE.Mesh(new THREE.CylinderGeometry(4.15, 4.15, 0.07, 96), platterMat);
    this.platterGroup.add(platter);

    // 主轴
    const spindle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 1.6, 32),
      new THREE.MeshStandardMaterial({ color: 0x555f70, metalness: 0.8, roughness: 0.3 })
    );
    spindle.position.y = 0.1;
    this.platterGroup.add(spindle);

    // 磁道刻线
    for (const r of TRACKS) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.015, r + 0.015, 96),
        new THREE.MeshBasicMaterial({ color: 0x44506a, side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.045;
      this.platterGroup.add(ring);
    }

    // 磁畴段:4 条磁道 × 48 段
    this.domains = [];   // [track][seg] = { mesh, bit }
    const COL0 = new THREE.Color(0x3e7ec4);  // 磁化方向 A
    const COL1 = new THREE.Color(0xd4813a);  // 磁化方向 B
    this.COL0 = COL0; this.COL1 = COL1;
    for (let t = 0; t < TRACKS.length; t++) {
      const r = TRACKS[t];
      const row = [];
      const arc = (2 * Math.PI * r) / SEGS;
      for (let s = 0; s < SEGS; s++) {
        const bit = Math.random() > 0.5 ? 1 : 0;
        const geo = new THREE.BoxGeometry(arc * 0.62, 0.05, 0.34);
        const mat = new THREE.MeshStandardMaterial({
          color: bit ? COL1 : COL0,
          emissive: bit ? COL1 : COL0,
          emissiveIntensity: 0.35,
          roughness: 0.5,
        });
        const m = new THREE.Mesh(geo, mat);
        const ang = (s / SEGS) * Math.PI * 2;
        m.position.set(Math.cos(ang) * r, 0.06, Math.sin(ang) * r);
        m.rotation.y = -ang + Math.PI / 2;
        this.platterGroup.add(m);
        row.push({ mesh: m, bit });
      }
      this.domains.push(row);
    }
  }

  // ---------- 磁头臂 ----------
  buildArm() {
    this.armGroup = new THREE.Group();
    this.armGroup.position.set(PIVOT_X, 0.35, 0);
    this.scene.add(this.armGroup);

    // 转轴底座
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.6, 0.7, 32),
      new THREE.MeshStandardMaterial({ color: 0x3a4356, metalness: 0.7, roughness: 0.35 })
    );
    base.position.y = -0.15;
    this.armGroup.add(base);

    // 臂身(从转轴伸向盘片)
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(ARM_LEN, 0.12, 0.42),
      new THREE.MeshStandardMaterial({ color: 0xb8c2d4, metalness: 0.85, roughness: 0.25 })
    );
    arm.position.x = -ARM_LEN / 2;
    // 让臂逐渐变尖:简单用第二段
    this.armGroup.add(arm);

    // 磁头(臂尖)
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.16, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xffcc55, emissive: 0xcc8822, emissiveIntensity: 0.5, metalness: 0.6, roughness: 0.3 })
    );
    head.position.set(-ARM_LEN, -0.06, 0);
    this.armGroup.add(head);
    this.headMesh = head;

    const headLabel = makeTextSprite('磁头', { fontSize: 28, color: '#ffd479', scale: 0.9 });
    headLabel.position.set(-ARM_LEN, 0.7, 0);
    this.armGroup.add(headLabel);

    this.armGroup.rotation.y = this.armAngle;
  }

  buildLabels() {
    const mk = (text, x, y, z, color, scale = 0.9) => {
      const s = makeTextSprite(text, { fontSize: 28, color, scale });
      s.position.set(x, y, z);
      this.scene.add(s);
    };
    mk('盘片 (磁性涂层)', -3.4, 1.1, -3.2, '#aab8d0');
    mk('磁头臂 (音圈电机驱动)', 6.1, 1.5, 0, '#c8d4ec');
    mk('蓝/橙 = 磁畴两种磁化方向 = 0/1', 0, -1.6, 4.6, '#9fc3ff', 0.85);
    this.rpmSprite = null;
    this.setRpmLabel();
  }

  setRpmLabel() {
    if (this.rpmSprite) {
      this.scene.remove(this.rpmSprite);
      this.rpmSprite.material.map.dispose();
      this.rpmSprite.material.dispose();
    }
    this.rpmSprite = makeTextSprite(`转速: ${this.rpm} RPM`, {
      fontSize: 32, color: '#7ee0a3', bg: 'rgba(15,25,45,0.85)', scale: 1,
    });
    this.rpmSprite.position.set(-4.6, 2.2, 0);
    this.scene.add(this.rpmSprite);
  }

  /** 根据目标磁道半径解磁头臂角度 */
  armAngleForRadius(r) {
    // 磁头世界位置 = 转轴 + 旋转后的 (-ARM_LEN, 0, 0)
    // |P + R(θ)·(-L,0)|= r  →  余弦定理
    const cosA = (PIVOT_X * PIVOT_X + ARM_LEN * ARM_LEN - r * r) / (2 * PIVOT_X * ARM_LEN);
    return -Math.acos(THREE.MathUtils.clamp(cosA, -1, 1));
  }

  /** 磁头当前世界坐标(XZ 平面) */
  headWorldPos() {
    const v = new THREE.Vector3(-ARM_LEN, 0, 0);
    v.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.armGroup.rotation.y);
    v.x += PIVOT_X;
    return v;
  }

  /** 扇区段 s 当前的世界角度 */
  segWorldAngle(s) {
    return (s / SEGS) * Math.PI * 2 + this.platterAngle;
  }

  /** 访问流程:寻道 → 旋转等待 → 操作 */
  seekAndOperate(op) {
    if (this.busy) return;
    this.busy = true;
    this.ui.setButtonsEnabled(false);

    const track = Math.floor(Math.random() * TRACKS.length);
    const seg = Math.floor(Math.random() * SEGS);
    const targetAngle = this.armAngleForRadius(TRACKS[track]);
    const startAngle = this.armGroup.rotation.y;
    const seekDist = Math.abs(targetAngle - startAngle);

    this.ui.status(`① 寻道:音圈电机摆动磁头臂,移到第 ${track + 1} 号磁道(真实耗时约 3~12ms)…`, 0);

    this.tweens.add({
      duration: Math.max(0.7, seekDist * 3.2), ease: easeInOut,
      onUpdate: t => {
        this.armGroup.rotation.y = startAngle + (targetAngle - startAngle) * t;
      },
      onComplete: () => {
        this.armAngle = targetAngle;
        this.ui.status(`② 旋转等待:磁头已就位,等待目标扇区随盘片转到磁头正下方(平均约 ${Math.round(60000 / this.rpm / 2 * 10) / 10}ms)…`, 0);
        this.waitForSector(track, seg, () => op(track, seg));
      },
    });

    // 高亮目标扇区,方便观察
    const d = this.domains[track][seg];
    this.targetHighlight = d;
    d.mesh.scale.set(1.25, 2.2, 1.25);
  }

  /** 等待扇区转到磁头下(轮询角度差) */
  waitForSector(track, seg, onArrive) {
    const head = this.headWorldPos();
    const headAng = Math.atan2(head.z, head.x);
    this.pendingSector = { track, seg, headAng, onArrive };
  }

  checkPendingSector() {
    if (!this.pendingSector) return;
    const { seg, headAng, onArrive } = this.pendingSector;
    // 段的世界角(注意盘片绕 Y 轴旋转,Z = sin)
    const a = this.segWorldAngle(seg);
    const diff = ((a - headAng) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    if (diff < 0.06 || diff > Math.PI * 2 - 0.06) {
      const p = this.pendingSector;
      this.pendingSector = null;
      onArrive();
    }
  }

  readSector() {
    this.seekAndOperate((track, seg) => {
      // 短暂"暂停"盘片来展示读取瞬间(教学用,现实中不会停)
      const d = this.domains[track][seg];
      this.slowmo = true;
      this.ui.status(`③ 读取:磁头感应到该扇区磁畴的磁场方向 → 读出比特 ${d.bit}(演示放慢了盘片)`, 0);
      this.tweens.add({
        duration: 2.2,
        onUpdate: t => {
          this.headMesh.material.emissiveIntensity = 0.5 + Math.sin(t * Math.PI * 6) * 0.5;
        },
        onComplete: () => {
          this.finishOp(`✅ 读取完成:第 ${track + 1} 磁道该扇区的比特值为 ${d.bit}。整个过程 = 寻道 + 旋转等待 + 读取,毫秒量级`);
        },
      });
    });
  }

  writeSector() {
    this.seekAndOperate((track, seg) => {
      this.slowmo = true;
      this.ui.status('③ 写入:磁头线圈通电产生磁场,强行翻转下方磁畴的磁化方向(演示放慢了盘片)', 0);
      // 翻转目标段及相邻几段
      const row = this.domains[track];
      const targets = [seg, (seg + 1) % SEGS, (seg + 2) % SEGS];
      targets.forEach((s, i) => {
        const d = row[s];
        this.tweens.add({
          duration: 0.5, delay: 0.4 + i * 0.55,
          onUpdate: t => {
            d.mesh.material.emissiveIntensity = 0.35 + Math.sin(t * Math.PI) * 1.3;
            d.mesh.scale.y = 2.2 + Math.sin(t * Math.PI) * 1.5;
          },
          onComplete: () => {
            d.bit = 1 - d.bit;
            const col = d.bit ? this.COL1 : this.COL0;
            d.mesh.material.color.copy(col);
            d.mesh.material.emissive.copy(col);
            d.mesh.material.emissiveIntensity = 0.35;
            d.mesh.scale.y = i === 0 ? 2.2 : 1;
          },
        });
      });
      this.tweens.add({
        duration: 0.4 + 3 * 0.55 + 0.4,
        onUpdate: t => {
          this.headMesh.material.emissiveIntensity = 0.5 + Math.sin(t * Math.PI * 8) * 0.6;
        },
        onComplete: () => {
          this.finishOp('✅ 写入完成:3 个磁畴的颜色(磁化方向)已翻转。断电后磁畴方向保持不变,所以 HDD 也是非易失性存储');
        },
      });
    });
  }

  finishOp(msg) {
    this.slowmo = false;
    this.headMesh.material.emissiveIntensity = 0.5;
    if (this.targetHighlight) {
      this.targetHighlight.mesh.scale.set(1, 1, 1);
      this.targetHighlight = null;
    }
    this.busy = false;
    this.ui.setButtonsEnabled(true);
    this.ui.status(msg, 7000);
  }

  toggleRpm() {
    if (this.busy) return;
    const order = [5400, 7200, 15000];
    this.rpm = order[(order.indexOf(this.rpm) + 1) % order.length];
    this.setRpmLabel();
    const wait = Math.round(60000 / this.rpm / 2 * 10) / 10;
    this.ui.status(`转速切换为 ${this.rpm} RPM —— 转得越快,平均旋转等待越短(现在约 ${wait}ms),这正是高端硬盘更快的原因之一`, 6000);
  }

  topView(camera, controls) {
    const fromPos = camera.position.clone();
    const fromTarget = controls.target.clone();
    const toPos = new THREE.Vector3(2.9, 7.5, 0.01);
    const toTarget = new THREE.Vector3(2.9, 0, 0);
    this.tweens.add({
      duration: 1.2, ease: easeInOut,
      onUpdate: t => {
        camera.position.lerpVectors(fromPos, toPos, t);
        controls.target.lerpVectors(fromTarget, toTarget, t);
      },
    });
    this.ui.status('俯视视角:可以清楚看到磁道上一格格的磁畴(蓝/橙 = 0/1),磁头正悬浮在它们上方', 6000);
  }

  update(dt) {
    this.time += dt;
    this.tweens.update(dt);

    // 盘片旋转:演示转速做了大幅缩放(真实 7200RPM = 每秒 120 圈,肉眼无法分辨)
    const visualSpeed = (this.rpm / 7200) * (this.slowmo ? 0.12 : 1.6);
    this.platterAngle -= visualSpeed * dt;   // 注意:绕 Y 轴负向 → 世界角度增加方向需一致
    this.platterGroup.rotation.y = -this.platterAngle;

    this.checkPendingSector();
  }

  dispose() { this.tweens.clear(); }
}
