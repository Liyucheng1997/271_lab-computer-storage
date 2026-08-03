import * as THREE from 'three';
import { makeTextSprite, makeElectron, Tweens, easeInOut, easeOut } from '../utils.js';

/**
 * 固态硬盘 SSD (NAND 闪存) 原理:
 * 左侧 —— 浮栅晶体管剖面:电子隧穿进入"浮栅"被绝缘层困住 → 断电也不丢
 * 右侧 —— 闪存块/页阵列:按页写入、按块擦除、磨损计数
 */
export class SsdScene {
  constructor({ camera, controls, ui }) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e1a);
    this.ui = ui;
    this.tweens = new Tweens();
    this.time = 0;
    this.busy = false;
    this.programmed = false;   // 浮栅是否有电子
    this.powerOn = true;

    camera.position.set(0, 2, 15);
    controls.target.set(0, 0.8, 0);

    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(5, 10, 8);
    this.scene.add(dir);
    const p1 = new THREE.PointLight(0x44ffcc, 20, 30);
    p1.position.set(5, 4, 6);
    this.scene.add(p1);

    this.buildFloatingGate();
    this.buildBlockArray();

    ui.setInfo('固态硬盘 SSD (NAND 闪存) 的工作原理', `
      <p>SSD 没有任何机械部件,数据存在<b>浮栅晶体管</b>里:</p>
      <p>· <b>写入(编程)</b>:控制栅加约 20V 高压,电子凭<b>量子隧穿效应</b>穿过隧穿氧化层,进入<b>浮栅</b><br>
      · 浮栅四周全是<b>绝缘体</b>,电子被"关进笼子"——<b>断电十年也跑不掉</b>,这就是非易失性的来源<br>
      · <b>读取</b>:浮栅里有无电子会改变晶体管的导通阈值,测一下就知道是 0 还是 1<br>
      · <b>擦除</b>:反向加高压把电子拉出浮栅</p>
      <p>⚠️ 两个重要特性:<b>只能按"页"写入(约 16KB)、按"块"擦除(数 MB)</b>,修改旧数据必须先擦整块;
      高压隧穿会逐渐损伤氧化层,每个单元只能擦写<b>数千次</b>,所以 SSD 用<b>磨损均衡</b>算法把写入分摊到所有块上。</p>
    `);

    ui.setActions([
      { label: '⚡ 写入:电子隧穿入浮栅', onClick: () => this.program() },
      { label: '🧹 擦除:电子拉出浮栅', onClick: () => this.erase() },
      { label: '🔌 演示:断电后数据仍在', onClick: () => this.powerOff() },
      { label: '📄 演示:按页写入', onClick: () => this.writePages() },
      { label: '🧱 演示:按块擦除+磨损', onClick: () => this.eraseBlock() },
    ]);
  }

  // ---------- 左侧:浮栅晶体管剖面 ----------
  buildFloatingGate() {
    const g = new THREE.Group();
    g.position.set(-4.6, 0.6, 0);
    this.scene.add(g);
    this.fgGroup = g;

    const W = 4.2, D = 1.4;
    const layer = (h, y, color, emissive, opacity = 1) => {
      const mat = new THREE.MeshStandardMaterial({
        color, emissive: emissive ?? color, emissiveIntensity: 0.15,
        roughness: 0.4, metalness: 0.3,
        transparent: opacity < 1, opacity,
      });
      const m = new THREE.Mesh(new THREE.BoxGeometry(W, h, D), mat);
      m.position.y = y;
      g.add(m);
      return m;
    };

    // 衬底 + 源极/漏极
    layer(0.9, -1.55, 0x33475e);
    const sd = new THREE.MeshStandardMaterial({ color: 0x5577aa, emissive: 0x223355, emissiveIntensity: 0.4, roughness: 0.4 });
    const src = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, D + 0.02), sd);
    src.position.set(-W / 2 + 0.55, -1.3, 0);
    g.add(src);
    const drn = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, D + 0.02), sd.clone());
    drn.position.set(W / 2 - 0.55, -1.3, 0);
    g.add(drn);

    // 隧穿氧化层(薄,半透明)
    this.tunnelOxide = layer(0.18, -1.0, 0xbfd4e8, 0x88aacc, 0.45);
    // 浮栅
    this.floatingGate = layer(0.55, -0.6, 0xd4a34a, 0xaa7722);
    this.floatingGate.material.emissiveIntensity = 0.25;
    // 阻挡氧化层
    layer(0.18, -0.2, 0xbfd4e8, 0x88aacc, 0.45);
    // 控制栅
    this.controlGate = layer(0.55, 0.2, 0x9a66ff, 0x5522aa);

    const mk = (text, x, y, color) => {
      const s = makeTextSprite(text, { fontSize: 26, color, scale: 0.85 });
      s.position.set(x, y, 0);
      g.add(s);
    };
    mk('控制栅 (加高压)', W / 2 + 1.55, 0.2, '#c9a3ff');
    mk('绝缘氧化层', W / 2 + 1.3, -0.2, '#a8c8e8');
    mk('浮栅 ← 电子被困在这里', W / 2 + 1.95, -0.6, '#ffd479');
    mk('隧穿氧化层(超薄)', W / 2 + 1.6, -1.0, '#a8c8e8');
    mk('硅衬底', W / 2 + 1.1, -1.55, '#7e94b8');
    mk('源极', -W / 2 + 0.55, -1.95, '#9ab8e0');
    mk('漏极', W / 2 - 0.55, -1.95, '#9ab8e0');

    // 衬底中的自由电子(待注入)
    this.subElectrons = [];
    for (let i = 0; i < 8; i++) {
      const e = makeElectron(0.08, 0x55ccff);
      e.userData.home = new THREE.Vector3(-1.4 + i * 0.4, -1.32, 0.2 * ((i % 2) ? 1 : -1));
      e.position.copy(e.userData.home);
      g.add(e);
      this.subElectrons.push(e);
    }
    // 浮栅中的电子(初始为空)
    this.gateElectrons = [];
    for (let i = 0; i < 8; i++) {
      const e = makeElectron(0.08, 0xffee66);
      e.userData.home = new THREE.Vector3(-1.4 + i * 0.4, -0.6, 0.15 * ((i % 2) ? 1 : -1));
      e.position.copy(e.userData.home);
      e.visible = false;
      g.add(e);
      this.gateElectrons.push(e);
    }

    this.stateSprite = null;
    this.updateStateSprite();

    const title = makeTextSprite('浮栅晶体管剖面(1 个闪存单元)', { fontSize: 30, color: '#e8ecf4', scale: 0.95 });
    title.position.set(0, -2.6, 0);
    g.add(title);

    // 电源指示灯
    this.powerLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x33ff77 })
    );
    this.powerLight.position.set(-W / 2 - 0.7, 1.4, 0);
    g.add(this.powerLight);
    this.powerLabel = makeTextSprite('电源:开', { fontSize: 26, color: '#7ee0a3', scale: 0.85 });
    this.powerLabel.position.set(-W / 2 - 0.7, 1.85, 0);
    g.add(this.powerLabel);
  }

  updateStateSprite() {
    if (this.stateSprite) {
      this.fgGroup.remove(this.stateSprite);
      this.stateSprite.material.map.dispose();
      this.stateSprite.material.dispose();
    }
    const text = this.programmed
      ? '浮栅:有电子 → 已编程 (读出 0)'
      : '浮栅:无电子 → 已擦除 (读出 1)';
    this.stateSprite = makeTextSprite(text, {
      fontSize: 30,
      color: this.programmed ? '#ffd479' : '#7ee0a3',
      bg: 'rgba(15,25,45,0.85)',
      scale: 0.95,
    });
    this.stateSprite.position.set(0, 1.4, 0);
    this.fgGroup.add(this.stateSprite);
  }

  // ---------- 右侧:块/页阵列 ----------
  buildBlockArray() {
    const g = new THREE.Group();
    g.position.set(4.8, 0.6, 0);
    this.scene.add(g);
    this.blockGroup = g;

    // 2 个块,每块 4x4 = 16 页
    this.blocks = [];
    const PAGE = 0.52, GAP = 0.1, BLOCK_W = 4 * (PAGE + GAP);
    for (let b = 0; b < 2; b++) {
      const bg = new THREE.Group();
      bg.position.set(0, b === 0 ? 1.35 : -1.6, 0);
      g.add(bg);
      const pages = [];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const mat = new THREE.MeshStandardMaterial({
            color: 0x2a3a52,
            emissive: 0x44ff99,
            emissiveIntensity: 0,
            roughness: 0.4, metalness: 0.3,
          });
          const m = new THREE.Mesh(new THREE.BoxGeometry(PAGE, PAGE, 0.2), mat);
          m.position.set(
            c * (PAGE + GAP) - BLOCK_W / 2 + PAGE / 2,
            (1.5 - r) * (PAGE + GAP) - BLOCK_W / 2 + PAGE / 2 + 1.2,
            0
          );
          bg.add(m);
          pages.push({ mesh: m, written: false });
        }
      }
      // 块边框
      const frame = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(BLOCK_W + 0.15, BLOCK_W + 0.15, 0.25)),
        new THREE.LineBasicMaterial({ color: 0x6688cc, transparent: true, opacity: 0.6 })
      );
      frame.position.set(-GAP / 2, 1.2 - GAP / 2, 0);
      bg.add(frame);

      const lbl = makeTextSprite(`块 ${b} (擦写次数: 0)`, { fontSize: 26, color: '#9fc3ff', scale: 0.85 });
      lbl.position.set(0, 1.2 + BLOCK_W / 2 + 0.35, 0);
      bg.add(lbl);
      this.blocks.push({ group: bg, pages, wear: 0, label: lbl });
    }

    const title = makeTextSprite('闪存阵列:小格 = 页 · 大框 = 块', { fontSize: 28, color: '#e8ecf4', scale: 0.9 });
    title.position.set(0, -3.4, 0);
    g.add(title);
  }

  setBlockLabel(b) {
    const blk = this.blocks[b];
    const old = blk.label;
    const pos = old.position.clone();
    blk.group.remove(old);
    old.material.map.dispose();
    old.material.dispose();
    blk.label = makeTextSprite(`块 ${b} (擦写次数: ${blk.wear})`, {
      fontSize: 26,
      color: blk.wear >= 3 ? '#f0a35e' : '#9fc3ff',
      scale: 0.85,
    });
    blk.label.position.copy(pos);
    blk.group.add(blk.label);
  }

  // ---------- 动画:编程(写入) ----------
  program() {
    if (this.busy) return;
    if (!this.powerOn) { this.restorePower(); return; }
    if (this.programmed) {
      this.ui.status('浮栅里已有电子(已编程)。闪存不能直接覆盖写,请先"擦除"再写入');
      return;
    }
    this.busy = true;
    this.ui.setButtonsEnabled(false);
    this.ui.status('编程:控制栅加 ~20V 高压,电场把电子"拽"过超薄氧化层 —— 量子隧穿!', 0);

    // 控制栅发光
    this.tweens.add({
      duration: 0.6,
      onUpdate: t => { this.controlGate.material.emissiveIntensity = 0.15 + t * 1.2; },
    });

    // 电子从衬底穿过氧化层进入浮栅
    this.subElectrons.forEach((e, i) => {
      const target = this.gateElectrons[i].userData.home;
      this.tweens.add({
        duration: 1.1, delay: 0.5 + i * 0.12, ease: easeInOut,
        onUpdate: t => {
          e.position.x = e.userData.home.x + (target.x - e.userData.home.x) * t;
          e.position.y = e.userData.home.y + (target.y - e.userData.home.y) * t;
          e.position.z = e.userData.home.z + (target.z - e.userData.home.z) * t;
          // 穿过氧化层时闪光
          if (Math.abs(e.position.y + 1.0) < 0.12) {
            this.tunnelOxide.material.emissiveIntensity = 1.2;
          }
        },
        onComplete: () => {
          e.visible = false;
          this.gateElectrons[i].visible = true;
        },
      });
    });

    this.tweens.add({
      duration: 0.5 + 8 * 0.12 + 1.3,
      onUpdate: () => { this.tunnelOxide.material.emissiveIntensity *= 0.95; },
      onComplete: () => {
        this.tunnelOxide.material.emissiveIntensity = 0.15;
        this.programmed = true;
        this.updateStateSprite();
        this.tweens.add({
          duration: 0.6,
          onUpdate: t => { this.controlGate.material.emissiveIntensity = 1.35 - t * 1.2; },
        });
        this.busy = false;
        this.ui.setButtonsEnabled(true);
        this.ui.status('✅ 电子已被困在浮栅中!四周都是绝缘体,不通电它们也逃不出去 —— 数据被"冻结"了');
      },
    });
  }

  // ---------- 动画:擦除 ----------
  erase() {
    if (this.busy) return;
    if (!this.powerOn) { this.restorePower(); return; }
    if (!this.programmed) {
      this.ui.status('浮栅本来就是空的(已擦除状态),先"写入"再试试擦除');
      return;
    }
    this.busy = true;
    this.ui.setButtonsEnabled(false);
    this.ui.status('擦除:衬底加高压(反向电场),把浮栅里的电子重新拉回衬底', 0);

    this.gateElectrons.forEach((e, i) => {
      const target = this.subElectrons[i].userData.home;
      this.tweens.add({
        duration: 1.0, delay: 0.3 + i * 0.1, ease: easeInOut,
        onUpdate: t => {
          const h = e.userData.home;
          e.position.set(
            h.x + (target.x - h.x) * t,
            h.y + (target.y - h.y) * t,
            h.z + (target.z - h.z) * t
          );
          if (Math.abs(e.position.y + 1.0) < 0.12) {
            this.tunnelOxide.material.emissiveIntensity = 1.2;
          }
        },
        onComplete: () => {
          e.visible = false;
          e.position.copy(e.userData.home);
          this.subElectrons[i].visible = true;
        },
      });
    });

    this.tweens.add({
      duration: 0.3 + 8 * 0.1 + 1.2,
      onUpdate: () => { this.tunnelOxide.material.emissiveIntensity *= 0.95; },
      onComplete: () => {
        this.tunnelOxide.material.emissiveIntensity = 0.15;
        this.programmed = false;
        this.updateStateSprite();
        this.busy = false;
        this.ui.setButtonsEnabled(true);
        this.ui.status('✅ 擦除完成。注意:每次高压隧穿都会轻微损伤氧化层,这就是闪存寿命有限的原因');
      },
    });
  }

  // ---------- 动画:断电 ----------
  powerOff() {
    if (this.busy) return;
    if (!this.programmed) {
      this.ui.status('请先"写入"让浮栅存入电子,再演示断电效果');
      return;
    }
    this.busy = true;
    this.ui.setButtonsEnabled(false);
    this.powerOn = false;
    this.ui.status('断电!SSD 完全失去供电……但浮栅四周都是绝缘体,电子依然被困着', 0);

    this.powerLight.material.color.set(0xff4444);
    this.setPowerLabel('电源:关', '#f08a8a');

    // 场景变暗
    this.tweens.add({
      duration: 1.2,
      onUpdate: t => {
        this.scene.background.setRGB(
          0.04 * (1 - t * 0.7),
          0.055 * (1 - t * 0.7),
          0.1 * (1 - t * 0.7)
        );
      },
      onComplete: () => {
        this.tweens.add({
          duration: 1.5, delay: 1.2,
          onUpdate: () => {},
          onComplete: () => {
            // 恢复供电
            this.tweens.add({
              duration: 1.0,
              onUpdate: t => {
                this.scene.background.setRGB(
                  0.04 * (0.3 + t * 0.7),
                  0.055 * (0.3 + t * 0.7),
                  0.1 * (0.3 + t * 0.7)
                );
              },
              onComplete: () => {
                this.powerOn = true;
                this.powerLight.material.color.set(0x33ff77);
                this.setPowerLabel('电源:开', '#7ee0a3');
                this.busy = false;
                this.ui.setButtonsEnabled(true);
                this.ui.status('✅ 重新通电:电子一个没少,数据完好无损!对比 DRAM 断电即失,这就是 SSD 能长期存数据的原因');
              },
            });
          },
        });
        this.ui.status('看!黄色电子仍然稳稳待在浮栅里 —— 正在恢复供电…', 0);
      },
    });
  }

  setPowerLabel(text, color) {
    const pos = this.powerLabel.position.clone();
    this.fgGroup.remove(this.powerLabel);
    this.powerLabel.material.map.dispose();
    this.powerLabel.material.dispose();
    this.powerLabel = makeTextSprite(text, { fontSize: 26, color, scale: 0.85 });
    this.powerLabel.position.copy(pos);
    this.fgGroup.add(this.powerLabel);
  }

  restorePower() {
    this.ui.status('正在演示断电,请稍候…');
  }

  // ---------- 动画:按页写入 ----------
  writePages() {
    if (this.busy) return;
    this.busy = true;
    this.ui.setButtonsEnabled(false);
    const blk = this.blocks[0];
    const empty = blk.pages.filter(p => !p.written);
    if (empty.length === 0) {
      this.ui.status('块 0 已写满!要继续写就得先"按块擦除" →', 5000);
      this.busy = false;
      this.ui.setButtonsEnabled(true);
      return;
    }
    const count = Math.min(5, empty.length);
    this.ui.status(`按页写入:SSD 一次写入一整页(约 16KB),正在写入 ${count} 页…`, 0);
    for (let i = 0; i < count; i++) {
      const p = empty[i];
      this.tweens.add({
        duration: 0.5, delay: i * 0.35, ease: easeOut,
        onUpdate: t => {
          p.mesh.material.emissiveIntensity = t * 1.2;
        },
        onComplete: () => {
          p.written = true;
          p.mesh.material.emissiveIntensity = 0.55;
          p.mesh.material.color.set(0x1f4d38);
        },
      });
    }
    this.tweens.add({
      duration: count * 0.35 + 0.7,
      onUpdate: () => {},
      onComplete: () => {
        this.busy = false;
        this.ui.setButtonsEnabled(true);
        const left = blk.pages.filter(p => !p.written).length;
        this.ui.status(`✅ 写入完成(绿色 = 已写入页)。剩余空页 ${left} 个。注意:已写入的页不能直接改写!`);
      },
    });
  }

  // ---------- 动画:按块擦除 ----------
  eraseBlock() {
    if (this.busy) return;
    const blk = this.blocks[0];
    if (!blk.pages.some(p => p.written)) {
      this.ui.status('块 0 目前是空的,先"按页写入"一些数据再演示擦除');
      return;
    }
    this.busy = true;
    this.ui.setButtonsEnabled(false);
    this.ui.status('按块擦除:哪怕只想改 1 页,也必须把整个块(所有页)一起清空 —— 这就是"写放大"的根源', 0);

    // 整块红光闪烁后清空
    this.tweens.add({
      duration: 1.6,
      onUpdate: t => {
        const s = Math.sin(t * Math.PI * 4) * 0.5 + 0.5;
        blk.pages.forEach(p => {
          if (p.written) {
            p.mesh.material.emissive.setRGB(1, 0.25 + s * 0.2, 0.2);
            p.mesh.material.emissiveIntensity = 0.4 + s * 0.8;
          }
        });
      },
      onComplete: () => {
        blk.pages.forEach(p => {
          p.written = false;
          p.mesh.material.color.set(0x2a3a52);
          p.mesh.material.emissive.set(0x44ff99);
          p.mesh.material.emissiveIntensity = 0;
        });
        blk.wear++;
        this.setBlockLabel(0);
        this.busy = false;
        this.ui.setButtonsEnabled(true);
        this.ui.status(`✅ 块 0 已整块擦除,擦写计数 +1(现在 ${blk.wear} 次)。真实闪存块只能承受几千次擦写,SSD 主控用"磨损均衡"让所有块均匀老化`, 7000);
      },
    });
  }

  update(dt) {
    this.time += dt;
    this.tweens.update(dt);
    // 电子待机抖动
    const jiggle = (arr) => arr.forEach((e, i) => {
      if (!e.visible || this.busy) return;
      const h = e.userData.home;
      e.position.x = h.x + Math.sin(this.time * 3 + i * 2.3) * 0.03;
      e.position.y = h.y + Math.cos(this.time * 2.6 + i * 1.9) * 0.03;
    });
    jiggle(this.subElectrons);
    jiggle(this.gateElectrons);
  }

  dispose() { this.tweens.clear(); }
}
