import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { disposeObject, easeInOut } from './utils.js';
import { makeStudioEnv } from './lib/stage.js';
import { SelectiveBloom } from './lib/bloom.js';
import { HierarchyScene } from './scenes/hierarchy.js';
import { DramScene } from './scenes/dram.js';
import { SsdScene } from './scenes/ssd.js';
import { HddScene } from './scenes/hdd.js';

/* ------------------------------------------------------------------ */
/*  渲染器:PBR + 色调映射 + 阴影 + 辉光后期                              */
/* ------------------------------------------------------------------ */
const canvas = document.getElementById('canvas3d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const pixelRatio = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const labelRenderer = new CSS2DRenderer({ element: document.getElementById('labels') });
labelRenderer.setSize(window.innerWidth, window.innerHeight);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 500);
/** 竖屏时加大视角,保证模型完整入画 */
function fitFov() {
  const a = camera.aspect;
  camera.fov = a < 1 ? Math.min(72, 40 / Math.pow(a, 0.75)) : 40;
  camera.updateProjectionMatrix();
}
fitFov();
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;

// 环境光照(用于金属反射)
const env = makeStudioEnv(renderer);

// 后期:多重采样主画面 + 选择性辉光(只让发光体泛光)→ 色调映射输出
const rt = new THREE.WebGLRenderTarget(window.innerWidth * pixelRatio, window.innerHeight * pixelRatio, {
  type: THREE.HalfFloatType,
  samples: 4,
});
const composer = new EffectComposer(renderer, rt);
const renderPass = new RenderPass(new THREE.Scene(), camera);
const glow = new SelectiveBloom(renderer, camera, window.innerWidth * pixelRatio / 2, window.innerHeight * pixelRatio / 2);
const bloom = glow.bloomPass;
composer.addPass(renderPass);
composer.addPass(glow.mixPass);
composer.addPass(new OutputPass());

/* ------------------------------------------------------------------ */
/*  UI                                                                 */
/* ------------------------------------------------------------------ */
const infoTitle = document.getElementById('info-title');
const infoBody = document.getElementById('info-body');
const actionsEl = document.getElementById('actions');
const statusEl = document.getElementById('status');
const viewsEl = document.getElementById('views');
const hudEl = document.getElementById('hud');
const scopeEl = document.getElementById('scope');
const labelsEl = document.getElementById('labels');
const loadingEl = document.getElementById('loading');
let statusTimer = null;

/** 示波器:滚动波形 */
class Scope {
  constructor(el) {
    this.el = el;
    this.title = el.querySelector('.scope-title');
    this.canvas = el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.data = [];
    this.opts = {};
  }
  show(title, { min = 0, max = 1, refs = [], color = '#7dffb5', len = 240 } = {}) {
    this.title.textContent = title;
    this.opts = { min, max, refs, color, len };
    this.data = [];
    this.el.classList.add('show');
    document.body.classList.add('scope-on');
    this.draw();
  }
  push(v) {
    this.data.push(v);
    if (this.data.length > this.opts.len) this.data.shift();
    this.draw();
  }
  hide() {
    this.el.classList.remove('show');
    document.body.classList.remove('scope-on');
  }
  get visible() { return this.el.classList.contains('show'); }
  draw() {
    const { ctx } = this;
    const W = this.canvas.width, H = this.canvas.height;
    const { min, max, refs, color, len } = this.opts;
    ctx.fillStyle = '#04100c';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(90,255,170,0.09)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += W / 10) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += H / 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    const yOf = v => H - 8 - ((v - min) / (max - min)) * (H - 16);
    for (const r of refs) {
      ctx.strokeStyle = r.color || 'rgba(255,212,121,0.5)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, yOf(r.v)); ctx.lineTo(W, yOf(r.v)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = r.color || 'rgba(255,212,121,0.8)';
      ctx.font = '10px Consolas, monospace';
      ctx.fillText(r.label, 4, yOf(r.v) - 3);
    }
    if (this.data.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    this.data.forEach((v, i) => {
      const x = (i / (len - 1)) * W;
      i ? ctx.lineTo(x, yOf(v)) : ctx.moveTo(x, yOf(v));
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

let current = null;
let currentKey = null;
let flight = null;

/** 镜头平滑飞行 */
function flyTo(pos, target, dur = 1.6) {
  const toP = pos.isVector3 ? pos.clone() : new THREE.Vector3(...pos);
  const toT = target.isVector3 ? target.clone() : new THREE.Vector3(...target);
  return new Promise(resolve => {
    if (flight) flight.resolve();
    flight = {
      fromP: camera.position.clone(), fromT: controls.target.clone(),
      toP, toT, t: 0, dur, resolve,
    };
  });
}

const ui = {
  setInfo(title, html) {
    infoTitle.textContent = title;
    infoBody.innerHTML = html;
    infoBody.parentElement.scrollTop = 0;
  },
  setActions(actions) {
    actionsEl.innerHTML = '';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      if (a.title) btn.title = a.title;
      btn.addEventListener('click', () => a.onClick(btn));
      actionsEl.appendChild(btn);
      a._btn = btn;
    }
  },
  status(msg, duration = 3600) {
    statusEl.innerHTML = msg;
    statusEl.classList.add('show');
    clearTimeout(statusTimer);
    if (duration > 0) statusTimer = setTimeout(() => statusEl.classList.remove('show'), duration);
  },
  hideStatus() {
    clearTimeout(statusTimer);
    statusEl.classList.remove('show');
  },
  setButtonsEnabled(enabled) {
    actionsEl.querySelectorAll('button').forEach(b => b.disabled = !enabled);
  },
  /** 视角按钮:[{ label, pos, target }] */
  setViews(views, active = 0) {
    viewsEl.innerHTML = '';
    views.forEach((v, i) => {
      const b = document.createElement('button');
      b.textContent = v.label;
      b.addEventListener('click', () => {
        ui.setActiveView(i);
        v.onSelect?.();
        flyTo(v.pos, v.target, v.dur ?? 1.6);
      });
      viewsEl.appendChild(b);
    });
    ui.setActiveView(active);
  },
  setActiveView(i) {
    [...viewsEl.children].forEach((b, k) => b.classList.toggle('active', k === i));
  },
  setHud(html) { hudEl.innerHTML = html || ''; },
  hud: hudEl,
  scope: new Scope(scopeEl),
  flyTo,
};

/* ------------------------------------------------------------------ */
/*  场景管理                                                           */
/* ------------------------------------------------------------------ */
const SCENES = {
  hierarchy: HierarchyScene,
  dram: DramScene,
  ssd: SsdScene,
  hdd: HddScene,
};

let ready = false;
async function switchScene(key) {
  if (key === currentKey) return;
  currentKey = key;
  ready = false;
  loadingEl.classList.remove('hide');
  // 让加载提示先绘制出来,再同步构建场景
  await new Promise(r => setTimeout(r, 40));
  if (current) {
    current.dispose?.();
    disposeObject(current.scene);
    current.scene.background?.dispose?.();
    current = null;
  }
  if (flight) { flight.resolve(); flight = null; }
  controls.enabled = true;
  labelsEl.innerHTML = '';
  ui.hideStatus();
  ui.setHud('');
  ui.scope.hide();
  viewsEl.innerHTML = '';
  const Ctor = SCENES[key];
  const scene = new Ctor({ camera, controls, ui, renderer, env });
  current = scene;
  renderPass.scene = scene.scene;
  const b = scene.bloom || {};
  bloom.strength = b.strength ?? 0.8;
  bloom.radius = b.radius ?? 0.4;
  bloom.threshold = b.threshold ?? 0.05;
  renderer.toneMappingExposure = scene.exposure ?? 1.0;
  if (scene.labels) scene.labels.enabled = !labelsEl.classList.contains('labels-off');
  history.replaceState(null, '', '#' + key);
  document.querySelectorAll('#tabbar .tab').forEach(t =>
    t.classList.toggle('active', t.dataset.scene === key));
  controls.update();
  // 异步编译着色器,避免首帧卡顿
  try {
    await Promise.race([renderer.compileAsync(scene.scene, camera), new Promise(r => setTimeout(r, 4000))]);
  } catch (e) { console.warn(e); }
  if (current !== scene) return;
  ready = true;
  loadingEl.classList.add('hide');
}

document.querySelectorAll('#tabbar .tab').forEach(tab => {
  tab.addEventListener('click', () => switchScene(tab.dataset.scene));
});

// 标注开关
const btnLabels = document.getElementById('btn-labels');
btnLabels.addEventListener('click', () => {
  const off = labelsEl.classList.toggle('labels-off');
  btnLabels.classList.toggle('off', off);
  if (current?.labels) current.labels.enabled = !off;
});

/* ------------------------------------------------------------------ */
/*  点选(区分点击与拖动)                                              */
/* ------------------------------------------------------------------ */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;
function pick(ev) {
  if (!current?.pickables?.length) return null;
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(current.pickables, false)[0] || null;
}
canvas.addEventListener('pointerdown', e => { downPos = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
  downPos = null;
  if (moved > 5) return;
  const hit = pick(e);
  if (hit) current.onPick?.(hit);
});
let hoverPending = false;
canvas.addEventListener('pointermove', e => {
  if (hoverPending || e.buttons) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    canvas.style.cursor = pick(e) ? 'pointer' : '';
  });
});

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  fitFov();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  glow.setSize(w / 2, h / 2);
  labelRenderer.setSize(w, h);
});

/* ------------------------------------------------------------------ */
/*  主循环                                                             */
/* ------------------------------------------------------------------ */
const clock = new THREE.Timer();
function animate() {
  requestAnimationFrame(animate);
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.05);

  if (flight) {
    flight.t += dt / flight.dur;
    const k = easeInOut(Math.min(flight.t, 1));
    camera.position.lerpVectors(flight.fromP, flight.toP, k);
    // 轻微抬升弧线,飞行更自然
    const lift = Math.sin(k * Math.PI) * flight.fromP.distanceTo(flight.toP) * 0.12;
    camera.position.y += lift;
    controls.target.lerpVectors(flight.fromT, flight.toT, k);
    controls.enabled = false;
    if (flight.t >= 1) {
      const f = flight;
      flight = null;
      controls.enabled = true;
      f.resolve();
    }
  }
  controls.update();
  if (current && ready) {
    current.update?.(dt);
    current.labels?.update(camera);
    glow.render(current.scene);
    composer.render();
    labelRenderer.render(current.scene, camera);
  }
}

const initial = location.hash.slice(1);
switchScene(SCENES[initial] ? initial : 'hierarchy');
animate();
