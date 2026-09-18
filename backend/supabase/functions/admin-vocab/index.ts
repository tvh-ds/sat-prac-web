import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import {
  deckCreateSchema,
  adminDeckUpdateSchema,
  adminCardCreateSchema,
  cardUpdateSchema,
  adminImportCardsSchema,
  assignVocabDeckSchema,
} from "../_shared/validation.ts";

const HEADERS = new Set(["word", "term", "definition", "def", "meaning"]);

interface CardRow {
  id: string;
  deck_id: string;
  word: string;
  definition: string;
  example_sentence: string | null;
  part_of_speech: string | null;
  tags: string[];
}

function parseWordDefCsv(text: string): Array<{ word: string; definition: string }> {
  const rows: Array<{ word: string; definition: string }> = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const raw = line.includes("\t") ? line.split("\t") : line.split(",");
    const fields = raw.map((f) => f.trim().replace(/^"|"$/g, ""));
    const [word, definition] = fields;
    if (!word || !definition) continue;
    if (i === 0 && HEADERS.has(word.toLowerCase())) continue;
    rows.push({ word, definition });
  }
  return rows;
}

async function getDeckOr404(
  svc: ReturnType<typeof serviceClient>,
  deckId: string,
) {
  const { data, error: err } = await svc
    .from("vocab_decks")
    .select("id, name, description, color, status, student_id")
    .eq("id", deckId)
    .maybeSingle();
  if (err) throw new HttpError(500, err.message);
  if (!data) throw new HttpError(404, "Deck not found");
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireRole(req, "admin");
    const svc = serviceClient();
    const seg = pathSegments(req);
    const url = new URL(req.url);

    // ------------------------------------------------------------------
    // Decks list + create
    // ------------------------------------------------------------------
    if (req.method === "GET" && seg.length === 2 && seg[1] === "decks") {
      const status = url.searchParams.get("status");
      const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
      let query = svc
        .from("vocab_decks")
        .select("id, name, description, color, status, created_at, student_id")
        .is("student_id", null);
      if (status) query = query.eq("status", status);
      query = query.order("created_at", { ascending: false });
      const { data, error: err } = await query;
      if (err) return error(err.message, 500);
      const decks = (data ?? []).filter((d) =>
        q ? ((d as { name: string }).name + " " + ((d as { description: string | null }).description ?? "")).toLowerCase().includes(q) : true
      );
      const ids = decks.map((d: { id: string }) => d.id);
      const { data: assignments, error: aErr } = await svc
        .from("vocab_deck_assignments")
        .select("deck_id, student_id")
        .in("deck_id", ids.length > 0 ? ids : [""]);
      if (aErr) return error(aErr.message, 500);
      const byDeck = new Map<string, Set<string>>();
      for (const a of assignments ?? []) {
        const row = a as { deck_id: string; student_id: string };
        if (!byDeck.has(row.deck_id)) byDeck.set(row.deck_id, new Set());
        byDeck.get(row.deck_id)!.add(row.student_id);
      }
      const out = decks.map((d) => {
        const row = d as { id: string };
        return { ...d, assigned_count: byDeck.get(row.id)?.size ?? 0 };
      });
      return json({ decks: out });
    }

    if (req.method === "POST" && seg.length === 2 && seg[1] === "decks") {
      const body = deckCreateSchema.parse(await req.json());
      const { data, error: err } = await svc
        .from("vocab_decks")
        .insert({
          name: body.name,
          description: body.description ?? null,
          color: body.color ?? "#7f1d1d",
          student_id: null,
          created_by: ctx.user.id,
        })
        .select("id, name, description, color, status, created_at")
        .single();
      if (err) return error(err.message, 500);
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "vocab.deck_created",
        entity_type: "vocab_deck",
        entity_id: data.id,
        details: { name: data.name },
      });
      return json({ deck: data }, 201);
    }

    // ------------------------------------------------------------------
    // Single deck: update / delete
    // ------------------------------------------------------------------
    if ((req.method === "GET" || req.method === "PATCH" || req.method === "DELETE") && seg.length === 3 && seg[1] === "decks") {
      const deckId = seg[2];
      const deck = await getDeckOr404(svc, deckId);

      if (req.method === "GET") {
        const { count: cardCount, error: ccErr } = await svc
          .from("vocab_cards")
          .select("id", { count: "exact", head: true })
          .eq("deck_id", deckId);
        if (ccErr) return error(ccErr.message, 500);
        const { data: assignments, error: aErr } = await svc
          .from("vocab_deck_assignments")
          .select("student_id")
          .eq("deck_id", deckId);
        if (aErr) return error(aErr.message, 500);
        const assignedSet = new Set((assignments ?? []).map((a) => (a as { student_id: string }).student_id));
        return json({ deck: { ...deck, card_count: cardCount ?? 0, assigned_count: assignedSet.size } });
      }

      if (req.method === "PATCH") {
        const body = adminDeckUpdateSchema.parse(await req.json());
        const { data, error: err } = await svc
          .from("vocab_decks")
          .update({
            name: body.name,
            description: body.description ?? undefined,
            color: body.color,
            status: body.status,
          })
          .eq("id", deckId)
          .select("id, name, description, color, status, created_at")
          .single();
        if (err) return error(err.message, 500);
        await svc.from("audit_logs").insert({
          actor_id: ctx.user.id,
          action: "vocab.deck_updated",
          entity_type: "vocab_deck",
          entity_id: deckId,
          details: body,
        });
        return json({ deck: data });
      }

      const { error: err } = await svc.from("vocab_decks").delete().eq("id", deckId);
      if (err) return error(err.message, 500);
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "vocab.deck_deleted",
        entity_type: "vocab_deck",
        entity_id: deckId,
      });
      return json({ ok: true });
    }

    // ------------------------------------------------------------------
    // Cards routes: /decks/:deckId/cards...
    // ------------------------------------------------------------------
    if (seg.length >= 4 && seg[1] === "decks" && seg[3] === "cards") {
      const deckId = seg[2];
      const deck = await getDeckOr404(svc, deckId);
      if (deck.student_id !== null) return error("This deck is not admin-managed", 409);

      // cards: [deckId, "cards"] rest
      const rest = seg.slice(4);

      if (req.method === "GET" && rest.length === 0) {
        const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
        const tag = url.searchParams.get("tag")?.trim() ?? "";
        let query = svc
          .from("vocab_cards")
          .select("id, deck_id, word, definition, example_sentence, part_of_speech, tags")
          .eq("deck_id", deckId)
          .order("word", { ascending: true });
        if (tag) query = query.contains("tags", [tag]);
        const { data, error: err } = await query;
        if (err) return error(err.message, 500);
        const rows = (data ?? []) as CardRow[];
        const filtered = q
          ? rows.filter((r) => `${r.word} ${r.definition} ${r.part_of_speech ?? ""}`.toLowerCase().includes(q))
          : rows;
        return json({ cards: filtered });
      }

      if (req.method === "POST" && rest.length === 0) {
        const body = adminCardCreateSchema.parse(await req.json());
        const { data, error: err } = await svc
          .from("vocab_cards")
          .insert({ ...body, deck_id: deckId })
          .select("id, deck_id, word, definition, example_sentence, part_of_speech, tags")
          .single();
        if (err) return error(err.message, 500);
        return json({ card: data }, 201);
      }

      if (req.method === "POST" && rest.length === 1 && rest[0] === "import") {
        const body = adminImportCardsSchema.parse(await req.json());
        const rows = parseWordDefCsv(body.text);
        if (rows.length === 0) return error("No valid word/definition pairs found", 422);
        const { data: existing, error: eErr } = await svc
          .from("vocab_cards")
          .select("word")
          .eq("deck_id", deckId);
        if (eErr) return error(eErr.message, 500);
        const have = new Set((existing ?? []).map((r: { word: string }) => r.word.toLowerCase()));
        const toInsert: Array<{ word: string; definition: string; deck_id: string }> = [];
        for (const row of rows) {
          const key = row.word.toLowerCase();
          if (have.has(key) || toInsert.some((t) => t.word.toLowerCase() === key)) continue;
          have.add(key);
          toInsert.push({ ...row, deck_id: deckId });
        }
        let inserted = 0;
        for (const row of toInsert) {
          const { error: iErr } = await svc.from("vocab_cards").insert(row);
          if (iErr) {
            if (String(iErr.message).includes("already exists")) continue;
            return error(iErr.message, 500);
          }
          inserted++;
        }
        await svc.from("audit_logs").insert({
          actor_id: ctx.user.id,
          action: "vocab.cards_imported",
          entity_type: "vocab_deck",
          entity_id: deckId,
          details: { imported: inserted, skipped: rows.length - inserted },
        });
        return json({ imported: inserted, skipped: rows.length - inserted, total: rows.length });
      }

      if (rest.length === 1) {
        const cardId = rest[0];
        const { data: card, error: cErr } = await svc
          .from("vocab_cards")
          .select("id, deck_id")
          .eq("id", cardId)
          .eq("deck_id", deckId)
          .maybeSingle();
        if (cErr) return error(cErr.message, 500);
        if (!card) return error("Card not found", 404);

        if (req.method === "PATCH") {
          const body = cardUpdateSchema.parse(await req.json());
          const { data, error: err } = await svc
            .from("vocab_cards")
            .update(body)
            .eq("id", cardId)
            .select("id, deck_id, word, definition, example_sentence, part_of_speech, tags")
            .single();
          if (err) return error(err.message, 500);
          return json({ card: data });
        }

        if (req.method === "DELETE") {
          const { error: err } = await svc.from("vocab_cards").delete().eq("id", cardId);
          if (err) return error(err.message, 500);
          return json({ ok: true });
        }
      }

      return error("Not found", 404);
    }

    // ------------------------------------------------------------------
    // Assignments: /decks/:deckId/assignments
    // ------------------------------------------------------------------
    if (seg.length >= 4 && seg[1] === "decks" && seg[3] === "assignments") {
      const deckId = seg[2];
      const deck = await getDeckOr404(svc, deckId);
      if (deck.student_id !== null) return error("This deck is not admin-managed", 409);

      if (req.method === "GET") {
        const { data: students, error: sErr } = await svc
          .from("student_profiles")
          .select("id, is_active")
          .eq("is_active", true)
          .order("created_at", { ascending: true });
        if (sErr) return error(sErr.message, 500);
        const studentIds = (students ?? []).map((s: { id: string }) => s.id);
        const { data: profiles, error: pErr } = await svc
          .from("profiles")
          .select("id, full_name")
          .in("id", studentIds.length > 0 ? studentIds : [""]);
        if (pErr) return error(pErr.message, 500);
        const nameMap = new Map((profiles ?? []).map((p) => [p.id, (p as { full_name: string }).full_name]));
        const { data: assignedRows, error: aErr } = await svc
          .from("vocab_deck_assignments")
          .select("student_id")
          .eq("deck_id", deckId);
        if (aErr) return error(aErr.message, 500);
        const assignedSet = new Set((assignedRows ?? []).map((a) => (a as { student_id: string }).student_id));
        const { data: users, error: uErr } = await svc.auth.admin.listUsers({ perPage: 1000 });
        if (uErr) return error(uErr.message, 500);
        const emailMap = new Map((users?.users ?? []).map((u) => [u.id, u.email]));
        return json({
          students: (students ?? []).map((s) => {
            const row = s as { id: string };
            return {
              id: row.id,
              full_name: nameMap.get(row.id) ?? "Unknown",
              email: emailMap.get(row.id) ?? null,
              assigned: assignedSet.has(row.id),
            };
          }),
          assigned_count: assignedSet.size,
        });
      }

      if (req.method === "POST") {
        const body = assignVocabDeckSchema.parse(await req.json());
        const ids = new Set(body.student_ids);
        const { data: existing, error: exErr } = await svc
          .from("vocab_deck_assignments")
          .select("student_id")
          .eq("deck_id", deckId);
        if (exErr) return error(exErr.message, 500);
        const current = new Set((existing ?? []).map((a) => (a as { student_id: string }).student_id));
        const toAdd = [...ids].filter((sid) => !current.has(sid));
        const toRemove = [...current].filter((sid) => !ids.has(sid));

        if (toAdd.length + toRemove.length === 0) return json({ ok: true, added: 0, removed: 0 });

        const { data: valid, error: vErr } = await svc
          .from("student_profiles")
          .select("id")
          .in("id", toAdd.length > 0 ? toAdd : [""])
          .eq("is_active", true);
        if (vErr) return error(vErr.message, 500);
        const validIds = new Set((valid ?? []).map((s: { id: string }) => s.id));

        let added = 0;
        for (const sid of toAdd) {
          if (!validIds.has(sid)) continue;
          const { error: insErr } = await svc
            .from("vocab_deck_assignments")
            .upsert({ deck_id: deckId, student_id: sid, assigned_by: ctx.user.id }, { onConflict: "deck_id,student_id" });
          if (insErr) return error(insErr.message, 500);
          added++;
        }
        if (toRemove.length > 0) {
          const { error: delErr } = await svc
            .from("vocab_deck_assignments")
            .delete()
            .eq("deck_id", deckId)
            .in("student_id", toRemove);
          if (delErr) return error(delErr.message, 500);
        }
        await svc.from("audit_logs").insert({
          actor_id: ctx.user.id,
          action: "vocab.deck_assigned",
          entity_type: "vocab_deck",
          entity_id: deckId,
          details: { added, removed: toRemove.length, student_ids: [...ids] },
        });
        return json({ ok: true, added, removed: toRemove.length });
      }

      return error("Not found", 404);
    }

    return error("Not found", 404);
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    if (e instanceof SyntaxError) return error("Invalid JSON body", 400);
    if (e instanceof Error && "issues" in (e as object)) return error("Validation failed", 422, (e as unknown as { issues: unknown }).issues);
    console.error(e);
    return error("Internal error", 500);
  }
});