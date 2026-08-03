import * as THREE from 'three';
import { makeTextSprite, makeElectron, Tweens, easeInOut } from '../utils.js';

/**
 * 存储层级金字塔:寄存器 → 高速缓存 → 内存 → SSD → HDD
 * 展示"越快越小越贵,越慢越大越便宜"的层级结构,以及数据逐级流动
 */
export class HierarchyScene {
  constructor({ camera, controls, ui }) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e1a);
    this.scene.fog = new THREE.Fog(0x0a0e1a, 25, 60);
    this.ui = ui;
    this.tweens = new Tweens();
    this.time = 0;

    camera.position.set(9, 6, 13);
    controls.target.set(0, 3.2, 0);

    // 灯光
    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(6, 12, 8);
    this.scene.add(dir);
    const fill = new THREE.PointLight(0x6688ff, 30, 40);
    fill.position.set(-8, 4, -6);
    this.scene.add(fill);

    // 地面网格
    const grid = new THREE.GridHelper(40, 40, 0x2a3a5e, 0x1a2440);
    grid.position.y = -0.01;
    this.scene.add(grid);

    // 层级定义:从底(慢/大)到顶(快/小)
    this.levels = [
      { name: '机械硬盘 HDD', speed: '~100 MB/s · 毫秒级延迟', cap: '数 TB', color: 0x8a6d3b, w: 9.0 },
      { name: '固态硬盘 SSD', speed: '~3-7 GB/s · 微秒级延迟', cap: '512GB~4TB', color: 0x3b7a8a, w: 7.2 },
      { name: '内存 DRAM', speed: '~50 GB/s · ~100 纳秒', cap: '8~64 GB', color: 0x3b5e8a, w: 5.4 },
      { name: '高速缓存 Cache (SRAM)', speed: '~1 TB/s · 1~10 纳秒', cap: '数 MB', color: 0x5a3b8a, w: 3.6 },
      { name: '寄存器 Register', speed: '与 CPU 同频 · <1 纳秒', cap: '数 KB', color: 0x8a3b5e, w: 1.8 },
    ];

    this.blocks = [];
    const H = 1.0, GAP = 0.35;
    this.levels.forEach((lv, i) => {
      const y = i * (H + GAP) + H / 2;
      const geo = new THREE.BoxGeometry(lv.w, H, lv.w * 0.55);
      const mat = new THREE.MeshStandardMaterial({
        color: lv.color,
        roughness: 0.35,
        metalness: 0.35,
        emissive: lv.color,
        emissiveIntensity: 0.12,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, y, 0);
      this.scene.add(mesh);

      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0xaaccff, transparent: true, opacity: 0.35 })
      );
      mesh.add(edge);

      const label = makeTextSprite(lv.name, { fontSize: 46, color: '#ffffff', scale: 1.05 });
      label.position.set(0, 0, lv.w * 0.28 + 0.55);
      mesh.add(label);

      const specs = makeTextSprite(`${lv.speed}`, { fontSize: 30, color: '#9fc3ff', scale: 0.9 });
      specs.position.set(lv.w / 2 + 2.2, 0.18, 0);
      mesh.add(specs);
      const capLabel = makeTextSprite(`容量 ${lv.cap}`, { fontSize: 30, color: '#ffd479', scale: 0.9 });
      capLabel.position.set(lv.w / 2 + 2.2, -0.28, 0);
      mesh.add(capLabel);

      this.blocks.push(mesh);
    });

    // 两侧箭头说明
    const upLabel = makeTextSprite('▲ 速度越来越快 · 单位成本越来越高', { fontSize: 32, color: '#7ee0a3', scale: 1 });
    upLabel.position.set(-7.2, 5.6, 0);
    this.scene.add(upLabel);
    const downLabel = makeTextSprite('▼ 容量越来越大 · 单位成本越来越低', { fontSize: 32, color: '#f0a35e', scale: 1 });
    downLabel.position.set(-7.2, 1.2, 0);
    this.scene.add(downLabel);

    // CPU 顶部标识
    const cpu = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.35, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xffaa33, emissive: 0xff8800, emissiveIntensity: 0.5, metalness: 0.6, roughness: 0.3 })
    );
    cpu.position.set(0, 5 * (H + GAP) + 0.4, 0);
    this.scene.add(cpu);
    const cpuLabel = makeTextSprite('CPU 处理器', { fontSize: 36, color: '#ffcc66', scale: 1 });
    cpuLabel.position.set(0, 0.6, 0);
    cpu.add(cpuLabel);
    this.cpu = cpu;

    // 数据粒子
    this.particle = makeElectron(0.14, 0xffee66);
    this.particle.visible = false;
    this.scene.add(this.particle);

    ui.setInfo('存储层级 (Memory Hierarchy)', `
      <p>计算机采用<b>金字塔式的多级存储结构</b>,在速度、容量、成本之间取得平衡:</p>
      <p><span class="tag">寄存器</span><span class="tag">Cache</span> 离 CPU 最近、速度最快,但容量极小、成本极高;
      <span class="tag">内存</span> 是运行程序的工作区,断电即失;
      <span class="tag">SSD</span><span class="tag">HDD</span> 容量大、断电不丢数据,但速度慢几个数量级。</p>
      <p>当 CPU 需要数据时,会<b>逐级向下查找</b>:先查 Cache,未命中再查内存,最后才访问硬盘,并把数据逐级向上搬运(缓存起来),让"最常用的数据离 CPU 最近"。</p>
      <p>点击右侧按钮,观看一次数据从硬盘读入 CPU 的旅程 →</p>
    `);

    ui.setActions([
      { label: '▶ 演示:数据读取之旅', onClick: () => this.playJourney() },
      { label: '💡 演示:缓存命中', onClick: () => this.playCacheHit() },
    ]);
  }

  levelY(i) { return i * 1.35 + 0.5; }

  playJourney() {
    if (this.busy) return;
    this.busy = true;
    this.ui.setButtonsEnabled(false);
    const p = this.particle;
    p.visible = true;
    const stops = [
      { y: this.levelY(0), msg: '① CPU 请求的数据不在缓存/内存 → 只能从机械硬盘读取(毫秒级,最慢)' },
      { y: this.levelY(1), msg: '② 数据经 SSD/系统缓冲上行(微秒级)' },
      { y: this.levelY(2), msg: '③ 载入内存 DRAM——程序运行的工作区(纳秒级)' },
      { y: this.levelY(3), msg: '④ 常用部分被复制进高速缓存 Cache' },
      { y: this.levelY(4), msg: '⑤ 进入寄存器,CPU 直接运算!整个层级把"慢"隐藏了起来' },
      { y: this.cpu.position.y, msg: '✅ 完成!下次再用这份数据,就近从 Cache 拿,快数百倍' },
    ];
    p.position.set(0, stops[0].y, 0);
    this.ui.status(stops[0].msg, 0);
    this.flash(0);

    let chain = 0;
    const step = (i) => {
      if (i >= stops.length - 1) {
        this.tweens.add({
          duration: 1.2, delay: 1.0,
          onUpdate: t => { p.material && (p.scale.setScalar(1 - t * 0.999)); },
          onComplete: () => {
            p.visible = false; p.scale.setScalar(1);
            this.busy = false;
            this.ui.setButtonsEnabled(true);
            this.ui.status(stops[stops.length - 1].msg);
          },
        });
        return;
      }
      const from = stops[i].y, to = stops[i + 1].y;
      this.tweens.add({
        duration: 1.15, delay: 1.15, ease: easeInOut,
        onUpdate: t => { p.position.y = from + (to - from) * t; },
        onComplete: () => {
          this.ui.status(stops[i + 1].msg, 0);
          if (i + 1 < this.blocks.length) this.flash(i + 1);
          else this.flashCpu();
          step(i + 1);
        },
      });
    };
    step(chain);
  }

  playCacheHit() {
    if (this.busy) return;
    this.busy = true;
    this.ui.setButtonsEnabled(false);
    const p = this.particle;
    p.visible = true;
    const cacheY = this.levelY(3);
    p.position.set(0, cacheY, 0);
    this.flash(3);
    this.ui.status('缓存命中 (Cache Hit):数据已经在 Cache 里,直接送入 CPU,无需访问内存和硬盘!', 0);
    this.tweens.add({
      duration: 0.7, delay: 0.9, ease: easeInOut,
      onUpdate: t => { p.position.y = cacheY + (this.cpu.position.y - cacheY) * t; },
      onComplete: () => {
        this.flashCpu();
        this.ui.status('✅ 命中只需几纳秒。现代 CPU 的缓存命中率通常超过 95%,这是计算机"感觉很快"的关键');
        this.tweens.add({
          duration: 0.8, delay: 0.6,
          onUpdate: t => p.scale.setScalar(1 - t * 0.999),
          onComplete: () => {
            p.visible = false; p.scale.setScalar(1);
            this.busy = false;
            this.ui.setButtonsEnabled(true);
          },
        });
      },
    });
  }

  flash(i) {
    const mat = this.blocks[i].material;
    const base = 0.12;
    this.tweens.add({
      duration: 0.9,
      onUpdate: t => { mat.emissiveIntensity = base + Math.sin(t * Math.PI) * 0.75; },
    });
  }

  flashCpu() {
    const mat = this.cpu.material;
    this.tweens.add({
      duration: 0.9,
      onUpdate: t => { mat.emissiveIntensity = 0.5 + Math.sin(t * Math.PI) * 1.2; },
    });
  }

  update(dt) {
    this.time += dt;
    this.tweens.update(dt);
    // CPU 轻微悬浮
    this.cpu.position.y = 5 * 1.35 + 0.4 + Math.sin(this.time * 2) * 0.06;
  }

  dispose() { this.tweens.clear(); }
}
