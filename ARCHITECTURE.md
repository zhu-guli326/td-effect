# TD Effect Visual Engine Architecture

## Design rule

v0.3 optimizes for **visual algorithms, signal fidelity, and realtime behavior first**. UI is a client of the engine; UI does not own camera state, CV state, analysis, scheduling, or effect lifecycle.

## Runtime v0.3

```text
SourceEngine
    ↓
AnalysisEngine ───────────────┐
    ↓                         │
CVEngine (camera / optional)  │
    ↓                         │
SignalBus  ←──────────────────┘
  ↙   ↓   ↘
FX  Composer  Pose field
```

### RuntimeScheduler

`RuntimeScheduler` owns one explicit master `requestAnimationFrame` loop. Systems and effects register named tasks with their own foreground, offscreen, and hidden-tab FPS policies.

There is no global RAF monkey patch and no callback-name inference.

### SourceEngine

`SourceEngine` owns input state directly.

Current sources:

- synthetic realtime source
- live camera source

The engine exposes the current frame through one shared canvas, so downstream analysis and effects never infer source state from UI text.

### Unified AnalysisEngine

Analysis is computed once and shared by all effects:

- luminance
- temporal motion energy
- motion centroid
- Sobel edge field
- coarse Lucas–Kanade optical-flow field
- average flow vector

The optical-flow grid is also encoded as an RG texture for GPU effects.

### CVEngine

When camera mode is active, `CVEngine` can load MediaPipe Pose Landmarker and publish:

- pose landmarks
- world landmarks
- pose count
- person segmentation mask

If a segmentation mask is unavailable but landmarks exist, the engine generates a conservative landmark/body-line mask. If MediaPipe cannot load, non-pose effects continue running.

## Effect Registry

Effects are independent runtime units registered with metadata and cadence instead of living inside one monolithic render loop.

Conceptual contract:

```js
{
  id,
  engine,
  inputs,
  fps,
  stateful,
  factory(context)
}

// effect instance
{
  init(context),
  update(signal, dt, time),
  render(frameContext),
  dispose()
}
```

Current modules live under `src/effects/` and are scheduled independently.

## GPU Pipeline

`src/gpu/shader-pass.js` provides a WebGL2 fullscreen-pass pipeline with ping-pong render targets and history feedback.

Current shader passes:

- `flowWarp` — Lucas–Kanade flow texture drives source displacement
- `feedback` — history texture + motion + mask driven trails
- `maskGlow` — person-mask edge energy
- `chromatic` — motion-centered RGB separation

Reaction-diffusion uses a separate WebGL2 Gray–Scott ping-pong simulation so it can iterate multiple simulation steps per visual frame.

## Real pose particle field

The main overlay no longer uses a hard-coded procedural skeleton. `src/effects/pose-particles.js` emits GPU particles along detected pose connections and inside the person mask. It supports multiple detected poses and falls back to a motion-reactive abstract field when pose data is unavailable.

## Effect Composer

The main stage is a chain rather than one hard-coded effect:

```text
source
  ↓
flowWarp
  ↓
feedback
  ↓
maskGlow
  ↓
chromatic
  ↓
main output
```

The chain can be changed through `TDEngine.setChain(...)`. This is the basis for future node/DAG composition without coupling effect implementations to the UI.

## Playground foundation

The visual engine already exposes non-UI APIs for:

- changing the composer chain
- saving/loading presets with localStorage
- recording the composed canvas through `captureStream()` + `MediaRecorder`
- inspecting the effect manifest and runtime systems

A later UI can wrap these APIs without changing the visual runtime.

## Migration status

### Completed in v0.3

- explicit runtime scheduler
- source engine
- shared analysis engine
- real Lucas–Kanade flow
- MediaPipe pose/mask integration
- modular effect registry
- WebGL2 shader pipeline
- GPU feedback and optical-flow displacement
- GPU Gray–Scott reaction-diffusion
- pose/mask driven particle field
- configurable composer
- preset/recording API foundation

### Next visual work

The architecture is now ready for higher-quality effect research instead of more framework churn. Useful next investigations include multiscale optical flow, temporal denoising, signed-distance person fields, GPU particle advection, depth estimation, shader feedback networks, and richer composer routing.