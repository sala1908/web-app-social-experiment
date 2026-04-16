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
  const interactionBackdrop = document.getElementById("interaction-backdrop");
  const interactionModal = document.getElementById("interaction-modal");
  const interactionTitle = document.getElementById("interaction-title");
  const interactionSummary = document.getElementById("interaction-summary");
  const interactionClose = document.getElementById("interaction-close");
  const interactionAuthLinks = document.getElementById("interaction-auth-links");
  const adminResetCanvasBtn = document.getElementById("admin-reset-canvas");
  const adminResetLimitsBtn = document.getElementById("admin-reset-limits");

  const cfg = window.APP_CONFIG || { gridSize: 1024, maxBrushSize: 5 };
  let isAdmin = window.APP_IS_ADMIN === true
    || String(window.APP_IS_ADMIN).toLowerCase() === "true"
    || Boolean(window.APP_USER && window.APP_USER.isAdmin)
    || (window.APP_USER && String(window.APP_USER.username || "").toLowerCase() === "admin");
  let authenticated = isAdmin
    || window.APP_AUTHENTICATED === true
    || String(window.APP_AUTHENTICATED).toLowerCase() === "true"
    || (toolbar && toolbar.dataset && String(toolbar.dataset.authenticated).toLowerCase() === "true")
    || Boolean(window.APP_USER && window.APP_USER.id);
  let viewerRole = isAdmin ? "admin" : authenticated ? "user" : "guest";
  let currentUser = window.APP_USER || null;

  const ctx = canvas.getContext("2d");
  const pixels = new Map();

  function applyViewerStateFromUser(user, authFlag) {
    currentUser = user || null;
    const serverAdmin = Boolean(user && user.isAdmin);
    const serverAuthenticated = Boolean(authFlag || serverAdmin || (user && user.id));
    isAdmin = serverAdmin || isAdmin;
    authenticated = serverAuthenticated;
    viewerRole = isAdmin ? "admin" : authenticated ? "user" : "guest";
  }

  async function refreshViewerState() {
    try {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      applyViewerStateFromUser(payload.user || null, Boolean(payload.authenticated));
    } catch {
      // Keep local role state when /api/me is unavailable.
    }
  }

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
    remainingPaints: null,
    ctrlPressed: false,
    pendingTitle: null,
    hoveredGroup: null,
    interactionGroup: null,
    groups: [],
    playerColors: {}
  };

  let socket = null;
  let pendingPixels = new Map();
  let batchRequestInFlight = false;
  let batchFlushTimer = null;
  let inflightPixels = new Map();
  let drawScheduled = false;

  function scheduleDraw() {
    if (drawScheduled) {
      return;
    }

    drawScheduled = true;
    window.requestAnimationFrame(() => {
      drawScheduled = false;
      draw();
    });
  }

  function setStatus(message, isError = false) {
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.style.color = isError ? "#b42318" : "#3f6b38";
    }
  }

  function updateUsage() {
    if (isAdmin) {
      if (pixelCountEl) {
        pixelCountEl.textContent = "Pixels left: unlimited";
      }
      if (usageEl) {
        usageEl.textContent = "Admin mode: unlimited paints.";
      }
      return;
    }

    if (!authenticated) {
      if (pixelCountEl) {
        pixelCountEl.textContent = typeof state.remainingPaints === "number"
          ? `Pixels left today: ${state.remainingPaints}`
          : "Pixels left today: ...";
      }
      if (usageEl) {
        usageEl.textContent = "Guest mode: painting enabled.";
      }
      return;
    }

    if (typeof state.remainingPaints === "number") {
      if (pixelCountEl) {
        pixelCountEl.textContent = `Pixels left today: ${state.remainingPaints}`;
      }
      if (usageEl) {
        usageEl.textContent = `Paints remaining today: ${state.remainingPaints}`;
      }
    }
  }

  function keyFor(x, y) {
    return `${x},${y}`;
  }

  function normalizeDisplayName(value) {
    const text = String(value || "").trim();
    if (!text) {
      return "Guest";
    }

    if (text === "~Admin~" || text.toLowerCase() === "admin") {
      return "Admin";
    }

    return text;
  }

  function getOwnershipKey(ownerId, ownerTag) {
    const displayName = String(ownerTag || "").toLowerCase();
    if (displayName === "admin" || displayName === "~admin~") {
      return "__ADMIN__";
    }

    if (ownerId) {
      return String(ownerId);
    }

    if (ownerTag === "Guest") {
      return "__GUEST__";
    }

    return null;
  }

  function setPixel(x, y, color, ownerId = null, ownerTag = null) {
    const key = keyFor(x, y);
    if (!color) {
      pixels.delete(key);
    } else {
      pixels.set(key, {
        color,
        ownerId,
        ownerTag: normalizeDisplayName(ownerTag)
      });
    }
  }

  function getActivePainterIdentity() {
    if (isAdmin) {
      return { ownerId: null, ownerTag: "Admin" };
    }

    if (authenticated && currentUser && currentUser.id) {
      const display = currentUser.username || (currentUser.email ? String(currentUser.email).split("@")[0] : "Guest");
      return { ownerId: Number(currentUser.id), ownerTag: normalizeDisplayName(display) };
    }

    return { ownerId: null, ownerTag: "Guest" };
  }

  function applyQueuedPixel(pixel) {
    if (pixel.mode === "erase") {
      setPixel(pixel.x, pixel.y, null, null, null);
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
    scheduleDraw();
  }

  function flushBeforeToolChange() {
    if (pendingPixels.size > 0) {
      flushPaintBatch();
    }
  }

  function buildBrushCellsForPoint(x, y, brushSize) {
    const cells = [];
    const offset = -Math.floor((brushSize - 1) / 2);

    for (let row = 0; row < brushSize; row += 1) {
      for (let col = 0; col < brushSize; col += 1) {
        const nextX = x + offset + col;
        const nextY = y + offset + row;
        if (nextX < 0 || nextX >= cfg.gridSize || nextY < 0 || nextY >= cfg.gridSize) {
          continue;
        }
        cells.push({ x: nextX, y: nextY });
      }
    }

    return cells;
  }

  function queueBrushChange(x, y) {
    const identity = getActivePainterIdentity();
    const cells = buildBrushCellsForPoint(x, y, state.brushSize);

    for (const cell of cells) {
      queuePixelChange(cell.x, cell.y, identity);
    }

    scheduleDraw();
  }

  function queuePixelChange(x, y, identity = null) {
    if (x < 0 || x >= cfg.gridSize || y < 0 || y >= cfg.gridSize) {
      return;
    }

    const painter = identity || getActivePainterIdentity();
    const key = keyFor(x, y);
    const queuedPixel = {
      x,
      y,
      mode: state.mode,
      color: state.activeColor,
      ownerId: state.mode === "erase" ? null : painter.ownerId,
      ownerTag: state.mode === "erase" ? null : painter.ownerTag
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

  function computeTaggedGroups() {
    const MERGE_DISTANCE = 5;
    const byOwner = new Map();

    for (const [xy, pixel] of pixels.entries()) {
      if (!pixel || !pixel.ownerTag) {
        continue;
      }

      const ownerKey = getOwnershipKey(pixel.ownerId, pixel.ownerTag);
      if (!ownerKey) {
        continue;
      }

      if (!byOwner.has(ownerKey)) {
        byOwner.set(ownerKey, {
          ownerKey,
          ownerId: pixel.ownerId || null,
          tag: pixel.ownerTag,
          cells: new Set()
        });
      }

      byOwner.get(ownerKey).cells.add(xy);
    }

    const neighbors = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ];

    function componentDistance(a, b) {
      const gapX = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
      const gapY = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
      return Math.hypot(gapX, gapY);
    }

    const groups = [];

    for (const ownerData of byOwner.values()) {
      const seen = new Set();
      const components = [];

      for (const start of ownerData.cells) {
        if (seen.has(start)) {
          continue;
        }

        let size = 0;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
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

          for (const [dx, dy] of neighbors) {
            const nextKey = keyFor(x + dx, y + dy);
            if (!seen.has(nextKey) && ownerData.cells.has(nextKey)) {
              stack.push(nextKey);
            }
          }
        }

        components.push({
          id: start,
          minX,
          minY,
          maxX,
          maxY,
          size
        });
      }

      if (components.length === 0) {
        continue;
      }

      const parent = components.map((_, index) => index);

      function find(index) {
        if (parent[index] !== index) {
          parent[index] = find(parent[index]);
        }
        return parent[index];
      }

      function union(aIndex, bIndex) {
        const aRoot = find(aIndex);
        const bRoot = find(bIndex);
        if (aRoot !== bRoot) {
          parent[bRoot] = aRoot;
        }
      }

      for (let i = 0; i < components.length; i += 1) {
        for (let j = i + 1; j < components.length; j += 1) {
          if (componentDistance(components[i], components[j]) <= MERGE_DISTANCE) {
            union(i, j);
          }
        }
      }

      const merged = new Map();
      for (let i = 0; i < components.length; i += 1) {
        const root = find(i);
        const component = components[i];

        if (!merged.has(root)) {
          merged.set(root, {
            id: component.id,
            minX: component.minX,
            minY: component.minY,
            maxX: component.maxX,
            maxY: component.maxY,
            size: component.size
          });
          continue;
        }

        const current = merged.get(root);
        current.minX = Math.min(current.minX, component.minX);
        current.minY = Math.min(current.minY, component.minY);
        current.maxX = Math.max(current.maxX, component.maxX);
        current.maxY = Math.max(current.maxY, component.maxY);
        current.size += component.size;
      }

      for (const mergedComp of merged.values()) {
        if (mergedComp.size < 3) {
          continue;
        }

        const width = mergedComp.maxX - mergedComp.minX + 1;
        const height = mergedComp.maxY - mergedComp.minY + 1;
        groups.push({
          id: mergedComp.id,
          ownerKey: ownerData.ownerKey,
          ownerId: ownerData.ownerId,
          tag: ownerData.tag,
          x: mergedComp.minX,
          y: mergedComp.minY,
          width,
          height,
          centerX: mergedComp.minX + width / 2,
          centerY: mergedComp.minY + height / 2,
          radius: Math.max(3, Math.ceil(Math.max(width, height) / 2) + 2),
          size: mergedComp.size
        });
      }
    }

    return groups;
  }

  function getRandomColor() {
    const letters = "0123456789ABCDEF";
    let color = "#";
    for (let i = 0; i < 6; i += 1) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  }

  function getPlayerLabelColor(tag) {
    if (String(tag || "").toLowerCase() === "admin") {
      return "#7CFF00";
    }

    if (!state.playerColors[tag]) {
      state.playerColors[tag] = getRandomColor();
    }
    return state.playerColors[tag];
  }

  function isPointInsideGroup(group, gridX, gridY) {
    const dx = gridX + 0.5 - group.centerX;
    const dy = gridY + 0.5 - group.centerY;
    return (dx * dx) + (dy * dy) <= group.radius * group.radius;
  }

  function isCurrentUserGroup(group) {
    if (group.ownerKey === "__ADMIN__") {
      return isAdmin;
    }

    if (authenticated && currentUser && group.ownerId) {
      return Number(currentUser.id) === Number(group.ownerId);
    }

    return false;
  }

  function getHoveredGroup(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const gridX = (clientX - rect.left - state.offsetX) / state.scale;
    const gridY = (clientY - rect.top - state.offsetY) / state.scale;

    if (gridX < 0 || gridX >= cfg.gridSize || gridY < 0 || gridY >= cfg.gridSize) {
      return null;
    }

    const groups = state.groups.length > 0 ? state.groups : computeTaggedGroups();
    const gridPointX = Math.floor(gridX);
    const gridPointY = Math.floor(gridY);

    return groups.find((entry) => {
      if (!isPointInsideGroup(entry, gridPointX, gridPointY)) {
        return false;
      }

      if (isCurrentUserGroup(entry) && !state.ctrlPressed) {
        return false;
      }

      return true;
    }) || null;
  }

  function getGroupAtGridPoint(gridX, gridY) {
    const groups = state.groups.length > 0 ? state.groups : computeTaggedGroups();

    return groups.find((entry) => {
      if (!isPointInsideGroup(entry, gridX, gridY)) {
        return false;
      }

      if (isCurrentUserGroup(entry) && !state.ctrlPressed) {
        return false;
      }

      return true;
    }) || null;
  }

  function tryOpenProtectedGroup(event) {
    const hoveredGroup = getHoveredGroup(event.clientX, event.clientY);
    if (!hoveredGroup) {
      return false;
    }

    const isOwn = isCurrentUserGroup(hoveredGroup);
    if (isOwn && !event.ctrlKey) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    state.drawing = false;
    state.hoveredGroup = hoveredGroup;
    scheduleDraw();
    return true;
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
    const groups = computeTaggedGroups();

    state.groups = groups;

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

    if (groups.length > 0) {
      ctx.save();
      ctx.lineWidth = 1 / state.scale;
      ctx.setLineDash([4 / state.scale, 3 / state.scale]);

      for (const group of groups) {
        if (isCurrentUserGroup(group) && !state.ctrlPressed) {
          continue;
        }

        ctx.beginPath();
        ctx.arc(group.centerX, group.centerY, group.radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(217, 95, 2, 0.06)";
        ctx.strokeStyle = state.hoveredGroup && state.hoveredGroup.id === group.id
          ? "rgba(217, 95, 2, 0.95)"
          : "rgba(217, 95, 2, 0.3)";
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
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

    if (state.hoveredGroup) {
      ctx.save();
      ctx.font = "bold 12px Trebuchet MS, Segoe UI, sans-serif";
      ctx.textBaseline = "bottom";

      const screenX = state.offsetX + state.hoveredGroup.centerX * state.scale;
      const screenY = state.offsetY + (state.hoveredGroup.centerY - state.hoveredGroup.radius - 0.8) * state.scale;
      const labelColor = getPlayerLabelColor(state.hoveredGroup.tag);
      const textWidth = ctx.measureText(state.hoveredGroup.tag).width;
      const badgeWidth = textWidth + 18;
      const badgeHeight = 22;

      ctx.fillStyle = "rgba(255, 253, 247, 0.98)";
      ctx.strokeStyle = "rgba(35, 26, 5, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(screenX - badgeWidth / 2, screenY - badgeHeight + 2, badgeWidth, badgeHeight);
      ctx.fill();
      ctx.stroke();

      ctx.lineWidth = 3;
      ctx.strokeStyle = "#fffdf7";
      ctx.fillStyle = labelColor;
      ctx.textAlign = "center";
      ctx.strokeText(state.hoveredGroup.tag, screenX, screenY);
      ctx.fillText(state.hoveredGroup.tag, screenX, screenY);

      ctx.restore();
    }

    canvas.style.cursor = state.hoveredGroup ? "pointer" : state.panning ? "grabbing" : "crosshair";
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

    scheduleDraw();
  }

  async function fetchInteractionContext(group) {
    if (!group) {
      return { isFriend: false, bubbleTitle: null };
    }

    const query = new URLSearchParams({
      targetUserId: group.ownerId || "",
      targetOwnerTag: group.tag || "",
      groupX: String(group.x),
      groupY: String(group.y)
    });

    const response = await fetch(`/api/interactions/context?${query.toString()}`);
    if (!response.ok) {
      return { isFriend: false, bubbleTitle: null };
    }

    const payload = await response.json();
    return {
      isFriend: viewerRole === "user" ? Boolean(payload.isFriend) : false,
      bubbleTitle: String(payload.bubbleTitle || "").trim() || null
    };
  }

  function configureInteractionButtons(group, context) {
    const isFriend = Boolean(context && context.isFriend);
    const isOwnGroup = isCurrentUserGroup(group);
    const actionButtons = Array.from(interactionModal.querySelectorAll("[data-interaction-type]"));

    const visibleActions = isOwnGroup
      ? (state.ctrlPressed && authenticated ? ["remove", "name"] : [])
      : viewerRole === "guest"
        ? []
        : viewerRole === "admin"
          ? ["love", "remove", "ban"]
          : ["like", "dislike", "report", "friend"].concat(isFriend ? ["visit-profile"] : []);

    actionButtons.forEach((button) => {
      const type = button.getAttribute("data-interaction-type");
      const visible = visibleActions.includes(type);
      button.hidden = !visible;
      button.disabled = !visible || (!authenticated && viewerRole !== "admin") || type === "visit-profile" || (type === "friend" && !group.ownerId);
    });

    if (interactionAuthLinks) {
      interactionAuthLinks.hidden = authenticated;
    }
  }

  async function openInteractionModal(group) {
    if (!group) {
      return;
    }

    await refreshViewerState();

    state.interactionGroup = group;
    interactionTitle.textContent = isCurrentUserGroup(group) ? "Manage your bubble" : `React to ${group.tag}`;
    interactionSummary.textContent = authenticated
      ? `Created by ${group.tag}. Protected space: ${group.size} pixels, centered near (${group.x}, ${group.y}).`
      : `Created by ${group.tag}. Protected space: ${group.size} pixels. Log in to post a reaction.`;

    interactionBackdrop.hidden = false;
    interactionModal.hidden = false;
    interactionModal.setAttribute("aria-hidden", "false");

    configureInteractionButtons(group, { isFriend: false });

    try {
      const context = await fetchInteractionContext(group);
      configureInteractionButtons(group, context);

      if (context && context.bubbleTitle) {
        interactionSummary.textContent = `${interactionSummary.textContent} Title: ${context.bubbleTitle}`;
        state.interactionGroup.title = context.bubbleTitle;
      }
    } catch {
      // Keep default role-based buttons if context lookup fails.
    }

    if (!authenticated) {
      setStatus("Log in to react to a protected label.", true);
    }
  }

  function closeInteractionModal() {
    state.interactionGroup = null;
    interactionBackdrop.hidden = true;
    interactionModal.hidden = true;
    interactionModal.setAttribute("aria-hidden", "true");

    interactionModal.querySelectorAll("[data-interaction-type]").forEach((button) => {
      button.disabled = false;
      button.hidden = false;
    });

    if (interactionAuthLinks) {
      interactionAuthLinks.hidden = true;
    }
  }

  async function submitInteraction(interactionType) {
    if (!state.interactionGroup) {
      return;
    }

    if (interactionType === "visit-profile") {
      setStatus("Visit Profile coming soon.");
      return;
    }

    if (interactionType === "name") {
      const existingTitle = String(state.interactionGroup.title || "").trim();
      const nextTitle = window.prompt("Set a title for this bubble (max 80 characters):", existingTitle);
      if (nextTitle === null) {
        return;
      }

      const cleanTitle = nextTitle.trim();
      if (!cleanTitle) {
        setStatus("Title cannot be empty.", true);
        return;
      }

      state.pendingTitle = cleanTitle.slice(0, 80);
    } else {
      state.pendingTitle = null;
    }

    if (viewerRole === "admin" && interactionType === "remove") {
      const confirmed = window.confirm("Remove this entire bubble? This will clear all pixels in the selected bubble.");
      if (!confirmed) {
        return;
      }
    }

    if (viewerRole === "admin" && interactionType === "ban") {
      const confirmed = window.confirm("Ban this user? This will delete their account, clear all their pixels, and blacklist their email.");
      if (!confirmed) {
        return;
      }
    }

    const targetGroup = state.interactionGroup;
    const requestBody = {
      interactionType,
      targetUserId: targetGroup.ownerId,
      targetOwnerTag: targetGroup.tag,
      groupX: targetGroup.x,
      groupY: targetGroup.y,
      title: state.pendingTitle || undefined
    };

    const response = await fetch("/api/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload.error || "Unable to save interaction.", true);
      return;
    }

    if (Array.isArray(payload.modifiedPixels) && payload.modifiedPixels.length > 0) {
      applyModifiedPixels(payload.modifiedPixels);
    }

    if (interactionType === "name" && payload.bubbleTitle) {
      state.interactionGroup.title = payload.bubbleTitle;
    }

    const actionLabels = {
      like: "Like saved.",
      dislike: "Dislike saved.",
      report: "Report saved.",
      love: "Love saved.",
      remove: "Bubble removed.",
      ban: "User banned and removed.",
      friend: "Friend request sent.",
      name: "Bubble title saved."
    };
    setStatus(actionLabels[interactionType] || "Reaction saved.", false);
    closeInteractionModal();
  }

  async function loadPalette() {
    const response = await fetch("/api/palette");
    if (!response.ok) {
      setStatus("Unable to load color swatches.", true);
      return;
    }

    const payload = await response.json();
    state.palette = payload.palette;

    if (
      state.palette.length > 0 &&
      !state.palette.some((entry) => entry.color_hex.toUpperCase() === state.activeColor.toUpperCase())
    ) {
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

  function getKeyForColorIndex(index) {
    if (index < 9) {
      return String(index + 1);
    }
    if (index === 9) {
      return "0";
    }
    if (index < 20) {
      const qwertyKeys = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"];
      return qwertyKeys[index - 10];
    }
    return null;
  }

  function getColorIndexForKey(key) {
    const num = parseInt(key, 10);
    if (!Number.isNaN(num)) {
      if (num === 0) {
        return 9;
      }
      if (num >= 1 && num <= 9) {
        return num - 1;
      }
    }

    const qwertyKeys = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"];
    const qIndex = qwertyKeys.indexOf(String(key).toLowerCase());
    if (qIndex !== -1) {
      return 10 + qIndex;
    }
    return -1;
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

      const keyLabel = getKeyForColorIndex(index);
      swatch.title = `${entry.color_hex} (${entry.scope})${keyLabel ? ` - Press ${keyLabel.toUpperCase()}` : ""}`;

      if (keyLabel) {
        swatch.innerHTML = `<span class="color-key">${keyLabel.toUpperCase()}</span>`;
      }

      swatch.addEventListener("click", () => {
        state.activeColor = entry.color_hex.toUpperCase();
        renderPalette();
      });

      paletteEl.appendChild(swatch);
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
      scheduleDraw();
      setStatus("Canvas was reset by admin.");
    });
  }

  function bindEvents() {
    window.addEventListener("resize", resizeCanvas);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    canvas.addEventListener("mouseleave", () => {
      state.hoveredGroup = null;
      scheduleDraw();
    });

    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();

      const delta = event.deltaY < 0 ? 1 : -1;
      const newSize = Math.max(1, Math.min(cfg.maxBrushSize, state.brushSize + delta));
      state.brushSize = newSize;
      if (brushInput) {
        brushInput.value = String(newSize);
      }
      if (brushLabel) {
        brushLabel.textContent = String(newSize);
      }
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Control" && !state.ctrlPressed) {
        state.ctrlPressed = true;
        scheduleDraw();
      }

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
        scheduleDraw();
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
        scheduleDraw();
        return;
      }

      const colorIndex = getColorIndexForKey(event.key);
      if (colorIndex >= 0 && colorIndex < state.palette.length) {
        state.activeColor = state.palette[colorIndex].color_hex.toUpperCase();
        renderPalette();
      }
    });

    window.addEventListener("keyup", (event) => {
      if (event.key === "Control" && state.ctrlPressed) {
        state.ctrlPressed = false;
        state.hoveredGroup = null;
        scheduleDraw();
      }
    });

    window.addEventListener("blur", () => {
      if (state.ctrlPressed) {
        state.ctrlPressed = false;
        state.hoveredGroup = null;
        scheduleDraw();
      }
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

      const protectedGroup = getHoveredGroup(event.clientX, event.clientY);
      if (protectedGroup) {
        state.drawing = false;
        state.hoveredGroup = protectedGroup;
        scheduleDraw();
        return;
      }

      state.drawing = true;
      const point = screenToGrid(event.clientX, event.clientY);
      state.lastDragPoint = point;
      queueBrushChange(point.x, point.y);
    });

    canvas.addEventListener("click", (event) => {
      const opened = tryOpenProtectedGroup(event);
      if (opened) {
        const hoveredGroup = getHoveredGroup(event.clientX, event.clientY);
        if (hoveredGroup) {
          void openInteractionModal(hoveredGroup);
        }
      }
    });

    window.addEventListener("mousemove", (event) => {
      if (state.panning) {
        state.offsetX = event.clientX - state.panStartX;
        state.offsetY = event.clientY - state.panStartY;
        scheduleDraw();
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
          const protectedGroup = getGroupAtGridPoint(p.x, p.y);
          if (!protectedGroup || isCurrentUserGroup(protectedGroup)) {
            queueBrushChange(p.x, p.y);
          }
        }

        state.lastDragPoint = point;
      }

      const hovered = getHoveredGroup(event.clientX, event.clientY);
      if (hovered?.id !== state.hoveredGroup?.id) {
        state.hoveredGroup = hovered || null;
        scheduleDraw();
      }
    });

    window.addEventListener("mouseup", () => {
      state.panning = false;
      state.drawing = false;
      state.lastDragPoint = null;
      state.lastPaintKey = "";
      flushPaintBatch();
    });

    if (interactionBackdrop) {
      interactionBackdrop.addEventListener("click", closeInteractionModal);
    }

    if (interactionClose) {
      interactionClose.addEventListener("click", closeInteractionModal);
    }

    if (interactionModal) {
      interactionModal.querySelectorAll("[data-interaction-type]").forEach((button) => {
        button.addEventListener("click", () => {
          submitInteraction(button.getAttribute("data-interaction-type"));
        });
      });
    }

    if (toolbar) {
      toolbar.querySelectorAll("[data-mode]").forEach((button) => {
        button.addEventListener("click", () => {
          flushBeforeToolChange();
          state.mode = button.getAttribute("data-mode");
          toolbar.querySelectorAll("[data-mode]").forEach((btn) => btn.classList.remove("active"));
          button.classList.add("active");
        });
      });
    }

    if (brushInput) {
      brushInput.addEventListener("input", () => {
        flushBeforeToolChange();
        state.brushSize = Number(brushInput.value);
        if (brushLabel) {
          brushLabel.textContent = String(state.brushSize);
        }
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
        scheduleDraw();
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