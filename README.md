# TD Effect Runtime

A browser-based realtime visual playground inspired by TouchDesigner and Processing. v0.2 keeps the existing Canvas2D studies, but introduces a runtime layer so the project can grow into a real signal-driven effect engine instead of a collection of unrelated filters.

## What changed in v0.2

- Added a global `TDRuntime` with a realtime Signal Bus.
- Added low-resolution source analysis for luminance, motion energy, and motion centroid.
- Connected the Three.js particle stage to the actual camera/synthetic motion signal.
- Added a visibility-aware scheduler: the legacy effect loop is throttled when the effect grid is off-screen, and the Three.js stage is throttled when its stage is off-screen.
- Replaced the local `node_modules` Three.js import with a browser CDN import so static hosting can render the spatial stage.
- Renamed misleading studies: the current particle flow is motion-gradient driven, not dense optical flow; the point cloud uses luminance pseudo-depth; the wireframe is procedural, not pose tracking.
- Added an effect manifest that documents inputs, statefulness, and rendering engine for each existing study.

## Included studies

- Feedback loop and luminance displacement
- Slit-scan and frame-memory effects
- Luminance pseudo-depth points
- Motion-gradient particles
- Delaunay triangulation and pixel sorting
- Gray-Scott reaction-diffusion
- High-density beads / perler beads
- Motion-centered rings and ASCII reconstruction
- Signal-reactive Three.js particle field

## Run locally

```bash
npm run dev
```

Open `http://127.0.0.1:4175/`.

The Three.js module is loaded from jsDelivr in the browser. Camera access requires localhost or HTTPS and explicit user permission.

## Runtime architecture

```text
Camera / Synthetic Source
          ↓
   Preview Analysis
  luma / motion / centroid
          ↓
      Signal Bus
       ↙      ↘
Legacy Canvas  Three.js Stage
 Effect Loop   motion-reactive
       ↓
  12 studies
```

This is an intermediate architecture. The 12 Canvas2D effects still live in `effects.js` and still share one legacy render loop. The runtime now controls when that loop runs and exposes shared signals, but the next migration is to move each effect into an independent module with explicit `inputs`, `state`, `update`, `render`, and `dispose` methods.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the migration target.
