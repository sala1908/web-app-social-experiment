(() => {
  const canvas = document.getElementById("pixel-canvas");
  if (!canvas) {
    return;
  }

  const toolbar = document.getElementById("toolbar");
  const statusEl = document.getElementById("status");
  const usageEl = document.getElementById("usage");
  const paletteEl = document.getElementById("palette");
  const brushInput = document.getElementById("brush-size");
  const brushLabel = document.getElementById("brush-size-label");
  const activeColorInput = document.getElementById("active-color");
  const addColorBtn = document.getElementById("add-color");
  const adminResetCanvasBtn = document.getElementById("admin-reset-canvas");
  const adminResetLimitsBtn = document.getElementById("admin-reset-limits");

  const cfg = window.APP_CONFIG || { gridSize: 1024, maxBrushSize: 5 };
  const authenticated = Boolean(window.APP_AUTHENTICATED);
  const isAdmin = Boolean(window.APP_IS_ADMIN);
  const ctx = canvas.getContext("2d");
  const pixels = new Map();

  const state = {
    mode: "paint",
    brushSize: 1,
    activeColor: "#000000",
    palette: [],
    scale: 8,
    minScale: 0.5,
    maxScale: 48,
    offsetX: 10,
    offsetY: 10,
    panning: false,
    panStartX: 0,
    panStartY: 0,
    drawing: false,
    lastPaintKey: "",
    remainingPaints: null
  };

  let socket = null;
  let paintInFlight = false;
  let queuedPaint = null;
  let lastPaintSentAt = 0;

  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#b42318" : "#3f6b38";
  }

  function updateUsage() {
    if (isAdmin) {
      usageEl.textContent = "Admin mode: unlimited paints.";
      return;
    }

    if (!authenticated) {
      usageEl.textContent = "Guest mode: painting enabled.";
      return;
    }

    if (typeof state.remainingPaints === "number") {
      usageEl.textContent = `Paints remaining today: ${state.remainingPaints}`;
    }
  }

  function keyFor(x, y) {
    return `${x},${y}`;
  }

  function setPixel(x, y, color) {
    const key = keyFor(x, y);
    if (!color) {
      pixels.delete(key);
    } else {
      pixels.set(key, color);
    }
  }

  function applyModifiedPixels(modifiedPixels) {
    modifiedPixels.forEach((pixel) => {
      setPixel(pixel.x, pixel.y, pixel.color_hex);
    });
    draw();
  }

  function applyOptimisticPaint(x, y) {
  const offset = -Math.floor((state.brushSize - 1) / 2);

  for (let row = 0; row < state.brushSize; row += 1) {
    for (let col = 0; col < state.brushSize; col += 1) {
      const px = x + offset + col;
      const py = y + offset + row;

      if (px < 0 || px >= cfg.gridSize || py < 0 || py >= cfg.gridSize) {
        continue;
      }

      if (state.mode === "erase") {
        setPixel(px, py, null);
      } else {
        setPixel(px, py, state.activeColor);
      }
    }
  }

  draw();
}

  function screenToGrid(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left - state.offsetX) / state.scale;
    const y = (clientY - rect.top - state.offsetY) / state.scale;
    return {
      x: Math.floor(x),
      y: Math.floor(y)
    };
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const shell = document.querySelector(".canvas-shell");
    const w = shell.clientWidth;
    const h = shell.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#e6decb";
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(state.offsetX, state.offsetY);
    ctx.scale(state.scale, state.scale);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cfg.gridSize, cfg.gridSize);

    for (const [xy, color] of pixels.entries()) {
      const [x, y] = xy.split(",").map(Number);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }

    if (state.scale >= 12) {
      ctx.strokeStyle = "rgba(0, 0, 0, 0.06)";
      ctx.lineWidth = 1 / state.scale;

      for (let i = 0; i <= cfg.gridSize; i += 1) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, cfg.gridSize);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(cfg.gridSize, i);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  async function loadCanvas() {
    const response = await fetch("/api/canvas");
    const payload = await response.json();

    pixels.clear();
    payload.pixels.forEach((pixel) => {
      setPixel(pixel.x, pixel.y, pixel.color_hex);
    });

    draw();
  }

  async function loadPalette() {
    const response = await fetch("/api/palette");
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    state.palette = payload.palette;
    renderPalette();
  }

  async function loadLimits() {
    const response = await fetch("/api/me/limits");
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    state.remainingPaints = payload.remainingPaints;
    updateUsage();
  }

  function renderPalette() {
    paletteEl.innerHTML = "";
    state.palette.forEach((entry) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "palette-swatch";
      if (entry.color_hex.toUpperCase() === state.activeColor.toUpperCase()) {
        swatch.classList.add("active");
      }
      swatch.style.backgroundColor = entry.color_hex;
      swatch.title = `${entry.color_hex} (${entry.scope})`;
      swatch.addEventListener("click", () => {
        state.activeColor = entry.color_hex;
        activeColorInput.value = entry.color_hex;
        renderPalette();
      });
      paletteEl.appendChild(swatch);
    });
  }

  async function sendPaint(x, y) {
    const response = await fetch("/api/paint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x,
        y,
        mode: state.mode,
        brushSize: state.brushSize,
        color: state.activeColor
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      setStatus(payload.error || "Paint request failed.", true);
      return false;
    }

    state.remainingPaints = payload.remainingPaints;
    applyModifiedPixels(payload.modifiedPixels);
    updateUsage();
    return true;
  }

  async function enqueuePaint(x, y) {
  const dedupeKey = `${x}:${y}:${state.mode}:${state.brushSize}:${state.activeColor}`;
  if (state.lastPaintKey === dedupeKey) {
    return;
  }

  const now = Date.now();
  if (now - lastPaintSentAt < 40) {
    queuedPaint = { x, y, dedupeKey };
    return;
  }

  if (paintInFlight) {
    queuedPaint = { x, y, dedupeKey };
    return;
  }

  state.lastPaintKey = dedupeKey;
  lastPaintSentAt = now;
  paintInFlight = true;

  try {
    await sendPaint(x, y);
  } catch {
    setStatus("Paint request failed.", true);
  } finally {
    paintInFlight = false;
  }

  if (queuedPaint) {
    const next = queuedPaint;
    queuedPaint = null;
    await enqueuePaint(next.x, next.y);
  }
}

  function connectSocket() {
    socket = window.io();
    socket.on("paint_applied", (event) => {
      if (!event || !Array.isArray(event.modifiedPixels)) {
        return;
      }
      applyModifiedPixels(event.modifiedPixels);
    });

    socket.on("canvas_reset", () => {
      pixels.clear();
      draw();
      setStatus("Canvas was reset by admin.");
    });
  }

  function bindEvents() {
    window.addEventListener("resize", resizeCanvas);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;

      const worldX = (mx - state.offsetX) / state.scale;
      const worldY = (my - state.offsetY) / state.scale;

      const factor = event.deltaY < 0 ? 1.15 : 0.85;
      state.scale = Math.max(state.minScale, Math.min(state.maxScale, state.scale * factor));

      state.offsetX = mx - worldX * state.scale;
      state.offsetY = my - worldY * state.scale;
      draw();
    });

    canvas.addEventListener("mousedown", (event) => {
      if (event.button === 2) {
        state.panning = true;
        state.panStartX = event.clientX - state.offsetX;
        state.panStartY = event.clientY - state.offsetY;
        return;
      }

      if (event.button !== 0) {
        return;
      }

      state.drawing = true;
      const point = screenToGrid(event.clientX, event.clientY);
      applyOptimisticPaint(point.x, point.y);
      enqueuePaint(point.x, point.y);
    });

    window.addEventListener("mousemove", (event) => {
      if (state.panning) {
        state.offsetX = event.clientX - state.panStartX;
        state.offsetY = event.clientY - state.panStartY;
        draw();
        return;
      }

      if (state.drawing) {
        const point = screenToGrid(event.clientX, event.clientY);
        applyOptimisticPaint(point.x, point.y);
        enqueuePaint(point.x, point.y);
      }
    });

    window.addEventListener("mouseup", () => {
      state.panning = false;
      state.drawing = false;
      state.lastPaintKey = "";
    });

    toolbar.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        state.mode = button.getAttribute("data-mode");
        toolbar.querySelectorAll("[data-mode]").forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");
      });
    });

    brushInput.addEventListener("input", () => {
      state.brushSize = Number(brushInput.value);
      brushLabel.textContent = String(state.brushSize);
    });

    activeColorInput.addEventListener("input", () => {
      state.activeColor = activeColorInput.value.toUpperCase();
      renderPalette();
    });

    addColorBtn.addEventListener("click", async () => {
      if (!authenticated) {
        setStatus("Login required to change palette.", true);
        return;
      }

      const response = await fetch("/api/palette", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: state.activeColor })
      });

      if (!response.ok) {
        const payload = await response.json();
        setStatus(payload.error || "Unable to add color.", true);
        return;
      }

      await loadPalette();
      setStatus("Color added to your palette.");
    });

    if (adminResetCanvasBtn) {
      adminResetCanvasBtn.addEventListener("click", async () => {
        const response = await fetch("/api/admin/reset-canvas", {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        });

        if (!response.ok) {
          const payload = await response.json();
          setStatus(payload.error || "Unable to reset canvas.", true);
          return;
        }

        pixels.clear();
        draw();
        setStatus("Canvas reset complete.");
      });
    }

    if (adminResetLimitsBtn) {
      adminResetLimitsBtn.addEventListener("click", async () => {
        const response = await fetch("/api/admin/reset-daily-limit", {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        });

        if (!response.ok) {
          const payload = await response.json();
          setStatus(payload.error || "Unable to reset daily limit.", true);
          return;
        }

        setStatus("Daily limits reset.");
      });
    }
  }

  async function init() {
    bindEvents();
    resizeCanvas();
    await loadCanvas();

    if (authenticated) {
      await loadPalette();
      await loadLimits();
    }

    connectSocket();
    updateUsage();
  }

  init().catch(() => {
    setStatus("Failed to initialize canvas.", true);
  });
})();
