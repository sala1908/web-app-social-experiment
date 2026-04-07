const express = require('express');
const router = express.Router();

// GET /about — public, no auth required
router.get('/', (req, res) => {
  res.render('about', { title: 'About Us' });
});

module.exports = router;