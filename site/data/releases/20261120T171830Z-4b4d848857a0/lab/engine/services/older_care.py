"""Older-person home and community care — the activity/FTE ledger as a data-ready module (plan §4.1).

DRAFT STRUCTURE: package content needs practitioner review.  The defaults are the illustrative
placeholders of config/services/older_person_home_care.toml (a test keeps the two identical).

Calibration (when datasets are uploaded):
    prevalence by age     = in-state / assessed (pooled); province ratio shrunk to 1
    task/travel minutes   = mean of an activity-time study by activity, cadre and component
    available FTE         = workforce by province and cadre -> deliverable vs required care
    caregiver hours       = mean of a caregiver time-use survey (hours per week per dependent person)
Coverage and setting shares are policy; frequencies, support hours and working time are assumptions.

Informal (unpaid) care is reported SEPARATELY as hours and full-time-caregiver equivalents for every
dependent older person (covered or not).  It is never added to, or netted against, health-workforce
FTE: unpaid care is not unlimited replacement capacity (plan §4.1).
"""
from __future__ import annotations

import copy

import numpy as np
import pandas as pd

from . import ledger as L
from .contract import Col, DatasetSpec, ModuleSpec, Param, shrink_ratio

AGES = ["60-69", "70-79", "80+"]
DEFAULT_PACKAGE = {
    "package": {"id": "older_home_care", "label": "ดูแลผู้สูงอายุที่มีภาวะพึ่งพิงที่บ้านและในชุมชน (ตัวอย่าง)",
                "version": "0.1-illustrative", "age_groups": AGES, "coverage": 0.80},
    "prevalence": {"60-69": 0.02, "70-79": 0.06, "80+": 0.20},
    "activities": {
        "assessment": {"label": "ประเมินและวางแผนการดูแล", "per_recipient": 1, "settings": {"primary_care": 1.0},
                       "task_minutes": {"nurse": 45}},
        "nurse_home_visit": {"label": "เยี่ยมบ้านโดยพยาบาล", "per_recipient": 12, "settings": {"home": 1.0},
                             "task_minutes": {"nurse": 30}, "travel_minutes": {"nurse": 30}},
        "home_rehabilitation": {"label": "ฟื้นฟูสมรรถภาพที่บ้าน", "per_recipient": 4, "settings": {"home": 1.0},
                                "task_minutes": {"physiotherapist": 45}, "travel_minutes": {"physiotherapist": 30},
                                "replaces_hospital": {"activity": "hospital_opd_rehabilitation", "per_activity": 0.5,
                                                      "hospital_minutes": {"physiotherapist": 20}}},
        "physician_review": {"label": "ทบทวนโดยแพทย์ (ที่ รพ.สต. หรือทางไกล)", "per_recipient": 2,
                             "settings": {"primary_care": 0.5, "remote": 0.5}, "task_minutes": {"physician": 15}},
        "care_assistant_visit": {"label": "ผู้ช่วยเหลือดูแลเยี่ยมบ้าน", "per_recipient": 52, "settings": {"home": 1.0},
                                 "task_minutes": {"care_assistant": 60}, "travel_minutes": {"care_assistant": 15}},
    },
    "support_hours": {"nurse": 2},
    "cadres": {r: {"contract_hours": 1920, "leave_share": 0.10, "nonclinical_share": 0.10,
                   "nonclinical_excludes": ex} for r, ex in
               [("nurse", ["travel", "support"]), ("physician", []), ("physiotherapist", ["travel"]),
                ("care_assistant", ["travel"])]},
}
ACTIVITIES = list(DEFAULT_PACKAGE["activities"])
CADRES = list(DEFAULT_PACKAGE["cadres"])

SPEC = ModuleSpec(
    id="older_care", label_th="ดูแลผู้สูงอายุที่บ้านและในชุมชน", label_en="Older-person home and community care",
    version="0.1-draft", status="draft_structure",
    question_th="ผู้สูงอายุที่มีภาวะพึ่งพิงต้องการบริการที่บ้านและในชุมชนเท่าใด ต้องใช้บุคลากรกี่ FTE และส่วนที่ให้บริการไม่ได้มีเท่าใด",
    datasets=[
        DatasetSpec("older_care_state", "ผลการประเมินภาวะพึ่งพิง", "Dependency assessment results",
                    [Col("age_group", "age_group"), Col("assessed", "float", "persons", min=1),
                     Col("in_state", "float", "persons", min=0), Col("prov_code", "prov_code", required=False)],
                    ["age_group", "prov_code"], ["prevalence", "province_ratio"],
                    "จำนวนผู้ได้รับการประเมิน และจำนวนที่อยู่ในภาวะพึ่งพิง (เช่น ADL ต่ำกว่าเกณฑ์) ตามกลุ่มอายุ 60–69, 70–79, 80+",
                    required_for_run=True),
        DatasetSpec("older_time_study", "การศึกษาเวลาต่องาน", "Activity-time study",
                    [Col("activity", "str", allowed=ACTIVITIES), Col("cadre", "str", allowed=CADRES),
                     Col("component", "str", allowed=["task", "travel"]), Col("minutes", "float", "minutes", min=0)],
                    [], ["task_minutes"], "หนึ่งแถวต่อหนึ่งการสังเกต (นาทีที่ใช้จริงต่อกิจกรรม)"),
        DatasetSpec("workforce_fte", "บุคลากรที่มีอยู่ (FTE)", "Available workforce (FTE)",
                    [Col("prov_code", "prov_code"), Col("cadre", "str", allowed=CADRES), Col("fte", "float", "FTE", min=0)],
                    ["prov_code", "cadre"], ["available_fte"], "ใช้คำนวณบริการที่ให้ได้จริงเทียบกับที่ต้องการ"),
        DatasetSpec("older_caregiver_time", "เวลาของผู้ดูแลในครอบครัว", "Informal caregiver time use",
                    [Col("hours_per_week", "float", "hours/week", min=0, max=168),
                     Col("age_group", "age_group", required=False)],
                    [], ["informal_care_hours_per_week"],
                    "หนึ่งแถวต่อผู้สูงอายุที่มีภาวะพึ่งพิงหนึ่งคน: ชั่วโมงต่อสัปดาห์ที่ญาติหรือผู้ดูแลที่ไม่ได้รับค่าจ้างใช้ดูแล"),
    ],
    params=[
        Param("prevalence", "ความชุกภาวะพึ่งพิงตามกลุ่มอายุ", "estimated", None, "share", provenance="estimated",
              estimated_from="older_care_state", description="ไม่มีค่าตั้งต้น: ต้องอัปโหลดข้อมูล"),
        Param("province_ratio", "อัตราส่วนภาวะพึ่งพิงรายจังหวัด", "estimated", {}, "ratio", estimated_from="older_care_state"),
        Param("task_minutes", "นาทีต่อกิจกรรม (งาน/เดินทาง)", "estimated",
              {a: {"task": v["task_minutes"], "travel": v.get("travel_minutes", {})} for a, v in DEFAULT_PACKAGE["activities"].items()},
              "minutes", estimated_from="older_time_study"),
        Param("available_fte", "บุคลากรที่มีอยู่รายจังหวัด", "estimated", {}, "FTE", estimated_from="workforce_fte"),
        Param("coverage", "เป้าความครอบคลุม", "policy", DEFAULT_PACKAGE["package"]["coverage"], "share", provenance="policy",
              bounds=(0, 1)),
        Param("remote_review_share", "สัดส่วนการทบทวนโดยแพทย์ทางไกล", "policy", 0.5, "share", provenance="policy", bounds=(0, 1)),
        Param("per_recipient", "ความถี่ต่อผู้รับบริการต่อปี", "assumption",
              {a: v["per_recipient"] for a, v in DEFAULT_PACKAGE["activities"].items()}, "per year"),
        Param("substitution_rate", "ครั้ง OPD ฟื้นฟูที่ลดลงต่อการฟื้นฟูที่บ้านหนึ่งครั้ง", "assumption", 0.5, "visits"),
        Param("support_hours", "ชั่วโมงประสานงานต่อผู้รับบริการต่อปี", "assumption", DEFAULT_PACKAGE["support_hours"], "hours"),
        Param("working_time", "เวลาทำงานตามวิชาชีพ", "assumption", DEFAULT_PACKAGE["cadres"], "hours/shares"),
        Param("informal_care_hours_per_week", "ชั่วโมงดูแลโดยผู้ดูแลในครอบครัวต่อผู้มีภาวะพึ่งพิงต่อสัปดาห์", "estimated",
              {"60-69": 14.0, "70-79": 18.0, "80+": 24.0}, "hours/week", estimated_from="older_caregiver_time",
              description="แสดงแยก ไม่รวมใน FTE ของบุคลากรสุขภาพ"),
        Param("caregiver_full_time_hours", "ชั่วโมงต่อปีของผู้ดูแลเต็มเวลาหนึ่งคน (ใช้แปลงเป็นจำนวนคนเทียบเท่า)", "assumption",
              2080.0, "hours/year", provenance="convention"),
    ],
    outputs=["eligible and recipients", "activities by setting", "hours and FTE by cadre",
             "deliverable vs unmet care (if FTE uploaded)", "hospital rehabilitation visits avoided",
             "informal caregiver hours (separate; never health-workforce FTE)"],
    references=["WHO. Integrated care for older people (ICOPE): handbook, 2nd ed. Geneva: WHO; 2024.",
                "WHO. Workload indicators of staffing need (WISN), 2nd ed. Geneva: WHO; 2023."],
)


def calibrate(tables: dict) -> tuple[dict, list[dict]]:
    out, diag = {}, []
    if "older_care_state" in tables:
        d = tables["older_care_state"]
        if (d.in_state > d.assessed).any():
            raise ValueError("older_care_state: in_state มากกว่า assessed")
        g = d.groupby("age_group")[["assessed", "in_state"]].sum().reindex(AGES)
        if g.isna().any().any():
            raise ValueError(f"older_care_state ต้องมีกลุ่มอายุ {AGES} ครบ (ไม่เติมค่าแทน)")
        prev = (g.in_state / g.assessed)
        out["prevalence"] = dict(value=prev.round(6).to_dict(), source="dataset:older_care_state",
                                 note=f"ประเมินรวม {int(g.assessed.sum()):,} คน")
        diag.append(dict(parameter="prevalence", n=float(g.assessed.sum())))
        if "prov_code" in d.columns and d.prov_code.notna().all() and (d.prov_code > 0).any():
            z = d[d.age_group.isin(AGES)].assign(exp=lambda x: x.assessed * x.age_group.map(prev))
            z = z.groupby("prov_code")[["in_state", "exp"]].sum()
            out["province_ratio"] = dict(value={int(k): round(float(v), 4) for k, v in zip(z.index, shrink_ratio(z.in_state, z.exp))},
                                         source="dataset:older_care_state", note="observed/expected ปรับเข้าหา 1")
    if "older_time_study" in tables:
        d = tables["older_time_study"]
        base = SPEC_PARAM("task_minutes").default
        val = copy.deepcopy(base)
        for (a, r, comp), z in d.groupby(["activity", "cadre", "component"]):
            val[a][comp][r] = round(float(z.minutes.mean()), 3)
            diag.append(dict(parameter=f"task_minutes[{a}][{comp}][{r}]", n=float(len(z)), sd=float(z.minutes.std(ddof=1)) if len(z) > 1 else np.nan))
        out["task_minutes"] = dict(value=val, source="dataset:older_time_study", note="ค่าเฉลี่ยของการสังเกต; กิจกรรมที่ไม่มีข้อมูลใช้ค่าตั้งต้น")
    if "workforce_fte" in tables:
        d = tables["workforce_fte"]
        out["available_fte"] = dict(value={f"{int(r.prov_code)}|{r.cadre}": float(r.fte) for r in d.itertuples()},
                                    source="dataset:workforce_fte")
    if "older_caregiver_time" in tables:
        d = tables["older_caregiver_time"]
        val = dict(SPEC_PARAM("informal_care_hours_per_week").default)
        if "age_group" in d.columns:
            g = d[d.age_group.isin(AGES)].groupby("age_group").hours_per_week.agg(["mean", "size"])
            for a, r in g.iterrows():
                val[a] = round(float(r["mean"]), 3)
                diag.append(dict(parameter=f"informal_care_hours_per_week[{a}]", n=float(r["size"])))
            note = "ค่าเฉลี่ยตามกลุ่มอายุ; กลุ่มที่ไม่มีข้อมูลใช้ค่าตั้งต้น"
        else:
            val = {a: round(float(d.hours_per_week.mean()), 3) for a in AGES}
            diag.append(dict(parameter="informal_care_hours_per_week", n=float(len(d))))
            note = "ค่าเฉลี่ยรวม ใช้กับทุกกลุ่มอายุ"
        out["informal_care_hours_per_week"] = dict(value=val, source="dataset:older_caregiver_time", note=note)
    return out, diag


def SPEC_PARAM(pid):
    return next(p for p in SPEC.params if p.id == pid)


def package_from(p: dict) -> L.Package:
    c = copy.deepcopy(DEFAULT_PACKAGE)
    c["package"]["coverage"] = float(p["coverage"])
    c["prevalence"] = {g: float(p["prevalence"][g]) for g in AGES}
    for a, v in c["activities"].items():
        v["per_recipient"] = float(p["per_recipient"][a])
        v["task_minutes"] = dict(p["task_minutes"][a]["task"])
        if p["task_minutes"][a].get("travel"):
            v["travel_minutes"] = dict(p["task_minutes"][a]["travel"])
    rs = float(p["remote_review_share"])
    c["activities"]["physician_review"]["settings"] = {"primary_care": 1 - rs, "remote": rs}
    c["activities"]["home_rehabilitation"]["replaces_hospital"]["per_activity"] = float(p["substitution_rate"])
    c["support_hours"] = dict(p["support_hours"])
    c["cadres"] = copy.deepcopy(p["working_time"])
    acts = [L.Activity(id=k, label=v["label"], per_recipient=v["per_recipient"], settings=v["settings"],
                       task_minutes=v["task_minutes"], travel_minutes=v.get("travel_minutes", {}),
                       replaces_hospital=v.get("replaces_hospital")) for k, v in c["activities"].items()]
    prov = {"package.coverage": "policy"}
    return L.Package(id=c["package"]["id"], label=c["package"]["label"], age_groups=AGES, prevalence=c["prevalence"],
                     coverage=c["package"]["coverage"], activities=acts, support_hours=c["support_hours"],
                     cadres=c["cadres"], provenance=prov, version=c["package"]["version"])


def run(p: dict, population: pd.DataFrame, years: list[int]) -> dict:
    pkg = package_from(p)
    L.validate(pkg)
    ratio = p["province_ratio"] or {}
    pop = population[population.year.isin(years)][["prov_code", "year"] + AGES].copy()
    r = pop.prov_code.map(lambda pc: float(ratio.get(pc, ratio.get(str(pc), 1.0))))
    for g in AGES:                       # eligible = N x prevalence x province ratio
        pop[g] = pop[g] * r
    avail = None
    if p["available_fte"]:
        rows = [dict(prov_code=int(k.split("|")[0]), cadre=k.split("|")[1], available_fte=v) for k, v in p["available_fte"].items()]
        a = pd.DataFrame(rows)
        avail = pop[["prov_code", "year"]].merge(a, on="prov_code")
    out = L.evaluate(pkg, pop, available_fte=avail)
    out["informal_care"] = informal_care(p, pop)
    return out


def informal_care(p: dict, pop: pd.DataFrame) -> pd.DataFrame:
    """Unpaid care for ALL dependent older persons, covered or not (pop = persons x province ratio)."""
    hw, prev = p["informal_care_hours_per_week"], p["prevalence"]
    z = pop[["prov_code", "year"]].copy()
    z["dependent_older_persons"] = sum(pop[g] * float(prev[g]) for g in AGES)
    z["informal_care_hours"] = sum(pop[g] * float(prev[g]) * float(hw[g]) * 52 for g in AGES)
    z["caregiver_full_time_equivalents"] = z.informal_care_hours / float(p["caregiver_full_time_hours"])
    return z
