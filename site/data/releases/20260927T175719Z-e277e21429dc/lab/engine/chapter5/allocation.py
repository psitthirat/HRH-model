"""Constrained integer allocation of new appointments and controlled transfers (HiGHS MILP).

Decision variables for province p and year t (all years solved jointly, same deterministic
stock-flow transition as the simulator):

    x[p,t]    accepted starts from the managed-system pool          integer >= floor
    zin/zout  controlled transfers in / out (existing staff)          integer >= 0
    H[p,t]    expected closing stock                                  continuous
    s[p,t]    proportional shortfall  s >= 1 - H/T, s >= 0
    y[p,t]    epigraph of s^2 by tangents  y >= 2 a s - a^2           (convex piecewise-linear)
    u[t]      unplaced pool (0 when full placement is required)

Stock identity   H[p,t] = (1 - d_p + r_p) H[p,t-1] + x + zin - zout
                 (d = expected external departure probability, r = re-entry rate, both applied
                 to the opening stock; see supply.py)
Pool             sum_p x[p,t] + u[t] = A_t
Gross cap        x + zin + r H[t-1] <= g H[t-1]              (re-entries consume onboarding)
Net-growth cap   H[t] - H[t-1] <= c H[t-1]                   (alternative)
Transfers        zout <= tau (1-d) H[t-1];  sum zout <= beta sum (1-d) H[t-1];  sum zin = sum zout
                 (per health region when the network is regional)
Origin floor     H[t] >= f (1-d) H[t-1]  (limited drawdown; new appointments may replace transfers)
                 or H[t] >= min(T, (1-d) H[t-1])  (surplus_only, one binary per province-year)

Lexicographic order: placement -> J_short = sum_t sum_p (T/sum T) y -> distribution imbalance
within a tolerance of J* -> transfers (and changes from an announced plan) within a tolerance of
the imbalance optimum.  Routing of the aggregate transfers is a separate integer transportation
problem on the declared network, which always routes when the network is complete and, for the
regional network, because regional balance is imposed in the allocation stage.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np
import scipy.sparse as sp
from scipy.optimize import Bounds, LinearConstraint, milp


@dataclass
class Problem:
    provs: np.ndarray
    years: list
    H0: np.ndarray
    T: np.ndarray                    # [T, P] targets
    d: np.ndarray                    # [P] or [T, P] departure probability
    r: np.ndarray                    # [P] or [T, P] re-entry rate
    A: np.ndarray                    # [T] available pool
    floor: int = 1
    cap_mode: str = "gross_arrivals"
    cap: float = 0.10
    reentry_consumes: bool = True
    transfers: bool = False
    tau: float = 0.0
    nat_budget: float = 0.0
    protect_mode: str = "limited_drawdown"
    protect_frac: float = 0.95
    network: str = "complete_76"
    region: np.ndarray | None = None
    require_full: bool = True
    tangent_step: float = 0.025
    discount: float = 1.0
    rel_tol: float = 5e-4
    abs_tol: float = 1e-7
    mip_rel_gap: float = 2e-4
    time_limit: float = 180.0
    secondary_time_limit: float = 60.0
    announced_x: np.ndarray | None = None        # [T, P] for replanning disruption
    reference_x: np.ndarray | None = None        # [T, P] for the "closest feasible" objective
    stages: tuple = ("shortfall", "distribution", "operational")
    label: str = ""
    population_reserved_share: float = 0.0
    reservation_population: np.ndarray | None = None  # [T, P], chosen population register

    def __post_init__(self):
        P, T = len(self.provs), len(self.years)
        self.P, self.nT = P, T
        self.d = np.broadcast_to(np.asarray(self.d, float), (T, P)).copy()
        self.r = np.broadcast_to(np.asarray(self.r, float), (T, P)).copy()
        self.A = np.asarray(self.A, float).reshape(T)
        self.T = np.asarray(self.T, float).reshape(T, P)
        assert (self.T > 0).all(), "targets must be positive"
        self.w = self.T / self.T.sum(1, keepdims=True)
        if not np.isfinite(self.population_reserved_share) or not 0 <= self.population_reserved_share <= 1:
            raise ValueError("population reserved share must be between zero and one")
        if self.population_reserved_share:
            if self.reservation_population is None:raise ValueError("population reservation requires explicit province-year populations")
            self.reservation_population = np.asarray(self.reservation_population, float).reshape(T, P)
            if not np.isfinite(self.reservation_population).all() or (self.reservation_population <= 0).any():
                raise ValueError("reservation populations must be finite and positive")
            if (self.A < 0).any() or not np.equal(self.A, np.floor(self.A)).all():
                raise ValueError("population reservation requires nonnegative integer appointment pools")


def reservation_quota(pb: Problem):
    """Optional population protection with quota-constrained integer rounding.

    Reserve round-half-up(A * share) accepted appointments. Each provincial
    quota lies between floor and ceiling of its exact population-proportional
    amount; the MILP chooses a feasible rounding within all existing limits.
    Universal floors overlap this protected component: x >= max(floor, q),
    never floor + q. Infeasible protection is not silently reduced or reassigned
    outside these quota bounds. A zero share adds no optimisation variables.
    """
    if not pb.population_reserved_share:
        z = np.zeros((pb.nT, pb.P), int)
        return np.zeros(pb.nT, int), z, z, z.astype(float)
    total = np.floor(pb.A * pb.population_reserved_share + 0.5).astype(int)
    exact = total[:, None] * pb.reservation_population / pb.reservation_population.sum(1, keepdims=True)
    # Remove floating-point noise only at integer boundaries (one ten-billionth
    # of an appointment), so mathematically integral quotas stay integral.
    exact = np.where(np.isclose(exact, np.rint(exact), rtol=0, atol=1e-10), np.rint(exact), exact)
    return total, np.floor(exact).astype(int), np.ceil(exact).astype(int), exact


def reserved_allocations(pb: Problem, x):
    """An auditable protected subset of the solved accepted appointments.

    Feasibility is independent of how the optimiser rounded auxiliary q.
    Reconstruct a valid subset using largest remainders among eligible cells,
    breaking ties by province code; this never changes any appointment decision.
    """
    total, lo, hi, exact = reservation_quota(pb)
    x = np.asarray(x)
    if (x < lo).any():raise ValueError("accepted appointments violate a protected population lower quota")
    q = lo.copy()
    for t in range(pb.nT):
        remaining = int(total[t] - q[t].sum())
        eligible = np.flatnonzero((hi[t] > lo[t]) & (x[t] >= hi[t]))
        order = eligible[np.lexsort((np.asarray(pb.provs)[eligible], -(exact[t, eligible] - lo[t, eligible])))]
        if remaining > len(order):raise ValueError("appointments cannot contain the required protected national total")
        q[t, order[:remaining]] += 1
    return q


class _Builder:
    def __init__(self):
        self.rows, self.cols, self.vals, self.lo, self.hi = [], [], [], [], []
        self.n = 0

    def add(self, cols, vals, lo, hi):
        cols = np.atleast_2d(cols)
        vals = np.atleast_2d(vals)
        m = cols.shape[0]
        r = np.arange(self.n, self.n + m)[:, None] + np.zeros_like(cols)
        self.rows.append(r.ravel()); self.cols.append(cols.ravel()); self.vals.append(vals.ravel())
        self.lo.append(np.broadcast_to(np.asarray(lo, float), (m,)))
        self.hi.append(np.broadcast_to(np.asarray(hi, float), (m,)))
        self.n += m

    def matrix(self, nvar):
        A = sp.csr_matrix((np.concatenate(self.vals), (np.concatenate(self.rows), np.concatenate(self.cols))),
                          shape=(self.n, nvar))
        return A, np.concatenate(self.lo), np.concatenate(self.hi)


def _layout(pb: Problem):
    P, T = pb.P, pb.nT
    blocks = ["x", "zin", "zout", "H", "s", "y", "e"] + (["b"] if (pb.transfers and pb.protect_mode == "surplus_only") else [])
    if pb.population_reserved_share:blocks.append("q")
    off, k = {}, 0
    for b in blocks:
        off[b] = k
        k += P * T
    off["u"] = k
    k += T
    off["Ht"] = k          # national closing stock per year (used by the distribution stage)
    k += T
    off["mm"] = k          # minimum attainment (used only by the max-min fairness variant)
    k += 1
    return off, k


def _stock_bounds(pb: Problem):
    """Loose lower/upper bounds of H (used only to restrict tangent points)."""
    P, T = pb.P, pb.nT
    lo = np.zeros((T, P)); hi = np.zeros((T, P))
    Hl = pb.H0.copy(); Hh = pb.H0.copy()
    for t in range(T):
        keep = (1 - pb.d[t])
        Hl = Hl * keep * (pb.protect_frac if pb.transfers else 1.0)
        if pb.cap_mode == "gross_arrivals":
            Hh = Hh * (1 - pb.d[t] + pb.cap) + (0 if pb.reentry_consumes else pb.r[t] * Hh)
        else:
            Hh = Hh * (1 + pb.cap)
        Hh = np.minimum(Hh, (pb.H0 + pb.A[: t + 1].sum() + pb.H0.sum()))
        lo[t], hi[t] = 0.98 * Hl, 1.02 * Hh + 2
    return lo, hi


def build(pb: Problem):
    P, T = pb.P, pb.nT
    off, nvar = _layout(pb)
    V = lambda blk, t: off[blk] + t * P + np.arange(P)
    B = _Builder()
    ones = np.ones(P)
    reserved_total, reserved_lo, reserved_hi, _ = reservation_quota(pb)
    for t in range(T):
        a = 1 - pb.d[t] + pb.r[t]
        x, zi, zo, H, s, y = V("x", t), V("zin", t), V("zout", t), V("H", t), V("s", t), V("y", t)
        # stock identity
        if t == 0:
            B.add(np.c_[H, x, zi, zo], np.c_[ones, -ones, -ones, ones], a * pb.H0, a * pb.H0)
        else:
            Hp = V("H", t - 1)
            B.add(np.c_[H, Hp, x, zi, zo], np.c_[ones, -a, -ones, -ones, ones], 0, 0)
        # pool
        B.add(np.r_[x, off["u"] + t][None], np.r_[ones, 1.0][None], pb.A[t], pb.A[t])
        if "q" in off:
            q = V("q", t)
            B.add(q[None], ones[None], reserved_total[t], reserved_total[t])
            B.add(np.c_[x, q], np.c_[ones, -ones], 0, np.inf)
        # capacity
        if pb.cap_mode == "gross_arrivals":
            coef = pb.cap - (pb.r[t] if pb.reentry_consumes else 0.0)
            if t == 0:
                B.add(np.c_[x, zi], np.c_[ones, ones], -np.inf, coef * pb.H0)
            else:
                B.add(np.c_[x, zi, V("H", t - 1)], np.c_[ones, ones, -coef], -np.inf, 0)
        else:
            if t == 0:
                B.add(H[:, None], ones[:, None], -np.inf, (1 + pb.cap) * pb.H0)
            else:
                B.add(np.c_[H, V("H", t - 1)], np.c_[ones, -(1 + pb.cap) * ones], -np.inf, 0)
        # transfers
        if pb.transfers:
            keep = 1 - pb.d[t]
            if t == 0:
                B.add(zo[:, None], ones[:, None], -np.inf, pb.tau * keep * pb.H0)
                B.add(zo[None], ones[None], -np.inf, pb.nat_budget * (keep * pb.H0).sum())
            else:
                Hp = V("H", t - 1)
                B.add(np.c_[zo, Hp], np.c_[ones, -pb.tau * keep], -np.inf, 0)
                B.add(np.r_[zo, Hp][None], np.r_[ones, -pb.nat_budget * keep][None], -np.inf, 0)
            groups = [np.arange(P)] if pb.network == "complete_76" else [np.flatnonzero(pb.region == g) for g in np.unique(pb.region)]
            for g in groups:
                B.add(np.r_[zi[g], zo[g]][None], np.r_[np.ones(len(g)), -np.ones(len(g))][None], 0, 0)
            if pb.protect_mode == "limited_drawdown":
                if t == 0:
                    B.add(H[:, None], ones[:, None], pb.protect_frac * keep * pb.H0, np.inf)
                else:
                    B.add(np.c_[H, V("H", t - 1)], np.c_[ones, -pb.protect_frac * keep], 0, np.inf)
            else:  # surplus_only: existing staff after transfers Q = (1-d)H[t-1] + zin - zout >= min(T, (1-d)H[t-1])
                # (new appointments cannot backfill outward transfers, so a below-target province has no net outflow)
                b = V("b", t)
                M = 10 * (pb.H0.max() + pb.A.sum())
                Tt = pb.T[t]
                B.add(np.c_[zi, zo, b], np.c_[ones, -ones, M * ones], 0, np.inf)          # Q >= surv - M b
                if t == 0:
                    surv = keep * pb.H0
                    B.add(np.c_[zi, zo, b], np.c_[ones, -ones, -Tt], -surv, np.inf)        # Q >= T b
                    B.add(b[:, None], (M * ones)[:, None], -np.inf, surv - Tt + M)        # b = 1 only if surv >= T
                else:
                    Hp = V("H", t - 1)
                    B.add(np.c_[Hp, zi, zo, b], np.c_[keep, ones, -ones, -Tt], 0, np.inf)
                    B.add(np.c_[Hp, b], np.c_[keep, -M * ones], Tt - M, np.inf)
        # shortfall
        B.add(np.c_[s, H], np.c_[ones, 1 / pb.T[t]], 1, np.inf)
    # tangents, restricted to the reachable shortfall range of each province-year
    lo, hi = _stock_bounds(pb)
    step = pb.tangent_step
    tangents = {}
    for t in range(T):
        smin = np.clip(1 - hi[t] / pb.T[t], 0, 1)
        smax = np.clip(1 - lo[t] / pb.T[t], 0, 1)
        s, y = V("s", t), V("y", t)
        for p in range(P):
            k0 = np.floor(smin[p] / step) * step
            k1 = np.ceil(smax[p] / step) * step
            pts = np.unique(np.r_[0.0, np.arange(k0, k1 + step / 2, step)].clip(0, 1))
            tangents[(t, p)] = pts
            B.add(np.c_[np.full(len(pts), y[p]), np.full(len(pts), s[p])],
                  np.c_[np.ones(len(pts)), -2 * pts], -pts ** 2, np.inf)
    Acon, clo, chi = B.matrix(nvar)
    lb = np.zeros(nvar); ub = np.full(nvar, np.inf)
    integ = np.zeros(nvar)
    for t in range(T):
        lb[V("x", t)] = pb.floor
        integ[V("x", t)] = 1
        if "q" in off:
            lb[V("q", t)] = reserved_lo[t]
            ub[V("q", t)] = reserved_hi[t]
            integ[V("q", t)] = 1
        integ[V("zin", t)] = 1
        integ[V("zout", t)] = 1
        ub[V("s", t)] = 1.0
        if not pb.transfers:
            ub[V("zin", t)] = 0
            ub[V("zout", t)] = 0
        if "b" in off:
            integ[V("b", t)] = 1
            ub[V("b", t)] = 1
    if pb.require_full:
        ub[off["u"]: off["u"] + T] = 0
    ub[off["mm"]] = 1e3
    return dict(A=Acon, lo=clo, hi=chi, lb=lb, ub=ub, integ=integ, off=off, nvar=nvar, V=V, tangents=tangents)


def full_vector(pb: Problem, M, x, zin, zout):
    """A complete feasible variable vector from integer decisions (used to inject a known
    feasible incumbent, e.g. the recruitment-only solution into a transfer problem)."""
    v = np.zeros(M["nvar"])
    V = M["V"]
    H = trajectory(pb, x, zin, zout)
    reserved = reserved_allocations(pb, x) if "q" in M["off"] else None
    for t in range(pb.nT):
        v[V("x", t)] = x[t]; v[V("zin", t)] = zin[t]; v[V("zout", t)] = zout[t]; v[V("H", t)] = H[t]
        if reserved is not None:v[V("q", t)] = reserved[t]
        s = np.clip(1 - H[t] / pb.T[t], 0, 1)
        v[V("s", t)] = s
        v[V("y", t)] = [max(2 * a * s[p] - a * a for a in M["tangents"][(t, p)]) for p in range(pb.P)]
        v[M["off"]["Ht"] + t] = H[t].sum()
        v[M["off"]["u"] + t] = pb.A[t] - x[t].sum()
    return v


def distribution_rows(pb: Problem, M):
    """e[p,t] >= |H[p,t] - w[p,t] sum_q H[q,t]|  (added only for the distribution stage)."""
    P, T = pb.P, pb.nT
    V = M["V"]
    B = _Builder()
    ones = np.ones(P)
    for t in range(T):
        H, e = V("H", t), V("e", t)
        ht = M["off"]["Ht"] + t
        B.add(np.r_[ht, H][None], np.r_[1.0, -ones][None], 0, 0)
        w = pb.w[t]
        B.add(np.c_[e, H, np.full(P, ht)], np.c_[ones, -ones, w], 0, np.inf)
        B.add(np.c_[e, H, np.full(P, ht)], np.c_[ones, ones, -w], 0, np.inf)
    return B.matrix(M["nvar"])


def _objective(pb, M, kind):
    P, T = pb.P, pb.nT
    c = np.zeros(M["nvar"])
    V = M["V"]
    if kind == "placement":
        c[M["off"]["u"]: M["off"]["u"] + T] = 1
    elif kind == "shortfall":
        for t in range(T):
            c[V("y", t)] = pb.w[t] * pb.discount ** t
    elif kind == "distribution":
        for t in range(T):
            c[V("e", t)] = 1 / pb.T[t].sum()
    elif kind == "operational":
        for t in range(T):
            c[V("zout", t)] = 1.0
    return c


def _solve(pb, M, c, extra=None, integral=True, time_limit=None):
    """extra: list of (row vector, lo, hi) or (sparse matrix, lo array, hi array)."""
    A, lo, hi = M["A"], M["lo"], M["hi"]
    if extra:
        mats, los, his = [A], [lo], [hi]
        for r in extra:
            if sp.issparse(r[0]):
                mats.append(r[0]); los.append(np.asarray(r[1])); his.append(np.asarray(r[2]))
            else:
                mats.append(sp.csr_matrix(np.asarray(r[0])[None])); los.append(np.array([r[1]])); his.append(np.array([r[2]]))
        A = sp.vstack(mats).tocsr()
        lo = np.concatenate(los)
        hi = np.concatenate(his)
    t0 = time.time()
    res = milp(c, constraints=LinearConstraint(A, lo, hi), integrality=M["integ"] if integral else None,
               bounds=Bounds(M["lb"], M["ub"]),
               options=dict(mip_rel_gap=pb.mip_rel_gap, time_limit=time_limit or pb.time_limit, presolve=True))
    return res, time.time() - t0


def maximin_rows(pb: Problem, M):
    """mm <= H[p,t] / T[p,t] for every province-year."""
    B = _Builder()
    V = M["V"]
    for t in range(pb.nT):
        H = V("H", t)
        B.add(np.c_[np.full(pb.P, M["off"]["mm"]), H], np.c_[np.ones(pb.P), -1 / pb.T[t]], -np.inf, 0)
    return B.matrix(M["nvar"])


def net_churn(zin, zout):
    """Remove simultaneous inbound and outbound transfers of one province-year.  Exact: the
    closing stock, every cap and every protection constraint are unchanged or relaxed."""
    m = np.minimum(zin, zout)
    return zin - m, zout - m, int(m.sum())


def _l1_reference(pb, M, ref):
    """Extra variables are avoided by bounding: minimise sum |x - ref| via the e-block trick is
    not available, so solve with a dedicated auxiliary formulation."""
    P, T = pb.P, pb.nT
    nvar0 = M["nvar"]
    npos = P * T
    A = sp.hstack([M["A"], sp.csr_matrix((M["A"].shape[0], 2 * npos))]).tocsr()
    rows, cols, vals = [], [], []
    k = 0
    for t in range(T):
        for p in range(P):
            xv = M["V"]("x", t)[p]
            rows += [k, k, k]; cols += [xv, nvar0 + t * P + p, nvar0 + npos + t * P + p]; vals += [1, -1, 1]
            k += 1
    E = sp.csr_matrix((vals, (rows, cols)), shape=(k, nvar0 + 2 * npos))
    A = sp.vstack([A, E]).tocsr()
    lo = np.r_[M["lo"], ref.ravel()]
    hi = np.r_[M["hi"], ref.ravel()]
    lb = np.r_[M["lb"], np.zeros(2 * npos)]
    ub = np.r_[M["ub"], np.full(2 * npos, np.inf)]
    integ = np.r_[M["integ"], np.zeros(2 * npos)]
    c = np.r_[np.zeros(nvar0), np.ones(2 * npos)]
    t0 = time.time()
    res = milp(c, constraints=LinearConstraint(A, lo, hi), integrality=integ, bounds=Bounds(lb, ub),
               options=dict(mip_rel_gap=pb.mip_rel_gap, time_limit=pb.time_limit))
    if res.x is not None:
        res.x = res.x[:nvar0]
    return res, time.time() - t0


@dataclass
class Solution:
    status: str
    x: np.ndarray | None = None
    zin: np.ndarray | None = None
    zout: np.ndarray | None = None
    H: np.ndarray | None = None
    u: np.ndarray | None = None
    stages: list = field(default_factory=list)
    diagnostics: dict = field(default_factory=dict)


def _extract(pb, M, xv):
    V = M["V"]
    T = pb.nT
    get = lambda b: np.array([xv[V(b, t)] for t in range(T)])
    x, zi, zo = (np.round(get(b)).astype(int) for b in ("x", "zin", "zout"))
    u = np.round(xv[M["off"]["u"]: M["off"]["u"] + T], 6)
    return x, zi, zo, u


def trajectory(pb: Problem, x, zin, zout):
    """Expected stock path implied by integer decisions (identical transition to the MILP)."""
    H = np.zeros((pb.nT, pb.P))
    Hp = pb.H0.astype(float)
    for t in range(pb.nT):
        H[t] = (1 - pb.d[t] + pb.r[t]) * Hp + x[t] + zin[t] - zout[t]
        Hp = H[t]
    return H


def objective_exact(pb: Problem, H):
    s = np.clip(1 - H / pb.T, 0, None)
    return float((pb.w * s ** 2 * (pb.discount ** np.arange(pb.nT))[:, None]).sum())


def imbalance(pb: Problem, H):
    tot = H.sum(1, keepdims=True)
    return float((np.abs(H - pb.w * tot).sum(1) / pb.T.sum(1)).sum())


def solve(pb: Problem, objective: str = "lexicographic", incumbent=None) -> Solution:
    """objective='lexicographic' (placement, shortfall, distribution, operational) or
    'closest_to_reference' (min sum |x - reference_x| subject to every hard constraint)."""
    diag = dict(label=pb.label)
    if pb.population_reserved_share:
        total, _, _, _ = reservation_quota(pb)
        diag["population_reserved_share"] = pb.population_reserved_share
        diag["population_reserved_total_by_year"] = total.tolist()
        diag["population_reservation_method"] = "integer floor/ceiling population quotas; national total rounded half up; universal floor overlaps; all caps remain hard"
    if (pb.A < pb.P * pb.floor).any():
        yrs = [pb.years[i] for i in np.flatnonzero(pb.A < pb.P * pb.floor)]
        diag["floor_infeasible_years"] = yrs
        diag["floor_shortfall"] = float((pb.P * pb.floor - pb.A).clip(min=0).max())
        return Solution(status="infeasible_under_selected_constraints", diagnostics=diag)
    M = build(pb)
    diag["n_var"], diag["n_con"] = M["nvar"], M["A"].shape[0]
    diag["n_int"] = int(M["integ"].sum())
    stages = []
    if objective == "closest_to_reference":
        res, sec = _l1_reference(pb, M, pb.reference_x)
        diag["initial_solver_status"], diag["initial_solver_message"] = int(res.status), str(res.message)
        if res.status not in (0, 1) or res.x is None:
            return Solution(status="infeasible_under_selected_constraints", diagnostics=diag | {"message": res.message})
        stages.append(dict(stage="closest_to_reference", status=int(res.status), objective=float(res.fun),
                           mip_gap=float(getattr(res, "mip_gap", np.nan) or 0), seconds=sec))
        xv = res.x
    else:
        extra = []
        if pb.stages and pb.stages[0] == "maximin":
            cm = np.zeros(M["nvar"]); cm[M["off"]["mm"]] = -1.0
            mrows = maximin_rows(pb, M)
            r0, s0 = _solve(pb, M, cm, [mrows])
            diag["initial_solver_status"], diag["initial_solver_message"] = int(r0.status), str(r0.message)
            if r0.x is None:
                return Solution(status="infeasible_under_selected_constraints", diagnostics=diag | {"message": r0.message})
            m_star = -float(r0.fun)
            stages.append(dict(stage="maximin", status=int(r0.status), objective=m_star,
                               mip_gap=float(getattr(r0, "mip_gap", np.nan) or 0), seconds=s0))
            e = np.zeros(M["nvar"]); e[M["off"]["mm"]] = 1.0
            extra = [mrows, (e, m_star * (1 - pb.rel_tol) - pb.abs_tol, np.inf)]
        res, sec = _solve(pb, M, _objective(pb, M, "shortfall"), extra or None)
        diag["initial_solver_status"], diag["initial_solver_message"] = int(res.status), str(res.message)
        if res.x is None:
            # full placement impossible: find the minimum unplaced pool (diagnostic, kept separate)
            M2 = dict(M)
            M2["ub"] = M["ub"].copy()
            M2["ub"][M["off"]["u"]: M["off"]["u"] + pb.nT] = np.inf
            r0, s0 = _solve(pb, M2, _objective(pb, M2, "placement"))
            diag["full_placement_feasible"] = False
            if r0.x is None:
                diag["message"] = "infeasible even with unplaced balance allowed"
                return Solution(status="infeasible_under_selected_constraints", diagnostics=diag, stages=[
                    dict(stage="placement", status=int(r0.status), objective=np.nan, seconds=s0)])
            u = r0.x[M["off"]["u"]: M["off"]["u"] + pb.nT]
            diag["min_unplaced_by_year"] = np.round(u, 3).tolist()
            stages.append(dict(stage="placement", status=int(r0.status), objective=float(r0.fun), seconds=s0))
            return Solution(status="infeasible_under_selected_constraints", u=np.round(u, 3), stages=stages,
                            diagnostics=diag)
        diag["full_placement_feasible"] = True
        J1 = float(res.fun)
        stages.append(dict(stage="shortfall", status=int(res.status), objective=J1,
                           mip_gap=float(getattr(res, "mip_gap", np.nan) or 0),
                           dual_bound=float(getattr(res, "mip_dual_bound", np.nan) or np.nan), seconds=sec,
                           outcome="optimal within gap" if res.status == 0 else "time limit: best incumbent"))
        xv = res.x
        cS = _objective(pb, M, "shortfall")
        if incumbent is not None:
            vi = full_vector(pb, M, *incumbent)
            Ji = float(cS @ vi)
            diag["incumbent_objective"] = Ji
            if Ji < J1:
                xv, J1 = vi, Ji
                stages[-1]["outcome"] += "; recruitment-only incumbent is better and is adopted (feasible here)"
                diag["incumbent_adopted"] = True
        extra = extra + [(cS, -np.inf, J1 * (1 + pb.rel_tol) + pb.abs_tol)]
        if "distribution" in pb.stages:
            cD = _objective(pb, M, "distribution")
            drows = distribution_rows(pb, M)
            r2, s2 = _solve(pb, M, cD, extra + [drows], time_limit=pb.secondary_time_limit)
            if r2.x is not None:
                xv = r2.x
                I2 = float(r2.fun)
                stages.append(dict(stage="distribution", status=int(r2.status), objective=I2,
                                   mip_gap=float(getattr(r2, "mip_gap", np.nan) or 0), seconds=s2,
                                   outcome="optimal within gap" if r2.status == 0 else "time limit: best incumbent"))
                extra = extra + [drows, (cD, -np.inf, I2 * (1 + pb.rel_tol) + pb.abs_tol)]
            else:
                stages.append(dict(stage="distribution", status=int(r2.status), objective=np.nan, seconds=s2,
                                   outcome="no improved incumbent within the time limit: shortfall-stage solution retained"))
        if "operational" in pb.stages and pb.transfers:
            x_, zi_, zo_, _ = _extract(pb, M, xv)
            inc_ok = False
            if incumbent is not None and zo_.sum() > 0:
                # a zero-transfer incumbent that meets the shortfall and distribution tolerances is the exact
                # optimum of the transfer-minimisation stage: adopt it without solving
                Hi = trajectory(pb, *incumbent)
                Ji = float(cS @ full_vector(pb, M, *incumbent))
                okJ = Ji <= J1 * (1 + pb.rel_tol) + pb.abs_tol
                okI = ("distribution" not in pb.stages) or not any(st_["stage"] == "distribution" and st_.get("objective") == st_.get("objective") for st_ in stages) \
                    or imbalance(pb, Hi) <= [st_["objective"] for st_ in stages if st_["stage"] == "distribution"][-1] * (1 + pb.rel_tol) + pb.abs_tol
                if okJ and okI:
                    xv = full_vector(pb, M, *incumbent)
                    inc_ok = True
                    stages.append(dict(stage="operational", status=0, objective=0.0, seconds=0.0,
                                       outcome="zero-transfer incumbent meets the earlier tolerances: exact optimum (no transfers)"))
            if zo_.sum() > 0 and not inc_ok:
                cO = _objective(pb, M, "operational")
                r3, s3 = _solve(pb, M, cO, extra, time_limit=pb.secondary_time_limit)
                if r3.x is not None and r3.fun <= zo_.sum():
                    xv = r3.x
                    stages.append(dict(stage="operational", status=int(r3.status), objective=float(r3.fun),
                                       mip_gap=float(getattr(r3, "mip_gap", np.nan) or 0), seconds=s3,
                                       outcome="optimal within gap" if r3.status == 0 else "time limit: best incumbent"))
                else:
                    stages.append(dict(stage="operational", status=int(r3.status), objective=float(zo_.sum()), seconds=s3,
                                       outcome="no improved incumbent within the time limit: previous solution retained"))
    x, zi, zo, u = _extract(pb, M, xv)
    zi, zo, netted = net_churn(zi, zo)
    diag["churn_netted_events"] = netted
    H = trajectory(pb, x, zi, zo)
    Hs = np.array([xv[M["V"]("H", t)] for t in range(pb.nT)])
    diag["stock_solver_vs_recomputed_max_abs"] = float(np.abs(Hs - H).max())
    diag["objective_tangent"] = float(sum(pb.w[t] @ xv[M["V"]("y", t)] for t in range(pb.nT)))
    diag["objective_exact"] = objective_exact(pb, H)
    diag["imbalance"] = imbalance(pb, H)
    diag["transfer_events"] = int(zo.sum())
    diag["both_in_and_out_province_years"] = int(((zi > 0) & (zo > 0)).sum())
    return Solution(status="solved", x=x, zin=zi, zout=zo, H=H, u=u, stages=stages, diagnostics=diag)


# ----------------------------------------------------------------------------- checks and flags

def check(pb: Problem, sol: Solution, tol=1e-6) -> dict:
    """Independent verification of every hard constraint on the integer decisions."""
    x, zi, zo = sol.x, sol.zin, sol.zout
    H = trajectory(pb, x, zi, zo)
    Hp = np.vstack([pb.H0[None], H[:-1]])
    out = dict(pool_conservation=bool(np.allclose(x.sum(1) + sol.u, pb.A)),
               integer=bool(all(np.issubdtype(a.dtype, np.integer) for a in (x, zi, zo))),
               floor=bool((x >= pb.floor).all()),
               nonnegative_stock=bool((H >= -tol).all()),
               transfer_balance=bool(np.allclose(zi.sum(1), zo.sum(1))))
    if pb.population_reserved_share:
        try:
            q = reserved_allocations(pb, x)
            total, lo, hi, _ = reservation_quota(pb)
            out["population_reservation"] = bool((q >= lo).all() and (q <= hi).all() and (x >= q).all() and np.array_equal(q.sum(1), total))
        except ValueError:out["population_reservation"] = False
    if pb.cap_mode == "gross_arrivals":
        lhs = x + zi + (pb.r * Hp if pb.reentry_consumes else 0)
        out["cap"] = bool((lhs <= pb.cap * Hp + 1e-6).all())
    else:
        out["cap"] = bool((H - Hp <= pb.cap * Hp + 1e-6).all())
    if pb.transfers:
        keep = (1 - pb.d) * Hp
        out["transfer_cap"] = bool((zo <= pb.tau * keep + 1e-6).all())
        out["national_budget"] = bool((zo.sum(1) <= pb.nat_budget * keep.sum(1) + 1e-6).all())
        if pb.protect_mode == "limited_drawdown":
            out["origin_protection"] = bool((H >= pb.protect_frac * keep - 1e-6).all())
        else:
            out["origin_protection"] = bool((keep + zi - zo >= np.minimum(pb.T, keep) - 1e-6).all())
        if pb.network != "complete_76":
            ok = True
            for g in np.unique(pb.region):
                m = pb.region == g
                ok &= np.allclose(zi[:, m].sum(1), zo[:, m].sum(1))
            out["regional_balance"] = bool(ok)
    out["all_ok"] = all(out.values())
    out["no_simultaneous_in_and_out"] = bool(((zi > 0) & (zo > 0)).sum() == 0)   # quality check, not a hard constraint
    return out


def binding_flags(pb: Problem, sol: Solution):
    """Province-year flags: which hard constraint binds (integer headroom < 1)."""
    x, zi, zo = sol.x, sol.zin, sol.zout
    H = trajectory(pb, x, zi, zo)
    Hp = np.vstack([pb.H0[None], H[:-1]])
    fl = {}
    fl["floor_binding"] = x == pb.floor
    if pb.cap_mode == "gross_arrivals":
        head = pb.cap * Hp - (pb.r * Hp if pb.reentry_consumes else 0) - x - zi
        fl["cap_value"] = np.floor(pb.cap * Hp - (pb.r * Hp if pb.reentry_consumes else 0) + 1e-9)
    else:
        head = pb.cap * Hp - (H - Hp)
        fl["cap_value"] = np.floor((1 + pb.cap) * Hp - (1 - pb.d + pb.r) * Hp + zo - zi + 1e-9)
    fl["cap_headroom"] = head
    fl["cap_binding"] = head < 1 - 1e-9
    if pb.transfers:
        keep = (1 - pb.d) * Hp
        fl["transfer_cap_value"] = np.floor(pb.tau * keep + 1e-9)
        fl["transfer_cap_binding"] = (zo > 0) & (pb.tau * keep - zo < 1)
        fl["protection_floor"] = pb.protect_frac * keep if pb.protect_mode == "limited_drawdown" else np.minimum(pb.T, keep)
        protected = H if pb.protect_mode == "limited_drawdown" else keep + zi - zo
        fl["protection_binding"] = (zo > 0) & (protected - fl["protection_floor"] < 1)
        fl["national_budget_binding"] = np.repeat(((pb.nat_budget * keep.sum(1) - zo.sum(1)) < 1)[:, None], pb.P, 1)
    else:
        z = np.zeros_like(x, dtype=bool)
        fl["transfer_cap_value"] = np.zeros_like(x, dtype=float)
        fl["transfer_cap_binding"] = z
        fl["protection_floor"] = np.full(x.shape, np.nan)
        fl["protection_binding"] = z
        fl["national_budget_binding"] = z
    return fl


def explanation(pb: Problem, sol: Solution, fl) -> np.ndarray:
    """A defensible reason for each province-year decision (from the binding constraints)."""
    out = np.empty(sol.x.shape, dtype=object)
    protected = reserved_allocations(pb, sol.x) if pb.population_reserved_share else None
    for t in range(pb.nT):
        for p in range(pb.P):
            parts = []
            if fl["cap_binding"][t, p]:
                parts.append("onboarding cap binds (allocation limited by the arrival/net-growth cap)")
            elif fl["floor_binding"][t, p]:
                parts.append("universal floor only (one-person minimum; deeper proportional shortfalls elsewhere take priority)")
            elif protected is not None and protected[t, p] > 0:
                parts.append(f"includes {protected[t, p]} population-protected appointments; remaining appointments follow the selected allocation objective")
            else:
                parts.append("shortfall priority (above the floor to reduce the target-weighted squared proportional shortfall)")
            if sol.zout[t, p] > 0:
                parts.append("donor of controlled transfers" + (" at the transfer cap" if fl["transfer_cap_binding"][t, p] else "")
                             + ("; origin protection binds" if fl["protection_binding"][t, p] else ""))
            if sol.zin[t, p] > 0:
                parts.append("receives controlled transfers")
            out[t, p] = "; ".join(parts)
    return out


# ----------------------------------------------------------------------------- routing

def great_circle(lat, lon):
    la, lo = np.radians(lat), np.radians(lon)
    dla = la[:, None] - la[None]
    dlo = lo[:, None] - lo[None]
    a = np.sin(dla / 2) ** 2 + np.cos(la[:, None]) * np.cos(la[None]) * np.sin(dlo / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(a))


def route(zout_t, zin_t, dist, region=None, network="complete_76"):
    """Integer transportation problem: min sum dist * f subject to supplies and demands.
    Returns a list of (origin_index, destination_index, events)."""
    O = np.flatnonzero(zout_t > 0)
    D = np.flatnonzero(zin_t > 0)
    if len(O) == 0:
        return []
    pairs = [(i, j) for i in O for j in D if i != j and (network == "complete_76" or region[i] == region[j])]
    n = len(pairs)
    c = np.array([dist[i, j] for i, j in pairs])
    rows, cols, vals, lo, hi = [], [], [], [], []
    k = 0
    for i in O:
        for q, (a, b) in enumerate(pairs):
            if a == i:
                rows.append(k); cols.append(q); vals.append(1)
        lo.append(zout_t[i]); hi.append(zout_t[i]); k += 1
    for j in D:
        for q, (a, b) in enumerate(pairs):
            if b == j:
                rows.append(k); cols.append(q); vals.append(1)
        lo.append(zin_t[j]); hi.append(zin_t[j]); k += 1
    A = sp.csr_matrix((vals, (rows, cols)), shape=(k, n))
    res = milp(c, constraints=LinearConstraint(A, lo, hi), integrality=np.ones(n), bounds=Bounds(0, np.inf))
    if res.x is None:
        raise RuntimeError("transfer routing infeasible on the declared network")
    f = np.round(res.x).astype(int)
    return [(pairs[q][0], pairs[q][1], int(f[q])) for q in range(n) if f[q] > 0]


# ----------------------------------------------------------------------------- benchmark heuristic

def greedy(pb: Problem):
    """Transparent benchmark: each year give the floor, then assign the remaining pool one
    physician at a time to the province with the largest one-year reduction of w*s^2, within
    the cap.  Exact for the myopic one-year problem; ignores future years.  Recruitment only."""
    if pb.population_reserved_share:raise ValueError("population-protected quotas require the constrained MILP, not the greedy benchmark")
    import heapq
    t0 = time.time()
    x = np.zeros((pb.nT, pb.P), int)
    Hp = pb.H0.astype(float)
    unplaced = np.zeros(pb.nT)
    for t in range(pb.nT):
        base = (1 - pb.d[t] + pb.r[t]) * Hp
        if pb.cap_mode == "gross_arrivals":
            capx = np.floor(pb.cap * Hp - (pb.r[t] * Hp if pb.reentry_consumes else 0) + 1e-9)
        else:
            capx = np.floor((1 + pb.cap) * Hp - base + 1e-9)
        xt = np.full(pb.P, pb.floor)
        rem = pb.A[t] - xt.sum()
        T_, w = pb.T[t], pb.w[t]

        def gain(p, k):
            s0 = max(0.0, 1 - (base[p] + k) / T_[p]); s1 = max(0.0, 1 - (base[p] + k + 1) / T_[p])
            return w[p] * (s0 ** 2 - s1 ** 2)
        h = [(-gain(p, xt[p]), p) for p in range(pb.P) if xt[p] < capx[p]]
        heapq.heapify(h)
        while rem > 0 and h:
            g, p = heapq.heappop(h)
            xt[p] += 1
            rem -= 1
            if xt[p] < capx[p]:
                heapq.heappush(h, (-gain(p, xt[p]), p))
        unplaced[t] = rem
        x[t] = xt
        Hp = base + xt
    z = np.zeros_like(x)
    H = trajectory(pb, x, z, z)
    return dict(x=x, H=H, unplaced=unplaced, objective_exact=objective_exact(pb, H), seconds=time.time() - t0)


def apportion(total: int, shares: np.ndarray) -> np.ndarray:
    """Largest-remainder (Hamilton) apportionment; preserves the integer total exactly."""
    q = total * shares / shares.sum()
    f = np.floor(q).astype(int)
    rem = int(total - f.sum())
    order = np.argsort(-(q - f), kind="stable")
    f[order[:rem]] += 1
    return f
