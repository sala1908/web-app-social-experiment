require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const session = require("express-session");
const pgSessionFactory = require("connect-pg-simple");
const { create } = require("express-handlebars");
const { pool } = require("./db/pool");
const authRoutes = require("./routes/auth");
const apiRoutes = require("./routes/api");
const pageRoutes = require("./routes/pages");
const { GRID_SIZE, MAX_BRUSH_SIZE, DAILY_MAX_PAINTS, COOLDOWN_SECONDS } = require("./config/constants");

function createApp() {
  const app = express();
  const PgSession = pgSessionFactory(session);

  const hbs = create({
    extname: ".hbs",
    helpers: {
      json(value) {
        return JSON.stringify(value);
      }
    }
  });

  app.engine(".hbs", hbs.engine);
  app.set("view engine", ".hbs");
  app.set("views", path.resolve(__dirname, "../views"));

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(morgan("dev"));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.resolve(__dirname, "../public")));

  app.use(
    session({
      store: new PgSession({
        pool,
        tableName: "session",
        createTableIfMissing: true
      }),
      secret: process.env.SESSION_SECRET || "development-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7,
        httpOnly: true,
        sameSite: "lax"
      }
    })
  );

  app.use(async (req, res, next) => {
    res.locals.appConfig = {
      gridSize: GRID_SIZE,
      maxBrushSize: MAX_BRUSH_SIZE,
      dailyMaxPaints: DAILY_MAX_PAINTS,
      cooldownSeconds: COOLDOWN_SECONDS
    };

    res.locals.currentUser = null;
    if (req.session.isAdmin) {
      req.user = {
        id: null,
        email: req.session.adminUsername || "admin",
        username: "admin",
        displayName: "admin",
        xp: 0,
        level: 0,
        palette_tokens: 999,
        selected_palette_id: req.session.adminPaletteId || "starter_classic",
        isAdmin: true
      };
      res.locals.currentUser = req.user;
      return next();
    }

    if (!req.session.userId) {
      return next();
    }

    try {
      const { rows } = await pool.query("SELECT id, email, username, xp, level, palette_tokens, selected_palette_id, tutorial_seen FROM users WHERE id = $1", [req.session.userId]);
      req.user = rows[0]
        ? {
            ...rows[0],
            displayName: rows[0].username || rows[0].email.split("@")[0],
            isAdmin: false
          }
        : null;
      res.locals.currentUser = req.user;
      return next();
    } catch (error) {
      return next(error);
    }
  });

  app.use(pageRoutes);
  app.use("/auth", authRoutes);
  app.use("/api", apiRoutes);

  app.use((error, req, res, next) => {
    console.error(error);

    if (req.path.startsWith("/api")) {
      return res.status(500).json({ error: "Internal server error." });
    }

    return res.status(500).render("error", { message: "Something went wrong." });
  });

  return app;
}

module.exports = { createApp };
