const TAU = Math.PI * 2;

function palette(style) {
  const tables = {
    chrome: ['#05080d', '#8ebad2', '#f5fbff'],
    lacquer: ['#0c0307', '#da183f', '#ffd1c2'],
    prism: ['#080511', '#7f48ff', '#5ee7ff'],
    mineral: ['#021012', '#17a995', '#d7fff1'],
  };
  return tables[style] || tables.prism;
}

export class SourceEngine {
  constructor({ bus, video, preview, width = 256, height = 192 }) {
    this.bus = bus;
    this.video = video;
    this.preview = preview;
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    this.previewCtx = preview?.getContext('2d', { alpha: false }) || null;
    this.mode = 'synthetic';
    this.stream = null;
    this.frame = 0;
    this.style = 'prism';
  }

  async useCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia is not supported');
    this.stopCamera();
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.mode = 'camera';
    this.bus.publish({ source: 'camera' });
  }

  useSynthetic() {
    this.mode = 'synthetic';
    this.bus.publish({ source: 'synthetic' });
  }

  stopCamera() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }

  setStyle(style) { this.style = style; }
  getFrameSource() { return this.mode === 'camera' && this.video.readyState >= 2 ? this.video : this.canvas; }

  tick(timeMs) {
    const time = timeMs * 0.001;
    if (this.mode === 'camera' && this.video.readyState >= 2) this._drawCamera();
    else this._drawSynthetic(time);
    this.frame += 1;
    if (this.previewCtx) {
      this.previewCtx.imageSmoothingEnabled = true;
      this.previewCtx.drawImage(this.canvas, 0, 0, this.preview.width, this.preview.height);
    }
    this.bus.publish({ frame: this.frame, source: this.mode });
  }

  _drawCamera() {
    const vw = this.video.videoWidth || this.width;
    const vh = this.video.videoHeight || this.height;
    const scale = Math.max(this.width / vw, this.height / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    this.ctx.save();
    this.ctx.translate(this.width, 0);
    this.ctx.scale(-1, 1);
    this.ctx.drawImage(this.video, (this.width - dw) * 0.5, (this.height - dh) * 0.5, dw, dh);
    this.ctx.restore();
  }

  _drawSynthetic(time) {
    const [dark, mid, hot] = palette(this.style);
    const ctx = this.ctx;
    const bg = ctx.createLinearGradient(0, 0, this.width, this.height);
    bg.addColorStop(0, dark); bg.addColorStop(0.55, mid); bg.addColorStop(1, dark);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, this.width, this.height);

    const cx = this.width * (0.5 + Math.sin(time * 0.63) * 0.15);
    const cy = this.height * (0.5 + Math.cos(time * 0.47) * 0.1);
    const radius = 30 + Math.sin(time * 1.2) * 8;
    const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, radius * 2.4);
    glow.addColorStop(0, hot); glow.addColorStop(0.35, mid); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = glow; ctx.fillRect(0, 0, this.width, this.height); ctx.globalCompositeOperation = 'source-over';

    ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.sin(time * 0.71) * 0.26); ctx.strokeStyle = hot; ctx.lineWidth = 3; ctx.beginPath();
    for (let i = 0; i < 140; i += 1) {
      const a = (i / 139) * TAU * 2.4;
      const r = 10 + a * 6 + Math.sin(time * 2 + i * 0.19) * 4;
      const x = Math.cos(a) * r; const y = Math.sin(a * 1.07) * r * 0.62;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.restore();

    for (let i = 0; i < 28; i += 1) {
      const a = time * (0.25 + (i % 5) * 0.03) + i * 2.399963;
      const r = 18 + (i * 9) % 92;
      const x = cx + Math.cos(a) * r; const y = cy + Math.sin(a * 1.13) * r * 0.67;
      ctx.fillStyle = i % 3 === 0 ? hot : mid; ctx.globalAlpha = 0.35 + (i % 4) * 0.12; ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
  }
}
