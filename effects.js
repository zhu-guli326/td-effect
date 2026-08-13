(() => {
  const W = 192;
  const H = 144;
  const MAX_FRAMES = 54;
  const TAU = Math.PI * 2;

  const ids = [
    "feedback",
    "displacement",
    "slitscan",
    "pointcloud",
    "flow",
    "triangulation",
    "pixelsort",
    "reaction",
    "hdbeads",
    "beads",
    "rings",
    "ascii",
  ];
  // Image-deconstruction studies keep their own visual language when the spatial wire overlay is active.
  const overlayIds = ids.slice(0, 8);

  const palettes = {
    prism: {
      feedback: [[8, 5, 10], [70, 10, 26], [205, 28, 53], [255, 196, 165]],
      displacement: [[3, 9, 18], [13, 38, 72], [72, 140, 212], [218, 244, 255]],
      slitscan: [[10, 4, 13], [70, 12, 38], [194, 47, 95], [255, 202, 213]],
      pointcloud: [[3, 12, 15], [10, 51, 56], [70, 196, 173], [226, 255, 238]],
      flow: [[4, 10, 19], [13, 43, 73], [75, 159, 205], [227, 242, 255]],
      triangulation: [[14, 6, 24], [67, 23, 83], [177, 83, 192], [255, 216, 246]],
      pixelsort: [[13, 5, 7], [95, 22, 13], [220, 70, 23], [255, 226, 174]],
      reaction: [[3, 14, 19], [6, 60, 70], [18, 179, 161], [202, 255, 225]],
      hdbeads: [[3, 8, 13], [21, 50, 85], [104, 187, 232], [245, 252, 255]],
      beads: [[9, 4, 12], [91, 14, 49], [235, 66, 111], [255, 213, 183]],
      rings: [[4, 10, 17], [16, 56, 84], [87, 208, 235], [250, 241, 226]],
      ascii: [[4, 5, 8], [38, 46, 75], [147, 203, 237], [244, 252, 255]],
    },
    chrome: { default: [[4, 8, 13], [24, 47, 66], [116, 163, 187], [244, 250, 251]] },
    lacquer: { default: [[10, 3, 5], [60, 6, 18], [189, 20, 47], [255, 207, 179]] },
    mineral: { default: [[2, 13, 17], [5, 55, 63], [19, 167, 151], [211, 255, 230]] },
  };

  const video = document.getElementById("camera");
  const statusEl = document.getElementById("status");
  const cameraButton = document.getElementById("cameraButton");
  const syntheticButton = document.getElementById("syntheticButton");
  const wireframeButton = document.getElementById("wireframeButton");
  const burstButton = document.getElementById("burstButton");
  const intensityInput = document.getElementById("intensity");
  const sourcePreview = document.getElementById("sourcePreview");
  const previewCtx = sourcePreview.getContext("2d", { alpha: false });
  const styleButtons = Array.from(document.querySelectorAll(".style-mode"));
  const signalMap = document.getElementById("signalMap");
  const signalCtx = signalMap.getContext("2d", { alpha: false });
  const statFrame = document.getElementById("statFrame");
  const statFps = document.getElementById("statFps");
  const statLuma = document.getElementById("statLuma");
  const statMotion = document.getElementById("statMotion");
  const statTriangles = document.getElementById("statTriangles");
  const signalState = document.getElementById("signalState");
  const effectReadouts = Object.fromEntries(ids.map((id) => [id, document.getElementById(`readout-${id}`)]));

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = W;
  sourceCanvas.height = H;
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });

  const lowCanvas = document.createElement("canvas");
  lowCanvas.width = W;
  lowCanvas.height = H;
  const lowCtx = lowCanvas.getContext("2d", { willReadFrequently: true });

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = W;
  tempCanvas.height = H;
  const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });

  const views = Object.fromEntries(
    ids.map((id) => {
      const canvas = document.getElementById(id);
      return [id, { canvas, ctx: canvas.getContext("2d", { alpha: false }) }];
    }),
  );

  let useCamera = false;
  let frames = [];
  let lastFrame = null;
  let tickCount = 0;
  let intensity = Number(intensityInput.value);
  let styleMode = "prism";
  let lumaLevel = 0;
  let motionLevel = 0;
  let motionCx = W * 0.5; // 运动质心：驱动同心圆/反馈等效果的互动中心
  let motionCy = H * 0.5;
  let fps = 60;
  let lastTimeMs = performance.now();
  let burstStart = -Infinity;
  let burstEnergy = 0;
  let wireframeMode = false;
  const burstDuration = 2400;
  const burstSeeds = Array.from({ length: 148 }, (_, index) => ({
    angle: ((index * 137.508) % 360) * (Math.PI / 180),
    speed: 0.34 + ((index * 47) % 100) / 145,
    drift: ((index * 71) % 100) / 100 - 0.5,
    hue: (index * 41) % 360,
  }));

  const signalNodes = Array.from({ length: 36 }, (_, index) => ({
    x: (index / 35) * (signalMap.width - 24) + 12,
    phase: index * 0.84,
    sampleX: (index * 29) % W,
    sampleY: (index * 47) % H,
  }));

  function setStyle(nextStyle) {
    if (!palettes[nextStyle]) return;
    styleMode = nextStyle;
    document.documentElement.dataset.style = styleMode;
    styleButtons.forEach((candidate) => {
      const active = candidate.dataset.style === styleMode;
      candidate.classList.toggle("is-active", active);
      candidate.setAttribute("aria-pressed", String(active));
    });
    document.dispatchEvent(new CustomEvent("style-change", { detail: { style: styleMode } }));
  }

  styleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setStyle(button.dataset.style);
    });
  });

  setStyle(new URLSearchParams(window.location.search).get("style") || styleMode);

  const feedbackA = document.createElement("canvas");
  const feedbackB = document.createElement("canvas");
  feedbackA.width = feedbackB.width = views.feedback.canvas.width;
  feedbackA.height = feedbackB.height = views.feedback.canvas.height;
  const feedbackACtx = feedbackA.getContext("2d", { alpha: false });
  const feedbackBCtx = feedbackB.getContext("2d", { alpha: false });
  feedbackACtx.fillStyle = "#020203";
  feedbackACtx.fillRect(0, 0, feedbackA.width, feedbackA.height);
  feedbackBCtx.fillStyle = "#020203";
  feedbackBCtx.fillRect(0, 0, feedbackB.width, feedbackB.height);
  let feedbackFront = feedbackA;
  let feedbackBack = feedbackB;

  const flowParticles = Array.from({ length: 2400 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    vx: 0,
    vy: 0,
    age: Math.random() * 90,
    phase: Math.random() * TAU,
  }));

  const reaction = createReactionState(W, H);
  let delaunayPoints = [];
  let delaunayTriangles = [];

  intensityInput.addEventListener("input", () => {
    intensity = Number(intensityInput.value);
  });

  cameraButton.addEventListener("click", async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      useCamera = true;
      statusEl.textContent = "正在使用摄像头源。";
    } catch (error) {
      useCamera = false;
      statusEl.textContent = "摄像头不可用，继续使用合成源。";
    }
  });

  syntheticButton.addEventListener("click", () => {
    useCamera = false;
    statusEl.textContent = "使用合成源。";
  });

  burstButton.addEventListener("click", () => {
    burstStart = performance.now();
    document.dispatchEvent(new CustomEvent("chroma-burst"));
  });

  wireframeButton.addEventListener("click", () => {
    wireframeMode = !wireframeMode;
    document.body.classList.toggle("is-wireframe", wireframeMode);
    wireframeButton.classList.toggle("is-active", wireframeMode);
    wireframeButton.setAttribute("aria-pressed", String(wireframeMode));
    document.dispatchEvent(new CustomEvent("wireframe-change", { detail: { active: wireframeMode } }));
  });

  if (new URLSearchParams(window.location.search).has("burst")) {
    burstStart = performance.now();
  }

  if (new URLSearchParams(window.location.search).has("wire")) {
    wireframeButton.click();
  }

  function lumaAt(data, x, y) {
    const ix = Math.max(0, Math.min(W - 1, x | 0));
    const iy = Math.max(0, Math.min(H - 1, y | 0));
    const i = (iy * W + ix) * 4;
    return data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
  }

  function colorAt(data, x, y) {
    const ix = Math.max(0, Math.min(W - 1, x | 0));
    const iy = Math.max(0, Math.min(H - 1, y | 0));
    const i = (iy * W + ix) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  }

  function clamp(value, min = 0, max = 255) {
    return Math.max(min, Math.min(max, value));
  }

  function paletteColor(name, value) {
    const activePalettes = palettes[styleMode];
    const colors = activePalettes[name] || activePalettes.default;
    const t = clamp(value, 0, 1) * (colors.length - 1);
    const index = Math.min(colors.length - 2, Math.floor(t));
    const mix = t - index;
    const eased = mix * mix * (3 - 2 * mix);
    const a = colors[index];
    const b = colors[index + 1];
    return [
      a[0] + (b[0] - a[0]) * eased,
      a[1] + (b[1] - a[1]) * eased,
      a[2] + (b[2] - a[2]) * eased,
    ];
  }

  function paletteStyle(name, value, alpha = 1) {
    const [r, g, b] = paletteColor(name, value);
    return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
  }

  function toneImage(imageData, paletteName, contrast = 1.2, shimmer = 0) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
      const t = clamp((lum - 0.5) * contrast + 0.5 + shimmer, 0, 1);
      const [r, g, b] = paletteColor(paletteName, t);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
    return imageData;
  }

  function colorGradeImage(imageData, lift = 1) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const lum = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      const chrome = Math.pow(lum / 255, 1.24) * 255;
      const redEdge = Math.max(0, data[i] - data[i + 1] * 0.72) * 0.75;
      data[i] = clamp(chrome * 0.98 + redEdge * 1.3 + 7 * lift);
      data[i + 1] = clamp(chrome * 0.94 + 4 * lift);
      data[i + 2] = clamp(chrome * 1.06 + Math.max(0, data[i + 2] - lum) * 0.45 + 11 * lift);
    }
    return imageData;
  }

  function putLowTo(viewName, imageData) {
    lowCtx.putImageData(imageData, 0, 0);
    const { canvas, ctx } = views[viewName];
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(lowCanvas, 0, 0, canvas.width, canvas.height);
  }

  function drawSourceInto(ctx, canvas, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }

  function drawSyntheticSource(time) {
    const shadow = paletteStyle("feedback", 0.02);
    const low = paletteStyle("feedback", 0.25);
    const accent = paletteStyle("feedback", 0.68);
    const highlight = paletteStyle("feedback", 0.95);
    sourceCtx.fillStyle = shadow;
    sourceCtx.fillRect(0, 0, W, H);

    const bg = sourceCtx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, low);
    bg.addColorStop(0.46, shadow);
    bg.addColorStop(1, accent);
    sourceCtx.fillStyle = bg;
    sourceCtx.fillRect(0, 0, W, H);

    sourceCtx.save();
    sourceCtx.globalAlpha = 0.32;
    for (let i = 0; i < 18; i += 1) {
      const y = (i * 8 + time * 10) % (H + 12) - 6;
      const sheen = sourceCtx.createLinearGradient(0, y, W, y + 1);
      sheen.addColorStop(0, "rgba(255,255,255,0)");
      sheen.addColorStop(0.28, paletteStyle("feedback", 0.72, 0.72));
      sheen.addColorStop(0.62, paletteStyle("feedback", 0.96, 0.18));
      sheen.addColorStop(1, paletteStyle("feedback", 0.58, 0.55));
      sourceCtx.fillStyle = sheen;
      sourceCtx.fillRect(0, y, W, 1);
    }
    sourceCtx.restore();

    const sweep = (time * 24) % (W + 80) - 40;
    const slash = sourceCtx.createLinearGradient(sweep - 30, 0, sweep + 18, H);
    slash.addColorStop(0, "rgba(255,255,255,0)");
    slash.addColorStop(0.48, paletteStyle("feedback", 0.86, 0.32));
    slash.addColorStop(0.54, paletteStyle("feedback", 1, 0.78));
    slash.addColorStop(1, "rgba(255,255,255,0)");
    sourceCtx.fillStyle = slash;
    sourceCtx.beginPath();
    sourceCtx.moveTo(sweep, 0);
    sourceCtx.lineTo(sweep + 18, 0);
    sourceCtx.lineTo(sweep - 18, H);
    sourceCtx.lineTo(sweep - 42, H);
    sourceCtx.closePath();
    sourceCtx.fill();

    sourceCtx.save();
    sourceCtx.globalCompositeOperation = "screen";
    sourceCtx.strokeStyle = paletteStyle("feedback", 0.68, 0.9);
    sourceCtx.lineWidth = 7;
    sourceCtx.beginPath();
    for (let x = -10; x <= W + 10; x += 4) {
      const y = H * 0.52 + Math.sin(x * 0.055 + time * 2.1) * 23 + Math.sin(x * 0.13 - time) * 6;
      if (x === -10) sourceCtx.moveTo(x, y);
      else sourceCtx.lineTo(x, y);
    }
    sourceCtx.stroke();
    sourceCtx.strokeStyle = paletteStyle("feedback", 0.96, 0.48);
    sourceCtx.lineWidth = 1.3;
    sourceCtx.stroke();
    sourceCtx.restore();

    const cx = W * 0.5 + Math.sin(time * 0.72) * 9;
    const cy = H * 0.47 + Math.cos(time * 0.52) * 3;
    const chrome = sourceCtx.createLinearGradient(cx - 35, cy - 44, cx + 37, cy + 50);
    chrome.addColorStop(0, highlight);
    chrome.addColorStop(0.18, paletteStyle("feedback", 0.47));
    chrome.addColorStop(0.34, paletteStyle("feedback", 0.9));
    chrome.addColorStop(0.58, paletteStyle("feedback", 0.18));
    chrome.addColorStop(0.74, paletteStyle("feedback", 0.7));
    chrome.addColorStop(1, shadow);

    sourceCtx.save();
    sourceCtx.translate(cx, cy);
    sourceCtx.rotate(Math.sin(time * 0.55) * 0.07);
    sourceCtx.fillStyle = chrome;
    sourceCtx.beginPath();
    sourceCtx.ellipse(0, -11, 25, 34, 0, 0, TAU);
    sourceCtx.fill();

    const bust = sourceCtx.createLinearGradient(-24, 18, 28, 58);
    bust.addColorStop(0, paletteStyle("feedback", 0.9));
    bust.addColorStop(0.4, paletteStyle("feedback", 0.3));
    bust.addColorStop(1, shadow);
    sourceCtx.fillStyle = bust;
    sourceCtx.beginPath();
    sourceCtx.moveTo(-17, 17);
    sourceCtx.bezierCurveTo(-25, 34, -38, 48, -48, 67);
    sourceCtx.lineTo(48, 67);
    sourceCtx.bezierCurveTo(37, 46, 25, 34, 16, 17);
    sourceCtx.closePath();
    sourceCtx.fill();

    sourceCtx.fillStyle = shadow;
    sourceCtx.fillRect(-16, -18, 32, 5);
    sourceCtx.strokeStyle = paletteStyle("feedback", 0.98, 0.64);
    sourceCtx.lineWidth = 1.2;
    sourceCtx.beginPath();
    sourceCtx.moveTo(-20, -25);
    sourceCtx.bezierCurveTo(-4, -36, 13, -35, 23, -23);
    sourceCtx.stroke();
    sourceCtx.restore();

    const bottleX = W * 0.18 + Math.sin(time * 0.9) * 8;
    const bottleY = H * 0.64;
    const glass = sourceCtx.createLinearGradient(bottleX - 14, bottleY - 34, bottleX + 16, bottleY + 22);
    glass.addColorStop(0, paletteStyle("feedback", 1, 0.94));
    glass.addColorStop(0.32, paletteStyle("feedback", 0.62, 0.36));
    glass.addColorStop(0.68, paletteStyle("feedback", 0.94, 0.18));
    glass.addColorStop(1, paletteStyle("feedback", 0.62, 0.34));
    sourceCtx.fillStyle = glass;
    sourceCtx.beginPath();
    sourceCtx.roundRect(bottleX - 14, bottleY - 31, 28, 42, 5);
    sourceCtx.fill();
    sourceCtx.fillStyle = paletteStyle("feedback", 0.98);
    sourceCtx.fillRect(bottleX - 6, bottleY - 40, 12, 8);
    sourceCtx.fillStyle = shadow;
    sourceCtx.fillRect(bottleX - 9, bottleY - 17, 18, 14);

    for (let i = 0; i < 10; i += 1) {
      const a = time * 0.8 + i * 0.92;
      const px = W * 0.78 + Math.cos(a) * (20 + Math.sin(time + i) * 7);
      const py = H * 0.42 + Math.sin(a * 1.2) * (27 + Math.cos(time * 0.7 + i) * 5);
      const radius = 2.4 + (i % 3) * 0.8;
      const pearl = sourceCtx.createRadialGradient(px - radius * 0.45, py - radius * 0.45, 0.4, px, py, radius);
      pearl.addColorStop(0, paletteStyle("feedback", 1));
      pearl.addColorStop(0.42, paletteStyle("feedback", 0.85));
      pearl.addColorStop(1, paletteStyle("feedback", 0.42));
      sourceCtx.fillStyle = pearl;
      sourceCtx.beginPath();
      sourceCtx.arc(px, py, radius, 0, TAU);
      sourceCtx.fill();
    }

    sourceCtx.globalCompositeOperation = "lighter";
    sourceCtx.strokeStyle = paletteStyle("feedback", 0.85, 0.18);
    sourceCtx.lineWidth = 1;
    for (let i = 0; i < 8; i += 1) {
      const x = (i * 23 + Math.sin(time * 0.7 + i) * 8) % W;
      sourceCtx.beginPath();
      sourceCtx.moveTo(x, 0);
      sourceCtx.lineTo(x - 18, H);
      sourceCtx.stroke();
    }
    sourceCtx.globalCompositeOperation = "source-over";
  }

  function renderSource(time) {
    if (useCamera && video.readyState >= 2) {
      sourceCtx.save();
      sourceCtx.translate(W, 0);
      sourceCtx.scale(-1, 1);
      const ratio = Math.max(W / video.videoWidth, H / video.videoHeight);
      const dw = video.videoWidth * ratio;
      const dh = video.videoHeight * ratio;
      sourceCtx.drawImage(video, (W - dw) * 0.5, (H - dh) * 0.5, dw, dh);
      sourceCtx.restore();
    } else {
      drawSyntheticSource(time);
    }

    previewCtx.imageSmoothingEnabled = false;
    previewCtx.drawImage(sourceCanvas, 0, 0, sourcePreview.width, sourcePreview.height);
  }

  function renderFeedback(frame, time) {
    const view = views.feedback;
    const nextCtx = feedbackBack.getContext("2d", { alpha: false });
    nextCtx.globalCompositeOperation = "source-over";
    nextCtx.globalAlpha = 1;
    nextCtx.save();
    nextCtx.fillStyle = paletteStyle("feedback", 0.02);
    nextCtx.fillRect(0, 0, feedbackBack.width, feedbackBack.height);
    nextCtx.translate(feedbackBack.width * 0.5, feedbackBack.height * 0.5);
    nextCtx.rotate(0.008 * intensity + Math.sin(time * 0.8) * 0.003);
    const scale = 1.012 + intensity * 0.014;
    nextCtx.scale(scale, scale);
    nextCtx.translate(-feedbackFront.width * 0.5 + Math.sin(time * 0.9) * 1.8, -feedbackFront.height * 0.5);
    // 残影衰减：必须 < 1，否则几十帧内画面发散刷白
    nextCtx.globalAlpha = 0.90;
    nextCtx.filter = "hue-rotate(5deg) saturate(1.03) brightness(0.985)";
    nextCtx.drawImage(feedbackFront, 0, 0);
    nextCtx.filter = "none";
    nextCtx.restore();

    // 每帧轻微压暗，保证能量守恒（残影约 2~3 秒衰减到黑）
    nextCtx.globalCompositeOperation = "source-over";
    nextCtx.fillStyle = "rgba(2, 2, 4, 0.06)";
    nextCtx.fillRect(0, 0, feedbackBack.width, feedbackBack.height);

    // 注入量由运动驱动：静止时只留微弱底图，一动就把动作“点亮”进隧道
    const inject = Math.min(0.7, 0.1 + motionLevel * 6);
    nextCtx.globalCompositeOperation = "screen";
    drawSourceInto(nextCtx, feedbackBack, inject);
    nextCtx.globalCompositeOperation = "source-over";

    view.ctx.drawImage(feedbackBack, 0, 0);
    const swap = feedbackFront;
    feedbackFront = feedbackBack;
    feedbackBack = swap;
  }

  function renderDisplacement(frame, time) {
    const src = frame.data;
    const out = sourceCtx.createImageData(W, H);
    const dst = out.data;
    // 强度由运动驱动：静止时画面基本正常，一动局部像液体一样流开
    const strength = (4 + motionLevel * 90) * intensity;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 4;
        // 平滑亮度梯度（间隔采样避免噪点级抖动）
        const gx = (lumaAt(src, x + 3, y) - lumaAt(src, x - 3, y)) / 255;
        const gy = (lumaAt(src, x, y + 3) - lumaAt(src, x, y - 3)) / 255;
        const swirl = Math.sin(x * 0.045 + y * 0.038 + time * 1.6);
        const sx = x + gx * strength + Math.sin(y * 0.05 + time * 2.2) * strength * 0.3 * swirl;
        const sy = y + gy * strength + Math.cos(x * 0.04 - time * 1.8) * strength * 0.3;
        // RGB 通道分离采样：保留摄像头原色，只在位移方向做色散
        const split = 1.5 + strength * 0.12;
        const [r] = colorAt(src, sx + split, sy);
        const [, g] = colorAt(src, sx, sy);
        const [, , b] = colorAt(src, sx - split, sy + split * 0.5);
        const lum = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
        const [pr, pg, pb] = paletteColor("displacement", lum);
        const tint = 0.22; // 调色板只做轻微氛围染色，不覆盖原色
        dst[i] = clamp(r * (1 - tint) + pr * tint);
        dst[i + 1] = clamp(g * (1 - tint) + pg * tint);
        dst[i + 2] = clamp(b * (1 - tint) + pb * tint);
        dst[i + 3] = 255;
      }
    }
    putLowTo("displacement", out);
  }

  function renderSlitscan(frame, time) {
    const out = sourceCtx.createImageData(W, H);
    const dst = out.data;
    const available = frames.length;
    for (let y = 0; y < H; y += 1) {
      // 每行取不同时刻的历史帧：整行时间跨度拉满整个缓冲区，动作才会被拉成绸带
      const rowPhase = (Math.sin(y * 0.045 + time * 1.2) + 1) * 0.5;
      const age = Math.floor(rowPhase * (available - 1) * intensity);
      const picked = frames[Math.max(0, available - 1 - age)] || frame;
      const wave = (Math.sin(y * 0.12 + time * 2.0) + 1) * 0.5;
      for (let x = 0; x < W; x += 1) {
        const di = (y * W + x) * 4;
        const si = di;
        // 保留历史帧的原色，调色板只做轻微整体染色
        const r = picked.data[si];
        const g = picked.data[si + 1];
        const b = picked.data[si + 2];
        const l = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
        const [pr, pg, pb] = paletteColor("slitscan", l + wave * 0.08);
        const tint = 0.2;
        dst[di] = clamp(r * (1 - tint) + pr * tint);
        dst[di + 1] = clamp(g * (1 - tint) + pg * tint);
        dst[di + 2] = clamp(b * (1 - tint) + pb * tint);
        dst[di + 3] = 255;
      }
    }
    putLowTo("slitscan", out);
  }

  function renderPointCloud(frame, time) {
    const { canvas, ctx } = views.pointcloud;
    const src = frame.data;
    ctx.fillStyle = "#030d0f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width * 0.5, canvas.height * 0.52);
    const yaw = Math.sin(time * 0.55) * 0.34;
    const pitch = Math.cos(time * 0.42) * 0.17;
    const sx = canvas.width / W;
    const sy = canvas.height / H;
    for (let y = 1; y < H; y += 2) {
      for (let x = 1; x < W; x += 2) {
        const i = (y * W + x) * 4;
        const lum = (src[i] * 0.2 + src[i + 1] * 0.72 + src[i + 2] * 0.08) / 255;
        const z = (lum - 0.42) * 92 * intensity + Math.sin(x * 0.13 + y * 0.07 + time) * 4;
        const px = (x - W * 0.5) * Math.cos(yaw) + z * Math.sin(yaw);
        const pz = z * Math.cos(yaw) - (x - W * 0.5) * Math.sin(yaw);
        const py = (y - H * 0.5) * Math.cos(pitch) - pz * Math.sin(pitch);
        const perspective = 1.1 + pz * 0.006;
        const size = Math.max(0.6, lum * 3.2 * intensity);
        // 原色为主 + 调色板提亮，点云才有“人”的辨识度
        const [pr, pg, pb] = paletteColor("pointcloud", Math.pow(lum, 0.68));
        const r = clamp(src[i] * 0.7 + pr * 0.45);
        const g = clamp(src[i + 1] * 0.7 + pg * 0.45);
        const b = clamp(src[i + 2] * 0.7 + pb * 0.45);
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${0.3 + lum * 0.7})`;
        ctx.fillRect(px * sx * perspective - size * 0.5, py * sy * perspective - size * 0.5, size, size);
      }
    }
    ctx.restore();
  }

  function renderFlowParticles(frame, time) {
    const { canvas, ctx } = views.flow;
    const src = frame.data;
    const prev = lastFrame ? lastFrame.data : src;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(2, 8, 16, 0.13)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "lighter";
    const sx = canvas.width / W;
    const sy = canvas.height / H;
    for (const p of flowParticles) {
      const oldX = p.x;
      const oldY = p.y;
      const x = Math.max(1, Math.min(W - 2, p.x | 0));
      const y = Math.max(1, Math.min(H - 2, p.y | 0));
      const lum = lumaAt(src, x, y);
      const temporal = (lum - lumaAt(prev, x, y)) / 255;
      const gx = (lumaAt(src, x + 1, y) - lumaAt(src, x - 1, y)) / 255;
      const gy = (lumaAt(src, x, y + 1) - lumaAt(src, x, y - 1)) / 255;
      const vortexX = Math.sin(time * 1.1 + p.y * 0.075 + p.phase) * 0.34;
      const vortexY = Math.cos(time * 1.25 + p.x * 0.062 + p.phase) * 0.34;
      p.vx = p.vx * 0.9 + (-gy * 12 + temporal * 30 + vortexX) * intensity;
      p.vy = p.vy * 0.9 + (gx * 12 + temporal * 22 + vortexY) * intensity;
      p.x += p.vx * 0.38;
      p.y += p.vy * 0.38;
      p.age += 1;
      if (p.x < 0 || p.x >= W || p.y < 0 || p.y >= H || p.age > 230) {
        p.x = Math.random() * W;
        p.y = Math.random() * H;
        p.vx = 0;
        p.vy = 0;
        p.age = 0;
      }
      const velocity = Math.min(1, Math.hypot(p.vx, p.vy) / 12);
      const alpha = 0.03 + Math.min(0.45, velocity * 0.34 + lum / 900);
      // 粒子颜色取自摄像头对应位置，运动快时再混入调色板亮色
      const [cr, cg, cb] = colorAt(src, x, y);
      const [pr, pg, pb] = paletteColor("flow", 0.6 + velocity * 0.4);
      const mix = velocity * 0.55;
      ctx.strokeStyle = `rgba(${clamp(cr * (1 - mix) + pr * mix) | 0},${clamp(cg * (1 - mix) + pg * mix) | 0},${clamp(cb * (1 - mix) + pb * mix) | 0},${alpha})`;
      ctx.lineWidth = 0.4 + velocity * 1.1;
      ctx.beginPath();
      ctx.moveTo(oldX * sx, oldY * sy);
      ctx.lineTo(p.x * sx, p.y * sy);
      ctx.stroke();
      if (velocity > 0.58 && p.age % 4 === 0) {
        ctx.fillStyle = paletteStyle("flow", 0.85, alpha + 0.14);
        ctx.fillRect(p.x * sx - 1, p.y * sy - 1, 2, 2);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function makeDelaunayPoints(frame, time) {
    const src = frame.data;
    const points = [];
    for (let i = 0; i < 34; i += 1) {
      const a = i * 2.399963;
      const radius = Math.sqrt((i + 0.5) / 34);
      const wobble = Math.sin(time * 1.1 + i) * 4;
      points.push({
        x: W * 0.5 + Math.cos(a + time * 0.12) * radius * (W * 0.47 + wobble),
        y: H * 0.5 + Math.sin(a - time * 0.08) * radius * (H * 0.42 + wobble),
      });
    }
    const columns = 16;
    const rows = 12;
    for (let cellY = 0; cellY < rows; cellY += 1) {
      for (let cellX = 0; cellX < columns; cellX += 1) {
        const startX = Math.floor((cellX / columns) * W);
        const endX = Math.floor(((cellX + 1) / columns) * W);
        const startY = Math.floor((cellY / rows) * H);
        const endY = Math.floor(((cellY + 1) / rows) * H);
        let bestX = startX;
        let bestY = startY;
        let best = -1;
        for (let y = startY + 1; y < endY - 1; y += 2) {
          for (let x = startX + 1; x < endX - 1; x += 2) {
            const gx = Math.abs(lumaAt(src, x + 1, y) - lumaAt(src, x - 1, y));
            const gy = Math.abs(lumaAt(src, x, y + 1) - lumaAt(src, x, y - 1));
            const score = gx + gy + lumaAt(src, x, y) * 0.22;
            if (score > best) {
              best = score;
              bestX = x;
              bestY = y;
            }
          }
        }
        points.push({ x: bestX + Math.sin(time * 1.7 + cellY) * 1.6, y: bestY + Math.cos(time * 1.4 + cellX) * 1.6 });
      }
    }
    points.push({ x: 0, y: 0 }, { x: W - 1, y: 0 }, { x: W - 1, y: H - 1 }, { x: 0, y: H - 1 });
    return points;
  }

  function renderTriangulation(frame, time) {
    if (tickCount % 5 === 0 || delaunayTriangles.length === 0) {
      delaunayPoints = makeDelaunayPoints(frame, time);
      delaunayTriangles = triangulate(delaunayPoints);
    }
    const { canvas, ctx } = views.triangulation;
    ctx.fillStyle = "#0e0618";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const sx = canvas.width / W;
    const sy = canvas.height / H;
    for (const tri of delaunayTriangles) {
      const a = delaunayPoints[tri[0]];
      const b = delaunayPoints[tri[1]];
      const c = delaunayPoints[tri[2]];
      const cx = (a.x + b.x + c.x) / 3;
      const cy = (a.y + b.y + c.y) / 3;
      const [r, g, bl] = colorAt(frame.data, cx, cy);
      const lum = r * 0.2126 + g * 0.7152 + bl * 0.0722;
      const [pr, pg, pb] = paletteColor("triangulation", lum / 255);
      const colorLift = 0.18 + Math.min(0.2, lum / 900);
      ctx.fillStyle = `rgb(${clamp(r * 0.88 + pr * colorLift)},${clamp(g * 0.88 + pg * colorLift)},${clamp(bl * 0.88 + pb * colorLift)})`;
      ctx.beginPath();
      ctx.moveTo(a.x * sx, a.y * sy);
      ctx.lineTo(b.x * sx, b.y * sy);
      ctx.lineTo(c.x * sx, c.y * sy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = paletteStyle("triangulation", lum / 255 + 0.18, 0.26);
      ctx.stroke();
    }
  }

  function renderPixelSort(frame, time) {
    const src = frame.data;
    const out = sourceCtx.createImageData(W, H);
    out.data.set(src);
    // 阈值随运动降低：动得越多，参与排序的像素段越多
    const threshold = 96 - motionLevel * 400 + Math.sin(time * 1.1) * 12;
    for (let x = 0; x < W; x += 1) {
      let y = 0;
      while (y < H) {
        while (y < H && lumaAt(src, x, y) < threshold) y += 1;
        const start = y;
        while (y < H && lumaAt(src, x, y) >= threshold) y += 1;
        const end = y;
        if (end - start > 2) {
          const segment = [];
          for (let yy = start; yy < end; yy += 1) {
            const i = (yy * W + x) * 4;
            segment.push([src[i], src[i + 1], src[i + 2], src[i + 3], lumaAt(src, x, yy)]);
          }
          segment.sort((a, b) => a[4] - b[4]);
          if ((x + Math.floor(time * 8)) % 9 < 4) segment.reverse();
          for (let yy = start; yy < end; yy += 1) {
            const j = yy - start;
            const i = (yy * W + x) * 4;
            // 保留排序后像素的原色，调色板只做 12% 染色，拉丝干净不花
            const [pr, pg, pb] = paletteColor("pixelsort", segment[j][4] / 255);
            const mix = 0.12;
            out.data[i] = clamp(segment[j][0] * (1 - mix) + pr * mix);
            out.data[i + 1] = clamp(segment[j][1] * (1 - mix) + pg * mix);
            out.data[i + 2] = clamp(segment[j][2] * (1 - mix) + pb * mix);
            out.data[i + 3] = 255;
          }
        }
      }
    }
    putLowTo("pixelsort", out);
  }

  function createReactionState(width, height) {
    const count = width * height;
    const a = new Float32Array(count).fill(1);
    const b = new Float32Array(count);
    const nextA = new Float32Array(count);
    const nextB = new Float32Array(count);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.createImageData(width, height);
    const centerX = Math.floor(width * 0.5);
    const centerY = Math.floor(height * 0.5);
    for (let y = centerY - 11; y < centerY + 11; y += 1) {
      for (let x = centerX - 16; x < centerX + 16; x += 1) b[y * width + x] = 1;
    }
    for (let i = 0; i < 74; i += 1) {
      const x = 4 + ((i * 47) % (width - 8));
      const y = 4 + ((i * 71) % (height - 8));
      const strength = 0.34 + (i % 5) * 0.11;
      b[y * width + x] = strength;
      b[y * width + x + 1] = strength * 0.72;
      b[(y + 1) * width + x] = strength * 0.72;
    }
    return { width, height, a, b, nextA, nextB, canvas, ctx, image };
  }

  function lap(arr, x, y, width) {
    const i = y * width + x;
    return (
      arr[i] * -1 +
      (arr[i - 1] + arr[i + 1] + arr[i - width] + arr[i + width]) * 0.2 +
      (arr[i - width - 1] + arr[i - width + 1] + arr[i + width - 1] + arr[i + width + 1]) * 0.05
    );
  }

  function renderReaction(frame, time) {
    const st = reaction;
    const width = st.width;
    const height = st.height;
    // 锁定在珊瑚生长参数区（f≈0.0545 / k≈0.062），花纹会沿人形轮廓生长而不是自顾自长迷宫
    const feed = 0.0545 + Math.sin(time * 0.18) * 0.0012;
    const kill = 0.062 + Math.cos(time * 0.13) * 0.0008;
    for (let n = 0; n < 5; n += 1) {
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const i = y * width + x;
          const aa = st.a[i];
          const bb = st.b[i];
          const reactionTerm = aa * bb * bb;
          st.nextA[i] = clamp(aa + (1.0 * lap(st.a, x, y, width) - reactionTerm + feed * (1 - aa)), 0, 1);
          st.nextB[i] = clamp(bb + (0.5 * lap(st.b, x, y, width) + reactionTerm - (kill + feed) * bb), 0, 1);
        }
      }
      [st.a, st.nextA] = [st.nextA, st.a];
      [st.b, st.nextB] = [st.nextB, st.b];
    }

    if (tickCount % 2 === 0) {
      for (let y = 3; y < height - 3; y += 3) {
        for (let x = 3; x < width - 3; x += 3) {
          const sx = (x / width) * W;
          const sy = (y / height) * H;
          const lum = lumaAt(frame.data, sx, sy) / 255;
          const edge =
            Math.abs(lumaAt(frame.data, sx + 1, sy) - lumaAt(frame.data, sx - 1, sy)) +
            Math.abs(lumaAt(frame.data, sx, sy + 1) - lumaAt(frame.data, sx, sy - 1));
          const pulse = (Math.sin(time * 1.4 + x * 0.13 + y * 0.08) + 1) * 0.5;
          // 边缘 + 运动都能播种：人动到哪里，图案就从哪里长出来
          if ((edge > 26 + pulse * 24 && lum > 0.2) || motionLevel > 0.01) {
            const seed = edge > 26 ? 0.3 : motionLevel * 8;
            st.b[y * width + x] = Math.min(1, st.b[y * width + x] + seed * intensity);
            st.a[y * width + x] = Math.max(0, st.a[y * width + x] - seed * 0.5);
          }
        }
      }
    }

    const img = st.image.data;
    for (let i = 0; i < st.a.length; i += 1) {
      const b = st.b[i];
      const a = st.a[i];
      const filament = clamp(b * 1.85 - a * 0.42, 0, 1);
      const cell = clamp((1 - a) * 1.4 + b * 0.46, 0, 1);
      const j = i * 4;
      const [pr, pg, pb] = paletteColor("reaction", 0.14 + filament * 0.86);
      const contrast = filament > 0.14 ? 0.38 + filament * 0.9 : 0.08 + cell * 0.18;
      img[j] = clamp(pr * contrast + cell * 36);
      img[j + 1] = clamp(pg * contrast + cell * 22);
      img[j + 2] = clamp(pb * contrast + cell * 44);
      img[j + 3] = 255;
    }
    st.ctx.putImageData(st.image, 0, 0);
    const { canvas, ctx } = views.reaction;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(st.canvas, 0, 0, canvas.width, canvas.height);
  }

  function renderHdBeads(frame, time) {
    const { canvas, ctx } = views.hdbeads;
    const src = frame.data;
    // 高清拼豆：固定高密度网格（不随时间抖动），原色珠体 + 左上镜面高光 + 亮度起伏
    const density = 4;
    const scaleX = canvas.width / W;
    const scaleY = canvas.height / H;
    ctx.fillStyle = "#07080c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = density * 0.5; y < H; y += density) {
      for (let x = density * 0.5; x < W; x += density) {
        const lum = lumaAt(src, x, y) / 255;
        const [r, g, b] = colorAt(src, x, y);
        // 亮度起伏：亮的珠子鼓起来（更大、上浮），暗的珠子沉下去
        const bump = (lum - 0.5) * 2;
        const radius = density * (0.34 + lum * 0.24) * Math.min(scaleX, scaleY);
        const px = x * scaleX;
        const py = y * scaleY - bump * density * 0.8 + Math.sin(time * 1.8 + x * 0.3 + y * 0.2) * lum * 1.2;
        // 珠体投影（起伏感的关键）
        ctx.fillStyle = `rgba(0,0,0,${0.25 + bump * 0.15})`;
        ctx.beginPath();
        ctx.arc(px + radius * 0.2, py + radius * 0.35, radius * 0.95, 0, TAU);
        ctx.fill();
        // 珠体：摄像头原色，亮度轻微提升饱和
        const pearl = ctx.createRadialGradient(px - radius * 0.35, py - radius * 0.4, radius * 0.1, px, py, radius);
        pearl.addColorStop(0, `rgb(${clamp(r + 90)},${clamp(g + 90)},${clamp(b + 90)})`);
        pearl.addColorStop(0.35, `rgb(${clamp(r * 1.06)},${clamp(g * 1.06)},${clamp(b * 1.06)})`);
        pearl.addColorStop(0.85, `rgb(${clamp(r * 0.72)},${clamp(g * 0.72)},${clamp(b * 0.72)})`);
        pearl.addColorStop(1, `rgb(${clamp(r * 0.4)},${clamp(g * 0.4)},${clamp(b * 0.4)})`);
        ctx.fillStyle = pearl;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, TAU);
        ctx.fill();
        // 镜面高光点：亮度越高越锐
        ctx.fillStyle = `rgba(255,255,255,${0.25 + lum * 0.55})`;
        ctx.beginPath();
        ctx.arc(px - radius * 0.32, py - radius * 0.36, radius * (0.16 + lum * 0.1), 0, TAU);
        ctx.fill();
      }
    }
  }

  function renderBeads(frame, time) {
    const { canvas, ctx } = views.beads;
    const src = frame.data;
    // 拼豆：固定低分辨率网格 + 颜色量化（每通道 5 级），像真的 perler 豆板
    const cell = 8;
    const sx = canvas.width / W;
    const sy = canvas.height / H;
    ctx.fillStyle = "#141018";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const prev = lastFrame ? lastFrame.data : src;
    const quant = (v) => Math.round(v / 51) * 51; // 5 级量化 → 拼豆的“有限色号”感
    for (let y = 0; y < H; y += cell) {
      for (let x = 0; x < W; x += cell) {
        const sampleX = Math.min(W - 1, x + cell * 0.5);
        const sampleY = Math.min(H - 1, y + cell * 0.5);
        const [r0, g0, b0] = colorAt(src, sampleX, sampleY);
        const r = quant(r0), g = quant(g0), b = quant(b0);
        const lum = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
        // 该格的运动量：动的格子会“点亮”
        const moved = Math.abs(lumaAt(src, sampleX, sampleY) - lumaAt(prev, sampleX, sampleY)) / 255;
        const px = x * sx;
        const py = y * sy;
        const width = cell * sx;
        const height = cell * sy;
        const radius = Math.min(width, height) * 0.46;
        const cx2 = px + width * 0.5;
        const cy2 = py + height * 0.5;
        // 珠体（圆形，带轻微立体渐变）
        const bead = ctx.createRadialGradient(cx2 - radius * 0.3, cy2 - radius * 0.3, radius * 0.2, cx2, cy2, radius);
        bead.addColorStop(0, `rgb(${clamp(r + 46)},${clamp(g + 46)},${clamp(b + 46)})`);
        bead.addColorStop(1, `rgb(${clamp(r * 0.66)},${clamp(g * 0.66)},${clamp(b * 0.66)})`);
        ctx.fillStyle = bead;
        ctx.beginPath();
        ctx.arc(cx2, cy2, radius, 0, TAU);
        ctx.fill();
        // 拼豆中心孔
        ctx.fillStyle = `rgba(10,8,14,${0.55 + lum * 0.2})`;
        ctx.beginPath();
        ctx.arc(cx2, cy2, radius * 0.3, 0, TAU);
        ctx.fill();
        // 运动点亮：动过的珠子发光
        if (moved > 0.06) {
          ctx.strokeStyle = paletteStyle("beads", 0.9, Math.min(0.9, moved * 4));
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(cx2, cy2, radius * 0.82, 0, TAU);
          ctx.stroke();
        }
      }
    }
  }

  function renderRings(frame, time) {
    const src = frame.data;
    const out = sourceCtx.createImageData(W, H);
    const dst = out.data;
    // 环心跟随运动质心：手在哪里动，声波就从哪里发出
    const centerX = motionCx;
    const centerY = motionCy;
    const frequency = 0.5 + intensity * 0.15;
    // 波纹幅度由运动驱动：静止时画面几乎正常，动起来才被“声波雕刻”
    const amp = 2 + motionLevel * 160 * intensity;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const dx = x - centerX;
        const dy = (y - centerY) * 1.18;
        const radius = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        const ripple = Math.sin(radius * frequency - time * 5.0);
        const interference = Math.sin(radius * 0.19 + time * 2.3 - angle * 6.0) * 0.34;
        const sourceRadius = radius + ripple * amp + interference * amp * 0.28;
        const sampleX = centerX + Math.cos(angle) * sourceRadius;
        const sampleY = centerY + Math.sin(angle) * sourceRadius / 1.18;
        const [r, g, b] = colorAt(src, sampleX, sampleY);
        const band = Math.pow(Math.max(0, ripple), 4) * Math.min(1, motionLevel * 10);
        const fineBand = Math.pow(Math.max(0, interference), 7) * Math.min(0.3, motionLevel * 3);
        const [pr, pg, pb] = paletteColor("rings", 0.75);
        const i = (y * W + x) * 4;
        // 原色为主，波峰处叠一层调色板亮环
        dst[i] = clamp(r * 0.88 + pr * (band * 0.66 + fineBand));
        dst[i + 1] = clamp(g * 0.88 + pg * (band * 0.66 + fineBand));
        dst[i + 2] = clamp(b * 0.88 + pb * (band * 0.66 + fineBand));
        dst[i + 3] = 255;
      }
    }
    putLowTo("rings", out);
  }

  function renderAscii(frame, time) {
    const { canvas, ctx } = views.ascii;
    const src = frame.data;
    const chars = " `.-,:;~i1tfLCG08@";
    const stepX = 8;
    const stepY = 10;
    let glyphs = 0;
    ctx.fillStyle = paletteStyle("ascii", 0.02);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = "700 9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "top";
    for (let py = 2; py < canvas.height - stepY; py += stepY) {
      for (let px = 1; px < canvas.width - stepX; px += stepX) {
        const x = (px / canvas.width) * W;
        const y = (py / canvas.height) * H;
        const lum = lumaAt(src, x, y) / 255;
        const grain = (Math.sin(time * 4.5 + x * 0.62 + y * 1.4) + 1) * 0.035;
        const pulse = Math.max(0, Math.sin(time * 2.1 - y * 0.14 + x * 0.05)) * 0.08;
        const index = Math.min(chars.length - 1, Math.floor(Math.pow(clamp(lum + grain + pulse), 0.72) * chars.length));
        if (index < 2 && (px + py + tickCount) % 4 !== 0) continue;
        // 字符颜色取摄像头原色并提亮，调色板只占 25%，保证人脸轮廓可辨
        const [r, g, b] = colorAt(src, x, y);
        const [pr, pg, pb] = paletteColor("ascii", lum * 0.95 + 0.08);
        const cr = clamp(r * 1.3 + pr * 0.25);
        const cg = clamp(g * 1.3 + pg * 0.25);
        const cb = clamp(b * 1.3 + pb * 0.25);
        ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${0.25 + lum * 0.75})`;
        ctx.fillText(chars[index], px + Math.sin(time * 1.6 + py * 0.08) * lum * 1.4, py + Math.sin(time * 2 + px * 0.13) * (0.55 + lum * 0.55));
        glyphs += 1;
      }
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = paletteStyle("ascii", 0.9, 0.11);
    for (let y = 0; y < canvas.height; y += 4) ctx.fillRect(0, y, canvas.width, 1);
    ctx.globalCompositeOperation = "source-over";
    views.ascii.glyphCount = glyphs;
  }

  function updateTelemetry(frame, timeMs) {
    const data = frame.data;
    let lumaSum = 0;
    let motionSum = 0;
    let samples = 0;
    let mx = 0;
    let my = 0;
    const previous = lastFrame ? lastFrame.data : data;
    for (let y = 2; y < H; y += 4) {
      for (let x = 2; x < W; x += 4) {
        const i = (y * W + x) * 4;
        const lum = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        const oldLum = previous[i] * 0.2126 + previous[i + 1] * 0.7152 + previous[i + 2] * 0.0722;
        const diff = Math.abs(lum - oldLum);
        lumaSum += lum;
        motionSum += diff;
        mx += x * diff;
        my += y * diff;
        samples += 1;
      }
    }
    lumaLevel = lumaSum / samples / 255;
    motionLevel = motionSum / samples / 255;
    if (motionSum > samples * 2) {
      // 有明显运动时，质心平滑跟随运动位置
      motionCx += (mx / motionSum - motionCx) * 0.2;
      motionCy += (my / motionSum - motionCy) * 0.2;
    } else {
      motionCx += (W * 0.5 - motionCx) * 0.01;
      motionCy += (H * 0.5 - motionCy) * 0.01;
    }
    const frameDuration = Math.max(1, timeMs - lastTimeMs);
    fps = fps * 0.88 + (1000 / frameDuration) * 0.12;
    lastTimeMs = timeMs;

    if (tickCount % 3 !== 0) return;
    statFrame.textContent = String(tickCount).padStart(4, "0");
    statFps.textContent = fps.toFixed(1);
    statLuma.textContent = lumaLevel.toFixed(3);
    statMotion.textContent = motionLevel.toFixed(3);
    statTriangles.textContent = String(delaunayTriangles.length).padStart(3, "0");
    signalState.textContent = burstEnergy > 0.01
      ? `CHROMA BURST / ${(burstEnergy * 100).toFixed(0).padStart(2, "0")}% ENERGY`
      : wireframeMode
        ? "WIRE CHOREOGRAPHY / BODY FIELD ACTIVE"
        : `${useCamera ? "CAMERA" : "SYNTHETIC"} INPUT / ${frames.length} FRAME MEMORY`;
    effectReadouts.feedback.textContent = `GAIN ${(0.92 + intensity * 0.18).toFixed(2)}`;
    effectReadouts.displacement.textContent = `WARP ${(intensity * 9).toFixed(1)}`;
    effectReadouts.slitscan.textContent = `MEM ${String(frames.length).padStart(2, "0")}F`;
    effectReadouts.pointcloud.textContent = "PTS 1200";
    effectReadouts.flow.textContent = `VEL ${motionLevel.toFixed(3)}`;
    effectReadouts.triangulation.textContent = `TRI ${String(delaunayTriangles.length).padStart(3, "0")}`;
    effectReadouts.pixelsort.textContent = `CUT ${(68 + Math.sin(tickCount * 0.018) * 24).toFixed(0)}`;
    effectReadouts.reaction.textContent = `B ${motionLevel.toFixed(3)}`;
    effectReadouts.hdbeads.textContent = "GRID 04";
    effectReadouts.beads.textContent = "CELL 08";
    effectReadouts.rings.textContent = `FREQ ${(0.5 + intensity * 0.15).toFixed(2)}`;
    effectReadouts.ascii.textContent = `GLYPH ${String(views.ascii.glyphCount || 0).padStart(3, "0")}`;
  }

  function renderSignalMap(frame, time) {
    const width = signalMap.width;
    const height = signalMap.height;
    signalCtx.fillStyle = paletteStyle("feedback", 0.02);
    signalCtx.fillRect(0, 0, width, height);
    const points = signalNodes.map((node, index) => {
      const lum = lumaAt(frame.data, node.sampleX, node.sampleY) / 255;
      return {
        x: node.x,
        y: height * 0.5 + Math.sin(time * 1.7 + node.phase) * (8 + lum * 18) + (lum - 0.5) * 28,
        lum,
        index,
      };
    });
    signalCtx.lineWidth = 1;
    for (let i = 0; i < points.length - 1; i += 1) {
      const point = points[i];
      const next = points[i + 1];
      signalCtx.strokeStyle = paletteStyle("feedback", (point.lum + next.lum) * 0.5 + 0.18, 0.16 + motionLevel * 0.7);
      signalCtx.beginPath();
      signalCtx.moveTo(point.x, point.y);
      signalCtx.lineTo(next.x, next.y);
      signalCtx.stroke();
      if (i % 3 === 0 && i + 4 < points.length) {
        const distant = points[i + 4];
        signalCtx.strokeStyle = paletteStyle("feedback", point.lum + 0.12, 0.08);
        signalCtx.beginPath();
        signalCtx.moveTo(point.x, point.y);
        signalCtx.lineTo(distant.x, distant.y);
        signalCtx.stroke();
      }
    }
    for (const point of points) {
      signalCtx.fillStyle = paletteStyle("feedback", point.lum + 0.25, 0.45 + point.lum * 0.45);
      signalCtx.fillRect(point.x - 1.5, point.y - 1.5, 3, 3);
    }
    renderBurstOverlay(signalCtx, width, height, time, burstEnergy, 8);
    if (wireframeMode) renderWireframeChoreography(signalCtx, width, height, time, 11, 0.42);
  }

  function renderWireframeChoreography(ctx, width, height, time, variant, opacity = 1) {
    const phase = time * 1.75 + variant * 0.83;
    const cx = width * (0.5 + Math.sin(time * 0.56 + variant) * 0.035);
    const scale = Math.min(width / 360, height / 240) * 0.92;
    const point = (x, y) => ({ x: cx + x * scale, y: height * 0.51 + y * scale });
    const sway = Math.sin(phase) * 11;
    const lift = Math.cos(phase * 1.2) * 9;
    const body = {
      head: point(0, -76 + lift * 0.18),
      neck: point(0, -51 + lift * 0.12),
      shoulderL: point(-26, -44 + sway * 0.08),
      shoulderR: point(26, -44 - sway * 0.08),
      elbowL: point(-52, -18 - lift * 0.15),
      elbowR: point(53, -13 + lift * 0.14),
      wristL: point(-84, -37 - sway * 0.25),
      wristR: point(84, -50 + sway * 0.22),
      hipL: point(-19, 18),
      hipR: point(19, 18),
      kneeL: point(-31, 60 + lift * 0.14),
      kneeR: point(34, 57 - lift * 0.12),
      ankleL: point(-43, 98),
      ankleR: point(49, 96),
    };
    const limbPairs = [
      [body.shoulderL, body.elbowL], [body.elbowL, body.wristL], [body.shoulderR, body.elbowR], [body.elbowR, body.wristR],
      [body.shoulderL, body.hipL], [body.shoulderR, body.hipR], [body.hipL, body.hipR], [body.hipL, body.kneeL],
      [body.kneeL, body.ankleL], [body.hipR, body.kneeR], [body.kneeR, body.ankleR], [body.shoulderL, body.shoulderR],
    ];

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "square";
    ctx.lineWidth = Math.max(1, scale * 1.7);
    ctx.strokeStyle = `rgba(26, 231, 255, ${0.32 * opacity})`;
    for (const beam of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(beam < 0 ? -width * 0.08 : width * 1.08, height * (0.26 + Math.sin(phase) * 0.04));
      ctx.lineTo(cx + beam * width * 0.08, height * 0.5);
      ctx.lineTo(beam < 0 ? width * 1.08 : -width * 0.08, height * (0.74 - Math.sin(phase) * 0.04));
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(244, 255, 255, ${0.72 * opacity})`;
    ctx.lineWidth = Math.max(0.7, scale * 0.75);
    for (const [a, b] of limbPairs) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.strokeStyle = `rgba(117, 244, 255, ${0.5 * opacity})`;
    ctx.lineWidth = Math.max(0.6, scale * 0.5);
    for (let row = 1; row < 6; row += 1) {
      const t = row / 6;
      const left = { x: body.shoulderL.x + (body.hipL.x - body.shoulderL.x) * t, y: body.shoulderL.y + (body.hipL.y - body.shoulderL.y) * t };
      const right = { x: body.shoulderR.x + (body.hipR.x - body.shoulderR.x) * t, y: body.shoulderR.y + (body.hipR.y - body.shoulderR.y) * t };
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.stroke();
      if (row > 1) {
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x + Math.sin(row + phase) * scale * 8, right.y);
        ctx.stroke();
      }
    }
    for (let ring = 0; ring < 7; ring += 1) {
      const y = body.head.y - 17 * scale + ring * 5 * scale;
      const radius = Math.sin(((ring + 1) / 8) * Math.PI) * 18 * scale;
      ctx.beginPath();
      ctx.ellipse(body.head.x, y, radius, Math.max(1, radius * 0.22), 0, 0, TAU);
      ctx.stroke();
    }
    for (let arc = 0; arc < 8; arc += 1) {
      const angle = (arc / 8) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(body.head.x, body.head.y - 18 * scale);
      ctx.quadraticCurveTo(body.head.x + Math.cos(angle) * 24 * scale, body.head.y, body.head.x, body.head.y + 18 * scale);
      ctx.stroke();
    }
    for (const joint of Object.values(body)) {
      ctx.fillStyle = `rgba(216, 255, 255, ${0.7 * opacity})`;
      ctx.fillRect(joint.x - scale, joint.y - scale, scale * 2, scale * 2);
    }
    ctx.restore();
  }

  function renderBurstOverlay(ctx, width, height, time, energy, variant) {
    if (energy < 0.01) return;
    const elapsed = Math.max(0, time - burstStart * 0.001);
    const expansion = Math.min(1, elapsed / (burstDuration * 0.001));
    const spread = Math.pow(expansion, 0.48);
    const cx = width * (0.5 + Math.sin(variant * 1.9) * 0.06);
    const cy = height * (0.5 + Math.cos(variant * 1.3) * 0.07);
    const radius = Math.hypot(width, height) * (0.15 + spread * 0.84);
    const count = Math.max(34, Math.round(96 * energy));

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i += 1) {
      const seed = burstSeeds[(i * 3 + variant * 17) % burstSeeds.length];
      const distance = radius * seed.speed * (0.44 + i / count * 0.72);
      const wobble = Math.sin(time * 4 + i * 0.7) * 8 * energy;
      const x = cx + Math.cos(seed.angle + seed.drift * expansion * 1.8) * distance + wobble;
      const y = cy + Math.sin(seed.angle + seed.drift * expansion * 1.8) * distance + Math.cos(time * 3 + i) * 5 * energy;
      const tail = 8 + energy * 26;
      const hue = (seed.hue + time * 110 + variant * 29) % 360;
      ctx.strokeStyle = `hsla(${hue}, 100%, 68%, ${0.18 + energy * 0.62})`;
      ctx.lineWidth = 0.7 + (i % 3) * 0.45;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(seed.angle) * tail, y - Math.sin(seed.angle) * tail);
      ctx.lineTo(x, y);
      ctx.stroke();
      if (i % 2 === 0) {
        ctx.fillStyle = `hsla(${(hue + 42) % 360}, 100%, 76%, ${0.28 + energy * 0.68})`;
        ctx.fillRect(x - 1.4, y - 1.4, 2.8, 2.8);
      }
    }
    ctx.restore();
  }

  function updateBurst(timeMs) {
    const progress = (timeMs - burstStart) / burstDuration;
    burstEnergy = progress <= 0 || progress >= 1 ? 0 : Math.pow(1 - progress, 0.64) * Math.min(1, progress * 7);
    const active = burstEnergy > 0.01;
    document.body.classList.toggle("is-bursting", active);
    burstButton.classList.toggle("is-active", active);
    burstButton.textContent = active ? "色彩释放中" : "色彩爆发";
  }

  function triangulate(points) {
    const superTriangle = [
      { x: -W * 10, y: -H * 10 },
      { x: W * 10, y: -H * 10 },
      { x: W * 0.5, y: H * 10 },
    ];
    const all = points.concat(superTriangle);
    let triangles = [[points.length, points.length + 1, points.length + 2]];

    for (let pi = 0; pi < points.length; pi += 1) {
      const point = all[pi];
      const bad = [];
      const polygon = [];
      for (const tri of triangles) {
        if (inCircumcircle(point, all[tri[0]], all[tri[1]], all[tri[2]])) bad.push(tri);
      }
      for (const tri of bad) {
        for (const edge of [
          [tri[0], tri[1]],
          [tri[1], tri[2]],
          [tri[2], tri[0]],
        ]) {
          const existing = polygon.findIndex((candidate) => candidate[0] === edge[1] && candidate[1] === edge[0]);
          if (existing >= 0) polygon.splice(existing, 1);
          else polygon.push(edge);
        }
      }
      triangles = triangles.filter((tri) => !bad.includes(tri));
      for (const edge of polygon) triangles.push([edge[0], edge[1], pi]);
    }

    return triangles.filter((tri) => tri[0] < points.length && tri[1] < points.length && tri[2] < points.length);
  }

  function inCircumcircle(p, a, b, c) {
    const ax = a.x - p.x;
    const ay = a.y - p.y;
    const bx = b.x - p.x;
    const by = b.y - p.y;
    const cx = c.x - p.x;
    const cy = c.y - p.y;
    const det =
      (ax * ax + ay * ay) * (bx * cy - cx * by) -
      (bx * bx + by * by) * (ax * cy - cx * ay) +
      (cx * cx + cy * cy) * (ax * by - bx * ay);
    return det > 0;
  }

  function frame(timeMs) {
    const time = timeMs * 0.001;
    tickCount += 1;
    updateBurst(timeMs);
    renderSource(time);
    const frameData = sourceCtx.getImageData(0, 0, W, H);
    frames.push(frameData);
    if (frames.length > MAX_FRAMES) frames.shift();

    updateTelemetry(frameData, timeMs);
    renderSignalMap(frameData, time);
    renderFeedback(frameData, time);
    renderDisplacement(frameData, time);
    renderSlitscan(frameData, time);
    renderPointCloud(frameData, time);
    renderFlowParticles(frameData, time);
    renderTriangulation(frameData, time);
    renderPixelSort(frameData, time);
    renderReaction(frameData, time);
    renderHdBeads(frameData, time);
    renderBeads(frameData, time);
    renderRings(frameData, time);
    renderAscii(frameData, time);

    if (burstEnergy > 0.01) {
      renderBurstOverlay(sourceCtx, W, H, time, burstEnergy, 0);
      previewCtx.drawImage(sourceCanvas, 0, 0, sourcePreview.width, sourcePreview.height);
      overlayIds.forEach((id, index) => {
        const { canvas, ctx } = views[id];
        renderBurstOverlay(ctx, canvas.width, canvas.height, time, burstEnergy, index + 1);
      });
    }

    if (wireframeMode) {
      renderWireframeChoreography(sourceCtx, W, H, time, 0, 0.95);
      previewCtx.drawImage(sourceCanvas, 0, 0, sourcePreview.width, sourcePreview.height);
      overlayIds.forEach((id, index) => {
        const { canvas, ctx } = views[id];
        renderWireframeChoreography(ctx, canvas.width, canvas.height, time, index + 1, 0.82);
      });
    }

    lastFrame = frameData;
    requestAnimationFrame(frame);
  }

  renderSource(0);
  requestAnimationFrame(frame);
})();
