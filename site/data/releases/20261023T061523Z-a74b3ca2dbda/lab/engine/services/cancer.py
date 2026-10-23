"""Cancer pathways for five sites — incidence x stage x first-course treatment x follow-up (plan §4.3).

DRAFT STRUCTURE: to be reviewed by oncologists before any public use.

Sites: breast, lung, colorectal, cervix, liver (BOD codes H14, H11, H6, H15, H7).  Per province, year, site:

    cases[a]        = population[a] x incidence[site, a] x province ratio x incidence multiplier (policy)
    cases[stage]    = cases x stage share (after an optional early-detection shift, policy)
    treated[m]      = sum_stage cases[stage] x P(modality m | site, stage)      (modalities not exclusive)
    follow-up[t]    = sum_{k=1..5} cases[t-k] x survival(site, k)              (years before the horizon
                                                                               use the first year's cases)
    activities      = operations, chemotherapy cycles, radiotherapy fractions, palliative patient-years,
                      follow-up visits  ->  hours by cadre, linac hours, chemotherapy chair hours

Calibration: incidence (required; all 8 age groups per site), province ratios (shrunk to 1), stage
shares, treatment probabilities and survival come from uploaded datasets; otherwise stage,
treatment and survival use illustrative placeholders.  Prevalence of diagnosed cancer (the HDC
files) cannot replace incidence and is not accepted.

Screening (breast, cervix, colorectal) is a separate pathway with its own workload:

    screened[t]     = target population (women for breast/cervix) x round coverage / interval years
    positives       = screened x test positivity
    diagnostics     = positives x diagnostic follow-up completion   (colposcopy, colonoscopy, imaging)
    hours           = screened x test minutes + diagnostics x diagnostic minutes, by cadre

Screening never changes incidence or stage by itself: the early-detection shift is a separate,
explicit policy parameter, so a burden reduction is never obtained for free.

Cases are counted where patients live; an optional referral-flow dataset moves surgery,
chemotherapy, radiotherapy, palliative care and follow-up workload to the providing province
(`provider_resources`), and linac gaps are recomputed there.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import referral as RF
from .contract import AGE_GROUPS, Col, DatasetSpec, ModuleSpec, Param, shrink_ratio

SITES = {"breast": ("มะเร็งเต้านม", "H14"), "lung": ("มะเร็งปอด", "H11"),
         "colorectal": ("มะเร็งลำไส้ใหญ่และไส้ตรง", "H6"), "cervix": ("มะเร็งปากมดลูก", "H15"),
         "liver": ("มะเร็งตับ", "H7")}
STAGES = ["I", "II", "III", "IV"]
MODALITIES = ["surgery", "chemotherapy", "radiotherapy", "palliative"]
CADRES = ["surgeon", "medical_oncologist", "radiation_oncologist", "oncology_nurse", "theatre_nurse",
          "rt_technologist", "physician"]

# ---- illustrative placeholders (NOT Thai estimates) -------------------------------------------
STAGE_DEFAULT = {"breast": [0.20, 0.40, 0.25, 0.15], "lung": [0.10, 0.10, 0.25, 0.55],
                 "colorectal": [0.15, 0.25, 0.30, 0.30], "cervix": [0.25, 0.30, 0.30, 0.15],
                 "liver": [0.10, 0.15, 0.30, 0.45]}
# P(modality | stage) for stages I..IV, per site
TREAT_DEFAULT = {
    "breast": {"surgery": [0.95, 0.90, 0.70, 0.10], "chemotherapy": [0.30, 0.60, 0.85, 0.70],
               "radiotherapy": [0.60, 0.60, 0.70, 0.40], "palliative": [0.00, 0.00, 0.05, 0.40]},
    "lung": {"surgery": [0.70, 0.50, 0.15, 0.00], "chemotherapy": [0.20, 0.50, 0.70, 0.60],
             "radiotherapy": [0.20, 0.30, 0.60, 0.40], "palliative": [0.05, 0.10, 0.25, 0.60]},
    "colorectal": {"surgery": [0.95, 0.90, 0.85, 0.30], "chemotherapy": [0.05, 0.30, 0.75, 0.70],
                   "radiotherapy": [0.05, 0.15, 0.30, 0.15], "palliative": [0.00, 0.02, 0.05, 0.50]},
    "cervix": {"surgery": [0.70, 0.30, 0.05, 0.00], "chemotherapy": [0.10, 0.50, 0.80, 0.50],
               "radiotherapy": [0.30, 0.70, 0.90, 0.50], "palliative": [0.00, 0.02, 0.05, 0.50]},
    "liver": {"surgery": [0.50, 0.30, 0.10, 0.00], "chemotherapy": [0.10, 0.30, 0.50, 0.40],
              "radiotherapy": [0.05, 0.10, 0.15, 0.10], "palliative": [0.10, 0.30, 0.50, 0.80]},
}
SERVICES = ["surgery", "chemotherapy", "radiotherapy", "palliative", "followup"]
FEMALE = [f"F_{g}" for g in AGE_GROUPS]
SCREEN_SITES = {"breast": "female", "cervix": "female", "colorectal": "all"}
SCREEN_CADRES = ["primary_care_nurse", "lab_technologist", "radiographer", "radiologist", "gynaecologist", "endoscopist"]
# illustrative policy values (NOT Thai programme parameters); breast is off unless the user sets a coverage
SCREEN_POLICY_DEFAULT = {
    "cervix": {"target_age_groups": ["30-44", "45-59"], "coverage": 0.6, "interval_years": 5},
    "colorectal": {"target_age_groups": ["45-59", "60-69"], "coverage": 0.4, "interval_years": 2},
    "breast": {"target_age_groups": ["45-59", "60-69"], "coverage": 0.0, "interval_years": 2}}
SCREEN_POSITIVITY_DEFAULT = {"breast": 0.08, "cervix": 0.08, "colorectal": 0.07}
SCREEN_COMPLETION_DEFAULT = {"breast": 0.90, "cervix": 0.80, "colorectal": 0.60}
SCREEN_MINUTES_DEFAULT = {
    "cervix": {"test": {"primary_care_nurse": 15, "lab_technologist": 5}, "diagnostic": {"gynaecologist": 20, "primary_care_nurse": 20}},
    "colorectal": {"test": {"primary_care_nurse": 10, "lab_technologist": 3}, "diagnostic": {"endoscopist": 45, "primary_care_nurse": 45}},
    "breast": {"test": {"radiographer": 15, "radiologist": 5}, "diagnostic": {"radiologist": 30, "radiographer": 20}}}
SURV_DEFAULT = {"breast": [0.97, 0.94, 0.91, 0.89, 0.87], "lung": [0.45, 0.30, 0.22, 0.18, 0.15],
                "colorectal": [0.80, 0.70, 0.64, 0.60, 0.57], "cervix": [0.88, 0.78, 0.72, 0.69, 0.67],
                "liver": [0.35, 0.22, 0.16, 0.13, 0.11]}

SPEC = ModuleSpec(
    id="cancer", label_th="บริการมะเร็ง 5 ตำแหน่ง", label_en="Cancer pathways (five sites)",
    version="0.1-draft", status="draft_structure",
    question_th="ผู้ป่วยมะเร็งรายใหม่และผู้ที่ต้องติดตามผลจะมีเท่าใด และต้องใช้บุคลากรเฉพาะทาง เครื่องฉายรังสี และเก้าอี้ให้ยาเคมีเท่าใด",
    datasets=[
        DatasetSpec("cancer_incidence", "อุบัติการณ์มะเร็ง (ทะเบียนมะเร็ง)", "Cancer incidence (registry)",
                    [Col("site", "str", allowed=list(SITES)), Col("age_group", "age_group"),
                     Col("cases", "float", "cases", min=0), Col("population", "float", "persons", min=1),
                     Col("prov_code", "prov_code", required=False), Col("year", "int", required=False)],
                    ["site", "age_group", "prov_code", "year"], ["incidence_per_100k", "province_ratio"],
                    "จำนวนผู้ป่วยรายใหม่ตามตำแหน่ง กลุ่มอายุ (ครบ 8 กลุ่ม) และถิ่นที่อยู่ — ไม่ใช่ความชุกที่วินิจฉัยแล้ว",
                    required_for_run=True),
        DatasetSpec("cancer_stage", "ระยะโรคเมื่อวินิจฉัย", "Stage at diagnosis",
                    [Col("site", "str", allowed=list(SITES)), Col("stage", "str", allowed=STAGES + ["unknown"]),
                     Col("cases", "float", "cases", min=0)], ["site", "stage"], ["stage_shares"],
                    "จำนวนผู้ป่วยตามระยะ ระยะไม่ทราบจะถูกกระจายตามสัดส่วนของระยะที่ทราบ (แจ้งในรายงาน)"),
        DatasetSpec("cancer_treatment", "การรักษาครั้งแรกตามระยะ", "First-course treatment by stage",
                    [Col("site", "str", allowed=list(SITES)), Col("stage", "str", allowed=STAGES),
                     Col("modality", "str", allowed=MODALITIES), Col("share", "float", "share", min=0, max=1)],
                    ["site", "stage", "modality"], ["treatment_probability"],
                    "สัดส่วนผู้ป่วยที่ได้รับการรักษาแต่ละแบบ (หนึ่งคนได้หลายแบบได้)"),
        DatasetSpec("cancer_survival", "อัตรารอดชีพหลังวินิจฉัย", "Survival after diagnosis",
                    [Col("site", "str", allowed=list(SITES)), Col("year_since_dx", "int", "years", min=1, max=5),
                     Col("surviving_share", "float", "share", min=0, max=1)], ["site", "year_since_dx"], ["survival"],
                    "สัดส่วนผู้รอดชีพ ณ ปีที่ 1–5 หลังวินิจฉัย"),
        DatasetSpec("oncology_capacity", "ขีดความสามารถรังสีรักษา", "Radiotherapy capacity",
                    [Col("prov_code", "prov_code"), Col("linacs", "float", "machines", min=0)], ["prov_code"], [],
                    "จำนวนเครื่องฉายรังสีที่ใช้งานได้ ใช้เทียบกับความต้องการ"),
        DatasetSpec("cancer_screening", "ผลการคัดกรองมะเร็ง", "Cancer screening results",
                    [Col("site", "str", allowed=list(SCREEN_SITES)), Col("screened", "float", "persons", min=1),
                     Col("positive", "float", "persons", min=0), Col("followed_up", "float", "persons", min=0, required=False)],
                    ["site"], ["screening_positivity", "screening_followup_completion"],
                    "จำนวนผู้รับการคัดกรอง ผลบวก และผู้ที่ได้รับการตรวจวินิจฉัยต่อ ใช้ปรับฐานอัตราผลบวกและการติดตาม "
                    "(ความครอบคลุมเป็นนโยบาย ไม่ถูกปรับจากข้อมูล)"),
        RF.dataset("cancer_referral", SERVICES, "แยกตามบริการได้ (surgery, chemotherapy, radiotherapy, palliative, followup หรือ all)"),
    ],
    params=[
        Param("incidence_per_100k", "อุบัติการณ์รายกลุ่มอายุ (ต่อแสนคนต่อปี)", "estimated", None, "per 100,000",
              provenance="estimated", estimated_from="cancer_incidence", description="ไม่มีค่าตั้งต้น: ต้องอัปโหลดข้อมูล"),
        Param("province_ratio", "อัตราส่วนอุบัติการณ์รายจังหวัด", "estimated", {}, "ratio", estimated_from="cancer_incidence"),
        Param("stage_shares", "สัดส่วนระยะโรค I–IV", "estimated", STAGE_DEFAULT, "share", estimated_from="cancer_stage"),
        Param("treatment_probability", "ความน่าจะเป็นได้รับการรักษาแต่ละแบบตามระยะ", "estimated", TREAT_DEFAULT, "share",
              estimated_from="cancer_treatment"),
        Param("survival", "อัตรารอดชีพปีที่ 1–5", "estimated", SURV_DEFAULT, "share", estimated_from="cancer_survival"),
        Param("incidence_multiplier", "ตัวคูณอุบัติการณ์ตามนโยบาย (เช่น วัคซีน HPV)", "policy",
              {s: 1.0 for s in SITES}, "×", provenance="policy"),
        Param("early_detection_shift", "สัดส่วนผู้ป่วยระยะ III–IV ที่เลื่อนมาวินิจฉัยระยะ I–II", "policy",
              {s: 0.0 for s in SITES}, "share", provenance="policy", bounds=(0, 1)),
        Param("surgery_minutes", "นาทีศัลยแพทย์ต่อการผ่าตัด", "assumption",
              {"breast": 120, "lung": 240, "colorectal": 240, "cervix": 180, "liver": 300}, "minutes"),
        Param("chemo_cycles", "จำนวนรอบยาเคมีต่อการรักษา", "assumption",
              {"breast": 6, "lung": 4, "colorectal": 8, "cervix": 5, "liver": 6}, "cycles"),
        Param("rt_fractions", "จำนวนครั้งฉายรังสี (รักษาให้หาย)", "assumption",
              {"breast": 20, "lung": 30, "colorectal": 25, "cervix": 29, "liver": 10}, "fractions"),
        Param("rt_fractions_palliative", "จำนวนครั้งฉายรังสี (ระยะ IV)", "assumption", 5, "fractions"),
        Param("linac_minutes_per_fraction", "นาทีเครื่องต่อครั้งฉาย", "assumption", 15, "minutes"),
        Param("followup_visits", "ครั้งติดตามผลต่อปี ปีที่ 1–5", "assumption", [4, 3, 2, 2, 1], "visits"),
        Param("palliative_patient_years", "ระยะเวลาดูแลประคับประคองต่อราย", "assumption", 0.5, "years"),
        Param("activity_minutes", "นาทีต่อกิจกรรมตามวิชาชีพ", "assumption", {
            "chemo_cycle": {"medical_oncologist": 20, "oncology_nurse": 90},
            "rt_course": {"radiation_oncologist": 180},
            "rt_fraction": {"rt_technologist": 30},
            "operation_theatre_nurse_per_surgeon_minute": 2.0,
            "followup_visit": {"physician": 15},
            "palliative_patient_year": {"oncology_nurse": 360, "physician": 160}}, "minutes"),
        Param("chemo_chair_hours_per_cycle", "ชั่วโมงเก้าอี้ให้ยาต่อรอบ", "assumption", 3.0, "hours"),
        Param("linac_hours_per_year", "ชั่วโมงใช้งานได้ต่อเครื่องต่อปี", "assumption", 2500, "hours"),
        Param("available_hours_per_fte", "ชั่วโมงทำงานที่ใช้ได้ต่อ FTE ต่อปี", "assumption", {c: 1536 for c in CADRES}, "hours"),
        Param("screening_policy", "โครงการคัดกรอง: กลุ่มอายุเป้าหมาย ความครอบคลุมต่อรอบ และรอบห่าง (ปี)", "policy",
              SCREEN_POLICY_DEFAULT, "share / years", provenance="policy",
              description="ค่าตัวอย่าง ไม่ใช่นโยบายจริง ความครอบคลุม 0 = ไม่มีโครงการ การคัดกรองไม่เปลี่ยนระยะโรคเอง"),
        Param("screening_positivity", "อัตราผลบวกของการคัดกรอง", "estimated", SCREEN_POSITIVITY_DEFAULT, "share",
              estimated_from="cancer_screening"),
        Param("screening_followup_completion", "สัดส่วนผลบวกที่ได้รับการตรวจวินิจฉัยต่อ", "estimated", SCREEN_COMPLETION_DEFAULT,
              "share", estimated_from="cancer_screening"),
        Param("screening_minutes", "นาทีต่อการตรวจคัดกรองและการตรวจวินิจฉัยต่อ ตามวิชาชีพ", "assumption",
              SCREEN_MINUTES_DEFAULT, "minutes"),
        Param("screening_available_hours_per_fte", "ชั่วโมงทำงานที่ใช้ได้ต่อ FTE (บุคลากรคัดกรอง)", "assumption",
              {c: 1536 for c in SCREEN_CADRES}, "hours"),
        Param("female_share", "สัดส่วนหญิงตามกลุ่มอายุ (ใช้เมื่อข้อมูลประชากรไม่แยกเพศ)", "assumption",
              {g: 0.51 for g in AGE_GROUPS}, "share"),
    ],
    outputs=["incident cases by site and stage", "patients by first-course modality", "follow-up survivors",
             "operations, chemotherapy cycles, radiotherapy fractions", "FTE by cadre", "linacs and chemo chairs required",
             "screening tests, positives and diagnostic follow-ups with their FTE (separate pathway)",
             "provider-based workload (if referral flows uploaded; default provider = residence)"],
    references=["Babashov V, et al. Reducing patient waiting times for radiation therapy and improving the treatment "
                "planning process: a discrete-event simulation model. Clin Oncol. 2017;29(6):385-391."],
)


def calibrate(tables: dict) -> tuple[dict, list[dict]]:
    out, diag = {}, []
    if "cancer_incidence" in tables:
        d = tables["cancer_incidence"]
        g = d.groupby(["site", "age_group"])[["cases", "population"]].sum()
        rates, ratios = {}, {}
        for site in sorted(d.site.unique()):
            r = (1e5 * g.loc[site].cases / g.loc[site].population).reindex(AGE_GROUPS)
            if r.isna().any():
                raise ValueError(f"cancer_incidence[{site}] ขาดกลุ่มอายุ {r[r.isna()].index.tolist()} (ไม่เติมค่าแทน)")
            rates[site] = r.round(4).to_dict()
            diag.append(dict(parameter=f"incidence_per_100k[{site}]", n=float(g.loc[site].cases.sum())))
            if "prov_code" in d.columns and d.prov_code.notna().all() and (d.prov_code > 0).any():
                z = d[d.site == site]
                z = z.assign(exp=z.population * z.age_group.map(r) / 1e5).groupby("prov_code")[["cases", "exp"]].sum()
                ratios[site] = {int(k): round(float(v), 4) for k, v in zip(z.index, shrink_ratio(z.cases, z.exp))}
        out["incidence_per_100k"] = dict(value=rates, source="dataset:cancer_incidence",
                                         note=f"ตำแหน่ง: {', '.join(rates)}")
        if ratios:
            out["province_ratio"] = dict(value=ratios, source="dataset:cancer_incidence",
                                         note="observed/expected ปรับเข้าหา 1 (น้ำหนักก่อน 10 ราย)")
    if "cancer_stage" in tables:
        d = tables["cancer_stage"]
        val = dict(STAGE_DEFAULT)
        for site, z in d.groupby("site"):
            known = z[z.stage != "unknown"].set_index("stage").cases.reindex(STAGES).fillna(0)
            unk = float(z[z.stage == "unknown"].cases.sum())
            if known.sum() > 0:
                val[site] = (known / known.sum()).tolist()
                diag.append(dict(parameter=f"stage_shares[{site}]", n=float(known.sum()), unknown_redistributed=unk))
        out["stage_shares"] = dict(value=val, source="dataset:cancer_stage", note="ระยะไม่ทราบกระจายตามสัดส่วน")
    if "cancer_treatment" in tables:
        d = tables["cancer_treatment"]
        val = {s: {m: list(v) for m, v in TREAT_DEFAULT[s].items()} for s in SITES}
        for (site, m), z in d.groupby(["site", "modality"]):
            s_ = z.set_index("stage").share.reindex(STAGES)
            val[site][m] = [float(x) if np.isfinite(x) else val[site][m][i] for i, x in enumerate(s_)]
        out["treatment_probability"] = dict(value=val, source="dataset:cancer_treatment",
                                            note="ค่าที่ไม่มีในข้อมูลใช้ค่าตั้งต้นเชิงตัวอย่าง")
    if "cancer_survival" in tables:
        d = tables["cancer_survival"]
        val = dict(SURV_DEFAULT)
        for site, z in d.groupby("site"):
            s_ = z.set_index("year_since_dx").surviving_share.reindex(range(1, 6))
            if s_.isna().any():
                raise ValueError(f"cancer_survival[{site}] ต้องมีปีที่ 1–5 ครบ")
            if (np.diff(s_.to_numpy()) > 1e-9).any():
                raise ValueError(f"cancer_survival[{site}] ต้องไม่เพิ่มขึ้นตามเวลา")
            val[site] = s_.round(6).tolist()
        out["survival"] = dict(value=val, source="dataset:cancer_survival")
    if "cancer_screening" in tables:
        d = tables["cancer_screening"].groupby("site").sum(numeric_only=True)
        if (d.positive > d.screened).any():
            raise ValueError("cancer_screening: positive มากกว่า screened")
        pos = dict(SCREEN_POSITIVITY_DEFAULT) | (d.positive / d.screened).round(6).to_dict()
        out["screening_positivity"] = dict(value=pos, source="dataset:cancer_screening",
                                           note="ผลบวก / ผู้รับการคัดกรอง; ตำแหน่งที่ไม่มีข้อมูลใช้ค่าตั้งต้น")
        for site, r in d.iterrows():
            diag.append(dict(parameter=f"screening_positivity[{site}]", n=float(r.screened)))
        if "followed_up" in d.columns and d.followed_up.notna().any():
            if (d.followed_up > d.positive).any():
                raise ValueError("cancer_screening: followed_up มากกว่า positive")
            ok = d[d.positive > 0]
            comp = dict(SCREEN_COMPLETION_DEFAULT) | (ok.followed_up / ok.positive).round(6).to_dict()
            out["screening_followup_completion"] = dict(value=comp, source="dataset:cancer_screening",
                                                        note="ได้รับการตรวจต่อ / ผลบวก")
    return out, diag


def _stage(p, site):
    s = np.array(p["stage_shares"][site], float)
    if not np.isclose(s.sum(), 1, atol=1e-6):
        raise ValueError(f"stage shares of {site} must sum to 1")
    shift = float(p["early_detection_shift"].get(site, 0.0))
    if shift:
        late = s[2:].sum() * shift
        s = np.r_[s[:2] + late * s[:2] / s[:2].sum(), s[2:] * (1 - shift)]
    return s


def project(p: dict, population: pd.DataFrame, years: list[int]) -> pd.DataFrame:
    rates = p["incidence_per_100k"]
    if not rates:
        raise ValueError("ต้องมีข้อมูลอุบัติการณ์ (cancer_incidence)")
    pop = population.set_index(["year", "prov_code"]).sort_index()
    rows = []
    for site in rates:
        r = np.array([float(rates[site][g]) for g in AGE_GROUPS]) / 1e5
        ratio = (p["province_ratio"] or {}).get(site, {})
        mult = float(p["incidence_multiplier"].get(site, 1.0))
        st = _stage(p, site)
        T = p["treatment_probability"][site]
        S = np.array(p["survival"][site], float)
        for pc in sorted(population.prov_code.unique()):
            rr = float(ratio.get(pc, ratio.get(str(pc), 1.0))) * mult
            cases = np.array([float(pop.loc[(y, pc), AGE_GROUPS].to_numpy(float) @ r) * rr for y in years])
            for t, y in enumerate(years):
                past = [cases[t - k] if t - k >= 0 else cases[0] for k in range(1, 6)]
                rec = dict(prov_code=pc, year=y, site=site, cases=cases[t],
                           **{f"stage_{s}": cases[t] * st[i] for i, s in enumerate(STAGES)},
                           **{f"treated_{m}": float(cases[t] * st @ np.array(T[m], float)) for m in MODALITIES},
                           treated_rt_stage_iv=float(cases[t] * st[3] * T["radiotherapy"][3]),
                           followup_survivors=float(np.dot(past, S)),
                           followup_visits=float(sum(past[k] * S[k] * p["followup_visits"][k] for k in range(5))))
                rows.append(rec)
    return pd.DataFrame(rows)


def resources(p: dict, cases: pd.DataFrame, capacity: pd.DataFrame | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    am = p["activity_minutes"]
    c = cases.copy()
    c["operations"] = c.treated_surgery
    c["chemo_cycles"] = c.treated_chemotherapy * c.site.map(p["chemo_cycles"])
    curative_rt = c.treated_radiotherapy - c.treated_rt_stage_iv
    c["rt_courses"] = c.treated_radiotherapy
    c["rt_fractions"] = curative_rt * c.site.map(p["rt_fractions"]) + c.treated_rt_stage_iv * p["rt_fractions_palliative"]
    c["palliative_patient_years"] = c.treated_palliative * p["palliative_patient_years"]
    h = pd.DataFrame(index=c.index)
    h["surgeon"] = c.operations * c.site.map(p["surgery_minutes"]) / 60
    h["theatre_nurse"] = h.surgeon * am["operation_theatre_nurse_per_surgeon_minute"]
    h["medical_oncologist"] = c.chemo_cycles * am["chemo_cycle"]["medical_oncologist"] / 60
    h["oncology_nurse"] = (c.chemo_cycles * am["chemo_cycle"]["oncology_nurse"]
                           + c.palliative_patient_years * am["palliative_patient_year"]["oncology_nurse"]) / 60
    h["radiation_oncologist"] = c.rt_courses * am["rt_course"]["radiation_oncologist"] / 60
    h["rt_technologist"] = c.rt_fractions * am["rt_fraction"]["rt_technologist"] / 60
    h["physician"] = (c.followup_visits * am["followup_visit"]["physician"]
                      + c.palliative_patient_years * am["palliative_patient_year"]["physician"]) / 60
    c["linac_hours"] = c.rt_fractions * p["linac_minutes_per_fraction"] / 60
    c["chemo_chair_hours"] = c.chemo_cycles * p["chemo_chair_hours_per_cycle"]
    out = c.join(h.add_suffix("_hours"))
    keys = ["prov_code", "year"]
    agg = out.groupby(keys)[[f"{k}_hours" for k in CADRES] + ["linac_hours", "chemo_chair_hours"]].sum()
    fte = pd.DataFrame({k: agg[f"{k}_hours"] / p["available_hours_per_fte"][k] for k in CADRES}, index=agg.index)
    agg["linacs_required"] = agg.linac_hours / p["linac_hours_per_year"]
    if capacity is not None and len(capacity):
        agg["linacs_available"] = agg.index.get_level_values(0).map(capacity.set_index("prov_code").linacs).fillna(0)
        agg["linac_gap"] = agg.linacs_required - agg.linacs_available
    return out, agg.join(fte.add_suffix("_fte")).reset_index()


# ----------------------------------------------------------------------------- provider-based workload

def service_ledger(p: dict, detail: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Additive workload of each service by residence province and year (from `resources` detail)."""
    am = p["activity_minutes"]
    keys = ["prov_code", "year"]
    d = detail.copy()
    d["oncology_nurse_chemo_hours"] = d.chemo_cycles * am["chemo_cycle"]["oncology_nurse"] / 60
    d["oncology_nurse_pall_hours"] = d.palliative_patient_years * am["palliative_patient_year"]["oncology_nurse"] / 60
    d["physician_pall_hours"] = d.palliative_patient_years * am["palliative_patient_year"]["physician"] / 60
    d["physician_fu_hours"] = d.followup_visits * am["followup_visit"]["physician"] / 60
    spec = {"surgery": {"operations": "operations", "surgeon_hours": "surgeon_hours", "theatre_nurse_hours": "theatre_nurse_hours"},
            "chemotherapy": {"chemo_cycles": "chemo_cycles", "medical_oncologist_hours": "medical_oncologist_hours",
                             "oncology_nurse_hours": "oncology_nurse_chemo_hours", "chemo_chair_hours": "chemo_chair_hours"},
            "radiotherapy": {"rt_courses": "rt_courses", "rt_fractions": "rt_fractions", "linac_hours": "linac_hours",
                             "radiation_oncologist_hours": "radiation_oncologist_hours", "rt_technologist_hours": "rt_technologist_hours"},
            "palliative": {"palliative_patient_years": "palliative_patient_years", "oncology_nurse_hours": "oncology_nurse_pall_hours",
                           "physician_hours": "physician_pall_hours"},
            "followup": {"followup_visits": "followup_visits", "physician_hours": "physician_fu_hours"}}
    return {sv: d.groupby(keys)[list(cols.values())].sum().rename(columns={v: k for k, v in cols.items()}).reset_index()
            for sv, cols in spec.items()}


def _aggregate(p: dict, parts: list[pd.DataFrame], capacity: pd.DataFrame | None) -> pd.DataFrame:
    keys = ["prov_code", "year"]
    z = pd.concat(parts, ignore_index=True).fillna(0).groupby(keys).sum()
    for c in [f"{k}_hours" for k in CADRES] + ["linac_hours", "chemo_chair_hours"]:
        if c not in z.columns:
            z[c] = 0.0
    agg = z[[f"{k}_hours" for k in CADRES] + ["linac_hours", "chemo_chair_hours"]].copy()
    fte = pd.DataFrame({k: agg[f"{k}_hours"] / p["available_hours_per_fte"][k] for k in CADRES}, index=agg.index)
    agg["linacs_required"] = agg.linac_hours / p["linac_hours_per_year"]
    if capacity is not None and len(capacity):
        agg["linacs_available"] = agg.index.get_level_values(0).map(capacity.set_index("prov_code").linacs).fillna(0)
        agg["linac_gap"] = agg.linacs_required - agg.linacs_available
    return agg.join(fte.add_suffix("_fte")).reset_index()


def provider_resources(p: dict, detail: pd.DataFrame, flows: pd.DataFrame | None,
                       capacity: pd.DataFrame | None = None) -> tuple[pd.DataFrame, float]:
    """Province-year resources by the province that delivers each service; returns (table, max national gap)."""
    led = service_ledger(p, detail)
    provs = detail.prov_code.unique()
    moved = [RF.reallocate(t, [c for c in t.columns if c not in ("prov_code", "year")], RF.mapping(flows, sv, provs))
             for sv, t in led.items()]
    resident = _aggregate(p, list(led.values()), None)
    provider = _aggregate(p, moved, capacity)
    cols = [f"{k}_hours" for k in CADRES] + ["linac_hours", "chemo_chair_hours"]
    return provider, RF.preserved(resident, provider, cols)


# ----------------------------------------------------------------------------- screening pathway

def screening(p: dict, population: pd.DataFrame, years: list[int]) -> tuple[pd.DataFrame, list[str]]:
    """Screening tests, positives and diagnostic follow-ups by province, year and site, with hours by cadre."""
    warns = []
    has_sex = all(c in population.columns for c in FEMALE)
    if not has_sex:
        warns.append("ข้อมูลประชากรไม่แยกเพศ: ใช้สัดส่วนหญิงตามสมมติฐาน (female_share)")
    pop = population[population.year.isin(years)].copy()
    rows = []
    for site, sex in SCREEN_SITES.items():
        pol = p["screening_policy"].get(site) or {}
        cov, interval = float(pol.get("coverage", 0.0)), float(pol.get("interval_years", 1) or 1)
        groups = list(pol.get("target_age_groups", []))
        bad = [g for g in groups if g not in AGE_GROUPS]
        if bad or not 0 <= cov <= 1 or interval <= 0:
            raise ValueError(f"screening_policy[{site}] ไม่ถูกต้อง (กลุ่มอายุ {bad}, coverage {cov}, interval {interval})")
        if sex == "female":
            target = sum(pop[f"F_{g}"] if has_sex else pop[g] * float(p["female_share"][g]) for g in groups) if groups else 0 * pop.year
        else:
            target = sum(pop[g] for g in groups) if groups else 0 * pop.year
        screened = target * cov / interval
        pos = screened * float(p["screening_positivity"][site])
        diag = pos * float(p["screening_followup_completion"][site])
        mins = p["screening_minutes"][site]
        z = pop[["prov_code", "year"]].assign(site=site, target_population=target, screened=screened, positives=pos,
                                             diagnostic_procedures=diag)
        for c in SCREEN_CADRES:
            z[f"{c}_hours"] = (screened * float(mins.get("test", {}).get(c, 0)) + diag * float(mins.get("diagnostic", {}).get(c, 0))) / 60
        rows.append(z)
    return pd.concat(rows, ignore_index=True), warns


def screening_fte(p: dict, scr: pd.DataFrame) -> pd.DataFrame:
    g = scr.groupby(["prov_code", "year"])[[f"{c}_hours" for c in SCREEN_CADRES]].sum()
    av = p["screening_available_hours_per_fte"]
    return pd.DataFrame({f"{c}_fte": g[f"{c}_hours"] / av[c] for c in SCREEN_CADRES}, index=g.index).reset_index()
