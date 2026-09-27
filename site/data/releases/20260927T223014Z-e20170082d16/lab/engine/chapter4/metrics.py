"""Shared formulas: growth, contributions, and distributional measures.

Each function states its formula; the self-tests in tests/test_chapter4_metrics.py check
them on values whose answers are known by hand.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# ----------------------------------------------------------------------------- growth

def cagr(v0: float, v1: float, intervals: int) -> float:
    """(v1/v0)^(1/intervals) - 1 for positive endpoints; NaN otherwise (never fabricated).
    `intervals` counts elapsed years (t1 - t0), not observations."""
    if intervals <= 0 or not (np.isfinite(v0) and np.isfinite(v1)) or v0 <= 0 or v1 <= 0:
        return np.nan
    return (v1 / v0) ** (1.0 / intervals) - 1.0


def pct_change(v0: float, v1: float) -> float:
    if not (np.isfinite(v0) and np.isfinite(v1)) or v0 == 0:
        return np.nan
    return 100.0 * (v1 / v0 - 1.0)


def log_change(v0: float, v1: float) -> float:
    if not (np.isfinite(v0) and np.isfinite(v1)) or v0 <= 0 or v1 <= 0:
        return np.nan
    return float(np.log(v1 / v0))


def endpoint_summary(df: pd.DataFrame, by: list[str], value: str = "value", year: str = "year",
                     y0: int | None = None, y1: int | None = None) -> pd.DataFrame:
    """Start/end value, absolute and percentage change, CAGR (%) over elapsed intervals.
    If y0/y1 are omitted the first/last observed years of each group are used."""
    rows = []
    for keys, g in df.groupby(by):
        g = g.dropna(subset=[value]).sort_values(year)
        if g.empty:
            continue
        a = y0 if y0 is not None else int(g[year].iloc[0])
        b = y1 if y1 is not None else int(g[year].iloc[-1])
        s = g.set_index(year)[value]
        v0, v1 = (float(s.get(a, np.nan)), float(s.get(b, np.nan)))
        rec = dict(zip(by, keys if isinstance(keys, tuple) else (keys,)))
        rec.update(start_year=a, end_year=b, intervals=b - a, value_start=v0, value_end=v1,
                   delta=v1 - v0, pct_change=pct_change(v0, v1),
                   cagr_pct=100 * cagr(v0, v1, b - a), log_change=log_change(v0, v1),
                   n_observed=int(s.loc[a:b].notna().sum()))
        rows.append(rec)
    return pd.DataFrame(rows)


def ratio_cagr_identity(g_num: float, g_den: float) -> float:
    """Exact growth of a ratio: 1 + g(W/P) = (1 + gW) / (1 + gP)."""
    return (1 + g_num) / (1 + g_den) - 1


def required_growth(current: float, target: float, years: int) -> float:
    """Constant annual growth that moves `current` to `target` in `years` elapsed years."""
    return cagr(current, target, years)


def contributions(parts_start: pd.Series, parts_end: pd.Series) -> pd.DataFrame:
    """Share of the total net change contributed by each disjoint part.

    Shares can be negative or exceed 100% when a part moves against the total; they are
    left as computed.  A near-zero total change is flagged rather than divided silently."""
    d = pd.DataFrame({"start": parts_start, "end": parts_end})
    d["delta"] = d.end - d.start
    total = d.delta.sum()
    d["share_of_net_change_pct"] = 100 * d.delta / total if total != 0 else np.nan
    d["near_zero_total"] = abs(total) < 0.01 * d.start.sum()
    return d


def op_decomposition(visits0, visits1, persons0, persons1, intervals: int) -> dict:
    """visits = persons x (visits per person).  Log shares add to 1 exactly."""
    f0, f1 = visits0 / persons0, visits1 / persons1
    lv, lp, lf = np.log(visits1 / visits0), np.log(persons1 / persons0), np.log(f1 / f0)
    return dict(freq_start=f0, freq_end=f1, visits_pct=pct_change(visits0, visits1),
                persons_pct=pct_change(persons0, persons1), freq_pct=pct_change(f0, f1),
                cagr_visits_pct=100 * cagr(visits0, visits1, intervals),
                cagr_persons_pct=100 * cagr(persons0, persons1, intervals),
                cagr_freq_pct=100 * cagr(f0, f1, intervals),
                share_from_persons_pct=100 * lp / lv, share_from_frequency_pct=100 * lf / lv,
                identity_residual=lv - lp - lf)


# ----------------------------------------------------------------------------- inequality

def weighted_gini(x, w) -> float:
    """Gini of values x with weights w (e.g. provincial density weighted by denominator).

    G = sum_i sum_j w_i w_j |x_i - x_j| / (2 W^2 mean_w(x)).  Computed with the sorted
    cumulative form, which is exact for weighted discrete distributions."""
    x, w = np.asarray(x, float), np.asarray(w, float)
    m = np.isfinite(x) & np.isfinite(w) & (w > 0)
    x, w = x[m], w[m]
    if len(x) < 2:
        return np.nan
    o = np.argsort(x)
    x, w = x[o], w[o]
    W = w.sum()
    mu = (w * x).sum() / W
    cw = np.cumsum(w)
    # sum_i w_i x_i (2*F_i - w_i - W) / (W^2 mu), F_i = cumulative weight up to and incl. i
    g = ((w * x) * (2 * cw - w - W)).sum() / (W ** 2 * mu)
    return float(g)


def theil_t(workforce, denom) -> float:
    """Theil T of workforce relative to the denominator: T = sum q_p log(q_p / d_p).
    q = workforce shares, d = denominator shares.  q_p = 0 contributes 0 (continuous limit)."""
    W, D = np.asarray(workforce, float), np.asarray(denom, float)
    if np.any((W > 0) & (D <= 0)):
        raise ValueError("positive workforce with a zero denominator: the ratio is undefined")
    q, d = W / W.sum(), D / D.sum()
    m = q > 0
    return float((q[m] * np.log(q[m] / d[m])).sum())


def theil_decomposition(df: pd.DataFrame, group: str, w: str = "W", d: str = "D") -> dict:
    """Exact between/within split of Theil T by group (health region).

    T_between = sum_g Q_g log(Q_g / D_g); T_within = sum_g Q_g T_g, with T_g computed on the
    within-group shares and weighted by the group's WORKFORCE share Q_g."""
    total = theil_t(df[w], df[d])
    Wt, Dt = df[w].sum(), df[d].sum()
    between, within, parts = 0.0, 0.0, []
    for g, s in df.groupby(group):
        Q, Dg = s[w].sum() / Wt, s[d].sum() / Dt
        Tg = theil_t(s[w], s[d]) if s[w].sum() > 0 else 0.0
        b = Q * np.log(Q / Dg) if Q > 0 else 0.0
        between += b
        within += Q * Tg
        parts.append(dict(group=g, Q=Q, D=Dg, T_g=Tg, between_term=b, within_term=Q * Tg))
    return dict(T=total, T_between=between, T_within=within,
                identity_gap=total - between - within, parts=pd.DataFrame(parts))


def weighted_quantile(x, w, q) -> float:
    """Quantile of x under weights w (step interpolation on the weighted CDF, midpoint rule)."""
    x, w = np.asarray(x, float), np.asarray(w, float)
    o = np.argsort(x)
    x, w = x[o], w[o]
    c = (np.cumsum(w) - 0.5 * w) / w.sum()
    return float(np.interp(q, c, x))


def distribution_summary(W, D, group=None, near_band: float = 0.2) -> dict:
    """All distributional statistics of density r = W/D used in 4.3, for one year/scope."""
    W, D = np.asarray(W, float), np.asarray(D, float)
    r = W / D
    pooled = W.sum() / D.sum()
    out = dict(pooled_density=pooled,
               gini_weighted=weighted_gini(r, D), gini_equal=weighted_gini(r, np.ones_like(r)),
               theil_t=theil_t(W, D),
               p90_p10_weighted=weighted_quantile(r, D, .9) / weighted_quantile(r, D, .1),
               p90_p10_equal=np.quantile(r, .9) / np.quantile(r, .1),
               share_denominator_within_band=float(D[np.abs(r / pooled - 1) <= near_band].sum() / D.sum()),
               cv_weighted=float(np.sqrt(np.average((r - pooled) ** 2, weights=D)) / pooled),
               n_units=int(len(r)))
    if group is not None:
        dec = theil_decomposition(pd.DataFrame({"W": W, "D": D, "g": group}), "g")
        out.update(theil_between=dec["T_between"], theil_within=dec["T_within"],
                   theil_identity_gap=dec["identity_gap"])
    return out


def shapley_two_factor(f, a0, a1, b0, b1) -> dict:
    """Shapley split of f(a1,b1) - f(a0,b0) into the contribution of a and of b."""
    total = f(a1, b1) - f(a0, b0)
    ca = 0.5 * ((f(a1, b0) - f(a0, b0)) + (f(a1, b1) - f(a0, b1)))
    cb = 0.5 * ((f(a0, b1) - f(a0, b0)) + (f(a1, b1) - f(a1, b0)))
    return dict(total=total, contribution_a=ca, contribution_b=cb, residual=total - ca - cb,
                seq_a_first=f(a1, b0) - f(a0, b0), seq_b_first=f(a0, b1) - f(a0, b0))


def jaccard(a, b) -> float:
    a, b = set(a), set(b)
    return len(a & b) / len(a | b) if (a | b) else np.nan


def pct_for_10pct(beta: float) -> float:
    """Expected % difference for a 10% higher regressor under a log link with a logged regressor."""
    return 100 * (1.1 ** beta - 1)
