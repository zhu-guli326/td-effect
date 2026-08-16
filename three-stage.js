import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js";

const canvas = document.getElementById("threeStage");
const stateEl = document.getElementById("stageState");
const depthEl = document.getElementById("stageDepth");
const nodesEl = document.getElementById("stageNodes");
const phaseEl = document.getElementById("stagePhase");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x020306, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0.15, 5.2);

const world = new THREE.Group();
scene.add(world);

const palette = {
  chrome: { base: 0x9bd8ff, hot: 0xf2fbff },
  lacquer: { base: 0xff174f, hot: 0xffd5c7 },
  prism: { base: 0xaa73ff, hot: 0x5ee7ff },
  mineral: { base: 0x35e2c0, hot: 0xd4fff0 },
};

let styleName = document.documentElement.dataset.style || "prism";
let wireframeMode = false;
let burstEnergy = 0;
let lastFrame = 0;
let signal = {
  source: "synthetic",
  motion: 0,
  motionX: 0.5,
  motionY: 0.5,
  luma: 0.5,
  intensity: 1,
};

if (window.TDRuntime?.signals) {
  window.TDRuntime.signals.subscribe((next) => {
    signal = { ...signal, ...next };
    styleName = next.style || styleName;
    wireframeMode = Boolean(next.wireframe);
    burstEnergy = Math.max(burstEnergy, next.burst || 0);
  });
}

const bodyPairs = [
  [0, 1], [1, 2], [2, 3], [1, 4], [4, 5], [5, 6],
  [1, 7], [7, 8], [8, 9], [1, 10], [10, 11], [11, 12],
  [7, 10], [7, 13], [10, 14], [13, 15], [14, 16],
];

function bodyPoint(index, time) {
  const motionKick = signal.motion * 0.65 * signal.intensity;
  const sway = Math.sin(time * 1.35) * (0.08 + motionKick * 0.24);
  const reach = Math.cos(time * 1.1) * (0.14 + motionKick * 0.42);
  const cx = (signal.motionX - 0.5) * 0.5;
  const cy = (0.5 - signal.motionY) * 0.34;
  const points = [
    [0, 1.08, 0], [0, 0.77, 0], [-0.34, 0.68, 0], [-0.7 - reach, 0.43 + sway, 0.06],
    [0.34, 0.68, 0], [0.72 + reach, 0.43 - sway, 0.08], [1.02 + reach * 0.6, 0.18 - sway, 0.02],
    [-0.25, 0.18, 0], [-0.32, -0.34 - sway, 0.03], [-0.48, -0.79, 0.02],
    [0.25, 0.18, 0], [0.35, -0.31 + sway, 0.03], [0.58, -0.77, 0.01],
    [-0.1, 0.02, 0], [0.1, -0.02, 0], [-0.56, -1.1, 0.1], [0.66, -1.08, 0.1],
  ];
  const point = points[index] || [0, 0, 0];
  return new THREE.Vector3(point[0] + cx, point[1] + cy, point[2]);
}

const figureCount = 2600;
const fieldCount = 5200;
const totalCount = figureCount + fieldCount;
const positions = new Float32Array(totalCount * 3);
const colors = new Float32Array(totalCount * 3);
const seeds = new Float32Array(totalCount * 4);

function setParticle(index, point, color, seed) {
  positions[index * 3] = point.x;
  positions[index * 3 + 1] = point.y;
  positions[index * 3 + 2] = point.z;
  colors[index * 3] = color.r;
  colors[index * 3 + 1] = color.g;
  colors[index * 3 + 2] = color.b;
  seeds[index * 4] = seed;
  seeds[index * 4 + 1] = Math.random() * Math.PI * 2;
  seeds[index * 4 + 2] = Math.random();
  seeds[index * 4 + 3] = Math.random();
}

for (let i = 0; i < figureCount; i += 1) {
  const pair = bodyPairs[i % bodyPairs.length];
  const a = bodyPoint(pair[0], 0);
  const b = bodyPoint(pair[1], 0);
  const point = a.lerp(b, (i % 97) / 96);
  point.x += (Math.random() - 0.5) * 0.045;
  point.y += (Math.random() - 0.5) * 0.045;
  point.z += (Math.random() - 0.5) * 0.12;
  setParticle(i, point, new THREE.Color().setHSL(0.53 + (i % 13) * 0.006, 0.74, 0.58), i / figureCount);
}

for (let i = figureCount; i < totalCount; i += 1) {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.pow(Math.random(), 0.52) * 2.55;
  const point = new THREE.Vector3(
    Math.cos(angle) * radius,
    (Math.random() - 0.5) * 2.25 + Math.sin(angle * 3) * 0.2,
    Math.sin(angle) * radius * 0.62,
  );
  setParticle(i, point, new THREE.Color().setHSL(0.56 + Math.random() * 0.26, 0.76, 0.42 + Math.random() * 0.28), Math.random());
}

const basePositions = positions.slice();
const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
const material = new THREE.PointsMaterial({
  size: 0.024,
  vertexColors: true,
  transparent: true,
  opacity: 0.84,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const particles = new THREE.Points(geometry, material);
world.add(particles);

const skeletonPositions = new Float32Array(bodyPairs.length * 6);
const skeletonGeometry = new THREE.BufferGeometry();
skeletonGeometry.setAttribute("position", new THREE.BufferAttribute(skeletonPositions, 3));
const skeletonMaterial = new THREE.LineBasicMaterial({ color: 0xd9ffff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending });
const skeleton = new THREE.LineSegments(skeletonGeometry, skeletonMaterial);
world.add(skeleton);

const orbitLines = [];
for (let lineIndex = 0; lineIndex < 8; lineIndex += 1) {
  const linePositions = new Float32Array(190 * 3);
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x65e7ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending });
  const line = new THREE.Line(lineGeometry, lineMaterial);
  line.userData.index = lineIndex;
  orbitLines.push(line);
  world.add(line);
}

function updatePalette() {
  const colorsNow = palette[styleName] || palette.prism;
  skeletonMaterial.color.set(colorsNow.hot);
  orbitLines.forEach((line, index) => line.material.color.set(index % 2 ? colorsNow.base : colorsNow.hot));
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / Math.max(1, rect.height);
  camera.updateProjectionMatrix();
}

function animate(timeMs) {
  const time = timeMs * 0.001;
  const delta = Math.min(0.05, (timeMs - lastFrame) * 0.001 || 0.016);
  lastFrame = timeMs;
  const motion = Math.min(1, signal.motion * (1.4 + signal.intensity * 0.7));
  const targetX = (signal.motionX - 0.5) * 0.58;
  const targetY = (0.5 - signal.motionY) * 0.42;
  const explode = Math.max(burstEnergy * 0.5, motion * 0.18);

  for (let i = 0; i < totalCount; i += 1) {
    const seed = seeds[i * 4];
    const phase = seeds[i * 4 + 1];
    const radius = seeds[i * 4 + 2];
    const baseX = basePositions[i * 3];
    const baseY = basePositions[i * 3 + 1];
    const baseZ = basePositions[i * 3 + 2];
    const isFigure = i < figureCount;
    const pulse = Math.sin(time * (1.1 + radius) + phase) * (isFigure ? 0.012 + motion * 0.028 : 0.035 + motion * 0.06);
    const radial = isFigure ? 1 + motion * 0.035 : 1 + explode * (0.35 + radius);
    positions[i * 3] = baseX * radial + pulse + (isFigure ? targetX * 0.42 : targetX * radius * 0.14);
    positions[i * 3 + 1] = baseY * radial + Math.cos(time * 0.9 + phase) * pulse + (isFigure ? targetY * 0.42 : targetY * radius * 0.14);
    positions[i * 3 + 2] = baseZ * radial + Math.sin(time * 0.65 + seed * 8) * (0.05 + explode * 0.32);
    const color = new THREE.Color().setHSL((0.52 + seed * 0.36 + time * 0.025 + motion * 0.08) % 1, 0.82, isFigure ? 0.62 + motion * 0.16 : 0.4 + radius * 0.28);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;

  for (let i = 0; i < bodyPairs.length; i += 1) {
    const a = bodyPoint(bodyPairs[i][0], time);
    const b = bodyPoint(bodyPairs[i][1], time);
    skeletonPositions[i * 6] = a.x;
    skeletonPositions[i * 6 + 1] = a.y;
    skeletonPositions[i * 6 + 2] = a.z;
    skeletonPositions[i * 6 + 3] = b.x;
    skeletonPositions[i * 6 + 4] = b.y;
    skeletonPositions[i * 6 + 5] = b.z;
  }
  skeletonGeometry.attributes.position.needsUpdate = true;
  skeletonMaterial.opacity = wireframeMode ? 0.74 : 0.08 + motion * 0.28;

  for (let lineIndex = 0; lineIndex < orbitLines.length; lineIndex += 1) {
    const line = orbitLines[lineIndex];
    const array = line.geometry.attributes.position.array;
    const offset = lineIndex * 0.41;
    for (let i = 0; i < 190; i += 1) {
      const t = i / 189;
      const angle = t * Math.PI * 2.3 + time * (0.22 + lineIndex * 0.012 + motion * 0.18) + offset;
      const radius = 1.05 + Math.sin(t * 9 + time * 1.4 + offset) * (0.2 + motion * 0.25) + lineIndex * 0.08;
      array[i * 3] = Math.cos(angle) * radius + targetX * 0.18;
      array[i * 3 + 1] = Math.sin(t * 7 + time * 1.05 + offset) * 0.85 + (t - 0.5) * 0.8 + targetY * 0.18;
      array[i * 3 + 2] = Math.sin(angle) * radius * 0.62;
    }
    line.geometry.attributes.position.needsUpdate = true;
    line.material.opacity = 0.13 + motion * 0.22 + burstEnergy * 0.26 + (wireframeMode ? 0.12 : 0);
  }

  material.size = 0.02 + motion * 0.016 + burstEnergy * 0.018;
  world.rotation.y += ((targetX * 0.8 + Math.sin(time * 0.28) * 0.18) - world.rotation.y) * 0.04;
  world.rotation.x += ((-targetY * 0.32 + Math.cos(time * 0.31) * 0.05) - world.rotation.x) * 0.04;
  world.position.x += (targetX * 0.22 - world.position.x) * 0.05;
  world.position.y += (targetY * 0.22 - world.position.y) * 0.05;

  if (burstEnergy > 0) burstEnergy = Math.max(0, burstEnergy - delta * 0.62);
  updatePalette();

  stateEl.textContent = wireframeMode
    ? "PROCEDURAL WIREFRAME / MOTION SIGNAL ACTIVE (NOT POSE TRACKING)"
    : signal.source === "camera"
      ? "CAMERA MOTION → PARTICLE FIELD / LIVE"
      : "SYNTHETIC SIGNAL → PARTICLE FIELD / LIVE";
  depthEl.textContent = (4.8 + motion * 1.3 + burstEnergy * 0.8).toFixed(2);
  nodesEl.textContent = String(totalCount);
  phaseEl.textContent = String(Math.floor((time * 18) % 1000)).padStart(3, "0");

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

window.addEventListener("resize", resize);
document.addEventListener("style-change", (event) => {
  styleName = event.detail?.style || styleName;
});
document.addEventListener("chroma-burst", () => {
  burstEnergy = 1;
});
document.addEventListener("wireframe-change", (event) => {
  wireframeMode = Boolean(event.detail?.active);
});

updatePalette();
resize();
requestAnimationFrame(animate);
