import * as THREE from 'three';

/**
 * 生成中文文字精灵(Sprite),用于 3D 场景中的标签
 */
export function makeTextSprite(text, {
  fontSize = 42,
  color = '#e8ecf4',
  bg = null,
  padding = 14,
  scale = 1,
  bold = true,
} = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `${bold ? 'bold ' : ''}${fontSize}px "Microsoft YaHei", sans-serif`;
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const w = Math.ceil(metrics.width) + padding * 2;
  const h = fontSize + padding * 2;
  canvas.width = w;
  canvas.height = h;

  if (bg) {
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, w, h, 12);
    ctx.fill();
  }
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const unit = 0.006 * scale;
  sprite.scale.set(w * unit, h * unit, 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 简易缓动动画管理器 */
export class Tweens {
  constructor() { this.list = []; }

  /**
   * add({ duration, onUpdate(t01), onComplete, ease, delay })
   */
  add({ duration = 1, onUpdate, onComplete, ease = easeInOut, delay = 0 }) {
    const tw = { time: -delay, duration, onUpdate, onComplete, ease, done: false };
    this.list.push(tw);
    return tw;
  }

  update(dt) {
    for (const tw of this.list) {
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
export const linear = t => t;

/** 电子小球(发光小球体) */
export function makeElectron(radius = 0.06, color = 0x55ccff) {
  const geo = new THREE.SphereGeometry(radius, 12, 12);
  const mat = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(color),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  glow.scale.setScalar(radius * 6);
  mesh.add(glow);
  return mesh;
}

let glowCache = new Map();
function glowTexture(color) {
  if (glowCache.has(color)) return glowCache.get(color);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  const col = new THREE.Color(color);
  g.addColorStop(0, `rgba(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0},0.8)`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  glowCache.set(color, tex);
  return tex;
}

/** 释放对象树中的几何体与材质 */
export function disposeObject(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => {
        for (const key of Object.keys(m)) {
          if (m[key] && m[key].isTexture) m[key].dispose();
        }
        m.dispose();
      });
    }
  });
}
