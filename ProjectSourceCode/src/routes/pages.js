const express = require("express");

const router = express.Router();

const { pool } = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

router.get("/", (req, res) => {
  res.render("home", {
    title: "Web-E-Vil",
    isAuthenticated: Boolean(req.user),
    isAdmin: Boolean(req.session && req.session.isAdmin),
    user: req.user || null
  });
});

router.get("/login", (req, res) => {
  if (req.user) {
    return res.redirect("/");
  }

  return res.render("login", { title: "Login" });
});

router.get("/register", (req, res) => {
  if (req.user) {
    return res.redirect("/");
  }

  return res.render("register", { title: "Register" });
});


router.get("/profile", requireAuth, async (req, res, next) => {
  try {
    // Get total paint actions and pixels currently on canvas
    const statsResult = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM paint_actions WHERE user_id = $1) AS total_paints,
        (SELECT COUNT(*) FROM canvas_pixels WHERE updated_by = $1) AS pixels_placed`,
      [req.user.id]
    );

    // Get their custom palette colors
    const paletteResult = await pool.query(
      `SELECT color_hex FROM user_palette WHERE user_id = $1 ORDER BY created_at ASC`,
      [req.user.id]
    );

    // Get account creation date
    const userResult = await pool.query(
      `SELECT created_at FROM users WHERE id = $1`,
      [req.user.id]
    );

    res.render("profile", {
      title: "My Profile",
      user: req.user,
      stats: statsResult.rows[0],
      palette: paletteResult.rows,
      memberSince: userResult.rows[0].created_at
    });
  } catch (error) {
    next(error);
  }
});


module.exports = router;
