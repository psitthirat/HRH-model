"""Projected population by province, year and the 8 BOD age groups — the common denominator of the
service modules.  Natively it comes from the Chapter 5 Hamilton–Perry projection; in the browser
Lab it is read from the release inputs (`service_population`).

Women by age group (`F_<group>`) are carried for the sex-specific screening pathways (breast and
cervix); total columns remain both sexes.  Older inputs without them still load, and the modules then
fall back to an explicit female-share assumption."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .contract import AGE_GROUPS

FEMALE = [f"F_{g}" for g in AGE_GROUPS]


def native(scenario: str = "central", include_bangkok: bool = False) -> pd.DataFrame:
    from chapter5 import demography as D
    from chapter5 import pipeline as PL
    pr = PL._projections("{}")
    tab = pr["table"]
    z = tab[tab.scenario == scenario].copy()
    z = z.rename(columns={f"g{i + 1}": g for i, g in enumerate(AGE_GROUPS)})
    cols = ["prov_code", "year"] + AGE_GROUPS
    if scenario == "central":
        rows = []
        for y, P in pr["central_array"].items():           # provinces x sex (M, F) x single age
            f = np.stack([P[:, 1, lo:min(hi, P.shape[2] - 1) + 1].sum(-1) for lo, hi in D.BOD_AGE_GROUPS], 1)
            rows.append(pd.DataFrame(f, columns=FEMALE).assign(prov_code=[int(p) for p in pr["provs"]], year=int(y)))
        z = z.merge(pd.concat(rows, ignore_index=True), on=["prov_code", "year"], how="left", validate="one_to_one")
        cols += FEMALE
    if not include_bangkok:
        z = z[z.prov_code != 10]
    return z[cols].sort_values(["year", "prov_code"]).reset_index(drop=True)


def to_inputs(pop: pd.DataFrame) -> dict:
    """Compact JSON-able form for the Lab release inputs."""
    cols = ["prov_code", "year"] + AGE_GROUPS + [c for c in FEMALE if c in pop.columns]
    return {"columns": cols,
            "rows": [[int(r[0]), int(r[1])] + [round(float(x), 1) for x in r[2:]]
                     for r in pop[cols].itertuples(index=False)],
            "source": "Chapter 5 Hamilton–Perry projection (central scenario), DOPA civil register base 2025; "
                      "F_* = women in the same age group"}


def from_inputs(obj: dict) -> pd.DataFrame:
    """Province codes and years as integers, so parameter keys that went through JSON ("11") match."""
    d = pd.DataFrame(obj["rows"], columns=obj["columns"])
    return d.astype({"prov_code": int, "year": int})
