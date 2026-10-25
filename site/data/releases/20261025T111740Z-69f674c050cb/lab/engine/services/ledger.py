"""Common activity -> time -> FTE ledger for service modules (next-phase plan §3.1, backlog item 4).

Accounting identities, not fitted effects:

    eligible[a]          = population[a] x care-state prevalence[a]
    recipients           = sum_a eligible[a] x target coverage
    activity[k, s]       = recipients x activities per recipient[k] x setting share[k, s]
    hours[r]             = sum_k activity[k] x (task minutes[k, r] + travel minutes[k, r]) / 60
                           + recipients x support hours per recipient[r]           (counted once)
    available hours[r]   = contract hours[r] x (1 - leave share[r] - other non-clinical share[r])
    required FTE[r]      = hours[r] / available hours[r]

Rules enforced by `validate` (plan §3.2):
  * setting shares of one activity are alternatives and must sum to one;
  * a multidisciplinary activity carries time for several cadres - cadre shares never sum to one;
  * time named in the numerator (travel, coordination/support) must not also be deducted in the
    denominator: a cadre's `nonclinical_excludes` must list every numerator allowance it uses;
  * every parameter carries a provenance class; `illustrative_placeholder` values are reported.

Hospital overlap rule: an activity may replace hospital activity at a stated rate
(`replaces_hospital`).  The hospital ledger then records the avoided visits and the hospital time
they free, so community and hospital totals reconcile; nothing is added on top of hospital totals
that already contain the work.

Deliverable care: when available FTE is given, each activity is delivered in the proportion of its
scarcest cadre (proportional rationing across activities sharing that cadre - a declared
convention).  Required, deliverable and unmet activity stay separate.

Interface (plan §4.4): validate -> project_activity -> estimate_resources -> deliverable -> evaluate.
"""
from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

PROVENANCE = {"observed", "estimated", "literature", "policy", "convention", "illustrative_placeholder"}
NUMERATOR_ALLOWANCES = {"travel", "support"}


@dataclass
class Activity:
    id: str
    label: str
    per_recipient: float
    settings: dict[str, float]                       # setting -> share (alternatives, sum to 1)
    task_minutes: dict[str, float]                   # cadre -> minutes per activity (multidisciplinary allowed)
    travel_minutes: dict[str, float] = field(default_factory=dict)   # cadre -> minutes per activity in 'home' setting
    replaces_hospital: dict | None = None            # {"activity": id, "per_activity": float, "hospital_minutes": {cadre: min}}


@dataclass
class Package:
    id: str
    label: str
    age_groups: list[str]
    prevalence: dict[str, float]                     # age group -> share in the care state
    coverage: float
    activities: list[Activity]
    support_hours: dict[str, float]                  # cadre -> hours per recipient per year (coordination), counted once
    cadres: dict[str, dict]                          # cadre -> contract_hours, leave_share, nonclinical_share, nonclinical_excludes
    provenance: dict[str, str]                       # parameter path -> provenance class
    version: str = "0"


def load(path: str | Path) -> Package:
    with open(path, "rb") as fh:
        c = tomllib.load(fh)
    acts = [Activity(id=k, label=v["label"], per_recipient=float(v["per_recipient"]), settings=v["settings"],
                     task_minutes=v["task_minutes"], travel_minutes=v.get("travel_minutes", {}),
                     replaces_hospital=v.get("replaces_hospital")) for k, v in c["activities"].items()]
    return Package(id=c["package"]["id"], label=c["package"]["label"], age_groups=c["package"]["age_groups"],
                   prevalence=c["prevalence"], coverage=float(c["package"]["coverage"]), activities=acts,
                   support_hours=c.get("support_hours", {}), cadres=c["cadres"], provenance=c.get("provenance", {}),
                   version=str(c["package"].get("version", "0")))


def validate(pkg: Package) -> list[str]:
    """Raise on accounting errors; return warnings (placeholder values, unknown provenance)."""
    errs, warns = [], []
    if not 0 <= pkg.coverage <= 1:
        errs.append("coverage outside [0, 1]")
    for g, v in pkg.prevalence.items():
        if g not in pkg.age_groups:
            errs.append(f"prevalence for unknown age group {g}")
        if not 0 <= v <= 1:
            errs.append(f"prevalence {g} outside [0, 1]")
    for a in pkg.activities:
        if abs(sum(a.settings.values()) - 1) > 1e-9:
            errs.append(f"{a.id}: setting shares sum to {sum(a.settings.values()):.4f}, not 1")
        if a.per_recipient < 0 or any(m < 0 for m in a.task_minutes.values()):
            errs.append(f"{a.id}: negative quantity")
        for r in list(a.task_minutes) + list(a.travel_minutes):
            if r not in pkg.cadres:
                errs.append(f"{a.id}: cadre {r} has no working-time definition")
        if a.travel_minutes and "home" not in a.settings:
            errs.append(f"{a.id}: travel time without a home setting")
    used = {r: set() for r in pkg.cadres}
    for a in pkg.activities:
        for r in a.travel_minutes:
            used[r].add("travel")
    for r in pkg.support_hours:
        if r not in pkg.cadres:
            errs.append(f"support hours for undefined cadre {r}")
        else:
            used[r].add("support")
    for r, c in pkg.cadres.items():
        tot = c["leave_share"] + c["nonclinical_share"]
        if not 0 <= tot < 1:
            errs.append(f"{r}: leave + non-clinical share {tot:.2f} must lie in [0, 1)")
        missing = used[r] - set(c.get("nonclinical_excludes", []))
        if missing:
            errs.append(f"{r}: {sorted(missing)} counted in the numerator but not declared excluded from the "
                        "non-clinical deduction (double counting risk)")
    for k, v in pkg.provenance.items():
        if v not in PROVENANCE:
            errs.append(f"unknown provenance class {v} for {k}")
    placeholders = sorted(k for k, v in pkg.provenance.items() if v == "illustrative_placeholder")
    if placeholders:
        warns.append(f"{len(placeholders)} illustrative placeholder parameter(s): " + ", ".join(placeholders))
    if errs:
        raise ValueError("; ".join(errs))
    return warns


LEDGER_COLS = ("package", "activity", "setting", "eligible", "recipients", "volume",
               "deliverable_share", "deliverable_volume", "unmet_volume")


def _keys(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if c not in LEDGER_COLS]


def project_activity(pkg: Package, population: pd.DataFrame) -> pd.DataFrame:
    """population: one row per unit (e.g. province-year) with the package age groups as columns
    (persons) plus any key columns; a 'unit' key is added when none is given.
    Returns one row per unit x activity x setting with eligible, recipients and volume."""
    missing = [g for g in pkg.age_groups if g not in population.columns]
    if missing:
        raise KeyError(f"population lacks age groups {missing}")
    pop = population.copy()
    keys = [c for c in pop.columns if c not in pkg.age_groups]
    if not keys:
        pop["unit"] = np.arange(len(pop))
        keys = ["unit"]
    elig = sum(pop[g] * pkg.prevalence.get(g, 0.0) for g in pkg.age_groups)
    rec = elig * pkg.coverage
    rows = []
    for a in pkg.activities:
        for s, share in a.settings.items():
            rows.append(pop[keys].assign(package=pkg.id, activity=a.id, setting=s, eligible=elig.to_numpy(),
                                         recipients=rec.to_numpy(), volume=(rec * a.per_recipient * share).to_numpy()))
    return pd.concat(rows, ignore_index=True)


def available_hours(pkg: Package) -> dict[str, float]:
    return {r: c["contract_hours"] * (1 - c["leave_share"] - c["nonclinical_share"]) for r, c in pkg.cadres.items()}


def estimate_resources(pkg: Package, act: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Returns (hours ledger by unit x activity x cadre x component, required FTE by unit x cadre)."""
    keys = _keys(act)
    A = {a.id: a for a in pkg.activities}
    rows = []
    for r_ in act.itertuples(index=False):
        row = r_._asdict()
        unit = {c: row[c] for c in keys}
        a = A[row["activity"]]
        for r, m in a.task_minutes.items():
            rows.append(dict(**unit, activity=a.id, setting=row["setting"], cadre=r, component="task",
                             hours=row["volume"] * m / 60))
        if row["setting"] == "home":
            for r, m in a.travel_minutes.items():
                rows.append(dict(**unit, activity=a.id, setting="home", cadre=r, component="travel",
                                 hours=row["volume"] * m / 60))
    for r_ in act.drop_duplicates(keys).itertuples(index=False):
        row = r_._asdict()
        for r, h in pkg.support_hours.items():
            rows.append(dict(**{c: row[c] for c in keys}, activity="coordination", setting="all", cadre=r,
                             component="support", hours=row["recipients"] * h))
    H = pd.DataFrame(rows)
    av = available_hours(pkg)
    fte = H.groupby([*keys, "cadre"]).hours.sum().reset_index()
    fte["available_hours_per_fte"] = fte.cadre.map(av)
    fte["required_fte"] = fte.hours / fte.available_hours_per_fte
    return H, fte


def deliverable(pkg: Package, act: pd.DataFrame, fte: pd.DataFrame, available_fte) -> pd.DataFrame:
    """Deliverable vs required activity under available FTE (scarcest-cadre rule).
    available_fte: {cadre: FTE} applied to every unit, or a frame with the unit keys, cadre, available_fte."""
    keys = _keys(act)
    f = fte.copy()
    if isinstance(available_fte, dict):
        f["available_fte"] = f.cadre.map(available_fte)
    else:
        f = f.merge(available_fte, on=[*keys, "cadre"], how="left")
    f["ratio"] = np.minimum(1.0, f.available_fte / f.required_fte).fillna(1.0)
    ratio = f.set_index([*keys, "cadre"]).ratio
    A = {a.id: a for a in pkg.activities}
    shares = []
    for r_ in act.itertuples(index=False):
        row = r_._asdict()
        a = A[row["activity"]]
        cad = set(a.task_minutes) | (set(a.travel_minutes) if row["setting"] == "home" else set())
        shares.append(min(ratio.get(tuple(row[c] for c in keys) + (r,), 1.0) for r in cad) if cad else 1.0)
    out = act.copy()
    out["deliverable_share"] = shares
    out["deliverable_volume"] = out.volume * out.deliverable_share
    out["unmet_volume"] = out.volume - out.deliverable_volume
    return out


def hospital_ledger(pkg: Package, act: pd.DataFrame, volume_col: str = "volume") -> pd.DataFrame:
    """Hospital activity avoided by substituting activities, and the hospital time it frees."""
    keys = _keys(act)
    rows = []
    for a in pkg.activities:
        rep = a.replaces_hospital
        if not rep:
            continue
        g = act[act.activity == a.id].groupby(keys)[volume_col].sum().reset_index()
        for r_ in g.itertuples(index=False):
            row = r_._asdict()
            avoided = row[volume_col] * float(rep["per_activity"])
            rows.append(dict(**{c: row[c] for c in keys}, community_activity=a.id, hospital_activity=rep["activity"],
                             hospital_volume_change=-avoided,
                             **{f"hospital_hours_freed_{r}": avoided * m / 60 for r, m in rep.get("hospital_minutes", {}).items()}))
    return pd.DataFrame(rows)


def evaluate(pkg: Package, population: pd.DataFrame, available_fte=None) -> dict:
    """Run the whole chain; returns every ledger and the validation warnings."""
    warns = validate(pkg)
    act = project_activity(pkg, population)
    H, fte = estimate_resources(pkg, act)
    out = dict(package=pkg.id, version=pkg.version, warnings=warns, activity=act, hours=H, fte=fte,
               hospital_required=hospital_ledger(pkg, act))
    if available_fte is not None:
        d = deliverable(pkg, act, fte, available_fte)
        out["deliverable"] = d
        out["hospital_deliverable"] = hospital_ledger(pkg, d, "deliverable_volume")
    return out
