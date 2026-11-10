"""
Build everything the API needs from the raw BTS On-Time Reporting files.

    python backend/prepare.py --data data/

Reads every .csv / .xlsx in the data folder, then:
  1. Cleans the flights (operated flights only) and builds the delay target
     exactly like logRegPlane.py (any delay-cause column present => delayed 15+ min).
  2. Trains the logistic-regression models from logRegPlane.py on all months but the
     latest, evaluates them on the latest month, then refits the chosen model on
     everything and saves it.
  3. Pre-aggregates delay statistics (airports, airlines, routes) so the dashboard
     never has to scan millions of rows at request time.

Outputs go to backend/artifacts/.
"""
import argparse
import glob
import json
import os

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "artifacts")

USECOLS = [
    "FL_DATE", "OP_UNIQUE_CARRIER", "ORIGIN", "ORIGIN_AIRPORT_ID", "DEST_AIRPORT_ID",
    "CRS_DEP_TIME",
    "CANCELLED", "DIVERTED", "ARR_DELAY_NEW", "ARR_DEL15",
    "CARRIER_DELAY", "WEATHER_DELAY", "NAS_DELAY", "SECURITY_DELAY",
    "LATE_AIRCRAFT_DELAY",
]
CAUSE_COLS = ["CARRIER_DELAY", "WEATHER_DELAY", "NAS_DELAY", "SECURITY_DELAY",
              "LATE_AIRCRAFT_DELAY"]
CAT = ["OP_UNIQUE_CARRIER", "ORIGIN", "DEST"]
NUM = ["HOUR_SIN", "HOUR_COS"]


def read_any(path):
    if path.lower().endswith(".csv"):
        return pd.read_csv(path, usecols=USECOLS, parse_dates=["FL_DATE"])
    return pd.read_excel(path, usecols=USECOLS)


def load(data_dir):
    files = sorted(glob.glob(os.path.join(data_dir, "*.csv")))
    if not files:
        files = sorted(glob.glob(os.path.join(data_dir, "*.xlsx")))
    if not files:
        raise SystemExit(f"No .csv or .xlsx files found in {data_dir}")
    print("Loading:", *[os.path.basename(f) for f in files], sep="\n  ")
    df = pd.concat([read_any(f) for f in files], ignore_index=True)

    # The BTS export has no DEST code column, only DEST_AIRPORT_ID. Origin rows carry
    # both the ID and the IATA code, so build the ID -> code lookup from those.
    if "DEST" not in df.columns:
        id_to_code = (df[["ORIGIN_AIRPORT_ID", "ORIGIN"]].drop_duplicates()
                      .set_index("ORIGIN_AIRPORT_ID")["ORIGIN"])
        id_to_code = id_to_code[~id_to_code.index.duplicated()]
        df["DEST"] = df["DEST_AIRPORT_ID"].map(id_to_code)
        missing = df["DEST"].isna().sum()
        print(f"Mapped DEST from airport ID; {missing:,} flights to airports "
              "with no origin departures dropped")
        df = df.dropna(subset=["DEST"])

    # Operated flights only (cancelled / diverted have no arrival delay)
    df = df[(df["CANCELLED"] == 0) & (df["DIVERTED"] == 0)].copy()

    # Target: same definition as logRegPlane.py (BTS only fills the cause columns
    # when the flight arrived 15+ minutes late).
    df["DELAYED"] = df[CAUSE_COLS].notna().any(axis=1).astype(int)
    agree = (df["DELAYED"] == df["ARR_DEL15"].fillna(0).astype(int)).mean()
    print(f"Target agrees with BTS ARR_DEL15 on {agree:.4%} of flights")

    # Features use the SCHEDULED departure time. Actual DEP_TIME is not known
    # when a traveller is choosing a flight (the data-leakage note in the script).
    hhmm = df["CRS_DEP_TIME"].astype(int).astype(str).str.zfill(4)
    df["DEP_HOUR"] = hhmm.str[:2].astype(int) % 24
    df["HOUR_SIN"] = np.sin(2 * np.pi * df["DEP_HOUR"] / 24)
    df["HOUR_COS"] = np.cos(2 * np.pi * df["DEP_HOUR"] / 24)
    df["DOW"] = df["FL_DATE"].dt.dayofweek.astype(str)  # 0=Mon .. 6=Sun
    df["MONTH"] = df["FL_DATE"].dt.to_period("M").astype(str)
    return df


def make_model(cats, nums):
    pre = ColumnTransformer(
        [("cat", OneHotEncoder(handle_unknown="ignore", min_frequency=30), cats)]
        + ([("num", "passthrough", nums)] if nums else [])
    )
    return Pipeline([("pre", pre),
                     ("lr", LogisticRegression(class_weight="balanced", max_iter=1000))])


def aggregate(df, keys):
    g = df.groupby(keys, observed=True)
    out = g.agg(flights=("DELAYED", "size"),
                delayed=("DELAYED", "sum"),
                sum_delay=("ARR_DELAY_NEW", "sum")).reset_index()
    # minutes of delay among delayed flights only
    dd = df[df["DELAYED"] == 1].groupby(keys, observed=True)["ARR_DELAY_NEW"].sum()
    out = out.merge(dd.rename("sum_delay_delayed").reset_index(), on=keys, how="left")
    out["sum_delay_delayed"] = out["sum_delay_delayed"].fillna(0.0)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(HERE, "..", "data"))
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    df = load(args.data)
    months = sorted(df["MONTH"].unique())
    test_month = months[-1]
    train = df[df["MONTH"] != test_month]
    test = df[df["MONTH"] == test_month]
    print(f"Train months {months[:-1]} ({len(train):,} flights), "
          f"test month {test_month} ({len(test):,} flights)")
    print("Train delay rate:", round(train["DELAYED"].mean(), 4),
          "| Test delay rate:", round(test["DELAYED"].mean(), 4))

    variants = {
        "A": ("carrier + origin + destination", CAT, []),
        "B": ("A + scheduled departure hour", CAT, NUM),
        "C": ("B + day of week", CAT + ["DOW"], NUM),
    }
    base = DummyClassifier(strategy="prior").fit(train[CAT], train["DELAYED"])
    metrics = {"test_month": test_month,
               "train_flights": int(len(train)), "test_flights": int(len(test)),
               "train_delay_rate": float(train["DELAYED"].mean()),
               "test_delay_rate": float(test["DELAYED"].mean()),
               "baseline_roc_auc": float(roc_auc_score(
                   test["DELAYED"], base.predict_proba(test[CAT])[:, 1])),
               "models": {}}
    for key, (name, cats, nums) in variants.items():
        m = make_model(cats, nums).fit(train[cats + nums], train["DELAYED"])
        p = m.predict_proba(test[cats + nums])[:, 1]
        roc = roc_auc_score(test["DELAYED"], p)
        pr = average_precision_score(test["DELAYED"], p)
        metrics["models"][key] = {"name": name, "roc_auc": round(roc, 4),
                                  "pr_auc": round(pr, 4)}
        print(f"Model {key} ({name}): ROC-AUC {roc:.4f}  PR-AUC {pr:.4f}")

    # Ship model C when it is at least as good as B on the held-out month.
    best = "C" if metrics["models"]["C"]["roc_auc"] >= metrics["models"]["B"]["roc_auc"] else "B"
    name, cats, nums = variants[best]
    print(f"Refitting Model {best} on all months and saving")
    final = make_model(cats, nums).fit(df[cats + nums], df["DELAYED"])
    metrics["served_model"] = best
    metrics["features"] = cats + nums
    joblib.dump({"model": final, "cats": cats, "nums": nums, "variant": best},
                os.path.join(OUT, "model.joblib"), compress=3)

    # ---- aggregates for the Top-N chart ----
    df["HOUR"] = df["DEP_HOUR"]
    tables = {
        "airport_origin": aggregate(df, ["ORIGIN"]),
        "airport_dest": aggregate(df, ["DEST"]),
        "airline": aggregate(df, ["OP_UNIQUE_CARRIER"]),
        "route": aggregate(df, ["OP_UNIQUE_CARRIER", "ORIGIN", "DEST"]),
    }
    for k, t in tables.items():
        t.to_parquet(os.path.join(OUT, f"agg_{k}.parquet"), index=False)
        print(f"agg_{k}: {len(t):,} rows")

    # Lookups
    pair_counts = tables["route"].groupby(["ORIGIN", "DEST"])["flights"].sum().reset_index()
    pair_counts.to_parquet(os.path.join(OUT, "pair_counts.parquet"), index=False)
    metrics["date_min"] = str(df["FL_DATE"].min().date())
    metrics["date_max"] = str(df["FL_DATE"].max().date())
    metrics["total_flights"] = int(len(df))
    metrics["overall_delay_rate"] = float(df["DELAYED"].mean())
    metrics["carriers"] = sorted(df["OP_UNIQUE_CARRIER"].unique().tolist())
    with open(os.path.join(OUT, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)
    print("Done.")


if __name__ == "__main__":
    main()
