export class AnalysisEngine {
  constructor({ bus, source, width = 96, height = 72, flowStep = 8 }) {
    this.bus = bus;
    this.source = source;
    this.width = width;
    this.height = height;
    this.flowStep = flowStep;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true, alpha: false });
    this.edgeCanvas = document.createElement('canvas');
    this.edgeCanvas.width = width;
    this.edgeCanvas.height = height;
    this.edgeCtx = this.edgeCanvas.getContext('2d', { alpha: false });
    this.gridW = Math.floor((width - 8) / flowStep);
    this.gridH = Math.floor((height - 8) / flowStep);
    this.flow = new Float32Array(this.gridW * this.gridH * 2);
    this.flowCanvas = document.createElement('canvas');
    this.flowCanvas.width = this.gridW;
    this.flowCanvas.height = this.gridH;
    this.flowCtx = this.flowCanvas.getContext('2d', { alpha: false });
    this.previous = null;
    this.current = new Float32Array(width * height);
    this.edges = new Float32Array(width * height);
    this.lastTime = performance.now();
    this.fps = 0;
  }

  tick(timeMs) {
    this.ctx.drawImage(this.source.canvas, 0, 0, this.width, this.height);
    const rgba = this.ctx.getImageData(0, 0, this.width, this.height).data;
    const count = this.width * this.height;
    let lumaSum = 0, motionSum = 0, weightedX = 0, weightedY = 0;

    for (let p = 0; p < count; p += 1) {
      const i = p * 4;
      const lum = (rgba[i] * 0.2126 + rgba[i + 1] * 0.7152 + rgba[i + 2] * 0.0722) / 255;
      this.current[p] = lum; lumaSum += lum;
      if (this.previous) {
        const diff = Math.abs(lum - this.previous[p]);
        motionSum += diff;
        const x = p % this.width, y = Math.floor(p / this.width);
        weightedX += x * diff; weightedY += y * diff;
      }
    }

    this._computeEdges();
    if (this.previous) this._computeLucasKanade(); else this.flow.fill(0);
    this._paintEdgeTexture(); this._paintFlowTexture();

    const motion = Math.min(1, (motionSum / count) * 5.5);
    const motionX = motionSum > 0.02 ? weightedX / motionSum / Math.max(1, this.width - 1) : 0.5;
    const motionY = motionSum > 0.02 ? weightedY / motionSum / Math.max(1, this.height - 1) : 0.5;
    let flowX = 0, flowY = 0, active = 0;
    for (let i = 0; i < this.flow.length; i += 2) {
      const vx = this.flow[i], vy = this.flow[i + 1], mag = Math.hypot(vx, vy);
      if (mag > 0.02) { flowX += vx; flowY += vy; active += 1; }
    }
    if (active) { flowX /= active; flowY /= active; }

    const dt = Math.max(1, timeMs - this.lastTime);
    this.fps = this.fps * 0.85 + (1000 / dt) * 0.15; this.lastTime = timeMs;
    this.bus.publish({ luma: lumaSum / count, motion, motionX, motionY, flowX, flowY, analysisFps: this.fps });

    if (!this.previous) this.previous = new Float32Array(count);
    this.previous.set(this.current);
  }

  _at(buffer, x, y) {
    x = Math.max(0, Math.min(this.width - 1, x)); y = Math.max(0, Math.min(this.height - 1, y));
    return buffer[y * this.width + x];
  }

  _computeEdges() {
    for (let y = 1; y < this.height - 1; y += 1) for (let x = 1; x < this.width - 1; x += 1) {
      const gx = -this._at(this.current,x-1,y-1)+this._at(this.current,x+1,y-1)-2*this._at(this.current,x-1,y)+2*this._at(this.current,x+1,y)-this._at(this.current,x-1,y+1)+this._at(this.current,x+1,y+1);
      const gy = -this._at(this.current,x-1,y-1)-2*this._at(this.current,x,y-1)-this._at(this.current,x+1,y-1)+this._at(this.current,x-1,y+1)+2*this._at(this.current,x,y+1)+this._at(this.current,x+1,y+1);
      this.edges[y * this.width + x] = Math.min(1, Math.hypot(gx, gy));
    }
  }

  _computeLucasKanade() {
    const r = 3, step = this.flowStep; let out = 0;
    for (let gy = 0; gy < this.gridH; gy += 1) {
      const cy = 4 + gy * step;
      for (let gx = 0; gx < this.gridW; gx += 1) {
        const cx = 4 + gx * step; let gxx=0,gxy=0,gyy=0,bx=0,by=0;
        for (let oy=-r; oy<=r; oy+=1) for (let ox=-r; ox<=r; ox+=1) {
          const x=cx+ox,y=cy+oy;
          const ix=(this._at(this.current,x+1,y)-this._at(this.current,x-1,y)+this._at(this.previous,x+1,y)-this._at(this.previous,x-1,y))*.25;
          const iy=(this._at(this.current,x,y+1)-this._at(this.current,x,y-1)+this._at(this.previous,x,y+1)-this._at(this.previous,x,y-1))*.25;
          const it=this._at(this.current,x,y)-this._at(this.previous,x,y);
          gxx+=ix*ix; gxy+=ix*iy; gyy+=iy*iy; bx+=-ix*it; by+=-iy*it;
        }
        const det=gxx*gyy-gxy*gxy; let vx=0,vy=0;
        if(det>0.000015){vx=(gyy*bx-gxy*by)/det;vy=(gxx*by-gxy*bx)/det;const mag=Math.hypot(vx,vy);if(mag>5){vx*=5/mag;vy*=5/mag;}}
        this.flow[out++]=vx;this.flow[out++]=vy;
      }
    }
  }

  sampleFlow(xNorm,yNorm){
    const x=Math.max(0,Math.min(this.gridW-1,Math.floor(xNorm*this.gridW)));const y=Math.max(0,Math.min(this.gridH-1,Math.floor(yNorm*this.gridH)));const i=(y*this.gridW+x)*2;return[this.flow[i],this.flow[i+1]];
  }

  _paintFlowTexture(){
    const image=this.flowCtx.createImageData(this.gridW,this.gridH);
    for(let i=0,p=0;i<this.flow.length;i+=2,p+=4){const vx=Math.max(-5,Math.min(5,this.flow[i])),vy=Math.max(-5,Math.min(5,this.flow[i+1]));image.data[p]=Math.round((vx/10+.5)*255);image.data[p+1]=Math.round((vy/10+.5)*255);image.data[p+2]=Math.min(255,Math.round(Math.hypot(vx,vy)/5*255));image.data[p+3]=255;}
    this.flowCtx.putImageData(image,0,0);
  }

  _paintEdgeTexture(){
    const image=this.edgeCtx.createImageData(this.width,this.height);
    for(let i=0,p=0;i<this.edges.length;i+=1,p+=4){const v=Math.round(Math.min(1,this.edges[i]*1.7)*255);image.data[p]=v;image.data[p+1]=v;image.data[p+2]=v;image.data[p+3]=255;}
    this.edgeCtx.putImageData(image,0,0);
  }
}
