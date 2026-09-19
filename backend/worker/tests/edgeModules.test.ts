import { describe, it, expect } from "vitest";
import { moduleGroup, groupByModuleKey } from "../../supabase/functions/_shared/modules";

describe("moduleGroup", () => {
  it("keys Reading and Writing / Math modules by name", () => {
    expect(moduleGroup("Reading and Writing Module 2", "reading_writing").key).toBe("reading_writing:2");
    expect(moduleGroup("Math Module 1", "math").key).toBe("math:1");
  });

  it("falls back to section when the module name is missing", () => {
    expect(moduleGroup(null, "math").key).toBe("math:1");
    expect(moduleGroup(null, null).key).toBe("reading_writing:1");
  });
});

describe("groupByModuleKey", () => {
  const draft = (mod: string | null, section: string | null, n: number) => ({
    source_module_name: mod,
    section,
    source_question_number: n,
  });

  it("collapses many drafts from one module into a single group (Set-identity regression)", () => {
    // 27 drafts, one module: the old Set<ModuleGroup> produced 27 groups and
    // violated unique (section_id, position) on the second module insert.
    const drafts = Array.from({ length: 27 }, (_, i) => draft("Math Module 1", "math", i + 1));
    const grouped = groupByModuleKey(drafts);
    expect(grouped.get("math")?.size).toBe(1);
    expect(grouped.get("math")?.get("math:1")?.modulePos).toBe(1);
  });

  it("keeps distinct modules and sections apart", () => {
    const drafts = [
      draft("Reading and Writing Module 1", "reading_writing", 1),
      draft("Reading and Writing Module 2", "reading_writing", 2),
      draft("Math Module 1", "math", 1),
      draft("Math Module 2", "math", 2),
    ];
    const grouped = groupByModuleKey(drafts);
    expect(grouped.get("reading_writing")?.size).toBe(2);
    expect(grouped.get("math")?.size).toBe(2);
  });
});
