import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.dummy import DummyClassifier
from sklearn.metrics import (roc_auc_score, average_precision_score,
                             classification_report, confusion_matrix)

# ---- STEP 1 & 2 & 3 & 4: Reusable Preprocessing Function ----
def load_and_prep_data(filepaths):
    # Convert single string to list so we can loop through it
    if isinstance(filepaths, str):
        filepaths = [filepaths]
        
    dataframes = []
    for file in filepaths:
        df = pd.read_csv(file, dtype={"DEP_TIME": str})
        
        # Keep only flights that operated
        df = df[df["CANCELLED"] == 0].copy()
        
        # Build the target
        cause_cols = ["CARRIER_DELAY", "WEATHER_DELAY", "NAS_DELAY",
                      "SECURITY_DELAY", "LATE_AIRCRAFT_DELAY"]
        df["ARR_DEL15"] = df[cause_cols].notna().any(axis=1).astype(int)
        
        # Features (Note: DEP_TIME introduces data leakage)
        df["DEP_TIME"] = df["DEP_TIME"].fillna("0000").str.zfill(4)
        df["DEP_HOUR"] = df["DEP_TIME"].str[:2].astype(int) % 24
        df["HOUR_SIN"] = np.sin(2 * np.pi * df["DEP_HOUR"] / 24)
        df["HOUR_COS"] = np.cos(2 * np.pi * df["DEP_HOUR"] / 24)
        
        dataframes.append(df)
        
    # Combine all loaded files into one DataFrame
    return pd.concat(dataframes, ignore_index=True)

# ---- STEP 5: Load Train and Test Sets ----
# List your two training files here
train_files = ["T_ONTIME_REPORTINGJAN2026.csv", "T_ONTIME_REPORTING FEB2026.csv"] 
test_file = "T_ONTIME_REPORTINGMAR.csv"

print("Loading training data...")
df_train = load_and_prep_data(train_files)

print("Loading test data...")
df_test = load_and_prep_data(test_file)

cat_cols = ["OP_UNIQUE_CARRIER", "ORIGIN", "DEST"]
num_cols = ["HOUR_SIN", "HOUR_COS"]

X_train = df_train[cat_cols + num_cols]
y_train = df_train["ARR_DEL15"]
X_test = df_test[cat_cols + num_cols]
y_test = df_test["ARR_DEL15"]

# ---- STEP 6: Run Function ----
def run(name, cats, nums):
    X_tr = df_train[cats + nums]
    X_te = df_test[cats + nums]
    
    pre = ColumnTransformer(
        [("cat", OneHotEncoder(handle_unknown="ignore", min_frequency=30), cats)]
        + ([("num", "passthrough", nums)] if nums else []))
    
    model = Pipeline([("pre", pre),
                      ("lr", LogisticRegression(class_weight="balanced", max_iter=1000))])
    
    model.fit(X_tr, y_train)
    prob = model.predict_proba(X_te)[:, 1]
    pred = (prob >= 0.5).astype(int)
    
    print(f"\n===== {name} =====")
    print("ROC-AUC:", round(roc_auc_score(y_test, prob), 4))
    print("PR-AUC :", round(average_precision_score(y_test, prob), 4))
    print(confusion_matrix(y_test, pred))
    print(classification_report(y_test, pred, digits=3))
    return model

# ---- STEP 7: Baseline ----
base = DummyClassifier(strategy="prior").fit(X_train[cat_cols], y_train)
print("\nTrain Delay rate:", round(y_train.mean(), 4))
print("Test Delay rate:", round(y_test.mean(), 4))
print("Baseline ROC-AUC:", roc_auc_score(y_test, base.predict_proba(X_test[cat_cols])[:, 1]))

# ---- STEP 8: Fit + Evaluate ----
mA = run("Model A: carrier + origin + destination", cat_cols, [])
mB = run("Model B: A + departure hour", cat_cols, num_cols)