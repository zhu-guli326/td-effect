function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function sampleMaskCandidates(ctx, threshold = 55, step = 3) {
  const { width, height } = ctx.canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const candidates = [];
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      if (data[(y * width + x) * 4] > threshold) candidates.push([x / width, y / height]);
    }
  }
  return candidates;
}

class HandFlowSkinEffect {
  constructor({ canvas, analysis }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.analysis = analysis;
    this.base = makeCanvas(canvas.width, canvas.height);
    this.baseCtx = this.base.getContext('2d');
    this.layer = makeCanvas(canvas.width, canvas.height);
    this.layerCtx = this.layer.getContext('2d');
  }

  render({ source, handField, handMask, signal }) {
    const { width: w, height: h } = this.canvas;
    const motion = Math.min(1, signal.motion || 0);
    const handSpeed = Math.min(3, signal.handSpeed || 0);
    this.baseCtx.clearRect(0, 0, w, h);
    this.baseCtx.drawImage(source, 0, 0, w, h);
    this.layerCtx.clearRect(0, 0, w, h);

    const cols = 30;
    const rows = 20;
    const cw = w / cols;
    const ch = h / rows;
    const gain = 2.4 + (signal.intensity || 1) * 3 + motion * 5.2 + handSpeed * 1.4;
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        const nx = (gx + 0.5) / cols;
        const ny = (gy + 0.5) / rows;
        const [vx, vy] = this.analysis.sampleFlow(nx, ny);
        const mag = Math.min(1, Math.hypot(vx, vy) / 3.4);
        if (mag < 0.012) continue;
        const sx = gx * cw;
        const sy = gy * ch;
        this.layerCtx.globalAlpha = 0.32 + mag * 0.68;
        this.layerCtx.drawImage(
          this.base,
          sx, sy, cw + 1, ch + 1,
          sx + vx * gain, sy + vy * gain,
          cw + 1, ch + 1,
        );
      }
    }
    this.layerCtx.globalAlpha = 1;

    const activeMask = signal.handMaskReady ? (handField || handMask) : null;
    if (activeMask) {
      this.layerCtx.globalCompositeOperation = 'destination-in';
      this.layerCtx.drawImage(activeMask, 0, 0, w, h);
      this.layerCtx.globalCompositeOperation = 'source-over';
    }

    this.ctx.clearRect(0, 0, w, h);
    this.ctx.drawImage(this.base, 0, 0);
    if (activeMask) {
      this.ctx.globalCompositeOperation = 'screen';
      this.ctx.globalAlpha = 0.82 + Math.min(0.18, handSpeed * 0.08);
      this.ctx.drawImage(this.layer, 0, 0);
      this.ctx.globalAlpha = 0.28 + Math.min(0.35, handSpeed * 0.12);
      this.ctx.drawImage(activeMask, 0, 0, w, h);
      this.ctx.globalAlpha = 1;
      this.ctx.globalCompositeOperation = 'source-over';
    }
  }
}

class MagneticHandEffect {
  constructor({ canvas, analysis, hand }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.analysis = analysis;
    this.hand = hand;
    this.count = 1350;
    this.particles = Array.from({ length: this.count }, (_, i) => ({
      x: Math.random(), y: Math.random(), vx: 0, vy: 0,
      hx: Math.random(), hy: Math.random(), seed: i / this.count,
    }));
    this.lastHomes = 0;
  }

  _reseedHomes(signal, time) {
    if (time - this.lastHomes < 260) return;
    this.lastHomes = time;
    if (signal.handMaskReady && this.hand?.maskCtx) {
      const candidates = sampleMaskCandidates(this.hand.maskCtx, 70, 2);
      if (candidates.length > 8) {
        for (const p of this.particles) {
          const home = candidates[(Math.random() * candidates.length) | 0];
          p.hx = home[0];
          p.hy = home[1];
        }
        return;
      }
    }
    const cx = signal.handCenterX ?? signal.motionX ?? 0.5;
    const cy = signal.handCenterY ?? signal.motionY ?? 0.5;
    for (let i = 0; i < this.particles.length; i += 1) {
      const a = i * 2.399963;
      const r = Math.sqrt((i + 0.5) / this.particles.length) * 0.18;
      const p = this.particles[i];
      p.hx = cx + Math.cos(a) * r;
      p.hy = cy + Math.sin(a) * r;
    }
  }

  update(signal, dt, time) {
    this._reseedHomes(signal, time);
    const delta = Math.min(2, Math.max(0.35, (dt || 1 / 60) * 60));
    const handSpeed = Math.min(3, signal.handSpeed || 0);
    const openness = signal.handOpenness || 0;
    const pinch = signal.handPinch || 0;
    for (const p of this.particles) {
      const [fx, fy] = this.analysis.sampleFlow(p.x, p.y);
      const spring = 0.018 + pinch * 0.04 + Math.max(0, 0.9 - handSpeed) * 0.012;
      p.vx += (p.hx - p.x) * spring * delta;
      p.vy += (p.hy - p.y) * spring * delta;
      const flowGain = 0.0016 + handSpeed * 0.0024 + openness * 0.0012;
      p.vx += fx * flowGain * delta;
      p.vy += fy * flowGain * delta;
      p.vx *= Math.pow(0.91, delta);
      p.vy *= Math.pow(0.91, delta);
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      if (p.x < -0.15 || p.x > 1.15 || p.y < -0.15 || p.y > 1.15) {
        p.x = p.hx; p.y = p.hy; p.vx = 0; p.vy = 0;
      }
    }
  }

  render({ source, signal, handField }) {
    const { width: w, height: h } = this.canvas;
    const handSpeed = Math.min(3, signal.handSpeed || 0);
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.globalAlpha = 0.08;
    this.ctx.drawImage(source, 0, 0, w, h);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const speed = Math.min(1, Math.hypot(p.vx, p.vy) * 75);
      const x = p.x * w;
      const y = p.y * h;
      const size = 0.65 + speed * 2.2 + Math.min(1, handSpeed) * 0.7;
      this.ctx.fillStyle = `hsla(${185 + speed * 125 + p.seed * 25},100%,${62 + speed * 20}%,${0.22 + speed * 0.68})`;
      this.ctx.beginPath();
      this.ctx.arc(x, y, size, 0, Math.PI * 2);
      this.ctx.fill();
      if (speed > 0.16) {
        this.ctx.strokeStyle = `hsla(${200 + speed * 90},100%,82%,${0.12 + speed * 0.35})`;
        this.ctx.lineWidth = 0.4 + speed;
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(x - p.vx * w * 5.5, y - p.vy * h * 5.5);
        this.ctx.stroke();
      }
    }
    if (signal.handMaskReady && handField) {
      this.ctx.globalAlpha = 0.12 + Math.min(0.32, handSpeed * 0.1);
      this.ctx.drawImage(handField, 0, 0, w, h);
      this.ctx.globalAlpha = 1;
    }
    this.ctx.globalCompositeOperation = 'source-over';
  }
}

class GestureHandFieldEffect {
  constructor({ canvas }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.count = 1100;
    this.particles = Array.from({ length: this.count }, (_, i) => {
      const a = i * 2.399963;
      const r = 0.03 + Math.random() * 0.36;
      return { x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r, vx: 0, vy: 0, seed: Math.random() };
    });
    this.centerX = 0.5;
    this.centerY = 0.5;
    this.energy = 0;
    this.lastOpen = 0;
  }

  _field(signal) {
    const hands = signal.hands || [];
    if (hands.length) {
      const center = hands.reduce((acc, hand) => ({ x: acc.x + hand.center.x, y: acc.y + hand.center.y }), { x: 0, y: 0 });
      center.x /= hands.length;
      center.y /= hands.length;
      const openness = hands.reduce((sum, hand) => sum + (hand.openness || 0), 0) / hands.length;
      const pinch = Math.max(...hands.map((hand) => hand.pinch || 0));
      const speed = Math.max(...hands.map((hand) => hand.speed || 0));
      const gesture = hands.slice().sort((a, b) => b.gestureScore - a.gestureScore)[0]?.gesture || 'None';
      return { center, openness, pinch, speed, gesture, hands };
    }
    return {
      center: { x: signal.motionX || 0.5, y: signal.motionY || 0.5 },
      openness: 0,
      pinch: 0,
      speed: Math.hypot(signal.flowX || 0, signal.flowY || 0),
      gesture: 'None',
      hands: [],
    };
  }

  update(signal, dt) {
    const field = this._field(signal);
    this.centerX += (field.center.x - this.centerX) * 0.35;
    this.centerY += (field.center.y - this.centerY) * 0.35;
    const openingImpulse = Math.max(0, field.openness - this.lastOpen);
    this.lastOpen += (field.openness - this.lastOpen) * 0.42;

    const fist = field.gesture === 'Closed_Fist' ? 1 : 0;
    const openPalm = field.gesture === 'Open_Palm' ? 1 : 0;
    const victory = field.gesture === 'Victory' ? 1 : 0;
    const attraction = 0.35 + field.pinch * 2.4 + fist * 2.2;
    const blast = Math.min(4, openingImpulse * 11 + openPalm * Math.min(2, field.speed * 0.8) + victory * 0.35);
    const targetEnergy = Math.min(1.8, field.pinch * 0.8 + fist * 0.8 + openPalm * 0.45 + field.speed * 0.18);
    this.energy += (targetEnergy - this.energy) * 0.22;

    const delta = Math.min(2, Math.max(0.35, (dt || 1 / 60) * 60));
    for (const p of this.particles) {
      let dx = this.centerX - p.x;
      let dy = this.centerY - p.y;
      const r2 = dx * dx + dy * dy + 0.0014;
      const inv = 1 / Math.sqrt(r2);
      dx *= inv;
      dy *= inv;
      const force = (0.00016 + attraction * 0.00068) / Math.max(0.07, r2 * 10);
      p.vx += dx * force * delta;
      p.vy += dy * force * delta;
      if (blast > 0.02) {
        p.vx -= dx * blast * 0.0038 * delta;
        p.vy -= dy * blast * 0.0038 * delta;
      }
      const swirl = 0.00012 + this.energy * 0.00072;
      p.vx += -dy * swirl * delta;
      p.vy += dx * swirl * delta;
      p.vx *= Math.pow(0.973, delta);
      p.vy *= Math.pow(0.973, delta);
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      if (p.x < -0.2 || p.x > 1.2 || p.y < -0.2 || p.y > 1.2) {
        const a = p.seed * Math.PI * 2 + performance.now() * 0.00012;
        const r = 0.05 + p.seed * 0.2;
        p.x = this.centerX + Math.cos(a) * r;
        p.y = this.centerY + Math.sin(a) * r;
        p.vx = 0;
        p.vy = 0;
      }
    }
  }

  render({ source, signal, handField, hands }) {
    const { width: w, height: h } = this.canvas;
    const field = this._field(signal);
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.globalAlpha = 0.11;
    this.ctx.drawImage(source, 0, 0, w, h);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'lighter';

    if (signal.handMaskReady && handField) {
      this.ctx.globalAlpha = 0.18 + Math.min(0.4, field.speed * 0.08 + field.openness * 0.22);
      this.ctx.drawImage(handField, 0, 0, w, h);
      this.ctx.globalAlpha = 1;
    }

    for (const p of this.particles) {
      const radius = Math.hypot(p.x - this.centerX, p.y - this.centerY);
      const speed = Math.min(1, Math.hypot(p.vx, p.vy) * 70);
      const alpha = Math.max(0.06, 0.7 - radius * 0.75) * (0.45 + this.energy * 0.5 + speed * 0.45);
      this.ctx.fillStyle = `hsla(${265 - Math.min(110, radius * 170) + speed * 35},100%,${65 + speed * 18}%,${Math.min(0.95, alpha)})`;
      this.ctx.fillRect(p.x * w, p.y * h, 1 + speed * 1.8 + this.energy, 1 + speed * 1.8 + this.energy);
    }

    for (const hand of hands || []) {
      const x = hand.center.x * w;
      const y = hand.center.y * h;
      const r = 10 + hand.openness * 18 + hand.pinch * 8 + Math.min(16, hand.speed * 4);
      this.ctx.strokeStyle = `hsla(${hand.gesture === 'Closed_Fist' ? 330 : hand.gesture === 'Open_Palm' ? 190 : 260},100%,82%,${0.42 + Math.min(0.45, hand.gestureScore * 0.4)})`;
      this.ctx.lineWidth = 1 + hand.pinch * 2 + Math.min(2, hand.speed * 0.3);
      this.ctx.beginPath();
      this.ctx.arc(x, y, r, 0, Math.PI * 2);
      this.ctx.stroke();
    }

    this.ctx.globalCompositeOperation = 'source-over';
  }
}

export const handFlowSkinFactory = (context) => new HandFlowSkinEffect(context);
export const magneticHandFactory = (context) => new MagneticHandEffect(context);
export const gestureHandFieldFactory = (context) => new GestureHandFieldEffect(context);
