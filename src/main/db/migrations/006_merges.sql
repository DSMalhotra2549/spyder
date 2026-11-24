-- P86 (2026-11-25): each merge remembers what it combined, so the merged block can be unmerged later, after
-- restarts too. `before` is JSON {blocks, segments, flags}: the `sessions` rows and the segment / distraction-flag
-- links as they were before the merge. Merges made before this migration can't be unmerged.
CREATE TABLE merges (
  id TEXT PRIMARY KEY, keep_id TEXT NOT NULL REFERENCES sessions(id), created_ms INTEGER NOT NULL, before TEXT NOT NULL);
CREATE INDEX merges_keep ON merges (keep_id);
