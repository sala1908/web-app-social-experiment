CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username TEXT;

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
  cost_units INTEGER NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE paint_actions
  ADD COLUMN IF NOT EXISTS cost_units INTEGER NOT NULL DEFAULT 2;

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
