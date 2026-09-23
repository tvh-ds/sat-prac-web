export interface Choice {
  id: string;
  label: string;
  text: string;
  is_correct: boolean;
  position: number;
}

export interface Passage {
  id: string;
  title: string | null;
  content: string;
}

export interface Question {
  id: string;
  section: "reading_writing" | "math";
  question_type: "multiple_choice" | "student_produced";
  passage_id: string | null;
  prompt: string;
  domain: string | null;
  skill: string | null;
  difficulty: number | null;
  correct_answer: string | null;
  explanation: string | null;
  source_question_id?: string | null;
  stimulus_image_path?: string | null;
  stimulus_image_url?: string | null;
  choices: Choice[];
  passage?: Passage | null;
}

export interface ModuleQuestion {
  id: string;
  module_id: string;
  question_id: string;
  position: number;
  question: Question;
}

export interface TestModule {
  id: string;
  section_id: string;
  name: string;
  time_limit_minutes: number;
  position: number;
  is_adaptive: boolean;
  questions: ModuleQuestion[];
}

export interface TestSection {
  id: string;
  test_id: string;
  name: string;
  section_type: "reading_writing" | "math";
  position: number;
  modules: TestModule[];
}

export interface Test {
  id: string;
  title: string;
  description: string | null;
  status?: string;
  is_public?: boolean;
  kind?: string;
  sections: TestSection[];
}

export interface Attempt {
  id: string;
  test_id: string;
  student_id: string;
  status: "in_progress" | "graded" | string;
  current_module_id: string | null;
  current_question_position: number | null;
  module2_difficulty: string | null;
  started_at: string;
  submitted_at: string | null;
  assignment_id?: string | null;
}

export interface AttemptModule {
  id: string;
  attempt_id: string;
  module_id: string;
  status: "in_progress" | "not_started" | "completed";
  started_at: string | null;
  seconds_left: number | null;
}

export interface SavedResponse {
  attempt_id: string;
  question_id: string;
  module_id: string;
  selected_choice_id: string | null;
  typed_answer: string | null;
  marked_for_review: boolean;
  eliminated_choice_ids: string[];
  highlights: string[];
  is_correct: boolean | null;
}

export interface TestListItem {
  id: string;
  title: string;
  description: string | null;
  kind?: string;
  assignment_id: string | null;
  assignment_status?: string | null;
  due_at: string | null;
  sections: number;
  modules: number;
  questions: number;
  time_limit_minutes?: number | null;
  attempt: { id: string; status: string; started_at: string } | null;
}

export interface PracticeSet {
  id: string;
  title: string;
  description: string | null;
  status: string;
  is_public: boolean;
  time_limit_minutes: number | null;
  question_count: number;
  created_at: string;
}

export interface PracticeLinkQuestion {
  id: string;
  position: number;
  points: number;
  question: Question;
}

export interface PracticeSetDetail {
  set: PracticeSet & { updated_at: string };
  questions: PracticeLinkQuestion[];
}

export interface ScoreEntry {
  id: string;
  test_id: string;
  status: string;
  started_at: string;
  submitted_at: string | null;
  test: { title: string; kind?: string } | null;
  score: {
    raw_score: number;
    total_questions: number;
    accuracy: number;
    section_scores: Record<string, { correct: number; total: number; accuracy: number }>;
    topic_performance: Array<{ domain: string; skill: string | null; correct: number; total: number }>;
  } | null;
}

export interface ReviewChoice {
  id: string;
  label: string;
  text: string;
  is_correct: boolean;
}

export interface ReviewItem {
  question_id: string;
  question_number: number;
  section: string | null;
  section_name: string | null;
  section_type: string | null;
  module_name: string | null;
  prompt: string | null;
  question_type: string | null;
  domain: string | null;
  skill: string | null;
  difficulty: number | null;
  explanation: string | null;
  correct_answer: string | null;
  stimulus_image_url?: string | null;
  choices: ReviewChoice[];
  selected_choice_id: string | null;
  typed_answer: string | null;
  your_answer: string | null;
  correct_answers: Array<{ label: string; text: string }>;
  is_correct: boolean | null;
  unanswered: boolean;
  marked_for_review: boolean;
}

export interface ScoreDetail {
  attempt: ScoreEntry;
  review: ReviewItem[];
  explanations_released?: boolean;
}

export interface PracticeAssignmentBatch {
  id: string;
  source_test_id: string | null;
  snapshot_test_id: string;
  title: string;
  timer_minutes: number;
  assigned_by: string | null;
  assigned_at: string;
  explanations_released_at: string | null;
  source_title?: string | null;
  question_count: number;
  student_count: number;
  completed_count: number;
  avg_accuracy: number | null;
}

export interface BatchStudent {
  assignment_id: string;
  student_id: string;
  full_name: string;
  email: string | null;
  status: string;
  started_at: string | null;
  submitted_at: string | null;
  raw_score: number | null;
  total_questions: number | null;
  accuracy: number | null;
  review_attempt_id?: string | null;
}

export interface BatchChoiceStat {
  id: string;
  label: string;
  text: string;
  is_correct: boolean;
  position: number;
  selected_count: number;
}

export interface BatchQuestionStat {
  question_id: string;
  position: number;
  prompt: string;
  question_type: string;
  correct_answer: string | null;
  choices: BatchChoiceStat[];
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
  completed_count: number;
  accuracy: number | null;
  typed_answers: Array<{ answer: string; count: number }>;
}

export interface PracticeBatchDetail {
  batch: PracticeAssignmentBatch;
  students: BatchStudent[];
  questions: BatchQuestionStat[];
}

export interface FullTestAssignmentBatch {
  id: string;
  source_test_id: string;
  title: string;
  content_scope: "full_test" | "reading_writing" | "math" | "custom_modules";
  module_ids: string[];
  due_at: string | null;
  assigned_by: string | null;
  assigned_at: string;
  created_at: string;
  question_count: number;
  student_count: number;
  completed_count: number;
  avg_accuracy: number | null;
}

export interface FullTestBatchDetail {
  batch: FullTestAssignmentBatch;
  students: BatchStudent[];
}

export interface StudentProfile {
  id: string;
  role: "admin" | "student";
  full_name: string | null;
}

export interface PdfImport {
  id: string;
  original_filename: string;
  storage_path: string;
  status: string;
  page_count: number | null;
  extraction_method: string | null;
  created_at: string;
  error_message: string | null;
  ocr_mode?: string;
  content_scope?: string;
  target_module?: string | null;
  generated_test_id?: string | null;
  answer_key_status?: "complete" | "partial" | "missing" | null;
  answer_key_summary?: Record<string, { questions: number; keys: number; status: string }> | null;
  draft_counts?: Record<string, number>;
  text_quality?: {
    modules?: Record<string, number>;
    key_entries?: number;
    key_confidence?: number;
    drafts?: number;
    ocr_pages?: number;
    parser_warnings?: string[];
    incomplete_modules?: Array<{ module: string; expected: number; actual: number }>;
    answer_key_status?: "complete" | "partial" | "missing" | "low_confidence";
    answer_key_summary?: Record<string, { questions: number; keys: number; status: string }>;
    answer_key_warnings?: string[];
    key_fallback_matches?: number;
    key_scoped_matches?: number;
  } | null;
}

export interface DraftChoice {
  id: string;
  label: string;
  text: string;
  position: number;
}

export interface DraftQuestion {
  id: string;
  pdf_import_id: string;
  page_number: number;
  section: string;
  question_type: string;
  prompt: string;
  passage_text: string | null;
  domain?: string | null;
  skill?: string | null;
  difficulty?: number | null;
  suggested_answer: string | null;
  explanation?: string | null;
  source_question_id?: string | null;
  has_visual_stimulus?: boolean;
  stimulus_image_path?: string | null;
  stimulus_image_url?: string | null;
  stimulus_source_image_path?: string | null;
  stimulus_source_image_url?: string | null;
  stimulus_crop_rect?: { x: number; y: number; w: number; h: number } | null;
  stimulus_crop_source?: "auto" | "manual" | "full_page" | null;
  stimulus_crop_status?: "pending" | "confirmed" | null;
  status: string;
  source_question_number: number;
  source_module_name?: string | null;
  source_module_position?: number | null;
  question_id?: string | null;
  choices: DraftChoice[];
  answer_keys: Array<{ id: string; detected_answer: string; confidence: number; status: string }>;
}

export interface DraftSummary {
  id: string;
  pdf_import_id: string;
  page_number: number;
  section: string;
  question_type: string;
  prompt: string;
  status: string;
  source_question_number: number;
  source_module_name?: string | null;
  has_visual_stimulus?: boolean;
}

export interface ModuleSummary {
  section: string;
  module: string;
  total: number;
  approved: number;
  rejected: number;
  needs_review: number;
  has_suggested_key: number;
  missing_key: number;
  other: number;
  with_key: number;
}

export interface ImportDetailSummary {
  import: PdfImport;
  drafts: DraftSummary[];
  draft_total: number;
  draft_offset: number;
  draft_limit: number;
  draft_counts: Record<string, number>;
  module_summary?: ModuleSummary[];
  draft_status?: string | null;
  draft_module?: string | null;
}

export interface ImportDetail {
  import: PdfImport;
  pages: Array<{
    page_number: number;
    word_count: number;
    extracted_text?: string | null;
  }>;
  drafts: DraftQuestion[];
}

export interface ImportListItem {
  id: string;
  original_filename: string;
  status: string;
  page_count: number | null;
  created_at: string;
  draft_counts: Record<string, number>;
}

export interface VocabDeck {
  id: string;
  name: string;
  description: string | null;
  color: string;
  created_at?: string;
  card_count: number;
  due_count: number;
  new_count: number;
  assigned?: boolean;
}

export interface VocabCard {
  id: string;
  deck_id: string;
  word: string;
  definition: string;
  example_sentence: string | null;
  part_of_speech: string | null;
  tags: string[];
}

export interface VocabCardState {
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
  status: string;
  due_at: string;
}

export interface VocabStudyCard {
  card: VocabCard;
  state: VocabCardState | null;
}

export interface VocabHeatmapDay {
  date: string;
  count: number;
}

export interface VocabDashboard {
  decks: VocabDeck[];
  heatmap: VocabHeatmapDay[];
  today: { reviewed: number } | null;
  streak: { current: number; best: number };
  totals: { cards: number; due: number; fresh: number };
}

export interface AdminVocabDeck {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: "active" | "archived";
  created_at: string;
  card_count?: number;
  assigned_count: number;
}

export interface VocabAssignmentStudent {
  id: string;
  full_name: string;
  email: string | null;
  assigned: boolean;
}
