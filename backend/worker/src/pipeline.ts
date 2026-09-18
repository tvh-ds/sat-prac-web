import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabase } from "./supabase";
import { extractText, analyzeTextQuality, type PageText } from "./extractor";
import { parseQuestions } from "./parser";
import { parseScraperQuestions } from "./scraperParser";
import { parseAnswerKey, answerMap, answerMapGlobal } from "./answerKey";
import { looksLikeQuestionBank, parseQuestionBank } from "./questionBankParser";
import { renderPagePng } from "./renderPage";
import { normalizeText, hasSpacedText } from "./textNormalize";
import { parseFullTest, type ContentScope, type FullTestParseResult } from "./fullTestParser";
import { evaluateModuleCompleteness, type ModuleCompleteness, type ScraperParseResult } from "./scraperParser";
import {
  createParseProvider,
  fitImageForParse,
  parsePageTiled,
  PARSE_RENDER_SCALE,
  type ParseProvider,
  type ParseVisualBlock,
} from "./ocr";

export interface PipelineConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  cohereApiKey?: string;
  cohereApiKeys?: string[];
  cohereKeyPageCap?: number;
  ocrModel?: string;
  ocrProvider: string;
  ocrMode: "auto" | "all" | "none";
}

export interface ProcessResult {
  importId: string;
  status: string;
  pages: number;
  drafts: number;
  suggestedKeys: number;
  method: string | null;
  message?: string;
  report?: IngestReport | null;
}

export interface PhaseTimingsMs {
  ocrMs: number;
  parserMs: number;
  finalizeMs: number;
  totalMs: number;
}

export interface OcrPageFailure {
  page: number;
  error: string;
}

export type KeyStatus = "complete" | "partial" | "missing";
/**
 * Words showing the question text itself refers to a visual ("the graph
 * shows …", "data in the table …"). Used only together with a page-level
 * visual to attribute flattened table content (no "[figure: …]" marker)
 * to the question that owns it — never alone.
 */
export const VISUAL_CUE_RE = /\b(data|graph|table|figure|chart|scatterplot|histogram|diagram|plot)\b/i;
/**
 * Structural answer-key status: total + per-module key/question alignment.
 * "low_confidence" means every question has a key but alignment is suspect
 * (module counts mismatch, duplicate key numbers, positional fallback, or
 * orphan reassignment). The DB column only allows complete/partial/missing,
 * so low_confidence is stored there as "partial" while text_quality keeps
 * the structural value plus warnings.
 */
export type StructuralKeyStatus = "complete" | "partial" | "missing" | "low_confidence";

/** Visual/table content Parse found on a page (graphs, figures, boxes). */
export interface PageVisualInfo {
  imageCount: number;
  tableCount: number;
  notes: string[];
}

/** One module's completeness check. */
export interface ModuleCheck {
  module: string;
  expected: number;
  actual: number;
  status: "complete" | "partial" | "over";
}

/** Per-document ingestion report for the Parse 5 pipeline. */
export interface IngestReport {
  file: string | null;
  importId: string;
  status: string;
  totalPages: number;
  ocrProvider: string;
  ocrModel: string;
  ocrPagesAttempted: number;
  ocrPagesSucceeded: number;
  ocrPagesFailed: OcrPageFailure[];
  billedParsePages: number;
  finalQuestionsByModule: Record<string, number>;
  moduleChecks: ModuleCheck[];
  visualReviewQuestions: number;
  visualPages: number[];
  answerKeyStatus: KeyStatus | null;
  structuralKeyStatus?: StructuralKeyStatus | null;
  answerKeyByModule: Record<string, { questions: number; keys: number; status: string }>;
  answerKeyWarnings?: string[];
  warnings: string[];
  timingsMs: PhaseTimingsMs;
  message?: string;
}

interface AssembledQuestion {
  sourceQuestionNumber: number;
  sourceModuleName: string | null;
  sourceModulePosition: number | null;
  sourceQuestionId: string | null;
  pageNumber: number;
  section: "reading_writing" | "math";
  questionType: "multiple_choice" | "student_produced";
  prompt: string;
  passageText: string | null;
  choices: Array<{ label: string; text: string; position: number }>;
  confidence: number;
  correctAnswer: string | null;
  explanation: string | null;
  domain: string | null;
  skill: string | null;
  difficulty: number | null;
  hasVisualStimulus: boolean;
}

interface ParsedBundle {
  bank: ReturnType<typeof parseQuestionBank> | null;
  fullTest: FullTestParseResult | null;
  scraper: ScraperParseResult | null;
  questions: AssembledQuestion[];
  completeness: ModuleCompleteness[];
  legacyGlobal: Map<number, { answer: string; pageNumber: number; sourceText: string }> | null;
}

interface MatchedAnswer {
  answer: string;
  pageNumber: number;
  sourceText: string;
}

function countByModule(questions: Array<{ sourceModuleName: string | null }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of questions) {
    const mod = q.sourceModuleName ?? "Unknown";
    out[mod] = (out[mod] ?? 0) + 1;
  }
  return out;
}

/** Module-scoped key slots ("Module|n") parsed from the document. */
function collectKeySlots(parsed: ParsedBundle): string[] {
  const slots: string[] = [];
  if (parsed.fullTest) {
    for (const e of parsed.fullTest.keyEntries) {
      if (e.moduleName) slots.push(`${e.moduleName}|${e.questionNumber}`);
    }
  } else if (parsed.scraper) {
    for (const k of parsed.scraper.keys) {
      if (k.moduleName && !k.global) slots.push(`${k.moduleName}|${k.questionNumber}`);
    }
  }
  return slots;
}

/**
 * Structural answer-key assessment: do parsed keys match detected questions
 * in total AND per module, without duplicates, extras, or fallback matching?
 */
export function assessAnswerKey(args: {
  bank: boolean;
  questionCount: number;
  matchedCount: number;
  fallbackMatches: number;
  scopedMatches: number;
  keyEntries: number;
  keySlots: string[];
  summary: Record<string, { questions: number; keys: number; status: string }>;
}): { structural: StructuralKeyStatus; warnings: string[] } {
  const { bank, questionCount, matchedCount, fallbackMatches, keyEntries, keySlots, summary } = args;
  const warnings: string[] = [];
  if (bank) {
    const structural: StructuralKeyStatus =
      questionCount > 0 && matchedCount >= questionCount ? "complete" : matchedCount === 0 ? "missing" : "partial";
    return { structural, warnings };
  }
  // Duplicate key numbers inside one module (first match wins downstream).
  const seen = new Map<string, number>();
  for (const s of keySlots) seen.set(s, (seen.get(s) ?? 0) + 1);
  const dups = [...seen.entries()].filter(([, n]) => n > 1).slice(0, 8);
  for (const [slot] of dups) warnings.push(`duplicate key entry for ${slot}`);
  if (keyEntries > questionCount) {
    warnings.push(`${keyEntries} key entries exceed ${questionCount} questions`);
  }
  const moduleMismatch = Object.entries(summary)
    .filter(([, s]) => s.keys !== s.questions)
    .map(([mod, s]) => `${mod} ${s.keys}/${s.questions}`);
  if (matchedCount === 0) {
    if (keyEntries > 0) warnings.push(`${keyEntries} key entries parsed but none matched any question`);
    return { structural: "missing", warnings };
  }
  if (matchedCount < questionCount) {
    if (moduleMismatch.length > 0) warnings.push(`module key shortfall: ${moduleMismatch.join("; ")}`);
    if (fallbackMatches > 0) warnings.push(`${fallbackMatches} keys matched by position, not module scope`);
    return { structural: "partial", warnings };
  }
  // Every question has a key — still suspect when alignment is indirect.
  if (fallbackMatches > 0) warnings.push(`${fallbackMatches} keys matched by position, not module scope`);
  if (moduleMismatch.length > 0) warnings.push(`module counts differ after matching: ${moduleMismatch.join("; ")}`);
  if (warnings.length > 0) return { structural: "low_confidence", warnings };
  return { structural: "complete", warnings };
}

export class Pipeline {
  private svc: SupabaseClient;
  private parse: ParseProvider;
  private ocrModel: string;

  constructor(config: PipelineConfig) {
    this.svc = createSupabase(config);
    // Parse 5 is the only OCR provider; COHERE_API_KEY is mandatory.
    // Multiple keys rotate automatically on quota/rate-limit/timeout.
    const keys = (config.cohereApiKeys ?? []).length > 0 ? config.cohereApiKeys! : config.cohereApiKey;
    this.parse = createParseProvider(config.ocrProvider, keys, config.ocrModel, config.cohereKeyPageCap ?? 1000);
    this.ocrModel = this.parse.model;
  }

  async processImport(importId: string): Promise<ProcessResult> {
    const { data: pdfImport, error } = await this.svc
      .from("pdf_imports")
      .select("*")
      .eq("id", importId)
      .maybeSingle();
    if (error) throw new Error(`load import: ${error.message}`);
    if (!pdfImport) throw new Error(`import not found: ${importId}`);

    if (!["uploaded", "failed"].includes(pdfImport.status)) {
      throw new Error(`import ${importId} is in status ${pdfImport.status}; not processable`);
    }

    await this.svc.from("pdf_imports").update({ status: "extracting", error_message: null }).eq("id", importId);

    const t0 = Date.now();
    const fileName: string | null = typeof pdfImport.original_filename === "string" ? pdfImport.original_filename : null;
    try {
      const buffer = await this.download(pdfImport.storage_path);
      const bufferForFinalize = new Uint8Array(new ArrayBuffer(buffer.byteLength));
      bufferForFinalize.set(new Uint8Array(buffer));
      // Selectable text is kept only as a per-page fallback when Parse fails
      // on that page; the parser always reads Parse OCR output.
      const fallbackTexts = await extractText(new Uint8Array(buffer));
      const fallbackByPage = new Map(fallbackTexts.map((p) => [p.pageNumber, p.text]));
      const totalPages = fallbackTexts.length;

      const warnings: string[] = [];

      // --- Step 1: OCR the full test with Cohere Parse 5 (timed) ---
      const tOcr = Date.now();
      const ocrPages: PageText[] = [];
      const visualByPage = new Map<number, PageVisualInfo>();
      const ocrSucceeded: number[] = [];
      const ocrFailed: OcrPageFailure[] = [];
      let billedParsePages = 0;
      for (let pn = 1; pn <= totalPages; pn++) {
        try {
          const png = await renderPagePng(bufferForFinalize, pn, PARSE_RENDER_SCALE);
          const fitted = await fitImageForParse(png);
          const out = await parsePageTiled(this.parse, fitted);
          billedParsePages += out.billedPages;
          const text = out.text.trim().length > 0 ? out.text : (fallbackByPage.get(pn) ?? "");
          ocrPages.push({ pageNumber: pn, text });
          if (out.imageCount > 0 || out.tableCount > 0) {
            visualByPage.set(pn, {
              imageCount: out.imageCount,
              tableCount: out.tableCount,
              notes: out.visuals.map((v) => `${v.kind}: ${v.description ?? v.category ?? "visual"}`),
            });
          }
          ocrSucceeded.push(pn);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/auth failure|check COHERE_API_KEY/.test(msg)) {
            throw new Error(`Cohere Parse auth failure on page ${pn}: ${msg} (stopping; check COHERE_API_KEY)`);
          }
          console.warn(`[pipeline] Parse page ${pn} failed: ${msg}`);
          ocrFailed.push({ page: pn, error: msg.slice(0, 300) });
          // Fall back to selectable text so one bad page cannot sink the test.
          ocrPages.push({ pageNumber: pn, text: fallbackByPage.get(pn) ?? "" });
        }
      }
      const ocrMs = Date.now() - tOcr;
      console.log(`[pipeline] Parse OCR: ${ocrSucceeded.length}/${totalPages} pages (model ${this.ocrModel})`);
      if (totalPages > 0 && ocrSucceeded.length === 0) {
        throw new Error(
          `Cohere Parse failed on all ${totalPages} page(s); first error: ${ocrFailed[0]?.error ?? "unknown"} (stopping for diagnosis)`,
        );
      }
      const quality = analyzeTextQuality(ocrPages);
      await this.writePages(pdfImport.id, ocrPages);

      // --- Step 2: parser reads OCR output, questions become drafts ---
      const tParser = Date.now();
      const parsed = this.parseAll(normalizeText(ocrPages), "full_test");
      const parserMs = Date.now() - tParser;

      // Nothing usable: fail with the OCR attempt recorded.
      if (!parsed.bank && parsed.questions.length === 0) {
        const msg =
          `No readable SAT modules detected after Parse OCR (${ocrSucceeded.length}/${totalPages} pages parsed). ` +
          `The PDF may be malformed or unsupported.`;
        const timingsMs: PhaseTimingsMs = { ocrMs, parserMs, finalizeMs: 0, totalMs: Date.now() - t0 };
        await this.svc
          .from("pdf_imports")
          .update({
            status: "failed",
            error_message: msg,
            text_quality: {
              ...quality.metrics,
              parser_warnings: [...warnings, msg],
              detected_modules: {},
              ocr_provider: this.parse.name,
              ocr_model: this.ocrModel,
              ocr_pages: totalPages,
              ocr_pages_succeeded: ocrSucceeded.length,
              ocr_pages_failed: ocrFailed,
              billed_parse_pages: billedParsePages,
              timings_ms: timingsMs,
            },
          })
          .eq("id", importId);
        return {
          importId,
          status: "failed",
          pages: totalPages,
          drafts: 0,
          suggestedKeys: 0,
          method: null,
          message: msg,
          report: {
            file: fileName,
            importId,
            status: "failed",
            totalPages,
            ocrProvider: this.parse.name,
            ocrModel: this.ocrModel,
            ocrPagesAttempted: totalPages,
            ocrPagesSucceeded: ocrSucceeded.length,
            ocrPagesFailed: ocrFailed,
            billedParsePages,
            finalQuestionsByModule: {},
            moduleChecks: [],
            visualReviewQuestions: 0,
            visualPages: [...visualByPage.keys()],
            answerKeyStatus: "missing",
            answerKeyByModule: {},
            warnings: [...warnings, msg],
            timingsMs,
            message: msg,
          },
        };
      }

      // --- Step 3: completeness checks (modules, counts, keys, visuals) ---
      const moduleChecks: ModuleCheck[] = parsed.completeness.map((c) => ({
        module: c.name,
        expected: c.expected,
        actual: c.actual,
        status: c.missing > 0 ? "partial" : c.missing < 0 ? "over" : "complete",
      }));
      for (const c of parsed.completeness) {
        if (c.missing > 0) {
          warnings.push(`${c.name}: ${c.actual}/${c.expected} questions (partial — review needed).`);
        } else if (c.missing < 0) {
          warnings.push(`${c.name}: ${c.actual}/${c.expected} questions (over count — module boundaries may be wrong, review needed).`);
        }
      }
      if (ocrFailed.length > 0) {
        warnings.push(
          `Parse OCR failed on ${ocrFailed.length} page(s), selectable text used instead: ${ocrFailed.map((f) => `${f.page} (${f.error.slice(0, 80)})`).join("; ")}.`,
        );
      }
      if (visualByPage.size > 0) {
        warnings.push(
          `${visualByPage.size} page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.`,
        );
      }

      const tFin = Date.now();
      const result = await this.finalize(parsed, quality, ocrPages, "parse_ocr", bufferForFinalize, {
        importId,
        ocrPages: totalPages,
        ocrSucceeded: ocrSucceeded.length,
        ocrFailed,
        billedParsePages,
        visualByPage: Object.fromEntries(visualByPage),
        warnings,
        moduleChecks,
        timings: { ocrMs, parserMs, finalizeMs: 0, totalMs: 0 },
        startedAt: t0,
        finalizeStartedAt: tFin,
      });
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.svc.from("pdf_imports").update({ status: "failed", error_message: message.slice(0, 2000) }).eq("id", importId);
      return { importId, status: "failed", pages: 0, drafts: 0, suggestedKeys: 0, method: null, message, report: null };
    }
  }

  /**
   * Finalize an import from previously saved OCR (no Parse calls).
   * Used by the mirrored post_ocr batch: parse saved text, persist pages +
   * drafts, attach full-page stimulus images from the local PDF bytes.
   */
  async importSavedOcr(
    importId: string,
    ocrPages: PageText[],
    visualByPage: Record<number, PageVisualInfo>,
    pdfBytes?: Uint8Array,
  ): Promise<ProcessResult> {
    const t0 = Date.now();
    const { data: pdfImport, error } = await this.svc.from("pdf_imports").select("*").eq("id", importId).maybeSingle();
    if (error) throw new Error(`load import: ${error.message}`);
    if (!pdfImport) throw new Error(`import not found: ${importId}`);
    if (!["uploaded", "failed"].includes(pdfImport.status)) {
      throw new Error(`import ${importId} is in status ${pdfImport.status}; not processable`);
    }
    const fileName: string | null = typeof pdfImport.original_filename === "string" ? pdfImport.original_filename : null;
    await this.svc.from("pdf_imports").update({ status: "extracting", error_message: null }).eq("id", importId);

    const totalPages = ocrPages.length;
    const warnings: string[] = [`OCR loaded from saved post_ocr text (no Parse calls in this step).`];
    const visualPages = Object.keys(visualByPage).map(Number);
    if (visualPages.length > 0) {
      warnings.push(
        `${visualPages.length} page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.`,
      );
    }
    const quality = analyzeTextQuality(ocrPages);
    await this.writePages(pdfImport.id, ocrPages);

    const tParser = Date.now();
    const parsed = this.parseAll(normalizeText(ocrPages), "full_test");
    const parserMs = Date.now() - tParser;
    if (!parsed.bank && parsed.questions.length === 0) {
      const msg = `No readable SAT modules detected in saved OCR for ${fileName ?? importId}.`;
      await this.svc.from("pdf_imports").update({ status: "failed", error_message: msg }).eq("id", importId);
      return { importId, status: "failed", pages: totalPages, drafts: 0, suggestedKeys: 0, method: null, message: msg, report: null };
    }
    const moduleChecks: ModuleCheck[] = parsed.completeness.map((c) => ({
      module: c.name,
      expected: c.expected,
      actual: c.actual,
      status: c.missing > 0 ? "partial" : c.missing < 0 ? "over" : "complete",
    }));
    for (const c of parsed.completeness) {
      if (c.missing > 0) warnings.push(`${c.name}: ${c.actual}/${c.expected} questions (partial — review needed).`);
      else if (c.missing < 0) warnings.push(`${c.name}: ${c.actual}/${c.expected} questions (over count — review needed).`);
    }
    const tFin = Date.now();
    return this.finalize(parsed, quality, ocrPages, "parse_ocr_saved", pdfBytes ?? new Uint8Array(), {
      importId,
      ocrPages: totalPages,
      ocrSucceeded: totalPages,
      ocrFailed: [],
      billedParsePages: 0,
      visualByPage,
      warnings,
      moduleChecks,
      timings: { ocrMs: 0, parserMs, finalizeMs: 0, totalMs: 0 },
      startedAt: t0,
      finalizeStartedAt: tFin,
    });
  }

  /** Find the next pending import (polling mode). */
  async claimNextPending(): Promise<string | null> {
    const { data, error } = await this.svc
      .from("pdf_imports")
      .select("id")
      .in("status", ["uploaded", "failed"])
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw new Error(`claim next: ${error.message}`);
    return data?.[0]?.id ?? null;
  }

  /** Parse normalized page texts: bank first, then full-test, then scraper, then legacy. */
  private parseAll(normalizedTexts: PageText[], contentScope: ContentScope): ParsedBundle {
    // Try question bank first (highest quality for known bank PDFs)
    const bank = looksLikeQuestionBank(normalizedTexts) ? parseQuestionBank(normalizedTexts) : null;

    // Then try the full-test parser (handles module headings, scope filtering)
    const fullTest = bank ? null : parseFullTest(normalizedTexts, { contentScope, targetModule: null });

    // Fall back to scraper parser if full-test found nothing useful
    const scraper = !bank && (!fullTest || fullTest.questions.length === 0) ? parseScraperQuestions(normalizedTexts) : null;

    // --- Assemble questions ---
    const questions: AssembledQuestion[] = bank
      ? bank.questions.map((q) => ({
          sourceQuestionNumber: q.sourceQuestionNumber,
          sourceModuleName: null as string | null,
          sourceModulePosition: null as number | null,
          sourceQuestionId: q.sourceQuestionId,
          pageNumber: q.pageNumber,
          section: q.section,
          questionType: q.questionType,
          prompt: q.prompt,
          passageText: q.passageText,
          choices: q.choices,
          confidence: q.confidence,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          domain: q.domain,
          skill: q.skill,
          difficulty: q.difficulty,
          hasVisualStimulus: q.hasVisualStimulus,
        }))
      : fullTest && fullTest.questions.length > 0
        ? fullTest.questions
        : scraper && scraper.questions.length > 0
          ? scraper.questions.map((q) => ({
              sourceQuestionNumber: q.sourceQuestionNumber,
              sourceModuleName: q.sourceModuleName,
              sourceModulePosition: q.sourceModulePosition,
              sourceQuestionId: null as string | null,
              pageNumber: q.pageNumber,
              section: q.section,
              questionType: q.questionType,
              prompt: q.prompt,
              passageText: q.passageText,
              choices: q.choices,
              confidence: q.confidence,
              correctAnswer: null as string | null,
              explanation: null as string | null,
              domain: null as string | null,
              skill: null as string | null,
              difficulty: null as number | null,
              hasVisualStimulus: q.hasVisualStimulus,
            }))
          : parseQuestions(normalizedTexts).map((q) => ({
              sourceQuestionNumber: q.sourceQuestionNumber,
              sourceModuleName: null as string | null,
              sourceModulePosition: null as number | null,
              sourceQuestionId: null as string | null,
              pageNumber: q.pageNumber,
              section: q.section,
              questionType: q.questionType,
              prompt: q.prompt,
              passageText: q.passageText,
              choices: q.choices,
              confidence: q.confidence,
              correctAnswer: null as string | null,
              explanation: null as string | null,
              domain: null as string | null,
              skill: null as string | null,
              difficulty: null as number | null,
              hasVisualStimulus: false,
            }));

    const completeness = fullTest
      ? evaluateModuleCompleteness(fullTest.modules)
      : scraper
        ? evaluateModuleCompleteness(scraper.modules)
        : [];
    const fromLegacy = !bank && (!fullTest || fullTest.questions.length === 0) && (!scraper || scraper.questions.length === 0);
    const legacyGlobal = fromLegacy && questions.length > 0 ? answerMapGlobal(parseAnswerKey(normalizedTexts, questions.length)) : null;
    return { bank, fullTest, scraper, questions, completeness, legacyGlobal };
  }

  /**
   * Match answer keys to questions:
   * 1. module-scoped lookup ("Module Name|qNum"),
   * 2. a single global key block mapped positionally onto the still-unmatched
   *    questions in document order (end-of-test "Answer Key 1..N"),
   * 3. generic keys inferred to the module that just ended, mapped within
   *    that module only.
   */
  private matchAnswers(parsed: ParsedBundle): {
    answers: Array<MatchedAnswer | null>;
    keyEntries: number;
    /** Answers assigned via positional/inferred fallback rather than module scope. */
    fallbackMatches: number;
    scopedMatches: number;
  } {
    const questions = parsed.questions;
    if (parsed.bank) {
      const answers = questions.map((q) =>
        q.correctAnswer ? { answer: q.correctAnswer, pageNumber: q.pageNumber, sourceText: `Correct Answer: ${q.correctAnswer}` } : null,
      );
      return {
        answers,
        keyEntries: questions.filter((q) => q.correctAnswer).length,
        fallbackMatches: 0,
        scopedMatches: answers.filter(Boolean).length,
      };
    }
    const scoped = new Map<string, MatchedAnswer>();
    const global: Array<{ n: number; inferred: string | null; v: MatchedAnswer }> = [];
    if (parsed.fullTest && parsed.fullTest.questions.length > 0) {
      for (const [k, v] of parsed.fullTest.keyMap) {
        if (!k.startsWith("g|")) scoped.set(k, v);
      }
      for (const e of parsed.fullTest.keyEntries) {
        if (!e.moduleName) {
          global.push({ n: e.questionNumber, inferred: e.inferredModule ?? null, v: { answer: e.answer, pageNumber: e.pageNumber, sourceText: e.sourceText } });
        }
      }
    } else if (parsed.scraper && parsed.scraper.questions.length > 0) {
      for (const k of parsed.scraper.keys) {
        const v = { answer: k.answer, pageNumber: k.pageNumber, sourceText: k.sourceText };
        if (!k.global && k.moduleName) scoped.set(`${k.moduleName}|${k.questionNumber}`, v);
        else global.push({ n: k.questionNumber, inferred: k.moduleName || null, v });
      }
    } else if (parsed.legacyGlobal) {
      for (const [n, v] of parsed.legacyGlobal) global.push({ n, inferred: null, v });
    }
    // Document order (no numeric sort): end-of-test keys may repeat 1..N
    // per module block, and positional mapping must follow block order.

    const answers: Array<MatchedAnswer | null> = new Array(questions.length).fill(null);
    const unmatched: number[] = [];
    questions.forEach((q, i) => {
      const key = q.sourceModuleName ? `${q.sourceModuleName}|${q.sourceQuestionNumber}` : null;
      const hit = key ? scoped.get(key) : undefined;
      if (hit) answers[i] = hit;
      else unmatched.push(i);
    });
    const scopedMatches = answers.filter(Boolean).length;
    let fallbackMatches = 0;
    if (unmatched.length > 0 && global.length === unmatched.length) {
      unmatched.forEach((qi, j) => {
        answers[qi] = global[j]!.v;
      });
      fallbackMatches = unmatched.length;
    } else if (unmatched.length > 0) {
      const unmatchedByModule = new Map<string, number[]>();
      for (const qi of unmatched) {
        const mod = questions[qi]!.sourceModuleName ?? "";
        if (!unmatchedByModule.has(mod)) unmatchedByModule.set(mod, []);
        unmatchedByModule.get(mod)!.push(qi);
      }
      const globalByInferred = new Map<string, Array<(typeof global)[number]>>();
      for (const g of global) {
        const key = g.inferred ?? "";
        if (!globalByInferred.has(key)) globalByInferred.set(key, []);
        globalByInferred.get(key)!.push(g);
      }
      for (const [mod, qis] of unmatchedByModule) {
        const entries = globalByInferred.get(mod);
        if (mod && entries && entries.length === qis.length) {
          qis.forEach((qi, j) => {
            answers[qi] = entries[j]!.v;
          });
          fallbackMatches += qis.length;
        }
      }
    }
    return { answers, keyEntries: scoped.size + global.length, fallbackMatches, scopedMatches };
  }

  private async finalize(
    parsed: ParsedBundle,
    quality: ReturnType<typeof analyzeTextQuality>,
    original: PageText[],
    method: string,
    pdfBytes: Uint8Array,
    opts: {
      importId: string;
      ocrPages: number;
      ocrSucceeded: number;
      ocrFailed: OcrPageFailure[];
      billedParsePages: number;
      visualByPage: Record<number, PageVisualInfo>;
      warnings: string[];
      moduleChecks: ModuleCheck[];
      timings: PhaseTimingsMs;
      startedAt: number;
      finalizeStartedAt: number;
    },
  ): Promise<ProcessResult> {
    const { bank, fullTest, scraper, questions } = parsed;
    const importId = opts.importId;

    // --- Match answer keys (scoped, inferred-module, then global positional) ---
    const { answers: matchedAnswers, keyEntries, fallbackMatches, scopedMatches } = this.matchAnswers(parsed);
    const keyConfidence = bank
      ? 0.99
      : fullTest && fullTest.questions.length > 0
        ? fullTest.keyConfidence
        : scraper && scraper.questions.length > 0
          ? scraper.keyConfidence
          : parseAnswerKey(original, questions.length).confidence;

    const renderedPages = new Map<number, string>();
    const visualPages = Object.keys(opts.visualByPage).map(Number);
    const draftStatuses: string[] = [];

    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi]!;
      const matched = matchedAnswers[qi] ?? null;
      // Visual attribution is per-question, not per-page: the parser flags
      // the block that actually contains the "[figure: …]"/"[table: …]"
      // marker. A page-level visual additionally applies only when the
      // question text itself references it (covers table blocks flattened
      // to plain text with no marker). This stops a graph on a shared page
      // from attaching its stimulus image to neighboring text-only questions.
      const pageVisual = opts.visualByPage[q.pageNumber] ?? null;
      const pageHasVisual = pageVisual !== null && pageVisual.imageCount + pageVisual.tableCount > 0;
      const cuesVisual = VISUAL_CUE_RE.test(`${q.prompt} ${q.passageText ?? ""}`);
      const hasVisual = q.hasVisualStimulus || (pageHasVisual && cuesVisual);
      const status = hasVisual ? "needs_review" : matched ? "has_suggested_key" : "missing_key";
      draftStatuses.push(status);
      let stimulusImagePath: string | null = null;
      if (hasVisual) {
        stimulusImagePath = renderedPages.get(q.pageNumber) ?? null;
        if (!stimulusImagePath) {
          try {
            stimulusImagePath = await this.uploadRenderedPage(importId, q.sourceQuestionId ?? String(q.sourceQuestionNumber), q.pageNumber, pdfBytes);
            renderedPages.set(q.pageNumber, stimulusImagePath);
          } catch (e) {
            console.warn(`[pipeline] stimulus upload skipped (page ${q.pageNumber}): ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
      const { data: draft, error: dErr } = await this.svc
        .from("draft_questions")
        .insert({
          pdf_import_id: importId,
          page_number: q.pageNumber,
          section: q.section,
          question_type: q.questionType,
          prompt: q.prompt,
          passage_text: q.passageText,
          domain: q.domain,
          skill: q.skill,
          difficulty: q.difficulty,
          suggested_answer: q.correctAnswer ?? matched?.answer ?? null,
          answer_confidence: q.confidence,
          status,
          source_question_number: q.sourceQuestionNumber,
          source_module_name: q.sourceModuleName,
          source_module_position: q.sourceModulePosition,
          source_question_id: q.sourceQuestionId,
          explanation: q.explanation,
          has_visual_stimulus: hasVisual,
          stimulus_image_path: stimulusImagePath,
          parser_metadata: {
            parser: bank ? "rw-question-bank" : "parse5-full-test",
            scope: "full_test",
            ocr_provider: this.parse.name,
            ocr_model: this.ocrModel,
            visual: opts.visualByPage[q.pageNumber] ?? null,
          },
        })
        .select("id")
        .single();
      if (dErr) throw new Error(`insert draft: ${dErr.message}`);

      if (q.choices.length > 0) {
        const { error: cErr } = await this.svc.from("draft_question_choices").insert(
          q.choices.map((c) => ({ draft_question_id: draft.id, label: c.label, text: c.text, position: c.position })),
        );
        if (cErr) throw new Error(`insert draft choices: ${cErr.message}`);
      }

      if (matched) {
        await this.svc.from("draft_answer_keys").insert({
          draft_question_id: draft.id,
          detected_answer: matched.answer,
          confidence: keyConfidence,
          source_text: matched.sourceText.slice(0, 200),
          source_page: matched.pageNumber,
          status: "suggested",
        });
      }
    }

    const moduleStats = bank
      ? {
          "RW Question Bank": questions.length,
          "Text-only": questions.filter((q) => !q.hasVisualStimulus).length,
          "Visual stimulus": questions.filter((q) => q.hasVisualStimulus).length,
          "Parse errors": bank.errors.length,
        }
      : Object.fromEntries(parsed.completeness.map((c) => [c.name, c.actual]));

    // --- Answer-key status: structural (total + per-module alignment) ---
    const withKey = matchedAnswers.filter(Boolean).length;
    const answerKeySummary: Record<string, { questions: number; keys: number; status: string }> = {};
    questions.forEach((q, qi) => {
      const mod = q.sourceModuleName ?? (bank ? "Question Bank" : "Unknown");
      const s = answerKeySummary[mod] ?? { questions: 0, keys: 0, status: "missing" };
      s.questions += 1;
      if (matchedAnswers[qi]) s.keys += 1;
      answerKeySummary[mod] = s;
    });
    for (const s of Object.values(answerKeySummary)) {
      s.status = s.keys === 0 ? "missing" : s.keys >= s.questions ? "complete" : "partial";
    }
    const { structural, warnings: keyWarnings } = assessAnswerKey({
      bank: !!bank,
      questionCount: questions.length,
      matchedCount: withKey,
      fallbackMatches,
      scopedMatches,
      keyEntries,
      keySlots: collectKeySlots(parsed),
      summary: answerKeySummary,
    });
    // DB column only allows complete/partial/missing — low_confidence lands
    // as partial there; text_quality keeps the structural value + warnings.
    const answerKeyStatus: KeyStatus =
      structural === "complete" ? "complete" : structural === "missing" ? "missing" : "partial";

    const incompleteModules = parsed.completeness
      .filter((c) => c.missing > 0)
      .map((c) => ({ module: c.name, expected: c.expected, actual: c.actual }));
    const visualReviewQuestions = draftStatuses.filter((s) => s === "needs_review").length;

    const timingsMs: PhaseTimingsMs = {
      ...opts.timings,
      finalizeMs: Date.now() - opts.finalizeStartedAt,
      totalMs: Date.now() - opts.startedAt,
    };
    const qualityPayload = {
      ...quality.metrics,
      drafts: questions.length,
      key_entries: keyEntries,
      key_confidence: keyConfidence,
      modules: moduleStats,
      ocr_provider: this.parse.name,
      ocr_model: this.ocrModel,
      ocr_pages: opts.ocrPages,
      ocr_pages_succeeded: opts.ocrSucceeded,
      ocr_pages_failed: opts.ocrFailed,
      billed_parse_pages: opts.billedParsePages,
      visual_review_questions: visualReviewQuestions,
      visual_pages: visualPages,
      timings_ms: timingsMs,
      parser_warnings: opts.warnings,
      module_checks: opts.moduleChecks,
      incomplete_modules: incompleteModules,
      answer_key_status: structural,
      answer_key_summary: answerKeySummary,
      answer_key_warnings: keyWarnings,
      key_fallback_matches: fallbackMatches,
      key_scoped_matches: scopedMatches,
    };
    const { error: finErr } = await this.svc
      .from("pdf_imports")
      .update({
        status: "completed",
        page_count: original.length,
        extraction_method: method,
        text_quality: qualityPayload,
      })
      .eq("id", importId);
    if (finErr) {
      // Older DBs whose extraction_method check predates Parse OCR reject
      // 'parse_ocr'. Retry without the method so the import still lands.
      console.warn(`[pipeline] finalize update failed (${finErr.message}); retrying without extraction_method`);
      const { error: retryErr } = await this.svc
        .from("pdf_imports")
        .update({ status: "completed", page_count: original.length, text_quality: qualityPayload })
        .eq("id", importId);
      if (retryErr) throw new Error(`finalize import: ${retryErr.message}`);
    }

    // Dedicated answer-key columns (added by migration 20260916000000).
    // Best-effort: the import must not fail if the migration is not applied yet.
    try {
      await this.svc
        .from("pdf_imports")
        .update({ answer_key_status: answerKeyStatus, answer_key_summary: answerKeySummary })
        .eq("id", importId);
    } catch (e) {
      console.warn(`[pipeline] answer-key columns update skipped: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Purge original PDF from Storage after successful ingest (free tier 1 GB).
    try {
      const { data: imp } = await this.svc.from("pdf_imports").select("storage_path").eq("id", importId).maybeSingle();
      const path = (imp as { storage_path?: string } | null)?.storage_path;
      if (path) {
        const { error: rmErr } = await this.svc.storage.from("pdf-imports").remove([path]);
        if (rmErr) console.warn(`[pipeline] purge storage ${path} failed: ${rmErr.message}`);
        else console.log(`[pipeline] purged storage object ${path}`);
      }
    } catch (e) {
      console.warn(`[pipeline] purge warning: ${e instanceof Error ? e.message : String(e)}`);
    }

    const report: IngestReport = {
      file: null,
      importId,
      status: "completed",
      totalPages: original.length,
      ocrProvider: this.parse.name,
      ocrModel: this.ocrModel,
      ocrPagesAttempted: opts.ocrPages,
      ocrPagesSucceeded: opts.ocrSucceeded,
      ocrPagesFailed: opts.ocrFailed,
      billedParsePages: opts.billedParsePages,
      finalQuestionsByModule: countByModule(questions),
      moduleChecks: opts.moduleChecks,
      visualReviewQuestions,
      visualPages,
      answerKeyStatus: answerKeyStatus as KeyStatus,
      structuralKeyStatus: structural,
      answerKeyByModule: answerKeySummary,
      answerKeyWarnings: keyWarnings,
      warnings: opts.warnings,
      timingsMs,
    };

    return {
      importId,
      status: "completed",
      pages: original.length,
      drafts: questions.length,
      suggestedKeys: withKey,
      method,
      report,
    };
  }

  private async writePages(importId: string, pages: PageText[]): Promise<void> {
    // Best-effort: some DBs predate the ocr_status/needs_ocr columns.
    try {
      for (const p of pages) {
        const words = p.text.trim().split(/\s+/).filter(Boolean).length;
        await this.svc.from("pdf_import_pages").upsert(
          {
            pdf_import_id: importId,
            page_number: p.pageNumber,
            extracted_text: p.text,
            word_count: words,
            needs_ocr: false,
            ocr_status: "completed",
          },
          { onConflict: "pdf_import_id,page_number" },
        );
      }
    } catch (e) {
      console.warn(`[pipeline] writePages skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async uploadRenderedPage(importId: string, sourceQuestionId: string, pageNumber: number, pdfBuffer: Uint8Array): Promise<string> {
    const png = await renderPagePng(pdfBuffer, pageNumber, 2);
    const path = `imports/${importId}/stimuli/${sourceQuestionId}-page-${pageNumber}.png`;
    const { error } = await this.svc.storage.from("question-assets").upload(path, png, {
      contentType: "image/png",
      upsert: true,
    });
    if (error) throw new Error(`upload stimulus ${path}: ${error.message}`);
    return path;
  }

  private async download(storagePath: string): Promise<ArrayBuffer> {
    const { data, error } = await this.svc.storage.from("pdf-imports").download(storagePath);
    if (error || !data) throw new Error(`download ${storagePath}: ${error?.message ?? "no data"}`);
    return data.arrayBuffer();
  }
}
