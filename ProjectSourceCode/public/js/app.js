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
  const paletteSelectorEl = document.getElementById("palette-selector");
  const brushInput = document.getElementById("brush-size");
  const brushLabel = document.getElementById("brush-size-label");
  const openPaletteStoreBtn = document.getElementById("open-palette-store");
  const paletteStoreBackdrop = document.getElementById("palette-store-backdrop");
  const paletteStoreModal = document.getElementById("palette-store-modal");
  const paletteStoreSummary = document.getElementById("palette-store-summary");
  const paletteStoreGrid = document.getElementById("palette-store-grid");
  const paletteStoreClose = document.getElementById("palette-store-close");
  const openTutorialBtn = document.getElementById("open-tutorial");
  const tutorialBackdrop = document.getElementById("tutorial-backdrop");
  const tutorialModal = document.getElementById("tutorial-modal");
  const tutorialTokenSummary = document.getElementById("tutorial-token-summary");
  const tutorialClose = document.getElementById("tutorial-close");
  const guestPaintBackdrop = document.getElementById("guest-paint-backdrop");
  const guestPaintModal = document.getElementById("guest-paint-modal");
  const guestPaintClose = document.getElementById("guest-paint-close");
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
  let currentUser = normalizeUserProgress(window.APP_USER || null);
  const ctx = canvas.getContext("2d");
  const pixels = new Map();

  function normalizeUserProgress(user) {
    if (!user || typeof user !== "object") {
      return user;
    }

    const normalized = { ...user };
    const parsedLevel = Number(normalized.level);
    const parsedXp = Number(normalized.xp);

    normalized.level = Number.isFinite(parsedLevel) && parsedLevel >= 0
      ? Math.floor(parsedLevel)
      : 0;
    normalized.xp = Number.isFinite(parsedXp) && parsedXp >= 0
      ? Math.floor(parsedXp)
      : 0;
    normalized.palette_tokens = Math.max(0, Number(normalized.palette_tokens) || 0);
    normalized.selected_palette_id = String(normalized.selected_palette_id || "starter_classic");

    return normalized;
  }

  function getXpRequiredForNextLevel(level) {
    const normalizedLevel = Math.max(0, Math.floor(Number(level) || 0));
    return Math.max(1, Math.ceil(100 * Math.pow(1.15, normalizedLevel)));
  }

  function getDailyPaintLimit(level) {
    const normalizedLevel = Math.max(0, Math.floor(Number(level) || 0));
    return Math.max(1, Math.ceil(100 * Math.pow(1.25, normalizedLevel)));
  }

  function getLevelFromXp(xp) {
    let remainingXp = Math.max(0, Math.floor(Number(xp) || 0));
    let level = 0;

    while (remainingXp >= getXpRequiredForNextLevel(level)) {
      remainingXp -= getXpRequiredForNextLevel(level);
      level += 1;
    }

    return level;
  }

  function getProgressForCurrentLevel(xp, level) {
    let remainingXp = Math.max(0, Math.floor(Number(xp) || 0));
    const normalizedLevel = Math.max(0, Math.floor(Number(level) || 0));

    for (let index = 0; index < normalizedLevel; index += 1) {
      remainingXp -= getXpRequiredForNextLevel(index);
      if (remainingXp < 0) {
        return 0;
      }
    }

    return remainingXp;
  }

  function addXpToCurrentUser(xpGained) {
    if (!currentUser) {
      return;
    }

    let level = Math.max(0, Math.floor(Number(currentUser.level) || 0));
    let xp = Math.max(0, Math.floor(Number(currentUser.xp) || 0));
    let progress = getProgressForCurrentLevel(xp, level);
    let gained = Math.max(0, Math.floor(Number(xpGained) || 0));

    while (gained > 0) {
      const required = getXpRequiredForNextLevel(level);
      const toLevel = Math.max(0, required - progress);
      if (gained < toLevel) {
        progress += gained;
        xp += gained;
        gained = 0;
      } else {
        xp += toLevel;
        gained -= toLevel;
        level += 1;
        progress = 0;
      }
    }

    currentUser.level = level;
    currentUser.xp = xp;
  }

  function applyOptimisticProgress(xpGained, paintCost = 1) {
    if (!authenticated) {
      return;
    }

    const normalizedXpGain = Math.max(0, Number(xpGained) || 0);

    if (currentUser && typeof state.serverXp !== "number") {
      state.serverXp = Math.max(0, Number(currentUser.xp) || 0);
    }

    if (currentUser && Number.isFinite(Number(currentUser.level))) {
      const previousLevel = Math.max(0, Number(currentUser.level) || 0);
      const previousDailyMax = getDailyPaintLimit(previousLevel);
      if (normalizedXpGain > 0) {
        if (typeof state.serverXp === "number") {
          state.pendingXp += normalizedXpGain;
          recomputeXpFromServer();
        } else {
          addXpToCurrentUser(normalizedXpGain);
        }
      }
      const nextLevel = Math.max(0, Number(currentUser.level) || 0);

      if (!isAdmin && typeof state.remainingPaints === "number") {
        const nextDailyMax = getDailyPaintLimit(nextLevel);
        state.pendingPaints += paintCost;
        state.remainingPaints = Math.max(0, state.remainingPaints + (nextDailyMax - previousDailyMax) - paintCost);
      }
    } else if (!isAdmin && typeof state.remainingPaints === "number") {
      state.pendingPaints += paintCost;
      state.remainingPaints = Math.max(0, state.remainingPaints - paintCost);
    }

    updateUsage();
  }

  function recomputeRemainingPaints() {
    if (typeof state.serverRemainingPaints === "number") {
      state.remainingPaints = Math.max(0, state.serverRemainingPaints - state.pendingPaints);
    }
  }

  function recomputeXpFromServer() {
    if (!currentUser || typeof state.serverXp !== "number") {
      return;
    }

    const effectiveXp = Math.max(0, state.serverXp + state.pendingXp);
    currentUser.xp = effectiveXp;
    currentUser.level = getLevelFromXp(effectiveXp);
  }

  function applyViewerStateFromUser(user, authFlag) {
    const normalizedUser = normalizeUserProgress(user || null);
    currentUser = normalizedUser;
    state.serverXp = normalizedUser && Number.isFinite(Number(normalizedUser.xp))
      ? Number(normalizedUser.xp)
      : null;
    state.pendingXp = 0;
    const serverAdmin = Boolean(normalizedUser && normalizedUser.isAdmin);
    const serverAuthenticated = Boolean(authFlag || serverAdmin || (normalizedUser && normalizedUser.id));
    isAdmin = serverAdmin;
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
    strokeDedupeKeys: new Set(),
    remainingPaints: null,
    serverRemainingPaints: null,
    pendingPaints: 0,
    serverXp: currentUser && Number.isFinite(Number(currentUser.xp)) ? Number(currentUser.xp) : null,
    pendingXp: 0,
    ctrlPressed: false,
    pendingTitle: null,
    hoveredGroup: null,
    interactionGroup: null,
    groups: [],
    playerColors: {}, // Map of player tags to colors
    selectedPaletteId: "starter_classic",
    selectedPaletteName: "Starter Classic",
    unlockedPaletteIds: ["starter_classic"],
    availablePalettes: [],
    paletteStoreItems: []
  };

  let socket = null;
  let paintQueue = Promise.resolve();
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
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#b42318" : "#3f6b38";
  }

  function openGuestPaintModal() {
    if (!guestPaintBackdrop || !guestPaintModal) {
      setStatus("You must be logged in to paint.", true);
      return;
    }

    guestPaintBackdrop.hidden = false;
    guestPaintModal.hidden = false;
    guestPaintModal.setAttribute("aria-hidden", "false");
  }

  function closeGuestPaintModal() {
    if (!guestPaintBackdrop || !guestPaintModal) {
      return;
    }

    guestPaintBackdrop.hidden = true;
    guestPaintModal.hidden = true;
    guestPaintModal.setAttribute("aria-hidden", "true");
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
      usageEl.textContent = "Guest mode: login required to paint.";
      return;
    }

    const level = Number(currentUser && currentUser.level);
    const xp = Number(currentUser && currentUser.xp);
    const paletteTokens = Number(currentUser && currentUser.palette_tokens);
    const hasProgress = Number.isFinite(level) && Number.isFinite(xp);
    const tokenText = Number.isFinite(paletteTokens) ? ` | Tokens ${Math.max(0, paletteTokens)}` : "";

    if (typeof state.remainingPaints === "number") {
      pixelCountEl.textContent = `Pixels left today: ${state.remainingPaints}`;
      usageEl.textContent = hasProgress
        ? `Level ${Math.max(0, level)} | XP ${Math.max(0, xp)}${tokenText} | Paints remaining today: ${state.remainingPaints}`
        : `Paints remaining today: ${state.remainingPaints}`;
      return;
    }

    usageEl.textContent = hasProgress
      ? `Level ${Math.max(0, level)} | XP ${Math.max(0, xp)}${tokenText}`
      : "Paint mode: ready.";
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

  function setPixel(x, y, color, ownerId, ownerTag) {
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

  function applyModifiedPixels(modifiedPixels) {
    modifiedPixels.forEach((pixel) => {
      setPixel(pixel.x, pixel.y, pixel.color_hex, pixel.owner_id, pixel.owner_tag);
    });
    scheduleDraw();
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

  function applyLocalBrush(x, y, brushSize, colorHex, ownerId, ownerTag, mode) {
    const cells = buildBrushCellsForPoint(x, y, brushSize);

    const modified = cells.map((cell) => ({
      x: cell.x,
      y: cell.y,
      color_hex: mode === "erase" ? null : colorHex,
      owner_id: mode === "erase" ? null : ownerId,
      owner_tag: mode === "erase" ? null : ownerTag
    }));

    applyModifiedPixels(modified);
    return modified;
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

  function isAdminGroup(group) {
    return Boolean(group) && (group.ownerKey === "__ADMIN__" || String(group.tag || "").toLowerCase() === "admin");
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
    draw();
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
      setPixel(pixel.x, pixel.y, pixel.color_hex, pixel.owner_id, pixel.owner_tag);
    });

    draw();
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

    // Apply role-based defaults immediately so UI never shows a stale mixed action set.
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
    state.palette = Array.isArray(payload.palette) ? payload.palette : [];
    state.selectedPaletteId = String(payload.selectedPaletteId || "starter_classic");
    state.selectedPaletteName = String(payload.selectedPaletteName || "Starter Classic");
    state.unlockedPaletteIds = Array.isArray(payload.unlockedPaletteIds) ? payload.unlockedPaletteIds : ["starter_classic"];
    state.availablePalettes = Array.isArray(payload.availablePalettes) ? payload.availablePalettes : [];

    if (currentUser && Number.isFinite(Number(payload.paletteTokens))) {
      currentUser.palette_tokens = Number(payload.paletteTokens);
      currentUser.selected_palette_id = state.selectedPaletteId;
    }

    if (state.palette.length > 0) {
      const paletteHasActive = state.palette.some((entry) => String(entry.color_hex || "").toUpperCase() === state.activeColor.toUpperCase());
      if (!paletteHasActive) {
        state.activeColor = state.palette[0].color_hex.toUpperCase();
      }
    }

    renderPaletteSelector();
    renderPalette();
    updateUsage();
  }

  function renderPaletteSelector() {
    if (!paletteSelectorEl) {
      return;
    }

    paletteSelectorEl.innerHTML = "";
    const unlocked = new Set(state.unlockedPaletteIds || []);
    const choices = (state.availablePalettes || []).filter((item) => unlocked.has(item.paletteId) || isAdmin);

    choices.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.paletteId;
      option.textContent = item.name;
      paletteSelectorEl.appendChild(option);
    });

    paletteSelectorEl.value = state.selectedPaletteId;
    paletteSelectorEl.disabled = !authenticated;
  }

  async function loadPaletteStore() {
    const response = await fetch("/api/palette/store", { cache: "no-store" });
    if (!response.ok) {
      setStatus("Unable to load palette store.", true);
      return null;
    }

    const payload = await response.json();
    state.paletteStoreItems = Array.isArray(payload.items) ? payload.items : [];

    if (currentUser && Number.isFinite(Number(payload.tokens))) {
      currentUser.palette_tokens = Number(payload.tokens);
    }

    renderPaletteStore(payload);
    updateUsage();
    return payload;
  }

  function renderPaletteStore(storePayload) {
    if (!paletteStoreGrid || !paletteStoreSummary) {
      return;
    }

    const payload = storePayload || { tokens: 0, items: [] };
    const tokens = Math.max(0, Number(payload.tokens) || 0);
    paletteStoreSummary.textContent = authenticated
      ? `You have ${tokens} level-up token${tokens === 1 ? "" : "s"}. Unlock a palette now or save tokens for later.`
      : "Log in to unlock palettes with level-up tokens.";

    paletteStoreGrid.innerHTML = "";
    payload.items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "palette-store-item";

      const preview = (item.colors || []).map((color) => `<span class="palette-store-swatch" style="background:${color}"></span>`).join("");
      const buttonLabel = item.selected
        ? "Selected"
        : item.unlocked
          ? "Select Palette"
          : "Unlock (1 token)";

      card.innerHTML = `
        <h3>${item.name}</h3>
        <p>${item.description || ""}</p>
        <div class="palette-store-preview">${preview}</div>
        <button type="button" data-palette-action="${item.unlocked ? "select" : "unlock"}" data-palette-id="${item.paletteId}">${buttonLabel}</button>
      `;

      const button = card.querySelector("button");
      if (button) {
        button.disabled = item.selected || (!item.unlocked && !item.canUnlock);
      }

      paletteStoreGrid.appendChild(card);
    });
  }

  function openPaletteStore() {
    if (!paletteStoreBackdrop || !paletteStoreModal) {
      return;
    }

    paletteStoreBackdrop.hidden = false;
    paletteStoreModal.hidden = false;
    paletteStoreModal.setAttribute("aria-hidden", "false");
    void loadPaletteStore();
  }

  function closePaletteStore() {
    if (!paletteStoreBackdrop || !paletteStoreModal) {
      return;
    }

    paletteStoreBackdrop.hidden = true;
    paletteStoreModal.hidden = true;
    paletteStoreModal.setAttribute("aria-hidden", "true");
  }

  function getTutorialTokenSummary() {
    if (!authenticated || !currentUser) {
      return "Log in to paint and earn level-up tokens you can spend in the Palette Store.";
    }

    const tokens = Math.max(0, Number(currentUser.palette_tokens) || 0);
    if (tokens === 1) {
      return "You have 1 level-up token to use right now in the Palette Store. Unlock a palette and start drawing with fresh colors.";
    }

    if (tokens > 1) {
      return `You have ${tokens} level-up tokens ready to spend right now in the Palette Store.`;
    }

    return "You have no tokens right now. Keep painting to level up and unlock more palettes.";
  }

  function openTutorialModal(markSeen = true) {
    if (!tutorialBackdrop || !tutorialModal) {
      return;
    }

    if (tutorialTokenSummary) {
      tutorialTokenSummary.textContent = getTutorialTokenSummary();
    }

    tutorialBackdrop.hidden = false;
    tutorialModal.hidden = false;
    tutorialModal.setAttribute("aria-hidden", "false");

    if (markSeen && authenticated && currentUser) {
      fetch("/api/me/tutorial-seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      }).catch(() => {
        // Silently fail if marking tutorial as seen fails; modal still displays.
      });
    }
  }

  function closeTutorialModal() {
    if (!tutorialBackdrop || !tutorialModal) {
      return;
    }

    tutorialBackdrop.hidden = true;
    tutorialModal.hidden = true;
    tutorialModal.setAttribute("aria-hidden", "true");
  }

  function maybeOpenFirstStartTutorial() {
    if (authenticated && currentUser && !currentUser.tutorial_seen) {
      openTutorialModal(true);
    }
  }

  async function selectPalette(paletteId) {
    const response = await fetch("/api/palette/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paletteId })
    });

    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload.error || "Unable to select palette.", true);
      return false;
    }

    await loadPalette();
    setStatus(`Selected palette: ${payload.selectedPaletteName || paletteId}.`);
    return true;
  }

  async function unlockPalette(paletteId) {
    const response = await fetch("/api/palette/store/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paletteId })
    });

    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload.error || "Unable to unlock palette.", true);
      return false;
    }

    await loadPalette();
    await loadPaletteStore();
    setStatus("Palette unlocked. You can select it from the store or the palette menu.");
    return true;
  }

  async function loadLimits() {
    const response = await fetch("/api/me/limits");
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    state.serverRemainingPaints = typeof payload.remainingPaints === "number" ? payload.remainingPaints : null;
    recomputeRemainingPaints();
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
     if (!authenticated) {
      openGuestPaintModal();
       return;
     }

    if (typeof state.remainingPaints === "number" && state.remainingPaints <= 0) {
      setStatus("Daily paint limit reached.", true);
      return;
    }

    const brushSize = state.brushSize;
    const paintMode = state.mode;
    const paintColor = state.activeColor;
    const identity = getActivePainterIdentity();
    const dedupeKey = `${x}:${y}:${paintMode}:${brushSize}:${paintColor}`;
    if (state.lastPaintKey === dedupeKey || state.strokeDedupeKeys.has(dedupeKey)) {
      return;
    }

    state.lastPaintKey = dedupeKey;
    state.strokeDedupeKeys.add(dedupeKey);

    // Paint locally first so dragging feels immediate; server response reconciles state.
    const localModifiedPixels = applyLocalBrush(x, y, brushSize, paintColor, identity.ownerId, identity.ownerTag, paintMode);
    const optimisticXpGain = paintMode === "paint" ? localModifiedPixels.length : 0;
    applyOptimisticProgress(optimisticXpGain, 1);

    paintQueue = paintQueue.then(async () => {
      const response = await fetch("/api/paint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x,
          y,
          mode: paintMode,
          brushSize,
          color: paintColor
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        setStatus(payload.error || "Paint request failed.", true);
        // Re-sync after server rejection so optimistic local state does not drift.
        state.pendingPaints = Math.max(0, state.pendingPaints - 1);
        state.pendingXp = Math.max(0, state.pendingXp - optimisticXpGain);
        recomputeXpFromServer();
        await loadCanvas();
        await loadLimits();
        updateUsage();
        return;
      }

      state.pendingPaints = Math.max(0, state.pendingPaints - 1);
      state.serverRemainingPaints = typeof payload.remainingPaints === "number" ? payload.remainingPaints : state.serverRemainingPaints;
      state.pendingXp = Math.max(0, state.pendingXp - optimisticXpGain);
      if (typeof payload.xp === "number") {
        state.serverXp = payload.xp;
      }
      recomputeRemainingPaints();
      recomputeXpFromServer();
      if (currentUser && Number.isFinite(Number(payload.xp)) && Number.isFinite(Number(payload.level))) {
        if (Number.isFinite(Number(payload.paletteTokens))) {
          currentUser.palette_tokens = Number(payload.paletteTokens);
        }
        if (payload.selectedPaletteId) {
          currentUser.selected_palette_id = String(payload.selectedPaletteId);
        }
      }

      const levelsGained = Number(payload.levelsGained || 0);
      const tokensGained = Number(payload.tokensGained || 0);
      if (levelsGained > 0 && tokensGained > 0 && authenticated && !isAdmin) {
        window.alert(`Level up! You gained ${tokensGained} level-up token${tokensGained === 1 ? "" : "s"}. Open the Palette Store to unlock a new palette, or save tokens for later.`);
      }
      applyModifiedPixels(payload.modifiedPixels);
      updateUsage();
    }).catch(() => {
      setStatus("Paint request failed.", true);
      state.pendingPaints = Math.max(0, state.pendingPaints - 1);
      state.pendingXp = Math.max(0, state.pendingXp - optimisticXpGain);
      recomputeRemainingPaints();
      recomputeXpFromServer();
      updateUsage();
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
      if (event.key === "Control" && !state.ctrlPressed) {
        state.ctrlPressed = true;
        scheduleDraw();
      }

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

      // Color selection with number (0-9) and QWERTY keys
      const colorIndex = getColorIndexForKey(event.key);
      if (colorIndex >= 0 && colorIndex < state.palette.length) {
        state.activeColor = state.palette[colorIndex].color_hex;
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
      enqueuePaint(point.x, point.y);
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
        const hoveredDuringDrag = getHoveredGroup(event.clientX, event.clientY);
        if (!hoveredDuringDrag || isCurrentUserGroup(hoveredDuringDrag)) {
          const point = screenToGrid(event.clientX, event.clientY);
          enqueuePaint(point.x, point.y);
        }
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
      state.lastPaintKey = "";
      state.strokeDedupeKeys.clear();
    });

    interactionBackdrop.addEventListener("click", closeInteractionModal);
    interactionClose.addEventListener("click", closeInteractionModal);
    interactionModal.querySelectorAll("[data-interaction-type]").forEach((button) => {
      button.addEventListener("click", () => {
        submitInteraction(button.getAttribute("data-interaction-type"));
      });
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

    if (paletteSelectorEl) {
      paletteSelectorEl.addEventListener("change", async () => {
        const nextPalette = String(paletteSelectorEl.value || "").trim();
        if (!nextPalette) {
          return;
        }
        const selected = await selectPalette(nextPalette);
        if (!selected) {
          await loadPalette();
        }
      });
    }

    if (openPaletteStoreBtn) {
      openPaletteStoreBtn.addEventListener("click", () => {
        if (!authenticated) {
          setStatus("Log in to unlock and choose palettes.", true);
        }
        openPaletteStore();
      });
    }

    if (paletteStoreBackdrop) {
      paletteStoreBackdrop.addEventListener("click", closePaletteStore);
    }

    if (paletteStoreClose) {
      paletteStoreClose.addEventListener("click", closePaletteStore);
    }

    if (openTutorialBtn) {
      openTutorialBtn.addEventListener("click", () => {
        openTutorialModal(true);
      });
    }

    if (tutorialBackdrop) {
      tutorialBackdrop.addEventListener("click", closeTutorialModal);
    }

    if (tutorialClose) {
      tutorialClose.addEventListener("click", closeTutorialModal);
    }

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && tutorialModal && !tutorialModal.hidden) {
        closeTutorialModal();
      }
    });

    if (guestPaintClose) {
      guestPaintClose.addEventListener("click", closeGuestPaintModal);
    }

    if (paletteStoreGrid) {
      paletteStoreGrid.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-palette-id]");
        if (!button) {
          return;
        }

        const paletteId = button.getAttribute("data-palette-id");
        const action = button.getAttribute("data-palette-action");
        if (!paletteId || !action) {
          return;
        }

        if (action === "unlock") {
          await unlockPalette(paletteId);
          return;
        }

        if (action === "select") {
          const ok = await selectPalette(paletteId);
          if (ok) {
            await loadPaletteStore();
          }
        }
      });
    }

  }

  async function init() {
    await refreshViewerState();

    bindEvents();
    resizeCanvas();
    updateUsage();

    await loadCanvas();

    await loadPalette();

    await loadLimits();

    connectSocket();
    maybeOpenFirstStartTutorial();
    updateUsage();
  }

  init().catch(() => {
    setStatus("Failed to initialize canvas.", true);
  });
})();
