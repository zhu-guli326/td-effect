import {
  bodyEchoFactory,
  flowSkinFactory,
  magneticBodyFactory,
  handSingularityFactory,
} from './effects/interactive-effects.js';

const HERO_EFFECTS = [
  { id: 'feedback', factory: bodyEchoFactory, fps: 45, offscreenFps: 5, label: 'BODY ECHO' },
  { id: 'displacement', factory: flowSkinFactory, fps: 45, offscreenFps: 5, label: 'FLOW SKIN' },
  { id: 'pointcloud', factory: magneticBodyFactory, fps: 50, offscreenFps: 6, label: 'MAGNETIC BODY' },
  { id: 'rings', factory: handSingularityFactory, fps: 50, offscreenFps: 6, label: 'HAND FIELD' },
];

function waitForEngine() {
  return new Promise((resolve) => {
    const check = () => {
      if (window.TDEngine?.scheduler && window.TDEngine?.analysis) resolve(window.TDEngine);
      else requestAnimationFrame(check);
    };
    check();
  });
}

function makeContext(engine, id) {
  return {
    id,
    canvas: document.getElementById(id),
    bus: engine.bus,
    source: engine.source,
    analysis: engine.analysis,
    cv: engine.cv,
  };
}

function handDistance(signal) {
  const pose = signal.poseLandmarks?.[0];
  const left = pose?.[15];
  const right = pose?.[16];
  if (!left || !right) return null;
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function updateReadout(id, signal) {
  const target = document.getElementById(`readout-${id}`);
  if (!target) return;
  const flow = Math.hypot(signal.flowX || 0, signal.flowY || 0);
  if (id === 'feedback') target.textContent = `ECHO ${(signal.motion || 0).toFixed(2)}`;
  if (id === 'displacement') target.textContent = `FLOW ${flow.toFixed(2)}`;
  if (id === 'pointcloud') target.textContent = signal.maskReady ? `RETURN ${(1 - Math.min(1, signal.motion || 0)).toFixed(2)}` : `FLOW ${flow.toFixed(2)}`;
  if (id === 'rings') {
    const distance = handDistance(signal);
    target.textContent = distance === null ? `FORCE ${flow.toFixed(2)}` : `HANDS ${distance.toFixed(2)}`;
  }
}

const engine = await waitForEngine();
const disposers = [];
const effects = new Map();

for (const definition of HERO_EFFECTS) {
  engine.registry.setEnabled(definition.id, false);
  const context = makeContext(engine, definition.id);
  if (!context.canvas) continue;
  const effect = definition.factory(context);
  effect.init?.(context);
  effects.set(definition.id, effect);
  const disposeTask = engine.scheduler.register({
    id: `hero:${definition.id}`,
    fps: definition.fps,
    offscreenFps: definition.offscreenFps,
    element: context.canvas.closest('.effect-card') || context.canvas,
    callback: (time, dt) => {
      const signal = engine.bus.snapshot();
      effect.update?.(signal, dt, time);
      effect.render?.({
        time,
        dt,
        signal,
        source: engine.source.canvas,
        flow: engine.analysis.flowCanvas,
        edges: engine.analysis.edgeCanvas,
        mask: engine.cv.maskCanvas,
        landmarks: engine.cv.poseLandmarks,
      });
      updateReadout(definition.id, signal);
    },
  });
  disposers.push(() => {
    disposeTask?.();
    effect.dispose?.();
  });
}

engine.version = '0.3.1';
engine.interactions = {
  effects,
  ids: HERO_EFFECTS.map((effect) => effect.id),
  dispose() {
    for (const dispose of disposers.splice(0)) dispose();
  },
};
engine.bus.publish({ interactionMode: 'body-reactive', interactionEffects: HERO_EFFECTS.map((effect) => effect.label) });

window.addEventListener('beforeunload', () => engine.interactions?.dispose(), { once: true });
