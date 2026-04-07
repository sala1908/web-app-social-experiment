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

router.get("/canvas", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT cp.x, cp.y, cp.color_hex, cp.updated_by AS owner_id, cp.owner_tag
        FROM canvas_pixels cp
      `
    );
    return res.json({ gridSize: GRID_SIZE, pixels: rows });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", (req, res) => {
  return res.json({
    authenticated: Boolean(req.user),
    user: req.user || null
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
    ? "~Admin~"
    : req.user && req.user.email
      ? req.user.email.slice(0, 3).toUpperCase()
      : "Guest";
  const isGuest = !userId && !(req.session && req.session.isAdmin);
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

    if (userId) {
      await client.query("INSERT INTO paint_actions (user_id) VALUES ($1)", [userId]);
    } else if (isGuest) {
      req.session.guestPaintsRemaining = Math.max(0, remaining - 1);
    }

    const cells = buildBrushCells(x, y, brushSize);
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

router.post("/admin/reset-canvas", requireAdmin, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM canvas_pixels");

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
