# TD Effect Visual Engine

A browser-based realtime visual engine inspired by TouchDesigner and Processing.

v0.3.1 pushes the project toward **body-reactive visual interaction**: the camera is not just an input texture; motion, pose, person mask, hand distance, and optical flow now directly change the structure of the effects.

## v0.3.1 visual stack

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
Real CV Engine (camera mode)
 ├─ MediaPipe Pose Landmarker
 ├─ pose landmarks
 └─ person segmentation mask
        ↓
Signal Bus
   ↙               ↘
Effect Registry      GPU Effect Composer
   ↓                    ↓
Body-reactive FX        flow warp → feedback → mask glow → chromatic
```

## Hero realtime interactions

Four existing preview slots are now replaced at runtime by interaction-first effects:

### Body Echo

The person mask is captured into a short temporal buffer. Motion energy controls how strongly previous body states are stretched, scaled, and advected by optical flow. The goal is for the person to leave time behind while the background remains comparatively stable.

### Flow Skin

A local Lucas–Kanade vector field is sampled across the image. Moving body regions are reconstructed in small tiles and displaced along their measured flow direction, then constrained by the person mask when CV is available.

### Magnetic Body

Particles treat sampled points inside the person mask as home positions. Optical flow pushes them away while a spring force pulls them back. Fast movement breaks the body apart; becoming still lets the particle body reassemble.

### Hand Singularity

MediaPipe wrist landmarks define a live force field. Bringing both hands together increases attraction energy; rapidly opening the hands creates an outward blast. Before pose is ready, motion centroid and optical flow provide a usable fallback force field.

## What is now real

- Optical flow uses a coarse Lucas–Kanade solver over the actual frame sequence.
- Pose landmarks come from MediaPipe when the model is available.
- Person masks come from Pose Landmarker segmentation, with a landmark-based fallback mask.
- Body Echo uses real temporal frame history plus mask/flow signals.
- Flow Skin uses the measured local optical-flow grid rather than procedural noise.
- Magnetic Body combines person-mask home positions, optical-flow force, and spring return.
- Hand Singularity uses detected wrist positions and hand distance as interaction controls.
- Reaction-diffusion runs as a WebGL2 Gray–Scott simulation.
- The main stage still uses the GPU composer for flow warp, feedback, mask glow, and chromatic passes.

## Runtime architecture

The global `requestAnimationFrame` monkey patch is gone. A single explicit scheduler owns source, analysis, CV, composer, and per-effect cadence. Each effect has its own FPS and offscreen policy.

The interaction layer is intentionally isolated in `src/effects/interactive-effects.js` and `src/interactive-bootstrap.js`, so realtime experiments do not grow `src/app.js` into another monolith.

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

The UI is intentionally minimal, but the underlying APIs remain available:

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

Camera access requires localhost or HTTPS. MediaPipe pose/mask loading requires network access to its browser runtime and model assets. Lucas–Kanade optical flow and the synthetic-source interaction fallbacks do not depend on MediaPipe.
