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
    lastDragPoint: null,
    remainingPaints: null
  };

  let socket = null;
  let pendingPixels = new Map();
  let batchRequestInFlight = false;
  let batchFlushTimer = null;
  let inflightPixels = new Map();

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
      usageEl.textContent = typeof state.remainingPaints === "number"
        ? `Pixels left today: ${state.remainingPaints}`
        : "Guest mode: painting enabled.";
      return;
    }

    if (typeof state.remainingPaints === "number") {
      usageEl.textContent = `Paints remaining today: ${state.remainingPaints}`;
    }
  }

  function keyFor(x, y) {
    return `${x},${y}`;
  }

  function setPixel(x, y, color, ownerId = null, ownerTag = null) {
    const key = keyFor(x, y);
    if (!color) {
      pixels.delete(key);
    } else {
      pixels.set(key, {
        color,
        ownerId,
        ownerTag
      });
    }
  }

  function applyQueuedPixel(pixel) {
    if (pixel.mode === "erase") {
      setPixel(pixel.x, pixel.y, null);
    } else {
      setPixel(pixel.x, pixel.y, pixel.color, pixel.ownerId ?? null, pixel.ownerTag ?? null);
    }
  }

  function applyModifiedPixels(modifiedPixels) {
    modifiedPixels.forEach((pixel) => {
      setPixel(
        pixel.x,
        pixel.y,
        pixel.color_hex,
        pixel.owner_id ?? null,
        pixel.owner_tag ?? null
      );
    });

    reapplyPendingPixels();
    draw();
  }

  function flushBeforeToolChange() {
    if (pendingPixels.size > 0) {
      flushPaintBatch();
    }
  }

  function getLocalOwnerTag() {
    if (isAdmin) {
      return "Admin";
    }

    if (authenticated) {
      return "You";
    }

    return "Guest";
  }

  function queueBrushChange(x, y) {
    const offset = -Math.floor((state.brushSize - 1) / 2);

    for (let row = 0; row < state.brushSize; row += 1) {
      for (let col = 0; col < state.brushSize; col += 1) {
        const px = x + offset + col;
        const py = y + offset + row;
        queuePixelChange(px, py);
      }
    }

    draw();
  }

  function queuePixelChange(x, y) {
    if (x < 0 || x >= cfg.gridSize || y < 0 || y >= cfg.gridSize) {
      return;
    }

    const key = keyFor(x, y);
    const queuedPixel = {
      x,
      y,
      mode: state.mode,
      color: state.activeColor,
      ownerId: null,
      ownerTag: getLocalOwnerTag()
    };

    pendingPixels.set(key, queuedPixel);
    applyQueuedPixel(queuedPixel);

    if (pendingPixels.size >= 100) {
      flushPaintBatch();
      return;
    }

    if (!batchFlushTimer) {
      batchFlushTimer = window.setTimeout(() => {
        flushPaintBatch();
      }, 50);
    }
  }

  function reapplyPendingPixels() {
    for (const pixel of inflightPixels.values()) {
      applyQueuedPixel(pixel);
    }

    for (const pixel of pendingPixels.values()) {
      applyQueuedPixel(pixel);
    }
  }

  async function flushPaintBatch() {
    if (batchRequestInFlight) {
      return;
    }

    if (batchFlushTimer) {
      clearTimeout(batchFlushTimer);
      batchFlushTimer = null;
    }

    if (pendingPixels.size === 0) {
      return;
    }

    inflightPixels = pendingPixels;
    pendingPixels = new Map();

    const points = Array.from(inflightPixels.values()).map((p) => ({
      x: p.x,
      y: p.y
    }));

    batchRequestInFlight = true;

    try {
      const response = await fetch("/api/paint-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          points,
          mode: state.mode,
          brushSize: 1,
          color: state.activeColor
        })
      });

      const payload = await response.json();

      if (!response.ok) {
        setStatus(payload.error || "Paint batch failed.", true);
        await loadCanvas();
        inflightPixels = new Map();
        return;
      }

      state.remainingPaints = payload.remainingPaints;
      applyModifiedPixels(payload.modifiedPixels);
      updateUsage();
      inflightPixels = new Map();
    } catch {
      setStatus("Paint batch failed.", true);
      await loadCanvas();
      inflightPixels = new Map();
    } finally {
      batchRequestInFlight = false;

      if (pendingPixels.size > 0) {
        flushPaintBatch();
      }
    }
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

  function getLinePoints(startX, startY, endX, endY) {
    const points = [];

    let x = startX;
    let y = startY;

    const dx = Math.abs(endX - startX);
    const dy = Math.abs(endY - startY);

    const sx = startX < endX ? 1 : -1;
    const sy = startY < endY ? 1 : -1;

    let err = dx - dy;

    while (true) {
      points.push({ x, y });

      if (x === endX && y === endY) {
        break;
      }

      const e2 = err * 2;

      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }

      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }

    return points;
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

    for (const [xy, pixel] of pixels.entries()) {
      const [x, y] = xy.split(",").map(Number);
      ctx.fillStyle = pixel.color;
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
      setPixel(
        pixel.x,
        pixel.y,
        pixel.color_hex,
        pixel.owner_id ?? null,
        pixel.owner_tag ?? null
      );
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

    if (state.palette.length > 0 && !state.palette.some((entry) => entry.color_hex.toUpperCase() === state.activeColor.toUpperCase())) {
      state.activeColor = state.palette[0].color_hex.toUpperCase();
    }

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
        state.activeColor = entry.color_hex.toUpperCase();
        if (activeColorInput) {
          activeColorInput.value = entry.color_hex;
        }
        renderPalette();
      });

      paletteEl.appendChild(swatch);
    });

    if (activeColorInput) {
      activeColorInput.value = state.activeColor;
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
      flushBeforeToolChange();

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
      state.lastDragPoint = point;
      queueBrushChange(point.x, point.y);
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

        if (!state.lastDragPoint) {
          state.lastDragPoint = point;
        }

        const linePoints = getLinePoints(
          state.lastDragPoint.x,
          state.lastDragPoint.y,
          point.x,
          point.y
        );

        for (const p of linePoints) {
          queueBrushChange(p.x, p.y);
        }

        state.lastDragPoint = point;
      }
    });

    window.addEventListener("mouseup", () => {
      state.panning = false;
      state.drawing = false;
      state.lastDragPoint = null;
      state.lastPaintKey = "";
      flushPaintBatch();
    });

    toolbar.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        flushBeforeToolChange();
        state.mode = button.getAttribute("data-mode");
        toolbar.querySelectorAll("[data-mode]").forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");
      });
    });

    brushInput.addEventListener("input", () => {
      flushBeforeToolChange();
      state.brushSize = Number(brushInput.value);
      brushLabel.textContent = String(state.brushSize);
    });

    if (activeColorInput) {
      activeColorInput.addEventListener("input", () => {
        flushBeforeToolChange();
        state.activeColor = activeColorInput.value.toUpperCase();
        renderPalette();
      });
    }

    if (addColorBtn) {
      addColorBtn.addEventListener("click", async () => {
        setStatus("Custom colors are disabled. Choose from swatches.", true);
      });
    }

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
    await loadPalette();
    await loadLimits();
    connectSocket();
    updateUsage();
  }

  init().catch(() => {
    setStatus("Failed to initialize canvas.", true);
  });
})();