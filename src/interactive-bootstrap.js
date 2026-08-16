import './hand-bootstrap.js';
import { bodyEchoFactory } from './effects/interactive-effects.js';
import {
  handFlowSkinFactory,
  magneticHandFactory,
  gestureHandFieldFactory,
} from './effects/hand-mask-effects.js';

const HERO_EFFECTS = [
  { id: 'feedback', factory: bodyEchoFactory, fps: 45, offscreenFps: 5, label: 'BODY ECHO' },
  { id: 'displacement', factory: handFlowSkinFactory, fps: 45, offscreenFps: 5, label: 'HAND FLOW SKIN' },
  { id: 'pointcloud', factory: magneticHandFactory, fps: 50, offscreenFps: 6, label: 'MAGNETIC HAND BODY' },
  { id: 'rings', factory: gestureHandFieldFactory, fps: 50, offscreenFps: 6, label: 'GESTURE HAND FIELD' },
];

function waitForEngine() {
  return new Promise((resolve) => {
    const check = () => {
      if (window.TDEngine?.scheduler && window.TDEngine?.analysis && window.TDEngine?.hand) resolve(window.TDEngine);
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
    hand: engine.hand,
  };
}

function updateReadout(id, signal) {
  const target = document.getElementById(`readout-${id}`);
  if (!target) return;
  const flow = Math.hypot(signal.flowX || 0, signal.flowY || 0);
  if (id === 'feedback') target.textContent = `ECHO ${(signal.motion || 0).toFixed(2)}`;
  if (id === 'displacement') target.textContent = signal.handReady ? `${signal.handGesture || 'HAND'} ${(signal.handSpeed || 0).toFixed(2)}` : `FLOW ${flow.toFixed(2)}`;
  if (id === 'pointcloud') target.textContent = signal.handReady ? `HAND ×${signal.handCount || 0}` : signal.maskReady ? 'BODY RETURN' : `FLOW ${flow.toFixed(2)}`;
  if (id === 'rings') {
    const gesture = signal.handGesture || 'None';
    const pinch = signal.handPinch || 0;
    target.textContent = signal.handReady ? `${gesture} P${pinch.toFixed(2)}` : `FORCE ${flow.toFixed(2)}`;
  }
  const state = document.getElementById('stageState');
  if (state && signal.source === 'camera') {
    state.textContent = signal.handReady
      ? `HAND ${signal.handGesture || 'None'} / MASK + FLOW ACTIVE`
      : signal.handStatus === 'loading'
        ? 'LOADING MEDIAPIPE HAND GESTURE MODEL…'
        : 'POSE + FLOW ACTIVE / WAITING FOR HAND';
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
        handMask: engine.hand.maskCanvas,
        handField: engine.hand.fieldCanvas,
        leftHandMask: engine.hand.leftMaskCanvas,
        rightHandMask: engine.hand.rightMaskCanvas,
        hands: engine.hand.hands,
      });
      updateReadout(definition.id, signal);
    },
  });
  disposers.push(() => {
    disposeTask?.();
    effect.dispose?.();
  });
}

engine.version = '0.3.2';
engine.interactions = {
  effects,
  ids: HERO_EFFECTS.map((effect) => effect.id),
  dispose() {
    for (const dispose of disposers.splice(0)) dispose();
  },
};
engine.bus.publish({ interactionMode: 'hand-mask-reactive', interactionEffects: HERO_EFFECTS.map((effect) => effect.label) });

window.addEventListener('beforeunload', () => engine.interactions?.dispose(), { once: true });
