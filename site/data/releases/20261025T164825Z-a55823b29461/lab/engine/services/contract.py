"""Common contract of the data-ready service modules (next-phase plan §4.4, §8.3).

A module declares
  * datasets it can use - each a schema (columns, types, units, keys, allowed values);
  * parameters of three kinds:
        estimated   computed from an uploaded dataset when present (calibration), else a default
        assumption  expert/literature values (task times, package content) - set by the user
        policy      decision-maker choices (coverage targets, modality mix) - never changed by data
  * outputs.
and implements   validate -> calibrate -> project -> resources -> evaluate.

The functions here are pure (numpy/pandas only, no file access) so the same code runs natively
and in the browser Lab (Pyodide), where uploaded files never leave the user's machine.
"""
from __future__ import annotations

import hashlib
import io
import json
from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd

AGE_GROUPS = ["0-4", "5-14", "15-29", "30-44", "45-59", "60-69", "70-79", "80+"]
AGE_BOUNDS = {"0-4": (0, 4), "5-14": (5, 14), "15-29": (15, 29), "30-44": (30, 44), "45-59": (45, 59),
              "60-69": (60, 69), "70-79": (70, 79), "80+": (80, 200)}
KINDS = ("estimated", "assumption", "policy")
PROVENANCE = ("observed", "estimated", "literature", "policy", "convention", "illustrative_placeholder",
              "synthetic_demo", "user")
EVIDENCE = {"synthetic_demo": "ข้อมูลสังเคราะห์สำหรับสาธิต — ไม่ใช่ค่าประมาณของประเทศไทย",
            "defaults_only": "ใช้ค่าตั้งต้นเชิงตัวอย่างทั้งหมด — ไม่ใช่ค่าประมาณ",
            "user_data_unvalidated": "ปรับฐานจากข้อมูลที่ผู้ใช้อัปโหลด — ยังไม่ได้ตรวจสอบกับข้อมูลอิสระ"}


@dataclass
class Col:
    name: str
    type: str                                   # int | float | str | age_group | prov_code
    unit: str = ""
    required: bool = True
    allowed: list | None = None
    min: float | None = None
    max: float | None = None
    description: str = ""


@dataclass
class DatasetSpec:
    id: str
    label_th: str
    label_en: str
    columns: list[Col]
    keys: list[str]
    calibrates: list[str]                       # parameter ids estimated from this dataset
    description: str = ""
    required_for_run: bool = False              # a run without it is refused (absolute counts need it)

    def template(self) -> str:
        """Header-only CSV template users can download."""
        return ",".join(c.name for c in self.columns) + "\n"


@dataclass
class Param:
    id: str
    label_th: str
    kind: str
    default: object
    unit: str = ""
    provenance: str = "illustrative_placeholder"
    estimated_from: str | None = None
    bounds: tuple | None = None
    description: str = ""


@dataclass
class ModuleSpec:
    id: str
    label_th: str
    label_en: str
    version: str
    status: str                                 # draft_structure | reviewed
    question_th: str
    datasets: list[DatasetSpec]
    params: list[Param]
    outputs: list[str]
    references: list[str] = field(default_factory=list)

    def dataset(self, did: str) -> DatasetSpec:
        return next(d for d in self.datasets if d.id == did)

    def describe(self) -> dict:
        d = asdict(self)
        for ds, spec in zip(d["datasets"], self.datasets):
            ds["template_csv"] = spec.template()
        return d


# ----------------------------------------------------------------------------- datasets

def read_csv_text(text: str) -> pd.DataFrame:
    d = pd.read_csv(io.StringIO(text.lstrip("﻿")))
    d.columns = [str(c).strip() for c in d.columns]
    return d


def text_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def validate_dataset(spec: DatasetSpec, df: pd.DataFrame, provinces: list[int] | None = None) -> dict:
    """Schema checks.  Never coerces a missing value to zero; returns errors, warnings and the typed frame."""
    errs, warns = [], []
    missing = [c.name for c in spec.columns if c.required and c.name not in df.columns]
    if missing:
        return dict(ok=False, errors=[f"ขาดคอลัมน์ {missing}"], warnings=[], table=None)
    extra = [c for c in df.columns if c not in {x.name for x in spec.columns}]
    if extra:
        warns.append(f"ไม่ใช้คอลัมน์ {extra}")
    out = pd.DataFrame(index=df.index)
    for c in spec.columns:
        if c.name not in df.columns:
            continue
        s = df[c.name]
        if c.type in ("int", "float", "prov_code"):
            v = pd.to_numeric(s, errors="coerce")
            if v.isna().any() and c.required:
                errs.append(f"{c.name}: {int(v.isna().sum())} ค่าว่างหรือไม่ใช่ตัวเลข")
            if c.min is not None and (v < c.min).any():
                errs.append(f"{c.name}: มีค่าน้อยกว่า {c.min}")
            if c.max is not None and (v > c.max).any():
                errs.append(f"{c.name}: มีค่ามากกว่า {c.max}")
            if c.type == "prov_code" and provinces is not None:
                bad = sorted(set(v.dropna().astype(int)) - set(provinces) - {0})
                if bad:
                    errs.append(f"{c.name}: รหัสจังหวัดที่ไม่รู้จัก {bad[:10]}")
            out[c.name] = v.astype(int) if c.type in ("int", "prov_code") and not v.isna().any() else v
        else:
            v = s.astype(str).str.strip()
            allowed = AGE_GROUPS if c.type == "age_group" else c.allowed
            if allowed is not None:
                bad = sorted(set(v) - set(map(str, allowed)))
                if bad:
                    errs.append(f"{c.name}: ค่าที่ไม่รู้จัก {bad[:10]} (ใช้ได้: {allowed})")
            if (v == "").any() or s.isna().any():
                errs.append(f"{c.name}: มีค่าว่าง")
            out[c.name] = v
    keys = [k for k in spec.keys if k in out.columns]
    if keys and out.duplicated(keys).any():
        errs.append(f"คีย์ซ้ำ {int(out.duplicated(keys).sum())} แถว ({keys})")
    if len(out) == 0:
        errs.append("ไม่มีข้อมูล")
    return dict(ok=not errs, errors=errs, warnings=warns, table=None if errs else out)


# ----------------------------------------------------------------------------- parameters

def resolve_params(spec: ModuleSpec, calibrated: dict, overrides: dict) -> pd.DataFrame:
    """One row per parameter with its value and source.  Precedence: user override > calibrated >
    default.  A policy parameter is never replaced by calibration."""
    rows = []
    for p in spec.params:
        value, source, prov, note = p.default, "default", p.provenance, ""
        if p.kind == "estimated" and p.id in calibrated:
            value, source, prov, note = calibrated[p.id]["value"], calibrated[p.id]["source"], \
                calibrated[p.id].get("provenance", "estimated"), calibrated[p.id].get("note", "")
        if p.id in overrides:
            value, source, prov, note = overrides[p.id], "user", "user", "ผู้ใช้กำหนด"
        rows.append(dict(id=p.id, label_th=p.label_th, kind=p.kind, unit=p.unit, value=value, source=source,
                         provenance=prov, note=note))
    return pd.DataFrame(rows)


def param_dict(table: pd.DataFrame) -> dict:
    return dict(zip(table.id, table.value))


def evidence_label(datasets_meta: dict, params: pd.DataFrame) -> str:
    if any(m.get("synthetic") for m in datasets_meta.values()):
        return "synthetic_demo"
    if not datasets_meta:
        return "defaults_only"
    return "user_data_unvalidated"


def shrink_ratio(observed: np.ndarray, expected: np.ndarray, prior_weight: float = 10.0) -> np.ndarray:
    """Province ratio observed/expected shrunk to 1 with a gamma prior worth `prior_weight` expected
    events (Poisson-gamma posterior mean; a convention, reported in the calibration table)."""
    return (np.asarray(observed, float) + prior_weight) / (np.asarray(expected, float) + prior_weight)


def to_records(df: pd.DataFrame) -> list[dict]:
    return json.loads(df.to_json(orient="records", force_ascii=False))
