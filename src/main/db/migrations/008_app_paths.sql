-- P102 (2026-11-26): where each app's program file is, so Apps & sites can show the app's own icon. Activity keeps
-- only the exe's basename; this remembers the latest full path seen for it.
CREATE TABLE app_paths (exe TEXT PRIMARY KEY, path TEXT NOT NULL);
