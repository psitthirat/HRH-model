"""Provincial responsibility indices D[m, p, t], targets, and the M5 feedback functions.

Families
    P        projected civil-register population (entitlement population as a named variant)
    S        observed-service composite: m_OP * OP visits + m_IP * AdjRW (IP days as a sensitivity),
             each projected by the benchmark chosen in a historical backtest
    N-STD    M5 standardized need proxy: P * f_M5(age, recorded morbidity, reference economy,
             reference beds/physicians/nurses, reference year) with the SAME weights as S
    N-FB     deliberately endogenous variant: N-STD times the M5-implied resource response to the
             previous simulated year's physicians, raised to the feedback strength lambda

Every composite is converted to equivalent units with a FIXED 2025 scale,
    D_pt = P_total_2025 * B_pt / sum_p B_p,2025,
so later growth of the burden is retained (never renormalized year by year).

Targets: Experiment A (common_total) gives every family the same national target path
k * P_total_t and varies only the shares; Experiment B (fixed_base_conversion) keeps k_m fixed
from 2025 so family-specific growth changes the national total too.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from chapter4 import model_design as MD

M5_BLOCKS = ["age", "disease", "gpp", "beds", "physicians", "nurses"]
SERVICE_COL = {"op_moph": "moph_op_visits", "ip_moph": "moph_ip_days", "adjrw": "sum_adjrw"}


# ----------------------------------------------------------------------------- service projection

def _non_break(years, breaks):
    return [y for y in years if y not in breaks]


def _rate_forecast(series: pd.Series, cutoff: int, h: int, method: str, breaks) -> float:
    s = series[series.index <= cutoff].dropna()
    s = s[[y for y in s.index if y not in breaks]]
    if s.empty:
        return np.nan
    if method == "constant_last":
        return float(s.iloc[-1])
    if method == "mean_last3":
        return float(s.iloc[-3:].mean())
    if method == "trend_last5_damped":
        z = s.iloc[-5:]
        if len(z) < 3:
            return float(z.iloc[-1])
        b = np.polyfit(z.index.to_numpy(float), z.to_numpy(float), 1)[0]
        phi = 0.8
        return float(z.iloc[-1] + b * sum(phi ** i for i in range(1, h + 1)))
    raise ValueError(method)


def service_backtest(S, panel: pd.DataFrame) -> pd.DataFrame:
    """Historical-cutoff backtest of practical service-rate benchmarks (retrospective, using the
    realised population of the target year).  Target years inside the COVID break are skipped
    and break years never enter a rate window."""
    cfg = S.cfg["services"]
    breaks = set(cfg["break_years"])
    rows = []
    for o in ["op_moph", "ip_moph", "adjrw"]:
        rate = panel.assign(rate=panel[SERVICE_COL[o]] / panel.population).pivot_table(
            index="prov_code", columns="year", values="rate")
        for c in cfg["backtest_cutoffs"]:
            for h in cfg["backtest_horizons"]:
                ty = c + h
                if ty in breaks or ty > S.base_year or ty not in rate.columns:
                    continue
                for m in cfg["projection_candidates"]:
                    for p in rate.index:
                        f = _rate_forecast(rate.loc[p], c, h, m, breaks)
                        obs = rate.loc[p, ty]
                        if np.isfinite(f) and np.isfinite(obs) and obs > 0:
                            rows.append(dict(outcome=o, cutoff=c, horizon=h, target_year=ty, method=m,
                                             prov_code=p, observed=obs, predicted=f))
    d = pd.DataFrame(rows)
    d["ape"] = 100 * (d.predicted - d.observed).abs() / d.observed
    return d


def backtest_summary(bt: pd.DataFrame, min_cutoffs: int = 3) -> pd.DataFrame:
    """Lowest MAPE wins, except that a method other than persistence (constant_last) needs at
    least `min_cutoffs` evaluated cutoffs; with thinner evidence persistence is kept."""
    s = (bt.groupby(["outcome", "method"]).agg(n=("ape", "size"), mape_pct=("ape", "mean"),
                                                medape_pct=("ape", "median"), cutoffs=("cutoff", "nunique"))
           .reset_index())
    s["best_mape"] = s.groupby("outcome").mape_pct.transform("min") == s.mape_pct
    s["chosen"] = False
    for o, g in s.groupby("outcome"):
        best = g[g.best_mape].iloc[0]
        pick = best.name if (best.method == "constant_last" or best.cutoffs >= min_cutoffs) else \
            g[g.method == "constant_last"].index[0]
        s.loc[pick, "chosen"] = True
    s["selection_rule"] = f"min MAPE; non-persistence needs >= {min_cutoffs} cutoffs"
    return s


def service_projection(S, panel: pd.DataFrame, pop: pd.DataFrame, method: dict[str, str]) -> pd.DataFrame:
    """Province x year service volumes 2025-2040 = forecast rate x projected civil population."""
    breaks = set(S.cfg["services"]["break_years"])
    out = pop[["year", "prov_code", "population"]].copy()
    for o in ["op_moph", "ip_moph", "adjrw"]:
        rate = panel.assign(rate=panel[SERVICE_COL[o]] / panel.population).pivot_table(
            index="prov_code", columns="year", values="rate")
        h = (out.year - S.base_year).clip(lower=1)
        out[f"rate_{o}"] = [(_rate_forecast(rate.loc[p], S.base_year, int(hh), method[o], breaks)
                             if y > S.base_year else rate.loc[p, S.base_year])
                            for p, y, hh in zip(out.prov_code, out.year, h)]
        out[f"V_{o}"] = out[f"rate_{o}"] * out.population
    return out


# ----------------------------------------------------------------------------- M5 covariates and prediction

def morbidity_path(S, panel: pd.DataFrame, years: list[int], mode: str) -> pd.DataFrame:
    """Recorded prevalence per province-year.  fixed_2025 holds the last observation;
    trend_bounded continues the 2022-2025 slope capped at a relative rate per year and bounded
    by [0.5 x, 1.5 x] the province's observed range; age_held_2025 = fixed_2025 (the age
    shares are held separately)."""
    D = MD.DISEASE
    z = panel[panel.year.between(2022, S.base_year)]
    last = z[z.year == S.base_year].set_index("prov_code")[D]
    rows = []
    cap = float(S.cfg["m5"]["morbidity_trend_cap_rel"])
    for p in last.index:
        g = z[z.prov_code == p].set_index("year")[D]
        for y in years:
            rec = {"prov_code": p, "year": y}
            for c in D:
                v0 = last.loc[p, c]
                if mode in ("fixed_2025", "age_held_2025") or y <= S.base_year:
                    v = v0
                else:
                    gg = g[c].dropna()
                    slope = np.polyfit(gg.index.to_numpy(float), gg.to_numpy(float), 1)[0] if len(gg) >= 3 else 0.0
                    slope = float(np.clip(slope, -cap * v0, cap * v0))
                    v = v0 + slope * (y - S.base_year)
                    v = float(np.clip(v, 0.5 * gg.min(), 1.5 * gg.max()))
                rec[c] = v
            rows.append(rec)
    return pd.DataFrame(rows)


def resource_paths(S, base: pd.DataFrame, pop: pd.DataFrame, beds_mode=None, nurses_mode=None, panel=None) -> pd.DataFrame:
    """Common complementary-resource paths (identical for every plan)."""
    beds_mode = beds_mode or S.cfg["m5"]["beds_path"]
    nurses_mode = nurses_mode or S.cfg["m5"]["nurses_path"]
    if panel is None:
        from chapter4 import panels as P4
        panel = P4.province_panel()[0]
    out = pop[["year", "prov_code", "population"]].merge(
        base[["prov_code", "moph_beds", "cmx_beds", "moph_professional_nurses", "gpp_lag1", "H0", "pop_civil"]],
        on="prov_code", validate="many_to_one")
    h = S.base_year - out.year
    for col, mode in [("moph_beds", beds_mode), ("cmx_beds", beds_mode), ("moph_professional_nurses", nurses_mode)]:
        if mode == "grow_recent_cagr":
            nat = panel.groupby("year")[col].sum()
            g = (nat[S.base_year] / nat[S.base_year - 5]) ** (1 / 5) - 1
            out[col] = out[col] * (1 + g) ** (-h)
        # fixed_2025_count: counts unchanged (density follows population)
    out["log_gpp_lag1"] = np.log(out.gpp_lag1)
    out["log_beds_moph_per1000"] = np.log(1000 * out.moph_beds / out.population)
    out["log_beds_cmx_per1000"] = np.log(1000 * out.cmx_beds / out.population)
    out["log_moph_professional_nurses_per100k"] = np.log(1e5 * out.moph_professional_nurses / out.population)
    # counterfactual physician path: 2025 provincial density held (the resource state behind the
    # constant-rate service benchmark)
    out["H_cf"] = out.H0 * out.population / out.pop_civil
    return out


def health_covariates(S, pop: pd.DataFrame, morb: pd.DataFrame, age_mode: str = "projected") -> pd.DataFrame:
    cov = pop[["year", "prov_code", "population", "s3_0-14", "s3_60+"]].merge(morb, on=["year", "prov_code"],
                                                                              validate="one_to_one")
    if age_mode == "held_2025":
        a = cov[cov.year == S.base_year].set_index("prov_code")[["s3_0-14", "s3_60+"]]
        for c in ["s3_0-14", "s3_60+"]:
            cov[c] = cov.prov_code.map(a[c])
    return cov


def m5_rate(pkg, outcome: str, cov: pd.DataFrame, res: pd.DataFrame | None, log_phys, year_effect: int,
            beta=None, reference: bool = False) -> np.ndarray:
    """f_M5 for each row of `cov` (health covariates).  reference=True fixes economy, beds,
    physicians and nurses at the Chapter 4 reference profile; otherwise they come from `res`
    and `log_phys` (log physicians per 100,000 of the fitted civil population)."""
    z = cov.copy()
    z["year"] = year_effect
    if reference:
        ref = pkg["ref"][outcome]
        z[MD.BED_COL[outcome]] = ref["log_beds"]
        z[MD.PHYS] = ref["log_physicians"]
        z[MD.NURS] = ref["log_nurses"]
        z["log_gpp_lag1"] = ref["log_gpp_lag1"]
    else:
        z[MD.BED_COL[outcome]] = res[MD.BED_COL[outcome]].to_numpy(float)
        z[MD.NURS] = res[MD.NURS].to_numpy(float)
        z["log_gpp_lag1"] = res["log_gpp_lag1"].to_numpy(float)
        z[MD.PHYS] = np.asarray(log_phys, float)
    X, names = MD.design(z, outcome, M5_BLOCKS, years=pkg["years"])
    assert names == pkg["names"]
    eta = X @ (pkg["beta"][outcome] if beta is None else beta)
    return np.exp(eta) if pkg.get("link", "identity") == "log" else eta


def m5_design_reference(pkg, outcome: str, cov: pd.DataFrame, year_effect: int) -> np.ndarray:
    """Design matrix of the standardized prediction (reference economy and supply), so that
    coefficient draws can be applied as X @ beta_draw."""
    z = cov.copy()
    z["year"] = year_effect
    ref = pkg["ref"][outcome]
    z[MD.BED_COL[outcome]] = ref["log_beds"]
    z[MD.PHYS] = ref["log_physicians"]
    z[MD.NURS] = ref["log_nurses"]
    z["log_gpp_lag1"] = ref["log_gpp_lag1"]
    X, names = MD.design(z, outcome, M5_BLOCKS, years=pkg["years"])
    return X


def support_flags(pkg, cov: pd.DataFrame) -> pd.DataFrame:
    sup = pkg["support"].set_index("variable")
    out = cov[["year", "prov_code"]].copy()
    cols = pkg["health_cols"]
    out["n_outside_range"] = 0
    for c in cols:
        o = (cov[c] < sup.loc[c, "min"]) | (cov[c] > sup.loc[c, "max"])
        out[f"out_{c}"] = o
        out["n_outside_range"] += o.astype(int)
    X = cov[cols].to_numpy(float)
    d = np.sqrt(np.einsum("ij,jk,ik->i", X - pkg["health_mu"], pkg["health_cov_inv"], X - pkg["health_mu"]))
    out["mahalanobis"] = d
    out["joint_outside"] = d > pkg["health_maha_max"]
    out["extrapolation"] = (out.n_outside_range > 0) | out.joint_outside
    return out


# ----------------------------------------------------------------------------- composites and indices

def weights(S, alt=None, inpatient=None):
    c = S.cfg["services"]
    m_op, m_adj = (alt if alt is not None else (c["op_minutes"], c["adjrw_minutes"]))
    return dict(m_op=float(m_op), m_ip=float(m_adj), inpatient=inpatient or c["inpatient_measure"])


def composite(V_op, V_ip, w, conv_ipdays=1.0):
    """Raw activity-time burden in minutes: m_OP*OP + m_IP*inpatient (AdjRW or IP days converted)."""
    return w["m_op"] * V_op + w["m_ip"] * conv_ipdays * V_ip


def normalize(frame: pd.DataFrame, col: str, base_year: int, P_total_2025: float) -> pd.Series:
    """Fixed-2025 equivalent units: D = P_total_2025 * B / sum_p B_p,2025 (scale fixed for all years)."""
    scale = P_total_2025 / frame.loc[frame.year == base_year, col].sum()
    return frame[col] * scale, scale


def build_indices(S, base, pop, ent, svc, pkg, morb_mode=None, age_mode="projected", w=None,
                  scenario_label="central", panel=None) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Province x year indices for P, P_ent, S and N-STD (2025-2040) + registry + support flags."""
    w = w or weights(S)
    by = S.base_year
    provs = base.prov_code
    pop = pop[pop.prov_code.isin(provs)]
    P25 = float(pop.loc[pop.year == by, "population"].sum())
    idx = pop[["year", "prov_code", "population", "s3_0-14", "s3_60+"]].copy()
    idx = idx.merge(ent[["year", "prov_code", "pop_entitlement_central"]], on=["year", "prov_code"], validate="one_to_one")
    idx = idx.merge(svc[["year", "prov_code", "V_op_moph", "V_ip_moph", "V_adjrw"]], on=["year", "prov_code"],
                    validate="one_to_one")
    conv = 1.0
    if w["inpatient"] == "ip_days":
        b25 = idx[idx.year == by]
        conv = b25.V_adjrw.sum() / b25.V_ip_moph.sum()          # minutes per IP day equal national baseline
    ip_col = "V_ip_moph" if w["inpatient"] == "ip_days" else "V_adjrw"
    idx["B_S"] = composite(idx.V_op_moph, idx[ip_col], w, conv)
    # N-STD
    if panel is None:
        from chapter4 import panels as P4
        panel = P4.province_panel()[0]
    morb = morbidity_path(S, panel, sorted(idx.year.unique()), morb_mode or S.cfg["m5"]["morbidity_path"])
    cov = health_covariates(S, pop, morb, "held_2025" if (age_mode == "held_2025" or (morb_mode == "age_held_2025")) else "projected")
    cov = idx[["year", "prov_code"]].merge(cov, on=["year", "prov_code"], validate="one_to_one")
    ref_y = int(S.cfg["m5"]["reference_year"])
    for o in ["op_moph", "ip_moph", "adjrw"]:
        r = m5_rate(pkg, o, cov, None, None, ref_y, reference=True)
        idx[f"rate_std_{o}"] = r
        idx[f"V_std_{o}"] = r * idx.population.to_numpy()
    conv_N = ((idx.loc[idx.year == by, "V_std_adjrw"].sum() / idx.loc[idx.year == by, "V_std_ip_moph"].sum())
              if w["inpatient"] == "ip_days" else 1.0)
    idx["B_N"] = composite(idx.V_std_op_moph, idx["V_std_ip_moph" if w["inpatient"] == "ip_days" else "V_std_adjrw"], w,
                           conv_N)
    idx["conv_S"], idx["conv_N"] = conv, conv_N
    idx["D_P"] = idx.population
    ent25 = idx.loc[idx.year == by, "pop_entitlement_central"].sum()
    idx["D_Pent"] = idx.pop_entitlement_central * P25 / ent25
    idx["D_S"], sS = normalize(idx, "B_S", by, P25)
    idx["D_N"], sN = normalize(idx, "B_N", by, P25)
    idx["scale_S"], idx["scale_N"] = sS, sN
    idx["positive_N"] = (idx[[f"rate_std_{o}" for o in ["op_moph", "ip_moph", "adjrw"]]] > 0).all(axis=1)
    sup = support_flags(pkg, cov)
    idx.attrs["cov"] = cov
    reg = pd.DataFrame([
        dict(family="P", index="D_P", raw="projected civil-register population (DOPA, Thai nationals with age)",
             raw_unit="persons", normalization="none (equals raw)", scale=1.0,
             dynamic_through="population projection only", fixed="-", scenario=scenario_label,
             interpretation="every resident counts equally"),
        dict(family="P_ent", index="D_Pent", raw="projected entitlement population (NHSO ratio x civil projection)",
             raw_unit="persons", normalization="x P_total_2025 / Ent_total_2025", scale=P25 / ent25,
             dynamic_through="civil projection; ratio held at 2025", fixed="province ratio NHSO/civil",
             scenario=scenario_label, interpretation="administrative entitlement, not extra residents"),
        dict(family="S", index="D_S", raw=f"{w['m_op']:g} min x OP visits + {w['m_ip']:g} min x "
             + ("IP days (converted)" if w["inpatient"] == "ip_days" else "AdjRW") + " (observed-service benchmark)",
             raw_unit="minutes (illustrative weights)", normalization="fixed 2025 scale", scale=sS,
             dynamic_through="population x benchmark service rate", fixed="2025 provincial service rates",
             scenario=scenario_label, interpretation="services entering the current system; carries access limits and referral location"),
        dict(family="N-STD", index="D_N", raw="same weights applied to M5 standardized OP and inpatient predictions",
             raw_unit="minutes (illustrative weights)", normalization="fixed 2025 scale", scale=sN,
             dynamic_through="population, age composition, recorded morbidity path",
             fixed=f"economy, beds, physicians, nurses, year effect at the Chapter 4 reference ({ref_y})",
             scenario=scenario_label, interpretation="M5_standardized_need_proxy; not normative need"),
    ])
    return idx, reg, sup


def targets(idx: pd.DataFrame, family_col: str, experiment: str, k_per_person: float, base_year: int) -> pd.Series:
    """T = k * D (fixed_base_conversion) or the common national total k * P_total_t apportioned by D shares."""
    if experiment == "fixed_base_conversion":
        # k_m = T_total_2025 / sum D_2025 = k because every D is normalised to P_total_2025
        tot25 = idx.loc[idx.year == base_year, "population"].sum()
        k_m = k_per_person * tot25 / idx.loc[idx.year == base_year, family_col].sum()
        return k_m * idx[family_col]
    common = idx.groupby("year").population.transform("sum") * k_per_person
    share = idx[family_col] / idx.groupby("year")[family_col].transform("sum")
    return common * share


# ----------------------------------------------------------------------------- feedback

class Feedback:
    """Resource-responsive M5 services and the N-FB index for one scenario.

    response='ols'       the fitted OLS M5 in levels: f_o(X_t, resources) with actual beds, nurses,
                         economy and log(1e5 (H + U)/P_t); ratios are undefined where f <= 0.
    response='positive'  the positive-mean (quasi-Poisson, log-link) M5 fitted on the same sample,
                         used only for RELATIVE responses: ratio = exp(sum_r beta_r (x_r - x_r*)),
                         anchored to the OLS standardized level (N-STD) or the observed-service
                         benchmark, so lambda = 0 reproduces them exactly.

    anchored(o, t, H, lam)  V_cf * [f(H) / f(H_cf)]^lam      (common evaluation mechanism)
    nfb_B(t, H_prev, lam)   sum_o w_o V_std,o * [f_o(H_prev) / f_o(reference)]^lam   (N-FB raw burden)
    """

    RES_TERMS = ["log_beds", "log_physicians", "log_nurses", "log_gpp_lag1"]

    def __init__(self, S, pkg, idx, res, cov, w, beta=None, response=None):
        self.S, self.pkg, self.w = S, pkg, w
        self.response = response or S.cfg["m5"]["response_model"]
        self.years = sorted(idx.year.unique())
        self.provs = np.array(sorted(idx.prov_code.unique()))
        self.idx = idx.set_index(["year", "prov_code"]).sort_index()
        self.res = res.set_index(["year", "prov_code"]).sort_index()
        self.cov = cov.set_index(["year", "prov_code"]).sort_index()
        self.U = float(S.cfg["scope"]["unmanaged_moph_component"])
        self.ref_y = int(S.cfg["m5"]["reference_year"])
        self.resp_y = int(S.cfg["m5"]["response_year_effect"])
        self.beta = beta or {o: pkg["beta"][o] for o in ["op_moph", "ip_moph", "adjrw"]}
        self.bpos = {o: np.asarray(pkg["beta_pos"][o]) for o in ["op_moph", "ip_moph", "adjrw"]}
        self.ipo = "ip_moph" if w["inpatient"] == "ip_days" else "adjrw"
        self.scale_N = float(idx.scale_N.iloc[0])
        self.w_ip_N = w["m_ip"] * float(idx.conv_N.iloc[0])
        self.w_ip_S = w["m_ip"] * float(idx.conv_S.iloc[0])
        self.jp = pkg["names"].index("log_physicians")

    def _rows(self, t):
        return self.cov.loc[t].reindex(self.provs).reset_index(), self.res.loc[t].reindex(self.provs).reset_index()

    def logdens(self, t, H):
        P = self.res.loc[t].reindex(self.provs).population.to_numpy(float)
        Hm = np.asarray(H, float) / (1 - self.U) if self.U > 0 else np.asarray(H, float)
        return np.log(1e5 * np.maximum(Hm, 1e-9) / P)

    def f(self, o, t, H, year_effect):
        cov, res = self._rows(t)
        return m5_rate(self.pkg | {"link": "identity"}, o, cov, res, self.logdens(t, H), year_effect, beta=self.beta[o])

    def f_ref(self, o, t, year_effect):
        cov, res = self._rows(t)
        return m5_rate(self.pkg | {"link": "identity"}, o, cov, res, None, year_effect, beta=self.beta[o], reference=True)

    def log_ratio_pos(self, o, t, H, H_other=None):
        """log f_pos(resources(H)) - log f_pos(reference or resources(H_other)); health terms cancel."""
        b = self.bpos[o]
        n = self.pkg["names"]
        _, res = self._rows(t)
        if H_other is not None:
            return b[self.jp] * (self.logdens(t, H) - self.logdens(t, H_other))
        ref = self.pkg["ref"][o]
        x = {"log_beds": res[MD.BED_COL[o]].to_numpy(float), "log_physicians": self.logdens(t, H),
             "log_nurses": res[MD.NURS].to_numpy(float), "log_gpp_lag1": res["log_gpp_lag1"].to_numpy(float)}
        return sum(b[n.index(k)] * (x[k] - ref[k]) for k in self.RES_TERMS)

    def H_cf(self, t):
        return self.res.loc[t].reindex(self.provs).H_cf.to_numpy(float)

    def anchored(self, o, t, H, lam):
        V_cf = self.idx.loc[t].reindex(self.provs)[f"V_{o}"].to_numpy(float)
        if self.response == "positive":
            lr = self.log_ratio_pos(o, t, H, self.H_cf(t))
            fac = np.exp(lam * lr)
            return V_cf * fac, np.exp(lr), np.ones_like(lr), fac
        num = self.f(o, t, H, self.resp_y)
        den = self.f(o, t, self.H_cf(t), self.resp_y)
        if (num <= 0).any() or (den <= 0).any():
            raise ValueError(f"non-positive OLS M5 response rate ({o}, {t}): the anchored response is undefined")
        fac = (num / den) ** lam
        return V_cf * fac, num, den, fac

    def response_minutes(self, t, H, lam):
        """Composite resource-responsive minutes (same weights as S) and the physician elasticity."""
        tot = 0.0
        el = 0.0
        for o, wgt in [("op_moph", self.w["m_op"]), (self.ipo, self.w_ip_S)]:
            V, *_ = self.anchored(o, t, H, lam)
            tot = tot + wgt * V
            el = el + wgt * V * lam * self.bpos[o][self.jp]
        return tot, el / tot

    def nfb_B(self, t, H_prev, lam):
        ix = self.idx.loc[t].reindex(self.provs)
        B = np.zeros(len(self.provs))
        num = np.zeros(len(self.provs))
        for o, wgt in [("op_moph", self.w["m_op"]), (self.ipo, self.w_ip_N)]:
            if self.response == "positive":
                V = ix[f"V_std_{o}"].to_numpy(float) * np.exp(lam * self.log_ratio_pos(o, t, H_prev))
                el = lam * self.bpos[o][self.jp]
            else:
                fr = self.f_ref(o, t, self.ref_y)
                fh = self.f(o, t, H_prev, self.ref_y)
                if (fr <= 0).any() or (fh <= 0).any():
                    bad = self.provs[(fh <= 0) | (fr <= 0)]
                    raise ValueError(f"non-positive OLS M5 prediction inside the N-FB index ({o}, year {t}, "
                                     f"provinces {bad.tolist()})")
                V = ix["population"].to_numpy(float) * fr * (fh / fr) ** lam
                el = lam * self.beta[o][self.jp] / fh
            B += wgt * V
            num += wgt * V * el
        return B, num / B

    def nfb_D(self, t, H_prev, lam):
        B, eta = self.nfb_B(t, H_prev, lam)
        return self.scale_N * B, eta
