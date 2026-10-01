import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { RoundedBoxGeometry, mergeGeometries };

/** 圆角矩形 Shape(以 cx,cy 为中心) */
export function rrectShape(w, h, r, cx = 0, cy = 0, shape = new THREE.Shape()) {
  const x = cx - w / 2, y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

export function rrectPath(w, h, r, cx = 0, cy = 0) {
  return rrectShape(w, h, r, cx, cy, new THREE.Path());
}

export function circlePath(r, cx = 0, cy = 0, seg = 32) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, true);
  return p;
}

/** 统一轮廓绕向(外轮廓逆时针、孔顺时针),避免孔洞侧壁法线翻转 */
export function normalizeShape(shape, curveSegs = 24) {
  const { shape: outer, holes } = shape.extractPoints(curveSegs);
  const o = THREE.ShapeUtils.isClockWise(outer) ? outer.slice().reverse() : outer;
  const s = new THREE.Shape(o);
  s.holes = holes.map(h => new THREE.Path(THREE.ShapeUtils.isClockWise(h) ? h : h.slice().reverse()));
  return s;
}

/**
 * 把 XY 平面的 Shape 挤出为"平放"的几何体:
 * shape 的 (x, y) → 世界 (x, z),厚度沿 +Y,底面 y = 0
 */
export function extrudeFlat(shape, depth, { bevel = 0, bevelSegs = 2, curveSegs = 24 } = {}) {
  const g = new THREE.ExtrudeGeometry(normalizeShape(shape, curveSegs), {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: bevelSegs,
    curveSegments: curveSegs,
  });
  g.rotateX(Math.PI / 2);
  g.translate(0, depth, 0);
  return g;
}

/** 竖直挤出:shape 的 (x, y) → 世界 (x, y),厚度沿 Z 居中 */
export function extrudeUpright(shape, depth, { bevel = 0, bevelSegs = 2, curveSegs = 24 } = {}) {
  const g = new THREE.ExtrudeGeometry(normalizeShape(shape, curveSegs), {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: bevelSegs,
    curveSegments: curveSegs,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** 为几何体设置平面投影 UV(a/b 为轴名),用于顶面贴图 */
export function planarUV(geo, a = 'x', b = 'z', { flipB = true, bounds = null } = {}) {
  geo.computeBoundingBox();
  const bb = bounds || geo.boundingBox;
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const ia = 'xyz'.indexOf(a), ib = 'xyz'.indexOf(b);
  const minA = bb.min.getComponent(ia), maxA = bb.max.getComponent(ia);
  const minB = bb.min.getComponent(ib), maxB = bb.max.getComponent(ib);
  for (let i = 0; i < pos.count; i++) {
    const va = pos.getComponent(i, ia), vb = pos.getComponent(i, ib);
    uv[i * 2] = (va - minA) / (maxA - minA);
    const t = (vb - minB) / (maxB - minB);
    uv[i * 2 + 1] = flipB ? 1 - t : t;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/**
 * 扁平带状几何体(排线 / 柔性电路 / SATA 线)
 * points: 曲线采样点;up: 参考法向。widthAlongUp=true 时宽度方向沿 up(竖立的带子)
 */
export function ribbonGeometry(points, width, thick, { up = new THREE.Vector3(0, 1, 0), widthAlongUp = false } = {}) {
  const n = points.length;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 8 * 3);
  const nor = new Float32Array(n * 8 * 3);
  const uv = new Float32Array(n * 8 * 2);
  const idx = [];
  for (let f = 0; f < 4; f++) {
    for (let i = 0; i < n - 1; i++) {
      const a = i * 8 + f * 2, b = a + 1, c = a + 8, d = b + 8;
      idx.push(a, c, b, b, c, d);
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.userData.ribbon = { width, thick, up, widthAlongUp };
  updateRibbon(geo, points);
  return geo;
}

const _t = new THREE.Vector3(), _s = new THREE.Vector3(), _n = new THREE.Vector3();
export function updateRibbon(geo, points) {
  const { width, thick, up, widthAlongUp } = geo.userData.ribbon;
  const pos = geo.attributes.position.array;
  const nor = geo.attributes.normal.array;
  const uv = geo.attributes.uv.array;
  const n = points.length;
  let len = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const p0 = points[Math.max(0, i - 1)], p1 = points[Math.min(n - 1, i + 1)];
    _t.subVectors(p1, p0).normalize();
    _s.crossVectors(_t, up);
    if (_s.lengthSq() < 1e-6) _s.set(1, 0, 0);
    _s.normalize();
    _n.crossVectors(_s, _t).normalize();
    // 宽度轴 W 与厚度轴 T
    const W = widthAlongUp ? _n : _s;
    const T = widthAlongUp ? _s : _n;
    const hw = width / 2, ht = thick / 2;
    if (i > 0) len += p.distanceTo(points[i - 1]);
    // 4 个面:+T, -T, +W, -W;每面 2 个顶点
    const faces = [
      [T, 1, [-1, 1], [1, 1]],
      [T, -1, [1, -1], [-1, -1]],
      [W, 1, [1, 1], [1, -1]],
      [W, -1, [-1, -1], [-1, 1]],
    ];
    faces.forEach(([N, sgn, c0, c1], f) => {
      [c0, c1].forEach((cc, k) => {
        const vi = (i * 8 + f * 2 + k);
        pos[vi * 3] = p.x + W.x * hw * cc[0] + T.x * ht * cc[1];
        pos[vi * 3 + 1] = p.y + W.y * hw * cc[0] + T.y * ht * cc[1];
        pos[vi * 3 + 2] = p.z + W.z * hw * cc[0] + T.z * ht * cc[1];
        nor[vi * 3] = N.x * sgn; nor[vi * 3 + 1] = N.y * sgn; nor[vi * 3 + 2] = N.z * sgn;
        uv[vi * 2] = k;
        uv[vi * 2 + 1] = len / width;
      });
    });
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.normal.needsUpdate = true;
  geo.attributes.uv.needsUpdate = true;
  geo.computeBoundingSphere();
}

/**
 * 剖切的圆柱壳(用于剖面图):绕 Y 轴、高度居中。
 * 默认保留 z<0 的一半,剖切面朝向 +Z(镜头方向)
 */
export function halfShell(rIn, rOut, height, { seg = 48, a0 = Math.PI, a1 = Math.PI * 2 } = {}) {
  const s = new THREE.Shape();
  s.absarc(0, 0, rOut, a0, a1, false);
  if (rIn > 0) s.absarc(0, 0, rIn, a1, a0, true);
  else s.lineTo(0, 0);
  s.closePath();
  const g = extrudeFlat(s, height, { curveSegs: seg });
  g.translate(0, -height / 2, 0);
  return g;
}

/** 管线(TubeGeometry)简写 */
export function tube(points, radius = 0.05, segs = 64, radial = 8, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.2);
  return new THREE.TubeGeometry(curve, segs, radius, radial, closed);
}

/** 批量放置同一几何体(InstancedMesh) */
export function instanced(geo, mat, transforms, { castShadow = true, receiveShadow = true } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, transforms.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  transforms.forEach((t, i) => {
    p.set(t.x ?? 0, t.y ?? 0, t.z ?? 0);
    e.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0);
    q.setFromEuler(e);
    s.set(t.sx ?? t.s ?? 1, t.sy ?? t.s ?? 1, t.sz ?? t.s ?? 1);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

/** 递归设置阴影 */
export function shadows(obj, cast = true, receive = true) {
  obj.traverse(o => {
    if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; }
  });
  return obj;
}

/** 创建网格并设置位置 */
export function mesh(geo, mat, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
