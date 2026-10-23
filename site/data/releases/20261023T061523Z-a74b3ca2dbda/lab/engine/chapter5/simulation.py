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
from types import SimpleNamespace

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
    index_col: str              # D_P, D_Pent, D_S, D_N, D_B, D_Byld, D_Basr (N-FB uses D_N scale)
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


def make_problem(ctx, spec: PlanSpec, T, dep=None, H0=None, A=None, years=None, frame_state=None, **kw):
    """A Problem for a plan specification.  spec.overrides may carry "frame_spec", a declarative positions-frame rule
    expanded by frame.problem_kwargs (frame_state: positions in force for a remaining-horizon problem)."""
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
    ov = dict(spec.overrides)
    fs = ov.pop("frame_spec", None)
    base.update(ov)
    if fs is not None:
        from . import frame_rules as FRR
        fkw, base["T"] = FRR.problem_kwargs(ctx, fs, base["T"], base["A"], years, transfers=base["transfers"],
                                            d=base["d"], state=frame_state)
        base.update(fkw)
    base.update(kw)
    return AL.Problem(**base)


# ----------------------------------------------------------------------------- sequential solving

def sequential(ctx, spec: PlanSpec, target_fn, stages=("shortfall", "distribution", "operational"),
               dep=None, time_limit=None):
    """Rolling-horizon rule: at each decision year solve the remaining horizon with the targets
    known at that date (target_fn(t_index, H_prev) -> [remaining years, P]), implement only the
    current year's decisions, and advance the expected stock.  Used for N-FB (lagged feedback)
    and for annual replanning.  Each annual problem is solved to the stated gap; the sequence
    is a heuristic for the original nonlinear problem, not its global optimum.

    With a positions frame (spec.overrides["frame_spec"]) the positions in force are carried from year to year: a
    frame that starts in the decision year is decided then and kept for the rest of the frame; the frame's own
    stages replace `stages`."""
    S = ctx.S
    nT, P = len(S.years), len(ctx.provs)
    framed = "frame_spec" in spec.overrides
    X = np.zeros((nT, P), float if framed else int); ZI = np.zeros_like(X); ZO = np.zeros_like(X); H = np.zeros((nT, P))
    Tused = np.zeros((nT, P))
    spill = np.zeros((nT, P)); vv = np.zeros((nT, P))
    log = []
    Hp = ctx.H0.astype(float)
    dep = dep or ctx.dep
    t0 = time.time()
    state, K_abs, E_abs = None, {}, {}
    for t in range(nT):
        Trem, extra = target_fn(t, Hp)
        kw = {"time_limit": time_limit} if time_limit else {}
        # year-varying hazards (the Lab's retention paths) are cut to the remaining horizon
        dep_t = {k_: (np.asarray(v_)[t:] if np.ndim(v_) == 2 else v_) for k_, v_ in dep.items()}
        if framed:
            pb = make_problem(ctx, spec, Trem, dep=dep_t, H0=Hp, A=ctx.pool[t:], years=S.years[t:], frame_state=state, **kw)
        else:
            pb = make_problem(ctx, spec, Trem, dep=dep_t, H0=Hp, A=ctx.pool[t:], years=S.years[t:], stages=stages, **kw)
        sol = AL.solve(pb)
        if sol.status != "solved":
            return dict(status=sol.status, failed_year=S.years[t], diagnostics=sol.diagnostics, log=log)
        X[t], ZI[t], ZO[t] = sol.x[0], sol.zin[0], sol.zout[0]
        Tused[t] = Trem[0]
        if framed:
            H[t] = sol.H[0]
            spill[t] = sol.spill[0] if sol.spill is not None else 0.0
            vv[t] = sol.v[0] if sol.v is not None else 0.0
            c_rel = int(pb.frame["cycle"][0])
            c_abs = int(ctx.frame_inputs["cycle"][t])
            K_now = np.asarray(sol.frame["K"])[c_rel]
            E_now = np.asarray(sol.frame["E"])[c_rel] if sol.frame.get("E") is not None else None
            K_abs.setdefault(c_abs, K_now)
            if E_now is not None:
                E_abs.setdefault(c_abs, E_now)
            state = dict(t0=t + 1, K=K_now, E=E_now if E_now is not None else np.zeros(P))
        else:
            H[t] = (1 - pb.d[0] + pb.r[0]) * Hp + X[t] + ZI[t] - ZO[t]
        log.append(dict(year=S.years[t], stage_seconds=sum(s_["seconds"] for s_ in sol.stages),
                        mip_gap=max(s_.get("mip_gap", 0) or 0 for s_ in sol.stages), **(extra or {})))
        Hp = H[t]
    out = dict(status="solved", x=X, zin=ZI, zout=ZO, H=H, T=Tused, log=pd.DataFrame(log), seconds=time.time() - t0)
    if framed:
        Kc = np.array([K_abs[c] for c in sorted(K_abs)])
        frame = dict(K=Kc, added=np.vstack([np.zeros((1, P)), np.diff(Kc, axis=0)]))
        if E_abs:
            Ec = np.array([E_abs[c] for c in sorted(E_abs)])
            frame.update(E=Ec, emp_added=np.vstack([np.zeros((1, P)), np.diff(Ec, axis=0)]))
        out.update(spill=spill, v=vv, frame=frame)
    return out


# ----------------------------------------------------------------------------- ledgers

def expected_components(dep, Hprev):
    L = dep["d"] * Hprev
    out = {c: L * dep["shares"][c] for c in EXIT}
    out["reentries"] = dep["r"] * Hprev
    out["departures_total"] = L
    return out


def ledger(ctx, spec: PlanSpec, pb: AL.Problem, x, zin, zout, status: str, eval_T: dict, fl=None, reasons=None,
           extra_cols: dict | None = None, sol=None) -> pd.DataFrame:
    """The province-year ledger (section 15.1): one row per province and allocation year.  With a positions frame
    (sol given) it carries the training flows, the spill, the positions, capacity and vacancies, and the bonded
    graduates who could not be placed at home."""
    S = ctx.S
    spill = sol.spill if sol is not None else None
    H = AL.trajectory(pb, x, zin, zout, spill)
    exo = pb.exo if pb.exo is not None else np.zeros_like(H)
    spill_ = spill if spill is not None else np.zeros_like(H)
    cap = AL.capacity_by_year(pb, sol) if (sol is not None and pb.frame is not None) else None
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
            "training_net_inflow": exo[t], "training_spill": spill_[t],
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
        if "D_B" in ix:                      # family B present (native pipeline; omitted in the Lab)
            d.update({"D_B": ix.D_B.to_numpy(), "expected_daly_bod2022_rates": ix.B_B.to_numpy(),
                      "asr_daly_bod2022": ix.asr_daly.to_numpy()})
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
        d["value_type"] = ("expected value of the deterministic central plan (decisions are integers)" if pb.integral_x
                           else "expected value of the deterministic central plan (linear programme: decisions are continuous)")
        if cap is not None:
            f = pb.frame
            fr_ = sol.frame or {}
            d["positions_civil"] = AL.frame_by_year(pb, sol)[t]
            d["phi_onsite_per_position"] = f["phi"]
            d["employee_positions"] = np.asarray(fr_["E"])[f["cycle"][t]] if fr_.get("E") is not None else 0.0
            d["incumbents_above_frame"] = np.asarray(fr_["overflow"])[t] if fr_.get("overflow") is not None else 0.0
            d["capacity_onsite"] = cap[t]
            d["vacant_capacity"] = cap[t] - H[t]
            d["committed_appointments"] = pb.committed[t] if pb.committed is not None else 0.0
            d["committed_not_placed_at_home"] = sol.v[t] if sol.v is not None else 0.0
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
             + out.training_net_inflow - out.training_spill - out.expected_closing_stock)
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
        training_net_inflow=("training_net_inflow", "sum"), training_spill=("training_spill", "sum"),
        target_own=("target_own", "sum"), population_civil=("population_civil", "sum"),
        plan_status=("plan_status", "first")).reset_index()
    g = g.merge(pool, on=["plan_id", "year_ce"], how="left")     # pool: plan_id, year_ce, available
    g["unplaced_balance"] = g.available - g.new_appointments
    g["reconciliation_difference"] = (g.opening_stock - g.expected_departures + g.expected_reentries + g.new_appointments
                                      + g.transfers_in - g.transfers_counted_once + g.training_net_inflow
                                      - g.training_spill - g.closing_stock)
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


def round_rows(M) -> np.ndarray:
    """Integers whose rows sum to the rounded row totals (largest remainders): the continuous decisions of a
    linear-programme plan realised on integer paths.  Integer input is returned unchanged."""
    M = np.atleast_2d(np.asarray(M, float))
    out = np.floor(M + 1e-9)
    for t in range(M.shape[0]):
        k = int(round(M[t].sum() - out[t].sum()))
        if k > 0:
            out[t, np.argsort(-(M[t] - out[t]), kind="stable")[:k]] += 1
    return out.astype(np.int64)


def integer_routes(routes: pd.DataFrame) -> pd.DataFrame:
    """Routes with integer transfer events, rounded within each year by largest remainders."""
    if not len(routes):
        return routes
    ev = routes.transfer_events.to_numpy(float)
    out = np.floor(ev + 1e-9)
    for _, ix in routes.groupby("year_ce").indices.items():
        k = int(round(ev[ix].sum() - out[ix].sum()))
        if k > 0:
            out[ix[np.argsort(-(ev[ix] - out[ix]), kind="stable")[:k]]] += 1
    r = routes.assign(transfer_events=out.astype(np.int64))
    return r[r.transfer_events > 0].reset_index(drop=True)


def onsite_capacity(pb: AL.Problem, sol=None) -> np.ndarray | None:
    """[T, P] on-site capacity of the positions frame, phi K + E (sol: the solved frame, needed when it was decided).
    Incumbents kept above a shrinking frame are not capacity: they stay, but nobody is appointed above the frame."""
    if pb.frame is None:
        return None
    sol = sol if sol is not None else SimpleNamespace(frame={})
    cap = pb.frame["phi"] * AL.frame_by_year(pb, sol)
    if (sol.frame or {}).get("E") is not None:
        cap = cap + np.asarray(sol.frame["E"])[pb.frame["cycle"]]
    return cap


def fill_frame(occ, R, exo_in, x, cap):
    """One year's arrivals rationed by the vacancies of the positions frame, in the plan's priority order:
    re-entries, then returning trainees (the rest spill), then appointments (an appointment without a vacancy is not
    made).  Arrays broadcast over paths.  Returns the closing stock and the admitted re-entries, trainees and
    appointments."""
    vac = np.maximum(cap - occ, 0)
    Rin = np.minimum(R, vac)
    vac = vac - Rin
    ab = np.minimum(exo_in, vac)
    xin = np.minimum(x, vac - ab)
    return occ + Rin + ab + xin, Rin, ab, xin


class FrameContext:
    """The parts of a planning context that frame_rules.problem_kwargs reads, small enough to send to workers."""

    def __init__(self, ctx):
        self.S = SimpleNamespace(cfg={"frame": ctx.S.cfg["frame"]}, years=list(ctx.S.years))
        self.frame_inputs = ctx.frame_inputs
        self.provs = ctx.provs
        self.idx = ctx.idx[["year", "prov_code", "D_S"]].copy()


def simulate_fixed(ctx, pb: AL.Problem, x, zin, zout, routes: pd.DataFrame, draws: Draws, sol=None):
    """Evaluate an announced fixed schedule on every paired path with a common minimal recourse
    rule: appointments are honoured; a planned transfer is cancelled (farthest route first)
    when the origin's realised survivors would breach the origin protection; nothing else is
    repaired.  Cap breaches caused by realised re-entries or by fewer exits than expected are
    recorded, not hidden.

    With a positions frame (pb.frame; sol carries a decided frame) the realised vacancies ration the arrivals
    (fill_frame): a scheduled appointment without a vacancy is not made and the graduate stays unplaced that year
    (blocked, recorded); a planned transfer into a province without a vacancy is cancelled with its route (farthest
    first); incumbents above a shrinking frame stay.  Continuous decisions of a linear-programme plan are rounded
    to integers that keep each year's total."""
    n, nT, P = draws.n, pb.nT, pb.P
    framed = pb.frame is not None
    x = round_rows(x)
    if len(routes) and not (np.allclose(zin, np.round(zin)) and np.allclose(zout, np.round(zout))):
        routes = integer_routes(routes)
        zin, zout = np.zeros((nT, P), np.int64), np.zeros((nT, P), np.int64)
        pos_ = {c: i for i, c in enumerate(ctx.provs)}
        yi = {y: t for t, y in enumerate(pb.years)}
        for rr in routes.itertuples():
            zout[yi[rr.year_ce], pos_[rr.origin_code]] += rr.transfer_events
            zin[yi[rr.year_ce], pos_[rr.destination_code]] += rr.transfer_events
    zin, zout = np.round(zin).astype(np.int64), np.round(zout).astype(np.int64)
    H = np.zeros((n, nT, P), np.int64)
    canc = np.zeros((n, nT), np.int64)
    cap_breach = np.zeros((n, nT, P), bool)
    prot_breach = np.zeros((n, nT, P), bool)
    if framed:
        capi = np.floor(onsite_capacity(pb, sol) + 0.5).astype(np.int64)
        exo = round_rows(pb.exo) if pb.exo is not None else np.zeros((nT, P), np.int64)
        com = pb.committed
        blocked, blocked_re, spill, com_unmet = (np.zeros((n, nT)) for _ in range(4))
        at_cap = np.zeros((n, nT, P), bool)
    Hp = np.repeat(np.round(pb.H0).astype(np.int64)[None], n, 0)
    rt = {y: g.sort_values("distance_km", ascending=False) for y, g in routes.groupby("year_ce")} if len(routes) else {}
    pos = {c: i for i, c in enumerate(ctx.provs)}
    for t in range(nT):
        # A Lab retention trajectory may vary hazards by year. The original
        # [draw, province] case is unchanged; [draw, year, province] is explicit.
        d_t = draws.d[:, t] if draws.d.ndim == 3 else draws.d
        r_t = draws.r[:, t] if draws.r.ndim == 3 else draws.r
        L, R = realise_year(Hp, d_t, r_t, draws.U_exit[:, t], draws.U_re[:, t])
        surv = Hp - L
        zi = np.repeat(zin[t][None], n, 0)
        zo = np.repeat(zout[t][None], n, 0)
        if zout[t].sum() > 0:
            g = rt[pb.years[t]]
            left = np.repeat(g.transfer_events.to_numpy(np.int64)[None], n, 0)      # route events still planned
            oi = g.origin_code.map(pos).to_numpy(); di = g.destination_code.map(pos).to_numpy()
            allowed = np.floor(surv + R + x[t] - pb.protect_frac * surv + 1e-9).clip(min=0).astype(np.int64)
            allowed = np.minimum(allowed, surv)
            over = np.maximum(zo - allowed, 0)
            for k in np.flatnonzero(over.any(1)):
                need = over[k].copy()
                for q in range(len(g)):
                    i, j = oi[q], di[q]
                    if need[i] <= 0:
                        continue
                    c = min(need[i], left[k, q])
                    need[i] -= c; left[k, q] -= c; zo[k, i] -= c; zi[k, j] -= c; canc[k, t] += c
            if framed:                       # no vacancy at the destination: the transfer is cancelled
                room = np.maximum(capi[t] - (np.maximum(surv + np.minimum(exo[t], 0), 0) - zo), 0)
                over = np.maximum(zi - room, 0)
                for k in np.flatnonzero(over.any(1)):
                    need = over[k].copy()
                    for q in range(len(g)):
                        i, j = oi[q], di[q]
                        if need[j] <= 0:
                            continue
                        c = min(need[j], left[k, q])
                        need[j] -= c; left[k, q] -= c; zo[k, i] -= c; zi[k, j] -= c; canc[k, t] += c
        if framed:
            occ = np.maximum(surv + np.minimum(exo[t], 0), 0) - zo + zi
            ex_in = np.maximum(exo[t], 0)[None]
            Ht, Rin, ab, xin = fill_frame(occ, R, ex_in, x[t][None], capi[t][None])
            blocked[:, t] = (x[t][None] - xin).sum(1)
            blocked_re[:, t] = (R - Rin).sum(1)
            spill[:, t] = (ex_in - ab).sum(1)
            if com is not None:
                com_unmet[:, t] = np.maximum(com[t][None] - xin, 0).sum(1)
            at_cap[:, t] = Ht >= capi[t][None]
        else:
            Ht = surv + R + x[t] + zi - zo
            if pb.cap_mode == "gross_arrivals":
                cap_breach[:, t] = (x[t] + zi + R) > pb.cap * Hp + 1e-9
            elif pb.cap_mode != "none":
                cap_breach[:, t] = (Ht - Hp) > pb.cap * Hp + 1e-9
        if pb.transfers:
            prot_breach[:, t] = (zo > 0) & (Ht < pb.protect_frac * surv - 1e-9)
        H[:, t] = Ht
        Hp = Ht
    out = dict(H=H, cancelled=canc, cap_breach=cap_breach, protection_breach=prot_breach)
    if framed:
        out.update(blocked_appointments=blocked, blocked_reentries=blocked_re, training_spill=spill,
                   committed_unmet=com_unmet, at_capacity=at_cap, capacity=capi)
    return out


def simulate_adaptive_path(args):
    """One path of the annual replanning rule (run in a worker process).

    The planner observes the realised opening stock, updates its departure-rate estimate with the
    events realised so far (conjugate gamma update of the pooled rates), rescales its population
    forecast by the realised/central ratio of the last observed year, recomputes targets, solves
    the remaining horizon (stage 1 objective), and implements the current year only.  No future
    realisation enters any decision.

    With a positions frame (ctx_small["frame_spec"] and ctx_small["frame_ctx"], a FrameContext) the remaining-horizon
    problem carries the positions in force; a frame starting in the decision year is decided then (with the frame-cost
    stage) and kept; the year's arrivals are rationed by the realised vacancies (fill_frame)."""
    (k, ctx_small, fam_T_central, experiment, d_true, r_true, U1, U2, pop_mult, post_a, post_b,
     re_a, re_b, pool, prob_kw) = args
    nT, P = fam_T_central.shape
    fs = ctx_small.get("frame_spec")
    Hp = ctx_small["H0"].round().astype(np.int64)
    cumE = np.zeros(P); cumN = np.zeros(P); cumR = np.zeros(P)
    X = np.zeros((nT, P), int); H = np.zeros((nT, P), np.int64)
    exits = np.zeros((nT, P), np.int64); reentries = np.zeros((nT, P), np.int64)
    training = np.zeros((nT, P), np.int64); blocked = np.zeros(nT, np.int64); spilled = np.zeros(nT, np.int64)
    solver_stages = []
    state = None
    for t in range(nT):
        dmean = 1 - np.exp(-(post_a + cumE) / (post_b + cumN))
        rmean = (re_a + cumR) / (re_b + cumN)
        scale = pop_mult[t - 1] if t > 0 else np.ones(P)
        Trem = fam_T_central[t:] * scale[None]
        if experiment == "common_total":
            Trem = Trem / Trem.sum(1, keepdims=True) * (fam_T_central[t:] * scale[None]).sum(1, keepdims=True)
        kw = dict(prob_kw, stages=("shortfall",))
        if fs is not None:
            from . import frame_rules as FRR
            fctx = ctx_small["frame_ctx"]
            fkw, Trem = FRR.problem_kwargs(fctx, fs, Trem, pool[t:], list(range(nT - t)), d=dmean, state=state)
            cyc = fctx.frame_inputs["cycle"]
            if t > 0 and cyc[t] == cyc[t - 1]:          # positions in force: nothing to decide this year
                fkw["stages"] = tuple(s_ for s_ in fkw["stages"] if s_ != "frame_cost")
            kw.update(fkw)
        pb = AL.Problem(provs=ctx_small["provs"], years=list(range(nT - t)), H0=Hp.astype(float), T=Trem,
                        d=dmean, r=rmean, A=pool[t:], **kw)
        sol = AL.solve(pb)
        solver_stages.extend([{**stage, "decision_t": t} for stage in sol.stages])
        if sol.status != "solved":
            return dict(k=k, status=sol.status, failed_t=t, completed_years=t, X=X, H=H,
                        departures=exits, reentries=reentries, training_net=training, solver_stages=solver_stages,
                        solver_diagnostics=sol.diagnostics)
        L = stats.binom.ppf(U1[t], Hp, d_true).astype(np.int64)
        R = stats.poisson.ppf(U2[t], np.maximum(r_true * Hp, 1e-12)).astype(np.int64)
        exits[t] = L
        cumE += L; cumN += Hp; cumR += R
        if fs is None:
            X[t] = sol.x[0]
            reentries[t] = R
            H[t] = Hp - L + R + X[t]
        else:
            c0 = int(pb.frame["cycle"][0])
            K_now = np.asarray(sol.frame["K"])[c0]
            E_now = np.asarray(sol.frame["E"])[c0] if sol.frame.get("E") is not None else np.zeros(P)
            cap = np.floor(pb.frame["phi"] * K_now + E_now + 0.5).astype(np.int64)
            ex = round_rows(pb.exo[:1])[0] if pb.exo is not None else np.zeros(P, np.int64)
            xi = round_rows(sol.x[:1])[0]
            occ = np.maximum(Hp - L + np.minimum(ex, 0), 0)
            H[t], Rin, ab, xin = fill_frame(occ, R, np.maximum(ex, 0), xi, cap)
            X[t], reentries[t] = xin, Rin
            training[t] = occ - (Hp - L) + ab
            blocked[t] = int((xi - xin).sum()); spilled[t] = int((np.maximum(ex, 0) - ab).sum())
            state = dict(t0=t + 1, K=K_now, E=E_now)
        Hp = H[t]
    out = dict(k=k, status="solved", completed_years=nT, X=X, H=H,
               departures=exits, reentries=reentries, solver_stages=solver_stages)
    if fs is not None:
        out.update(training_net=training, blocked_appointments=blocked, training_spill=spilled)
    return out
