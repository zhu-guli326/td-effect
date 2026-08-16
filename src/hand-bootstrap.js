import { HandEngine } from './runtime/hand-engine.js';

function waitForEngine() {
  return new Promise((resolve) => {
    const check = () => {
      if (window.TDEngine?.scheduler && window.TDEngine?.source && window.TDEngine?.bus) resolve(window.TDEngine);
      else requestAnimationFrame(check);
    };
    check();
  });
}

const engine = await waitForEngine();
const hand = new HandEngine({ bus: engine.bus, source: engine.source });
engine.hand = hand;

const disposeTask = engine.scheduler.register({
  id: 'hand',
  fps: 15,
  hiddenFps: 1,
  callback: (time) => hand.tick(time),
});

const cameraButton = document.getElementById('cameraButton');
const syntheticButton = document.getElementById('syntheticButton');
cameraButton?.addEventListener('click', () => hand.init());
syntheticButton?.addEventListener('click', () => hand.reset());

engine.bus.publish({ handStatus: 'idle', handReady: false, handMaskReady: false, handCount: 0, hands: [] });

window.addEventListener('beforeunload', () => {
  disposeTask?.();
  hand.dispose();
}, { once: true });
