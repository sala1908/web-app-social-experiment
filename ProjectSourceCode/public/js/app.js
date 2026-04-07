(() => {
  const canvas = document.getElementById("pixel-canvas");
  if (!canvas) {
    return;
  }

  const toolbar = document.getElementById("toolbar");
  const statusEl = document.getElementById("status");
  const pixelCountEl = document.getElementById("pixel-count");
  const usageEl = document.getElementById("usage");
  const paletteEl = document.getElementById("palette");
  const brushInput = document.getElementById("brush-size");
  const brushLabel = document.getElementById("brush-size-label");
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
    remainingPaints: null,
    hoveredGroup: null,
    playerColors: {} // Map of player tags to colors
  };

  let socket = null;
  let paintQueue = Promise.resolve();

  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#b42318" : "#3f6b38";
  }

  function updateUsage() {
    if (isAdmin) {
      pixelCountEl.textContent = "Pixels left: unlimited";
      usageEl.textContent = "Admin mode: unlimited paints.";
      return;
    }

    if (!authenticated) {
      pixelCountEl.textContent = typeof state.remainingPaints === "number"
        ? `Pixels left today: ${state.remainingPaints}`
        : "Pixels left today: ...";
      usageEl.textContent = "Guest mode: painting enabled.";
      return;
    }

    if (typeof state.remainingPaints === "number") {
      pixelCountEl.textContent = `Pixels left today: ${state.remainingPaints}`;
      usageEl.textContent = `Paints remaining today: ${state.remainingPaints}`;
    }
  }

  function keyFor(x, y) {
    return `${x},${y}`;
  }

  function setPixel(x, y, color, ownerId, ownerTag) {
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

  function applyModifiedPixels(modifiedPixels) {
    modifiedPixels.forEach((pixel) => {
      setPixel(pixel.x, pixel.y, pixel.color_hex, pixel.owner_id, pixel.owner_tag);
    });
    draw();
  }

  function computeTaggedGroups() {
    const byOwner = new Map();

    for (const [xy, pixel] of pixels.entries()) {
      if (!pixel || !pixel.ownerTag) {
        continue;
      }

      if (!pixel.ownerId && pixel.ownerTag !== "~Admin~" && pixel.ownerTag !== "Guest") {
        continue;
      }

      const ownerKey = pixel.ownerTag === "~Admin~"
        ? "__ADMIN__"
        : pixel.ownerTag === "Guest"
          ? "__GUEST__"
          : String(pixel.ownerId);
      if (!byOwner.has(ownerKey)) {
        byOwner.set(ownerKey, {
          tag: pixel.ownerTag,
          cells: new Set()
        });
      }

      byOwner.get(ownerKey).cells.add(xy);
    }

    const groups = [];
    const neighbors = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ];

    for (const ownerData of byOwner.values()) {
      const seen = new Set();

      for (const start of ownerData.cells) {
        if (seen.has(start)) {
          continue;
        }

        let size = 0;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        const cells = new Set();
        const stack = [start];

        while (stack.length > 0) {
          const current = stack.pop();
          if (seen.has(current) || !ownerData.cells.has(current)) {
            continue;
          }

          seen.add(current);
          const [x, y] = current.split(",").map(Number);
          size += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          cells.add(current);

          for (const [dx, dy] of neighbors) {
            const nextKey = keyFor(x + dx, y + dy);
            if (!seen.has(nextKey) && ownerData.cells.has(nextKey)) {
              stack.push(nextKey);
            }
          }
        }

        if (size >= 1) {
          groups.push({
            id: start,
            tag: ownerData.tag,
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
            cells
          });
        }
      }
    }

    return groups;
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

  function getRandomColor() {
    const letters = "0123456789ABCDEF";
    let color = "#";
    for (let i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  }

  function getPlayerLabelColor(tag) {
    if (!state.playerColors[tag]) {
      state.playerColors[tag] = getRandomColor();
    }
    return state.playerColors[tag];
  }

  function getKeyForColorIndex(index) {
    // Map color index to keyboard key
    // 0-8 -> 1-9
    // 9 -> 0
    // 10-19 -> Q, W, E, R, T, Y, U, I, O, P
    if (index < 9) {
      return String(index + 1); // 1-9
    } else if (index === 9) {
      return "0";
    } else if (index < 20) {
      const qwertyKeys = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"];
      return qwertyKeys[index - 10];
    }
    return null; // No key for 20+ colors
  }

  function getColorIndexForKey(key) {
    // Reverse mapping from key to color index
    const num = parseInt(key, 10);
    if (!isNaN(num)) {
      if (num === 0) return 9;
      if (num >= 1 && num <= 9) return num - 1;
    }
    const qwertyKeys = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"];
    const qIndex = qwertyKeys.indexOf(key.toLowerCase());
    if (qIndex !== -1) {
      return 10 + qIndex;
    }
    return -1;
  }

  function getHoveredGroup(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    
    // Convert mouse position to grid coordinates
    const gridX = (clientX - rect.left - state.offsetX) / state.scale;
    const gridY = (clientY - rect.top - state.offsetY) / state.scale;
    
    // Check if grid position is in bounds
    if (gridX < 0 || gridX >= cfg.gridSize || gridY < 0 || gridY >= cfg.gridSize) {
      return null;
    }
    
    // Get pixel at grid position
    const key = keyFor(Math.floor(gridX), Math.floor(gridY));
    const pixel = pixels.get(key);

    if (!pixel || !pixel.ownerTag) {
      return null;
    }

    const groups = computeTaggedGroups();
    const group = groups.find((entry) => entry.tag === pixel.ownerTag && entry.cells.has(key));

    if (group) {
      return group;
    }

    return null;
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

    // Only draw the hovered group's label
    if (state.hoveredGroup) {
      ctx.save();
      ctx.font = "bold 12px Trebuchet MS, Segoe UI, sans-serif";
      ctx.textBaseline = "bottom";

      const screenX = state.offsetX + state.hoveredGroup.x * state.scale + 4;
      const screenY = state.offsetY + state.hoveredGroup.y * state.scale - 4;
      const labelColor = getPlayerLabelColor(state.hoveredGroup.tag);

      ctx.lineWidth = 3;
      ctx.strokeStyle = "#fffdf7";
      ctx.fillStyle = labelColor;
      ctx.strokeText(state.hoveredGroup.tag, screenX, screenY);
      ctx.fillText(state.hoveredGroup.tag, screenX, screenY);

      ctx.restore();
    }
  }

  async function loadCanvas() {
    const response = await fetch("/api/canvas");
    const payload = await response.json();

    pixels.clear();
    payload.pixels.forEach((pixel) => {
      setPixel(pixel.x, pixel.y, pixel.color_hex, pixel.owner_id, pixel.owner_tag);
    });

    draw();
  }

  async function loadPalette() {
    const response = await fetch("/api/palette");
    if (!response.ok) {
      setStatus("Unable to load color swatches.", true);
      return;
    }

    const payload = await response.json();
    state.palette = payload.palette;
    if (state.palette.length > 0) {
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
    state.palette.forEach((entry, index) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "palette-swatch";
      if (entry.color_hex.toUpperCase() === state.activeColor.toUpperCase()) {
        swatch.classList.add("active");
      }
      swatch.style.backgroundColor = entry.color_hex;
      
      // Get keyboard key for this color
      const keyLabel = getKeyForColorIndex(index);
      swatch.title = `${entry.color_hex} (${entry.scope})${keyLabel ? ` - Press ${keyLabel.toUpperCase()}` : ""}`;
      
      if (keyLabel) {
        swatch.innerHTML = `<span class="color-key">${keyLabel.toUpperCase()}</span>`;
      }
      
      swatch.addEventListener("click", () => {
        state.activeColor = entry.color_hex;
        renderPalette();
      });
      paletteEl.appendChild(swatch);
    });
  }

  async function enqueuePaint(x, y) {
    const dedupeKey = `${x}:${y}:${state.mode}:${state.brushSize}:${state.activeColor}`;
    if (state.lastPaintKey === dedupeKey) {
      return;
    }
    state.lastPaintKey = dedupeKey;

    paintQueue = paintQueue.then(async () => {
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
        return;
      }

      state.remainingPaints = payload.remainingPaints;
      applyModifiedPixels(payload.modifiedPixels);
      updateUsage();
    }).catch(() => {
      setStatus("Paint request failed.", true);
    });
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

    canvas.addEventListener("mouseleave", () => {
      state.hoveredGroup = null;
      draw();
    });

    // Scroll wheel changes brush size
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      
      // Change brush size with scroll
      const delta = event.deltaY < 0 ? 1 : -1;
      const newSize = Math.max(1, Math.min(cfg.maxBrushSize, state.brushSize + delta));
      state.brushSize = newSize;
      brushInput.value = newSize;
      brushLabel.textContent = String(newSize);
    });

    // Keyboard controls for zoom and color selection
    window.addEventListener("keydown", (event) => {
      // +/- for zoom
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = rect.width / 2;
        const my = rect.height / 2;
        const worldX = (mx - state.offsetX) / state.scale;
        const worldY = (my - state.offsetY) / state.scale;
        state.scale = Math.max(state.minScale, Math.min(state.maxScale, state.scale * 1.15));
        state.offsetX = mx - worldX * state.scale;
        state.offsetY = my - worldY * state.scale;
        draw();
        return;
      }

      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = rect.width / 2;
        const my = rect.height / 2;
        const worldX = (mx - state.offsetX) / state.scale;
        const worldY = (my - state.offsetY) / state.scale;
        state.scale = Math.max(state.minScale, Math.min(state.maxScale, state.scale * 0.85));
        state.offsetX = mx - worldX * state.scale;
        state.offsetY = my - worldY * state.scale;
        draw();
        return;
      }

      // Color selection with number (0-9) and QWERTY keys
      const colorIndex = getColorIndexForKey(event.key);
      if (colorIndex >= 0 && colorIndex < state.palette.length) {
        state.activeColor = state.palette[colorIndex].color_hex;
        renderPalette();
      }
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
        enqueuePaint(point.x, point.y);
      }

      // Track hovered group
      const hovered = getHoveredGroup(event.clientX, event.clientY);
      if (hovered?.id !== state.hoveredGroup?.id) {
        state.hoveredGroup = hovered || null;
        draw();
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

    updateUsage();
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
