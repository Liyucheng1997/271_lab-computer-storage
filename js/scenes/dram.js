import * as THREE from 'three';
import { makeTextSprite, makeElectron, Tweens, easeInOut, easeOut } from '../utils.js';

/**
 * 内存 DRAM 原理:
 * 左侧 —— 8x8 存储单元阵列(行列寻址,字线/位线)
 * 右侧 —— 单个放大的存储单元(1 个晶体管 + 1 个电容,即 1T1C)
 * 演示:写1(充电)、写0(放电)、读取、电荷泄漏、整行刷新
 */
export class DramScene {
  constructor({ camera, controls, ui }) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e1a);
    this.ui = ui;
    this.tweens = new Tweens();
    this.time = 0;
    this.busy = false;
    this.leakLevel = 1;      // 放大单元的电荷量 0~1
    this.cellBit = 1;        // 放大单元当前保存的位

    camera.position.set(0, 1.5, 15);
    controls.target.set(0, 0.5, 0);

    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.8));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(5, 10, 8);
    this.scene.add(dir);
    const p1 = new THREE.PointLight(0x66aaff, 25, 30);
    p1.position.set(-5, 3, 5);
    this.scene.add(p1);

    this.buildArray();
    this.buildBigCell();

    ui.setInfo('内存 DRAM 的工作原理', `
      <p>内存条上的每个芯片包含<b>数十亿个存储单元</b>,每个单元只由
      <b>1 个晶体管 + 1 个电容</b>(1T1C)构成,存储 1 个比特:</p>
      <p>· 电容<b>充满电荷 = 1</b>,<b>没有电荷 = 0</b><br>
      · 晶体管是"开关":<b>字线</b>(行)加电压打开开关,电荷经<b>位线</b>(列)进出<br>
      · 通过"行地址 + 列地址"定位任意一个单元,这就是<b>随机访问</b>(RAM)的含义</p>
      <p>⚠️ 电容会<b>自然漏电</b>,几十毫秒内电荷就会流失——所以每隔约 64ms 必须把所有行读出再写回,称为<b>刷新(Refresh)</b>,这也是"动态"(Dynamic)一词的由来。断电后电荷全部消失,因此<b>内存是易失性存储</b>。</p>
    `);

    ui.setActions([
      { label: '⚡ 写入 1(电容充电)', onClick: () => this.writeBit(1) },
      { label: '⭘ 写入 0(电容放电)', onClick: () => this.writeBit(0) },
      { label: '🔍 读取(破坏性+回写)', onClick: () => this.readBit() },
      { label: '💧 演示:电荷泄漏', onClick: () => this.leak() },
      { label: '🔄 刷新全部行', onClick: () => this.refreshAll() },
    ]);
  }

  // ---------- 左侧:8x8 阵列 ----------
  buildArray() {
    const group = new THREE.Group();
    group.position.set(-5.2, 0.5, 0);
    this.scene.add(group);
    this.arrayGroup = group;

    const N = 8, S = 0.72;
    this.cells = [];
    const off = (N - 1) * S / 2;

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const bit = Math.random() > 0.5 ? 1 : 0;
        const geo = new THREE.BoxGeometry(0.5, 0.5, 0.22);
        const mat = new THREE.MeshStandardMaterial({
          color: 0x224466,
          emissive: 0x33ccff,
          emissiveIntensity: bit ? 0.65 : 0.02,
          roughness: 0.4,
          metalness: 0.3,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(c * S - off, off - r * S, 0);
        group.add(mesh);
        this.cells.push({ mesh, bit, row: r, col: c });
      }
    }

    // 字线(行,横向)与位线(列,纵向)
    for (let r = 0; r < N; r++) {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(N * S + 0.5, 0.05, 0.05),
        new THREE.MeshBasicMaterial({ color: 0x7c5cbf, transparent: true, opacity: 0.7 })
      );
      line.position.set(0, off - r * S, -0.18);
      group.add(line);
      if (r === 0) {
        const lbl = makeTextSprite('字线 (行选择)', { fontSize: 26, color: '#b9a3ff', scale: 0.85 });
        lbl.position.set(-(N * S) / 2 - 1.35, off, 0);
        group.add(lbl);
      }
    }
    for (let c = 0; c < N; c++) {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, N * S + 0.5, 0.05),
        new THREE.MeshBasicMaterial({ color: 0x3e8ec4, transparent: true, opacity: 0.7 })
      );
      line.position.set(c * S - off, 0, -0.18);
      group.add(line);
      if (c === N - 1) {
        const lbl = makeTextSprite('位线 (数据进出)', { fontSize: 26, color: '#7ec8ff', scale: 0.85 });
        lbl.position.set(off, (N * S) / 2 + 0.65, 0);
        group.add(lbl);
      }
    }

    const title = makeTextSprite('存储单元阵列 (亮 = 1, 暗 = 0)', { fontSize: 30, color: '#e8ecf4', scale: 0.95 });
    title.position.set(0, -(N * S) / 2 - 0.9, 0);
    group.add(title);
  }

  // ---------- 右侧:放大的 1T1C 单元 ----------
  buildBigCell() {
    const g = new THREE.Group();
    g.position.set(4.2, 0.5, 0);
    this.scene.add(g);

    // 位线(左侧竖直导线)
    const bitline = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 6.4, 12),
      new THREE.MeshStandardMaterial({ color: 0x3e8ec4, emissive: 0x1d5f8a, emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.3 })
    );
    bitline.position.set(-2.6, 0, 0);
    g.add(bitline);
    const blLabel = makeTextSprite('位线', { fontSize: 30, color: '#7ec8ff', scale: 0.9 });
    blLabel.position.set(-2.6, 3.6, 0);
    g.add(blLabel);

    // 字线(顶部水平导线)
    const wordline = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 5.4, 12),
      new THREE.MeshStandardMaterial({ color: 0x7c5cbf, emissive: 0x4a2f80, emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.3 })
    );
    wordline.rotation.z = Math.PI / 2;
    wordline.position.set(0, 2.2, 0);
    g.add(wordline);
    this.wordlineMat = wordline.material;
    const wlLabel = makeTextSprite('字线', { fontSize: 30, color: '#b9a3ff', scale: 0.9 });
    wlLabel.position.set(2.4, 2.65, 0);
    g.add(wlLabel);

    // 晶体管(栅极 + 沟道)
    const gate = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.5, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x9a66ff, emissive: 0x5522aa, emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.4 })
    );
    gate.position.set(-1.2, 1.0, 0);
    g.add(gate);
    this.gateMat = gate.material;
    // 栅极与字线的连线
    const gWire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.95, 8),
      new THREE.MeshStandardMaterial({ color: 0x8877aa, metalness: 0.6, roughness: 0.4 })
    );
    gWire.position.set(-1.2, 1.72, 0);
    g.add(gWire);

    const channel = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.28, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x445566, emissive: 0x66ffcc, emissiveIntensity: 0.0, roughness: 0.5 })
    );
    channel.position.set(-1.2, 0.55, 0);
    g.add(channel);
    this.channelMat = channel.material;
    const trLabel = makeTextSprite('晶体管(开关)', { fontSize: 28, color: '#c9a3ff', scale: 0.85 });
    trLabel.position.set(-1.2, -0.05, 0.5);
    g.add(trLabel);

    // 连接沟道 → 电容顶板的导线
    const wire2 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x8877aa, metalness: 0.6, roughness: 0.4 })
    );
    wire2.rotation.z = Math.PI / 2;
    wire2.position.set(0.15, 0.55, 0);
    g.add(wire2);

    // 电容:上下两块极板
    const plateMatTop = new THREE.MeshStandardMaterial({ color: 0xd4a34a, emissive: 0xaa7722, emissiveIntensity: 0.25, metalness: 0.8, roughness: 0.25 });
    const plateTop = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 1.1), plateMatTop);
    plateTop.position.set(1.4, 0.55, 0);
    g.add(plateTop);
    const plateBottom = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 1.1), plateMatTop.clone());
    plateBottom.position.set(1.4, -0.75, 0);
    g.add(plateBottom);
    // 接地符号
    const gnd = makeTextSprite('⏚ 接地', { fontSize: 26, color: '#889', scale: 0.8 });
    gnd.position.set(1.4, -1.25, 0);
    g.add(gnd);
    const capLabel = makeTextSprite('电容(存电荷)', { fontSize: 28, color: '#ffd479', scale: 0.85 });
    capLabel.position.set(1.4, 1.15, 0);
    g.add(capLabel);

    // 电荷电子(电容内部)
    this.electrons = [];
    const EN = 10;
    for (let i = 0; i < EN; i++) {
      const e = makeElectron(0.09, 0x55ccff);
      const ang = (i / EN) * Math.PI * 2;
      e.userData.home = new THREE.Vector3(
        1.4 + Math.cos(ang) * 0.5,
        -0.1 + (i % 3) * 0.16 - 0.16,
        Math.sin(ang) * 0.32
      );
      e.position.copy(e.userData.home);
      g.add(e);
      this.electrons.push(e);
    }

    // 状态显示牌
    this.stateSprite = null;
    this.bigGroup = g;
    this.updateStateSprite();

    const title = makeTextSprite('单个存储单元放大图 (1T1C)', { fontSize: 32, color: '#e8ecf4', scale: 1 });
    title.position.set(0, -2.4, 0);
    g.add(title);
  }

  updateStateSprite() {
    if (this.stateSprite) {
      this.bigGroup.remove(this.stateSprite);
      this.stateSprite.material.map.dispose();
      this.stateSprite.material.dispose();
    }
    const charged = this.cellBit === 1;
    const pct = Math.round(this.leakLevel * 100);
    const text = charged
      ? `当前状态:1 (电荷量 ${pct}%)`
      : '当前状态:0 (无电荷)';
    this.stateSprite = makeTextSprite(text, {
      fontSize: 30,
      color: charged ? '#7ee0a3' : '#f08a8a',
      bg: 'rgba(15,25,45,0.85)',
      scale: 0.95,
    });
    this.stateSprite.position.set(0, 3.4, 0);
    this.bigGroup.add(this.stateSprite);
  }

  /** 字线通电动画(打开晶体管) */
  openGate(onOpen) {
    this.tweens.add({
      duration: 0.5,
      onUpdate: t => {
        this.wordlineMat.emissiveIntensity = 0.4 + t * 1.4;
        this.gateMat.emissiveIntensity = 0.35 + t * 1.0;
        this.channelMat.emissiveIntensity = t * 0.8;
      },
      onComplete: onOpen,
    });
  }

  closeGate(onClosed) {
    this.tweens.add({
      duration: 0.5,
      onUpdate: t => {
        this.wordlineMat.emissiveIntensity = 1.8 - t * 1.4;
        this.gateMat.emissiveIntensity = 1.35 - t * 1.0;
        this.channelMat.emissiveIntensity = 0.8 - t * 0.8;
      },
      onComplete: onClosed,
    });
  }

  /** 电子沿 位线→沟道→电容 的路径 */
  electronPath(reverse = false) {
    const pts = [
      new THREE.Vector3(-2.6, -2.6, 0),
      new THREE.Vector3(-2.6, 0.55, 0),
      new THREE.Vector3(-1.2, 0.55, 0),
      new THREE.Vector3(0.6, 0.55, 0),
    ];
    if (reverse) pts.reverse();
    return new THREE.CatmullRomCurve3(pts);
  }

  writeBit(bit) {
    if (this.busy) return;
    this.busy = true;
    this.ui.setButtonsEnabled(false);
    this.ui.status(bit === 1
      ? '写入 1:字线加压打开晶体管 → 位线上的电荷流入电容,充电'
      : '写入 0:字线加压打开晶体管 → 电容里的电荷经位线泄放,清空', 0);

    this.openGate(() => {
      const path = this.electronPath(bit === 0);
      const dur = 1.6;
      this.electrons.forEach((e, i) => {
        const delay = i * 0.09;
        if (bit === 1) {
          e.visible = true;
          e.scale.setScalar(1);
          this.tweens.add({
            duration: dur, delay, ease: easeInOut,
            onUpdate: t => {
              e.position.copy(path.getPoint(t));
            },
            onComplete: () => {
              e.position.copy(e.userData.home);
            },
          });
        } else {
          this.tweens.add({
            duration: dur, delay, ease: easeInOut,
            onUpdate: t => {
              e.position.copy(path.getPoint(t));
            },
            onComplete: () => {
              e.visible = false;
            },
          });
        }
      });

      this.tweens.add({
        duration: dur + this.electrons.length * 0.09 + 0.2,
        onUpdate: () => {},
        onComplete: () => {
          this.cellBit = bit;
          this.leakLevel = bit === 1 ? 1 : 0;
          if (bit === 1) this.electrons.forEach(e => { e.visible = true; e.scale.setScalar(1); e.position.copy(e.userData.home); });
          this.updateStateSprite();
          this.closeGate(() => {
            this.busy = false;
            this.ui.setButtonsEnabled(true);
            this.ui.status(bit === 1
              ? '✅ 写入完成:电容充满电荷,该单元现在保存的是 1'
              : '✅ 写入完成:电容已放空,该单元现在保存的是 0');
          });
        },
      });
    });
  }

  readBit() {
    if (this.busy) return;
    this.busy = true;
    this.ui.setButtonsEnabled(false);
    const bit = this.cellBit;
    this.ui.status('读取:打开晶体管,电荷流向位线,由灵敏放大器判断电压 → 得到 0 或 1', 0);

    this.openGate(() => {
      if (bit === 1) {
        // 电荷流出(破坏性读取)
        const path = this.electronPath(true);
        this.electrons.forEach((e, i) => {
          this.tweens.add({
            duration: 1.2, delay: i * 0.07, ease: easeInOut,
            onUpdate: t => e.position.copy(path.getPoint(t)),
            onComplete: () => { e.visible = false; },
          });
        });
        this.tweens.add({
          duration: 2.2,
          onUpdate: () => {},
          onComplete: () => {
            this.ui.status('灵敏放大器检测到电压变化 → 读出 1。但电荷被抽走了(破坏性读取),必须立即回写…', 0);
            // 回写
            const back = this.electronPath(false);
            this.electrons.forEach((e, i) => {
              e.visible = true;
              this.tweens.add({
                duration: 1.0, delay: 0.6 + i * 0.07, ease: easeInOut,
                onUpdate: t => e.position.copy(back.getPoint(t)),
                onComplete: () => e.position.copy(e.userData.home),
              });
            });
            this.tweens.add({
              duration: 2.6,
              onUpdate: () => {},
              onComplete: () => {
                this.leakLevel = 1;
                this.updateStateSprite();
                this.closeGate(() => {
                  this.busy = false;
                  this.ui.setButtonsEnabled(true);
                  this.ui.status('✅ 读取完成:结果 = 1,并已自动回写恢复电荷。DRAM 每次读取都伴随一次重写');
                });
              },
            });
          },
        });
      } else {
        this.tweens.add({
          duration: 1.4,
          onUpdate: () => {},
          onComplete: () => {
            this.closeGate(() => {
              this.busy = false;
              this.ui.setButtonsEnabled(true);
              this.ui.status('✅ 读取完成:位线电压几乎无变化 → 读出 0(电容本来就是空的)');
            });
          },
        });
      }
    });
  }

  leak() {
    if (this.busy) return;
    if (this.cellBit === 0) {
      this.ui.status('当前单元保存的是 0(无电荷),先点击"写入 1"再演示泄漏');
      return;
    }
    this.busy = true;
    this.ui.setButtonsEnabled(false);
    this.ui.status('电容不是完美的容器——电荷正在缓慢泄漏!若不及时刷新,1 将变成 0,数据丢失…', 0);
    const start = this.leakLevel;
    this.tweens.add({
      duration: 5,
      ease: t => t,
      onUpdate: t => {
        this.leakLevel = start * (1 - t * 0.85);
        const visN = Math.round(this.leakLevel * this.electrons.length);
        this.electrons.forEach((e, i) => {
          e.visible = i < visN;
          if (e.visible) e.scale.setScalar(0.6 + this.leakLevel * 0.4);
        });
        if (Math.floor(t * 20) % 4 === 0) this.updateStateSprite();
      },
      onComplete: () => {
        this.updateStateSprite();
        this.busy = false;
        this.ui.setButtonsEnabled(true);
        this.ui.status('⚠️ 电荷仅剩 15%,快要无法分辨 1 和 0 了!点击"刷新全部行"来挽救数据 →', 6000);
      },
    });
  }

  refreshAll() {
    if (this.busy) return;
    this.busy = true;
    this.ui.setButtonsEnabled(false);
    this.ui.status('刷新:逐行读出并回写,恢复所有电容的电荷。真实内存每 64ms 就要刷新一遍所有行', 0);

    // 阵列逐行闪烁
    const N = 8;
    for (let r = 0; r < N; r++) {
      this.tweens.add({
        duration: 0.45, delay: r * 0.28,
        onUpdate: t => {
          const s = Math.sin(t * Math.PI);
          this.cells.filter(c => c.row === r).forEach(c => {
            c.mesh.material.emissiveIntensity = (c.bit ? 0.65 : 0.02) + s * 0.9;
          });
        },
        onComplete: () => {
          this.cells.filter(c => c.row === r).forEach(c => {
            c.mesh.material.emissiveIntensity = c.bit ? 0.65 : 0.02;
          });
        },
      });
    }

    // 放大单元充回满电
    if (this.cellBit === 1) {
      this.tweens.add({
        duration: 1.4, delay: 1.0, ease: easeOut,
        onUpdate: t => {
          this.leakLevel = this.leakLevel + (1 - this.leakLevel) * t;
          const visN = Math.round(this.leakLevel * this.electrons.length);
          this.electrons.forEach((e, i) => {
            e.visible = i < visN;
            if (e.visible) e.scale.setScalar(0.6 + this.leakLevel * 0.4);
          });
        },
      });
    }

    this.tweens.add({
      duration: N * 0.28 + 0.8,
      onUpdate: () => {},
      onComplete: () => {
        this.leakLevel = this.cellBit === 1 ? 1 : 0;
        this.electrons.forEach(e => { e.visible = this.cellBit === 1; e.scale.setScalar(1); });
        this.updateStateSprite();
        this.busy = false;
        this.ui.setButtonsEnabled(true);
        this.ui.status('✅ 刷新完成,所有单元电荷已恢复。这个过程在你使用电脑时每秒发生十几次,悄无声息');
      },
    });
  }

  update(dt) {
    this.time += dt;
    this.tweens.update(dt);
    // 电子轻微抖动
    if (!this.busy) {
      this.electrons.forEach((e, i) => {
        if (!e.visible) return;
        const h = e.userData.home;
        e.position.x = h.x + Math.sin(this.time * 3 + i * 2.1) * 0.04;
        e.position.y = h.y + Math.cos(this.time * 2.5 + i * 1.7) * 0.04;
      });
    }
  }

  dispose() { this.tweens.clear(); }
}
