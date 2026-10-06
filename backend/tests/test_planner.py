from app.services.planner import QueryPlanner


def test_planner_marks_simple_query() -> None:
    planner = QueryPlanner()
    plan = planner.plan("List invoices for vendor Acme")
    assert plan.complexity == "simple"
    assert [step.name for step in plan.steps] == ["retrieve", "summarize", "validate"]


def test_planner_marks_complex_query() -> None:
    planner = QueryPlanner()
    plan = planner.plan("Compare Q3 marketing bills with Q2 and highlight outliers")
    assert plan.complexity == "complex"
    assert any(step.name == "calculate" for step in plan.steps)
    assert any(step.name == "policy_check" for step in plan.steps)

