import * as THREE from 'three';
import { fbmCanvas, brushedCanvas, radialBrushedCanvas, texFromCanvas, circularAnisoTexture } from './textures.js';

/**
 * 基于物理的材质库(PBR)
 * 每次调用返回新材质,避免跨场景释放冲突;同一模型内部应复用返回值
 */

export function gold() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffc75a, metalness: 1, roughness: 0.22,
    clearcoat: 0.3, clearcoatRoughness: 0.2,
  });
}

export function copper() {
  return new THREE.MeshStandardMaterial({ color: 0xd9824a, metalness: 1, roughness: 0.3 });
}

export function solder() {
  return new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 1, roughness: 0.25 });
}

/** 拉丝铝(散热片、外壳) */
export function brushedAluminum({ color = 0xc4c9d1, roughness = 0.38, repeat = [2, 2], anodized = false } = {}) {
  const rough = texFromCanvas(brushedCanvas(1024, 256, 3), { srgb: false, repeat });
  return new THREE.MeshPhysicalMaterial({
    color, metalness: anodized ? 0.6 : 1, roughness,
    roughnessMap: rough,
    clearcoat: anodized ? 0.4 : 0, clearcoatRoughness: 0.4,
  });
}

/** 压铸铝(硬盘底座):细颗粒噪声凹凸 */
export function castAluminum({ color = 0xa9afb8 } = {}) {
  const n = texFromCanvas(fbmCanvas(512, 17, { octaves: 7, base: 16 }), { srgb: false, repeat: [3, 3] });
  return new THREE.MeshStandardMaterial({
    color, metalness: 0.85, roughness: 0.58,
    roughnessMap: n, bumpMap: n, bumpScale: 0.6,
  });
}

/** 不锈钢(顶盖、悬臂) */
export function stainless({ color = 0xc9ced6, roughness = 0.28 } = {}) {
  const rough = texFromCanvas(brushedCanvas(1024, 256, 8, { base: 120, spread: 70 }), { srgb: false, repeat: [1, 1] });
  return new THREE.MeshStandardMaterial({ color, metalness: 1, roughness, roughnessMap: rough });
}

/** 镜面盘片:圆周拉丝的各向异性高光 */
export function platterMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xb0b4bb,
    metalness: 1,
    roughness: 0.12,
    anisotropy: 0.9,
    anisotropyMap: circularAnisoTexture(256),
  });
}

/** 车削金属(主轴、夹具):同心圆纹 */
export function turnedMetal({ color = 0xd0d4da, roughness = 0.25 } = {}) {
  const rough = texFromCanvas(radialBrushedCanvas(512, 4), { srgb: false });
  return new THREE.MeshPhysicalMaterial({
    color, metalness: 1, roughness, roughnessMap: rough,
    anisotropy: 0.6, anisotropyMap: circularAnisoTexture(128),
  });
}

/** 镀镍(CPU 顶盖 IHS) */
export function nickel() {
  const rough = texFromCanvas(radialBrushedCanvas(1024, 12, { base: 110, spread: 60 }), { srgb: false });
  return new THREE.MeshPhysicalMaterial({
    color: 0xd6d9de, metalness: 1, roughness: 0.32, roughnessMap: rough,
  });
}

export function plastic(color = 0x15171b, roughness = 0.55) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0, roughness });
}

export function glossyPlastic(color = 0x111111) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.3 });
}

/** PCB 阻焊层,map 为丝印/走线贴图 */
export function pcb(map, { roughness = 0.42, bump = 0.8, color = 0xffffff } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color, map, roughness, metalness: 0.05,
    bumpMap: map, bumpScale: bump,
    clearcoat: 0.55, clearcoatRoughness: 0.35,
  });
}

/** PCB 板边(玻纤 FR4) */
export function fr4() {
  return new THREE.MeshStandardMaterial({ color: 0x8a8460, roughness: 0.7, metalness: 0 });
}

/** 芯片封装:顶面贴图 + 侧面环氧 */
export function chipMaterials(topMap) {
  const side = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.6, metalness: 0.05 });
  const top = new THREE.MeshPhysicalMaterial({ map: topMap, roughness: 0.62, metalness: 0.05, clearcoat: 0.08 });
  // BoxGeometry 面顺序:+x, -x, +y, -y, +z, -z
  return { side, top, flatTopY: [side, side, top, side, side, side], frontZ: [side, side, side, side, top, side] };
}

/** 硅晶粒:带虹彩薄膜干涉效果 */
export function siliconDie(map) {
  return new THREE.MeshPhysicalMaterial({
    map, metalness: 0.35, roughness: 0.22,
    iridescence: 0.85, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 520],
    clearcoat: 0.6, clearcoatRoughness: 0.1,
  });
}

/** 晶圆级材料:硅衬底 */
export function silicon(color = 0x3a4250) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 0.25, roughness: 0.45, clearcoat: 0.3 });
}

/** 介质层(氧化物):半透明 */
export function oxide(color = 0xbfd8ee, opacity = 0.32) {
  return new THREE.MeshPhysicalMaterial({
    color, metalness: 0, roughness: 0.35,
    transparent: true, opacity, depthWrite: false,
    side: THREE.DoubleSide, envMapIntensity: 0.6,
  });
}

/** 发光指示材质(可调 emissive) */
export function glowMat(color, base = 0x202020, intensity = 0) {
  return new THREE.MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0.2 });
}

/** 纯发光材质(用于光束、高亮) */
export function emissive(color, intensity = 8, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(intensity),
    transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
    toneMapped: true,
  });
}

/** 磁铁(钕铁硼镀镍) */
export function magnet() {
  return new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.9, roughness: 0.35 });
}

/** 黑色阳极氧化 / 磨砂黑金属 */
export function darkMetal(color = 0x2b2f36, roughness = 0.45) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.8, roughness });
}

/** 陶瓷(滑块 AlTiC) */
export function ceramic(color = 0x3a3d44) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 0.2, roughness: 0.25, clearcoat: 0.6 });
}

/** 贴纸 / 标签 */
export function sticker(map) {
  return new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0 });
}
