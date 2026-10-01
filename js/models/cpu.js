import * as THREE from 'three';
import * as M from '../lib/materials.js';
import { extrudeFlat, rrectShape, rrectPath, instanced, mesh, RoundedBoxGeometry } from '../lib/geom.js';
import { canvasTex, cpuDieTexture, fbmCanvas } from '../lib/textures.js';

/**
 * 台式机 CPU(LGA 封装,1 单位 = 1 cm)+ 插座
 * 37.5 × 45 mm 基板,镀镍铜顶盖 (IHS),顶盖下是硅晶粒(含寄存器 / L1 / L2 / L3 / 内存控制器)
 * 原点:插座底面中心,y 向上
 */
export const CPU = { SUB_W: 3.75, SUB_D: 4.5, DIE_W: 2.4, DIE_D: 1.2 };

export function buildCpuSocket() {
  const g = new THREE.Group();
  const { SUB_W, SUB_D, DIE_W, DIE_D } = CPU;

  // 插座底座
  const black = M.plastic(0x141519, 0.5);
  const frame = rrectShape(SUB_W + 0.9, SUB_D + 0.9, 0.1);
  frame.holes.push(rrectPath(SUB_W + 0.1, SUB_D + 0.1, 0.05));
  mesh(extrudeFlat(frame, 0.32), black, 0, 0, 0, g);
  mesh(new THREE.BoxGeometry(SUB_W + 0.1, 0.18, SUB_D + 0.1), M.plastic(0x2a2418, 0.6), 0, 0.09, 0, g);

  // 封装基板
  const subY = 0.2;
  const subTex = canvasTex(512, 614, (ctx, w, h) => {
    ctx.fillStyle = '#1d4a2e';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.12;
    ctx.drawImage(fbmCanvas(256, 4), 0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(220,190,110,0.8)';
    ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(40, 10); ctx.lineTo(10, 40); ctx.fill();   // 1 号针角标
  });
  const subMat = new THREE.MeshPhysicalMaterial({ map: subTex, roughness: 0.45, clearcoat: 0.4 });
  const subSide = new THREE.MeshStandardMaterial({ color: 0x1a2a20, roughness: 0.6 });
  mesh(new THREE.BoxGeometry(SUB_W, 0.12, SUB_D), [subSide, subSide, subMat, subSide, subSide, subSide], 0, subY + 0.06, 0, g);
  // 基板背面电容阵列(顶面边缘一排)
  const caps = [];
  for (let i = 0; i < 14; i++) caps.push({ x: -1.5 + i * 0.23, y: subY + 0.145, z: SUB_D / 2 - 0.2 });
  g.add(instanced(new THREE.BoxGeometry(0.1, 0.05, 0.06), new THREE.MeshStandardMaterial({ color: 0xa8865a, roughness: 0.6 }), caps));

  // 硅晶粒
  const { tex: dieTex, regions } = cpuDieTexture();
  const dieMat = M.siliconDie(dieTex);
  const dieSide = new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.4, roughness: 0.4 });
  const dieY = subY + 0.12;
  const die = mesh(new THREE.BoxGeometry(DIE_W, 0.06, DIE_D), [dieSide, dieSide, dieMat, dieSide, dieSide, dieSide], 0, dieY + 0.03, 0, g);
  const dieTop = dieY + 0.06;

  // 顶盖 IHS(可拆下)
  const ihs = new THREE.Group();
  const ihsTex = canvasTex(1024, 1100, (ctx, w, h) => {
    ctx.fillStyle = '#d0d3d8';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(60,64,72,0.75)';
    ctx.font = 'bold 70px "Segoe UI", Arial, sans-serif';
    ctx.fillText('STORAGE LAB', 120, 330);
    ctx.font = '52px Consolas, monospace';
    ['SL-CORE 9  8C/16T', '5.6 GHz  L3 32MB', 'X3K9-2026  LOT 0417'].forEach((t, i) => ctx.fillText(t, 120, 450 + i * 80));
    ctx.font = '40px Consolas, monospace';
    ctx.fillText('MADE FOR EDUCATION', 120, 820);
  });
  const nickel = M.nickel();
  const nickelTop = nickel.clone();
  nickelTop.map = ihsTex;
  const flange = mesh(new RoundedBoxGeometry(SUB_W - 0.3, 0.1, SUB_D - 0.5, 2, 0.04), nickel, 0, 0.05, 0, ihs);
  const top = mesh(new RoundedBoxGeometry(SUB_W - 0.75, 0.24, SUB_D - 0.85, 3, 0.06), nickel, 0, 0.17, 0, ihs);
  const topPlate = mesh(new THREE.PlaneGeometry(SUB_W - 0.95, SUB_D - 1.05), nickelTop, 0, 0.291, 0, ihs);
  topPlate.rotation.x = -Math.PI / 2;
  void flange; void top;
  ihs.position.y = subY + 0.12;
  g.add(ihs);
  const ihsMats = [nickel, nickelTop];

  // 扣具压板(钢)+ 拉杆
  const steel = M.stainless({ color: 0xb9bec6, roughness: 0.35 });
  const plate = rrectShape(SUB_W + 0.7, SUB_D + 0.7, 0.12);
  plate.holes.push(rrectPath(SUB_W - 0.55, SUB_D - 0.7, 0.1));
  const loadPlate = mesh(extrudeFlat(plate, 0.05), steel, 0, subY + 0.2, 0, g);
  void loadPlate;
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, SUB_D + 1.2, 12), steel);
  lever.rotation.x = Math.PI / 2;
  lever.position.set(SUB_W / 2 + 0.6, 0.3, 0);
  g.add(lever);
  const leverEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 12), steel);
  leverEnd.rotation.z = Math.PI / 2;
  leverEnd.position.set(SUB_W / 2 + 0.3, 0.3, SUB_D / 2 + 0.6);
  g.add(leverEnd);

  /** 晶粒区域中心(局部坐标) */
  const regionCenter = (name) => {
    const r = regions[name];
    return new THREE.Vector3(-DIE_W / 2 + (r.x + r.w / 2) * DIE_W, dieTop + 0.002, -DIE_D / 2 + (r.y + r.h / 2) * DIE_D);
  };
  const regionRect = (name) => {
    const r = regions[name];
    return { w: r.w * DIE_W, d: r.h * DIE_D, c: regionCenter(name) };
  };

  return { group: g, ihs, ihsMats, die, dieTop, regionCenter, regionRect };
}
