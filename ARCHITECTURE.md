# TD Effect Architecture

## Goal

Move the project from a visual sketchbook to a realtime creative-coding runtime where camera analysis, effects, rendering, and UI are separate systems.

## v0.2: runtime bridge

The current repository has two rendering worlds:

1. `effects.js`: twelve Canvas2D studies in one legacy animation loop.
2. `three-stage.js`: a Three.js spatial particle field.

`runtime-host.js` is now the bridge between them.

### Signal Bus

The runtime publishes shared source/style/intensity/luminance/motion/centroid/runtime-cost/wireframe/burst state through `window.TDRuntime.signals`.

### Preview Analysis

The runtime downsamples `sourcePreview` and computes average luminance, frame-to-frame motion energy, and motion centroid. This is real lightweight signal analysis, but it is not optical flow, pose estimation, person segmentation, or depth estimation.

### Visibility-aware Scheduler

The legacy Canvas2D loop and Three.js loop are throttled according to viewport visibility and browser tab visibility. This reduces unnecessary work without rewriting every study at once.

## Honest capability boundary

Use these names for the current effects:

- `Motion-gradient particles`, not dense optical flow.
- `Luma pseudo-depth points`, not depth sensing.
- `Procedural wireframe`, not body tracking.

The Three.js particle field now reacts to real motion energy and motion centroid from the current input, but it is still an abstract procedural body field. It does not follow actual joints.

## Target v0.3 architecture

```text
Camera / Video / File
        ↓
    Source Engine
        ↓
   Analysis Engine
 ├─ Luminance
 ├─ Motion
 ├─ Edges
 ├─ Optical Flow
 ├─ Person Mask
 ├─ Pose
 └─ Depth
        ↓
      Signal Bus
        ↓
    Effect Registry
 ├─ feedback
 ├─ displacement
 ├─ slit-scan
 ├─ flow-field
 ├─ particle-body
 ├─ pixel-sort
 └─ reaction-diffusion
        ↓
     Compositor
        ↓
 Canvas2D / WebGL / WebGPU
```

Each effect should eventually conform to a small contract:

```js
{
  id,
  inputs,
  parameters,
  init(context),
  update(signal, dt),
  render(target),
  resize(width, height),
  dispose()
}
```

## Recommended next migration

Split the heaviest effects first because they benefit most from independent scheduling and GPU migration:

1. Reaction-diffusion
2. Pixel sorting
3. Luminance displacement
4. Motion-gradient particles
5. Point cloud

After that, add real CV signals behind the same Signal Bus interface. A pose/person-segmentation library can then be integrated without forcing the effect layer to know which CV implementation produced the data.
