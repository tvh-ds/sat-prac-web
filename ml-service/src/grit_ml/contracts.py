import hashlib
import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

TAXONOMY = json.loads(Path(__file__).with_name("taxonomy.json").read_text(encoding="utf-8"))
TAXONOMY_VERSION = hashlib.sha256(json.dumps(TAXONOMY, sort_keys=True).encode()).hexdigest()[:16]
PREPROCESSING_VERSION = "content-v1"
Section = Literal["math", "reading_writing"]


def skill_domain(section: str, skill: str) -> str:
    for domain, skills in TAXONOMY[section].items():
        if skill in skills:
            return domain
    raise ValueError(f"Invalid skill for section {section}")


class QuestionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    section: Section
    question_type: Literal["multiple_choice", "student_produced"]
    prompt: str = Field(min_length=1, max_length=20000)
    passage: str = Field(default="", max_length=80000)
    choices: list[str] = Field(default_factory=list, max_length=8)
    requires_image: bool = False
    image_base64: str | None = Field(default=None, max_length=14000000)

    @model_validator(mode="after")
    def validate_content(self):
        if not self.prompt.strip() or any(not c.strip() or len(c) > 10000 for c in self.choices):
            raise ValueError("Empty prompt/choice or oversized choice")
        if self.question_type == "multiple_choice" and len(self.choices) < 2:
            raise ValueError("Multiple-choice questions require at least two choices")
        if self.question_type == "student_produced" and self.choices:
            raise ValueError("Student-produced questions have no choices")
        return self

    def text(self) -> str:
        # Field markers preserve prompt/choice boundaries and never contain labels or provenance.
        return "\n".join(["[SECTION] " + self.section, "[TYPE] " + self.question_type,
                          "[PASSAGE] " + self.passage, "[PROMPT] " + self.prompt,
                          *[f"[CHOICE {i + 1}] {c}" for i, c in enumerate(self.choices)]])

    def content_hash(self) -> str:
        return hashlib.sha256(self.model_dump_json().encode()).hexdigest()


class LabeledQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    source_group: str
    passage_group: str | None = None
    duplicate_group: str | None = None
    content: QuestionInput
    domain: str | None = None
    skill: str | None = None
    difficulty: Literal[1, 3, 5] | None = None
    difficulty_provenance: Literal["source", "human", "unknown", "default"] = "unknown"

    @model_validator(mode="after")
    def validate_labels(self):
        if self.domain and self.domain not in TAXONOMY[self.content.section]:
            raise ValueError("Invalid domain")
        if self.skill and (not self.domain or skill_domain(self.content.section, self.skill) != self.domain):
            raise ValueError("Invalid domain/skill pair")
        return self

    def trusted_difficulty(self) -> str | None:
        return str(self.difficulty) if self.difficulty is not None and self.difficulty_provenance in {"source", "human"} else None


class FieldPrediction(BaseModel):
    value: str | int | None = None
    confidence: float | None = None
    probabilities: dict[str, float] = Field(default_factory=dict)
    abstention_reason: str | None = None


class Prediction(BaseModel):
    input_hash: str
    model_version: str
    preprocessing_version: str = PREPROCESSING_VERSION
    taxonomy_version: str = TAXONOMY_VERSION
    skill: FieldPrediction
    domain: FieldPrediction
    difficulty: FieldPrediction
    latency_ms: float
