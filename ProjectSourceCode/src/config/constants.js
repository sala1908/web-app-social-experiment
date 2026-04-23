const GRID_SIZE = 1024;
const MAX_BRUSH_SIZE = 5;
const DAILY_MAX_PAINTS = 100;
const GUEST_MAX_PAINTS = Math.floor(DAILY_MAX_PAINTS / 2);
const COOLDOWN_SECONDS = 0;
const XP_PER_LEVEL = 100;
const DAILY_PAINT_GROWTH_RATE = 1.25;
const XP_GROWTH_RATE = 1.15;

function normalizeLevel(level) {
  const parsed = Number(level);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function getDailyPaintLimit(level = 0) {
  const normalizedLevel = normalizeLevel(level);
  return Math.max(1, Math.ceil(DAILY_MAX_PAINTS * Math.pow(DAILY_PAINT_GROWTH_RATE, normalizedLevel)));
}

function getXpRequiredForNextLevel(level = 0) {
  const normalizedLevel = normalizeLevel(level);
  return Math.max(1, Math.ceil(XP_PER_LEVEL * Math.pow(XP_GROWTH_RATE, normalizedLevel)));
}

function getLevelFromXp(xp = 0) {
  let remainingXp = Math.max(0, Math.floor(Number(xp) || 0));
  let level = 0;

  while (remainingXp >= getXpRequiredForNextLevel(level)) {
    remainingXp -= getXpRequiredForNextLevel(level);
    level += 1;
  }

  return level;
}

module.exports = {
  GRID_SIZE,
  MAX_BRUSH_SIZE,
  DAILY_MAX_PAINTS,
  GUEST_MAX_PAINTS,
  COOLDOWN_SECONDS,
  XP_PER_LEVEL,
  DAILY_PAINT_GROWTH_RATE,
  XP_GROWTH_RATE,
  getDailyPaintLimit,
  getXpRequiredForNextLevel,
  getLevelFromXp
};
