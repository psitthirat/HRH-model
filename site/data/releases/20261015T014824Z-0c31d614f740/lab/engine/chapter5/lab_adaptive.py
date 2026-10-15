"""Browser-compatible wrapper around the canonical adaptive simulation rule.

Only the already implemented recruitment-only learning rule is exposed. It
updates pooled rate estimates from events observed in previous years, then
solves the remaining expected horizon and implements the first decision. Future
random realizations are never passed to the allocation problem.
"""
from __future__ import annotations

import json
import numpy as np

from . import simulation as SIM
from .supply import EXIT, REENTRY


class AdaptiveUnsupported(ValueError):
    """The selected controls require an adaptive rule not yet implemented."""


def unsupported_reasons(ctx, p, pb):
    reasons = []
    if pb.population_reserved_share or p.get("allocation.population_reserved_share", 0):
        reasons.append("Adaptive uncertainty requires a validated demographic update of protected population quotas; the protected share cannot be silently ignored.")
    if p.get("allocation.family", "P") not in {"P", "S", "N-STD"}:
        reasons.append("Adaptive uncertainty currently supports P, S and N-STD; N-FB and SQ-C need separately validated learning rules.")
    if pb.transfers or p.get("mobility.enabled", False):
        reasons.append("Adaptive uncertainty currently supports recruitment-only plans; adaptive transfer cancellation and routing are not implemented.")
    if p.get("allocation.objective", "shortfall") != "shortfall":
        reasons.append("The canonical adaptive rule optimizes shortfall at each decision; adaptive maximin is not implemented.")
    if p.get("departures.rate_source", "pooled") != "pooled":
        reasons.append("The adaptive posterior update requires pooled provincial departure rates; the national-rate sensitivity is not supported here.")
    central = ctx.departures.central()
    if not np.allclose(pb.d, central["d"][None, :], rtol=0, atol=1e-12):
        reasons.append("Adaptive uncertainty currently requires baseline departure hazards without retention or hazard multipliers; their posterior learning rule is not implemented.")
    if not np.allclose(pb.r, central["r"][None, :], rtol=0, atol=1e-12):
        reasons.append("Adaptive uncertainty currently requires baseline re-entry rates without a multiplier or time-varying intervention.")
    return reasons


def _constant_draws(value, n, nT, P, name):
    value = np.asarray(value, float)
    if value.shape == (n, P):
        return value
    if value.shape != (n, nT, P):
        raise ValueError(f"{name} must have shape [draw, province] or [draw, year, province]")
    if not np.allclose(value, value[:, :1, :], rtol=0, atol=1e-12):
        raise AdaptiveUnsupported(f"Adaptive uncertainty cannot use time-varying {name} with the current constant-parameter learning rule")
    return value[:, 0, :]


def adaptive_paths(ctx, p, pb, draws, progress=None):
    """Run genuine paired adaptive paths, preserving failed-path information.

    H and event arrays are NaN after an uncompleted decision. completed_mask is
    the required filter for full-horizon summaries; zeros are never substituted
    for failed futures. Dimensions come from the problem (normally 15 × 76).
    """
    reasons = unsupported_reasons(ctx, p, pb)
    if reasons:
        raise AdaptiveUnsupported(" ".join(reasons))
    n, nT, P = int(draws.n), pb.nT, pb.P
    d = _constant_draws(draws.d, n, nT, P, "departure probabilities")
    r = _constant_draws(draws.r, n, nT, P, "re-entry rates")
    if not np.isfinite(d).all() or ((d < 0) | (d > 1)).any() or not np.isfinite(r).all() or (r < 0).any():
        raise ValueError("Adaptive path probabilities/rates are invalid; no values were clipped")
    for name in ("U_exit", "U_re", "pop_mult"):
        value = np.asarray(getattr(draws, name))
        if value.shape != (n, nT, P) or not np.isfinite(value).all():
            raise ValueError(f"{name} must contain finite [draw, year, province] values")
    if (draws.pop_mult <= 0).any():
        raise ValueError("Population multipliers must be positive")

    # Exactly the pooled prior construction used in chapter5.analysis, including
    # its common resignation exposure for the aggregate exit/re-entry update.
    dep = ctx.departures
    post_b = dep.b["resignation"]
    post_a = sum(dep.h[c] for c in EXIT) * post_b
    re_b = post_b
    re_a = sum(dep.h[c] for c in REENTRY) * re_b
    prob_kw = dict(floor=pb.floor, cap_mode=pb.cap_mode, cap=pb.cap,
                   reentry_consumes=pb.reentry_consumes,
                   require_full=pb.require_full,
                   tangent_step=pb.tangent_step, mip_rel_gap=pb.mip_rel_gap,
                   time_limit=pb.time_limit)
    shape = (n, nT, P)
    H = np.full(shape, np.nan); X = np.full(shape, np.nan)
    departures = np.full(shape, np.nan); reentries = np.full(shape, np.nan)
    completed_mask = np.zeros(n, bool)
    unplaced = np.full((n, nT), np.nan)
    cap_breach = np.zeros(shape, bool)
    draw_status = []
    maximum_balance_error = 0.0
    for k in range(n):
        if progress:
            progress("simulating_adaptive", json.dumps({"draw": k + 1, "requested_draws": n,
                     "completed_draws": int(completed_mask.sum())}))
        result = SIM.simulate_adaptive_path((k, {"H0": ctx.H0, "provs": ctx.provs},
            pb.T, p.get("targets.experiment", "common_total"), d[k], r[k],
            draws.U_exit[k], draws.U_re[k], draws.pop_mult[k],
            post_a, post_b, re_a, re_b, pb.A, prob_kw))
        count = int(result.get("completed_years", nT if result["status"] == "solved" else result.get("failed_t", 0)))
        complete = result["status"] == "solved" and count == nT
        completed_mask[k] = complete
        if count:
            H[k, :count] = result["H"][:count]
            X[k, :count] = result["X"][:count]
            departures[k, :count] = result["departures"][:count]
            reentries[k, :count] = result["reentries"][:count]
            unplaced[k, :count] = pb.A[:count] - X[k, :count].sum(axis=1)
            opening = np.vstack([np.round(ctx.H0), H[k, :count - 1]])
            error = np.abs(H[k, :count] - (opening - departures[k, :count] + reentries[k, :count] + X[k, :count]))
            maximum_balance_error = max(maximum_balance_error, float(error.max()))
            if pb.cap_mode == "gross_arrivals":
                arrivals = X[k, :count] + (reentries[k, :count] if pb.reentry_consumes else 0)
                cap_breach[k, :count] = arrivals > pb.cap * opening + 1e-9
            else:
                cap_breach[k, :count] = H[k, :count] - opening > pb.cap * opening + 1e-9
        draw_status.append({"draw": k, "status": "completed" if complete else result["status"],
            "completed_years": count, "failed_year_ce": None if complete else int(pb.years[count]),
            "unplaced_total_to_last_completed_year": int(np.nansum(unplaced[k])),
            "solver_stages": result.get("solver_stages", []),
            "solver_diagnostics": result.get("solver_diagnostics", {})})
    return dict(H=H, X=X, departures=departures, reentries=reentries, unplaced=unplaced,
        completed_mask=completed_mask, draw_status=draw_status,
        cap_breach=cap_breach, protection_breach=np.zeros(shape, bool),
        cancelled=np.zeros((n, nT), int),
        diagnostics={"requested_draws": n, "completed_draws": int(completed_mask.sum()),
            "failed_draws": int((~completed_mask).sum()),
            "stock_flow_balance_max_abs": maximum_balance_error,
            "decision_rule": "canonical_pooled_learning_recruitment_only_shortfall",
            "future_realizations_used_at_decision": False,
            "evaluated_partial_years": int(sum(r["completed_years"] for r in draw_status)),
            "realised_cap_breach_province_years": int(cap_breach.sum()),
            "paths_with_unplaced_appointments": int(np.any(unplaced > 0, axis=1).sum()),
            "unplaced_appointments_across_evaluated_path_years": int(np.nansum(unplaced)),
            "scope": "P/S/N-STD recruitment-only, pooled baseline constant hazards and re-entry rates"})
