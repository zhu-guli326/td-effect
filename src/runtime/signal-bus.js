export class SignalBus {
  constructor(initial = {}) {
    this.state = {
      version: '0.3.0',
      source: 'synthetic',
      style: 'prism',
      intensity: 1,
      frame: 0,
      fps: 60,
      luma: 0,
      motion: 0,
      motionX: 0.5,
      motionY: 0.5,
      flowX: 0,
      flowY: 0,
      poseCount: 0,
      poseReady: false,
      maskReady: false,
      cvStatus: 'idle',
      ...initial,
    };
    this.listeners = new Set();
  }

  publish(patch = {}) {
    Object.assign(this.state, patch, { timestamp: performance.now() });
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  snapshot() {
    return { ...this.state };
  }

  subscribe(listener, immediate = true) {
    this.listeners.add(listener);
    if (immediate) listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }
}
