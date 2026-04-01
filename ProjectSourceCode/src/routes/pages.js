const express = require("express");

const router = express.Router();

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

module.exports = router;
