"""Deterministic SYNTHETIC demonstration datasets for the service modules.

They exist so users can see the expected file layout and exercise validation, calibration and
runs.  Their values are invented with plausible shapes; they are NOT Thai estimates.  Every
generated dataset is flagged synthetic, and any run that uses one is labelled `synthetic_demo`.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import cancer, esrd, older_care
from .contract import AGE_GROUPS

SEED = 20261014


def _rng(name: str) -> np.random.Generator:
    return np.random.default_rng(SEED + sum(map(ord, name)))


def _pop_year(population: pd.DataFrame, year: int) -> pd.DataFrame:
    y = year if year in set(population.year) else int(population.year.min())
    return population[population.year == y].set_index("prov_code")


def _referral(pop: pd.DataFrame, rng, centres: list[int], shares: dict[str, tuple[float, float]]) -> pd.DataFrame:
    """Each non-centre province sends a share of each service to one centre (invented pattern)."""
    rows = []
    for pc in pop.index:
        if int(pc) in centres:
            continue
        to = int(centres[int(rng.integers(len(centres)))])
        for sv, (lo, hi) in shares.items():
            rows.append(dict(from_prov=int(pc), to_prov=to, service=sv, share=round(float(rng.uniform(lo, hi)), 3)))
    return pd.DataFrame(rows)


def _centres(pop: pd.DataFrame, n: int, among: list[int] | None = None) -> list[int]:
    """The n largest provinces (at most one in six, at least one, so some provinces always refer)."""
    size = pop[AGE_GROUPS].sum(axis=1).sort_values(ascending=False)
    if among is not None:
        size = size[size.index.isin(among)]
    return [int(p) for p in size.index[:min(n, max(1, len(pop) // 6))]]


def older_care_data(population: pd.DataFrame) -> dict[str, pd.DataFrame]:
    rng = _rng("older")
    pop = _pop_year(population, 2025)
    base = {"60-69": 0.03, "70-79": 0.08, "80+": 0.22}
    f = pd.Series(rng.lognormal(0, 0.15, len(pop)), index=pop.index)
    rows = []
    for pc in pop.index:
        for g in older_care.AGES:
            assessed = max(50, int(pop.loc[pc, g] * 0.05))
            rows.append(dict(age_group=g, prov_code=int(pc), assessed=assessed,
                             in_state=int(rng.binomial(assessed, min(0.95, base[g] * f[pc])))))
    state = pd.DataFrame(rows)
    ts = []
    for a, v in older_care.DEFAULT_PACKAGE["activities"].items():
        for comp, key in [("task", "task_minutes"), ("travel", "travel_minutes")]:
            for r, m in v.get(key, {}).items():
                ts += [dict(activity=a, cadre=r, component=comp, minutes=round(float(x), 1))
                       for x in rng.gamma(9, m * 1.1 / 9, 30)]
    fte = pd.DataFrame([dict(prov_code=int(pc), cadre=r, fte=round(float(pop.loc[pc, "60-69":"80+"].sum() * k * rng.uniform(0.4, 1.1)), 1))
                        for pc in pop.index for r, k in [("nurse", 5e-5), ("physician", 3e-6), ("physiotherapist", 1e-5),
                                                         ("care_assistant", 2e-4)]])
    cg = pd.DataFrame([dict(age_group=g, hours_per_week=round(float(x), 1))
                       for g, m in [("60-69", 12), ("70-79", 17), ("80+", 26)] for x in np.clip(rng.gamma(3, m / 3, 200), 0, 168)])
    return {"older_care_state": state, "older_time_study": pd.DataFrame(ts), "workforce_fte": fte, "older_caregiver_time": cg}


def esrd_data(population: pd.DataFrame) -> dict[str, pd.DataFrame]:
    rng = _rng("esrd")
    pop = _pop_year(population, 2025)
    rate = np.array([1, 2, 25, 110, 420, 850, 1000, 800]) / 1e6
    f = pd.Series(rng.lognormal(0, 0.2, len(pop)), index=pop.index)
    inc = []
    for y in [2022, 2023, 2024]:
        for pc in pop.index:
            for i, g in enumerate(AGE_GROUPS):
                n = float(pop.loc[pc, g])
                inc.append(dict(year=y, prov_code=int(pc), age_group=g, population=round(n),
                                new_patients=int(rng.poisson(n * rate[i] * f[pc]))))
    inc = pd.DataFrame(inc)
    P = {"HD": [0.78, 0.02, 0.04, 0.00, 0.16], "PD": [0.10, 0.72, 0.04, 0.00, 0.14],
         "TX": [0.02, 0.00, 0.95, 0.00, 0.03], "CKM": [0.06, 0.00, 0.00, 0.58, 0.36]}
    first = [0.58, 0.22, 0.02, 0.13, 0.05]
    stock0 = {"HD": 60000, "PD": 25000, "TX": 6000, "CKM": 8000}
    tr = []
    for y in [2022, 2023]:
        for s, row in P.items():
            for to, p_ in zip(esrd.TO, np.array(row) * rng.uniform(0.9, 1.1, 5) / sum(np.array(row) * 1.0)):
                tr.append(dict(year=y, from_state=s, to_state=to, patients=int(stock0[s] * p_)))
        new = int(inc[inc.year == y].new_patients.sum())
        tr += [dict(year=y, from_state="NEW", to_state=to, patients=int(new * p_)) for to, p_ in zip(esrd.TO, first)]
    pr = []
    w = pop[AGE_GROUPS].to_numpy(float) @ rate * f.to_numpy()
    for (pc, wi) in zip(pop.index, w):
        for s, share in zip(esrd.STATES, [0.6, 0.25, 0.06, 0.09]):
            pr.append(dict(year=2024, prov_code=int(pc), modality=s, patients=int(wi * 4.5 * share * rng.uniform(0.85, 1.15))))
    prev = pd.DataFrame(pr)
    hd = prev[prev.modality == "HD"].set_index("prov_code").patients
    cap = pd.DataFrame([dict(prov_code=int(pc), chairs=int(max(1, hd[pc] * 2.5 * 52 / (3 * 6 * 52) * rng.uniform(0.6, 1.2))),
                             shifts_per_day=3, days_per_week=6) for pc in pop.index])
    ref = _referral(pop, rng, _centres(pop, 12), {"dialysis": (0.05, 0.25)})
    return {"esrd_incidence": inc, "esrd_transitions": pd.DataFrame(tr), "esrd_prevalence": prev, "dialysis_capacity": cap,
            "esrd_referral": ref}


def cancer_data(population: pd.DataFrame) -> dict[str, pd.DataFrame]:
    rng = _rng("cancer")
    pop = _pop_year(population, 2025)
    shape = {"breast": [0, 0, 2, 25, 70, 90, 95, 90], "lung": [0, 0, 0.5, 4, 25, 70, 110, 120],
             "colorectal": [0, 0, 1, 6, 25, 55, 80, 95], "cervix": [0, 0, 2, 12, 18, 18, 17, 15],
             "liver": [0, 0, 1, 10, 40, 70, 80, 70]}
    rows = []
    for site, rates in shape.items():
        f = rng.lognormal(0, 0.25, len(pop))
        for j, pc in enumerate(pop.index):
            for i, g in enumerate(AGE_GROUPS):
                n = float(pop.loc[pc, g])
                rows.append(dict(site=site, age_group=g, prov_code=int(pc), year=2022, population=round(n),
                                 cases=int(rng.poisson(n * rates[i] / 1e5 * f[j]))))
    stage, treat, surv = [], [], []
    for site in cancer.SITES:
        s = np.array(cancer.STAGE_DEFAULT[site]) * rng.uniform(0.8, 1.2, 4)
        s = s / s.sum()
        total = 3000
        stage += [dict(site=site, stage=st, cases=int(total * 0.9 * v)) for st, v in zip(cancer.STAGES, s)]
        stage.append(dict(site=site, stage="unknown", cases=int(total * 0.1)))
        for m in cancer.MODALITIES:
            treat += [dict(site=site, stage=st, modality=m, share=float(np.clip(v * rng.uniform(0.9, 1.1), 0, 1)))
                      for st, v in zip(cancer.STAGES, cancer.TREAT_DEFAULT[site][m])]
        sv = np.minimum.accumulate(np.clip(np.array(cancer.SURV_DEFAULT[site]) * rng.uniform(0.95, 1.03, 5), 0, 1))
        surv += [dict(site=site, year_since_dx=k + 1, surviving_share=round(float(v), 4)) for k, v in enumerate(sv)]
    big = pop.assign(t=pop[AGE_GROUPS].sum(axis=1)).t.sort_values(ascending=False)
    cap = pd.DataFrame([dict(prov_code=int(pc), linacs=int(i < 12) * int(rng.integers(1, 6))) for i, pc in enumerate(big.index)])
    linac = [int(p) for p in cap[cap.linacs > 0].prov_code]
    ref = _referral(pop, rng, _centres(pop, 12, linac), {"surgery": (0.2, 0.5), "chemotherapy": (0.1, 0.4)})
    ref = pd.concat([ref, pd.DataFrame([dict(from_prov=int(pc), to_prov=int(linac[int(rng.integers(len(linac)))]),
                                             service="radiotherapy", share=1.0) for pc in pop.index if int(pc) not in linac])])
    scr = []
    for s_, n, q, c in [("cervix", 900000, 0.07, 0.75), ("colorectal", 1200000, 0.06, 0.55), ("breast", 150000, 0.09, 0.85)]:
        pos = int(n * q * rng.uniform(0.8, 1.2))
        scr.append(dict(site=s_, screened=n, positive=pos, followed_up=int(pos * c)))
    scr = pd.DataFrame(scr)
    return {"cancer_incidence": pd.DataFrame(rows), "cancer_stage": pd.DataFrame(stage),
            "cancer_treatment": pd.DataFrame(treat), "cancer_survival": pd.DataFrame(surv), "oncology_capacity": cap,
            "cancer_screening": scr, "cancer_referral": ref.reset_index(drop=True)}


GENERATORS = {"older_care": older_care_data, "esrd": esrd_data, "cancer": cancer_data}
