const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db/pool");

const router = express.Router();
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

router.post("/register", async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const username = (req.body.username || "").trim().toLowerCase();
  const password = req.body.password || "";

  if (username === ADMIN_USERNAME) {
    return res.status(400).render("register", { title: "Register", error: "This username is reserved." });
  }

  if (!email || !username || !password) {
    return res.status(400).render("register", { title: "Register", error: "Username, email and password are required." });
  }

  if (!/^[a-z0-9_][a-z0-9_-]{2,23}$/.test(username)) {
    return res.status(400).render("register", { title: "Register", error: "Username must be 3-24 characters and use letters, numbers, hyphens, or underscores." });
  }

  if (password.length < 8) {
    return res.status(400).render("register", { title: "Register", error: "Password must be at least 8 characters." });
  }

  try {
    const blacklistResult = await pool.query(
      "SELECT 1 FROM blacklisted_emails WHERE LOWER(email) = LOWER($1) LIMIT 1",
      [email]
    );

    if (blacklistResult.rows.length > 0) {
      return res.status(403).render("register", { title: "Register", error: "This email is banned from registering." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const homeX = Math.floor(Math.random() * 1024);
    const homeY = Math.floor(Math.random() * 1024);
    const { rows } = await pool.query(
      "INSERT INTO users (email, username, password_hash, palette_tokens, home_x, home_y) VALUES ($1, $2, $3, 1, $4, $5) RETURNING id, email, username",
      [email, username, passwordHash, homeX, homeY]
    );

    req.session.userId = rows[0].id;
    req.session.isAdmin = false;
    delete req.session.guestPaintsRemaining;
    return res.redirect("/");
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).render("register", { title: "Register", error: "Email already exists." });
    }
    return res.status(500).render("register", { title: "Register", error: "Unable to create account." });
  }
});

router.post("/login", async (req, res) => {
  const credential = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";

  if (credential === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.userId = null;
    req.session.isAdmin = true;
    req.session.adminUsername = ADMIN_USERNAME;
    delete req.session.guestPaintsRemaining;
    return res.redirect("/");
  }

  try {
    const { rows } = await pool.query("SELECT id, email, username, password_hash, banned FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $1", [credential]);
    const user = rows[0];

    if (!user) {
      return res.status(401).render("login", { title: "Login", error: "Invalid credentials." });
    }

    if (user.banned) {
      return res.status(403).render("login", { title: "Login", error: "Your account has been banned." });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).render("login", { title: "Login", error: "Invalid credentials." });
    }

    req.session.userId = user.id;
    req.session.isAdmin = false;
    req.session.adminUsername = null;
    delete req.session.guestPaintsRemaining;
    return res.redirect("/");
  } catch (error) {
    return res.status(500).render("login", { title: "Login", error: "Unable to login." });
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/");
  });
});

module.exports = router;
