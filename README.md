# TD Effect Visual Engine

A browser-based realtime visual engine inspired by TouchDesigner and Processing.

v0.3 changes the project from a monolithic Canvas2D sketchbook into a signal-driven runtime focused on **real visual behavior** rather than UI polish.

## v0.3 visual stack

```text
Camera / Synthetic Source
        ↓
Source Engine
        ↓
Unified Analysis Engine
 ├─ luminance
 ├─ Sobel edges
 ├─ frame motion
 ├─ motion centroid
 └─ Lucas–Kanade optical flow
        ↓
Real CV Engine (optional network dependency)
 ├─ MediaPipe Pose Landmarker
 ├─ pose landmarks
 └─ person segmentation mask
        ↓
Signal Bus
   ↙          ↘
Effect Registry   GPU Effect Composer
   ↓                 ↓
12 independent FX   flow warp → feedback → mask glow → chromatic
   ↓                 ↓
Canvas2D/WebGL2   main stage
```

## What is now real

- Optical flow uses a coarse Lucas–Kanade solver over the actual frame sequence.
- Pose landmarks come from MediaPipe when the model is available.
- Person masks come from Pose Landmarker segmentation, with a landmark-based body mask fallback.
- The pose particle overlay is generated from detected joints and the person mask instead of a hard-coded skeleton.
- Reaction-diffusion runs as a WebGL2 Gray–Scott simulation.
- Feedback and flow displacement run as GPU shader passes.

## Runtime architecture

The old global `requestAnimationFrame` monkey patch is gone. A single explicit scheduler owns source, analysis, CV, composer, and per-effect cadence. Each effect has its own FPS and offscreen policy.

The old monolithic `effects.js`, transitional `runtime-host.js`, and procedural `three-stage.js` are no longer part of the runtime.

## Composer

The default GPU chain is:

```text
flowWarp → feedback → maskGlow → chromatic
```

Change it at runtime:

```js
TDEngine.setChain(['flowWarp', 'feedback', 'chromatic']);
```

## Presets and recording foundation

The UI is intentionally minimal for v0.3, but the underlying playground APIs are already available:

```js
TDEngine.savePreset('my-look');
TDEngine.loadPreset('my-look');

TDEngine.startRecording();
const blob = await TDEngine.stopRecording();
```

## Run locally

```bash
npm run dev
```

Open `http://127.0.0.1:4175/`.

Camera access requires localhost or HTTPS. MediaPipe pose/mask loading requires network access to its browser runtime and model assets. Lucas–Kanade optical flow, GPU feedback/displacement/reaction-diffusion, slit-scan, pixel sort, rings, ASCII, and the synthetic source do not depend on MediaPipe.
