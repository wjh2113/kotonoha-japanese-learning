CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#e6533f',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS words (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  reading TEXT NOT NULL DEFAULT '',
  meaning TEXT NOT NULL DEFAULT '',
  part_of_speech TEXT NOT NULL DEFAULT '',
  example TEXT NOT NULL DEFAULT '',
  example_reading TEXT NOT NULL DEFAULT '',
  translation TEXT NOT NULL DEFAULT '',
  mastered BOOLEAN NOT NULL DEFAULT FALSE,
  starred BOOLEAN NOT NULL DEFAULT FALSE,
  review_stage INTEGER CHECK (review_stage IS NULL OR review_stage BETWEEN 0 AND 5),
  last_reviewed_at TIMESTAMPTZ,
  next_review_at TIMESTAMPTZ,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS words_unit_order_idx ON words(unit_id, sort_order);
CREATE INDEX IF NOT EXISTS words_review_due_idx ON words(next_review_at) WHERE next_review_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS words_starred_idx ON words(starred) WHERE starred = TRUE;

CREATE TABLE IF NOT EXISTS app_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  avatar TEXT NOT NULL DEFAULT 'ゆ',
  voice_gender TEXT NOT NULL DEFAULT 'female' CHECK (voice_gender IN ('female', 'male')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
