-- Backfill difficulty for active Practice Question Bank questions that were
-- imported without a difficulty rating. Medium (3) is the neutral default;
-- archived full-test questions may remain unrated.
UPDATE public.questions
SET difficulty = 3
WHERE status = 'active'
  AND difficulty IS NULL;
