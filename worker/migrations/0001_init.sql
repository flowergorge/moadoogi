-- Firebase Auth UID partitions every item. Same item ID can exist in different accounts.
CREATE TABLE IF NOT EXISTS items (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  item_json TEXT NOT NULL,
  rank REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_items_user_order
  ON items(user_id, rank ASC, created DESC, id ASC);

-- Atomic counters; each user's endpoint reuses one row across minute windows.
CREATE TABLE IF NOT EXISTS request_limits (
  bucket_key TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
