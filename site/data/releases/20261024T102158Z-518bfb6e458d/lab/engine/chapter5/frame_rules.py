"""Positions-frame rules: numpy-only functions that turn a declarative frame specification into Problem arguments.

Kept free of chapter4 imports and file reads so the browser Lab (Pyodide) can import it.  The frame inputs (J.18 positions
K0, phi, bonded/mentor shares, training flows, physicians outside the Ministry) are attached to the context as
ctx.frame_inputs (research: pipeline.context via frame.inputs; Lab: lab_adapter.context from the aggregate inputs) and
the settings come from ctx.S.cfg["frame"].
"""
from __future__ import annotations

import numpy as np


def cycles(years, F) -> np.ndarray:
    starts = F["frame"]["cycle_starts"]
    return np.array([sum(y >= s for s in starts) for y in years], int)


def service_share_by_cycle(ctx, cycle) -> np.ndarray:
    """[C, P] share of MOPH hospital services (the S index) in the first year of each frame.  Hospital-funded employee
    positions follow it: services are the revenue base of a hospital's maintenance fund (no finance data here)."""
    idx = ctx.idx.set_index(["year", "prov_code"])
    years = np.asarray(ctx.S.years)
    out = []
    for c in range(int(cycle.max()) + 1):
        D = idx.loc[int(years[np.flatnonzero(cycle == c)[0]])].loc[ctx.provs, "D_S"].to_numpy(float)
        out.append(D / D.sum())
    return np.array(out)


def rule_frame(ctx, inp, fr, rule, g):
    """Absolute-cycle frame of a rule: dict(mode, add [C, P] or budget [C], realloc, emp_mode, dE [C] or E [C, P],
    overflow).  F0 fixed; F1/FSQ pro rata g; F2 / need the pro-rata number placed by need; F3 = F2 + moving vacant
    positions; GDh / GDc: civil-servant positions cut by g per frame (abolished when vacated) and hospital-employee
    positions making the total on-site capacity equal to the pro-rata expansion at the same rate, placed by service
    share (hospital-funded) or by need (central)."""
    K0, phi, cyc = inp["K0"], inp["phi"], inp["cycle"]
    nC = int(cyc.max()) + 1
    out = dict(realloc=0.0, emp_mode=None, overflow=False)
    if rule == "F0":
        out.update(mode="fixed", add=np.zeros((nC, len(K0))))
    elif rule in ("F1", "FSQ", "FSQgp"):
        out.update(mode="schedule", add=prorata_additions(K0, g, nC))
    elif rule in ("F2", "F3", "need"):
        out.update(mode="optimize", budget=prorata_additions(K0, g, nC).sum(1))
        if rule == "F3":
            out["realloc"] = float(fr["realloc_per_cycle"])
    elif rule in ("GDh", "GDc"):
        tot = (phi * K0).sum() * np.array([(1 + g) ** c - (1 - g) ** c for c in range(nC)])
        dE = np.r_[0.0, np.diff(tot)]
        out.update(mode="schedule", add=prorata_additions(K0, -g, nC), overflow=True, dE=dE)
        if rule == "GDh":
            out.update(emp_mode="schedule", E=np.cumsum(dE[:, None] * service_share_by_cycle(ctx, cyc), axis=0))
        else:
            out.update(emp_mode="optimize")
    else:
        raise ValueError(f"unknown frame rule {rule}")
    return out


def problem_kwargs(ctx, fs: dict, T, A, years, transfers=False, d=None, state=None):
    """Problem keyword arguments (and targets) for a declarative frame specification, PlanSpec.overrides["frame_spec"].

    fs keys, all optional (defaults from [frame]): rule (F0 | F1 | F2 | F3 | need | FSQ | FSQgp | GDh | GDc), growth,
    committed, training, pool_rule, target_adj, rel_tol, cap ("none" | "gross_arrivals"), floor, emp_exit.
    state, for a remaining-horizon problem (rolling and adaptive solving): dict(t0 = first year index, K = positions in
    force before year t0, E = employee positions in force).  A frame starting at t0 is then still to be decided."""
    fr = ctx.S.cfg["frame"]
    inp = ctx.frame_inputs
    rule = fs.get("rule", fr["main_rule"])
    g = float(fs.get("growth", fr["need_growth_ceiling"] if rule == "need" else fr["main_growth"]))
    rf = rule_frame(ctx, inp, fr, rule, g)
    cyc_full = inp["cycle"]
    nT, P = len(years), len(ctx.provs)
    t0 = int((state or {}).get("t0", 0))
    if t0 == 0:
        cyc, K0, base_c, start = cyc_full, inp["K0"], 0, False
    else:
        start = bool(cyc_full[t0] > cyc_full[t0 - 1])                 # a frame starts this year: still to decide
        base_c = int(cyc_full[t0]) - (1 if start else 0)              # absolute cycle of relative cycle 0
        cyc = cyc_full[t0:] - cyc_full[t0] + (1 if start else 0)
        K0 = np.asarray(state["K"], float)
    nC = int(cyc.max()) + 1
    absc = [base_c + j for j in range(nC)]
    frame = dict(K0=K0, phi=inp["phi"], cycle=cyc, mode=rf["mode"], realloc=rf["realloc"], overflow=rf["overflow"])
    if rf["mode"] == "schedule":
        frame["schedule"] = np.vstack([np.zeros(P)] + [rf["add"][c] for c in absc[1:]])
    elif rf["mode"] == "optimize":
        frame["budget"] = np.r_[0.0, [rf["budget"][c] for c in absc[1:]]]
    if rf["emp_mode"] == "schedule":
        E_now = np.asarray((state or {}).get("E", np.zeros(P)), float)
        Eabs = rf["E"]
        frame.update(emp_mode="schedule", emp_schedule=np.vstack([E_now] + [E_now + Eabs[c] - Eabs[base_c] for c in absc[1:]]))
    elif rf["emp_mode"] == "optimize":
        frame.update(emp_mode="optimize", emp_budget=np.r_[0.0, [rf["dE"][c] for c in absc[1:]]],
                     E0=np.asarray((state or {}).get("E", np.zeros(P)), float))
    if fs.get("target_adj"):
        T = net_targets(np.asarray(T, float), inp["nonmoph"], float(fs["target_adj"]))
    training = fs.get("training", fr["training_flows"])
    exo = None if training == "none" else np.broadcast_to(inp["flows"][(fs.get("pool_rule", fr["pool_rule"]), training)], (nT, P))
    committed = committed_matrix(fs.get("committed", fr["committed"]), inp, np.asarray(A, float))
    decided = rf["mode"] == "optimize" or rf["emp_mode"] == "optimize"
    stages = ("shortfall", "frame_cost") if decided else ("shortfall",)
    if transfers:
        stages = stages + ("operational",)
    kw = dict(frame=frame, exo=exo, committed=committed, cap_mode=fs.get("cap", "none"), floor=int(fs.get("floor", 0)),
              require_full=False, integral_x=bool(fr.get("integral_appointments", False)), stages=stages)
    if fs.get("rel_tol"):
        kw["rel_tol"] = float(fs["rel_tol"])
    if fs.get("emp_exit") and rf["emp_mode"] is not None and d is not None:
        # employees leave emp_exit times as fast: the province's departure probability rises with the employee share
        # of its capacity (schedule: by province; decided: the national share), an approximation of separate stocks
        Kc = frame["K0"][None] + np.cumsum(frame.get("schedule", np.zeros((nC, P))), axis=0)
        cap_civ = inp["phi"] * Kc
        if rf["emp_mode"] == "schedule":
            share = frame["emp_schedule"] / (cap_civ + frame["emp_schedule"])
        else:
            Etot = np.cumsum(frame["emp_budget"]) + frame["E0"].sum()
            share = np.repeat((Etot / (cap_civ.sum(1) + Etot))[:, None], P, axis=1)
        dd = np.broadcast_to(np.asarray(d, float), (nT, P))
        kw["d"] = dd * (1 + (float(fs["emp_exit"]) - 1) * share[cyc])
    return kw, T


def net_targets(T, nonmoph, w) -> np.ndarray:
    """Targets net of w x the physicians outside the Ministry, rescaled to the same national total each year: a
    province's share falls where other sectors already employ physicians.  Floored at 10% of the gross target."""
    Tn = np.maximum(T - w * nonmoph[None, :], 0.1 * T)
    return Tn * (T.sum(1) / Tn.sum(1))[:, None]


def prorata_additions(K0, g, n_cycles) -> np.ndarray:
    """[C, P] positions added at the start of each frame when every province grows by g per frame."""
    K = np.array([K0 * (1 + g) ** c for c in range(n_cycles)])
    return np.vstack([np.zeros_like(K0), np.diff(K, axis=0)])


def committed_matrix(rule: str, inp: dict, A: np.ndarray) -> np.ndarray | None:
    if rule == "none":
        return None
    sh = inp["share"]["bonded"] + (inp["share"]["mentor"] if rule == "bonded_and_mentor" else 0)
    return np.floor(A[:, None] * sh[None, :])


def status_quo_plan(pb, inp, rule="vacancy"):
    """Status-quo comparators inside a scheduled frame (rules, not optimised), as an allocation.Solution.
        rule="vacancy"  each year the graduates fill vacant positions in proportion to the vacancies (the J.18
                        practice of reserving vacated posts for the next cohort); bonded graduates first
        rule="gp2569"   each year the graduates follow the provincial pattern of the 2569 GP allocation; a province
                        takes only what its vacancies allow and the excess is re-routed to provinces with vacancies
                        in proportion to them
    Returning trainees who find no position spill.  Graduates for whom no vacancy exists anywhere are unplaced."""
    from . import allocation as AL
    nT, P = pb.nT, pb.P
    Kc = AL.frame_capacity(pb)
    x = np.zeros((nT, P))
    spill = np.zeros((nT, P))
    v = np.zeros((nT, P))
    Hp = pb.H0.astype(float)
    for t in range(nT):
        base = (1 - pb.d[t] + pb.r[t]) * Hp + (pb.exo[t] if pb.exo is not None else 0)
        cap = pb.frame["phi"] * Kc[pb.frame["cycle"][t]]
        spill[t] = np.maximum(base - cap, 0)
        room = np.maximum(cap - (base - spill[t]), 0)
        A = float(pb.A[t])
        com = np.minimum(pb.committed[t], room) if pb.committed is not None else np.zeros(P)
        if pb.committed is not None:
            v[t] = pb.committed[t] - com
        room2 = room - com
        left = A - com.sum()
        if rule == "gp2569":
            want = left * inp["gp_share"]
            take = np.minimum(want, room2)
            excess = left - take.sum()
            room3 = room2 - take
            extra = excess * room3 / room3.sum() if room3.sum() > 0 else np.zeros(P)
            add = take + np.minimum(extra, room3)
        else:
            add = left * room2 / room2.sum() if room2.sum() > 0 else np.zeros(P)
            add = np.minimum(add, room2)
        x[t] = com + add
        Hp = base - spill[t] + x[t]
    z = np.zeros((nT, P))
    sol = AL.Solution(status="solved", x=x, zin=z, zout=z, u=pb.A - x.sum(1), spill=spill, v=v,
                      frame=dict(K=Kc, added=np.vstack([np.zeros((1, P)), np.diff(Kc, axis=0)])),
                      diagnostics=dict(rule=rule))
    sol.H = AL.trajectory(pb, x, z, z, spill)
    return sol
