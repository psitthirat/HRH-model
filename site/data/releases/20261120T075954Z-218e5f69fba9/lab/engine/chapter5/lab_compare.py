"""Comparability contract of two Workforce Lab allocation runs (next-phase plan §8.4).

`lab_adapter.compare_runs` keeps its hard guard: runs with different engine, inputs or metric
definitions are rejected.  This contract states, for any two runs, whether they can be compared
and how, before any difference is shown:

    not_comparable              different engine/inputs/parameter-definition/metric versions, a
                                different province-year domain, or different geography overrides
    common_reference_required   same domain, but the population denominator, target definition or
                                evaluation weights differ: own-context metrics (attainment of each
                                run's own targets) are not comparable; re-evaluate both stocks
                                against one common reference (compare_runs does this against the
                                first run) and keep each run's own-context results alongside
    directly_comparable         only policy, assumption or method parameters differ

Every parameter difference is attributed to one declared group so that a change of denominator is
never presented as a policy effect.  Exclusions of the provisional scope are always disclosed.
"""
from __future__ import annotations

import json

VERSION_KEYS = ["engine_version", "inputs_version", "parameter_definition_version", "metric_definition_version"]
GROUPS = {
    "population": {"demography.scenario", "demography.fertility", "demography.mortality", "allocation.population_register"},
    "geography": {"geography.overrides"},
    "target_definition": {"targets.experiment", "targets.reference_per_1000", "allocation.family"},
    "evaluation_weights": {"services.op_minutes", "services.adjrw_minutes", "services.inpatient_measure",
                           "services.projection", "services.response_strength", "morbidity.path"},
    "method": {"planning.mode", "departures.rate_source", "allocation.objective"},
}
PREFIX = [("solver.", "method"), ("uncertainty.", "method"), ("morbidity.", "evaluation_weights"),
          ("resources.", "evaluation_weights"), ("allocation.", "policy"), ("mobility.", "policy"),
          ("retention.", "policy")]
NEEDS_COMMON = {"population", "target_definition", "evaluation_weights"}
VERDICT_TH = {"not_comparable": "เปรียบเทียบไม่ได้", "common_reference_required": "ต้องเทียบกับเกณฑ์อ้างอิงร่วม",
              "directly_comparable": "เปรียบเทียบได้โดยตรง"}
EXCLUSIONS = ["ขอบเขต: แพทย์สังกัดกระทรวงสาธารณสุข 76 จังหวัด ไม่รวมกรุงเทพฯ (ตัวแทนชั่วคราวของ สป.สธ.)",
              "ไม่มีต้นทุนและตำแหน่งที่มีงบประมาณรองรับ", "ไม่มีโครงสร้างอายุของบุคลากร"]


def group_of(pid: str) -> str:
    for g, ids in GROUPS.items():
        if pid in ids:
            return g
    for pre, g in PREFIX:
        if pid.startswith(pre):
            return g
    return "assumption"                       # supply, departures multipliers, feedback, costs, ...


def _same(a, b) -> bool:
    return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


def _domain(run: dict) -> tuple[set, set]:
    led = run.get("ledger") or []
    return {int(r["year_ce"]) for r in led}, {int(r["prov_code"]) for r in led}


def comparability(run_a: dict, run_b: dict) -> dict:
    blocking = []
    va, vb = run_a.get("versions") or {}, run_b.get("versions") or {}
    for k in VERSION_KEYS:
        if va.get(k) != vb.get(k):
            blocking.append(f"{k} ต่างกัน")
    ya, pa = _domain(run_a)
    yb, pb = _domain(run_b)
    if ya != yb:
        blocking.append(f"ช่วงปีต่างกัน ({min(ya, default=None)}–{max(ya, default=None)} / {min(yb, default=None)}–{max(yb, default=None)})")
    if pa != pb:
        blocking.append(f"ชุดจังหวัดต่างกัน (มีในรอบเดียว {sorted(pa ^ pb)[:20]})")
    xa = (run_a.get("resolved_config") or {}).get("parameters") or {}
    xb = (run_b.get("resolved_config") or {}).get("parameters") or {}
    changes: dict[str, list] = {}
    for pid in sorted(set(xa) | set(xb)):
        if not _same(xa.get(pid), xb.get(pid)):
            changes.setdefault(group_of(pid), []).append(dict(id=pid, a=xa.get(pid), b=xb.get(pid)))
    if changes.get("geography"):
        blocking.append("การแก้ไขภูมิศาสตร์ต่างกัน")
    if blocking:
        verdict = "not_comparable"
    elif NEEDS_COMMON & set(changes):
        verdict = "common_reference_required"
    else:
        verdict = "directly_comparable"
    return dict(schema="workforce-lab.comparability/1", run_a=run_a.get("run_id"), run_b=run_b.get("run_id"),
                verdict=verdict, verdict_th=VERDICT_TH[verdict], blocking=blocking, changes=changes,
                common_reference=dict(geography="76 provinces of the shared ledger", time_horizon=sorted(ya & yb),
                                      population="first run's civil-register projection",
                                      targets="first run's P, S and N target paths and reference density",
                                      outcome_units=va.get("metric_definition_version"),
                                      weights="first run's service workload weights"),
                own_context_results_kept=True, exclusions=EXCLUSIONS)
