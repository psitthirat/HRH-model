"""Canonical paired-path target and summary calculations, without pipeline I/O.

Shared by the authored Chapter 5 analysis and the browser Workforce Lab.
"""
from __future__ import annotations
import numpy as np
from . import responsibilities as R, simulation as SIM
CRIT_COL = {"P": "D_P", "Pent": "D_Pent", "S": "D_S", "N": "D_N"}

def path_targets(ctx, draws: SIM.Draws, crit: str):
    """[n, T, P] Experiment-A targets on each path (population errors; M5 coefficient draw for N)."""
    idx = ctx.idx[ctx.idx.year.isin(ctx.S.years)].sort_values(["year", "prov_code"])
    nT, P = len(ctx.S.years), len(ctx.provs)
    pop = idx.population.to_numpy().reshape(nT, P)
    popn = pop[None] * draws.pop_mult
    if crit in ("P", "Pent", "S"):
        D = idx[CRIT_COL[crit]].to_numpy().reshape(nT, P)[None] * draws.pop_mult
        invalid = np.zeros(draws.n, bool)
    else:
        cov = ctx.cov.set_index(["year", "prov_code"]).loc[list(zip(idx.year, idx.prov_code))].reset_index()
        ref_y = int(ctx.S.cfg["m5"]["reference_year"])
        B = np.zeros((draws.n, nT, P))
        invalid = np.zeros(draws.n, bool)
        ip_weight = ctx.w["m_ip"] * (float(ctx.idx.conv_N.iloc[0]) if ctx.w["inpatient"] == "ip_days" else 1.0)
        for o, wgt in [("op_moph", ctx.w["m_op"]), ("adjrw" if ctx.w["inpatient"] != "ip_days" else "ip_moph", ip_weight)]:
            X = R.m5_design_reference(ctx.pkg, o, cov, ref_y)
            rate = (X @ ctx.pkg["boot"][o][draws.coef_index].T).T.reshape(draws.n, nT, P)
            invalid |= (rate <= 0).any(axis=(1, 2))
            B += wgt * popn * rate
        D = B
    k = ctx.k
    common = k * popn.sum(2, keepdims=True)
    return common * D / D.sum(2, keepdims=True), invalid


def path_metrics(H, T, region, bottom_k=19):
    """H, T: [n, T, P] -> per-path metrics (2040 and cumulative)."""
    n = H.shape[0]
    a = H / T
    s = np.clip(1 - a, 0, None)
    w = T / T.sum(2, keepdims=True)
    J = (w * s ** 2).sum((1, 2))
    last_a = a[:, -1]
    order = np.argsort(last_a, 1)[:, :bottom_k]
    rows = np.arange(n)[:, None]
    bq = H[:, -1][rows, order].sum(1) / T[:, -1][rows, order].sum(1)
    from chapter4 import metrics as M4
    gini = np.array([M4.weighted_gini(last_a[i], T[i, -1]) for i in range(n)])
    return dict(national_attainment_2040=H[:, -1].sum(1) / T[:, -1].sum(1), bottom_quartile_2040=bq,
                worst_attainment_2040=last_a.min(1), gini_2040=gini, cumulative_j=J,
                cumulative_shortfall=np.clip(T - H, 0, None).sum((1, 2)), stock_2040=H[:, -1].sum(1))
