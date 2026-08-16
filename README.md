# TD Effect Visual Engine

A browser-based realtime visual engine inspired by TouchDesigner and Processing.

v0.3.2 pushes the project toward **local hand-mask visual interaction**: the camera is not just an input texture; optical flow, pose, hand gestures, hand velocity, pinch, openness, and local masks now directly change where and how effects happen.

## v0.3.2 visual stack

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
MediaPipe CV
 ├─ Pose Landmarker → pose + person mask
 └─ Gesture Recognizer → 21 hand landmarks + gestures
        ↓
Hand Mask Engine
 ├─ left / right local masks
 ├─ feathered influence field
 ├─ center + velocity
 ├─ openness
 ├─ pinch
 └─ gesture state
        ↓
Signal Bus
   ↙               ↘
Effect Registry      GPU Effect Composer
   ↓                    ↓
Hand/body reactive FX   flow warp → feedback → mask glow → chromatic
```

## Hand-mask interaction

The hand layer analyzes the same mirrored source canvas used by the effects, so landmarks, masks, and rendered output share one coordinate space.

MediaPipe Gesture Recognizer provides hand landmarks and gesture categories. The engine converts the 21 landmarks into visual masks by combining a palm hull, thick rounded finger paths, fingertip discs, and a feathered expanded influence field.

Runtime signals include:

```text
hands[]
handLeft / handRight
handCenterX / handCenterY
handVelocityX / handVelocityY
handSpeed
handOpenness
handPinch
handGesture
handMaskReady
```

## Hero realtime interactions

### Body Echo

The person mask is captured into a short temporal buffer. Motion energy controls how strongly previous body states are stretched, scaled, and advected by optical flow.

### Hand Flow Skin

Lucas–Kanade displacement is now revealed only inside the local hand influence mask. The hand determines **where** the distortion exists and optical flow determines **how** it moves.

### Magnetic Hand Body

Particles sample their home positions from the detected hand mask. Hand motion and optical flow throw them away; spring forces rebuild the hand when movement stops. Pinch increases return force while open/fast gestures increase scattering.

### Gesture Hand Field

The MediaPipe gesture state drives the force field. `Closed_Fist`, `Open_Palm`, `Victory`, pinch amount, hand openness, and hand velocity alter attraction, blast, swirl, particle energy, and local hand glow. Before hand recognition is ready, optical-flow motion provides a fallback field.

## What is now real

- Optical flow uses a coarse Lucas–Kanade solver over the actual frame sequence.
- Pose landmarks come from MediaPipe when the model is available.
- Person masks come from Pose Landmarker segmentation, with a landmark-based fallback mask.
- Hand gestures and 21-point hand landmarks come from MediaPipe Gesture Recognizer.
- Local left/right hand masks are derived from detected landmarks and used as effect regions.
- Pose and hand CV analyze the mirrored source space used by the effects, keeping overlays aligned with the visible camera image.
- Reaction-diffusion runs as a WebGL2 Gray–Scott simulation.
- The main stage still uses the GPU composer for flow warp, feedback, mask glow, and chromatic passes.

## Runtime architecture

The global `requestAnimationFrame` monkey patch is gone. A single explicit scheduler owns source, analysis, pose CV, hand CV, composer, and per-effect cadence. Each effect has its own FPS and offscreen policy.

Hand tracking is isolated in `src/runtime/hand-engine.js` and `src/hand-bootstrap.js`. Hand-specific effects live in `src/effects/hand-mask-effects.js`; the interaction bootstrap swaps them into the existing preview slots without growing `src/app.js` into another monolith.

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

Camera access requires localhost or HTTPS. MediaPipe pose/gesture model loading requires network access to its browser runtime and model assets. Lucas–Kanade optical flow and the synthetic-source fallbacks do not depend on MediaPipe.
