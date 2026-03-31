const express = require("express");
const { pool } = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { GRID_SIZE, MAX_BRUSH_SIZE, DAILY_MAX_PAINTS } = require("../config/constants");

const router = express.Router();

function isHexColor(color) {
  return /^#[0-9A-F]{6}$/i.test(color || "");
}

async function getAllowedColors(dbClient, userId) {
  const { rows } = await dbClient.query(
    `
      SELECT color_hex FROM default_palette
      UNION
      SELECT color_hex FROM user_palette WHERE user_id = $1
    `,
    [userId]
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
    const { rows } = await pool.query("SELECT x, y, color_hex FROM canvas_pixels");
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

router.get("/me/limits", requireAuth, async (req, res, next) => {
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

router.get("/palette", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT color_hex, 'default' AS scope FROM default_palette
        UNION
        SELECT color_hex, 'user' AS scope FROM user_palette WHERE user_id = $1
        ORDER BY color_hex ASC
      `,
      [req.session.userId]
    );

    return res.json({ palette: rows });
  } catch (error) {
    return next(error);
  }
});

router.post("/palette", requireAuth, async (req, res, next) => {
  const color = String(req.body.color || "").toUpperCase();
  if (!isHexColor(color)) {
    return res.status(400).json({ error: "Color must be a valid hex value like #A1B2C3." });
  }

  try {
    await pool.query(
      "INSERT INTO user_palette (user_id, color_hex) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [req.session.userId, color]
    );
    return res.status(201).json({ color });
  } catch (error) {
    return next(error);
  }
});

router.delete("/palette/:color", requireAuth, async (req, res, next) => {
  const color = String(req.params.color || "").toUpperCase();
  if (!isHexColor(color)) {
    return res.status(400).json({ error: "Invalid color." });
  }

  try {
    await pool.query("DELETE FROM user_palette WHERE user_id = $1 AND color_hex = $2", [req.session.userId, color]);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.post("/paint", requireAuth, async (req, res, next) => {
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const remaining = await getRemainingPaints(client, req.session.userId);
    if (remaining <= 0) {
      await client.query("ROLLBACK");
      return res.status(429).json({ error: "Daily paint limit reached.", dailyMaxPaints: DAILY_MAX_PAINTS, remainingPaints: 0 });
    }

    const allowedColors = await getAllowedColors(client, req.session.userId);
    const color = rawColor.toUpperCase();

    if (mode === "paint" && !allowedColors.has(color)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Color is not in your allowed palette." });
    }

    await client.query("INSERT INTO paint_actions (user_id) VALUES ($1)", [req.session.userId]);

    const cells = buildBrushCells(x, y, brushSize);
    const modifiedPixels = [];

    for (const cell of cells) {
      if (mode === "erase") {
        await client.query("DELETE FROM canvas_pixels WHERE x = $1 AND y = $2", [cell.x, cell.y]);
        await client.query(
          "INSERT INTO pixel_history (user_id, x, y, color_hex, action, brush_size) VALUES ($1, $2, $3, NULL, 'erase', $4)",
          [req.session.userId, cell.x, cell.y, brushSize]
        );
        modifiedPixels.push({ x: cell.x, y: cell.y, color_hex: null });
      } else {
        await client.query(
          `
            INSERT INTO canvas_pixels (x, y, color_hex, updated_by)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (x, y)
            DO UPDATE SET color_hex = EXCLUDED.color_hex, updated_by = EXCLUDED.updated_by, updated_at = NOW()
          `,
          [cell.x, cell.y, color, req.session.userId]
        );
        await client.query(
          "INSERT INTO pixel_history (user_id, x, y, color_hex, action, brush_size) VALUES ($1, $2, $3, $4, 'paint', $5)",
          [req.session.userId, cell.x, cell.y, color, brushSize]
        );
        modifiedPixels.push({ x: cell.x, y: cell.y, color_hex: color });
      }
    }

    await client.query("COMMIT");

    const nextRemaining = Math.max(0, remaining - 1);
    const io = req.app.get("io");
    if (io) {
      io.emit("paint_applied", {
        mode,
        brushSize,
        userId: req.session.userId,
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

module.exports = router;
