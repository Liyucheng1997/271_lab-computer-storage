import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * 选择性辉光:单独渲染一遍"只有发光体"的场景(其余物体涂黑),
 * 对它做 Bloom,再叠加回正常画面。
 * 这样金属表面的强烈高光不会被误当成光源而糊成一片。
 *
 * 参与辉光的对象:MeshBasicMaterial / SpriteMaterial(电子、信号、指示灯)
 * 以及 emissiveIntensity > 0 的 PBR 材质(按其自发光颜色绘制)
 */
export class SelectiveBloom {
  constructor(renderer, camera, w, h) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType }));
    this.composer.renderToScreen = false;
    this.renderPass = new RenderPass(new THREE.Scene(), camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.8, 0.4, 0.0);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    // 只保留辉光本身(默认会叠加回原图,导致发光体亮度翻倍)
    this.bloomPass.blendMaterial.blending = THREE.NoBlending;
    this.dark = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.cache = new WeakMap();
    this.saved = [];
    this.black = new THREE.Color(0x000000);

    // 叠加 Pass:最终画面 = 正常渲染 + 辉光
    this.mixPass = new ShaderPass(new THREE.ShaderMaterial({
      uniforms: {
        baseTexture: { value: null },
        bloomTexture: { value: this.composer.renderTarget1.texture },
        strength: { value: 1 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D baseTexture; uniform sampler2D bloomTexture; uniform float strength; varying vec2 vUv;
        void main(){ gl_FragColor = texture2D(baseTexture, vUv) + strength * texture2D(bloomTexture, vUv); }`,
    }), 'baseTexture');
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
  }

  emissiveStandIn(m) {
    let b = this.cache.get(m);
    if (!b) { b = new THREE.MeshBasicMaterial(); this.cache.set(m, b); }
    b.color.copy(m.emissive).multiplyScalar(m.emissiveIntensity);
    b.side = m.side;
    return b;
  }

  render(scene) {
    const saved = this.saved;
    saved.length = 0;
    scene.traverse(o => {
      if (!o.visible) return;
      if (o.isLine || o.isPoints) { saved.push(o, null); o.visible = false; return; }
      if (!o.isMesh) return;
      const m = o.material;
      if (Array.isArray(m)) { saved.push(o, m); o.material = this.dark; return; }
      if (m.isMeshBasicMaterial) return;
      if (m.transparent && !(m.emissive && m.emissiveIntensity > 0)) { saved.push(o, null); o.visible = false; return; }
      saved.push(o, m);
      o.material = (m.emissive && m.emissiveIntensity > 0 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0)
        ? this.emissiveStandIn(m) : this.dark;
    });
    const bg = scene.background;
    scene.background = this.black;
    const shadowAuto = this.renderer.shadowMap.autoUpdate;
    this.renderer.shadowMap.autoUpdate = false;
    const tm = this.renderer.toneMapping;

    this.renderPass.scene = scene;
    this.composer.render();

    this.renderer.toneMapping = tm;
    this.renderer.shadowMap.autoUpdate = shadowAuto;
    scene.background = bg;
    for (let i = 0; i < saved.length; i += 2) {
      const o = saved[i], m = saved[i + 1];
      if (m === null) o.visible = true;
      else o.material = m;
    }
    saved.length = 0;
  }
}
