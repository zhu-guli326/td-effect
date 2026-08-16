export class RuntimeScheduler {
  constructor(bus) {
    this.bus = bus;
    this.tasks = new Map();
    this.running = false;
    this.raf = 0;
    this.lastTick = performance.now();
    this.visibility = new Map();
    this.observer = 'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) {
            const id = entry.target.dataset.runtimeTaskId;
            if (id) this.visibility.set(id, entry.isIntersecting && entry.intersectionRatio > 0.02);
          }
        }, { threshold: [0, 0.02, 0.15] })
      : null;
  }

  register({ id, fps = 30, callback, element = null, offscreenFps = 0, hiddenFps = 2 }) {
    if (!id || typeof callback !== 'function') throw new Error('Scheduler task requires id and callback');
    const task = { id, fps, callback, offscreenFps, hiddenFps, last: 0, avgCost: 0, enabled: true };
    this.tasks.set(id, task);
    if (element && this.observer) {
      element.dataset.runtimeTaskId = id;
      this.visibility.set(id, true);
      this.observer.observe(element);
    }
    return () => this.unregister(id, element);
  }

  unregister(id, element = null) {
    this.tasks.delete(id);
    this.visibility.delete(id);
    if (element && this.observer) this.observer.unobserve(element);
  }

  setEnabled(id, enabled) {
    const task = this.tasks.get(id);
    if (task) task.enabled = Boolean(enabled);
  }

  setFps(id, fps) {
    const task = this.tasks.get(id);
    if (task) task.fps = Math.max(1, fps);
  }

  _targetFps(task) {
    if (document.hidden) return task.hiddenFps;
    if (this.visibility.has(task.id) && !this.visibility.get(task.id)) return task.offscreenFps;
    return task.fps;
  }

  _loop = (time) => {
    if (!this.running) return;
    const masterDt = Math.min(0.1, (time - this.lastTick) / 1000 || 0.016);
    this.lastTick = time;
    for (const task of this.tasks.values()) {
      if (!task.enabled) continue;
      const targetFps = this._targetFps(task);
      if (targetFps <= 0) continue;
      const interval = 1000 / targetFps;
      if (time - task.last < interval) continue;
      const dt = Math.min(0.1, (time - task.last) / 1000 || masterDt);
      task.last = time;
      const started = performance.now();
      try { task.callback(time, dt); } catch (error) { console.error(`[runtime:${task.id}]`, error); }
      const cost = performance.now() - started;
      task.avgCost = task.avgCost * 0.9 + cost * 0.1;
    }
    this.raf = requestAnimationFrame(this._loop);
  };

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTick = performance.now();
    this.raf = requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  stats() {
    const result = {};
    for (const [id, task] of this.tasks) result[id] = { fps: task.fps, costMs: task.avgCost };
    return result;
  }
}
