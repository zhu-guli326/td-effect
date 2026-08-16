const BUNDLE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.js';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const GESTURE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = Array.from(document.scripts).find((script) => script.src === src);
    if (existing) {
      if (globalThis.vision) resolve();
      else {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
      }
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function makeMask(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

function distance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function averagePoints(points) {
  if (!points.length) return { x: 0.5, y: 0.5 };
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x || 0;
    y += point.y || 0;
  }
  return { x: x / points.length, y: y / points.length };
}

function convexHull(points) {
  if (points.length <= 3) return points.slice();
  const sorted = points.map((point) => ({ x: point.x, y: point.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function gestureCategory(result, index) {
  const category = result.gestures?.[index]?.[0];
  return {
    name: category?.categoryName || category?.displayName || 'None',
    score: category?.score || 0,
  };
}

export class HandEngine {
  constructor({ bus, source, maskWidth = 192, maskHeight = 144 }) {
    this.bus = bus;
    this.source = source;
    this.recognizer = null;
    this.loading = null;
    this.disabled = false;
    this.busy = false;
    this.hands = [];
    this.previous = new Map();
    this.lastTickTime = 0;

    const combined = makeMask(maskWidth, maskHeight);
    const field = makeMask(maskWidth, maskHeight);
    const left = makeMask(maskWidth, maskHeight);
    const right = makeMask(maskWidth, maskHeight);
    this.maskCanvas = combined.canvas;
    this.maskCtx = combined.ctx;
    this.fieldCanvas = field.canvas;
    this.fieldCtx = field.ctx;
    this.leftMaskCanvas = left.canvas;
    this.leftMaskCtx = left.ctx;
    this.rightMaskCanvas = right.canvas;
    this.rightMaskCtx = right.ctx;
  }

  async init() {
    if (this.recognizer || this.disabled) return this.recognizer;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        this.bus.publish({ handStatus: 'loading' });
        await loadScript(BUNDLE_URL);
        const { FilesetResolver, GestureRecognizer } = globalThis.vision || {};
        if (!FilesetResolver || !GestureRecognizer) throw new Error('MediaPipe vision bundle did not expose GestureRecognizer');
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        const options = {
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.45,
          minHandPresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        };
        try {
          this.recognizer = await GestureRecognizer.createFromOptions(fileset, {
            ...options,
            baseOptions: { modelAssetPath: GESTURE_MODEL_URL, delegate: 'GPU' },
          });
        } catch (gpuError) {
          console.warn('[hand] GPU delegate unavailable; retrying MediaPipe GestureRecognizer on CPU.', gpuError);
          this.recognizer = await GestureRecognizer.createFromOptions(fileset, {
            ...options,
            baseOptions: { modelAssetPath: GESTURE_MODEL_URL, delegate: 'CPU' },
          });
        }
        this.bus.publish({ handStatus: 'ready' });
        return this.recognizer;
      } catch (error) {
        console.warn('[hand] MediaPipe GestureRecognizer unavailable.', error);
        this.disabled = true;
        this.bus.publish({ handStatus: 'unavailable', handReady: false, handMaskReady: false, hands: [] });
        return null;
      }
    })();
    return this.loading;
  }

  async tick(timeMs) {
    if (this.source.mode !== 'camera' || this.busy) return;
    this.busy = true;
    try {
      if (!this.recognizer && !this.disabled) await this.init();
      if (!this.recognizer) return;

      // Analyze the mirrored SourceEngine canvas so hand coordinates match the rendered visual space.
      const result = this.recognizer.recognizeForVideo(this.source.canvas, Math.floor(timeMs));
      const landmarksList = result.landmarks || result.handLandmarks || [];
      const worldList = result.worldLandmarks || result.handWorldLandmarks || [];
      const dt = this.lastTickTime ? Math.max(1 / 120, (timeMs - this.lastTickTime) / 1000) : 1 / 15;
      this.lastTickTime = timeMs;

      this._clearMasks();
      const hands = [];
      for (let i = 0; i < landmarksList.length; i += 1) {
        const landmarks = landmarksList[i];
        if (!landmarks?.length) continue;
        const center = averagePoints([landmarks[0], landmarks[5], landmarks[9], landmarks[13], landmarks[17]].filter(Boolean));
        const screenSide = center.x < 0.5 ? 'left' : 'right';
        const handedness = result.handedness?.[i]?.[0]?.categoryName || result.handedness?.[i]?.[0]?.displayName || 'Unknown';
        const gesture = gestureCategory(result, i);
        const palmScale = Math.max(0.035, distance(landmarks[0], landmarks[9]));
        const prev = this.previous.get(screenSide) || center;
        const rawVx = (center.x - prev.x) / dt;
        const rawVy = (center.y - prev.y) / dt;
        const priorVelocity = this.previous.get(`${screenSide}:velocity`) || { x: 0, y: 0 };
        const velocity = {
          x: priorVelocity.x * 0.62 + rawVx * 0.38,
          y: priorVelocity.y * 0.62 + rawVy * 0.38,
        };
        this.previous.set(screenSide, center);
        this.previous.set(`${screenSide}:velocity`, velocity);

        const tips = [4, 8, 12, 16, 20].map((index) => landmarks[index]).filter(Boolean);
        const meanReach = tips.reduce((sum, tip) => sum + distance(tip, landmarks[0]) / palmScale, 0) / Math.max(1, tips.length);
        const openness = clamp01((meanReach - 1.45) / 1.5);
        const pinchDistance = distance(landmarks[4], landmarks[8]) / palmScale;
        const pinch = 1 - clamp01((pinchDistance - 0.18) / 0.7);
        const orientation = {
          x: ((landmarks[9]?.x || center.x) - (landmarks[0]?.x || center.x)) / palmScale,
          y: ((landmarks[9]?.y || center.y) - (landmarks[0]?.y || center.y)) / palmScale,
        };

        const hand = {
          index: i,
          side: screenSide,
          handedness,
          landmarks,
          worldLandmarks: worldList[i] || [],
          center,
          velocity,
          speed: Math.hypot(velocity.x, velocity.y),
          openness,
          pinch,
          gesture: gesture.name,
          gestureScore: gesture.score,
          palmScale,
          orientation,
        };
        hands.push(hand);
        const targetCtx = screenSide === 'left' ? this.leftMaskCtx : this.rightMaskCtx;
        this._paintHandMask(targetCtx, landmarks, palmScale);
      }

      this.hands = hands;
      this._composeMasks();
      const primary = hands.slice().sort((a, b) => b.gestureScore - a.gestureScore)[0] || null;
      const left = hands.find((hand) => hand.side === 'left') || null;
      const right = hands.find((hand) => hand.side === 'right') || null;
      this.bus.publish({
        handStatus: 'ready',
        handReady: hands.length > 0,
        handMaskReady: hands.length > 0,
        handCount: hands.length,
        hands,
        handLeft: left,
        handRight: right,
        handCenterX: primary?.center.x ?? 0.5,
        handCenterY: primary?.center.y ?? 0.5,
        handVelocityX: primary?.velocity.x ?? 0,
        handVelocityY: primary?.velocity.y ?? 0,
        handSpeed: primary?.speed ?? 0,
        handOpenness: primary?.openness ?? 0,
        handPinch: primary?.pinch ?? 0,
        handGesture: primary?.gesture || 'None',
      });
    } catch (error) {
      console.warn('[hand] frame failed', error);
      this.bus.publish({ handStatus: 'frame-error' });
    } finally {
      this.busy = false;
    }
  }

  _clearMasks() {
    for (const ctx of [this.maskCtx, this.fieldCtx, this.leftMaskCtx, this.rightMaskCtx]) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    }
  }

  _paintHandMask(ctx, landmarks, palmScale) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const minSide = Math.min(w, h);
    const radius = Math.max(3.5, palmScale * minSide * 0.24);
    const fingerWidth = Math.max(4, palmScale * minSide * 0.38);
    const point = (index) => ({ x: landmarks[index].x * w, y: landmarks[index].y * h });

    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const palmIndices = [0, 1, 5, 9, 13, 17];
    const palmHull = convexHull(palmIndices.map(point));
    if (palmHull.length) {
      ctx.beginPath();
      ctx.moveTo(palmHull[0].x, palmHull[0].y);
      for (let i = 1; i < palmHull.length; i += 1) ctx.lineTo(palmHull[i].x, palmHull[i].y);
      ctx.closePath();
      ctx.fill();
    }

    const chains = [
      [0, 1, 2, 3, 4],
      [0, 5, 6, 7, 8],
      [0, 9, 10, 11, 12],
      [0, 13, 14, 15, 16],
      [0, 17, 18, 19, 20],
    ];
    ctx.lineWidth = fingerWidth;
    for (const chain of chains) {
      ctx.beginPath();
      const first = point(chain[0]);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < chain.length; i += 1) {
        const p = point(chain[i]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    for (let i = 0; i < landmarks.length; i += 1) {
      const p = point(i);
      const scale = [4, 8, 12, 16, 20].includes(i) ? 0.9 : 0.65;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _composeMasks() {
    const w = this.maskCanvas.width;
    const h = this.maskCanvas.height;
    this.maskCtx.save();
    this.maskCtx.globalCompositeOperation = 'lighter';
    this.maskCtx.drawImage(this.leftMaskCanvas, 0, 0);
    this.maskCtx.drawImage(this.rightMaskCanvas, 0, 0);
    this.maskCtx.restore();

    this.fieldCtx.save();
    this.fieldCtx.fillStyle = '#000';
    this.fieldCtx.fillRect(0, 0, w, h);
    this.fieldCtx.globalCompositeOperation = 'lighter';
    this.fieldCtx.filter = `blur(${Math.max(5, Math.round(Math.min(w, h) * 0.055))}px)`;
    this.fieldCtx.globalAlpha = 0.95;
    this.fieldCtx.drawImage(this.maskCanvas, 0, 0);
    this.fieldCtx.globalAlpha = 0.55;
    this.fieldCtx.drawImage(this.maskCanvas, -4, -4, w + 8, h + 8);
    this.fieldCtx.filter = 'none';
    this.fieldCtx.globalAlpha = 1;
    this.fieldCtx.globalCompositeOperation = 'source-over';
    this.fieldCtx.restore();
  }

  reset() {
    this.hands = [];
    this.previous.clear();
    this.lastTickTime = 0;
    this._clearMasks();
    this.bus.publish({
      handReady: false,
      handMaskReady: false,
      handCount: 0,
      hands: [],
      handLeft: null,
      handRight: null,
      handGesture: 'None',
      handOpenness: 0,
      handPinch: 0,
      handSpeed: 0,
    });
  }

  dispose() {
    this.recognizer?.close?.();
    this.reset();
  }
}
