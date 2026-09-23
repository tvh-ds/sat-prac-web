import { z } from "npm:zod@3";

export const createStudentSchema = z.object({
  email: z.string().email("A valid email is required"),
  temporary_password: z.string().min(8, "Temporary password must be at least 8 characters"),
  full_name: z.string().min(1).max(200),
  grade_level: z.string().max(50).optional().nullable(),
  school: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const updateStudentSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  grade_level: z.string().max(50).optional().nullable(),
  school: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  is_active: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({
  new_password: z.string().min(8, "Password must be at least 8 characters"),
});

export const choiceSchema = z.object({
  label: z.string().min(1).max(2),
  text: z.string().min(1),
  is_correct: z.boolean().default(false),
  position: z.number().int().min(1),
});

export const questionCreateSchema = z.object({
  section: z.enum(["reading_writing", "math"]),
  question_type: z.enum(["multiple_choice", "student_produced"]),
  passage_id: z.string().uuid().optional().nullable(),
  prompt: z.string().min(1),
  domain: z.string().max(100).optional().nullable(),
  skill: z.string().max(100).optional().nullable(),
  difficulty: z.number().int().min(1).max(5).optional().nullable(),
  correct_answer: z.string().max(500).optional().nullable(),
  explanation: z.string().max(5000).optional().nullable(),
  source_question_id: z.string().max(100).optional().nullable(),
  stimulus_image_path: z.string().max(1000).optional().nullable(),
  choices: z.array(choiceSchema).max(6).optional().default([]),
  status: z.enum(["active", "archived"]).optional().default("active"),
});

export const questionUpdateSchema = questionCreateSchema.partial();

export const passageSchema = z.object({
  title: z.string().max(300).optional().nullable(),
  content: z.string().min(1),
  source: z.string().max(300).optional().nullable(),
});

export const testCreateSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional().nullable(),
  is_public: z.boolean().default(false),
});

export const testUpdateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).optional().nullable(),
  is_public: z.boolean().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

export const sectionCreateSchema = z.object({
  test_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  section_type: z.enum(["reading_writing", "math"]),
  position: z.number().int().min(1),
});

export const sectionUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  section_type: z.enum(["reading_writing", "math"]).optional(),
  position: z.number().int().min(1).optional(),
});

export const moduleCreateSchema = z.object({
  section_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  time_limit_minutes: z.number().int().min(1).max(600),
  position: z.number().int().min(1),
  is_adaptive: z.boolean().default(false),
});

export const moduleUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  time_limit_minutes: z.number().int().min(1).max(600).optional(),
  position: z.number().int().min(1).optional(),
  is_adaptive: z.boolean().optional(),
});

export const linkQuestionSchema = z.object({
  module_id: z.string().uuid(),
  question_id: z.string().uuid(),
  position: z.number().int().min(1),
  points: z.number().min(0.5).max(10).default(1),
});

export const linkUpdateSchema = z.object({
  position: z.number().int().min(1).optional(),
  points: z.number().min(0.5).max(10).optional(),
});

export const assignmentScopeSchema = z.enum(["full_test", "reading_writing", "math", "custom_modules"]);

export const assignTestSchema = z.object({
  test_id: z.string().uuid(),
  student_id: z.string().uuid(),
  due_at: z.string().datetime().optional().nullable(),
  content_scope: assignmentScopeSchema.default("full_test"),
  module_ids: z.array(z.string().uuid()).max(4).optional(),
});

export const assignManySchema = z.object({
  student_ids: z.array(z.string().uuid()).min(1).max(1000),
  due_at: z.string().datetime().optional().nullable(),
  content_scope: assignmentScopeSchema.default("full_test"),
  module_ids: z.array(z.string().uuid()).max(4).optional(),
});

export const pdfImportCreateSchema = z.object({
  storage_path: z.string().min(1),
  original_filename: z.string().min(1),
  file_size: z.number().int().positive().optional().nullable(),
  ocr_mode: z.enum(["auto", "all", "none"]).optional(),
  content_scope: z.enum(["full_test", "reading_writing", "math", "single_module"]).optional(),
  target_module: z.enum(["rw1", "rw2", "math1", "math2"]).optional().nullable(),
});

export const startAttemptSchema = z.object({
  test_id: z.string().uuid(),
  assignment_id: z.string().uuid().optional(),
});

export const advanceModuleSchema = z.object({
  attempt_id: z.string().uuid(),
  module_id: z.string().uuid(),
  time_spent_seconds: z.number().int().min(0).optional().default(0),
});

export const responseSaveSchema = z.object({
  attempt_id: z.string().uuid(),
  question_id: z.string().uuid(),
  module_id: z.string().uuid(),
  selected_choice_id: z.string().uuid().optional().nullable(),
  typed_answer: z.string().max(500).optional().nullable(),
  marked_for_review: z.boolean().optional(),
  eliminated_choice_ids: z.array(z.string().uuid()).optional(),
  notes: z.string().max(5000).optional().nullable(),
  highlights: z.array(z.string().max(2000)).optional(),
  time_spent_seconds: z.number().int().min(0).optional(),
});

export const submitAttemptSchema = z.object({
  attempt_id: z.string().uuid(),
});

export const approveDraftSchema = z.object({
  section: z.enum(["reading_writing", "math"]).optional(),
  question_type: z.enum(["multiple_choice", "student_produced"]).optional(),
  passage_text: z.string().max(20000).optional().nullable(),
  domain: z.string().max(100).optional().nullable(),
  skill: z.string().max(100).optional().nullable(),
  difficulty: z.number().int().min(1).max(5).optional().nullable(),
  correct_answer: z.string().max(500).optional().nullable(),
  explanation: z.string().max(5000).optional().nullable(),
  add_to_test_id: z.string().uuid().optional().nullable(),
  add_to_module_id: z.string().uuid().optional().nullable(),
  position: z.number().int().min(1).optional(),
});

export const updateDraftSchema = z.object({
  prompt: z.string().min(1).optional(),
  passage_text: z.string().max(20000).optional().nullable(),
  section: z.enum(["reading_writing", "math"]).optional().nullable(),
  question_type: z.enum(["multiple_choice", "student_produced"]).optional().nullable(),
  domain: z.string().max(100).optional().nullable(),
  skill: z.string().max(100).optional().nullable(),
  difficulty: z.number().int().min(1).max(5).optional().nullable(),
  suggested_answer: z.string().max(500).optional().nullable(),
  explanation: z.string().max(5000).optional().nullable(),
  has_visual_stimulus: z.boolean().optional(),
  stimulus_image_path: z.string().max(1000).optional().nullable(),
  stimulus_crop_rect: z.object({ x: z.number().int(), y: z.number().int(), w: z.number().int().min(1), h: z.number().int().min(1) }).optional().nullable(),
  stimulus_crop_source: z.enum(["auto", "manual", "full_page"]).optional().nullable(),
  stimulus_crop_status: z.enum(["pending", "confirmed"]).optional(),
  choices: z.array(choiceSchema.partial().extend({ id: z.string().uuid().optional() })).optional(),
});

// ---------------------------------------------------------------------------
// Practice sets (admin)
// ---------------------------------------------------------------------------
export const practiceCreateSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional().nullable(),
  time_limit_minutes: z.number().int().min(1).max(600),
  question_ids: z.array(z.string().uuid()).min(1).max(100),
});

export const practiceUpdateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).optional().nullable(),
  time_limit_minutes: z.number().int().min(1).max(600).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

export const practiceAddQuestionsSchema = z.object({
  question_ids: z.array(z.string().uuid()).min(1).max(100),
});

export const practiceAssignSchema = z.object({
  student_ids: z.array(z.string().uuid()).min(1).max(1000),
  timer_minutes: z.number().int().min(1).max(600),
  due_at: z.string().datetime().optional().nullable(),
});

export const practiceQuestionEditSchema = z.object({
  position: z.number().int().min(1).optional(),
  prompt: z.string().min(1).optional(),
  section: z.enum(["reading_writing", "math"]).optional(),
  question_type: z.enum(["multiple_choice", "student_produced"]).optional(),
  passage_id: z.string().uuid().optional().nullable(),
  domain: z.string().max(100).optional().nullable(),
  skill: z.string().max(100).optional().nullable(),
  difficulty: z.number().int().min(1).max(5).optional().nullable(),
  correct_answer: z.string().max(500).optional().nullable(),
  explanation: z.string().max(5000).optional().nullable(),
  choices: z.array(choiceSchema).max(6).optional(),
});

// ---------------------------------------------------------------------------
// Vocabulary (student)
// ---------------------------------------------------------------------------
export const deckCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  color: z.string().max(20).optional().default("#7f1d1d"),
});

export const deckUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  color: z.string().max(20).optional(),
});

export const cardCreateSchema = z.object({
  deck_id: z.string().uuid(),
  word: z.string().min(1).max(120),
  definition: z.string().min(1).max(2000),
  example_sentence: z.string().max(1000).optional().nullable(),
  part_of_speech: z.string().max(50).optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional().default([]),
});

export const cardUpdateSchema = z.object({
  word: z.string().min(1).max(120).optional(),
  definition: z.string().min(1).max(2000).optional(),
  example_sentence: z.string().max(1000).optional().nullable(),
  part_of_speech: z.string().max(50).optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export const importCardsSchema = z.object({
  deck_id: z.string().uuid(),
  text: z.string().min(1).max(200000),
});

// ---------------------------------------------------------------------------
// Vocabulary (admin-managed decks)
// ---------------------------------------------------------------------------
export const adminDeckUpdateSchema = deckUpdateSchema.extend({
  status: z.enum(["active", "archived"]).optional(),
});

export const adminCardCreateSchema = cardCreateSchema.omit({ deck_id: true });

export const adminImportCardsSchema = z.object({
  text: z.string().min(1).max(200000),
});

export const assignVocabDeckSchema = z.object({
  student_ids: z.array(z.string().uuid()).max(1000),
});

export const vocabReviewSchema = z.object({
  card_id: z.string().uuid(),
  rating: z.number().int().min(1).max(4),
  mode: z.enum(["study", "sprint"]).default("study"),
  response_ms: z.number().int().min(0).optional().nullable(),
  reviewed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});
