"""Plans, ledgers, sequential (lagged-feedback / rolling-horizon) solving and paired simulation.

Within-year sequence (declared; identical in optimisation and simulation):
  1. observe the opening stock H[t-1] and information available at the decision date;
  2. project the population/health context of year t, expected departures d*H[t-1] and
     re-entries r*H[t-1] (applied to the opening stock, the exposure used to estimate the rates);
  3. set the pool A_t and the caps;
  4. choose appointments x and transfers z without knowing year-t random outcomes;
  5. realise exits and re-entries; appointments and transfers take effect within the year and
     are first exposed to departure risk in t+1;
  6. compute service consequences (annual-average physician exposure (H[t-1]+H[t])/2) and the
     lagged feedback for the next decision.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy import stats

from . import allocation as AL
from .supply import EXIT


# ----------------------------------------------------------------------------- plan specification

@dataclass
class PlanSpec:
    plan_id: str
    family: str                 # P | P_ent | S | N-STD | N-FB | status_quo
    index_col: str              # D_P, D_Pent, D_S, D_N (N-FB uses D_N scale)
    mobility: str               # recruitment_only | recruitment_and_transfers
    experiment: str             # common_total | fixed_base_conversion
    feedback: str = "none"      # none | lagged_lambda_<x>
    lam: float = 0.0
    scenario: str = "central"
    variant: str = "principal"
    overrides: dict = field(default_factory=dict)   # Problem field overrides (cap_mode, tau, ...)
    notes: str = ""


def targets_matrix(idx, col, experiment, k, base_year, years):
    from .responsibilities import targets
    z = idx.copy()
    z["T"] = targets(z, col, experiment, k, base_year)
    z = z[z.year.isin(years)].sort_values(["year", "prov_code"])
    return z["T"].to_numpy().reshape(len(years), -1)


def make_problem(ctx, spec: PlanSpec, T, dep=None, H0=None, A=None, years=None, **kw):
    S = ctx.S
    a = S.cfg["allocation"]
    dep = dep or ctx.dep
    years = years or S.years
    base = dict(provs=ctx.provs, years=years, H0=ctx.H0 if H0 is None else H0, T=T,
                d=dep["d"], r=dep["r"], A=ctx.pool if A is None else A,
                floor=int(a["universal_new_appointment_floor"]), cap_mode=a["cap_mode"],
                cap=float(a["cap_fraction_of_opening_stock"]), reentry_consumes=bool(a["reentry_consumes_onboarding"]),
                transfers=spec.mobility == "recruitment_and_transfers", tau=float(a["main_transfer_fraction"]),
                nat_budget=float(a["national_transfer_budget_fraction"]), protect_mode=a["origin_protection_mode"],
                protect_frac=float(a["protected_survivor_fraction"]), network=a["eligibility_network"],
                region=ctx.region, require_full=bool(a["require_full_placement"]),
                tangent_step=float(a["tangent_step"]), discount=float(a["discount"]),
                rel_tol=float(a["lexicographic_rel_tol"]), abs_tol=float(a["lexicographic_abs_tol"]),
                mip_rel_gap=float(a["mip_rel_gap"]), time_limit=float(a["time_limit_s"]),
                secondary_time_limit=float(a.get("secondary_time_limit_s", 60)), label=spec.plan_id)
    if a.get("population_reserved_share", 0):
        column = a.get("reservation_population_column", "population")
        population = ctx.idx[ctx.idx.year.isin(years)].sort_values(["year", "prov_code"])[column].to_numpy().reshape(len(years), len(ctx.provs))
        base.update(population_reserved_share=float(a["population_reserved_share"]), reservation_population=population)
    base.update(spec.overrides)
    base.update(kw)
    return AL.Problem(**base)


# ----------------------------------------------------------------------------- sequential solving

def sequential(ctx, spec: PlanSpec, target_fn, stages=("shortfall", "distribution", "operational"),
               dep=None, time_limit=None):
    """Rolling-horizon rule: at each decision year solve the remaining horizon with the targets
    known at that date (target_fn(t_index, H_prev) -> [remaining years, P]), implement only the
    current year's decisions, and advance the expected stock.  Used for N-FB (lagged feedback)
    and for annual replanning.  Each annual problem is solved to the stated gap; the sequence
    is a heuristic for the original nonlinear problem, not its global optimum."""
    S = ctx.S
    nT, P = len(S.years), len(ctx.provs)
    X = np.zeros((nT, P), int); ZI = np.zeros_like(X); ZO = np.zeros_like(X); H = np.zeros((nT, P))
    Tused = np.zeros((nT, P))
    log = []
    Hp = ctx.H0.astype(float)
    dep = dep or ctx.dep
    t0 = time.time()
    for t in range(nT):
        Trem, extra = target_fn(t, Hp)
        pb = make_problem(ctx, spec, Trem, dep=dep, H0=Hp, A=ctx.pool[t:], years=S.years[t:],
                          stages=stages, **({"time_limit": time_limit} if time_limit else {}))
        sol = AL.solve(pb)
        if sol.status != "solved":
            return dict(status=sol.status, failed_year=S.years[t], diagnostics=sol.diagnostics, log=log)
        X[t], ZI[t], ZO[t] = sol.x[0], sol.zin[0], sol.zout[0]
        Tused[t] = Trem[0]
        H[t] = (1 - dep["d"] + dep["r"]) * Hp + X[t] + ZI[t] - ZO[t]
        log.append(dict(year=S.years[t], stage_seconds=sum(s_["seconds"] for s_ in sol.stages),
                        mip_gap=max(s_.get("mip_gap", 0) or 0 for s_ in sol.stages), **(extra or {})))
        Hp = H[t]
    return dict(status="solved", x=X, zin=ZI, zout=ZO, H=H, T=Tused, log=pd.DataFrame(log),
                seconds=time.time() - t0)


# ----------------------------------------------------------------------------- ledgers

def expected_components(dep, Hprev):
    L = dep["d"] * Hprev
    out = {c: L * dep["shares"][c] for c in EXIT}
    out["reentries"] = dep["r"] * Hprev
    out["departures_total"] = L
    return out


def ledger(ctx, spec: PlanSpec, pb: AL.Problem, x, zin, zout, status: str, eval_T: dict, fl=None, reasons=None,
           extra_cols: dict | None = None) -> pd.DataFrame:
    """The province-year ledger (section 15.1): one row per province and allocation year."""
    S = ctx.S
    H = AL.trajectory(pb, x, zin, zout)
    Hp = np.vstack([pb.H0[None], H[:-1]])
    comp = expected_components(dict(d=pb.d, r=pb.r, shares=ctx.dep["shares"]), Hp)
    k = ctx.key.set_index("prov_code").loc[ctx.provs]
    idx = ctx.idx.set_index(["year", "prov_code"])
    rows = []
    for t, y in enumerate(pb.years):
        ix = idx.loc[y].loc[ctx.provs]
        d = {
            "plan_id": spec.plan_id, "model_family": spec.family, "denominator_variant": spec.index_col,
            "mobility_mode": spec.mobility, "target_experiment": spec.experiment, "feedback_mode": spec.feedback,
            "scenario": spec.scenario, "variant": spec.variant, "plan_status": status,
            "year_ce": y, "year_be": y + 543, "prov_code": ctx.provs, "province": k.province.to_numpy(),
            "province_en": k.province_en.to_numpy(), "health_region": k.health_region.to_numpy(),
            "workforce_scope": S.cfg["scope"]["workforce_scope"],
            "opening_headcount": Hp[t], "eligible_existing_stock_expected": (1 - pb.d[t]) * Hp[t],
            "population_civil": ix.population.to_numpy(), "population_entitlement": ix.pop_entitlement_central.to_numpy(),
            "share_age_60plus": ix["s3_60+"].to_numpy(), "share_age_0_14": ix["s3_0-14"].to_numpy(),
            "new_appointments_accepted_starts": x[t], "transfers_in_planned": zin[t], "transfers_out_planned": zout[t],
            "expected_resignations": comp["resignation"][t], "expected_retirements": comp["retirement"][t],
            "expected_other_departures": comp["transfer_out"][t] + comp["death"][t] + comp["disciplinary"][t],
            "expected_departures_total": comp["departures_total"][t], "expected_reentries": comp["reentries"][t],
            "adjustments": 0.0,
            "expected_closing_stock": H[t], "density_per_100k_civil": 1e5 * H[t] / ix.population.to_numpy(),
            "target_own": pb.T[t], "attainment_own": H[t] / pb.T[t], "shortfall_own": np.maximum(pb.T[t] - H[t], 0),
            "D_P": ix.D_P.to_numpy(), "D_Pent": ix.D_Pent.to_numpy(), "D_S": ix.D_S.to_numpy(), "D_N": ix.D_N.to_numpy(),
            "B_S_minutes": ix.B_S.to_numpy(), "B_N_minutes": ix.B_N.to_numpy(),
            "weight_op_min": ctx.w["m_op"], "weight_ip_min": ctx.w["m_ip"], "inpatient_measure": ctx.w["inpatient"],
            "scale_S": float(ix.scale_S.iloc[0]), "scale_N": float(ix.scale_N.iloc[0]),
            "min_appointments": pb.floor,
        }
        for name, Te in eval_T.items():
            d[f"target_{name}"] = Te[t]
            d[f"attainment_{name}"] = H[t] / Te[t]
        if fl is not None:
            for kk in ["cap_value", "cap_headroom", "cap_binding", "transfer_cap_value", "transfer_cap_binding",
                       "protection_floor", "protection_binding", "national_budget_binding", "floor_binding"]:
                d[kk] = fl[kk][t]
        d["cap_mode"] = pb.cap_mode
        d["unplaced_national"] = float(pb.A[t] - x[t].sum())
        d["relaxed_quantity"] = 0.0
        d["value_type"] = "expected value of the deterministic central plan (decisions are integers)"
        if reasons is not None:
            d["allocation_reason"] = reasons[t]
        if extra_cols:
            for kk, v in extra_cols.items():
                d[kk] = v[t]
        rows.append(pd.DataFrame(d))
    out = pd.concat(rows, ignore_index=True)
    # stock-flow identity inside the simulator must close exactly
    ident = (out.opening_headcount - out.expected_departures_total + out.expected_reentries
             + out.new_appointments_accepted_starts + out.transfers_in_planned - out.transfers_out_planned
             - out.expected_closing_stock)
    assert ident.abs().max() < 1e-6, "stock-flow identity does not close in the ledger"
    out["reconciliation_difference"] = ident
    return out


def national_balance(ledger_df: pd.DataFrame, pool: pd.DataFrame) -> pd.DataFrame:
    g = ledger_df.groupby(["plan_id", "year_ce"]).agg(
        opening_stock=("opening_headcount", "sum"), new_appointments=("new_appointments_accepted_starts", "sum"),
        transfers_counted_once=("transfers_out_planned", "sum"), transfers_in=("transfers_in_planned", "sum"),
        expected_departures=("expected_departures_total", "sum"), expected_resignations=("expected_resignations", "sum"),
        expected_retirements=("expected_retirements", "sum"), expected_other_departures=("expected_other_departures", "sum"),
        expected_reentries=("expected_reentries", "sum"), closing_stock=("expected_closing_stock", "sum"),
        target_own=("target_own", "sum"), population_civil=("population_civil", "sum"),
        plan_status=("plan_status", "first")).reset_index()
    g = g.merge(pool, on=["plan_id", "year_ce"], how="left")     # pool: plan_id, year_ce, available
    g["unplaced_balance"] = g.available - g.new_appointments
    g["reconciliation_difference"] = (g.opening_stock - g.expected_departures + g.expected_reentries + g.new_appointments
                                      + g.transfers_in - g.transfers_counted_once - g.closing_stock)
    g["transfer_balance_difference"] = g.transfers_in - g.transfers_counted_once
    g["national_attainment_own"] = g.closing_stock / g.target_own
    g["year_be"] = g.year_ce + 543
    return g


def routes_table(ctx, spec, pb, zin, zout):
    rows = []
    for t, y in enumerate(pb.years):
        for i, j, n in AL.route(zout[t], zin[t], ctx.dist, ctx.region, pb.network):
            rows.append(dict(plan_id=spec.plan_id, year_ce=y, year_be=y + 543, origin_code=int(ctx.provs[i]),
                             origin=ctx.names[ctx.provs[i]], destination_code=int(ctx.provs[j]),
                             destination=ctx.names[ctx.provs[j]], transfer_events=n,
                             distance_km=float(ctx.dist[i, j]), cadre="physicians (aggregate; no grade/specialty data)",
                             network=pb.network, cost_assumption="great-circle km between province centroids",
                             constraint_status="conditional proposal under the stated feasible network; not an approved transfer"))
    return pd.DataFrame(rows, columns=["plan_id", "year_ce", "year_be", "origin_code", "origin", "destination_code",
                                       "destination", "transfer_events", "distance_km", "cadre", "network",
                                       "cost_assumption", "constraint_status"])


# ----------------------------------------------------------------------------- stochastic paths

@dataclass
class Draws:
    n: int
    d: np.ndarray          # [n, P] departure probability
    r: np.ndarray          # [n, P] re-entry rate
    shares: dict
    pop_mult: np.ndarray   # [n, T, P] multiplicative population error
    coef_index: np.ndarray  # [n] bootstrap row of M5 coefficients
    U_exit: np.ndarray     # [n, T, P] common random numbers for exits
    U_re: np.ndarray       # [n, T, P] common random numbers for re-entries


def make_draws(ctx, n, seed, sigma_prov_year, sigma_nat_year):
    rng = np.random.default_rng(seed)
    dd = ctx.departures.draw(rng, n)
    nT, P = len(ctx.S.years), len(ctx.provs)
    eps = rng.normal(0, sigma_prov_year, (n, nT, P)).cumsum(1) + rng.normal(0, sigma_nat_year, (n, nT, 1)).cumsum(1)
    B = len(ctx.pkg["boot"]["op_moph"])
    return Draws(n=n, d=dd["d"], r=dd["r"], shares=dd["shares"], pop_mult=np.exp(eps),
                 coef_index=rng.integers(0, B, n), U_exit=rng.random((n, nT, P)), U_re=rng.random((n, nT, P)))


def realise_year(Hprev, d, r, U1, U2):
    L = stats.binom.ppf(U1, Hprev.astype(np.int64), np.clip(d, 0, 1)).astype(np.int64)
    R = stats.poisson.ppf(U2, np.maximum(r * Hprev, 1e-12)).astype(np.int64)
    return L, R


def simulate_fixed(ctx, pb: AL.Problem, x, zin, zout, routes: pd.DataFrame, draws: Draws):
    """Evaluate an announced fixed schedule on every paired path with a common minimal recourse
    rule: appointments are honoured; a planned transfer is cancelled (farthest route first)
    when the origin's realised survivors would breach the origin protection; nothing else is
    repaired.  Cap breaches caused by realised re-entries or by fewer exits than expected are
    recorded, not hidden."""
    n, nT, P = draws.n, pb.nT, pb.P
    H = np.zeros((n, nT, P), np.int64)
    canc = np.zeros((n, nT), np.int64)
    cap_breach = np.zeros((n, nT, P), bool)
    prot_breach = np.zeros((n, nT, P), bool)
    Hp = np.repeat(np.round(pb.H0).astype(np.int64)[None], n, 0)
    rt = {y: g for y, g in routes.groupby("year_ce")} if len(routes) else {}
    pos = {c: i for i, c in enumerate(ctx.provs)}
    for t in range(nT):
        # A Lab retention trajectory may vary hazards by year. The original
        # [draw, province] case is unchanged; [draw, year, province] is explicit.
        d_t = draws.d[:, t] if draws.d.ndim == 3 else draws.d
        r_t = draws.r[:, t] if draws.r.ndim == 3 else draws.r
        L, R = realise_year(Hp, d_t, r_t, draws.U_exit[:, t], draws.U_re[:, t])
        surv = Hp - L
        zi = np.repeat(zin[t][None], n, 0).astype(np.int64)
        zo = np.repeat(zout[t][None], n, 0).astype(np.int64)
        if zout[t].sum() > 0:
            allowed = np.floor(surv + R + x[t] - pb.protect_frac * surv + 1e-9).clip(min=0).astype(np.int64)
            allowed = np.minimum(allowed, surv)
            over = np.maximum(zo - allowed, 0)
            if over.any():
                g = rt[pb.years[t]].sort_values("distance_km", ascending=False)
                for k in range(n):
                    if not over[k].any():
                        continue
                    need = over[k].copy()
                    for rr in g.itertuples():
                        i, j = pos[rr.origin_code], pos[rr.destination_code]
                        if need[i] <= 0:
                            continue
                        c = min(need[i], rr.transfer_events)
                        need[i] -= c; zo[k, i] -= c; zi[k, j] -= c; canc[k, t] += c
        Ht = surv + R + x[t] + zi - zo
        if pb.cap_mode == "gross_arrivals":
            cap_breach[:, t] = (x[t] + zi + R) > pb.cap * Hp + 1e-9
        else:
            cap_breach[:, t] = (Ht - Hp) > pb.cap * Hp + 1e-9
        if pb.transfers:
            prot_breach[:, t] = (zo > 0) & (Ht < pb.protect_frac * surv - 1e-9)
        H[:, t] = Ht
        Hp = Ht
    return dict(H=H, cancelled=canc, cap_breach=cap_breach, protection_breach=prot_breach)


def simulate_adaptive_path(args):
    """One path of the annual replanning rule (run in a worker process).

    The planner observes the realised opening stock, updates its departure-rate estimate with the
    events realised so far (conjugate gamma update of the pooled rates), rescales its population
    forecast by the realised/central ratio of the last observed year, recomputes targets, solves
    the remaining horizon (stage 1 objective), and implements the current year only.  No future
    realisation enters any decision."""
    (k, ctx_small, fam_T_central, experiment, d_true, r_true, U1, U2, pop_mult, post_a, post_b,
     re_a, re_b, pool, prob_kw) = args
    nT, P = fam_T_central.shape
    Hp = ctx_small["H0"].round().astype(np.int64)
    cumE = np.zeros(P); cumN = np.zeros(P); cumR = np.zeros(P)
    X = np.zeros((nT, P), int); H = np.zeros((nT, P), np.int64)
    exits = np.zeros((nT, P), np.int64); reentries = np.zeros((nT, P), np.int64)
    solver_stages = []
    for t in range(nT):
        dmean = 1 - np.exp(-(post_a + cumE) / (post_b + cumN))
        rmean = (re_a + cumR) / (re_b + cumN)
        scale = pop_mult[t - 1] if t > 0 else np.ones(P)
        Trem = fam_T_central[t:] * scale[None]
        if experiment == "common_total":
            Trem = Trem / Trem.sum(1, keepdims=True) * (fam_T_central[t:] * scale[None]).sum(1, keepdims=True)
        pb = AL.Problem(provs=ctx_small["provs"], years=list(range(nT - t)), H0=Hp.astype(float), T=Trem,
                        d=dmean, r=rmean, A=pool[t:], stages=("shortfall",), **prob_kw)
        sol = AL.solve(pb)
        solver_stages.extend([{**stage, "decision_t": t} for stage in sol.stages])
        if sol.status != "solved":
            return dict(k=k, status=sol.status, failed_t=t, completed_years=t, X=X, H=H,
                        departures=exits, reentries=reentries, solver_stages=solver_stages,
                        solver_diagnostics=sol.diagnostics)
        X[t] = sol.x[0]
        L = stats.binom.ppf(U1[t], Hp, d_true).astype(np.int64)
        R = stats.poisson.ppf(U2[t], np.maximum(r_true * Hp, 1e-12)).astype(np.int64)
        exits[t] = L; reentries[t] = R
        cumE += L; cumN += Hp; cumR += R
        H[t] = Hp - L + R + X[t]
        Hp = H[t]
    return dict(k=k, status="solved", completed_years=nT, X=X, H=H,
                departures=exits, reentries=reentries, solver_stages=solver_stages)
