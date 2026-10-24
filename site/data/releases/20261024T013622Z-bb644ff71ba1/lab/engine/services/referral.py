"""Residence-based need versus provider-based workload (next-phase plan §3, §4.1, §8.2).

Every module computes activity where patients LIVE (residence = the population denominator).  A
referral-flow dataset says where that activity is DELIVERED:

    provider[q, x] = sum_p residence[p, x] * share[p -> q, service of x]

Rules (declared conventions):
  * shares of one origin province and service are alternatives; they must not exceed one, and any
    remainder is delivered in the residence province (so a province absent from the file keeps all
    of its activity at home - the default provider is the residence);
  * rows with service "all" (or no service column) apply to every service of the module; rows for a
    named service replace them for that origin and service;
  * reallocation moves workload only - national totals are preserved exactly (checked), and capacity
    gaps are recomputed where the work is delivered.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .contract import Col, DatasetSpec

TOL = 1e-6


def dataset(did: str, services: list[str], label_hint: str) -> DatasetSpec:
    return DatasetSpec(
        did, "การส่งต่อผู้ป่วยข้ามจังหวัด", "Patient referral flows",
        [Col("from_prov", "prov_code", description="จังหวัดที่ผู้ป่วยอาศัย"),
         Col("to_prov", "prov_code", description="จังหวัดที่ให้บริการ"),
         Col("share", "float", "share", min=0, max=1),
         Col("service", "str", required=False, allowed=["all"] + services)],
        ["from_prov", "to_prov", "service"], [],
        "สัดส่วนของผู้ป่วยจากจังหวัดที่อาศัยที่ไปรับบริการในจังหวัดอื่น " + label_hint
        + " จังหวัดที่ไม่มีในไฟล์ หรือสัดส่วนที่เหลือ ถือว่ารับบริการในจังหวัดที่อาศัย")


def check(table: pd.DataFrame | None) -> list[str]:
    """Share-sum errors (an origin/service whose shares exceed one)."""
    if table is None or not len(table):
        return []
    t = _norm(table)
    s = t.groupby(["from_prov", "service"]).share.sum()
    bad = s[s > 1 + TOL]
    return [f"สัดส่วนการส่งต่อของจังหวัด {int(p)} ({sv}) รวม {v:.3f} เกิน 1" for (p, sv), v in bad.items()]


def _norm(table: pd.DataFrame) -> pd.DataFrame:
    t = table.copy()
    if "service" not in t.columns:
        t["service"] = "all"
    t["service"] = t.service.fillna("all").astype(str)
    return t[["from_prov", "to_prov", "service", "share"]].astype({"from_prov": int, "to_prov": int, "share": float})


def mapping(table: pd.DataFrame | None, service: str, provinces) -> pd.DataFrame:
    """Long (from_prov, to_prov, share) for one service, remainder kept at residence; rows sum to one."""
    provinces = [int(p) for p in provinces]
    rows = pd.DataFrame(columns=["from_prov", "to_prov", "share"])
    if table is not None and len(table):
        t = _norm(table)
        named = t[t.service == service]
        generic = t[(t.service == "all") & ~t.from_prov.isin(named.from_prov)]
        rows = pd.concat([named, generic])[["from_prov", "to_prov", "share"]]
        rows = rows[rows.from_prov.isin(provinces)]
        rows = rows.groupby(["from_prov", "to_prov"], as_index=False).share.sum()
    used = rows.groupby("from_prov").share.sum() if len(rows) else pd.Series(dtype=float)
    rest = pd.DataFrame({"from_prov": provinces, "to_prov": provinces,
                         "share": [max(0.0, 1.0 - float(used.get(p, 0.0))) for p in provinces]})
    m = pd.concat([rows, rest]).groupby(["from_prov", "to_prov"], as_index=False).share.sum()
    return m[m.share > 0].reset_index(drop=True)


def reallocate(df: pd.DataFrame, value_cols: list[str], m: pd.DataFrame, keys: list[str] = ("year",)) -> pd.DataFrame:
    """Move additive residence-based columns to provider provinces.  df has prov_code (residence)."""
    keys = list(keys)
    z = df[["prov_code", *keys, *value_cols]].merge(m, left_on="prov_code", right_on="from_prov", how="left")
    z["to_prov"] = z.to_prov.fillna(z.prov_code).astype(int)
    z["share"] = z.share.fillna(1.0)
    z[value_cols] = z[value_cols].mul(z.share, axis=0)
    out = z.groupby(["to_prov", *keys], as_index=False)[value_cols].sum().rename(columns={"to_prov": "prov_code"})
    return out


def preserved(resident: pd.DataFrame, provider: pd.DataFrame, value_cols: list[str]) -> float:
    """Max |national resident total - national provider total| over the columns (must be ~0)."""
    a = resident.groupby("year")[value_cols].sum()
    b = provider.groupby("year")[value_cols].sum().reindex(a.index)
    return float(np.nanmax(np.abs(a.to_numpy() - b.to_numpy()))) if len(a) else 0.0
