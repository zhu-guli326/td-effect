import * as THREE from "./node_modules/three/build/three.module.js";

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
  chrome: { base: 0x9bd8ff, hot: 0xf2fbff, dark: 0x163a57 },
  lacquer: { base: 0xff174f, hot: 0xffd5c7, dark: 0x4e0619 },
  prism: { base: 0xaa73ff, hot: 0x5ee7ff, dark: 0x281044 },
  mineral: { base: 0x35e2c0, hot: 0xd4fff0, dark: 0x07545c },
};

let styleName = document.documentElement.dataset.style || "prism";
let wireframeMode = document.body.classList.contains("is-wireframe") || new URLSearchParams(window.location.search).has("wire");
let burstEnergy = new URLSearchParams(window.location.search).has("burst") ? 1 : 0;
let burstStarted = -Infinity;
let lastFrame = 0;

const bonePairs = [
  [0, 1], [1, 2], [2, 3], [1, 4], [4, 5], [5, 6],
  [1, 7], [7, 8], [8, 9], [1, 10], [10, 11], [11, 12],
  [7, 10], [7, 13], [10, 14], [13, 15], [15, 16], [14, 17], [17, 18],
];

function figurePoint(index, time) {
  const sway = Math.sin(time * 1.5) * 0.14;
  const reach = Math.cos(time * 1.18) * 0.22;
  const points = [
    [0, 1.1, 0], [0, 0.78, 0], [-0.34, 0.68, 0], [-0.7, 0.42 + reach, 0.05],
    [0.34, 0.68, 0], [0.72, 0.44 - reach, 0.08], [1.02, 0.2 - reach * 0.7, 0.02],
    [-0.25, 0.18, 0], [-0.32, -0.34 - sway, 0.03], [-0.48, -0.78, 0.02],
    [0.25, 0.18, 0], [0.35, -0.31 + sway, 0.03], [0.58, -0.76, 0.01],
    [-0.1, 0.02, 0], [-0.1, -0.02, 0], [-0.34, -0.95, 0.04], [-0.56, -1.12, 0.1],
    [0.38, -0.95, 0.03], [0.68, -1.08, 0.11],
  ];
  return new THREE.Vector3(...points[index]);
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

function buildParticles() {
  for (let i = 0; i < figureCount; i += 1) {
    const pair = bonePairs[i % bonePairs.length];
    const a = figurePoint(pair[0], 0);
    const b = figurePoint(pair[1], 0);
    const point = a.lerp(b, (i % 97) / 96);
    point.x += (Math.random() - 0.5) * 0.045;
    point.y += (Math.random() - 0.5) * 0.045;
    point.z += (Math.random() - 0.5) * 0.12;
    const color = new THREE.Color().setHSL(0.52 + (i % 13) * 0.006, 0.74, 0.52 + (i % 5) * 0.06);
    setParticle(i, point, color, i / figureCount);
  }
  for (let i = figureCount; i < totalCount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.pow(Math.random(), 0.52) * 2.55;
    const point = new THREE.Vector3(
      Math.cos(angle) * radius,
      (Math.random() - 0.5) * 2.25 + Math.sin(angle * 3) * 0.2,
      Math.sin(angle) * radius * 0.62,
    );
    const color = new THREE.Color().setHSL(0.55 + Math.random() * 0.26, 0.76, 0.38 + Math.random() * 0.34);
    setParticle(i, point, color, Math.random());
  }
}

buildParticles();
const basePositions = positions.slice();
const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
const particleMaterial = new THREE.PointsMaterial({ size: 0.026, vertexColors: true, transparent: true, opacity: 0.82, depthWrite: false, blending: THREE.AdditiveBlending });
const particles = new THREE.Points(particleGeometry, particleMaterial);
world.add(particles);

const orbitLines = [];
for (let lineIndex = 0; lineIndex < 8; lineIndex += 1) {
  const linePositions = new Float32Array(190 * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
  const material = new THREE.LineBasicMaterial({ color: 0x65e7ff, transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending });
  const line = new THREE.Line(geometry, material);
  line.userData.index = lineIndex;
  orbitLines.push(line);
  world.add(line);
}

const skeletonPositions = new Float32Array(bonePairs.length * 6);
const skeletonGeometry = new THREE.BufferGeometry();
skeletonGeometry.setAttribute("position", new THREE.BufferAttribute(skeletonPositions, 3));
const skeletonMaterial = new THREE.LineBasicMaterial({ color: 0xd9ffff, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending });
const skeleton = new THREE.LineSegments(skeletonGeometry, skeletonMaterial);
world.add(skeleton);

function resize() {
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / Math.max(1, rect.height);
  camera.updateProjectionMatrix();
}

function currentColors() {
  return palette[styleName] || palette.prism;
}

function updatePalette() {
  const colorsNow = currentColors();
  particleMaterial.color.set(colorsNow.hot);
  skeletonMaterial.color.set(colorsNow.hot);
  orbitLines.forEach((line, index) => line.material.color.set(index % 2 ? colorsNow.base : colorsNow.hot));
  renderer.setClearColor(0x020306, 1);
}

function animate(timeMs) {
  const time = timeMs * 0.001;
  const delta = Math.min(0.05, (timeMs - lastFrame) * 0.001 || 0.016);
  lastFrame = timeMs;
  const colorsNow = currentColors();
  const figurePulse = wireframeMode ? 1.2 : 0.72;
  const explode = burstEnergy * 0.42;

  for (let i = 0; i < totalCount; i += 1) {
    const seed = seeds[i * 4];
    const phase = seeds[i * 4 + 1];
    const radius = seeds[i * 4 + 2];
    const baseX = basePositions[i * 3];
    const baseY = basePositions[i * 3 + 1];
    const baseZ = basePositions[i * 3 + 2];
    const isFigure = i < figureCount;
    const pulse = Math.sin(time * (1.1 + radius) + phase) * (isFigure ? 0.01 : 0.04);
    const radial = isFigure ? 1 : 1 + explode * (0.4 + radius);
    positions[i * 3] = baseX * radial + Math.sin(time * 0.8 + phase) * pulse;
    positions[i * 3 + 1] = baseY * radial + Math.cos(time * 0.9 + phase) * pulse;
    positions[i * 3 + 2] = baseZ * radial + Math.sin(time * 0.65 + seed * 8) * (0.05 + explode * 0.3);
    const color = new THREE.Color().setHSL((0.52 + seed * 0.36 + time * 0.025 + (isFigure ? 0 : radius * 0.08)) % 1, 0.82, isFigure ? 0.66 : 0.42 + radius * 0.28);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  particleGeometry.attributes.position.needsUpdate = true;
  particleGeometry.attributes.color.needsUpdate = true;

  for (let lineIndex = 0; lineIndex < orbitLines.length; lineIndex += 1) {
    const line = orbitLines[lineIndex];
    const array = line.geometry.attributes.position.array;
    const offset = lineIndex * 0.41;
    for (let i = 0; i < 190; i += 1) {
      const t = i / 189;
      const angle = t * Math.PI * 2.3 + time * (0.24 + lineIndex * 0.012) + offset;
      const radius = 1.05 + Math.sin(t * 9 + time * 1.4 + offset) * 0.22 + lineIndex * 0.08;
      array[i * 3] = Math.cos(angle) * radius;
      array[i * 3 + 1] = Math.sin(t * 7 + time * 1.05 + offset) * 0.85 + (t - 0.5) * 0.8;
      array[i * 3 + 2] = Math.sin(angle) * radius * 0.62;
    }
    line.geometry.attributes.position.needsUpdate = true;
    line.material.opacity = 0.16 + (wireframeMode ? 0.18 : 0) + burstEnergy * 0.24;
  }

  for (let i = 0; i < bonePairs.length; i += 1) {
    const a = figurePoint(bonePairs[i][0], time);
    const b = figurePoint(bonePairs[i][1], time);
    skeletonPositions[i * 6] = a.x;
    skeletonPositions[i * 6 + 1] = a.y;
    skeletonPositions[i * 6 + 2] = a.z;
    skeletonPositions[i * 6 + 3] = b.x;
    skeletonPositions[i * 6 + 4] = b.y;
    skeletonPositions[i * 6 + 5] = b.z;
  }
  skeletonGeometry.attributes.position.needsUpdate = true;
  skeletonMaterial.opacity = 0.12 + (wireframeMode ? 0.64 : 0.16) + burstEnergy * 0.26;
  particleMaterial.size = 0.018 + figurePulse * 0.006 + burstEnergy * 0.022;
  world.rotation.y = Math.sin(time * 0.38) * 0.33;
  world.rotation.x = Math.cos(time * 0.31) * 0.08;
  world.position.y = Math.sin(time * 0.68) * 0.08;

  if (styleName !== document.documentElement.dataset.style) {
    styleName = document.documentElement.dataset.style || "prism";
    updatePalette();
  }
  if (burstEnergy > 0) {
    burstEnergy = Math.max(0, burstEnergy - delta * 0.62);
  }

  stateEl.textContent = wireframeMode
    ? "THREE DIMENSIONAL PARTICLE BODY / WIRE ACTIVE"
    : burstEnergy > 0.01
      ? "THREE DIMENSIONAL PARTICLE BODY / CHROMA BURST"
      : "THREE DIMENSIONAL PARTICLE BODY / LIVE";
  depthEl.textContent = (4.8 + Math.sin(time * 0.7) * 0.42 + burstEnergy * 0.8).toFixed(2);
  nodesEl.textContent = String(totalCount + (burstEnergy > 0.01 ? 480 : 0));
  phaseEl.textContent = String(Math.floor((time * 18) % 1000)).padStart(3, "0");
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

window.addEventListener("resize", resize);
document.addEventListener("style-change", (event) => {
  styleName = event.detail?.style || styleName;
  updatePalette();
});
document.addEventListener("wireframe-change", (event) => {
  wireframeMode = Boolean(event.detail?.active);
});
document.addEventListener("chroma-burst", () => {
  burstEnergy = 1;
  burstStarted = performance.now();
});

updatePalette();
resize();
requestAnimationFrame(animate);
