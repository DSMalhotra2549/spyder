-- P74 (2026-11-23): Gym and Food tags. They are breaks (kind 'break'); this names which. NULL = a plain break or work.
ALTER TABLE sessions ADD COLUMN tag TEXT CHECK (tag IN ('gym', 'food'));
