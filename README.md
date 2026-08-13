# TD / Processing Effects Prototype

An interactive browser study blending TouchDesigner and Processing-inspired image effects with a Three.js spatial particle stage.

## Included studies

- Feedback loop and luminance displacement
- Slit-scan, point cloud, optical-flow particles, triangulation, pixel sort, and reaction-diffusion
- High-density beads, perler beads, concentric motion rings, and ASCII reconstruction
- Three.js particle figure, wireframe beams, and chroma burst states

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4175/`.

Use the camera button to switch from the synthetic source to a live camera feed. The effects respond to source luminance and motion.
