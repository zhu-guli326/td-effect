const BUNDLE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.js';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const POSE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = Array.from(document.scripts).find((script) => script.src === src);
    if (existing) {
      if (globalThis.vision) resolve();
      else existing.addEventListener('load', resolve, { once: true });
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

export class CVEngine {
  constructor({ bus, source, maskWidth = 128, maskHeight = 128 }) {
    this.bus = bus;
    this.source = source;
    this.landmarker = null;
    this.loading = null;
    this.disabled = false;
    this.busy = false;
    this.poseLandmarks = [];
    this.poseWorldLandmarks = [];
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = maskWidth;
    this.maskCanvas.height = maskHeight;
    this.maskCtx = this.maskCanvas.getContext('2d', { alpha: false });
    this.maskCtx.fillStyle = '#000';
    this.maskCtx.fillRect(0, 0, maskWidth, maskHeight);
  }

  async init() {
    if (this.landmarker || this.disabled) return this.landmarker;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        this.bus.publish({ cvStatus: 'loading' });
        await loadScript(BUNDLE_URL);
        const { FilesetResolver, PoseLandmarker } = globalThis.vision || {};
        if (!FilesetResolver || !PoseLandmarker) throw new Error('MediaPipe vision bundle did not expose PoseLandmarker');
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        const options = {
          runningMode: 'VIDEO',
          numPoses: 2,
          minPoseDetectionConfidence: 0.45,
          minPosePresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
          outputSegmentationMasks: true,
        };
        try {
          this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
            ...options,
            baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'GPU' },
          });
        } catch (gpuError) {
          console.warn('[cv] GPU delegate unavailable; retrying MediaPipe on CPU.', gpuError);
          this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
            ...options,
            baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'CPU' },
          });
        }
        this.bus.publish({ cvStatus: 'ready' });
        return this.landmarker;
      } catch (error) {
        console.warn('[cv] MediaPipe unavailable; pose/mask effects will use fallback signals.', error);
        this.disabled = true;
        this.bus.publish({ cvStatus: 'unavailable', poseReady: false, maskReady: false });
        return null;
      }
    })();
    return this.loading;
  }

  async tick(timeMs) {
    if (this.source.mode !== 'camera' || this.busy) return;
    this.busy = true;
    try {
      if (!this.landmarker && !this.disabled) await this.init();
      if (!this.landmarker) return;
      const result = this.landmarker.detectForVideo(this.source.canvas, Math.floor(timeMs));
      this.poseLandmarks = result.landmarks || result.poseLandmarks || [];
      this.poseWorldLandmarks = result.worldLandmarks || result.poseWorldLandmarks || [];
      let maskReady = false;
      const masks = result.segmentationMasks || [];
      if (masks[0]) {
        maskReady = this._copyMask(masks[0]);
        for (const mask of masks) mask?.close?.();
      } else if (this.poseLandmarks[0]?.length) {
        this._paintFallbackMask(this.poseLandmarks[0]);
        maskReady = true;
      } else {
        this.maskCtx.fillStyle = '#000';
        this.maskCtx.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
      }
      this.bus.publish({
        cvStatus: 'ready',
        poseReady: this.poseLandmarks.length > 0,
        poseCount: this.poseLandmarks.length,
        poseLandmarks: this.poseLandmarks,
        poseWorldLandmarks: this.poseWorldLandmarks,
        maskReady,
      });
    } catch (error) {
      console.warn('[cv] frame failed', error);
      this.bus.publish({ cvStatus: 'frame-error' });
    } finally {
      this.busy = false;
    }
  }

  _copyMask(mask) {
    try {
      const data = mask.getAsFloat32Array?.();
      const width = mask.width || this.maskCanvas.width;
      const height = mask.height || this.maskCanvas.height;
      if (!data?.length) return false;
      const temp = document.createElement('canvas');
      temp.width = width;
      temp.height = height;
      const ctx = temp.getContext('2d');
      const image = ctx.createImageData(width, height);
      for (let i = 0, p = 0; i < data.length; i += 1, p += 4) {
        const v = Math.max(0, Math.min(255, Math.round(data[i] * 255)));
        image.data[p] = v;
        image.data[p + 1] = v;
        image.data[p + 2] = v;
        image.data[p + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
      this.maskCtx.drawImage(temp, 0, 0, this.maskCanvas.width, this.maskCanvas.height);
      return true;
    } catch (error) {
      console.warn('[cv] mask copy failed', error);
      return false;
    }
  }

  _paintFallbackMask(landmarks) {
    const ctx = this.maskCtx;
    const w = this.maskCanvas.width;
    const h = this.maskCanvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineCap = 'round';
    const pairs = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
    for (const [a, b] of pairs) {
      const p = landmarks[a];
      const q = landmarks[b];
      if (!p || !q) continue;
      ctx.lineWidth = Math.max(5, w * 0.055 * (1 - Math.min(0.7, Math.abs((p.z || 0) + (q.z || 0)) * 0.5)));
      ctx.beginPath();
      ctx.moveTo(p.x * w, p.y * h);
      ctx.lineTo(q.x * w, q.y * h);
      ctx.stroke();
    }
    for (const index of [0, 11, 12, 23, 24]) {
      const p = landmarks[index];
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, index === 0 ? w * 0.08 : w * 0.055, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  dispose() {
    this.landmarker?.close?.();
  }
}
