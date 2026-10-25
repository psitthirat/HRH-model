"""Common evaluation of every plan against every denominator (section 12).

All inequality measures reuse chapter4.metrics (weighted Gini, Theil T and its exact
between/within split, weighted P90/P10) with the evaluation denominator as the weight, so
Chapter 5 numbers are defined exactly as in Chapter 4.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from chapter4 import metrics as M4


def year_metrics(H, T, region, pop, bottom_k=19) -> dict:
    a = H / T
    short = np.maximum(T - H, 0)
    G_nat = max(T.sum() - H.sum(), 0.0)
    ds = M4.distribution_summary(H, T, group=region)
    order = np.argsort(a)
    meets = a >= 1
    return dict(total_stock=H.sum(), total_target=T.sum(), national_attainment=H.sum() / T.sum(),
                provinces_meeting=int(meets.sum()), population_share_meeting=float(pop[meets].sum() / pop.sum()),
                responsibility_share_meeting=float(T[meets].sum() / T.sum()),
                worst_attainment=float(a.min()), bottom_quartile_attainment=float(H[order[:bottom_k]].sum() / T[order[:bottom_k]].sum()),
                p10_attainment=float(np.quantile(a, 0.1)), median_attainment=float(np.median(a)),
                shortfall_sum=float(short.sum()), gap_national=float(G_nat), gap_spatial=float(short.sum() - G_nat),
                j_short=float(((T / T.sum()) * np.clip(1 - a, 0, None) ** 2).sum()),
                gini=ds["gini_weighted"], theil=ds["theil_t"], p90_p10=ds["p90_p10_weighted"],
                theil_between_share=ds["theil_between"] / ds["theil_t"] if ds["theil_t"] > 0 else np.nan)


def trajectory_metrics(plan_id, criterion, H, T, years, region, pop, bottom_k=19) -> pd.DataFrame:
    rows = []
    for t, y in enumerate(years):
        m = year_metrics(H[t], T[t], region, pop[t], bottom_k)
        rows.append(dict(plan_id=plan_id, criterion=criterion, year_ce=y, year_be=y + 543, **m))
    d = pd.DataFrame(rows)
    d["cumulative_shortfall"] = d.shortfall_sum.cumsum()
    d["cumulative_j_short"] = d.j_short.cumsum()
    return d


def attainment_years(H, T, years):
    """First and sustained attainment year per province (np.nan = not reached by the horizon)."""
    a = H >= T
    first = np.array([years[np.argmax(a[:, p])] if a[:, p].any() else np.nan for p in range(a.shape[1])])
    sus = []
    for p in range(a.shape[1]):
        ok = np.nan
        for t in range(len(years)):
            if a[t:, p].all():
                ok = years[t]
                break
        sus.append(ok)
    return first, np.array(sus)


def switches(xm, xn, um=None, un=None, pool=None):
    """Minimum number of annual assignments whose destination differs: 1/2 sum |x^m - x^n|,
    with the unplaced balance as an explicit extra category."""
    um = np.zeros(len(xm)) if um is None else np.asarray(um)
    un = np.zeros(len(xn)) if un is None else np.asarray(un)
    sw = 0.5 * (np.abs(xm - xn).sum(1) + np.abs(um - un))
    pct = 100 * sw / pool if pool is not None else np.full(len(sw), np.nan)
    return sw, pct


def gini(x, w=None):
    return M4.weighted_gini(x, np.ones_like(x) if w is None else w)
