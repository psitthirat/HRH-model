"""Entry points of the data-ready service modules, shared by native runs and the browser Lab.

All inputs and outputs are JSON, so the Lab worker can call the same functions in Pyodide:

    describe_json()                              module specs, dataset schemas, CSV templates
    synthetic_json(module, inputs_json)          synthetic demonstration datasets (CSV text)
    validate_json(config_json, inputs_json)      schema checks + calibration preview + parameter table
    run_json(config_json, inputs_json)           full run after the user confirms the calibration
    staged_json(config_json, inputs_json)        base data -> new data (frozen calibration) -> recalibrated -> policy
    comparability_json(config_json)              comparability contract of two runs {"runs": [a, b]}

config = {"module": id, "datasets": {dataset_id: {"text": csv, "name": filename, "synthetic": bool}},
          "overrides": {param_id: value}, "years": [first, last]}

Uploaded files are processed in memory and never written or transmitted.  A run is a pure
function of (module version, dataset SHA-256s, overrides, population), recorded in `provenance`
so a new dataset or assumption re-runs automatically and comparably.
"""
from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd

from . import cancer, compare as CMP, esrd, older_care, population as POP, referral as RF, synthetic
from .contract import (EVIDENCE, evidence_label, param_dict, read_csv_text, resolve_params, text_sha256, to_records,
                       validate_dataset)

MODULES = {"older_care": older_care, "esrd": esrd, "cancer": cancer}
SCHEMA = "hrh-service-module.run/1"


def _clean(v):
    if isinstance(v, dict):
        return {str(k): _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        return None if not math.isfinite(float(v)) else float(v)
    if isinstance(v, pd.DataFrame):
        return to_records(v)
    return v


def dumps(v) -> str:
    return json.dumps(_clean(v), ensure_ascii=False, allow_nan=False)


def describe() -> dict:
    return {"schema": "hrh-service-modules/1", "evidence_labels": EVIDENCE,
            "modules": {k: m.SPEC.describe() for k, m in MODULES.items()}}


def describe_json() -> str:
    return dumps(describe())


def _population(inputs: dict | None) -> pd.DataFrame:
    if inputs and inputs.get("service_population"):
        return POP.from_inputs(inputs["service_population"])
    return POP.native()


def synthetic_json(module: str, inputs_json: str = "{}") -> str:
    pop = _population(json.loads(inputs_json or "{}"))
    data = synthetic.GENERATORS[module](pop)
    return dumps({k: {"text": v.to_csv(index=False), "name": f"SYNTHETIC_{k}.csv", "synthetic": True}
                  for k, v in data.items()})


def _prepare(config: dict, inputs: dict | None):
    mod = MODULES[config["module"]]
    spec = mod.SPEC
    pop = _population(inputs)
    provs = sorted(pop.prov_code.unique().tolist())
    reports, tables, meta = {}, {}, {}
    for did, item in (config.get("datasets") or {}).items():
        if did not in {d.id for d in spec.datasets}:
            reports[did] = dict(ok=False, errors=[f"โมดูลนี้ไม่ใช้ชุดข้อมูล {did}"], warnings=[])
            continue
        text = item.get("text", "")
        try:
            df = read_csv_text(text)
        except Exception as e:                       # malformed CSV
            reports[did] = dict(ok=False, errors=[f"อ่าน CSV ไม่ได้: {e}"], warnings=[])
            continue
        v = validate_dataset(spec.dataset(did), df, provs)
        reports[did] = dict(ok=v["ok"], errors=v["errors"], warnings=v["warnings"], rows=len(df))
        meta[did] = dict(name=item.get("name", ""), sha256=text_sha256(text), rows=len(df), synthetic=bool(item.get("synthetic")))
        if v["ok"] and did.endswith("_referral"):
            share_errors = RF.check(v["table"])
            if share_errors:
                reports[did] = dict(ok=False, errors=share_errors, warnings=v["warnings"], rows=len(df))
                continue
        if v["ok"]:
            tables[did] = v["table"]
    missing = [d.id for d in spec.datasets if d.required_for_run and d.id not in tables]
    errors = []
    if missing:
        errors.append(f"ต้องมีชุดข้อมูล {missing} ก่อนรัน (ดาวน์โหลดแม่แบบหรือใช้ข้อมูลสังเคราะห์สาธิต)")
    calibrated, diag = {}, []
    try:
        calibrated, diag = mod.calibrate(tables)
    except ValueError as e:
        errors.append(str(e))
    overrides = config.get("overrides") or {}
    unknown = sorted(set(overrides) - {p.id for p in spec.params})
    if unknown:
        errors.append(f"ไม่รู้จักพารามิเตอร์ {unknown}")
    params = resolve_params(spec, calibrated, {k: v for k, v in overrides.items() if k not in unknown})
    years = list(range(int((config.get("years") or [pop.year.min()])[0]), int((config.get("years") or [0, pop.year.max()])[-1]) + 1))
    years = [y for y in years if y in set(pop.year)]
    return mod, spec, pop, years, reports, tables, meta, params, diag, errors


def validate_json(config_json: str, inputs_json: str = "{}") -> str:
    config, inputs = json.loads(config_json), json.loads(inputs_json or "{}")
    mod, spec, pop, years, reports, tables, meta, params, diag, errors = _prepare(config, inputs)
    ok = not errors and all(r["ok"] for r in reports.values())
    return dumps(dict(schema="hrh-service-module.validation/1", module=spec.id, ok=ok, errors=errors,
                      datasets=reports, calibration=diag, parameters=params,
                      evidence_label=evidence_label(meta, params), evidence_text=EVIDENCE[evidence_label(meta, params)]))


def _national(df: pd.DataFrame, value_cols: list[str]) -> pd.DataFrame:
    return df.groupby("year")[value_cols].sum().reset_index()


def run(config: dict, inputs: dict | None = None) -> dict:
    mod, spec, pop, years, reports, tables, meta, params, diag, errors = _prepare(config, inputs)
    if errors or not all(r["ok"] for r in reports.values()):
        return dict(schema=SCHEMA, module=spec.id, status="invalid", errors=errors, datasets=reports)
    p = param_dict(params)
    warnings, checks, out = [], {}, {}
    if spec.id == "older_care":
        r = mod.run(p, pop, years)
        fte = r["fte"]
        out["national_by_year"] = fte.pivot_table(index="year", columns="cadre", values="required_fte", aggfunc="sum").reset_index()
        rec = r["activity"].drop_duplicates(["prov_code", "year"]).groupby("year").recipients.sum()
        out["national_by_year"]["recipients"] = out["national_by_year"].year.map(rec)
        last = years[-1]
        out["province_last_year"] = fte[fte.year == last].pivot_table(index="prov_code", columns="cadre", values="required_fte").reset_index()
        out["activity_national"] = r["activity"].groupby(["year", "activity", "setting"]).volume.sum().reset_index()
        if "deliverable" in r:
            d = r["deliverable"]
            out["deliverable_national"] = d.groupby(["year", "activity"])[["volume", "deliverable_volume", "unmet_volume"]].sum().reset_index()
        out["hospital_avoided_national"] = _national(r["hospital_required"], ["hospital_volume_change"])
        out["informal_care_national"] = _national(r["informal_care"], ["dependent_older_persons", "informal_care_hours",
                                                                       "caregiver_full_time_equivalents"])
        checks["deliverable_le_required"] = bool(("deliverable" not in r) or (r["deliverable"].deliverable_volume <= r["deliverable"].volume + 1e-9).all())
        warnings += r["warnings"]
    elif spec.id == "esrd":
        start = p.get("starting_stock") or {}
        if start and start.get("year") not in (None, years[0] - 1, years[0]):
            warnings.append(f"ผู้ป่วยตั้งต้นเป็นของปี {start.get('year')} แต่การฉายเริ่มปี {years[0]}: ใช้เป็นจุดตั้งต้นโดยไม่ปรับช่วงห่าง")
        stock = mod.project(p, pop, years)
        if (stock.start_basis == "stationary_assumption").any():
            warnings.append("ไม่มีข้อมูลผู้ป่วยคงอยู่: ใช้จำนวนในสภาวะคงตัวเป็นจุดตั้งต้น (ข้อสมมติ)")
        res, fte = mod.resources(p, stock, tables.get("dialysis_capacity"))
        checks["patient_balance_max_gap"] = mod.check_balance(stock, p)
        out["national_by_year"] = stock.pivot_table(index="year", columns="state", values="patients", aggfunc="sum").reset_index().merge(
            _national(res, ["hd_sessions", "hd_chairs_required", "nephrologist_fte", "dialysis_nurse_fte"]), on="year")
        out["province_last_year"] = res[res.year == years[-1]]
        out["province_year"] = res
        prov, gap = mod.provider_resources(p, res, tables.get("esrd_referral"), tables.get("dialysis_capacity"))
        out["province_last_year_provider"] = prov[prov.year == years[-1]]
        checks["referral_totals_preserved_max_gap"] = gap
        checks["provider_basis"] = "referral_flows" if "esrd_referral" in tables else "residence_default"
    else:
        cases = mod.project(p, pop, years)
        detail, agg = mod.resources(p, cases, tables.get("oncology_capacity"))
        sites = detail.groupby(["year", "site"])[["cases", "treated_surgery", "treated_chemotherapy", "treated_radiotherapy",
                                                  "treated_palliative", "followup_survivors", "chemo_cycles", "rt_fractions"]].sum().reset_index()
        out["national_by_site_year"] = sites
        fte_cols = [c for c in agg.columns if c.endswith("_fte")] + ["linacs_required", "chemo_chair_hours"]
        out["national_by_year"] = _national(agg, fte_cols)
        out["province_last_year"] = agg[agg.year == years[-1]]
        checks["stage_shares_sum_to_one"] = True
        prov, gap = mod.provider_resources(p, detail, tables.get("cancer_referral"), tables.get("oncology_capacity"))
        out["province_last_year_provider"] = prov[prov.year == years[-1]]
        checks["referral_totals_preserved_max_gap"] = gap
        checks["provider_basis"] = "referral_flows" if "cancer_referral" in tables else "residence_default"
        scr, w = mod.screening(p, pop, years)
        warnings += w
        sfte = mod.screening_fte(p, scr)
        out["screening_national_by_site_year"] = scr.groupby(["year", "site"])[
            ["target_population", "screened", "positives", "diagnostic_procedures"]].sum().reset_index()
        out["screening_national_by_year"] = _national(sfte, [c for c in sfte.columns if c.endswith("_fte")])
        shift = p["early_detection_shift"]
        checks["stage_shift_policy"] = {k: float(v) for k, v in shift.items()}
        if any(float((p["screening_policy"].get(k) or {}).get("coverage", 0)) > 0 for k in mod.SCREEN_SITES) \
                and not any(float(v) for v in shift.values()):
            warnings.append("การคัดกรองนับเฉพาะภาระงานของการคัดกรองและการตรวจต่อ ไม่เปลี่ยนระยะโรคหรืออุบัติการณ์เอง "
                            "ถ้าต้องการทดสอบผลต่อระยะโรค ให้กำหนด early_detection_shift (นโยบาย) แยก")
    label = evidence_label(meta, params)
    return dict(schema=SCHEMA, module=spec.id, module_version=spec.version, module_status=spec.status, status="completed",
                evidence_label=label, evidence_text=EVIDENCE[label], years=[years[0], years[-1]],
                provenance=dict(datasets=meta, overrides=config.get("overrides") or {},
                                population_source=(inputs or {}).get("service_population", {}).get("source", "native Chapter 5 projection")),
                datasets=reports, calibration=diag, parameters=params, warnings=warnings, checks=checks, tables=out)


def run_json(config_json: str, inputs_json: str = "{}") -> str:
    return dumps(run(json.loads(config_json), json.loads(inputs_json or "{}")))


def run_clean(config: dict, inputs: dict | None = None) -> dict:
    """A run as plain JSON-compatible values (records instead of frames)."""
    return json.loads(dumps(run(config, inputs)))


def staged_json(config_json: str, inputs_json: str = "{}") -> str:
    return dumps(CMP.staged(run_clean, json.loads(config_json), json.loads(inputs_json or "{}")))


def comparability_json(config_json: str) -> str:
    a, b = json.loads(config_json)["runs"]
    return dumps(CMP.comparability(a, b))


def dispatch_json(config_json: str, inputs_json: str = "{}") -> str:
    """Single browser entry point: config = {"op": describe|synthetic|validate|run, ...}."""
    config = json.loads(config_json)
    op = config.get("op")
    if op == "describe":
        return describe_json()
    if op == "synthetic":
        return synthetic_json(config["module"], inputs_json)
    if op == "validate":
        return validate_json(config_json, inputs_json)
    if op == "run":
        return run_json(config_json, inputs_json)
    if op == "staged":
        return staged_json(config_json, inputs_json)
    if op == "comparability":
        return comparability_json(config_json)
    raise ValueError(f"unknown service operation {op!r}")


if __name__ == "__main__":                     # export the population denominator for the Lab release
    import argparse
    from pathlib import Path
    ap = argparse.ArgumentParser()
    ap.add_argument("--export-population", type=Path, required=True)
    a = ap.parse_args()
    a.export_population.parent.mkdir(parents=True, exist_ok=True)
    a.export_population.write_text(json.dumps(POP.to_inputs(POP.native()), ensure_ascii=False))
    print("wrote", a.export_population)
