"""Workforce Lab data layer: dataset contracts, user-data runs, other cadres and regional planning.

Design: authoring docs/workforce_lab_system_design_th.md (sections 6-8).  One contract per replaceable dataset; the
same contract serves a browser upload (room "ข้อมูลของฉัน"), a submitted package (lab_submission) and, later, an
agency feed.  Nothing here changes the Chapter 5 engine: a user-data run replaces input rows and calls
chapter5.lab_adapter unchanged, and a regional plan re-solves a slice of the national allocation Problem.

Browser-safe: numpy/pandas and the packed chapter5 engine only, no file reads.  The Lab worker calls dispatch_json.
The research tree owns this file; the authoring workspace receives a copy (scripts/sync_scientific_source.py).

Contracts
    lab.physician_stock/1   prov_code, physicians              -> base.H0 and the frame rows (H0, phi = H0 / occupied)
    lab.positions_j18/1     prov_code, positions, occupied     -> frame positions, occupied, vacant, phi
    lab.cadre/1             prov_code, headcount + national entrants, exit rate, re-entry rate, target density
                            -> a population-target (family P) plan for another cadre, no positions frame

A province missing from an uploaded physician file keeps the project value and is listed; it is never filled with
zero.  Phi (on-site physicians per position holder) follows frame.inputs (H0 / occupied) when the user supplies a
province's positions, because both registers are then the user's.  When only the physician count changes, the
on-site capacity of the province's positions (phi x positions) is kept: fewer physicians than the project data
leave more room, as a planner expects; phi rises only when the new count already exceeds that capacity
(phi = H0 / positions, a full frame).  Recomputing phi from a corrected count and an uncorrected occupancy would
shrink the room exactly where the count fell (Loei 195 -> 165: room 37.5 -> 31.7 instead of 67.5).

Regional planning (scope.level = "health_region"): the national plan is solved first; the region receives the
appointments (and, under a decided frame, the positions) that the national plan placed in its provinces, or an
allotment the user enters; the allocation Problem restricted to the region is solved again with the national
targets of the chosen criterion; provinces outside the region keep the national plan.  Supported: deterministic,
recruitment-only, joint-horizon plans (P, S, N-STD, B; frame none, F0, F1, F2, need).
"""
from __future__ import annotations

import copy
import dataclasses
import hashlib
import io
import json
import math
import time
from types import SimpleNamespace

import numpy as np
import pandas as pd

from chapter5 import allocation as AL, lab_adapter as LA, simulation as SIM

YEARS = LA.YEARS
PROFILE_SCHEMA = "hrh-lab.data-profile/1"
INFO_COLUMNS = {"province", "province_en", "health_region", "note"}
CADRES = {"dentists": ("ทันตแพทย์", "Dentists"), "professional_nurses": ("พยาบาลวิชาชีพ", "Professional nurses"),
          "pharmacists": ("เภสัชกร", "Pharmacists"), "other": ("วิชาชีพอื่น", "Other cadre")}
CONTRACTS = {
    "lab.physician_stock/1": dict(
        title_th="จำนวนแพทย์ต้นแผน (สิ้นปี 2568) รายจังหวัด", title_en="Physicians at the start of the plan (end of 2025)",
        values=["physicians"], integer=True, minimum=1, partial=True,
        affects_th="จำนวนต้นแผนของทุกแผน และขีดรับในกรอบตำแหน่ง (phi = แพทย์ / ผู้ครองตำแหน่ง)",
        unaffected_th="เป้าหมาย ดัชนีความจำเป็น M5 อัตราออก"),
    "lab.positions_j18/1": dict(
        title_th="ตำแหน่ง จ.18 รายจังหวัด", title_en="J.18 positions by province",
        values=["positions", "occupied"], integer=True, minimum=1, partial=True,
        affects_th="ขีดรับในกรอบตำแหน่ง ตำแหน่งว่าง และ phi", unaffected_th="แผนที่ปิดกรอบตำแหน่ง"),
    "lab.cadre/1": dict(
        title_th="วิชาชีพอื่น: จำนวนรายจังหวัด", title_en="Other cadre: headcount by province",
        values=["headcount"], integer=True, minimum=1, partial=False,
        affects_th="ทั้งแผนของวิชาชีพนั้น (โหมดทั่วไป)", unaffected_th="แผนของแพทย์"),
}
WARN_PROVINCE = 0.30          # relative change of one province that is shown as a warning
WARN_NATIONAL = 0.10          # relative change of the national total
# Generic-mode settings a package may omit: no provincial minimum, arrivals up to 30% of the opening stock, and
# entrants without room reported as unplaced instead of making the plan infeasible.
CADRE_DEFAULTS = {"reentry_rate": 0.0, "floor": 0, "cap_fraction": 0.3, "full_placement": False}
REGIONAL_FAMILIES = {"P", "S", "N-STD", "B"}
REGIONAL_FRAMES = {"none", "F0", "F1", "F2", "need"}


class DataError(ValueError):
    pass


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def fingerprint(value) -> str:
    return hashlib.sha256(json.dumps(LA.clean(value), sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode()).hexdigest()


# ----------------------------------------------------------------------------- project values and templates

def project_rows(inputs: dict) -> list[dict]:
    """The project's values of every replaceable province dataset (the prefilled templates and the diff base)."""
    frame = {int(r["prov_code"]): r for r in inputs.get("frame") or []}
    rows = []
    for b in sorted(inputs["base"], key=lambda r: int(r["prov_code"])):
        code = int(b["prov_code"])
        f = frame.get(code, {})
        rows.append(dict(prov_code=code, province=b["province"], province_en=b.get("province_en", ""),
                         health_region=int(b["health_region"]), physicians=float(b["H0"]),
                         positions=float(f["positions"]) if f else None, occupied=float(f["occupied"]) if f else None))
    return rows


def templates(inputs: dict) -> dict:
    rows = project_rows(inputs)
    return {"schema_version": "hrh-lab.templates/1",
            "contracts": {k: {key: v for key, v in c.items()} for k, c in CONTRACTS.items()},
            "rows": rows,
            "regions": sorted({r["health_region"] for r in rows}),
            "has_frame": bool(inputs.get("frame")),
            "has_burden": bool(inputs.get("burden"))}


# ----------------------------------------------------------------------------- parsing and validation

def parse_table(data) -> pd.DataFrame:
    """CSV text (UTF-8, optional BOM, thousands separators inside quotes) or a list of row objects."""
    if isinstance(data, list):
        df = pd.DataFrame(data)
    elif isinstance(data, str):
        text = data.lstrip("﻿")
        if not text.strip():
            raise DataError("ไฟล์ว่าง / empty file")
        df = pd.read_csv(io.StringIO(text), dtype=str, skipinitialspace=True, keep_default_na=False)
    else:
        raise DataError("dataset must be CSV text or a list of rows")
    df.columns = [str(c).strip().lower().lstrip("﻿") for c in df.columns]
    return df


def _number(value):
    """A cell as float, None when blank.  Thousands separators are accepted, other text is an error."""
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return None if (isinstance(value, float) and math.isnan(value)) else float(value)
    text = str(value).strip().replace(",", "").replace(" ", "")
    if text == "" or text.lower() in {"na", "nan", "-"}:
        return None
    try:
        out = float(text)
    except ValueError as exc:
        raise DataError(f"'{value}' ไม่ใช่ตัวเลข / is not a number") from exc
    if not math.isfinite(out):
        raise DataError(f"'{value}' ไม่ใช่ตัวเลขจำกัด / is not finite")
    return out


def validate_dataset(contract_id: str, data, inputs: dict, project: list[dict] | None = None) -> dict:
    """Check one uploaded dataset against its contract; returns the report with the normalised rows.

    errors make the dataset unusable; warnings are shown and kept with the result."""
    if contract_id not in CONTRACTS:
        raise DataError(f"unknown dataset contract {contract_id}")
    c = CONTRACTS[contract_id]
    project = project or project_rows(inputs)
    by_code = {r["prov_code"]: r for r in project}
    errors, warnings = [], []
    try:
        df = parse_table(data)
    except (DataError, ValueError, pd.errors.ParserError) as exc:
        return dict(contract=contract_id, valid=False, errors=[str(exc)], warnings=[], rows=[], changed=[])
    allowed = {"prov_code", *c["values"], *INFO_COLUMNS, *(f"{v}_project" for v in c["values"])}
    extra = [col for col in df.columns if col not in allowed]
    if extra:
        errors.append("คอลัมน์ที่ไม่อยู่ในสัญญาข้อมูล / columns outside the contract: " + ", ".join(extra[:8]))
    missing_cols = [col for col in ["prov_code", *c["values"]] if col not in df.columns]
    if missing_cols:
        errors.append("ไม่มีคอลัมน์ / missing columns: " + ", ".join(missing_cols))
    if errors:
        return dict(contract=contract_id, valid=False, errors=errors, warnings=warnings, rows=[], changed=[])
    seen, rows, blanks = set(), {}, []
    for i, raw in enumerate(df.to_dict("records"), start=2):           # row 1 is the header
        try:
            code = _number(raw.get("prov_code"))
        except DataError:
            code = None
        if code is None or code != int(code):
            errors.append(f"แถว {i}: รหัสจังหวัดไม่ถูกต้อง / invalid province code '{raw.get('prov_code')}'")
            continue
        code = int(code)
        if code not in by_code:
            hint = " (กรุงเทพฯ ไม่อยู่ในขอบเขต 76 จังหวัด)" if code == 10 else ""
            errors.append(f"แถว {i}: ไม่รู้จักรหัสจังหวัด {code}{hint} / unknown province code")
            continue
        if code in seen:
            errors.append(f"แถว {i}: จังหวัด {code} ซ้ำ / duplicate province")
            continue
        seen.add(code)
        vals = {}
        for col in c["values"]:
            try:
                v = _number(raw.get(col))
            except DataError as exc:
                errors.append(f"แถว {i} ({by_code[code]['province']}) {col}: {exc}")
                continue
            if v is None:
                blanks.append((code, col))
                continue
            if c["integer"] and v != round(v):
                errors.append(f"แถว {i} ({by_code[code]['province']}) {col}: ต้องเป็นจำนวนเต็ม / must be a whole number")
            elif v < c["minimum"]:
                errors.append(f"แถว {i} ({by_code[code]['province']}) {col}: ต้องไม่น้อยกว่า {c['minimum']} / below the minimum")
            vals[col] = float(round(v)) if c["integer"] else v
        rows[code] = vals
    if not c["partial"]:
        absent = [r for r in project if r["prov_code"] not in rows]
        if absent:
            errors.append(f"ขาด {len(absent)} จังหวัด / missing provinces: " + ", ".join(r["province"] for r in absent[:10]))
        if blanks:
            errors.append(f"ค่าว่าง {len(blanks)} ช่อง: ชุดนี้ต้องครบทุกจังหวัด / blank cells: complete data are required")
    normalised, changed, kept = [], [], []
    for r in project:
        code = r["prov_code"]
        out = {"prov_code": code, "province": r["province"], "health_region": r["health_region"]}
        supplied = False
        for col in c["values"]:
            user = rows.get(code, {}).get(col)
            base = r.get(col)
            out[col] = user if user is not None else base
            out[col + "_source"] = "user" if user is not None else "project"
            supplied |= user is not None
            if user is not None and base is not None and user != base:
                rel = (user - base) / base if base else math.inf
                changed.append({"prov_code": code, "province": r["province"], "column": col, "project": base,
                                "user": user, "difference": user - base, "relative": rel})
                if abs(rel) > WARN_PROVINCE:
                    warnings.append(f"{r['province']} {col}: {base:,.0f} → {user:,.0f} ({100 * rel:+.0f}%) "
                                    f"ต่างจากค่าของโครงการเกินร้อยละ {100 * WARN_PROVINCE:.0f}")
        if c["partial"] and not supplied:
            kept.append(r["province"])
        normalised.append(out)
    if contract_id == "lab.positions_j18/1":
        for out in normalised:
            if out["positions"] is not None and out["occupied"] is not None and out["positions"] < out["occupied"]:
                errors.append(f"{out['province']}: ตำแหน่ง ({out['positions']:,.0f}) น้อยกว่าผู้ครองตำแหน่ง "
                              f"({out['occupied']:,.0f}) / positions below occupied")
    if c["partial"] and kept:
        warnings.append(f"ใช้ค่าของโครงการใน {len(kept)} จังหวัดที่ไม่มีในไฟล์หรือเว้นว่าง / project values kept for "
                        f"{len(kept)} provinces" + (": " + ", ".join(kept[:6]) + (" …" if len(kept) > 6 else "") if len(kept) < 76 else ""))
    for col in c["values"]:
        user_total = sum(o[col] or 0 for o in normalised)
        base_total = sum(r.get(col) or 0 for r in project)
        if base_total and abs(user_total - base_total) / base_total > WARN_NATIONAL:
            warnings.append(f"ผลรวมประเทศ {col}: {base_total:,.0f} → {user_total:,.0f} "
                            f"({100 * (user_total - base_total) / base_total:+.1f}%)")
    if c["partial"] and not changed and not errors:
        warnings.append("ไม่มีค่าที่ต่างจากข้อมูลของโครงการ / identical to the project data")
    canonical = [{k: v for k, v in o.items() if not k.endswith("_source")} for o in normalised]
    return dict(contract=contract_id, title_th=c["title_th"], title_en=c["title_en"], valid=not errors, errors=errors,
                warnings=warnings, rows=normalised, changed=changed, provinces_changed=len({x["prov_code"] for x in changed}),
                provinces_supplied=len(rows), sha256=fingerprint({"contract": contract_id, "rows": canonical}),
                affects_th=c["affects_th"], unaffected_th=c["unaffected_th"])


# ----------------------------------------------------------------------------- applying user datasets

def apply_datasets(inputs: dict, reports: dict) -> dict:
    """Inputs with the validated physician datasets in place (deep copy; the release inputs are never changed)."""
    out = copy.deepcopy(inputs)
    stock = reports.get("lab.physician_stock/1")
    pos = reports.get("lab.positions_j18/1")
    if stock is not None:
        h0 = {r["prov_code"]: float(r["physicians"]) for r in stock["rows"]}
        for b in out["base"]:
            b["H0"] = h0[int(b["prov_code"])]
    h0 = {int(b["prov_code"]): float(b["H0"]) for b in out["base"]}
    if out.get("frame") and (stock is not None or pos is not None):
        # provinces whose positions the user supplied (rather than kept from the project) get phi = H0 / occupied
        newpos = {r["prov_code"]: r for r in pos["rows"] if "user" in (r.get("positions_source"), r.get("occupied_source"))} if pos is not None else {}
        for f in out["frame"]:
            code = int(f["prov_code"])
            phi_project = float(f["phi"])
            if code in newpos:
                f["positions"] = float(newpos[code]["positions"])
                f["occupied"] = float(newpos[code]["occupied"])
            f["vacant"] = float(f["positions"]) - float(f["occupied"])
            f["H0"] = h0[code]
            if float(f["occupied"]) <= 0 or float(f["positions"]) <= 0:
                raise DataError(f"{f['province']}: ตำแหน่งและผู้ครองตำแหน่งต้องมากกว่าศูนย์ / positions and occupied must be positive")
            if code in newpos:
                f["phi"] = h0[code] / float(f["occupied"])      # frame.inputs: phi = H0 / occupied
            else:
                f["phi"] = max(phi_project, h0[code] / float(f["positions"]))   # keep the positions' on-site capacity
            f["capacity_onsite"] = f["phi"] * float(f["positions"])
            f["room_onsite"] = f["capacity_onsite"] - h0[code]
    elif pos is not None:
        raise DataError("this release carries no positions-frame inputs")
    return out


def data_profile(reports: dict, cadre: dict | None = None) -> dict:
    datasets = [{"contract": k, "title_th": r["title_th"], "sha256": r["sha256"], "provinces_changed": r["provinces_changed"],
                 "provinces_supplied": r["provinces_supplied"], "warnings": r["warnings"],
                 "changed": r["changed"]} for k, r in sorted(reports.items())]
    if cadre is not None:
        datasets.append({"contract": "lab.cadre/1", "title_th": "วิชาชีพอื่น: " + cadre["label_th"], "sha256": cadre["sha256"],
                         "provinces_changed": None, "provinces_supplied": 76, "warnings": cadre["warnings"], "changed": []})
    # An upload identical to the project data leaves the result a project-data result (listed, not labelled).
    source = "user" if cadre is not None or any(d["provinces_changed"] for d in datasets) else "project"
    profile = {"schema_version": PROFILE_SCHEMA, "source": source, "datasets": datasets}
    profile["sha256"] = fingerprint([(d["contract"], d["sha256"]) for d in datasets]) if source == "user" else None
    return profile


# ----------------------------------------------------------------------------- other cadres (generic mode)

def check_cadre(pkg: dict, inputs: dict) -> dict:
    """Validate a lab.cadre/1 package: complete headcounts plus national entrants, exit, re-entry and target density."""
    if not isinstance(pkg, dict):
        raise DataError("cadre package must be an object")
    pkg = {**CADRE_DEFAULTS, **{k: v for k, v in pkg.items() if v is not None}}
    cadre = pkg.get("cadre", "other")
    if cadre not in CADRES:
        raise DataError(f"unknown cadre {cadre}")
    report = validate_dataset("lab.cadre/1", pkg.get("rows"), inputs)
    errors, warnings = list(report["errors"]), list(report["warnings"])
    def scalar(key, lo, hi, label):
        try:
            v = _number(pkg.get(key))
        except DataError as exc:
            errors.append(f"{label}: {exc}")
            return None
        if v is None or not lo <= v <= hi:
            errors.append(f"{label}: ต้องอยู่ระหว่าง {lo} ถึง {hi} / must be between {lo} and {hi}")
            return None
        return v
    exit_rate = scalar("exit_rate", 0.001, 0.5, "อัตราออกต่อปี / annual exit rate")
    reentry = scalar("reentry_rate", 0.0, 0.2, "อัตรากลับเข้า / re-entry rate")
    target = scalar("target_per_1000", 0.05, 5.0, "เป้าหมายต่อประชากร 1,000 คน / target per 1,000")
    floor = scalar("floor", 0, 100, "ขั้นต่ำต่อจังหวัด / provincial floor")
    cap = scalar("cap_fraction", 0.0, 1.0, "เพดานผู้มาใหม่ / onboarding cap")
    entrants = pkg.get("entrants")
    try:
        path = LA.trajectory(entrants)
        if (path < 0).any() or (path > 20000).any():
            raise ValueError("between 0 and 20,000 per year")
    except (ValueError, TypeError, KeyError) as exc:
        errors.append(f"ผู้เข้าใหม่ต่อปี / entrants per year: {exc}")
        path = None
    label_th, label_en = CADRES[cadre]
    label_th = str(pkg.get("label_th") or label_th)[:60]
    label_en = str(pkg.get("label_en") or label_en)[:60]
    total = sum(r["headcount"] for r in report["rows"]) if report["valid"] else None
    if total and path is not None and target is not None:
        pop = sum(float(b["pop_civil"]) for b in inputs["base"])
        density = 1000 * total / pop
        if target < 0.5 * density or target > 3 * density:
            warnings.append(f"เป้าหมาย {target:.3g} ต่อ 1,000 คน ต่างจากความหนาแน่นปัจจุบัน {density:.3g} มาก / "
                            "target far from the current density")
        if path.max() > 0.5 * total:
            warnings.append("ผู้เข้าใหม่ต่อปีเกินครึ่งหนึ่งของจำนวนปัจจุบัน / entrants exceed half the current stock")
    out = dict(cadre=cadre, label_th=label_th, label_en=label_en, valid=not errors, errors=errors, warnings=warnings,
               rows=report["rows"], exit_rate=exit_rate, reentry_rate=reentry, target_per_1000=target,
               floor=int(floor) if floor is not None else None, cap_fraction=cap, entrants=entrants,
               full_placement=bool(pkg.get("full_placement", False)), scope_note=str(pkg.get("scope_note") or "")[:200],
               source_note=str(pkg.get("source_note") or "")[:500])
    out["sha256"] = fingerprint({k: out[k] for k in ["cadre", "rows", "exit_rate", "reentry_rate", "target_per_1000",
                                                     "floor", "cap_fraction", "entrants", "full_placement"]})
    return out


def cadre_inputs(inputs: dict, cadre: dict) -> dict:
    """Release inputs with the cadre's stock and one national exit and re-entry rate in place of the physician rows."""
    out = copy.deepcopy(inputs)
    stock = {r["prov_code"]: float(r["headcount"]) for r in cadre["rows"]}
    for b in out["base"]:
        b["H0"] = stock[int(b["prov_code"])]
    h_exit = -math.log(1 - cadre["exit_rate"])             # annual probability -> competing-risk hazard
    rates = {"resignation": h_exit, "reinstatement": cadre["reentry_rate"]}
    for r in out["flow_rates"]:
        h = rates.get(r["cause"], 0.0)
        code = int(r["prov_code"])
        exposure = max(stock[code], 1.0)
        r.update(events=h * exposure, exposure=exposure, exposure_same_year_stock=exposure, rate_raw=h, prior_level="national",
                 prior_mean=h, post_a=max(h, 1e-9) * 1000.0, post_b=1000.0, rate_pooled=h, shrinkage=1.0, rate_national=h,
                 rate_same_year_exposure=h)
    return out


def cadre_config(config: dict, cadre: dict, inputs: dict) -> dict:
    """Scenario of the generic mode: family P targets, no positions frame or transfers, deterministic."""
    user = (config or {}).get("parameters", {})
    keep = {k: user[k] for k in ["demography.scenario", "targets.responsibility_population", "allocation.population_register",
                                 "allocation.cap_mode"] if k in user}
    params = {**keep, "allocation.family": "P", "frame.rule": "none", "mobility.enabled": False,
              "planning.mode": "fixed_schedule", "uncertainty.enabled": False, "allocation.objective": "shortfall",
              "supply.input_mode": "available_appointments", "supply.available_appointments": cadre["entrants"],
              "targets.reference_per_1000": cadre["target_per_1000"], "targets.experiment": "common_total",
              "departures.rate_source": "national", "allocation.floor": cadre["floor"],
              "allocation.cap_fraction": cadre["cap_fraction"], "allocation.full_placement": cadre["full_placement"]}
    if "allocation.population_reserved_share" in {p["id"] for p in inputs["registry"]["parameters"]}:
        params["allocation.population_reserved_share"] = 0
    return {"schema_version": "workforce-lab.scenario/1", "name": (config or {}).get("name") or cadre["label_th"],
            "parameters": params}


def _cadre_result(result: dict, cadre: dict) -> dict:
    """A cadre run never shows physician-specific outputs or a comparison with the physician plan."""
    for key in ["comparison", "service_outcomes", "frame"]:
        result.pop(key, None)
    tables = result.get("context_tables") or {}
    result["context_tables"] = {k: tables[k] for k in ["demography", "supply_pipeline", "context_units"] if k in tables}
    methods = result.setdefault("methods", {})
    methods.update(
        scope=f"{cadre['label_en']} ({cadre['scope_note'] or 'scope stated by the user'}), 76 provinces excluding Bangkok; "
              "user-supplied stock, entrants and one national exit and re-entry rate (generic mode)",
        target=f"{cadre['label_en']} at the end of each year against a population-based target of "
               f"{cadre['target_per_1000']:g} per 1,000 (family P); illustrative, not a sufficiency standard",
        generic_mode="stock-flow ledger and the Chapter 5 linear programme; no positions frame, no bonded or training "
                     "flows, no service-based need for this cadre, one national exit rate; results stay in the generic "
                     "view and are never compared with physician plans")
    for key in ["service", "feedback"]:
        methods.pop(key, None)
    return result


# ----------------------------------------------------------------------------- regional planning

def regional_support(p: dict) -> list[str]:
    """Reasons a resolved scenario cannot be re-planned within a region (empty = supported)."""
    why = []
    if p["allocation.family"] not in REGIONAL_FAMILIES:
        why.append("เกณฑ์ N-FB และ SQ-C ยังไม่รองรับการจัดสรรภายในเขต / N-FB and SQ-C are national only")
    if p.get("planning.mode") != "fixed_schedule":
        why.append("การปรับแผนรายปีใช้ได้เฉพาะระดับประเทศ / annual replanning is national only")
    if p.get("mobility.enabled"):
        why.append("การโอนย้ายต้องกำหนดการโอนข้ามเขต จึงยังไม่รองรับ / transfers are national only")
    if p.get("uncertainty.enabled"):
        why.append("ความไม่แน่นอนใช้ได้เฉพาะระดับประเทศ / uncertainty is national only")
    if p.get("frame.rule", "none") not in REGIONAL_FRAMES:
        why.append("กรอบตำแหน่ง F3, GDh และ GDc มีงบระดับประเทศ จึงยังไม่รองรับ / F3, GDh and GDc are national only")
    if p.get("allocation.objective", "shortfall") != "shortfall":
        why.append("เป้าหมาย maximin ใช้ได้เฉพาะระดับประเทศ / maximin is national only")
    if p.get("allocation.population_reserved_share", 0):
        why.append("โควตาตามประชากรใช้ได้เฉพาะระดับประเทศ / population quotas are national only")
    return why


def slice_problem(pb: AL.Problem, idx: np.ndarray, T: np.ndarray, A: np.ndarray, budget=None, label="") -> AL.Problem:
    """The allocation Problem restricted to provinces idx, with its own targets, pool and (decided frame) budget."""
    kw = {f.name: getattr(pb, f.name) for f in dataclasses.fields(AL.Problem) if f.init}
    for k in ["provs", "H0", "region"]:
        kw[k] = np.asarray(kw[k])[idx]
    for k in ["d", "r", "exo", "committed", "reservation_population", "announced_x", "reference_x"]:
        if kw.get(k) is not None:
            kw[k] = np.asarray(kw[k])[:, idx]
    kw.update(T=np.asarray(T, float), A=np.asarray(A, float), label=label or pb.label)
    if pb.frame is not None:
        f = dict(pb.frame)
        if f.get("emp_mode") is not None or f.get("overflow") or f.get("realloc"):
            raise DataError("this positions-frame rule is national only")
        f["K0"], f["phi"] = np.asarray(f["K0"])[idx], np.asarray(f["phi"])[idx]
        if f["mode"] == "schedule":
            f["schedule"] = np.asarray(f["schedule"])[:, idx]
        if f["mode"] == "optimize":
            f["budget"] = np.asarray(budget if budget is not None else f["budget"], float)
        f.pop("n_cycles", None)
        kw["frame"] = f
    return AL.Problem(**kw)


def _replace_columns(full, part, idx):
    """full [rows, 76] with the region's columns taken from part [rows, len(idx)]; other shapes pass through."""
    if full is None or part is None:
        return full
    out = np.array(full, copy=True)
    part = np.asarray(part)
    if out.ndim == 2 and part.ndim == 2 and part.shape == (out.shape[0], len(idx)):
        out[:, idx] = part
    return out


def _joint_run(config, inputs, versions, scope, progress=None, integral=None, plan_id=None):
    """A deterministic joint-horizon plan; with scope.level = health_region the allocation is then re-solved inside
    that region (module docstring).  integral=False solves the appointments as a linear programme (generic mode)."""
    start = time.perf_counter()
    regional = scope.get("level") == "health_region"
    LA._notify(progress, "validating")
    valid = LA.validate(config, inputs, versions)
    if not valid["valid"]:
        return {"schema_version": LA.SCHEMA, "status": "invalid", "validation": valid, "config": config, "versions": versions}
    p = valid["resolved_parameters"]
    why = regional_support(p) if regional else [m for m in regional_support(p) if "N-FB" in m or "replanning" in m
                                                  or "uncertainty" in m or "transfers" in m]
    region = int(scope.get("health_region", 0)) if regional else None
    family_r = (scope.get("family") or p["allocation.family"]) if regional else p["allocation.family"]
    if regional and family_r not in REGIONAL_FAMILIES:
        why.append(f"เกณฑ์ของเขต {family_r} ยังไม่รองรับ / regional criterion not supported")
    if regional and family_r == "B" and not inputs.get("burden"):
        why.append("ชุดเผยแพร่นี้ไม่มีข้อมูลภาระโรค / this release has no burden data")
    if why:
        return {"schema_version": LA.SCHEMA, "status": "invalid", "config": config, "versions": versions,
                "validation": {"valid": False, "errors": [{"parameter": "scope", "message": m} for m in why], "warnings": []}}
    LA._notify(progress, "resolving_inputs", parameters_changed=len(valid["parameter_diff"]))
    try:
        ctx = LA.context(p, inputs)
    except (ValueError, KeyError) as exc:
        return {"schema_version": LA.SCHEMA, "status": "invalid", "config": config, "versions": versions,
                "validation": {"valid": False, "errors": [{"parameter": "model_inputs", "message": str(exc)}]}}
    idx = np.flatnonzero(ctx.region == region) if regional else np.arange(len(ctx.provs))
    if not len(idx):
        return {"schema_version": LA.SCHEMA, "status": "invalid", "config": config, "versions": versions,
                "validation": {"valid": False, "errors": [{"parameter": "scope", "message": f"unknown health region {region}"}]}}
    spec = LA.specification(p)
    if plan_id:
        spec = dataclasses.replace(spec, plan_id=plan_id)
    framed = "frame_spec" in spec.overrides
    stages = {} if framed else {"stages": ("shortfall", "distribution", "operational")}
    T = SIM.targets_matrix(ctx.idx, spec.index_col, spec.experiment, ctx.k, 2025, YEARS)
    pb = SIM.make_problem(ctx, spec, T, **stages)
    if integral is not None:
        pb.integral_x = bool(integral)
    LA._notify(progress, "solving", plan_id=spec.plan_id, years=len(YEARS), provinces=len(ctx.provs), method="joint_horizon")
    sol = AL.solve(pb, objective="lexicographic")
    if sol.status != "solved":
        return LA.clean({"schema_version": LA.SCHEMA, "run_id": "lab-national-unsolved", "status": LA._status(sol), "config": config,
                         "versions": versions, "source": "computed",
                         "diagnostics": {"solver_stages": sol.stages, "solver": sol.diagnostics, "warnings": valid["warnings"],
                                         "regional": "the national plan was not solved, so no regional allotment exists"}})
    if not regional:
        LA._notify(progress, "evaluating", plan_id=spec.plan_id)
        return LA._package(config, p, versions, inputs, ctx, spec, pb, sol, time.perf_counter() - start, valid)
    # Targets of the region's criterion: the national Problem of that criterion (frame net-targets included), sliced.
    if family_r != p["allocation.family"]:
        p_r = {**p, "allocation.family": family_r}
        spec_r = LA.specification(p_r)
        T_full = SIM.targets_matrix(ctx.idx, spec_r.index_col, spec_r.experiment, ctx.k, 2025, YEARS)
        T_r = SIM.make_problem(ctx, spec_r, T_full, **stages).T[:, idx]
    else:
        T_r = pb.T[:, idx]
    allotted = np.asarray(sol.x, float)[:, idx].sum(1)
    pool_source = "national_plan"
    if scope.get("pool") not in (None, "", "national_plan"):
        try:
            A_r = LA.trajectory(scope["pool"])
        except (ValueError, TypeError, KeyError) as exc:
            return {"schema_version": LA.SCHEMA, "status": "invalid", "config": config, "versions": versions,
                    "validation": {"valid": False, "errors": [{"parameter": "scope.pool", "message": str(exc)}]}}
        if (A_r < 0).any() or (A_r > 20000).any():
            return {"schema_version": LA.SCHEMA, "status": "invalid", "config": config, "versions": versions,
                    "validation": {"valid": False, "errors": [{"parameter": "scope.pool", "message": "0–20,000 per year"}]}}
        if not framed:
            A_r = np.round(A_r)
        pool_source = "user"
    else:
        A_r = allotted.copy()
    budget = None
    if pb.frame is not None and pb.frame["mode"] == "optimize":
        budget = np.asarray(sol.frame["added"], float)[:, idx].sum(1)
    label = f"{spec.plan_id}@R{region}"
    try:
        pb_r = slice_problem(pb, idx, T_r, A_r, budget=budget, label=label)
    except (DataError, ValueError) as exc:
        return {"schema_version": LA.SCHEMA, "status": "invalid", "config": config, "versions": versions,
                "validation": {"valid": False, "errors": [{"parameter": "scope", "message": str(exc)}]}}
    LA._notify(progress, "solving_region", health_region=region, provinces=int(len(idx)))
    sol_r = AL.solve(pb_r, objective="lexicographic")
    if sol_r.status != "solved":
        return LA.clean({"schema_version": LA.SCHEMA, "run_id": "lab-region-unsolved", "status": LA._status(sol_r), "config": config,
                         "versions": versions, "source": "computed",
                         "diagnostics": {"solver_stages": sol_r.stages, "solver": sol_r.diagnostics, "warnings": valid["warnings"],
                                         "regional": f"the allocation inside health region {region} was not solved"}})
    # Composite: the national plan with the region's columns replaced.
    x = np.array(sol.x, copy=True)
    x[:, idx] = sol_r.x
    zin, zout = np.zeros_like(x), np.zeros_like(x)
    v = _replace_columns(sol.v, sol_r.v, idx)
    spill = _replace_columns(sol.spill, sol_r.spill, idx)
    frame = {}
    for key, value in (sol.frame or {}).items():
        part = (sol_r.frame or {}).get(key)
        frame[key] = _replace_columns(value, part, idx) if isinstance(value, np.ndarray) and part is not None else value
    A_c = np.asarray(pb.A, float) - allotted + A_r
    pb_c = copy.copy(pb)
    pb_c.A = A_c
    T_c = np.array(pb.T, copy=True)
    T_c[:, idx] = T_r
    pb_c.T, pb_c.w = T_c, T_c / T_c.sum(1, keepdims=True)
    u = A_c - np.asarray(x, float).sum(1)
    stages_log = list(sol.stages) + [{**s, "scope": f"health_region_{region}"} for s in sol_r.stages]
    diagnostics = {**(sol.diagnostics or {}), "regional_solver": sol_r.diagnostics, "regional": True}
    sol_c = AL.Solution("solved", x, zin, zout, None, u, stages_log, diagnostics, v=v, spill=spill, frame=frame)
    sol_c.H = AL.trajectory(pb_c, x, zin, zout, spill)
    ctx_c = SimpleNamespace(**vars(ctx))
    ctx_c.pool = A_c
    spec_c = dataclasses.replace(spec, plan_id=label)
    LA._notify(progress, "evaluating", plan_id=label)
    result = LA._package(config, p, versions, inputs, ctx_c, spec_c, pb_c, sol_c, time.perf_counter() - start, valid)
    # Region summary: national plan versus the regional re-plan for the provinces of the region.
    Hn = AL.trajectory(pb, sol.x, sol.zin, sol.zout, sol.spill)
    # The published principal plan (project data) beside both plans, so a user-data run shows its data effect too.
    pub = (inputs.get("cached_plans") or {}).get("P-R") if plan_id is None else None
    x_pub = np.asarray(pub["x"], float) if pub and np.asarray(pub["x"]).shape == np.asarray(sol.x).shape else None
    provinces = []
    for j, i in enumerate(idx):
        code = int(ctx.provs[i])
        provinces.append({"prov_code": code, "province": ctx.names[code],
                          "appointments_national_plan": float(np.asarray(sol.x, float)[:, i].sum()),
                          "appointments_regional_plan": float(np.asarray(sol_r.x, float)[:, j].sum()),
                          "closing_2040_national_plan": float(Hn[-1, i]), "closing_2040_regional_plan": float(sol_c.H[-1, i]),
                          "target_2040": float(T_c[-1, i]),
                          "attainment_2040_national_plan": float(Hn[-1, i] / T_c[-1, i]),
                          "attainment_2040_regional_plan": float(sol_c.H[-1, i] / T_c[-1, i])})
        provinces[-1]["difference"] = provinces[-1]["appointments_regional_plan"] - provinces[-1]["appointments_national_plan"]
        provinces[-1]["appointments_published_plan"] = float(x_pub[:, i].sum()) if x_pub is not None else None
    annual = []
    for t, y in enumerate(YEARS):
        placed = float(np.asarray(sol_r.x, float)[t].sum())
        annual.append({"year_ce": y, "year_be": y + 543, "allotment_national_plan": float(allotted[t]),
                       "allotment_used": float(A_r[t]), "placed": placed, "unplaced": float(A_r[t] - placed),
                       "closing_stock": float(sol_c.H[t, idx].sum()), "target": float(T_c[t, idx].sum())})
    region_names = sorted({ctx.names[int(ctx.provs[i])] for i in idx})
    result["scope"] = {"level": "health_region", "health_region": region, "prov_codes": [int(ctx.provs[i]) for i in idx],
                       "provinces": region_names, "pool_source": pool_source, "family": family_r,
                       "national_family": p["allocation.family"]}
    result["regional"] = {
        "health_region": region, "annual": annual, "provinces": provinces,
        "objective_national_part": float(AL.objective_exact(slice_problem(pb, idx, T_r, allotted, budget=budget), Hn[:, idx])),
        "objective_regional_plan": float(AL.objective_exact(pb_r, sol_c.H[:, idx])),
        "solver_stages": sol_r.stages,
        "method_th": ("คำนวณแผนประเทศก่อน แล้วจัดสรรใหม่เฉพาะจังหวัดในเขตด้วยแบบจำลองเดียวกัน เป้าหมายคำนวณระดับประเทศ "
                      "(มาตรฐานเดียวกันทุกเขต) จำนวนแพทย์ใหม่ของเขต" + (" ตามแผนประเทศ" if pool_source == "national_plan"
                                                                         else " ตามที่ผู้ใช้กำหนด")
                      + (" ตำแหน่งที่เพิ่มต่อรอบกรอบเท่ากับที่แผนประเทศเพิ่มในเขต" if budget is not None else "")
                      + " จังหวัดนอกเขตใช้แผนประเทศเดิม"),
        "limitations_th": ["ไม่มีการโอนย้ายข้ามเขต", "ใช้กับแผนกำหนดแน่นอนเท่านั้น (ไม่รวมความไม่แน่นอน)",
                           "ตัวชี้วัดกลุ่มล่าง 19 จังหวัดเป็นของทั้งประเทศ ใช้ตาราง Region_Summary สำหรับเขต",
                           "คำตอบที่ดีเท่ากันมีได้หลายชุด แผนเขตจึงอาจต่างจากส่วนของแผนประเทศแม้ข้อมูลเดิม"]}
    if pool_source == "user":
        result["regional"]["note_th"] = ("จำนวนที่เขตได้รับต่างจากแผนประเทศ ยอดรวมประเทศในผลนี้จึงต่างจากจำนวนรับใหม่ที่ตั้งไว้ "
                                         f"{float((A_r - allotted).sum()):+,.0f} คนตลอดแผน")
    return result


# ----------------------------------------------------------------------------- entry points

def run(op: dict, inputs: dict, versions: dict | None = None, progress=None) -> dict:
    """One Lab computation with optional user datasets, another cadre and a regional scope."""
    versions = dict(versions or {})
    config = op.get("config") or {"schema_version": "workforce-lab.scenario/1", "parameters": {}}
    scope = op.get("scope") or {"level": "national"}
    cadre, reports = None, {}
    if op.get("cadre"):
        cadre = check_cadre(op["cadre"], inputs)
        if not cadre["valid"]:
            return {"schema_version": LA.SCHEMA, "status": "invalid", "config": config, "versions": versions,
                    "validation": {"valid": False, "errors": [{"parameter": "cadre", "message": m} for m in cadre["errors"]],
                                   "warnings": cadre["warnings"]}}
        work_inputs = cadre_inputs(inputs, cadre)
        config = cadre_config(config, cadre, inputs)
    else:
        project = project_rows(inputs)
        for contract_id, data in (op.get("datasets") or {}).items():
            reports[contract_id] = validate_dataset(contract_id, data, inputs, project)
        bad = [m for r in reports.values() for m in r["errors"]]
        if bad:
            return {"schema_version": LA.SCHEMA, "status": "invalid", "config": config, "versions": versions,
                    "validation": {"valid": False, "errors": [{"parameter": "datasets", "message": m} for m in bad[:20]],
                                   "warnings": []}, "datasets": reports}
        try:
            work_inputs = apply_datasets(inputs, reports) if reports else inputs
        except DataError as exc:
            return {"schema_version": LA.SCHEMA, "status": "invalid", "config": config, "versions": versions,
                    "validation": {"valid": False, "errors": [{"parameter": "datasets", "message": str(exc)}]}}
    profile = data_profile(reports, cadre)
    if profile["sha256"]:
        versions["data_profile_sha256"] = profile["sha256"]
    if scope.get("level") == "health_region":
        versions["scope"] = f"health_region_{int(scope.get('health_region', 0))}"
    # The generic mode solves continuous appointments (a linear programme, as the positions-frame plans do): with
    # integer appointments the small, flat provincial problems of another cadre take minutes in HiGHS.
    if scope.get("level") == "health_region" or cadre is not None:
        result = _joint_run(config, work_inputs, versions, scope, progress, integral=False if cadre is not None else None,
                            plan_id=f"{cadre['cadre']}-P" if cadre is not None else None)
    else:
        result = LA.run(config, work_inputs, versions, progress)
    result.setdefault("scope", {"level": "national"})
    result["data_profile"] = profile
    result["labels"] = {"data": profile["source"], "scope": result.get("scope", {}).get("level", "national"),
                        "health_region": result.get("scope", {}).get("health_region"),
                        "cadre": cadre["cadre"] if cadre else "physicians"}
    if cadre is not None:
        result["cadre"] = {k: cadre[k] for k in ["cadre", "label_th", "label_en", "exit_rate", "reentry_rate", "target_per_1000",
                                                 "floor", "cap_fraction", "entrants", "full_placement", "scope_note",
                                                 "source_note", "warnings", "sha256"]}
        if result.get("status") not in ("invalid",):
            result = _cadre_result(result, cadre)
    elif reports and result.get("comparison"):
        result["comparison"]["reference_note"] = ("published P-R computed with the project data; this run uses the "
                                                  "user's datasets listed in data_profile")
    return LA.clean(result)


def dispatch(op: dict, inputs: dict, versions: dict | None = None, progress=None) -> dict:
    kind = op.get("op")
    if kind == "templates":
        return templates(inputs)
    if kind == "validate":
        project = project_rows(inputs)
        if op.get("cadre"):
            return {"cadre": check_cadre(op["cadre"], inputs)}
        return {"datasets": {k: validate_dataset(k, v, inputs, project) for k, v in (op.get("datasets") or {}).items()}}
    if kind == "run":
        return run(op, inputs, versions, progress)
    raise DataError(f"unknown workspace operation {kind}")


def dispatch_json(op_json: str, inputs_json: str, versions_json: str = "{}", progress=None) -> str:
    try:
        out = dispatch(json.loads(op_json), json.loads(inputs_json), json.loads(versions_json), progress)
    except DataError as exc:
        out = {"status": "invalid", "validation": {"valid": False, "errors": [{"parameter": "workspace", "message": str(exc)}]}}
    return LA.dumps(out)
