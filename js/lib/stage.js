import * as THREE from 'three';
import { backgroundTexture, canvasTex, fbmCanvas, texFromCanvas } from './textures.js';

/**
 * 摄影棚式布光:主光(投射柔和阴影)+ 冷色轮廓光 + 补光 + 环境反射
 * 地面为暗色哑光台面,边缘渐隐到背景
 */
export function setupStage(scene, env, {
  shadowBox = 20,
  shadowCenter = [0, 0, 0],
  keyPos = [14, 24, 16],
  keyIntensity = 2.6,
  rimIntensity = 1.6,
  floorY = 0,
  floorRadius = 60,
  floorColor = 0x0b0e14,
  bgInner = '#1b2438',
  bgOuter = '#05070c',
  envIntensity = 1.0,
  mapSize = 2048,
} = {}) {
  scene.background = backgroundTexture(bgInner, bgOuter);
  scene.environment = env;
  scene.environmentIntensity = envIntensity;

  const hemi = new THREE.HemisphereLight(0xc4d6ff, 0x141418, 0.35);
  scene.add(hemi);

  const c = new THREE.Vector3(...shadowCenter);
  const key = new THREE.DirectionalLight(0xfff3e6, keyIntensity);
  key.position.set(c.x + keyPos[0], c.y + keyPos[1], c.z + keyPos[2]);
  key.target.position.copy(c);
  key.castShadow = true;
  key.shadow.mapSize.set(mapSize, mapSize);
  const sc = key.shadow.camera;
  sc.left = -shadowBox; sc.right = shadowBox; sc.top = shadowBox; sc.bottom = -shadowBox;
  sc.near = 1; sc.far = 120;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key, key.target);

  const rim = new THREE.DirectionalLight(0x9db8ff, rimIntensity);
  rim.position.set(c.x - 16, c.y + 10, c.z - 20);
  rim.target.position.copy(c);
  scene.add(rim, rim.target);

  const fill = new THREE.DirectionalLight(0xffffff, 0.45);
  fill.position.set(c.x - 18, c.y + 6, c.z + 14);
  fill.target.position.copy(c);
  scene.add(fill, fill.target);

  // 台面:中心清晰、边缘渐隐
  const alpha = canvasTex(512, 512, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#bbbbbb');
    g.addColorStop(1, '#000000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  }, { srgb: false, aniso: 1 });
  const rough = texFromCanvas(fbmCanvas(512, 41, { octaves: 6, base: 8, contrast: 0.5 }), { srgb: false, repeat: [10, 10] });
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(floorRadius, 96),
    new THREE.MeshStandardMaterial({
      color: floorColor, roughness: 0.62, metalness: 0.0,
      roughnessMap: rough, alphaMap: alpha, transparent: true, depthWrite: false,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(c.x, floorY, c.z);
  floor.receiveShadow = true;
  floor.renderOrder = -1;
  scene.add(floor);

  return { hemi, key, rim, fill, floor };
}

/**
 * 自定义摄影棚环境贴图:暗灰渐变空间 + 几块柔光箱
 * 亮度受控(<2),镜面物体能映出柔光箱轮廓,但不会触发辉光
 */
export function makeStudioEnv(renderer) {
  const envScene = new THREE.Scene();
  // 竖直渐变的球形空间
  const sphere = new THREE.SphereGeometry(50, 48, 24);
  const cols = [];
  const pos = sphere.attributes.position;
  const top = new THREE.Color(0x6a7282), mid = new THREE.Color(0x3a3f48), bot = new THREE.Color(0x15171b);
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / 50;
    const c = t > 0 ? mid.clone().lerp(top, t) : mid.clone().lerp(bot, -t);
    cols.push(c.r, c.g, c.b);
  }
  sphere.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  envScene.add(new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  const box = (w, h, x, y, z, color, intensity) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  };
  box(26, 16, 0, 40, 6, 0xffffff, 1.9);        // 顶部大柔光箱
  box(8, 30, 34, 12, 18, 0xfff1e0, 1.6);       // 右前暖色条灯
  box(8, 30, -34, 10, 14, 0xdfe8ff, 1.2);      // 左前冷色条灯
  box(30, 6, 0, 8, -38, 0xbfd0ff, 1.0);        // 背后轮廓灯
  box(14, 10, 20, 4, 36, 0xffffff, 0.8);       // 正面补光

  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(envScene, 0.02).texture;
  envScene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  pmrem.dispose();
  return tex;
}
