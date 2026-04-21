const express = require("express");
const { pool } = require("../db/pool");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { GRID_SIZE, MAX_BRUSH_SIZE, DAILY_MAX_PAINTS, GUEST_MAX_PAINTS } = require("../config/constants");

const router = express.Router();

function isHexColor(color) {
  return /^#[0-9A-F]{6}$/i.test(color || "");
}

async function getAllowedColors(dbClient) {
  const { rows } = await dbClient.query(
    `
      SELECT color_hex FROM default_palette
    `
  );

  return new Set(rows.map((row) => row.color_hex.toUpperCase()));
}

async function getRemainingPaints(client, userId) {
  const { rows } = await client.query(
    `
      SELECT COUNT(*)::int AS paints_today
      FROM paint_actions
      WHERE user_id = $1
        AND created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
    `,
    [userId]
  );

  return Math.max(0, DAILY_MAX_PAINTS - rows[0].paints_today);
}

function getGuestRemainingPaints(session) {
  if (typeof session.guestPaintsRemaining !== "number") {
    session.guestPaintsRemaining = GUEST_MAX_PAINTS;
  }

  return Math.max(0, session.guestPaintsRemaining);
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

function buildBrushCells(x, y, brushSize) {
  const cells = [];
  const offset = -Math.floor((brushSize - 1) / 2);

  for (let row = 0; row < brushSize; row += 1) {
    for (let col = 0; col < brushSize; col += 1) {
      const nextX = x + offset + col;
      const nextY = y + offset + row;
      if (nextX < 0 || nextX >= GRID_SIZE || nextY < 0 || nextY >= GRID_SIZE) {
        continue;
      }
      cells.push({ x: nextX, y: nextY });
    }
  }

  return cells;
}

function getOwnershipKey(ownerId, ownerTag, isAdmin) {
  const displayName = String(ownerTag || "").trim().toLowerCase();
  if (isAdmin || displayName === "admin" || displayName === "~admin~") {
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

function buildProtectedGroups(rows) {
  const MERGE_DISTANCE = 5;
  const byOwner = new Map();

  for (const row of rows) {
    if (!row.owner_tag) {
      continue;
    }

    const ownerKey = getOwnershipKey(row.owner_id, row.owner_tag, false);
    if (!ownerKey) {
      continue;
    }

    if (!byOwner.has(ownerKey)) {
      byOwner.set(ownerKey, {
        ownerKey,
        ownerId: row.owner_id || null,
        tag: row.owner_tag,
        cells: new Set()
      });
    }

    byOwner.get(ownerKey).cells.add(`${row.x},${row.y}`);
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

      const stack = [start];
      let size = 0;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const cells = new Set();

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
          const nextKey = `${x + dx},${y + dy}`;
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
        size,
        cells
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
          size: component.size,
          cells: new Set(component.cells)
        });
        continue;
      }

      const current = merged.get(root);
      current.minX = Math.min(current.minX, component.minX);
      current.minY = Math.min(current.minY, component.minY);
      current.maxX = Math.max(current.maxX, component.maxX);
      current.maxY = Math.max(current.maxY, component.maxY);
      current.size += component.size;
      for (const cellKey of component.cells) {
        current.cells.add(cellKey);
      }
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
        size: mergedComp.size,
        cells: mergedComp.cells
      });
    }
  }

  return groups;
}

function resolveTargetGroup(groups, targetGroupX, targetGroupY, targetOwnerTag) {
  const normalizedTargetTag = String(targetOwnerTag || "").trim()
    ? normalizeDisplayName(targetOwnerTag).toLowerCase()
    : "";

  return groups.find((group) => {
    const sameTag = !normalizedTargetTag
      || normalizeDisplayName(group.tag).toLowerCase() === normalizedTargetTag;
    if (!sameTag) {
      return false;
    }

    if (group.x === targetGroupX && group.y === targetGroupY) {
      return true;
    }

    return isPointInsideProtectedGroup(group, targetGroupX, targetGroupY);
  }) || null;
}

async function getBubbleTitleForGroup(dbClient, group) {
  if (!group || !group.ownerKey) {
    return null;
  }

  const { rows } = await dbClient.query(
    `
      SELECT title
      FROM bubble_titles
      WHERE owner_key = $1
        AND target_group_x = $2
        AND target_group_y = $3
      LIMIT 1
    `,
    [group.ownerKey, group.x, group.y]
  );

  return rows[0] ? rows[0].title : null;
}

function isPointInsideProtectedGroup(group, x, y) {
  const dx = x + 0.5 - group.centerX;
  const dy = y + 0.5 - group.centerY;
  return (dx * dx) + (dy * dy) <= group.radius * group.radius;
}

router.get("/canvas", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          cp.x,
          cp.y,
          cp.color_hex,
          cp.updated_by AS owner_id,
          CASE
            WHEN cp.owner_tag = '~Admin~' THEN 'Admin'
            WHEN cp.owner_tag = 'Admin' THEN 'Admin'
            WHEN cp.updated_by IS NOT NULL THEN COALESCE(NULLIF(u.username, ''), SPLIT_PART(u.email, '@', 1), cp.owner_tag)
            ELSE COALESCE(NULLIF(cp.owner_tag, ''), 'Guest')
          END AS owner_tag
        FROM canvas_pixels cp
        LEFT JOIN users u ON u.id = cp.updated_by
      `
    );
    return res.json({ gridSize: GRID_SIZE, pixels: rows });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", (req, res) => {
  const isAdmin = Boolean(req.session && req.session.isAdmin);
  const customUser = isAdmin
    ? { id: null, username: "Admin", email: null, isAdmin: true }
    : req.user || null;

  return res.json({
    authenticated: Boolean(req.user || isAdmin),
    user: customUser
  });
});

router.get("/welcome", (req, res) => {
  return res.json({ status: "success", message: "Welcome!" });
});

router.get("/me/limits", requireAuth, async (req, res, next) => {
  if (req.session && req.session.isAdmin) {
    return res.json({ dailyMaxPaints: null, remainingPaints: null, unlimited: true });
  }

  if (!req.session || !req.session.userId) {
    const remainingPaints = getGuestRemainingPaints(req.session);
    return res.json({ dailyMaxPaints: GUEST_MAX_PAINTS, remainingPaints, guest: true });
  }

  const client = await pool.connect();
  try {
    const remaining = await getRemainingPaints(client, req.session.userId);
    return res.json({ dailyMaxPaints: DAILY_MAX_PAINTS, remainingPaints: remaining });
  } catch (error) {
    return next(error);
  } finally {
    client.release();
  }
});

router.get("/palette", async (req, res, next) => {
  if (req.session && req.session.isAdmin) {
    try {
      const { rows } = await pool.query(
        `
          SELECT color_hex, 'default' AS scope FROM default_palette
          ORDER BY color_hex ASC
        `
      );
      return res.json({ palette: rows });
    } catch (error) {
      return next(error);
    }
  }

  if (!req.session || !req.session.userId) {
    try {
      const { rows } = await pool.query(
        `
          SELECT color_hex, 'default' AS scope FROM default_palette
          ORDER BY color_hex ASC
        `
      );
      return res.json({ palette: rows, guest: true });
    } catch (error) {
      return next(error);
    }
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT color_hex, 'default' AS scope FROM default_palette
        ORDER BY color_hex ASC
      `
    );

    return res.json({ palette: rows });
  } catch (error) {
    return next(error);
  }
});

router.post("/palette", requireAuth, async (req, res, next) => {
  return res.status(403).json({ error: "Custom colors are disabled. Choose from swatches." });
});

router.delete("/palette/:color", requireAuth, async (req, res, next) => {
  return res.status(403).json({ error: "Custom colors are disabled. Choose from swatches." });
});

router.post("/paint", async (req, res, next) => {
  const x = Number(req.body.x);
  const y = Number(req.body.y);
  const brushSize = Number(req.body.brushSize || 1);
  const mode = req.body.mode === "erase" ? "erase" : "paint";
  const rawColor = String(req.body.color || "").toUpperCase();

  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) {
    return res.status(400).json({ error: "Coordinates are out of bounds." });
  }

  if (!Number.isInteger(brushSize) || brushSize < 1 || brushSize > MAX_BRUSH_SIZE) {
    return res.status(400).json({ error: `Brush size must be between 1 and ${MAX_BRUSH_SIZE}.` });
  }

  if (mode === "paint" && !isHexColor(rawColor)) {
    return res.status(400).json({ error: "Paint mode requires a valid hex color." });
  }

  const userId = req.session && req.session.userId ? req.session.userId : null;
  const ownerTag = req.session && req.session.isAdmin
    ? "Admin"
    : req.user && req.user.email
      ? normalizeDisplayName(req.user.displayName || req.user.username || req.user.email.split("@")[0])
      : "Guest";
  const isGuest = !userId && !(req.session && req.session.isAdmin);
  const actorOwnershipKey = getOwnershipKey(userId, ownerTag, Boolean(req.session && req.session.isAdmin));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let remaining = null;
    if (userId) {
      remaining = await getRemainingPaints(client, userId);
      if (remaining <= 0) {
        await client.query("ROLLBACK");
        return res.status(429).json({ error: "Daily paint limit reached.", dailyMaxPaints: DAILY_MAX_PAINTS, remainingPaints: 0 });
      }
    } else if (isGuest) {
      remaining = getGuestRemainingPaints(req.session);
      if (remaining <= 0) {
        await client.query("ROLLBACK");
        return res.status(429).json({ error: "Guest paint limit reached.", dailyMaxPaints: GUEST_MAX_PAINTS, remainingPaints: 0 });
      }
    }

    const allowedColors = await getAllowedColors(client);
    const color = rawColor.toUpperCase();

    if (mode === "paint" && !allowedColors.has(color)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Color is not in your allowed palette." });
    }

    const { rows: canvasRows } = await client.query(
      `
        SELECT
          cp.x,
          cp.y,
          cp.updated_by AS owner_id,
          CASE
            WHEN cp.owner_tag = '~Admin~' THEN 'Admin'
            WHEN cp.owner_tag = 'Admin' THEN 'Admin'
            WHEN cp.updated_by IS NOT NULL THEN COALESCE(NULLIF(u.username, ''), SPLIT_PART(u.email, '@', 1), cp.owner_tag)
            ELSE COALESCE(NULLIF(cp.owner_tag, ''), 'Guest')
          END AS owner_tag
        FROM canvas_pixels cp
        LEFT JOIN users u ON u.id = cp.updated_by
      `
    );
    const protectedGroups = buildProtectedGroups(canvasRows);
    const cells = buildBrushCells(x, y, brushSize);
    const blockedGroup = protectedGroups.find((group) => {
      if (!actorOwnershipKey || group.ownerKey === actorOwnershipKey) {
        return false;
      }

      return cells.some((cell) => isPointInsideProtectedGroup(group, cell.x, cell.y));
    });

    if (blockedGroup) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: `Protected space around ${blockedGroup.tag} is locked. Click the label to interact instead.`,
        protectedGroup: {
          ownerId: blockedGroup.ownerId,
          tag: blockedGroup.tag,
          x: blockedGroup.x,
          y: blockedGroup.y
        }
      });
    }

    if (userId) {
      await client.query("INSERT INTO paint_actions (user_id) VALUES ($1)", [userId]);
    } else if (isGuest) {
      req.session.guestPaintsRemaining = Math.max(0, remaining - 1);
    }

    const modifiedPixels = [];

    for (const cell of cells) {
      if (mode === "erase") {
        await client.query("DELETE FROM canvas_pixels WHERE x = $1 AND y = $2", [cell.x, cell.y]);
        if (userId) {
          await client.query(
            "INSERT INTO pixel_history (user_id, x, y, color_hex, action, brush_size) VALUES ($1, $2, $3, NULL, 'erase', $4)",
            [userId, cell.x, cell.y, brushSize]
          );
        }
        modifiedPixels.push({ x: cell.x, y: cell.y, color_hex: null, owner_id: null, owner_tag: null });
      } else {
        await client.query(
          `
            INSERT INTO canvas_pixels (x, y, color_hex, updated_by, owner_tag)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (x, y)
            DO UPDATE SET color_hex = EXCLUDED.color_hex, updated_by = EXCLUDED.updated_by, owner_tag = EXCLUDED.owner_tag, updated_at = NOW()
          `,
          [cell.x, cell.y, color, userId, ownerTag]
        );
        if (userId) {
          await client.query(
            "INSERT INTO pixel_history (user_id, x, y, color_hex, action, brush_size) VALUES ($1, $2, $3, $4, 'paint', $5)",
            [userId, cell.x, cell.y, color, brushSize]
          );
        }
        modifiedPixels.push({
          x: cell.x,
          y: cell.y,
          color_hex: color,
          owner_id: userId,
          owner_tag: ownerTag
        });
      }
    }

    await client.query("COMMIT");

    const nextRemaining = typeof remaining === "number" ? Math.max(0, remaining - 1) : null;
    const io = req.app.get("io");
    if (io) {
      io.emit("paint_applied", {
        mode,
        brushSize,
        userId,
        modifiedPixels
      });
    }

    return res.json({
      ok: true,
      remainingPaints: nextRemaining,
      modifiedPixels
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return next(error);
  } finally {
    client.release();
  }
});

router.get("/interactions/context", async (req, res, next) => {
  const targetUserId = Number(req.query.targetUserId);
  const targetOwnerTag = String(req.query.targetOwnerTag || "").trim();
  const targetGroupX = Number(req.query.groupX);
  const targetGroupY = Number(req.query.groupY);

  try {
    let isFriend = false;

    if (req.session && req.session.userId && Number.isInteger(targetUserId) && targetUserId > 0) {
      const { rows } = await pool.query(
        `
          SELECT 1
          FROM user_friends
          WHERE user_id = $1 AND friend_id = $2
          LIMIT 1
        `,
        [req.session.userId, targetUserId]
      );

      isFriend = rows.length > 0;
    }

    let bubbleTitle = null;
    if (Number.isInteger(targetGroupX) && Number.isInteger(targetGroupY) && targetGroupX >= 0 && targetGroupY >= 0) {
      const { rows: canvasRows } = await pool.query(
        `
          SELECT
            cp.x,
            cp.y,
            cp.updated_by AS owner_id,
            CASE
              WHEN cp.owner_tag = '~Admin~' THEN 'Admin'
              WHEN cp.owner_tag = 'Admin' THEN 'Admin'
              WHEN cp.updated_by IS NOT NULL THEN COALESCE(NULLIF(u.username, ''), SPLIT_PART(u.email, '@', 1), cp.owner_tag)
              ELSE COALESCE(NULLIF(cp.owner_tag, ''), 'Guest')
            END AS owner_tag
          FROM canvas_pixels cp
          LEFT JOIN users u ON u.id = cp.updated_by
        `
      );

      const groups = buildProtectedGroups(canvasRows);
      const targetGroup = resolveTargetGroup(groups, targetGroupX, targetGroupY, targetOwnerTag);
      if (targetGroup) {
        bubbleTitle = await getBubbleTitleForGroup(pool, targetGroup);
      }
    }

    return res.json({ isFriend, bubbleTitle });
  } catch (error) {
    return next(error);
  }
});

router.post("/interactions", requireAuth, async (req, res, next) => {
  const interactionType = String(req.body.interactionType || "").trim().toLowerCase();
  const targetUserIdValue = req.body.targetUserId;
  const targetOwnerTag = String(req.body.targetOwnerTag || "").trim();
  const targetGroupX = Number(req.body.groupX);
  const targetGroupY = Number(req.body.groupY);

  if (!["like", "dislike", "report", "love", "remove", "ban", "friend", "name"].includes(interactionType)) {
    return res.status(400).json({ error: "Unknown interaction type." });
  }

  const targetUserId = targetUserIdValue === null || targetUserIdValue === undefined || targetUserIdValue === ""
    ? null
    : Number(targetUserIdValue);

  if (targetUserId !== null && (!Number.isInteger(targetUserId) || targetUserId <= 0)) {
    return res.status(400).json({ error: "Target user is invalid." });
  }

  if (!targetOwnerTag && interactionType !== "remove" && interactionType !== "ban" && interactionType !== "name") {
    return res.status(400).json({ error: "Target owner is required." });
  }

  const actorIsAdmin = Boolean(req.session && req.session.isAdmin);
  const actorUserId = req.session.userId || null;
  const isOwnTargetByUser = actorUserId !== null && targetUserId !== null && targetUserId === actorUserId;
  const isOwnTargetByAdmin = actorIsAdmin && normalizeDisplayName(targetOwnerTag).toLowerCase() === "admin";
  const isOwnTarget = isOwnTargetByUser || isOwnTargetByAdmin;

  const allowedTypes = actorIsAdmin
    ? ["love", "remove", "ban", "name"]
    : ["like", "dislike", "report", "friend"].concat(isOwnTarget ? ["remove", "name"] : []);

  if (!allowedTypes.includes(interactionType)) {
    return res.status(400).json({ error: actorIsAdmin ? "Admins can only use love/remove/ban/name." : "Users can only use like/dislike/report/add friend, plus remove/name on their own bubble." });
  }

  if (interactionType === "friend" && targetUserId === null) {
    return res.status(400).json({ error: "Add Friend requires a registered user." });
  }

  if (!Number.isInteger(targetGroupX) || !Number.isInteger(targetGroupY) || targetGroupX < 0 || targetGroupY < 0) {
    return res.status(400).json({ error: "Target coordinates are invalid." });
  }

  if (targetUserId !== null && targetUserId === actorUserId && interactionType !== "remove" && interactionType !== "name") {
    return res.status(400).json({ error: "You cannot react to your own label." });
  }

  if (!actorIsAdmin && targetUserId !== null) {
    const { rows: blockedRows } = await pool.query(
      `
        SELECT 1
        FROM user_bans
        WHERE (user_id = $1 AND banned_user_id = $2)
           OR (user_id = $2 AND banned_user_id = $1)
        LIMIT 1
      `,
      [actorUserId, targetUserId]
    );

    if (blockedRows.length > 0 && interactionType !== "remove") {
      return res.status(403).json({ error: "This user is blocked." });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let adminModifiedPixels = [];
    let bubbleTitle = null;
    let interactionTargetUserId = targetUserId;
    let interactionGroupX = targetGroupX;
    let interactionGroupY = targetGroupY;
    let interactionOwnerTag = targetOwnerTag;

    let targetGroup = null;
    if (interactionType === "remove" || interactionType === "ban" || interactionType === "name") {
      const { rows: canvasRows } = await client.query(
        `
          SELECT
            cp.x,
            cp.y,
            cp.updated_by AS owner_id,
            CASE
              WHEN cp.owner_tag = '~Admin~' THEN 'Admin'
              WHEN cp.owner_tag = 'Admin' THEN 'Admin'
              WHEN cp.updated_by IS NOT NULL THEN COALESCE(NULLIF(u.username, ''), SPLIT_PART(u.email, '@', 1), cp.owner_tag)
              ELSE COALESCE(NULLIF(cp.owner_tag, ''), 'Guest')
            END AS owner_tag
          FROM canvas_pixels cp
          LEFT JOIN users u ON u.id = cp.updated_by
        `
      );

      const groups = buildProtectedGroups(canvasRows);
      targetGroup = resolveTargetGroup(groups, targetGroupX, targetGroupY, targetOwnerTag);
      if (targetGroup) {
        interactionGroupX = targetGroup.x;
        interactionGroupY = targetGroup.y;
        interactionOwnerTag = targetGroup.tag;
      }
    }

    if (interactionType === "remove") {
      if (!targetGroup) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Target bubble was not found." });
      }

      const isOwnResolvedGroup = actorIsAdmin
        ? targetGroup.ownerKey === "__ADMIN__"
        : targetGroup.ownerId !== null && Number(targetGroup.ownerId) === Number(actorUserId);

      if (!actorIsAdmin && !isOwnResolvedGroup) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "You can only remove your own bubble." });
      }

      await client.query(
        `
          DELETE FROM bubble_titles
          WHERE owner_key = $1
            AND target_group_x = $2
            AND target_group_y = $3
        `,
        [targetGroup.ownerKey, targetGroup.x, targetGroup.y]
      );

      for (const cellKey of targetGroup.cells) {
        const [x, y] = cellKey.split(",").map(Number);
        await client.query("DELETE FROM canvas_pixels WHERE x = $1 AND y = $2", [x, y]);
        adminModifiedPixels.push({ x, y, color_hex: null, owner_id: null, owner_tag: null });
      }
    }

    if (interactionType === "name") {
      if (!targetGroup) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Target bubble was not found." });
      }

      const isOwnResolvedGroup = actorIsAdmin
        ? targetGroup.ownerKey === "__ADMIN__"
        : targetGroup.ownerId !== null && Number(targetGroup.ownerId) === Number(actorUserId);

      if (!isOwnResolvedGroup) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "You can only name your own bubble." });
      }

      const requestedTitle = String(req.body.title || "").trim();
      if (!requestedTitle) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Title is required." });
      }

      bubbleTitle = requestedTitle.slice(0, 80);

      await client.query(
        `
          INSERT INTO bubble_titles (owner_key, target_group_x, target_group_y, title)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (owner_key, target_group_x, target_group_y)
          DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()
        `,
        [targetGroup.ownerKey, targetGroup.x, targetGroup.y, bubbleTitle]
      );
    }

    if (actorIsAdmin && interactionType === "ban") {
      if (targetUserId === null) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Ban requires a registered user target." });
      }

      const { rows: targetRows } = await client.query(
        "SELECT id, email FROM users WHERE id = $1 LIMIT 1",
        [targetUserId]
      );

      if (targetRows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Target user not found." });
      }

      const targetEmail = targetRows[0].email;

      const { rows: pixelRows } = await client.query(
        "SELECT x, y FROM canvas_pixels WHERE updated_by = $1",
        [targetUserId]
      );

      await client.query(
        `
          INSERT INTO blacklisted_emails (email, reason)
          VALUES (LOWER($1), 'banned by admin')
          ON CONFLICT (email)
          DO UPDATE SET reason = EXCLUDED.reason, created_at = NOW()
        `,
        [targetEmail]
      );

      await client.query("DELETE FROM bubble_titles WHERE owner_key = $1", [String(targetUserId)]);
      await client.query("DELETE FROM canvas_pixels WHERE updated_by = $1", [targetUserId]);
      await client.query("DELETE FROM users WHERE id = $1", [targetUserId]);
      interactionTargetUserId = null;

      adminModifiedPixels = pixelRows.map((row) => ({
        x: row.x,
        y: row.y,
        color_hex: null,
        owner_id: null,
        owner_tag: null
      }));
    }

    if (!actorIsAdmin && interactionType === "remove" && targetUserId !== null) {
      // For non-admin users, "remove" only applies to the actor's own owned bubble.
      // Record the actor as the interaction target so the saved interaction reflects
      // that the removal was against the actor-owned bubble, not the clicked user.
      interactionTargetUserId = actorUserId;
    }

    if (!actorIsAdmin && interactionType === "ban" && targetUserId !== null) {
      await client.query(
        `
          INSERT INTO user_bans (user_id, banned_user_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [actorUserId, targetUserId]
      );

      await client.query(
        `
          DELETE FROM user_friends
          WHERE (user_id = $1 AND friend_id = $2)
             OR (user_id = $2 AND friend_id = $1)
        `,
        [actorUserId, targetUserId]
      );
    }

    const { rows } = await client.query(
      `
        INSERT INTO canvas_interactions (
          actor_user_id,
          target_user_id,
          target_owner_tag,
          target_group_x,
          target_group_y,
          interaction_type
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, interaction_type
      `,
      [actorUserId, interactionTargetUserId, interactionOwnerTag || "Unknown", interactionGroupX, interactionGroupY, interactionType]
    );

    if (!actorIsAdmin && interactionType === "friend" && targetUserId !== null) {
      await client.query(
        `
          INSERT INTO user_friends (user_id, friend_id)
          VALUES ($1, $2), ($2, $1)
          ON CONFLICT DO NOTHING
        `,
        [actorUserId, targetUserId]
      );
    }

    await client.query("COMMIT");

    if (adminModifiedPixels.length > 0) {
      const io = req.app.get("io");
      if (io) {
        io.emit("paint_applied", {
          mode: "erase",
          brushSize: 1,
          userId: actorUserId,
          modifiedPixels: adminModifiedPixels
        });
      }
    }

    return res.json({
      ok: true,
      interactionId: rows[0].id,
      interactionType,
      modifiedPixels: adminModifiedPixels,
      bubbleTitle
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return next(error);
  } finally {
    client.release();
  }
});

router.post("/admin/reset-canvas", requireAdmin, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM canvas_pixels");
    await pool.query("DELETE FROM bubble_titles");

    const io = req.app.get("io");
    if (io) {
      io.emit("canvas_reset", {
        resetBy: req.session.adminUsername || "admin"
      });
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/admin/reset-daily-limit", requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `
        DELETE FROM paint_actions
        WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      `
    );

    return res.json({ ok: true, clearedActions: rowCount });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
