import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/** HTML 标签(CSS2D),文字清晰且不随缩放变糊 */
export function label(text, { cls = '', sub = null } = {}) {
  const div = document.createElement('div');
  div.className = 'lbl ' + cls;
  div.innerHTML = sub ? `${text}<small>${sub}</small>` : text;
  const obj = new CSS2DObject(div);
  return obj;
}

let _dotTex = null;
function dotTexture() {
  if (_dotTex) return _dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(16, 16, 12, 0, Math.PI * 2); ctx.fill();
  _dotTex = new THREE.CanvasTexture(c);
  _dotTex.userData.shared = true;
  return _dotTex;
}

const _v = new THREE.Vector3();

/**
 * 标注集合:引线 + 锚点 + 文字;按相机距离自动淡入淡出,
 * 这样每个"工位"的标注只在镜头靠近时出现,不会互相遮挡
 */
export class LabelSet {
  constructor() {
    this.items = [];
    this.enabled = true;
  }

  /**
   * @param parent  挂载对象
   * @param text    文字(可含 HTML)
   * @param anchor  锚点(parent 局部坐标)
   * @param offset  文字相对锚点的偏移
   */
  callout(parent, text, anchor, offset = new THREE.Vector3(), {
    cls = '', sub = null, maxDist = Infinity, minDist = 0, color = 0xa9c2ea, line = true,
  } = {}) {
    const g = new THREE.Group();
    const a = anchor.clone ? anchor.clone() : new THREE.Vector3(...anchor);
    const o = offset.clone ? offset.clone() : new THREE.Vector3(...offset);
    const lbl = label(text, { cls, sub });
    lbl.position.copy(a).add(o);
    g.add(lbl);
    let lineObj = null, dot = null;
    if (line && o.lengthSq() > 1e-8) {
      const geo = new THREE.BufferGeometry().setFromPoints([a, a.clone().add(o)]);
      lineObj = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6, depthTest: false }));
      lineObj.renderOrder = 20;
      g.add(lineObj);
      const dg = new THREE.BufferGeometry().setFromPoints([a]);
      dot = new THREE.Points(dg, new THREE.PointsMaterial({
        color, size: 7, sizeAttenuation: false, map: dotTexture(), transparent: true, depthTest: false, alphaTest: 0.3,
      }));
      dot.renderOrder = 21;
      g.add(dot);
    }
    parent.add(g);
    const item = { group: g, lbl, lineObj, dot, maxDist, minDist, forced: null };
    this.items.push(item);
    return item;
  }

  /** 无引线的纯文字标签 */
  text(parent, text, pos, opts = {}) {
    return this.callout(parent, text, pos, new THREE.Vector3(), { ...opts, line: false });
  }

  setText(item, text, sub = null) {
    item.lbl.element.innerHTML = sub ? `${text}<small>${sub}</small>` : text;
  }

  setClass(item, cls) {
    item.lbl.element.className = 'lbl ' + cls;
  }

  update(camera) {
    for (const it of this.items) {
      if (!it.group.parent) continue;
      it.lbl.getWorldPosition(_v);
      const d = _v.distanceTo(camera.position);
      let a = 1;
      if (d > it.maxDist) a = Math.max(0, 1 - (d - it.maxDist) / (it.maxDist * 0.25));
      if (d < it.minDist) a = Math.max(0, 1 - (it.minDist - d) / (it.minDist * 0.3));
      if (it.forced !== null) a = it.forced;
      if (!this.enabled) a = 0;
      const vis = a > 0.01 && it.group.visible !== false;
      it.lbl.visible = vis;
      it.lbl.element.style.opacity = a.toFixed(3);
      if (it.lineObj) {
        it.lineObj.visible = vis;
        it.lineObj.material.opacity = 0.6 * a;
        it.dot.visible = vis;
        it.dot.material.opacity = a;
      }
    }
  }
}
