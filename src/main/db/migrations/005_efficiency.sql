-- P75 (2026-11-24): efficiency, the user's own rating of a work block (25/50/75/100 from the prompt; a merge can
-- store the time-weighted mean). NULL = not rated.
ALTER TABLE sessions ADD COLUMN efficiency INTEGER CHECK (efficiency BETWEEN 0 AND 100);
