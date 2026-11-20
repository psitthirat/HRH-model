"""Physician supply: the appointment pool, external departures and re-entries.

Three supply controls (config supply.input_mode):

    available_appointments   A_t given directly (accepted starts in the managed 76-province system)
    national_graduates       A_t = G_t * licensing * participation * managed_share
    student_intake           G_t = pipeline graduates (already enrolled) for the first `lag` years,
                             then intake_{t-lag} * completion; A_t as above

Departures use recorded HROPS exit events per opening-stock person-year (FY2021-2025), pooled
toward the health-region (resignation) or national (other causes) rate by gamma-Poisson
empirical Bayes.  The combined event rate is treated as a competing-risks hazard:

    P(exit in year) = 1 - exp(-sum_k h_k),  cause share = h_k / sum_k h_k

which stays below one.  This is the stated assumption that turns recorded events into
unique-person departures; repeated status changes of one person cannot be separated with the
aggregate files.  Re-entries (reinstatement, transfer in from another agency) are a separate
Poisson inflow proportional to opening stock.  The recruitment event rate is NOT used in any
allocation plan: the optimizer's appointments replace it (it defines only the status-quo
benchmark's provincial shares).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

EXIT = ["resignation", "retirement", "transfer_out", "death", "disciplinary"]
REENTRY = ["reinstatement", "transfer_in"]


def pool_path(S) -> pd.DataFrame:
    s = S.cfg["supply"]
    yrs = S.years
    mode = s["input_mode"]
    conv = float(s["licensing"]) * float(s["participation"]) * float(s["managed_share"])
    rows = []
    for i, y in enumerate(yrs):
        if mode == "available_appointments":
            a = s["annual_path"][i] if isinstance(s["annual_path"], list) else s["annual_path"]
            rows.append(dict(year=y, mode=mode, graduates=np.nan, conversion=np.nan, available=int(round(float(a)))))
        elif mode == "national_graduates":
            g = s["national_graduates"][i] if isinstance(s["national_graduates"], list) else s["national_graduates"]
            rows.append(dict(year=y, mode=mode, graduates=float(g), conversion=conv, available=int(np.floor(float(g) * conv))))
        else:
            lag = int(s["education_lag_years"])
            pipe = list(s["graduates_in_pipeline"])
            if i < len(pipe):
                g = float(pipe[i])
                src = "already enrolled"
            else:
                g = float(s["intake_2026_onwards"]) * float(s["completion"]) if y - lag >= yrs[0] else float(pipe[-1])
                src = f"intake {y - lag}" if y - lag >= yrs[0] else "pipeline (last value held)"
            rows.append(dict(year=y, mode=mode, graduates=g, conversion=conv, available=int(np.floor(g * conv)),
                             source=src))
    d = pd.DataFrame(rows)
    d["note"] = {"available_appointments": "illustrative managed-system pool (accepted starts)",
                 "national_graduates": "illustrative graduate conversion; factors do not overlap",
                 "student_intake": "education lag honoured: intake changes reach the pool only after the lag"}[mode]
    return d


class Departures:
    """Province hazards (central, pooled) and posterior draws for uncertainty paths."""

    def __init__(self, rates: pd.DataFrame, provs: np.ndarray, national: bool = False):
        self.provs = provs
        self.national = national
        r = rates.set_index(["cause", "prov_code"])
        col = "rate_national" if national else "rate_pooled"
        self.h = {c: r.loc[c][col].reindex(provs).to_numpy(float) for c in EXIT + REENTRY}
        self.a = {c: r.loc[c].post_a.reindex(provs).to_numpy(float) for c in EXIT + REENTRY}
        self.b = {c: r.loc[c].post_b.reindex(provs).to_numpy(float) for c in EXIT + REENTRY}

    def central(self):
        h_exit = sum(self.h[c] for c in EXIT)
        d = 1 - np.exp(-h_exit)                         # probability of external departure
        r = sum(self.h[c] for c in REENTRY)             # re-entries per opening-stock person
        shares = {c: self.h[c] / h_exit for c in EXIT}
        return dict(d=d, r=r, shares=shares, h_exit=h_exit)

    def draw(self, rng, n):
        """n posterior parameter draws (one per simulation path): arrays [n, P]."""
        he = np.zeros((n, len(self.provs)))
        parts = {}
        for c in EXIT:
            parts[c] = rng.gamma(self.a[c], 1 / self.b[c], size=(n, len(self.provs))) if not self.national else \
                np.full((n, len(self.provs)), self.h[c])
            he += parts[c]
        rr = sum(rng.gamma(self.a[c], 1 / self.b[c], size=(n, len(self.provs))) for c in REENTRY)
        return dict(d=1 - np.exp(-he), r=rr, shares={c: parts[c] / he for c in EXIT})


def expected_flows(H_prev, dep):
    L = dep["d"] * H_prev
    return dict(L=L, R=dep["r"] * H_prev, by_cause={c: L * dep["shares"][c] for c in EXIT})


def draw_events(rng, H_prev_int, d, r, shares):
    """Coherent integer event draws for one year: competing-risk exits (binomial + multinomial
    split, so no person leaves twice) and Poisson re-entries.  Arrays [paths, P]."""
    L = rng.binomial(H_prev_int.astype(np.int64), np.clip(d, 0, 1))
    R = rng.poisson(r * H_prev_int)
    return L, R


def stock_flow_backtest(S, rates: pd.DataFrame, provs: np.ndarray, stock: pd.DataFrame, events: pd.DataFrame):
    """Retrospective conditional evaluation FY2021-2025: start from the 2020 stock, add the
    ACTUAL recorded recruitment each year, apply expected departures and re-entries from the
    pooled hazards, and compare with the observed stock.  Uses future realised recruitment, so
    it tests the departure/re-entry arithmetic and the scope residual, not a forecast."""
    dep = Departures(rates, provs).central()
    st = stock.pivot_table(index="prov_code", columns="year", values="headcount").reindex(provs)
    rec = (events[(events.direction == "entry") & (events.category == "recruitment_hiring")]
           .pivot_table(index="prov_code", columns="fiscal_year", values="events", aggfunc="sum")
           .reindex(provs).fillna(0))
    rows = []
    H = st[2020].to_numpy(float)
    for y in range(2021, 2026):
        H = H - dep["d"] * H + dep["r"] * H + rec[y].to_numpy(float)
        obs = st[y].to_numpy(float)
        rows.append(dict(year=y, simulated=H.sum(), observed=obs.sum(), residual=obs.sum() - H.sum(),
                         mape_province_pct=float(np.mean(100 * np.abs(H - obs) / obs)),
                         share_provinces_abs_error_gt10pct=float(np.mean(np.abs(H - obs) / obs > 0.10))))
    return pd.DataFrame(rows)
