function requireAuth(req, res, next) {
  if (!req.session || (!req.session.userId && !req.session.isAdmin)) {
    return res.status(401).json({ error: "Authentication required." });
  }

  return next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) {
    return res.status(403).json({ error: "Admin access required." });
  }

  return next();
}

module.exports = { requireAuth, requireAdmin };
