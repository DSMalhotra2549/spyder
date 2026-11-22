-- P50–P53, P57 (2026-11-22).
-- P51: the old 30-min check-in default becomes 15 min; any other stored value is kept.
UPDATE settings SET value = '900' WHERE key = 'checkInIntervalSec' AND value = '1800';
-- P50: the bar is the only widget.
DELETE FROM settings WHERE key = 'widgetStyle';
-- P53: deleted and merged-away sessions are hidden, not erased, so Undo is exact.
ALTER TABLE sessions ADD COLUMN deleted_ms INTEGER;
