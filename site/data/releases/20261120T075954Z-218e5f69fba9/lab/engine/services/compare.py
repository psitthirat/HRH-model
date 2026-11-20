"""Comparability contract and staged comparisons for service-module runs (next-phase plan §8.4).

Two runs are compared only when they share the model structure, time horizon, population
denominator and outcome units.  Otherwise the verdict is `not_comparable` and no difference is
reported.  When they are comparable, every difference between them is attributed to a declared
source:

    data         a dataset that enters the run directly (capacity, referral flows, ...) changed
    calibration  an estimated parameter changed (new data refitted, or a frozen value)
    assumption   an assumption parameter changed (task times, frequencies, working time, ...)
    policy       a policy parameter changed (coverage, modality mix, screening programme, ...)

`staged` runs base data -> new data with calibration frozen -> recalibrated (+ assumption changes)
-> policy changes, so the effect of new data, refitting and policy is shown separately rather than
as one undifferentiated change.  Exclusions (columns or provinces present in only one run) are
disclosed, never silently dropped.
"""
from __future__ import annotations

import json

VERDICTS = {"comparable": "เปรียบเทียบได้", "comparable_with_caveats": "เปรียบเทียบได้ โดยมีข้อควรระวัง",
            "not_comparable": "เปรียบเทียบไม่ได้"}
SOURCE = {"estimated": "calibration", "assumption": "assumption", "policy": "policy"}
STAGES = [("base", "ข้อมูลเดิม"), ("new_data_fixed_calibration", "ข้อมูลใหม่ ตรึงค่าที่ปรับฐานไว้"),
          ("recalibrated", "ปรับฐานใหม่จากข้อมูลใหม่ และสมมติฐาน/วิธีที่แก้"), ("policy", "เพิ่มการเปลี่ยนนโยบาย")]


def _same(a, b) -> bool:
    return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


def _provinces(run: dict) -> set:
    return {int(r["prov_code"]) for r in (run.get("tables", {}).get("province_last_year") or []) if r.get("prov_code") is not None}


def _columns(run: dict) -> list[str]:
    nat = run.get("tables", {}).get("national_by_year") or []
    return [k for k in (nat[0] if nat else {}) if k != "year"]


def comparability(run_a: dict, run_b: dict) -> dict:
    blocking, caveats = [], []
    if run_a.get("status") != "completed" or run_b.get("status") != "completed":
        blocking.append("ทั้งสองรอบต้องรันสำเร็จ")
    for key, label in [("schema", "รูปแบบผลลัพธ์"), ("module", "โมดูล"), ("module_version", "รุ่นโครงสร้างแบบจำลอง"),
                       ("years", "ช่วงปี")]:
        if not _same(run_a.get(key), run_b.get(key)):
            blocking.append(f"{label}ต่างกัน ({run_a.get(key)} / {run_b.get(key)})")
    pa = run_a.get("provenance", {}).get("population_source")
    pb = run_b.get("provenance", {}).get("population_source")
    if pa != pb:
        blocking.append("ประชากรที่ใช้เป็นตัวหารต่างกัน")
    ca, cb = _columns(run_a), _columns(run_b)
    common = [c for c in ca if c in cb]
    excluded_cols = sorted(set(ca) ^ set(cb))
    if not common:
        blocking.append("ไม่มีตัวชี้วัดระดับประเทศที่มีหน่วยเดียวกัน")
    elif excluded_cols:
        caveats.append(f"ตัวชี้วัดที่มีในรอบเดียว (ไม่นำมาเทียบ): {excluded_cols}")
    va, vb = _provinces(run_a), _provinces(run_b)
    excluded_prov = sorted(va ^ vb)
    if excluded_prov:
        caveats.append(f"จังหวัดที่มีในรอบเดียว (ไม่นำมาเทียบ): {excluded_prov[:20]}")
    if run_a.get("evidence_label") != run_b.get("evidence_label"):
        caveats.append(f"ระดับหลักฐานต่างกัน ({run_a.get('evidence_label')} / {run_b.get('evidence_label')})")
    changes = {"data": [], "calibration": [], "assumption": [], "policy": []}
    da = run_a.get("provenance", {}).get("datasets", {}) or {}
    db = run_b.get("provenance", {}).get("datasets", {}) or {}
    for did in sorted(set(da) | set(db)):
        if (da.get(did) or {}).get("sha256") != (db.get(did) or {}).get("sha256"):
            changes["data"].append(did)
    pa_ = {p["id"]: p for p in run_a.get("parameters") or []}
    pb_ = {p["id"]: p for p in run_b.get("parameters") or []}
    for pid in sorted(set(pa_) | set(pb_)):
        x, y = pa_.get(pid), pb_.get(pid)
        if x is None or y is None:
            blocking.append(f"พารามิเตอร์ {pid} มีในรอบเดียว")
            continue
        if not _same(x["value"], y["value"]):
            changes[SOURCE.get(x["kind"], "assumption")].append(pid)
    verdict = "not_comparable" if blocking else ("comparable_with_caveats" if caveats else "comparable")
    return dict(schema="hrh-service-module.comparability/1", verdict=verdict, verdict_th=VERDICTS[verdict],
                blocking=blocking, caveats=caveats, changes=changes, common_columns=common,
                excluded_columns=excluded_cols, excluded_provinces=excluded_prov)


def national_difference(run_a: dict, run_b: dict, columns: list[str]) -> list[dict]:
    """B minus A for the common national columns, by year (only for comparable runs)."""
    a = {r["year"]: r for r in run_a["tables"]["national_by_year"]}
    b = {r["year"]: r for r in run_b["tables"]["national_by_year"]}
    out = []
    for y in sorted(set(a) & set(b)):
        row = {"year": y}
        for c in columns:
            if isinstance(a[y].get(c), (int, float)) and isinstance(b[y].get(c), (int, float)):
                row[c] = b[y][c] - a[y][c]
        out.append(row)
    return out


def staged(run, config: dict, inputs: dict | None) -> dict:
    """run: the module run function (config, inputs) -> result dict.
    config = {module, base: {datasets}, new: {datasets}, overrides: {param: value}, years}."""
    module, years = config["module"], config.get("years")
    base, new = (config.get("base") or {}).get("datasets") or {}, (config.get("new") or {}).get("datasets") or {}
    if not base or not new:
        return dict(schema="hrh-service-module.staged/1", module=module, status="invalid",
                    errors=["ต้องมีชุดข้อมูลทั้งชุดเดิม (base) และชุดใหม่ (new)"])
    overrides = config.get("overrides") or {}
    cfg = lambda ds, ov: {"module": module, "datasets": ds, "overrides": ov, **({"years": years} if years else {})}
    r0 = run(cfg(base, {}), inputs)
    if r0.get("status") != "completed":
        return dict(schema="hrh-service-module.staged/1", module=module, status="invalid", errors=r0.get("errors", []),
                    failed_stage="base", datasets=r0.get("datasets"))
    kinds = {p["id"]: p["kind"] for p in r0["parameters"]}
    frozen = {p["id"]: p["value"] for p in r0["parameters"] if p["kind"] == "estimated"}
    assumption = {k: v for k, v in overrides.items() if kinds.get(k) != "policy"}
    policy = {k: v for k, v in overrides.items() if kinds.get(k) == "policy"}
    runs = [r0, run(cfg(new, frozen), inputs), run(cfg(new, assumption), inputs), run(cfg(new, assumption | policy), inputs)]
    for (sid, _), r in zip(STAGES, runs):
        if r.get("status") != "completed":
            return dict(schema="hrh-service-module.staged/1", module=module, status="invalid", errors=r.get("errors", []),
                        failed_stage=sid, datasets=r.get("datasets"))
    steps, headline = [], []
    for i in range(1, len(runs)):
        c = comparability(runs[i - 1], runs[i])
        steps.append(dict(from_stage=STAGES[i - 1][0], to_stage=STAGES[i][0], **c,
                          difference=national_difference(runs[i - 1], runs[i], c["common_columns"])
                          if c["verdict"] != "not_comparable" else []))
    last = runs[0]["years"][-1]
    cols = [c for c in _columns(runs[0]) if all(c in _columns(r) for r in runs)]
    for c in cols:
        vals = [next((row.get(c) for row in r["tables"]["national_by_year"] if row["year"] == last), None) for r in runs]
        row = {"indicator": c, "year": last, **{sid: v for (sid, _), v in zip(STAGES, vals)}}
        if all(isinstance(v, (int, float)) for v in vals):
            row |= {"effect_new_data": vals[1] - vals[0], "effect_refit_or_method": vals[2] - vals[1],
                    "effect_policy": vals[3] - vals[2], "total_change": vals[3] - vals[0]}
        headline.append(row)
    return dict(schema="hrh-service-module.staged/1", module=module, status="completed",
                stages=[dict(id=sid, label_th=lab, evidence_label=r["evidence_label"], provenance=r["provenance"],
                             parameters=r["parameters"], warnings=r["warnings"], checks=r["checks"])
                        for (sid, lab), r in zip(STAGES, runs)],
                steps=steps, headline=headline,
                note_th="ผลรวมของสามขั้นเท่ากับการเปลี่ยนแปลงทั้งหมด ลำดับขั้นเป็นข้อตกลง: ผลของแต่ละขั้นอาจต่างไปถ้าสลับลำดับ")
