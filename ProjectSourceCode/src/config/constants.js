const GRID_SIZE = 1024;
const MAX_BRUSH_SIZE = 5;
const DAILY_MAX_PAINTS = 100;
const GUEST_MAX_PAINTS = Math.floor(DAILY_MAX_PAINTS / 2);
const COOLDOWN_SECONDS = 0;
const XP_PER_LEVEL = 100;


const DEFAULT_PALETTE = [
  "#000000",
  "#ffffff",
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#ffff00",
  "#ff7f00",
  "#00ffff",
  "#ff00ff",
  "#7f7f7f"
];


module.exports = {
  GRID_SIZE,
  MAX_BRUSH_SIZE,
  DAILY_MAX_PAINTS,
  GUEST_MAX_PAINTS,
  COOLDOWN_SECONDS,
  XP_PER_LEVEL,
  DEFAULT_PALETTE
};
