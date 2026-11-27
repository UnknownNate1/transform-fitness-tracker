CREATE TABLE IF NOT EXISTS transform_data (
  user_key TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
