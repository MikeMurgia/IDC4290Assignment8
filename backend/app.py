"""
Flight Delay Dashboard API.

    uvicorn backend.app:app --reload --port 8000

Endpoints
  GET  /api/meta      airlines, airports, date range, model metrics
  POST /api/predict   delay probability for one flight
  GET  /api/top       Top-N airports / airlines / routes with filters
If frontend/dist exists it is served at / so one process is the whole product.
"""
import json
import os
from datetime import date as Date

import airportsdata
import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "artifacts")
DIST = os.path.join(HERE, "..", "frontend", "dist")

AIRLINE_NAMES = {
    "9E": "Endeavor Air", "AA": "American Airlines", "AS": "Alaska Airlines",
    "B6": "JetBlue", "C5": "CommuteAir", "DL": "Delta Air Lines", "EV": "ExpressJet",
    "F9": "Frontier Airlines", "G4": "Allegiant Air", "G7": "GoJet Airlines",
    "HA": "Hawaiian Airlines", "MQ": "Envoy Air", "NK": "Spirit Airlines",
    "OH": "PSA Airlines", "OO": "SkyWest Airlines", "QX": "Horizon Air",
    "UA": "United Airlines", "WN": "Southwest Airlines", "YV": "Mesa Airlines",
    "YX": "Republic Airways", "ZW": "Air Wisconsin",
}
EXTRA_AIRPORTS = {  # missing from the airportsdata package
    "PBI": {"name": "Palm Beach International", "city": "West Palm Beach",
            "subd": "Florida", "lat": 26.6832, "lon": -80.0956},
}

# ---------------------------------------------------------------- load once
_bundle = joblib.load(os.path.join(ART, "model.joblib"))
MODEL, CATS, NUMS = _bundle["model"], _bundle["cats"], _bundle["nums"]
with open(os.path.join(ART, "metrics.json")) as f:
    METRICS = json.load(f)

AGG = {k: pd.read_parquet(os.path.join(ART, f"agg_{k}.parquet"))
       for k in ["airport_origin", "airport_dest", "airline", "route"]}
PAIRS = pd.read_parquet(os.path.join(ART, "pair_counts.parquet"))
PAIR_COUNT = {(o, d): int(n) for o, d, n in PAIRS[["ORIGIN", "DEST", "flights"]].itertuples(index=False)}
ROUTE_COUNT = {(c, o, d): int(n) for c, o, d, n in
               AGG["route"][["OP_UNIQUE_CARRIER", "ORIGIN", "DEST", "flights"]].itertuples(index=False)}

_air = airportsdata.load("IATA")


def airport_info(code):
    a = EXTRA_AIRPORTS.get(code) or _air.get(code)
    if not a:
        return None
    return {"code": code, "name": a["name"], "city": a["city"], "state": a.get("subd", ""),
            "lat": a["lat"], "lon": a["lon"]}


AIRPORTS = {c: airport_info(c) for c in sorted(set(AGG["airport_origin"]["ORIGIN"]) |
                                               set(AGG["airport_dest"]["DEST"]))}
AIRPORTS = {c: a for c, a in AIRPORTS.items() if a}
CARRIERS = METRICS["carriers"]
OVERALL_RATE = METRICS["overall_delay_rate"]
_PRIOR_LOGIT = float(np.log(OVERALL_RATE / (1 - OVERALL_RATE)))


def calibrate(p_balanced):
    """The model is trained with class_weight='balanced' (as in logRegPlane.py), which makes
    its raw output behave as if delays were 50% of flights. Shifting the logit by the real
    base rate restores a true probability without changing the ranking or ROC/PR-AUC."""
    p = min(max(p_balanced, 1e-6), 1 - 1e-6)
    z = np.log(p / (1 - p)) + _PRIOR_LOGIT
    return float(1 / (1 + np.exp(-z)))

# Add derived metrics once so requests only filter + sort.
for _k, _t in AGG.items():
    _t["pct_delayed"] = 100 * _t["delayed"] / _t["flights"]
    _t["avg_delay"] = _t["sum_delay"] / _t["flights"]
    _t["avg_delay_when_delayed"] = (_t["sum_delay_delayed"] / _t["delayed"].where(_t["delayed"] > 0)).fillna(0)

app = FastAPI(title="Flight Delay Dashboard API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ------------------------------------------------------------------- schemas
class PredictRequest(BaseModel):
    carrier: str = Field(..., examples=["DL"])
    origin: str = Field(..., examples=["ATL"])
    dest: str = Field(..., examples=["LAX"])
    date: Date = Field(..., examples=["2026-03-15"])
    time: str = Field(..., pattern=r"^\d{1,2}:\d{2}$", examples=["17:30"],
                      description="Scheduled departure time, 24h HH:MM")


def risk_label(p):
    if p < 0.15:
        return "Low"
    if p < 0.30:
        return "Moderate"
    if p < 0.45:
        return "High"
    return "Very high"


# ----------------------------------------------------------------- endpoints
@app.get("/api/meta")
def meta():
    return {
        "airlines": [{"code": c, "name": AIRLINE_NAMES.get(c, c)} for c in CARRIERS],
        "airports": list(AIRPORTS.values()),
        "metrics": METRICS,
    }


@app.post("/api/predict")
def predict(req: PredictRequest):
    carrier, origin, dest = req.carrier.upper(), req.origin.upper(), req.dest.upper()
    if carrier not in CARRIERS:
        raise HTTPException(422, f"Unknown airline '{carrier}'")
    for code in (origin, dest):
        if code not in AIRPORTS:
            raise HTTPException(422, f"Unknown airport '{code}'")
    if origin == dest:
        raise HTTPException(422, "Origin and destination must differ")
    hh, mm = (int(x) for x in req.time.split(":"))
    if not (0 <= hh < 24 and 0 <= mm < 60):
        raise HTTPException(422, "Time must be between 00:00 and 23:59")

    row = {"OP_UNIQUE_CARRIER": carrier, "ORIGIN": origin, "DEST": dest,
           "HOUR_SIN": float(np.sin(2 * np.pi * hh / 24)),
           "HOUR_COS": float(np.cos(2 * np.pi * hh / 24)),
           "DOW": str(req.date.weekday())}
    prob = calibrate(float(MODEL.predict_proba(pd.DataFrame([row])[CATS + NUMS])[:, 1][0]))

    route_n = ROUTE_COUNT.get((carrier, origin, dest), 0)
    pair_n = PAIR_COUNT.get((origin, dest), 0)
    if route_n >= 30:
        confidence = "High: this airline flew this route often in the training data"
    elif route_n > 0:
        confidence = (f"Limited: only {route_n} flights by this airline on this route in the data, "
                      "so treat the estimate loosely")
    elif pair_n >= 30:
        confidence = "Medium: other airlines fly this route, but this airline has no history on it"
    else:
        confidence = "Low: no history for this route, so the estimate leans on airport and airline effects"
    return {
        "probability": round(prob, 4),
        "risk": risk_label(prob),
        "baseline_rate": round(OVERALL_RATE, 4),
        "relative_to_baseline": round(prob / OVERALL_RATE, 2),
        "confidence": confidence,
        "route_flights_in_data": route_n,
        "inputs": {"carrier": carrier, "airline": AIRLINE_NAMES.get(carrier, carrier),
                   "origin": AIRPORTS[origin], "dest": AIRPORTS[dest],
                   "date": req.date.isoformat(), "time": f"{hh:02d}:{mm:02d}",
                   "weekday": req.date.strftime("%A")},
        "model": {"variant": _bundle["variant"], "features": CATS + NUMS},
    }


@app.get("/api/top")
def top(
    group: str = Query("airports", pattern="^(airports|airlines|routes)$"),
    role: str = Query("origin", pattern="^(origin|dest)$",
                      description="For airports: rank by departures (origin) or arrivals (dest)"),
    n: int = Query(10, ge=1, le=100),
    min_flights: int = Query(5, ge=1),
    min_pct_delayed: float = Query(0, ge=0, le=100),
    min_avg_delay: float = Query(0, ge=0),
    max_flights: int | None = Query(None, ge=1),
    sort: str = Query("avg_delay", pattern="^(avg_delay|pct_delayed|flights)$"),
):
    if group == "airports":
        t, key = AGG["airport_origin" if role == "origin" else "airport_dest"], \
                 "ORIGIN" if role == "origin" else "DEST"
    elif group == "airlines":
        t, key = AGG["airline"], "OP_UNIQUE_CARRIER"
    else:
        t, key = AGG["route"], None

    m = (t["flights"] >= min_flights) & (t["pct_delayed"] >= min_pct_delayed) & \
        (t["avg_delay"] >= min_avg_delay)
    if max_flights:
        m &= t["flights"] <= max_flights
    sel = t[m]
    total_matching = int(len(sel))
    sel = sel.sort_values([sort, "flights"], ascending=False).head(n)

    rows = []
    for r in sel.to_dict("records"):
        item = {"flights": int(r["flights"]), "delayed": int(r["delayed"]),
                "pct_delayed": round(r["pct_delayed"], 1),
                "avg_delay": round(r["avg_delay"], 1),
                "avg_delay_when_delayed": round(r["avg_delay_when_delayed"], 1)}
        if group == "airports":
            code = r[key]
            a = AIRPORTS.get(code)
            item.update(id=code, label=code, name=a["name"] if a else code,
                        origin=code if role == "origin" else None,
                        dest=code if role == "dest" else None,
                        lat=a["lat"] if a else None, lon=a["lon"] if a else None)
        elif group == "airlines":
            code = r[key]
            item.update(id=code, label=code, name=AIRLINE_NAMES.get(code, code), carrier=code)
        else:
            c, o, d = r["OP_UNIQUE_CARRIER"], r["ORIGIN"], r["DEST"]
            item.update(id=f"{c}-{o}-{d}", label=f"{c} {o}→{d}",
                        name=f"{AIRLINE_NAMES.get(c, c)}: {o} to {d}",
                        carrier=c, origin=o, dest=d)
        rows.append(item)
    return {"group": group, "role": role, "sort": sort, "total_matching": total_matching,
            "rows": rows}


@app.get("/api/health")
def health():
    return {"status": "ok", "model": _bundle["variant"]}


if os.path.isdir(DIST):
    app.mount("/", StaticFiles(directory=DIST, html=True), name="frontend")
