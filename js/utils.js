import * as THREE from 'three';

/** 简易缓动动画管理器(支持回调式与 Promise 式) */
export class Tweens {
  constructor() { this.list = []; }

  /**
   * add({ duration, onUpdate(t01), onComplete, ease, delay })
   */
  add({ duration = 1, onUpdate, onComplete, ease = easeInOut, delay = 0 }) {
    const tw = { time: -delay, duration: Math.max(duration, 1e-4), onUpdate, onComplete, ease, done: false };
    this.list.push(tw);
    return tw;
  }

  /** Promise 版本:await tweens.to(1.2, t => ...) */
  to(duration, onUpdate, { ease = easeInOut, delay = 0 } = {}) {
    return new Promise(resolve => this.add({ duration, delay, ease, onUpdate, onComplete: resolve }));
  }

  /** 等待若干秒 */
  sleep(sec) {
    return new Promise(resolve => this.add({ duration: sec, onComplete: resolve }));
  }

  update(dt) {
    const list = this.list;
    const n = list.length;           // 本帧新加入的动画下一帧才开始
    for (let i = 0; i < n; i++) {
      const tw = list[i];
      if (tw.done) continue;
      tw.time += dt;
      if (tw.time < 0) continue;
      const t = Math.min(tw.time / tw.duration, 1);
      tw.onUpdate?.(tw.ease(t));
      if (t >= 1) {
        tw.done = true;
        tw.onComplete?.();
      }
    }
    this.list = this.list.filter(t => !t.done);
  }

  clear() { this.list = []; }
}

export const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
export const easeOut = t => 1 - Math.pow(1 - t, 3);
export const easeIn = t => t * t * t;
export const linear = t => t;
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = v => Math.min(1, Math.max(0, v));

/** 发光粒子(电子 / 数据包)。颜色乘以强度使其超过 bloom 阈值 */
export function makeElectron(radius = 0.06, color = 0x55ccff, intensity = 10) {
  const geo = new THREE.SphereGeometry(radius, 14, 10);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
  const mesh = new THREE.Mesh(geo, mat);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(),
    color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.85,
  }));
  glow.scale.setScalar(radius * 7);
  mesh.add(glow);
  mesh.userData.baseColor = new THREE.Color(color);
  return mesh;
}

let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  _glowTex.userData.shared = true;
  return _glowTex;
}

/** 释放对象树中的几何体与材质(共享纹理除外) */
export function disposeObject(obj) {
  const seen = new Set();
  obj.traverse(o => {
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => {
        if (seen.has(m)) return;
        seen.add(m);
        for (const key of Object.keys(m)) {
          const v = m[key];
          if (v && v.isTexture && !v.userData?.shared && !seen.has(v)) { seen.add(v); v.dispose(); }
        }
        m.dispose();
      });
    }
  });
}
