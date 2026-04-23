CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT,
  password_hash TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS palette_tokens INTEGER NOT NULL DEFAULT 1;

ALTER TABLE users
  ALTER COLUMN palette_tokens SET DEFAULT 1;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS selected_palette_id TEXT NOT NULL DEFAULT 'starter_classic';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tutorial_seen BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_limit_override INTEGER;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS home_x INTEGER DEFAULT 512;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS home_y INTEGER DEFAULT 512;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS default_palette (
  color_hex TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (color_hex ~* '^#[0-9A-F]{6}$')
);

CREATE TABLE IF NOT EXISTS user_palette (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  color_hex TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, color_hex),
  CHECK (color_hex ~* '^#[0-9A-F]{6}$')
);

CREATE TABLE IF NOT EXISTS palette_store_items (
  palette_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_starter BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS palette_store_colors (
  palette_id TEXT NOT NULL REFERENCES palette_store_items(palette_id) ON DELETE CASCADE,
  color_hex TEXT NOT NULL,
  color_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (palette_id, color_hex),
  CHECK (color_hex ~* '^#[0-9A-F]{6}$')
);

CREATE TABLE IF NOT EXISTS user_unlocked_palettes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  palette_id TEXT NOT NULL REFERENCES palette_store_items(palette_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, palette_id)
);

CREATE INDEX IF NOT EXISTS idx_palette_store_colors_palette_order ON palette_store_colors (palette_id, color_order ASC, color_hex ASC);

CREATE TABLE IF NOT EXISTS level_palette_colors (
  color_hex TEXT PRIMARY KEY,
  color_family TEXT NOT NULL,
  min_level INTEGER NOT NULL CHECK (min_level >= 0),
  shade_tier INTEGER NOT NULL DEFAULT 0 CHECK (shade_tier >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (color_hex ~* '^#[0-9A-F]{6}$')
);

CREATE TABLE IF NOT EXISTS user_palette_unlocks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  color_hex TEXT NOT NULL REFERENCES level_palette_colors(color_hex) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, color_hex)
);

CREATE INDEX IF NOT EXISTS idx_level_palette_min_level_tier ON level_palette_colors (min_level, shade_tier);

CREATE TABLE IF NOT EXISTS canvas_pixels (
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  color_hex TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (x, y),
  CHECK (x >= 0 AND y >= 0),
  CHECK (color_hex ~* '^#[0-9A-F]{6}$')
);

CREATE TABLE IF NOT EXISTS user_bans (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, banned_user_id),
  CHECK (user_id <> banned_user_id)
);

CREATE TABLE IF NOT EXISTS blacklisted_emails (
  email TEXT PRIMARY KEY,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bubble_titles (
  owner_key TEXT NOT NULL,
  target_group_x INTEGER NOT NULL,
  target_group_y INTEGER NOT NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_key, target_group_x, target_group_y),
  CHECK (target_group_x >= 0 AND target_group_y >= 0),
  CHECK (char_length(trim(title)) BETWEEN 1 AND 80)
);

CREATE TABLE IF NOT EXISTS canvas_interactions (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_owner_tag TEXT NOT NULL,
  target_group_x INTEGER NOT NULL,
  target_group_y INTEGER NOT NULL,
  interaction_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (interaction_type IN ('like', 'dislike', 'report', 'love', 'remove', 'ban', 'friend', 'name')),
  CHECK (target_group_x >= 0 AND target_group_y >= 0)
);

ALTER TABLE canvas_interactions
  ALTER COLUMN actor_user_id DROP NOT NULL;

ALTER TABLE canvas_interactions
  DROP CONSTRAINT IF EXISTS canvas_interactions_interaction_type_check;

ALTER TABLE canvas_interactions
  ADD CONSTRAINT canvas_interactions_interaction_type_check
  CHECK (interaction_type IN ('like', 'dislike', 'report', 'love', 'remove', 'ban', 'friend', 'name'));

CREATE TABLE IF NOT EXISTS user_friends (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);

CREATE INDEX IF NOT EXISTS idx_canvas_interactions_target_time ON canvas_interactions (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_friends_friend_time ON user_friends (friend_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_bans_banned_time ON user_bans (banned_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blacklisted_emails_created ON blacklisted_emails (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bubble_titles_updated ON bubble_titles (updated_at DESC);

CREATE TABLE IF NOT EXISTS paint_actions (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pixel_history (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  color_hex TEXT,
  action TEXT NOT NULL,
  brush_size INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (x >= 0 AND y >= 0),
  CHECK (action IN ('paint', 'erase')),
  CHECK (brush_size >= 1)
);

CREATE INDEX IF NOT EXISTS idx_paint_actions_user_time ON paint_actions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pixel_history_user_time ON pixel_history (user_id, created_at DESC);

INSERT INTO default_palette (color_hex)
VALUES
  ('#000000'),
  ('#FFFFFF'),
  ('#FF0000'),
  ('#00FF00'),
  ('#0000FF'),
  ('#FFFF00'),
  ('#FF7F00'),
  ('#00FFFF'),
  ('#FF00FF'),
  ('#7F7F7F')
ON CONFLICT DO NOTHING;

INSERT INTO palette_store_items (palette_id, name, description, is_starter)
VALUES
  ('starter_classic', 'Starter Classic', 'Black, white, and gray starter palette.', true),
  ('sunset_burst', 'Sunset Burst', 'Warm sunset-inspired hues.', false),
  ('ocean_bloom', 'Ocean Bloom', 'Cool sea and sky tones.', false),
  ('forest_moss', 'Forest Moss', 'Natural greens and earthy tones.', false),
  ('royal_gem', 'Royal Gem', 'Bold jewel purples and violets.', false),
  ('candy_pop', 'Candy Pop', 'Bright candy pinks and blushes.', false),
  ('desert_dusk', 'Desert Dusk', 'Muted clay and sand shades.', false),
  ('arctic_neon', 'Arctic Neon', 'Frosty neons and deep navy.', false),
  ('retro_arcade', 'Retro Arcade', 'Vintage arcade inspired palette.', false),
  ('lava_core', 'Lava Core', 'Fire reds and glowing amber.', false),
  ('pastel_dream', 'Pastel Dream', 'Soft playful pastels.', false),
  ('tropical_punch', 'Tropical Punch', 'Bright island fruit tones.', false),
  ('midnight_city', 'Midnight City', 'Neon signs over deep night shades.', false),
  ('spring_garden', 'Spring Garden', 'Fresh spring florals and greens.', false),
  ('autumn_harvest', 'Autumn Harvest', 'Cozy fall tones with contrast.', false),
  ('cosmic_glow', 'Cosmic Glow', 'Space-inspired darks and luminous accents.', false),
  ('festival_lights', 'Festival Lights', 'Colorful celebration palette.', false),
  ('coastal_boardwalk', 'Coastal Boardwalk', 'Sunny beach and boardwalk mix.', false),
  ('synthwave_drive', 'Synthwave Drive', '80s-inspired magenta, cyan, and sunset neon.', false),
  ('earth_and_sky', 'Earth and Sky', 'Balanced natural blues, greens, and earth tones.', false),
  ('comic_pop', 'Comic Pop', 'High-contrast pop-art colors.', false)
ON CONFLICT (palette_id) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_starter = EXCLUDED.is_starter;

INSERT INTO palette_store_colors (palette_id, color_hex, color_order)
VALUES
  ('starter_classic', '#000000', 1),
  ('starter_classic', '#FFFFFF', 2),
  ('starter_classic', '#7F7F7F', 3),

  ('sunset_burst', '#FF595E', 1),
  ('sunset_burst', '#FF924C', 2),
  ('sunset_burst', '#FFCA3A', 3),
  ('sunset_burst', '#C5CA30', 4),
  ('sunset_burst', '#8AC926', 5),

  ('ocean_bloom', '#003049', 1),
  ('ocean_bloom', '#0077B6', 2),
  ('ocean_bloom', '#00B4D8', 3),
  ('ocean_bloom', '#90E0EF', 4),
  ('ocean_bloom', '#CAF0F8', 5),

  ('forest_moss', '#1B4332', 1),
  ('forest_moss', '#2D6A4F', 2),
  ('forest_moss', '#40916C', 3),
  ('forest_moss', '#74C69D', 4),
  ('forest_moss', '#B7E4C7', 5),

  ('royal_gem', '#240046', 1),
  ('royal_gem', '#5A189A', 2),
  ('royal_gem', '#7B2CBF', 3),
  ('royal_gem', '#9D4EDD', 4),
  ('royal_gem', '#C77DFF', 5),

  ('candy_pop', '#FF4D6D', 1),
  ('candy_pop', '#FF8FA3', 2),
  ('candy_pop', '#FFB3C1', 3),
  ('candy_pop', '#FB6F92', 4),
  ('candy_pop', '#FCD5CE', 5),

  ('desert_dusk', '#6C584C', 1),
  ('desert_dusk', '#A98467', 2),
  ('desert_dusk', '#DDBEA9', 3),
  ('desert_dusk', '#FFE8D6', 4),
  ('desert_dusk', '#CB997E', 5),

  ('arctic_neon', '#0B132B', 1),
  ('arctic_neon', '#1C2541', 2),
  ('arctic_neon', '#3A506B', 3),
  ('arctic_neon', '#5BC0BE', 4),
  ('arctic_neon', '#6FFFE9', 5),

  ('retro_arcade', '#2B2D42', 1),
  ('retro_arcade', '#8D99AE', 2),
  ('retro_arcade', '#EF233C', 3),
  ('retro_arcade', '#EDF2F4', 4),
  ('retro_arcade', '#F4A261', 5),

  ('lava_core', '#7F0000', 1),
  ('lava_core', '#B22222', 2),
  ('lava_core', '#E63946', 3),
  ('lava_core', '#F77F00', 4),
  ('lava_core', '#FCBF49', 5),

  ('pastel_dream', '#A0C4FF', 1),
  ('pastel_dream', '#BDB2FF', 2),
  ('pastel_dream', '#FFC6FF', 3),
  ('pastel_dream', '#FDFFB6', 4),
  ('pastel_dream', '#CAFFBF', 5),

  ('tropical_punch', '#06D6A0', 1),
  ('tropical_punch', '#1B9AAA', 2),
  ('tropical_punch', '#FFD166', 3),
  ('tropical_punch', '#EF476F', 4),
  ('tropical_punch', '#8338EC', 5),

  ('midnight_city', '#0D1B2A', 1),
  ('midnight_city', '#1B263B', 2),
  ('midnight_city', '#415A77', 3),
  ('midnight_city', '#E0E1DD', 4),
  ('midnight_city', '#F72585', 5),

  ('spring_garden', '#2A9D8F', 1),
  ('spring_garden', '#52B788', 2),
  ('spring_garden', '#B7E4C7', 3),
  ('spring_garden', '#F4A261', 4),
  ('spring_garden', '#E76F51', 5),

  ('autumn_harvest', '#7F5539', 1),
  ('autumn_harvest', '#B08968', 2),
  ('autumn_harvest', '#D4A373', 3),
  ('autumn_harvest', '#E9C46A', 4),
  ('autumn_harvest', '#2A9D8F', 5),

  ('cosmic_glow', '#10002B', 1),
  ('cosmic_glow', '#3C096C', 2),
  ('cosmic_glow', '#7B2CBF', 3),
  ('cosmic_glow', '#00B4D8', 4),
  ('cosmic_glow', '#E9FF70', 5),

  ('festival_lights', '#D7263D', 1),
  ('festival_lights', '#F46036', 2),
  ('festival_lights', '#2E294E', 3),
  ('festival_lights', '#1B998B', 4),
  ('festival_lights', '#C5D86D', 5),

  ('coastal_boardwalk', '#003049', 1),
  ('coastal_boardwalk', '#669BBC', 2),
  ('coastal_boardwalk', '#FDF0D5', 3),
  ('coastal_boardwalk', '#EAE2B7', 4),
  ('coastal_boardwalk', '#D62828', 5),

  ('synthwave_drive', '#2B2D42', 1),
  ('synthwave_drive', '#8D99AE', 2),
  ('synthwave_drive', '#EF233C', 3),
  ('synthwave_drive', '#4CC9F0', 4),
  ('synthwave_drive', '#F15BB5', 5),

  ('earth_and_sky', '#386641', 1),
  ('earth_and_sky', '#6A994E', 2),
  ('earth_and_sky', '#A7C957', 3),
  ('earth_and_sky', '#3A86FF', 4),
  ('earth_and_sky', '#8338EC', 5),

  ('comic_pop', '#000000', 1),
  ('comic_pop', '#FFFFFF', 2),
  ('comic_pop', '#FFBE0B', 3),
  ('comic_pop', '#FB5607', 4),
  ('comic_pop', '#3A86FF', 5)
ON CONFLICT (palette_id, color_hex) DO UPDATE
SET color_order = EXCLUDED.color_order;

INSERT INTO level_palette_colors (color_hex, color_family, min_level, shade_tier)
VALUES
  ('#000000', 'black', 0, 0),
  ('#FFFFFF', 'white', 0, 0),
  ('#7F7F7F', 'gray', 0, 0),

  ('#3F3F3F', 'gray', 1, 0),
  ('#5F5F5F', 'gray', 1, 0),
  ('#9F9F9F', 'gray', 1, 0),
  ('#BFBFBF', 'gray', 1, 0),

  ('#FF0000', 'red', 2, 0),
  ('#00FF00', 'green', 2, 0),
  ('#0000FF', 'blue', 2, 0),

  ('#800080', 'purple', 3, 0),
  ('#FF7F00', 'orange', 3, 0),

  ('#FFFF00', 'yellow', 4, 0),
  ('#00FFFF', 'cyan', 4, 0),
  ('#FF00FF', 'magenta', 4, 0),
  ('#8B4513', 'brown', 4, 0),
  ('#FFC0CB', 'pink', 4, 0),

  ('#1A1A1A', 'black', 0, 1),
  ('#E6E6E6', 'white', 0, 1),
  ('#A0A0A0', 'gray', 1, 1),
  ('#CC0000', 'red', 2, 1),
  ('#00CC00', 'green', 2, 1),
  ('#0000CC', 'blue', 2, 1),
  ('#9932CC', 'purple', 3, 1),
  ('#FFA64D', 'orange', 3, 1),
  ('#FFD700', 'yellow', 4, 1),
  ('#00B7C7', 'cyan', 4, 1),
  ('#C71585', 'magenta', 4, 1),
  ('#A0522D', 'brown', 4, 1),
  ('#FFB6C1', 'pink', 4, 1),

  ('#2A2A2A', 'black', 0, 2),
  ('#F2F2F2', 'white', 0, 2),
  ('#555555', 'gray', 1, 2),
  ('#FF6666', 'red', 2, 2),
  ('#66FF66', 'green', 2, 2),
  ('#6666FF', 'blue', 2, 2),
  ('#C77DFF', 'purple', 3, 2),
  ('#CC6600', 'orange', 3, 2),
  ('#FFF799', 'yellow', 4, 2),
  ('#66FFFF', 'cyan', 4, 2),
  ('#FF66CC', 'magenta', 4, 2),
  ('#CD853F', 'brown', 4, 2),
  ('#FF69B4', 'pink', 4, 2)
ON CONFLICT (color_hex) DO UPDATE
SET
  color_family = EXCLUDED.color_family,
  min_level = EXCLUDED.min_level,
  shade_tier = EXCLUDED.shade_tier;
