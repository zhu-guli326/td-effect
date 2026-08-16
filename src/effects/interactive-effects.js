function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function drawMaskedFrame(targetCtx, source, mask, width, height, useMask = true) {
  targetCtx.clearRect(0, 0, width, height);
  targetCtx.globalCompositeOperation = 'source-over';
  targetCtx.drawImage(source, 0, 0, width, height);
  if (useMask && mask) {
    targetCtx.globalCompositeOperation = 'destination-in';
    targetCtx.drawImage(mask, 0, 0, width, height);
    targetCtx.globalCompositeOperation = 'source-over';
  }
}

class BodyEchoEffect {
  constructor({ canvas }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.capture = makeCanvas(canvas.width, canvas.height);
    this.captureCtx = this.capture.getContext('2d');
    this.history = Array.from({ length: 9 }, () => makeCanvas(canvas.width, canvas.height));
    this.writeIndex = 0;
    this.lastCapture = 0;
  }

  render({ source, mask, signal, time }) {
    const { width: w, height: h } = this.canvas;
    const motion = Math.min(1, signal.motion || 0);
    const maskReady = Boolean(signal.maskReady);
    if (time - this.lastCapture > 58) {
      drawMaskedFrame(this.captureCtx, source, mask, w, h, maskReady);
      const slot = this.history[this.writeIndex];
      const slotCtx = slot.getContext('2d');
      slotCtx.clearRect(0, 0, w, h);
      slotCtx.drawImage(this.capture, 0, 0);
      this.writeIndex = (this.writeIndex + 1) % this.history.length;
      this.lastCapture = time;
    }

    this.ctx.clearRect(0, 0, w, h);
    this.ctx.drawImage(source, 0, 0, w, h);
    this.ctx.globalCompositeOperation = 'screen';
    const dx = (signal.flowX || 0) * 5.5;
    const dy = (signal.flowY || 0) * 5.5;
    for (let age = this.history.length - 1; age >= 1; age -= 1) {
      const index = (this.writeIndex - age + this.history.length) % this.history.length;
      const echo = this.history[index];
      const t = age / (this.history.length - 1);
      this.ctx.globalAlpha = (0.035 + motion * 0.11) * (1 - t * 0.55);
      const scale = 1 + t * (0.012 + motion * 0.045);
      const ew = w * scale;
      const eh = h * scale;
      const ox = (w - ew) * 0.5 - dx * age * 0.8;
      const oy = (h - eh) * 0.5 - dy * age * 0.8;
      this.ctx.drawImage(echo, ox, oy, ew, eh);
    }
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
  }
}

class FlowSkinEffect {
  constructor({ canvas, analysis }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.analysis = analysis;
    this.base = makeCanvas(canvas.width, canvas.height);
    this.baseCtx = this.base.getContext('2d');
    this.layer = makeCanvas(canvas.width, canvas.height);
    this.layerCtx = this.layer.getContext('2d');
  }

  render({ source, mask, signal }) {
    const { width: w, height: h } = this.canvas;
    const motion = Math.min(1, signal.motion || 0);
    this.baseCtx.clearRect(0, 0, w, h);
    this.baseCtx.drawImage(source, 0, 0, w, h);
    this.layerCtx.clearRect(0, 0, w, h);

    const cols = 24;
    const rows = 16;
    const cw = w / cols;
    const ch = h / rows;
    const gain = 1.5 + (signal.intensity || 1) * 2.4 + motion * 4.5;
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        const nx = (gx + 0.5) / cols;
        const ny = (gy + 0.5) / rows;
        const [vx, vy] = this.analysis.sampleFlow(nx, ny);
        const mag = Math.min(1, Math.hypot(vx, vy) / 3.5);
        if (mag < 0.015) continue;
        const sx = gx * cw;
        const sy = gy * ch;
        this.layerCtx.globalAlpha = 0.35 + mag * 0.65;
        this.layerCtx.drawImage(this.base, sx, sy, cw + 1, ch + 1, sx + vx * gain, sy + vy * gain, cw + 1, ch + 1);
      }
    }
    this.layerCtx.globalAlpha = 1;
    if (signal.maskReady && mask) {
      this.layerCtx.globalCompositeOperation = 'destination-in';
      this.layerCtx.drawImage(mask, 0, 0, w, h);
      this.layerCtx.globalCompositeOperation = 'source-over';
    }

    this.ctx.clearRect(0, 0, w, h);
    this.ctx.drawImage(this.base, 0, 0);
    this.ctx.globalCompositeOperation = 'screen';
    this.ctx.globalAlpha = 0.78 + motion * 0.2;
    this.ctx.drawImage(this.layer, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
  }
}

class MagneticBodyEffect {
  constructor({ canvas, analysis, cv }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.analysis = analysis;
    this.cv = cv;
    this.count = 1250;
    this.particles = Array.from({ length: this.count }, () => ({ x: Math.random(), y: Math.random(), vx: 0, vy: 0, hx: Math.random(), hy: Math.random(), life: Math.random() }));
    this.lastHomes = 0;
  }

  _reseedHomes(signal, time) {
    if (time - this.lastHomes < 420) return;
    this.lastHomes = time;
    const mask = this.cv.maskCanvas;
    const ctx = this.cv.maskCtx;
    if (signal.maskReady && mask && ctx) {
      const { width, height } = mask;
      const data = ctx.getImageData(0, 0, width, height).data;
      const candidates = [];
      for (let y = 2; y < height - 2; y += 3) {
        for (let x = 2; x < width - 2; x += 3) {
          if (data[(y * width + x) * 4] > 80) candidates.push([x / width, y / height]);
        }
      }
      if (candidates.length > 10) {
        for (const p of this.particles) {
          const home = candidates[(Math.random() * candidates.length) | 0];
          p.hx = home[0];
          p.hy = home[1];
        }
        return;
      }
    }
    const cx = signal.motionX || 0.5;
    const cy = signal.motionY || 0.5;
    for (let i = 0; i < this.particles.length; i += 1) {
      const a = i * 2.399963 + time * 0.0001;
      const r = Math.sqrt((i + 0.5) / this.particles.length) * 0.28;
      this.particles[i].hx = cx + Math.cos(a) * r * 0.72;
      this.particles[i].hy = cy + Math.sin(a) * r;
    }
  }

  update(signal, dt, time) {
    this._reseedHomes(signal, time);
    const delta = Math.min(2, Math.max(0.35, dt / 16.67 || 1));
    const motion = Math.min(1, signal.motion || 0);
    for (const p of this.particles) {
      const [fx, fy] = this.analysis.sampleFlow(p.x, p.y);
      const spring = 0.012 + (1 - motion) * 0.018;
      p.vx += (p.hx - p.x) * spring * delta;
      p.vy += (p.hy - p.y) * spring * delta;
      p.vx += fx * 0.0019 * (0.45 + motion * 2.7) * delta;
      p.vy += fy * 0.0019 * (0.45 + motion * 2.7) * delta;
      p.vx *= Math.pow(0.91, delta);
      p.vy *= Math.pow(0.91, delta);
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      if (p.x < -0.12 || p.x > 1.12 || p.y < -0.12 || p.y > 1.12) {
        p.x = p.hx; p.y = p.hy; p.vx = 0; p.vy = 0;
      }
    }
  }

  render({ source, signal }) {
    const { width: w, height: h } = this.canvas;
    const motion = Math.min(1, signal.motion || 0);
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.globalAlpha = 0.12;
    this.ctx.drawImage(source, 0, 0, w, h);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const speed = Math.min(1, Math.hypot(p.vx, p.vy) * 65);
      const size = 0.7 + speed * 2.1 + motion * 0.8;
      const x = p.x * w;
      const y = p.y * h;
      this.ctx.fillStyle = `hsla(${185 + speed * 120 + p.life * 30}, 95%, ${62 + speed * 18}%, ${0.3 + speed * 0.6})`;
      this.ctx.beginPath();
      this.ctx.arc(x, y, size, 0, Math.PI * 2);
      this.ctx.fill();
      if (speed > 0.18) {
        this.ctx.strokeStyle = `hsla(${205 + speed * 90},100%,78%,${0.15 + speed * 0.35})`;
        this.ctx.lineWidth = 0.5 + speed;
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(x - p.vx * w * 5, y - p.vy * h * 5);
        this.ctx.stroke();
      }
    }
    this.ctx.globalCompositeOperation = 'source-over';
  }
}

class HandSingularityEffect {
  constructor({ canvas }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.count = 950;
    this.particles = Array.from({ length: this.count }, (_, i) => {
      const a = i * 2.399963;
      const r = 0.03 + Math.random() * 0.42;
      return { x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r, vx: 0, vy: 0, seed: Math.random() };
    });
    this.prevDistance = 0.25;
    this.centerX = 0.5;
    this.centerY = 0.5;
    this.energy = 0;
  }

  _hands(signal) {
    const pose = signal.poseLandmarks?.[0];
    const left = pose?.[15];
    const right = pose?.[16];
    if (left && right && (left.visibility ?? 1) > 0.35 && (right.visibility ?? 1) > 0.35) return { left, right };
    const spread = 0.13 + Math.min(0.25, Math.hypot(signal.flowX || 0, signal.flowY || 0) * 0.035);
    return { left: { x: (signal.motionX || 0.5) - spread, y: signal.motionY || 0.5 }, right: { x: (signal.motionX || 0.5) + spread, y: signal.motionY || 0.5 } };
  }

  update(signal, dt) {
    const hands = this._hands(signal);
    const cx = (hands.left.x + hands.right.x) * 0.5;
    const cy = (hands.left.y + hands.right.y) * 0.5;
    const distance = Math.hypot(hands.left.x - hands.right.x, hands.left.y - hands.right.y);
    const opening = distance - this.prevDistance;
    this.prevDistance += (distance - this.prevDistance) * 0.32;
    this.centerX += (cx - this.centerX) * 0.3;
    this.centerY += (cy - this.centerY) * 0.3;
    const closeEnergy = Math.max(0, 0.28 - distance) * 3.4;
    const blast = Math.max(0, opening - 0.018) * 24;
    this.energy += (Math.max(closeEnergy, blast) - this.energy) * 0.24;
    const delta = Math.min(2, Math.max(0.35, dt / 16.67 || 1));
    for (const p of this.particles) {
      let dx = this.centerX - p.x;
      let dy = this.centerY - p.y;
      const r2 = dx * dx + dy * dy + 0.0015;
      const inv = 1 / Math.sqrt(r2);
      dx *= inv; dy *= inv;
      const attraction = (0.00022 + closeEnergy * 0.0014) / Math.max(0.08, r2 * 12);
      p.vx += dx * attraction * delta;
      p.vy += dy * attraction * delta;
      if (blast > 0) { p.vx -= dx * blast * 0.0032 * delta; p.vy -= dy * blast * 0.0032 * delta; }
      const swirl = 0.00018 + this.energy * 0.0007;
      p.vx += -dy * swirl * delta;
      p.vy += dx * swirl * delta;
      p.vx *= Math.pow(0.975, delta);
      p.vy *= Math.pow(0.975, delta);
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      if (p.x < -0.2 || p.x > 1.2 || p.y < -0.2 || p.y > 1.2) {
        const a = p.seed * Math.PI * 2 + performance.now() * 0.0001;
        const r = 0.08 + p.seed * 0.24;
        p.x = this.centerX + Math.cos(a) * r;
        p.y = this.centerY + Math.sin(a) * r;
        p.vx = 0; p.vy = 0;
      }
    }
  }

  render({ source, signal }) {
    const { width: w, height: h } = this.canvas;
    const hands = this._hands(signal);
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.globalAlpha = 0.16;
    this.ctx.drawImage(source, 0, 0, w, h);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const radius = Math.hypot(p.x - this.centerX, p.y - this.centerY);
      const alpha = Math.max(0.08, 0.75 - radius * 0.75) * (0.5 + this.energy * 0.6);
      this.ctx.fillStyle = `hsla(${260 - Math.min(90, radius * 160)},100%,${65 + this.energy * 12}%,${Math.min(0.95, alpha)})`;
      this.ctx.fillRect(p.x * w, p.y * h, 1.2 + this.energy * 1.8, 1.2 + this.energy * 1.8);
    }
    const lx = hands.left.x * w, ly = hands.left.y * h, rx = hands.right.x * w, ry = hands.right.y * h, cx = this.centerX * w, cy = this.centerY * h;
    this.ctx.strokeStyle = `rgba(255,255,255,${0.2 + this.energy * 0.55})`;
    this.ctx.lineWidth = 1 + this.energy * 2.4;
    this.ctx.beginPath(); this.ctx.moveTo(lx, ly); this.ctx.quadraticCurveTo(cx, cy, rx, ry); this.ctx.stroke();
    this.ctx.beginPath(); this.ctx.arc(cx, cy, 5 + this.energy * 20, 0, Math.PI * 2); this.ctx.stroke();
    this.ctx.globalCompositeOperation = 'source-over';
  }
}

export const bodyEchoFactory = (context) => new BodyEchoEffect(context);
export const flowSkinFactory = (context) => new FlowSkinEffect(context);
export const magneticBodyFactory = (context) => new MagneticBodyEffect(context);
export const handSingularityFactory = (context) => new HandSingularityEffect(context);
