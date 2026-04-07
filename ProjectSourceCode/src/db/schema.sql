CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  owner_tag TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (x, y),
  CHECK (x >= 0 AND y >= 0),
  CHECK (color_hex ~* '^#[0-9A-F]{6}$')
);

ALTER TABLE canvas_pixels
  ADD COLUMN IF NOT EXISTS owner_tag TEXT;

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
