import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { disposeObject } from './utils.js';
import { HierarchyScene } from './scenes/hierarchy.js';
import { DramScene } from './scenes/dram.js';
import { SsdScene } from './scenes/ssd.js';
import { HddScene } from './scenes/hdd.js';

const canvas = document.getElementById('canvas3d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

const SCENES = {
  hierarchy: HierarchyScene,
  dram: DramScene,
  ssd: SsdScene,
  hdd: HddScene,
};

let current = null;       // 当前场景实例
let currentKey = null;

const infoTitle = document.getElementById('info-title');
const infoBody = document.getElementById('info-body');
const actionsEl = document.getElementById('actions');
const statusEl = document.getElementById('status');
let statusTimer = null;

/** 场景可调用的 UI 接口 */
const ui = {
  setInfo(title, html) {
    infoTitle.textContent = title;
    infoBody.innerHTML = html;
  },
  setActions(actions) {
    actionsEl.innerHTML = '';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      btn.addEventListener('click', () => a.onClick(btn));
      actionsEl.appendChild(btn);
      a._btn = btn;
    }
  },
  status(msg, duration = 3200) {
    statusEl.textContent = msg;
    statusEl.classList.add('show');
    clearTimeout(statusTimer);
    if (duration > 0) {
      statusTimer = setTimeout(() => statusEl.classList.remove('show'), duration);
    }
  },
  hideStatus() {
    clearTimeout(statusTimer);
    statusEl.classList.remove('show');
  },
  setButtonsEnabled(enabled) {
    actionsEl.querySelectorAll('button').forEach(b => b.disabled = !enabled);
  },
};

function switchScene(key) {
  if (key === currentKey) return;
  if (current) {
    current.dispose?.();
    disposeObject(current.scene);
    current = null;
  }
  ui.hideStatus();
  currentKey = key;
  const Ctor = SCENES[key];
  current = new Ctor({ camera, controls, ui, renderer });

  document.querySelectorAll('#tabbar .tab').forEach(t =>
    t.classList.toggle('active', t.dataset.scene === key));
}

document.querySelectorAll('#tabbar .tab').forEach(tab => {
  tab.addEventListener('click', () => switchScene(tab.dataset.scene));
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  controls.update();
  current?.update?.(dt);
  if (current) renderer.render(current.scene, camera);
}

switchScene('hierarchy');
animate();
