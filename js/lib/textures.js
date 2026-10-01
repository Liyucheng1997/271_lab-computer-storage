import * as THREE from 'three';

/**
 * 程序化纹理库:全部用 Canvas 2D 现场绘制,无需任何图片资源
 * 约定:画布顶部 = 模型的"后方/上方"
 */

/** 可复现的伪随机数 */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** 由绘制函数生成纹理 */
export function canvasTex(w, h, draw, { srgb = true, aniso = 8 } = {}) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

export function texFromCanvas(c, { srgb = true, aniso = 8, repeat = null } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

/** 分形噪声画布(灰度,128 为中值) */
export function fbmCanvas(size = 512, seed = 1, { octaves = 6, base = 4, contrast = 1 } = {}) {
  const r = rng(seed);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (let o = 0; o < octaves; o++) {
    const n = Math.min(base << o, size);
    const sc = makeCanvas(n, n);
    const sctx = sc.getContext('2d');
    const img = sctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = (r() * 255) | 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    ctx.globalAlpha = (0.55 / (o * 0.7 + 1)) * contrast;
    ctx.drawImage(sc, 0, 0, size, size);
  }
  ctx.globalAlpha = 1;
  return c;
}

/** 拉丝金属纹理(用作 roughnessMap / bumpMap) */
export function brushedCanvas(w = 1024, h = 256, seed = 3, { base = 150, spread = 60, lines = 2600 } = {}) {
  const r = rng(seed);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < lines; i++) {
    const v = base + (r() - 0.5) * spread;
    ctx.strokeStyle = `rgba(${v | 0},${v | 0},${v | 0},${0.25 + r() * 0.5})`;
    ctx.lineWidth = 0.5 + r() * 1.2;
    const y = r() * h;
    const x0 = r() * w * 0.3 - w * 0.1;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + w * (0.5 + r() * 0.9), y + (r() - 0.5) * 1.5);
    ctx.stroke();
  }
  return c;
}

/** 同心圆拉丝(盘片 / 主轴 / 夹具的车削纹理) */
export function radialBrushedCanvas(size = 1024, seed = 5, { base = 140, spread = 70 } = {}) {
  const r = rng(seed);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, size, size);
  const cx = size / 2;
  for (let i = 0; i < 1400; i++) {
    const rad = r() * cx;
    const v = base + (r() - 0.5) * spread;
    ctx.strokeStyle = `rgba(${v | 0},${v | 0},${v | 0},${0.3 + r() * 0.5})`;
    ctx.lineWidth = 0.6 + r() * 1.4;
    ctx.beginPath();
    const a0 = r() * Math.PI * 2;
    ctx.arc(cx, cx, rad, a0, a0 + Math.PI * (0.5 + r() * 1.5));
    ctx.stroke();
  }
  return c;
}

/**
 * 圆周方向各向异性贴图:RG = 切线方向,B = 强度
 * 让盘片 / 光盘呈现真实的"放射状高光"
 */
export function circularAnisoTexture(size = 256) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size - 0.5;
      const v = 1 - (py + 0.5) / size - 0.5;
      const len = Math.hypot(u, v) || 1;
      const dx = -v / len, dy = u / len;
      const i = (py * size + px) * 4;
      img.data[i] = (dx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy * 0.5 + 0.5) * 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

/** 屏幕空间背景渐变 */
export function backgroundTexture(inner = '#1a2238', outer = '#05070d') {
  return canvasTex(1024, 1024, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, w * 0.75);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 轻微噪点,避免色带
    const img = ctx.getImageData(0, 0, w, h);
    const r = rng(9);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * 3;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }, { aniso: 1 });
}

/** 地面柔光圆盘 */
export function radialGlowTexture(color = '120,150,220', alpha = 0.35) {
  return canvasTex(512, 512, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, `rgba(${color},${alpha})`);
    g.addColorStop(0.5, `rgba(${color},${alpha * 0.35})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  }, { aniso: 1 });
}

/* ------------------------------------------------------------------ */
/*  PCB 绘制工具                                                       */
/* ------------------------------------------------------------------ */

/**
 * 在矩形区域内绘制随机走线(45° 拐角),模拟 PCB 铜箔
 */
export function drawTraces(ctx, r, { x, y, w, h, count = 60, color = 'rgba(255,255,255,0.08)', width = 2, bus = 6 }) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < count; i++) {
    const n = 1 + Math.floor(r() * bus);
    let px = x + r() * w, py = y + r() * h;
    const segs = 2 + Math.floor(r() * 4);
    const pts = [[px, py]];
    let dir = Math.floor(r() * 8);
    for (let s = 0; s < segs; s++) {
      const len = 20 + r() * Math.max(w, h) * 0.25;
      const ang = dir * Math.PI / 4;
      px = Math.min(x + w, Math.max(x, px + Math.cos(ang) * len));
      py = Math.min(y + h, Math.max(y, py + Math.sin(ang) * len));
      pts.push([px, py]);
      dir = (dir + (r() > 0.5 ? 1 : 7)) % 8;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (let k = 0; k < n; k++) {
      const off = k * (width * 2.2);
      ctx.beginPath();
      pts.forEach(([a, b], j) => (j ? ctx.lineTo(a + off, b + off) : ctx.moveTo(a + off, b + off)));
      ctx.stroke();
    }
    // 端点过孔
    const [ex, ey] = pts[pts.length - 1];
    drawVia(ctx, ex, ey, width * 1.6);
  }
}

export function drawVia(ctx, x, y, rad, ring = 'rgba(200,170,90,0.55)', hole = 'rgba(0,0,0,0.75)') {
  ctx.fillStyle = ring;
  ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hole;
  ctx.beginPath(); ctx.arc(x, y, rad * 0.45, 0, Math.PI * 2); ctx.fill();
}

export function scatterVias(ctx, r, { x, y, w, h, count = 200, rad = 3 }) {
  for (let i = 0; i < count; i++) drawVia(ctx, x + r() * w, y + r() * h, rad);
}

/** 丝印文字 */
export function silk(ctx, text, x, y, size = 20, { color = 'rgba(235,238,240,0.82)', align = 'left', rot = 0, font = 'Consolas, "Courier New", monospace', bold = true } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** 丝印外框 */
export function silkRect(ctx, x, y, w, h, { color = 'rgba(235,238,240,0.7)', width = 2, corner = true } = {}) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(x, y, w, h);
  if (corner) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x - 6, y - 6, 3, 0, Math.PI * 2); ctx.fill();
  }
}

/** 基础阻焊层(带细微噪声与铜箔) */
export function pcbBase(ctx, w, h, { mask = '#14301f', seed = 11, traceColor = 'rgba(120,200,140,0.10)', traces = 120, traceWidth = 2.2 } = {}) {
  const r = rng(seed);
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, w, h);
  // 铜箔填充区的细微明暗
  ctx.globalAlpha = 0.06;
  ctx.drawImage(fbmCanvas(256, seed, { octaves: 5 }), 0, 0, w, h);
  ctx.globalAlpha = 1;
  drawTraces(ctx, r, { x: 0, y: 0, w, h, count: traces, color: traceColor, width: traceWidth });
  scatterVias(ctx, r, { x: 0, y: 0, w, h, count: Math.round(w * h / 9000), rad: traceWidth * 1.3 });
  return r;
}

/* ------------------------------------------------------------------ */
/*  芯片表面(黑色环氧封装 + 激光刻字)                                  */
/* ------------------------------------------------------------------ */
export function chipTexture(lines = [], { w = 512, h = 512, base = '#16171a', ink = 'rgba(190,196,206,0.78)', dot = true, seed = 7, logo = null } = {}) {
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.08;
    ctx.drawImage(fbmCanvas(256, seed, { octaves: 6, base: 8 }), 0, 0, w, h);
    ctx.globalAlpha = 1;
    // 外围一圈稍亮的模压边
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = w * 0.03;
    ctx.strokeRect(0, 0, w, h);
    if (dot) {
      const g = ctx.createRadialGradient(w * 0.12, h * 0.14, 0, w * 0.12, h * 0.14, w * 0.05);
      g.addColorStop(0, 'rgba(0,0,0,0.9)');
      g.addColorStop(1, 'rgba(60,60,60,0.3)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(w * 0.12, h * 0.14, w * 0.04, 0, Math.PI * 2); ctx.fill();
    }
    if (logo) {
      ctx.fillStyle = ink;
      ctx.font = `bold ${h * 0.13}px "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(logo, w / 2, h * 0.3);
    }
    const n = lines.length;
    const start = logo ? 0.5 : 0.5 - (n - 1) * 0.07;
    lines.forEach((ln, i) => {
      ctx.fillStyle = ink;
      ctx.font = `${h * 0.1}px Consolas, "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ln, w / 2, h * (start + i * 0.14));
    });
  });
}

/* ------------------------------------------------------------------ */
/*  标签贴纸                                                           */
/* ------------------------------------------------------------------ */
export function stickerTexture({ w = 1024, h = 512, title = 'STORAGE LAB', lines = [], dark = false, accent = '#2b6cb0', seed = 21 } = {}) {
  return canvasTex(w, h, (ctx) => {
    const r = rng(seed);
    ctx.fillStyle = dark ? '#1a1d22' : '#eef0f2';
    ctx.fillRect(0, 0, w, h);
    const ink = dark ? '#d8dde5' : '#22262c';
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, h * 0.16);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${h * 0.1}px "Segoe UI", Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(title, w * 0.04, h * 0.08);
    ctx.fillStyle = ink;
    lines.forEach((ln, i) => {
      ctx.font = `${i === 0 ? 'bold ' : ''}${h * (i === 0 ? 0.075 : 0.05)}px "Segoe UI", "Microsoft YaHei", Arial, sans-serif`;
      ctx.fillText(ln, w * 0.04, h * (0.27 + i * 0.09));
    });
    // 条形码
    let x = w * 0.04;
    const by = h * 0.74, bh = h * 0.16;
    while (x < w * 0.55) {
      const bw = 1 + Math.floor(r() * 4);
      if (r() > 0.4) { ctx.fillStyle = ink; ctx.fillRect(x, by, bw, bh); }
      x += bw + 1;
    }
    // 二维码样式方阵
    const qs = h * 0.34, qx = w * 0.8, qy = h * 0.56, cell = qs / 21;
    ctx.fillStyle = ink;
    for (let i = 0; i < 21; i++) for (let j = 0; j < 21; j++) {
      const finder = (i < 7 && j < 7) || (i < 7 && j > 13) || (i > 13 && j < 7);
      if (finder) {
        const ii = i % 14, jj = j % 14;
        const edge = ii === 0 || ii === 6 || jj === 0 || jj === 6;
        const core = ii >= 2 && ii <= 4 && jj >= 2 && jj <= 4;
        if (edge || core) ctx.fillRect(qx + i * cell, qy + j * cell, cell, cell);
      } else if (r() > 0.52) {
        ctx.fillRect(qx + i * cell, qy + j * cell, cell, cell);
      }
    }
    // 简单认证符号圆圈
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(w * (0.62 + i * 0.05), h * 0.82, h * 0.04, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

/* ------------------------------------------------------------------ */
/*  晶粒(Die)版图                                                    */
/* ------------------------------------------------------------------ */

/** 在矩形内填充细密的标准单元纹理 */
function fillLogic(ctx, r, x, y, w, h, hue = 200) {
  ctx.fillStyle = `hsl(${hue},18%,22%)`;
  ctx.fillRect(x, y, w, h);
  const rows = Math.max(4, Math.floor(h / 3));
  for (let i = 0; i < rows; i++) {
    const yy = y + (i / rows) * h;
    ctx.fillStyle = `hsla(${hue + (r() - 0.5) * 40},${20 + r() * 25}%,${22 + r() * 22}%,0.9)`;
    let xx = x;
    while (xx < x + w) {
      const cw = 2 + r() * 10;
      if (r() > 0.25) ctx.fillRect(xx, yy, Math.min(cw, x + w - xx), h / rows - 0.6);
      xx += cw + 0.6;
    }
  }
}

/** 存储阵列区:规则的细格纹(SRAM / DRAM mat) */
function fillArray(ctx, x, y, w, h, { hue = 40, pitch = 3, sat = 30, light = 34 } = {}) {
  ctx.fillStyle = `hsl(${hue},${sat}%,${light - 10}%)`;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = `hsla(${hue},${sat + 10}%,${light + 8}%,0.85)`;
  for (let yy = y; yy < y + h; yy += pitch) ctx.fillRect(x, yy, w, pitch * 0.45);
  ctx.fillStyle = `hsla(${hue + 20},${sat}%,${light + 18}%,0.35)`;
  for (let xx = x; xx < x + w; xx += pitch * 2) ctx.fillRect(xx, y, pitch * 0.4, h);
}

/**
 * CPU 晶粒版图:8 个核心,每核含 寄存器堆/L1/L2,中间共享 L3,
 * 一侧为内存控制器与 I/O。返回纹理与各区域的归一化矩形(用于高亮)
 */
export function cpuDieTexture() {
  const W = 2048, H = 1024;
  const regions = {};
  const tex = canvasTex(W, H, (ctx) => {
    const r = rng(77);
    ctx.fillStyle = '#20242c';
    ctx.fillRect(0, 0, W, H);
    // 焊盘环
    ctx.fillStyle = '#3a3f48';
    for (let x = 20; x < W - 20; x += 14) { ctx.fillRect(x, 8, 7, 7); ctx.fillRect(x, H - 15, 7, 7); }
    for (let y = 20; y < H - 20; y += 14) { ctx.fillRect(8, y, 7, 7); ctx.fillRect(W - 15, y, 7, 7); }

    const coreW = 300, coreH = 400, gap = 14;
    const startX = 330;
    const reg = (name, x, y, w, h) => { regions[name] = { x: x / W, y: y / H, w: w / W, h: h / H }; };
    for (let i = 0; i < 8; i++) {
      const col = i % 4, row = Math.floor(i / 4);
      const x = startX + col * (coreW + gap);
      const y = row === 0 ? 40 : H - 40 - coreH;
      // 核心逻辑
      fillLogic(ctx, r, x, y, coreW, coreH * 0.62, 205);
      // 寄存器堆(整数 + 向量)
      const rfY = row === 0 ? y + coreH * 0.08 : y + coreH * 0.30;
      fillArray(ctx, x + coreW * 0.06, rfY, coreW * 0.30, coreH * 0.13, { hue: 320, pitch: 2.5, sat: 35, light: 40 });
      fillArray(ctx, x + coreW * 0.40, rfY, coreW * 0.24, coreH * 0.13, { hue: 320, pitch: 2.5, sat: 35, light: 40 });
      // L1 I / D
      const l1Y = row === 0 ? y + coreH * 0.40 : y + coreH * 0.05;
      fillArray(ctx, x + coreW * 0.05, l1Y, coreW * 0.42, coreH * 0.17, { hue: 270, pitch: 3, sat: 30, light: 38 });
      fillArray(ctx, x + coreW * 0.53, l1Y, coreW * 0.42, coreH * 0.17, { hue: 270, pitch: 3, sat: 30, light: 38 });
      // L2
      const l2Y = row === 0 ? y + coreH * 0.64 : y;
      const l2H = coreH * 0.36;
      fillArray(ctx, x, row === 0 ? l2Y : y + coreH - l2H, coreW, l2H, { hue: 200, pitch: 3.2, sat: 35, light: 36 });
      if (i === 0) {
        reg('rf', x + coreW * 0.06, rfY, coreW * 0.58, coreH * 0.13);
        reg('l1', x + coreW * 0.05, l1Y, coreW * 0.9, coreH * 0.17);
        reg('l2', x, l2Y, coreW, l2H);
        reg('core0', x, y, coreW, coreH);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, coreW, coreH);
    }
    // 共享 L3 + 环形总线
    const l3Y = 40 + coreH + 12, l3H = H - 2 * (40 + coreH + 12);
    for (let i = 0; i < 8; i++) {
      const x = startX + (i % 4) * (coreW + gap) + (i >= 4 ? coreW / 2 : 0);
      fillArray(ctx, x, l3Y + (i >= 4 ? l3H / 2 : 0) + 2, coreW / 2 - 4, l3H / 2 - 4, { hue: 165, pitch: 3.6, sat: 30, light: 34 });
    }
    reg('l3', startX, l3Y, 4 * coreW + 3 * gap, l3H);
    ctx.strokeStyle = 'rgba(255,200,120,0.25)';
    ctx.lineWidth = 4;
    ctx.strokeRect(startX - 6, l3Y - 6, 4 * coreW + 3 * gap + 12, l3H + 12);
    // 左侧:内存控制器 + DDR PHY
    fillLogic(ctx, r, 30, 40, 270, H * 0.42, 30);
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = 'rgba(220,180,120,0.35)';
      ctx.fillRect(34 + (i % 3) * 88, 50 + Math.floor(i / 3) * 62, 80, 50);
    }
    reg('imc', 30, 40, 270, H * 0.42);
    // 左下:系统代理 / PCIe
    fillLogic(ctx, r, 30, 40 + H * 0.42 + 14, 270, H - 80 - H * 0.42 - 14, 100);
    reg('io', 30, 40 + H * 0.42 + 14, 270, H - 80 - H * 0.42 - 14);
    // 右侧:核显
    const gx = startX + 4 * (coreW + gap) + 6;
    for (let i = 0; i < 12; i++) {
      fillLogic(ctx, r, gx + (i % 2) * 230, 40 + Math.floor(i / 2) * 156, 222, 148, 140 + (i % 3) * 10);
    }
  });
  return { tex, regions };
}

/** DRAM 晶粒:16 个 bank,每个由大量 mat 组成,中间为焊盘与外围电路 */
export function dramDieTexture() {
  const W = 2048, H = 1024;
  return canvasTex(W, H, (ctx) => {
    const r = rng(31);
    ctx.fillStyle = '#23262c';
    ctx.fillRect(0, 0, W, H);
    const bw = 440, bh = 400, gx = 60, gy = 40;
    for (let b = 0; b < 16; b++) {
      const col = b % 4, row = Math.floor(b / 4);
      const x = gx + col * (bw + 30);
      const y = row < 2 ? gy + row * (bh / 2 + 12) : H - gy - (4 - row) * (bh / 2 + 12) + 12;
      const hh = bh / 2;
      // mat 小格
      for (let mx = 0; mx < 16; mx++) for (let my = 0; my < 6; my++) {
        fillArray(ctx, x + mx * (bw / 16) + 1, y + my * (hh / 6) + 1, bw / 16 - 3, hh / 6 - 3, { hue: 30 + (b % 2) * 8, pitch: 2.2, sat: 30, light: 36 });
      }
      // 行译码器条
      ctx.fillStyle = 'rgba(120,160,220,0.55)';
      ctx.fillRect(x + bw / 2 - 3, y, 6, hh);
      // 灵敏放大器条
      ctx.fillStyle = 'rgba(160,220,160,0.35)';
      for (let my = 1; my < 6; my++) ctx.fillRect(x, y + my * (hh / 6) - 1.5, bw, 1.6);
    }
    // 中央外围电路与焊盘
    const cy = H / 2;
    fillLogic(ctx, r, gx, cy - 70, W - 2 * gx, 140, 210);
    ctx.fillStyle = '#b8a070';
    for (let x = gx + 20; x < W - gx - 20; x += 32) {
      ctx.fillRect(x, cy - 12, 22, 24);
    }
  });
}

/** NAND 晶粒:左右两个 plane,中间页缓冲 */
export function nandDieTexture() {
  const W = 2048, H = 1024;
  return canvasTex(W, H, (ctx) => {
    ctx.fillStyle = '#22252b';
    ctx.fillRect(0, 0, W, H);
    for (let p = 0; p < 4; p++) {
      const x = 40 + (p % 2) * (W / 2), y = 40 + Math.floor(p / 2) * (H * 0.4 + 30);
      const w = W / 2 - 80, h = H * 0.4;
      for (let b = 0; b < 48; b++) {
        fillArray(ctx, x + b * (w / 48), y, w / 48 - 2, h, { hue: 190 + (b % 2) * 6, pitch: 2.5, sat: 25, light: 36 });
      }
      ctx.fillStyle = 'rgba(200,170,110,0.55)';
      ctx.fillRect(x, y + h + 4, w, 14);
    }
    const r = rng(5);
    fillLogic(ctx, r, 40, H * 0.86, W - 80, H * 0.1, 220);
  });
}

/** 铜线圈缠绕纹理 */
export function coilTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#7a3d14';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) {
      const g = ctx.createLinearGradient(0, y, 0, y + 4);
      g.addColorStop(0, '#5a2a0c');
      g.addColorStop(0.5, '#e09050');
      g.addColorStop(1, '#5a2a0c');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, w, 4);
    }
  });
}

/** 柔性排线(Kapton + 铜线) */
export function flexTexture() {
  return canvasTex(256, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#b8721c';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = 'rgba(255,200,120,0.55)';
      ctx.fillRect(18 + i * 25, 0, 9, h);
    }
  });
}
