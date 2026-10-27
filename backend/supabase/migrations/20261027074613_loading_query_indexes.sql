-- Loading paths join answer keys per draft, attempts per assignment, and
-- vocabulary state/history per card. Index the referencing side of those joins.
-- These indexes do not change rows, RLS policies or authorization.
create index if not exists draft_answer_keys_question_idx
  on public.draft_answer_keys (draft_question_id);
create index if not exists attempts_assignment_lookup_idx
  on public.attempts (assignment_id, id);
create index if not exists vocab_card_state_card_lookup_idx
  on public.vocab_card_state (card_id, student_id);
create index if not exists vocab_reviews_card_history_idx
  on public.vocab_reviews (card_id, student_id, reviewed_on);
