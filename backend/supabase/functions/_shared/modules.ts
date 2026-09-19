// Shared module-grouping helpers (pure logic, no runtime deps).
// Used by admin-pdf-imports when assembling a full-length test from drafts.
// Tested from backend/worker/tests/edgeModules.test.ts.

export interface ModuleGroup {
  key: string;
  sectionType: "reading_writing" | "math";
  modulePos: number;
  label: string;
}

const MODULE_GROUP_RE = /^(reading\s*(?:and|&)?\s*writing|math)\s+module\s+(\d+)$/i;

export function moduleGroup(sourceModuleName: string | null | undefined, section: string | null | undefined): ModuleGroup {
  const m = String(sourceModuleName ?? "").match(MODULE_GROUP_RE);
  if (m) {
    const sectionType: "reading_writing" | "math" = /^math/i.test(m[1]!) ? "math" : "reading_writing";
    return {
      key: `${sectionType}:${m[2]}`,
      sectionType,
      modulePos: Number(m[2]),
      label: `${sectionType === "math" ? "Math" : "Reading and Writing"} Module ${m[2]}`,
    };
  }
  if (section === "math") return { key: "math:1", sectionType: "math", modulePos: 1, label: "Math Module 1" };
  return { key: "reading_writing:1", sectionType: "reading_writing", modulePos: 1, label: "Reading and Writing Module 1" };
}

export interface DraftModuleRef {
  source_module_name?: unknown;
  section?: unknown;
}

/**
 * Group drafts by module key. Keyed by group.key (Map, not Set): ModuleGroup
 * objects are distinct identities, so a Set would yield one entry per draft
 * and violate unique (section_id, position) on insert of the 2nd question.
 */
export function groupByModuleKey<T extends DraftModuleRef>(
  drafts: T[],
): Map<"reading_writing" | "math", Map<string, ModuleGroup>> {
  const grouped = new Map<"reading_writing" | "math", Map<string, ModuleGroup>>();
  for (const d of drafts) {
    const group = moduleGroup(d.source_module_name as string | null | undefined, d.section as string | null | undefined);
    if (!grouped.has(group.sectionType)) grouped.set(group.sectionType, new Map());
    grouped.get(group.sectionType)!.set(group.key, group);
  }
  return grouped;
}
