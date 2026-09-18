export const SECTIONS = ["reading_writing", "math"] as const;
export type SectionKey = (typeof SECTIONS)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type DifficultyLabel = (typeof DIFFICULTIES)[number];

export const TAXONOMY = {
  reading_writing: {
    "Information and Ideas": [
      "Central Ideas and Details",
      "Command of Evidence",
      "Inferences",
    ],
    "Craft and Structure": [
      "Words in Context",
      "Text Structure and Purpose",
      "Cross-Text Connections",
    ],
    "Expression of Ideas": ["Rhetorical Synthesis", "Transitions"],
    "Standard English Conventions": [
      "Boundaries",
      "Form, Structure, and Sense",
    ],
  },
  math: {
    Algebra: [
      "Linear equations in one variable",
      "Linear functions in one variable",
      "Linear equations in two variables",
      "Systems of two linear equations in two variables",
      "Linear inequalities in one or two variables",
    ],
    "Advanced Math": [
      "Equivalent expressions",
      "Nonlinear equations in one variable and systems of equations in two variables",
      "Nonlinear functions",
    ],
    "Problem-Solving and Data Analysis": [
      "Ratios, rates, proportional relationships, and units",
      "Percentages",
      "One-variable data—Distributions and measures of center and spread",
      "Two-variable data—Models and scatterplots",
      "Probability and conditional probability",
      "Inference from sample statistics and margin of error",
      "Evaluating statistical claims—Observational studies and experiments",
    ],
    "Geometry and Trigonometry": [
      "Area and volume",
      "Lines, angles, and triangles",
      "Right triangles and trigonometry",
      "Circles",
    ],
  },
} as const;

export type Domain = keyof (typeof TAXONOMY)[SectionKey];
export type Skill = (typeof TAXONOMY)[SectionKey][Domain][number];

export function domainsForSection(section: SectionKey): Domain[] {
  return Object.keys(TAXONOMY[section]) as Domain[];
}

export function skillsForDomain(
  section: SectionKey,
  domain: Domain,
): string[] {
  return [...(TAXONOMY[section][domain] ?? [])];
}

export function difficultyLabel(d: number | null): DifficultyLabel {
  if (d == null) return "medium";
  if (d <= 2) return "easy";
  if (d >= 4) return "hard";
  return "medium";
}

export function difficultyValue(
  label: DifficultyLabel,
): 1 | 3 | 5 {
  if (label === "easy") return 1;
  if (label === "hard") return 5;
  return 3;
}

export function sectionLabel(s: string): string {
  return s === "math" ? "Math" : "Reading & Writing";
}
