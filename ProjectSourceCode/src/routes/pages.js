const express = require("express");
const { pool } = require("../db/pool");

const router = express.Router();

function normalizeDisplayName(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "Guest";
  }

  if (text.toLowerCase() === "admin" || text === "~Admin~") {
    return "Admin";
  }

  return text;
}

function formatDate(dateValue) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(new Date(dateValue));
}

function formatAccountAge(createdAt) {
  const createdDate = new Date(createdAt);
  const ageMs = Math.max(0, Date.now() - createdDate.getTime());
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  if (ageDays <= 0) {
    return "Joined today";
  }

  if (ageDays === 1) {
    return "Joined 1 day ago";
  }

  return `Joined ${ageDays} days ago`;
}

function groupPalettes(rows, selectedPaletteId = null) {
  const byPaletteId = new Map();

  for (const row of rows) {
    if (!byPaletteId.has(row.palette_id)) {
      byPaletteId.set(row.palette_id, {
        paletteId: row.palette_id,
        name: row.name,
        description: row.description,
        isStarter: Boolean(row.is_starter),
        isSelected: row.palette_id === selectedPaletteId,
        colors: []
      });
    }

    if (row.color_hex) {
      byPaletteId.get(row.palette_id).colors.push(String(row.color_hex).toUpperCase());
    }
  }

  return Array.from(byPaletteId.values());
}

async function buildProfileViewModel(req) {
  if (!req.user && !req.session?.isAdmin) {
    return null;
  }

  if (req.session?.isAdmin) {
    const { rows: likeRows } = await pool.query(
      `
        SELECT COUNT(*)::int AS total_likes
        FROM canvas_interactions
        WHERE interaction_type = 'like'
          AND LOWER(target_owner_tag) = 'admin'
      `
    );

    const { rows: paletteRows } = await pool.query(
      `
        SELECT
          psi.palette_id,
          psi.name,
          psi.description,
          psi.is_starter,
          psc.color_hex,
          psc.color_order
        FROM palette_store_items psi
        LEFT JOIN palette_store_colors psc ON psc.palette_id = psi.palette_id
        ORDER BY psi.is_starter DESC, psi.palette_id ASC, psc.color_order ASC, psc.color_hex ASC
      `
    );

    return {
      isAdmin: true,
      displayName: "Admin",
      email: req.session.adminUsername || "admin",
      level: 0,
      xp: 0,
      totalLikes: likeRows[0] ? likeRows[0].total_likes : 0,
      accountAgeLabel: "System account",
      joinedOnLabel: "Not applicable",
      friends: [],
      friendCount: 0,
      unlockedPalettes: groupPalettes(paletteRows, req.session.adminPaletteId || "starter_classic"),
      selectedPaletteId: req.session.adminPaletteId || "starter_classic"
    };
  }

  const userId = req.user.id;
  const { rows: userRows } = await pool.query(
    `
      SELECT id, email, username, xp, level, created_at, selected_palette_id
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  if (userRows.length === 0) {
    return null;
  }

  const user = userRows[0];
  const displayName = normalizeDisplayName(req.user.displayName || user.username || user.email.split("@")[0]);

  const [likeResult, friendsResult, paletteResult] = await Promise.all([
    pool.query(
      `
        SELECT COUNT(*)::int AS total_likes
        FROM canvas_interactions
        WHERE target_user_id = $1
          AND interaction_type = 'like'
      `,
      [userId]
    ),
    pool.query(
      `
        SELECT
          u.id,
          u.email,
          u.username,
          u.created_at
        FROM user_friends uf
        INNER JOIN users u ON u.id = uf.friend_id
        WHERE uf.user_id = $1
        ORDER BY LOWER(COALESCE(NULLIF(u.username, ''), SPLIT_PART(u.email, '@', 1), u.email)), u.id
      `,
      [userId]
    ),
    pool.query(
      `
        SELECT
          psi.palette_id,
          psi.name,
          psi.description,
          psi.is_starter,
          psc.color_hex,
          psc.color_order
        FROM palette_store_items psi
        LEFT JOIN palette_store_colors psc ON psc.palette_id = psi.palette_id
        LEFT JOIN user_unlocked_palettes uup
          ON uup.palette_id = psi.palette_id
         AND uup.user_id = $1
        WHERE psi.is_starter = true OR uup.user_id IS NOT NULL
        ORDER BY psi.is_starter DESC, psi.palette_id ASC, psc.color_order ASC, psc.color_hex ASC
      `,
      [userId]
    )
  ]);

  const friends = friendsResult.rows.map((friendRow) => ({
    id: friendRow.id,
    displayName: normalizeDisplayName(friendRow.username || friendRow.email.split("@")[0]),
    email: friendRow.email,
    joinedOnLabel: formatDate(friendRow.created_at)
  }));

  return {
    isAdmin: false,
    displayName,
    email: user.email,
    level: Number(user.level) || 0,
    xp: Number(user.xp) || 0,
    totalLikes: likeResult.rows[0] ? likeResult.rows[0].total_likes : 0,
    accountAgeLabel: formatAccountAge(user.created_at),
    joinedOnLabel: formatDate(user.created_at),
    friends,
    friendCount: friends.length,
    unlockedPalettes: groupPalettes(paletteResult.rows, user.selected_palette_id || "starter_classic"),
    selectedPaletteId: user.selected_palette_id || "starter_classic"
  };
}

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

router.get("/profile", async (req, res, next) => {
  try {
    if (!req.user && !req.session?.isAdmin) {
      return res.redirect("/login");
    }

    const profile = await buildProfileViewModel(req);
    if (!profile) {
      return res.redirect("/login");
    }

    return res.render("profile", {
      title: `${profile.displayName} | Web-E-Vil`,
      profile,
      isAuthenticated: true,
      isAdmin: profile.isAdmin,
      user: {
        ...req.user,
        displayName: profile.displayName,
        email: profile.email,
        level: profile.level,
        xp: profile.xp,
        isAdmin: profile.isAdmin
      }
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
