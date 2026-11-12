-- Export format version 2: who completes a quest, a hash of its objective text
-- and the items it asks for, plus position votes for quest giver locations.

ALTER TABLE observations ADD COLUMN finisher_type TEXT;
ALTER TABLE observations ADD COLUMN finisher_id INTEGER;
ALTER TABLE observations ADD COLUMN finisher_name TEXT;
ALTER TABLE observations ADD COLUMN objectives_hash TEXT;
ALTER TABLE observations ADD COLUMN items TEXT;  -- item IDs, ascending, comma-separated

-- New vote dimensions: finisher and objectives are per locale; items and
-- position use locale ''. A position value is '<map>:<cx>:<cy>' with
-- cx = floor(x / 0.02) and cy = floor(y / 0.02), capped at 49 (src/summary.ts).
-- Existing observations already carry positions; count them so later updates,
-- which subtract an observation's old votes, keep the counters consistent.
INSERT INTO quest_votes (quest_id, dimension, locale, value, count)
SELECT quest_id, 'position', '',
  map || ':' || MIN(CAST(x / 0.02 AS INTEGER), 49) || ':' || MIN(CAST(y / 0.02 AS INTEGER), 49),
  COUNT(*)
FROM observations
WHERE map IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL
GROUP BY 1, 2, 3, 4;
