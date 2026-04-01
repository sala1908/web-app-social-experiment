const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db/pool");

const router = express.Router();
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "12345678";

router.post("/register", async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";

  if (email === ADMIN_USERNAME) {
    return res.status(400).render("register", { title: "Register", error: "This username is reserved." });
  }

  if (!email || !password) {
    return res.status(400).render("register", { title: "Register", error: "Email and password are required." });
  }

  if (password.length < 8) {
    return res.status(400).render("register", { title: "Register", error: "Password must be at least 8 characters." });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [email, passwordHash]
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
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";

  if (email === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.userId = null;
    req.session.isAdmin = true;
    req.session.adminUsername = ADMIN_USERNAME;
    delete req.session.guestPaintsRemaining;
    return res.redirect("/");
  }

  try {
    const { rows } = await pool.query("SELECT id, email, password_hash FROM users WHERE email = $1", [email]);
    const user = rows[0];

    if (!user) {
      return res.status(401).render("login", { title: "Login", error: "Invalid credentials." });
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
