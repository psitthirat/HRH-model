"""Canonical fitted-model design, shared by estimation and browser prediction.

Kept free of fitting packages and data loaders so the exact same transformation
runs against an immutable aggregate model package in the participant Lab.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

AGE_BANDS = {3: [(0, 14, "0-14"), (15, 59, "15-59"), (60, 200, "60+")],
             6: [(0, 14, "0-14"), (15, 29, "15-29"), (30, 44, "30-44"), (45, 59, "45-59"),
                 (60, 74, "60-74"), (75, 200, "75+")]}
DISEASE = ["prev_dm", "prev_ht", "prev_ckd_3_5", "prev_copd", "prev_stroke", "prev_chd"]

BED_COL = {"op_moph": "log_beds_moph_per1000", "ip_moph": "log_beds_moph_per1000",
           "adjrw": "log_beds_cmx_per1000"}
RATE_COL = {"op_moph": "op_moph_pc", "ip_moph": "ip_moph_pc", "adjrw": "adjrw_pc"}
TOTAL_COL = {"op_moph": "moph_op_visits", "ip_moph": "moph_ip_days", "adjrw": "sum_adjrw"}
PHYS = "log_moph_physicians_per100k"
NURS = "log_moph_professional_nurses_per100k"


# ----------------------------------------------------------------------------- design

def design(d: pd.DataFrame, outcome: str, blocks: list[str], age_k: int = 3,
           year_mode: str = "dummies", ref_year: int | None = None, years: list[int] | None = None,
           province_fe: bool = False, lag_supply: bool = False) -> tuple[np.ndarray, list[str]]:
    """Design matrix.  year_mode: 'dummies' (first year omitted), 'trend' (linear, centred on
    ref_year), or 'none'.  `years` fixes the dummy set so train and test share columns."""
    cols: dict[str, np.ndarray] = {"intercept": np.ones(len(d))}
    yrs = sorted(years if years is not None else d.year.unique())
    if year_mode == "dummies":
        for y in yrs[1:]:
            cols[f"year_{y}"] = (d.year.to_numpy() == y).astype(float)
    elif year_mode == "trend":
        cols["trend"] = d.year.to_numpy() - (ref_year if ref_year is not None else yrs[0])
    if "age" in blocks:
        ref = "15-59" if age_k == 3 else "30-44"
        for _, _, g in AGE_BANDS[age_k]:
            if g != ref:
                cols[f"s{age_k}_{g}"] = d[f"s{age_k}_{g}"].to_numpy(float)
    if "disease" in blocks:
        for c in DISEASE:
            cols[c] = d[c].to_numpy(float)
    if "gpp" in blocks:
        cols["log_gpp_lag1"] = d["log_gpp_lag1"].to_numpy(float)
    suf = "_lag1" if lag_supply else ""
    if "beds" in blocks:
        cols["log_beds"] = d[BED_COL[outcome] + suf].to_numpy(float)
    if "physicians" in blocks:
        cols["log_physicians"] = d[PHYS + suf].to_numpy(float)
    if "nurses" in blocks:
        cols["log_nurses"] = d[NURS + suf].to_numpy(float)
    if province_fe:
        for p in sorted(d.prov_code.unique())[1:]:
            cols[f"prov_{p}"] = (d.prov_code.to_numpy() == p).astype(float)
    return np.column_stack(list(cols.values())), list(cols)

