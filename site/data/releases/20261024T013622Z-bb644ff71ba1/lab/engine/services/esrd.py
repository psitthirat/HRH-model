"""Kidney failure on treatment (ESRD) — cohort state-transition module (next-phase plan §4.2).

DRAFT STRUCTURE: to be reviewed by nephrologists before any public use.

States: HD (haemodialysis), PD (peritoneal dialysis), TX (functioning transplant), CKM (conservative
kidney management); DEATH absorbing.  Annual cycle per province:

    stock[t+1] = stock[t] @ P[states, states] + incident[t+1] * first[states]
    deaths[t+1] = stock[t] @ P[states, DEATH] + incident[t+1] * first[DEATH]
    incident[t] = sum_a population[a, t] * incidence[a] * province ratio

Calibration (when datasets are uploaded):
    incidence by age  = sum new patients / sum population (pooled years/provinces); province ratio
                        = observed/expected shrunk to 1 (Poisson-gamma, prior weight 10)
    P and first       = transition counts / row totals (`from_state` NEW gives the first modality)
    starting stock    = prevalent patients by province and modality in the latest year; without
                        it, the stationary stock implied by incidence and P (an assumption, flagged)
Patients are counted where they live; an optional referral-flow dataset moves the treatment workload
(sessions, staff time, chairs) to the province where it is delivered (`provider_resources`).
Activities and staff time are assumptions (placeholders) until a local activity-time study exists;
modality mix and transplant activity can be overridden as policy scenarios.  These are planning
quantities, not treatment recommendations.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import referral as RF
from .contract import AGE_GROUPS, Col, DatasetSpec, ModuleSpec, Param, shrink_ratio

STATES = ["HD", "PD", "TX", "CKM"]
TO = STATES + ["DEATH"]

# placeholder transition matrix (rows: from state; cols: HD, PD, TX, CKM, DEATH) - illustrative only
P_DEFAULT = {"HD": [0.80, 0.02, 0.03, 0.00, 0.15], "PD": [0.12, 0.70, 0.03, 0.00, 0.15],
             "TX": [0.02, 0.00, 0.95, 0.00, 0.03], "CKM": [0.05, 0.00, 0.00, 0.60, 0.35]}
FIRST_DEFAULT = {"HD": 0.55, "PD": 0.25, "TX": 0.02, "CKM": 0.13, "DEATH": 0.05}

SPEC = ModuleSpec(
    id="esrd", label_th="ไตวายเรื้อรังระยะสุดท้ายที่ได้รับการบำบัด", label_en="Kidney failure on treatment",
    version="0.1-draft", status="draft_structure",
    question_th="ผู้ป่วยไตวายที่ต้องบำบัดทดแทนไตจะมีเท่าใดตามวิธีบำบัด และต้องใช้บุคลากรและเครื่องฟอกเลือดเท่าใด",
    datasets=[
        DatasetSpec("esrd_incidence", "ผู้ป่วยไตวายรายใหม่ที่เริ่มบำบัด", "Incident treated kidney failure",
                    [Col("year", "int"), Col("prov_code", "prov_code", required=False), Col("age_group", "age_group"),
                     Col("new_patients", "float", "persons", min=0), Col("population", "float", "persons", min=1)],
                    ["year", "prov_code", "age_group"], ["incidence_per_million", "province_ratio"],
                    "จำนวนผู้เริ่มบำบัดทดแทนไตครั้งแรกในปี (ตามถิ่นที่อยู่) และประชากรของกลุ่มอายุเดียวกัน ต้องครบ 8 กลุ่มอายุ",
                    required_for_run=True),
        DatasetSpec("esrd_transitions", "การเปลี่ยนวิธีบำบัดรายปี", "Annual modality transitions",
                    [Col("year", "int"), Col("from_state", "str", allowed=["NEW"] + STATES),
                     Col("to_state", "str", allowed=TO), Col("patients", "float", "persons", min=0)],
                    ["year", "from_state", "to_state"], ["transition_matrix", "first_modality"],
                    "ผู้ป่วยที่อยู่ในสถานะต้นปีแยกตามสถานะปลายปี (from_state=NEW คือผู้ป่วยใหม่ของปีนั้น)"),
        DatasetSpec("esrd_prevalence", "ผู้ป่วยคงอยู่ตามวิธีบำบัด", "Prevalent patients by modality",
                    [Col("year", "int"), Col("prov_code", "prov_code"), Col("modality", "str", allowed=STATES),
                     Col("patients", "float", "persons", min=0)],
                    ["year", "prov_code", "modality"], ["starting_stock"],
                    "จำนวนผู้ป่วยคงอยู่ ณ สิ้นปีล่าสุด ใช้เป็นจุดตั้งต้นของการฉาย"),
        DatasetSpec("dialysis_capacity", "ขีดความสามารถการฟอกเลือด", "Haemodialysis capacity",
                    [Col("prov_code", "prov_code"), Col("chairs", "float", "chairs", min=0),
                     Col("shifts_per_day", "float", "shifts", min=0, max=4), Col("days_per_week", "float", "days", min=0, max=7)],
                    ["prov_code"], [], "จำนวนเครื่องหรือเตียงฟอกเลือดและรอบการให้บริการ ใช้เทียบกับความต้องการ"),
        RF.dataset("esrd_referral", ["dialysis"], "เพื่อรับการบำบัดทดแทนไต (ใช้กับภาระงานทั้งหมดของโมดูล)"),
    ],
    params=[
        Param("incidence_per_million", "อุบัติการณ์รายกลุ่มอายุ (ต่อล้านคนต่อปี)", "estimated", None, "per million",
              provenance="estimated", estimated_from="esrd_incidence", description="ไม่มีค่าตั้งต้น: ต้องอัปโหลดข้อมูล"),
        Param("province_ratio", "อัตราส่วนอุบัติการณ์รายจังหวัด (หลังปรับเข้าหา 1)", "estimated", {}, "ratio",
              estimated_from="esrd_incidence"),
        Param("transition_matrix", "ความน่าจะเป็นเปลี่ยนสถานะต่อปี", "estimated", P_DEFAULT, "probability",
              estimated_from="esrd_transitions"),
        Param("first_modality", "สัดส่วนวิธีบำบัดแรกของผู้ป่วยใหม่", "estimated", FIRST_DEFAULT, "share",
              estimated_from="esrd_transitions"),
        Param("starting_stock", "ผู้ป่วยตั้งต้นรายจังหวัด", "estimated", {}, "persons", estimated_from="esrd_prevalence",
              description="ถ้าไม่มีข้อมูล ใช้จำนวนในสภาวะคงตัวที่สอดคล้องกับอุบัติการณ์และอัตราการเปลี่ยนสถานะ"),
        Param("modality_mix_policy", "นโยบายสัดส่วนวิธีบำบัดแรก (ว่าง = ตามข้อมูล)", "policy", {}, "share",
              provenance="policy", description="เช่น นโยบาย PD-first: กำหนดสัดส่วน HD/PD/TX/CKM ของผู้ป่วยใหม่"),
        Param("transplant_multiplier", "ตัวคูณอัตราการปลูกถ่ายไต", "policy", 1.0, "×", provenance="policy", bounds=(0, 5)),
        Param("hd_sessions_per_week", "ฟอกเลือดต่อสัปดาห์", "assumption", 2.5, "sessions"),
        Param("hd_session_hours", "ชั่วโมงต่อครั้งฟอกเลือด", "assumption", 4.0, "hours"),
        Param("hd_patients_per_nurse", "ผู้ป่วยต่อพยาบาลระหว่างฟอก", "assumption", 4.0, "patients"),
        Param("nephrologist_min_per_patient_month", "เวลาแพทย์โรคไตต่อผู้ป่วยต่อเดือน", "assumption",
              {"HD": 30, "PD": 20, "TX": 15, "CKM": 15}, "minutes"),
        Param("pd_training_nurse_hours", "ชั่วโมงพยาบาลฝึก PD ต่อผู้ป่วยใหม่", "assumption", 20.0, "hours"),
        Param("pd_nurse_hours_per_patient_year", "ชั่วโมงพยาบาล PD ต่อผู้ป่วยต่อปี (คลินิก + เยี่ยมบ้าน)", "assumption", 12.0, "hours"),
        Param("ckm_nurse_hours_per_patient_year", "ชั่วโมงพยาบาลดูแลแบบประคับประคองต่อผู้ป่วยต่อปี", "assumption", 8.0, "hours"),
        Param("chair_shifts_per_day", "รอบฟอกต่อเครื่องต่อวัน", "assumption", 3.0, "shifts"),
        Param("chair_days_per_week", "วันให้บริการต่อสัปดาห์", "assumption", 6.0, "days"),
        Param("available_hours_per_fte", "ชั่วโมงทำงานที่ใช้ได้ต่อ FTE ต่อปี", "assumption",
              {"nephrologist": 1536, "dialysis_nurse": 1536}, "hours"),
    ],
    outputs=["patients by modality", "incident and deaths", "HD sessions", "nephrologist and nurse FTE",
             "HD chairs required", "chair gap (if capacity uploaded)",
             "provider-based workload (if referral flows uploaded; default provider = residence)"],
    references=["Roderick P, et al. Simulation model of renal replacement therapy: predicting future demand in "
                "England. Nephrol Dial Transplant. 2004;19(3):692-701."],
)


def calibrate(tables: dict) -> tuple[dict, list[dict]]:
    out, diag = {}, []
    if "esrd_incidence" in tables:
        d = tables["esrd_incidence"]
        g = d.groupby("age_group")[["new_patients", "population"]].sum()
        rate = (1e6 * g.new_patients / g.population).reindex(AGE_GROUPS)
        missing = rate[rate.isna()].index.tolist()
        if missing:
            raise ValueError(f"esrd_incidence ขาดกลุ่มอายุ {missing}: ต้องครบ 8 กลุ่ม (ไม่เติมค่าแทน)")
        out["incidence_per_million"] = dict(value=rate.round(4).to_dict(), source="dataset:esrd_incidence",
                                            note=f"รวม {int(g.new_patients.sum()):,} ราย")
        diag.append(dict(parameter="incidence_per_million", n=float(g.new_patients.sum())))
        if "prov_code" in d.columns and d.prov_code.notna().all() and (d.prov_code > 0).any():
            dd = d.assign(exp=d.population * d.age_group.map(rate) / 1e6)
            pr = dd.groupby("prov_code")[["new_patients", "exp"]].sum()
            ratio = shrink_ratio(pr.new_patients, pr.exp)
            out["province_ratio"] = dict(value={int(k): round(float(v), 4) for k, v in zip(pr.index, ratio)},
                                         source="dataset:esrd_incidence", note="observed/expected ปรับเข้าหา 1 (น้ำหนักก่อน 10 ราย)")
    if "esrd_transitions" in tables:
        d = tables["esrd_transitions"]
        piv = d.pivot_table(index="from_state", columns="to_state", values="patients", aggfunc="sum").reindex(columns=TO).fillna(0)
        P = {}
        for s in STATES:
            if s in piv.index and piv.loc[s].sum() > 0:
                P[s] = (piv.loc[s] / piv.loc[s].sum()).tolist()
                diag.append(dict(parameter=f"transition_matrix[{s}]", n=float(piv.loc[s].sum())))
            else:
                P[s] = P_DEFAULT[s]
                diag.append(dict(parameter=f"transition_matrix[{s}]", n=0.0, note="no rows; default kept"))
        out["transition_matrix"] = dict(value=P, source="dataset:esrd_transitions", note="จำนวนเปลี่ยนสถานะ / ผู้ป่วยต้นปีของสถานะนั้น")
        if "NEW" in piv.index and piv.loc["NEW"].sum() > 0:
            out["first_modality"] = dict(value=(piv.loc["NEW"] / piv.loc["NEW"].sum()).to_dict(),
                                         source="dataset:esrd_transitions", note=f"ผู้ป่วยใหม่ {int(piv.loc['NEW'].sum()):,} ราย")
    if "esrd_prevalence" in tables:
        d = tables["esrd_prevalence"]
        y = int(d.year.max())
        z = d[d.year == y].pivot_table(index="prov_code", columns="modality", values="patients", aggfunc="sum").reindex(columns=STATES).fillna(0)
        out["starting_stock"] = dict(value={"year": y, "stock": {int(p): r.tolist() for p, r in z.iterrows()}},
                                     source="dataset:esrd_prevalence", note=f"ผู้ป่วยคงอยู่ ณ ปี {y}: {z.to_numpy().sum():,.0f} ราย")
    return out, diag


def _matrices(p: dict):
    P = np.array([p["transition_matrix"][s] for s in STATES], float)
    if p["transplant_multiplier"] != 1.0:
        j = TO.index("TX")
        for i, s in enumerate(STATES):
            if s == "TX":
                continue
            add = P[i, j] * (p["transplant_multiplier"] - 1)
            P[i, j] += add
            P[i, i] -= add                       # extra transplants come from staying in the same modality
        if (P < -1e-12).any():
            raise ValueError("transplant multiplier makes a probability negative")
    first = p["modality_mix_policy"] or p["first_modality"]
    f = np.array([float(first.get(s, 0.0)) for s in TO])
    for name, v in [("transition rows", P.sum(1)), ("first modality", np.array([f.sum()]))]:
        if not np.allclose(v, 1, atol=1e-6):
            raise ValueError(f"{name} must sum to 1 (got {np.round(v, 4).tolist()})")
    return P, f


def project(p: dict, population: pd.DataFrame, years: list[int]) -> pd.DataFrame:
    """population: prov_code, year and the 8 age-group columns.  Returns province-year-state stock."""
    P, f = _matrices(p)
    Q, d = P[:, :4], P[:, 4]
    inc_rate = np.array([float(p["incidence_per_million"][g]) for g in AGE_GROUPS]) / 1e6
    ratio = p["province_ratio"] or {}
    pop = population.set_index(["year", "prov_code"]).sort_index()
    provs = sorted(population.prov_code.unique())
    start = p["starting_stock"] or {}
    stock0 = start.get("stock", {})
    rows = []
    for pc in provs:
        r = float(ratio.get(pc, ratio.get(str(pc), 1.0)))
        inc = [float(pop.loc[(y, pc), AGE_GROUPS].to_numpy(float) @ inc_rate) * r for y in years]
        if str(pc) in stock0 or pc in stock0:
            s = np.array(stock0.get(pc, stock0.get(str(pc))), float)
            basis = "uploaded"
        else:                                    # stationary stock for the first year's incidence
            s = inc[0] * f[:4] @ np.linalg.inv(np.eye(4) - Q)
            basis = "stationary_assumption"
        for t, y in enumerate(years):
            if t > 0:
                prev = s
                s = prev @ Q + inc[t] * f[:4]
                deaths = prev @ d + inc[t] * f[4]
            else:
                deaths = np.nan
            rows += [dict(prov_code=pc, year=y, state=st, patients=float(s[i]), incident=inc[t],
                          deaths=float(deaths) if t else np.nan, start_basis=basis) for i, st in enumerate(STATES)]
    return pd.DataFrame(rows)


def resources(p: dict, stock: pd.DataFrame, capacity: pd.DataFrame | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    w = stock.pivot_table(index=["prov_code", "year"], columns="state", values="patients").reindex(columns=STATES).fillna(0)
    inc = stock.groupby(["prov_code", "year"]).incident.first()
    _, f = _matrices(p)
    act = pd.DataFrame(index=w.index)
    act["hd_sessions"] = w.HD * p["hd_sessions_per_week"] * 52
    act["new_pd_patients"] = inc * f[STATES.index("PD")]
    nm = p["nephrologist_min_per_patient_month"]
    hours = pd.DataFrame(index=w.index)
    hours["dialysis_nurse"] = (act.hd_sessions * p["hd_session_hours"] / p["hd_patients_per_nurse"]
                               + act.new_pd_patients * p["pd_training_nurse_hours"]
                               + w.PD * p["pd_nurse_hours_per_patient_year"] + w.CKM * p["ckm_nurse_hours_per_patient_year"])
    hours["nephrologist"] = sum(w[s] * nm[s] * 12 / 60 for s in STATES)
    avail = p["available_hours_per_fte"]
    fte = hours.apply(lambda c: c / avail[c.name])
    cap_per_chair = p["chair_shifts_per_day"] * p["chair_days_per_week"] * 52
    act["hd_chairs_required"] = act.hd_sessions / cap_per_chair
    if capacity is not None and len(capacity):
        cap = capacity.set_index("prov_code")
        chairs_eq = cap.chairs * cap.shifts_per_day * cap.days_per_week * 52 / cap_per_chair
        act["hd_chairs_available_equivalent"] = act.index.get_level_values(0).map(chairs_eq)
        act["hd_chair_gap"] = act.hd_chairs_required - act.hd_chairs_available_equivalent
    out = act.join(hours.add_suffix("_hours")).join(fte.add_suffix("_fte")).reset_index()
    return out, fte.reset_index()


def check_balance(stock: pd.DataFrame, p: dict, tol: float = 1e-6) -> float:
    """Max |Δ total patients − (incident − deaths)| over province-years (must be ~0)."""
    g = stock.groupby(["prov_code", "year"]).agg(total=("patients", "sum"), inc=("incident", "first"), deaths=("deaths", "first"))
    gap = g.groupby(level=0).apply(lambda z: (z.total.diff() - (z.inc - z.deaths)).iloc[1:].abs().max())
    return float(gap.max())


PROVIDER_COLS = ["hd_sessions", "new_pd_patients", "hd_chairs_required", "dialysis_nurse_hours", "nephrologist_hours",
                 "dialysis_nurse_fte", "nephrologist_fte"]


def provider_resources(p: dict, res: pd.DataFrame, flows: pd.DataFrame | None,
                       capacity: pd.DataFrame | None = None) -> tuple[pd.DataFrame, float]:
    """Treatment workload by the province that delivers it; returns (table, max national total gap)."""
    m = RF.mapping(flows, "dialysis", res.prov_code.unique())
    out = RF.reallocate(res, PROVIDER_COLS, m)
    if capacity is not None and len(capacity):
        cap = capacity.set_index("prov_code")
        cap_per_chair = p["chair_shifts_per_day"] * p["chair_days_per_week"] * 52
        eq = cap.chairs * cap.shifts_per_day * cap.days_per_week * 52 / cap_per_chair
        out["hd_chairs_available_equivalent"] = out.prov_code.map(eq)
        out["hd_chair_gap"] = out.hd_chairs_required - out.hd_chairs_available_equivalent
    return out, RF.preserved(res, out, PROVIDER_COLS)
