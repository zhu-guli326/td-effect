(() => {
  const VERSION = "0.2.0";
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCancelRaf = window.cancelAnimationFrame.bind(window);

  class SignalBus {
    constructor() {
      this.state = {
        version: VERSION,
        source: "synthetic",
        style: document.documentElement.dataset.style || "prism",
        intensity: 1,
        luma: 0,
        motion: 0,
        motionX: 0.5,
        motionY: 0.5,
        fps: 60,
        effectLoopMs: 0,
        stageLoopMs: 0,
        wireframe: false,
        burst: 0,
        timestamp: performance.now(),
      };
      this.listeners = new Set();
    }

    publish(patch) {
      Object.assign(this.state, patch, { timestamp: performance.now() });
      const snapshot = { ...this.state };
      for (const listener of this.listeners) listener(snapshot);
      document.dispatchEvent(new CustomEvent("td-runtime-signal", { detail: snapshot }));
    }

    subscribe(listener) {
      this.listeners.add(listener);
      listener({ ...this.state });
      return () => this.listeners.delete(listener);
    }
  }

  const signals = new SignalBus();
  const effectManifest = [
    { id: "feedback", label: "Feedback loop", engine: "canvas2d", inputs: ["frame", "motion"], stateful: true },
    { id: "displacement", label: "Luminance displacement", engine: "canvas2d", inputs: ["frame", "luma"], stateful: false },
    { id: "slitscan", label: "Slit-scan", engine: "canvas2d", inputs: ["frame-history"], stateful: true },
    { id: "pointcloud", label: "Luma pseudo-depth points", engine: "canvas2d", inputs: ["frame", "luma"], stateful: false },
    { id: "flow", label: "Motion-gradient particles", engine: "canvas2d", inputs: ["frame", "temporal-diff", "gradient"], stateful: true },
    { id: "triangulation", label: "Delaunay triangulation", engine: "canvas2d", inputs: ["frame", "edges"], stateful: true },
    { id: "pixelsort", label: "Pixel sorting", engine: "canvas2d", inputs: ["frame", "motion"], stateful: false },
    { id: "reaction", label: "Reaction-diffusion", engine: "canvas2d", inputs: ["frame", "edges", "motion"], stateful: true },
    { id: "hdbeads", label: "High-density beads", engine: "canvas2d", inputs: ["frame", "luma"], stateful: false },
    { id: "beads", label: "Perler beads", engine: "canvas2d", inputs: ["frame", "temporal-diff"], stateful: false },
    { id: "rings", label: "Motion-centered rings", engine: "canvas2d", inputs: ["frame", "motion"], stateful: false },
    { id: "ascii", label: "ASCII reconstruction", engine: "canvas2d", inputs: ["frame", "luma"], stateful: false },
  ];

  const scheduler = {
    visibility: { effects: true, stage: true, page: !document.hidden },
    last: { effects: 0, stage: 0 },
    cost: { effects: 0, stage: 0 },
    targetFps(kind) {
      if (!this.visibility.page) return 2;
      if (kind === "effects") return this.visibility.effects ? 30 : 8;
      if (kind === "stage") return this.visibility.stage ? 60 : 12;
      return 60;
    },
  };

  function classifyCallback(callback) {
    if (!callback) return "other";
    if (callback.name === "frame") return "effects";
    if (callback.name === "animate") return "stage";
    return "other";
  }

  window.requestAnimationFrame = (callback) => {
    const kind = classifyCallback(callback);
    if (kind === "other") return nativeRaf(callback);

    const run = (time) => {
      const minInterval = 1000 / scheduler.targetFps(kind);
      if (time - scheduler.last[kind] < minInterval) {
        return nativeRaf(run);
      }
      scheduler.last[kind] = time;
      const started = performance.now();
      callback(time);
      const elapsed = performance.now() - started;
      scheduler.cost[kind] = scheduler.cost[kind] * 0.86 + elapsed * 0.14;
      signals.publish(kind === "effects"
        ? { effectLoopMs: scheduler.cost[kind] }
        : { stageLoopMs: scheduler.cost[kind] });
      return undefined;
    };

    return nativeRaf(run);
  };
  window.cancelAnimationFrame = (id) => nativeCancelRaf(id);

  function observeSection(selector, key) {
    const element = document.querySelector(selector);
    if (!element || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
      scheduler.visibility[key] = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0.03);
    }, { threshold: [0, 0.03, 0.2] });
    observer.observe(element);
  }

  observeSection(".grid", "effects");
  observeSection(".spatial-stage", "stage");
  document.addEventListener("visibilitychange", () => {
    scheduler.visibility.page = !document.hidden;
  });

  const preview = document.getElementById("sourcePreview");
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 80;
  sampleCanvas.height = 55;
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
  let previousLuma = null;
  let smoothedMotion = 0;
  let smoothedX = 0.5;
  let smoothedY = 0.5;
  let lastSample = 0;

  function analyzePreview(time) {
    if (preview && time - lastSample > 42) {
      lastSample = time;
      sampleCtx.drawImage(preview, 0, 0, sampleCanvas.width, sampleCanvas.height);
      const pixels = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
      const currentLuma = new Float32Array(sampleCanvas.width * sampleCanvas.height);
      let lumaSum = 0;
      let diffSum = 0;
      let weightedX = 0;
      let weightedY = 0;

      for (let y = 0; y < sampleCanvas.height; y += 1) {
        for (let x = 0; x < sampleCanvas.width; x += 1) {
          const p = y * sampleCanvas.width + x;
          const i = p * 4;
          const lum = (pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722) / 255;
          currentLuma[p] = lum;
          lumaSum += lum;
          if (previousLuma) {
            const diff = Math.abs(lum - previousLuma[p]);
            diffSum += diff;
            weightedX += x * diff;
            weightedY += y * diff;
          }
        }
      }

      const count = currentLuma.length;
      const rawMotion = previousLuma ? Math.min(1, (diffSum / count) * 5.2) : 0;
      smoothedMotion += (rawMotion - smoothedMotion) * 0.24;
      if (diffSum > 0.8) {
        const x = weightedX / diffSum / Math.max(1, sampleCanvas.width - 1);
        const y = weightedY / diffSum / Math.max(1, sampleCanvas.height - 1);
        smoothedX += (x - smoothedX) * 0.24;
        smoothedY += (y - smoothedY) * 0.24;
      } else {
        smoothedX += (0.5 - smoothedX) * 0.025;
        smoothedY += (0.5 - smoothedY) * 0.025;
      }

      const status = document.getElementById("status")?.textContent || "";
      const source = /摄像头|camera/i.test(status) && !/不可用/i.test(status) ? "camera" : "synthetic";
      signals.publish({
        source,
        luma: lumaSum / count,
        motion: smoothedMotion,
        motionX: smoothedX,
        motionY: smoothedY,
      });
      previousLuma = currentLuma;
    }
    nativeRaf(analyzePreview);
  }
  nativeRaf(analyzePreview);

  const intensity = document.getElementById("intensity");
  if (intensity) {
    signals.publish({ intensity: Number(intensity.value) || 1 });
    intensity.addEventListener("input", () => signals.publish({ intensity: Number(intensity.value) || 1 }));
  }

  document.addEventListener("style-change", (event) => {
    signals.publish({ style: event.detail?.style || document.documentElement.dataset.style || "prism" });
  });
  document.addEventListener("wireframe-change", (event) => {
    signals.publish({ wireframe: Boolean(event.detail?.active) });
  });
  document.addEventListener("chroma-burst", () => {
    signals.publish({ burst: 1 });
    const started = performance.now();
    const fade = (time) => {
      const t = Math.min(1, (time - started) / 2400);
      signals.publish({ burst: Math.pow(1 - t, 0.7) });
      if (t < 1) nativeRaf(fade);
    };
    nativeRaf(fade);
  });

  const runtimeReadout = document.getElementById("statRuntime");
  const centerReadout = document.getElementById("statCenter");
  const stageInput = document.getElementById("stageInput");
  signals.subscribe((state) => {
    if (runtimeReadout) runtimeReadout.textContent = `${state.effectLoopMs.toFixed(1)}ms`;
    if (centerReadout) centerReadout.textContent = `${state.motionX.toFixed(2)}×${state.motionY.toFixed(2)}`;
    if (stageInput) stageInput.textContent = state.source.toUpperCase();
  });

  window.TDRuntime = {
    version: VERSION,
    signals,
    scheduler,
    effects: effectManifest,
    nativeRequestAnimationFrame: nativeRaf,
  };

  document.documentElement.dataset.runtime = VERSION;
})();
