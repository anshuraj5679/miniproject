from __future__ import annotations

from dataclasses import dataclass


@dataclass
class PlanStep:
    name: str
    action: str
    completed: bool = False


@dataclass
class Plan:
    complexity: str
    steps: list[PlanStep]


class QueryPlanner:
    COMPLEX_HINTS = (
        "compare",
        "trend",
        "outlier",
        "incorrectly",
        "above",
        "below",
        "between",
        "difference",
        "calculate",
        "missing",
        "q1",
        "q2",
        "q3",
        "q4",
    )

    def plan(self, query: str) -> Plan:
        lowered = query.lower()
        is_complex = any(hint in lowered for hint in self.COMPLEX_HINTS)

        if not is_complex:
            return Plan(
                complexity="simple",
                steps=[
                    PlanStep(name="retrieve", action="Find relevant chunks by lexical and metadata-filtered search."),
                    PlanStep(name="summarize", action="Synthesize a concise grounded response."),
                    PlanStep(name="validate", action="Check grounding and citation coverage."),
                ],
            )

        steps = [
            PlanStep(name="retrieve", action="Fetch candidate chunks with lexical retrieval and filters."),
            PlanStep(name="calculate", action="Recompute numeric aggregates and anomaly thresholds in Python."),
            PlanStep(name="policy_check", action="Apply compliance/policy checks to detected records."),
            PlanStep(name="summarize", action="Assemble grounded answer with evidence and computed outputs."),
            PlanStep(name="validate", action="Audit citations, grounding, and confidence score."),
        ]
        return Plan(complexity="complex", steps=steps)

