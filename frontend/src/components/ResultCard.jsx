import React from "react";
import { fmtPct } from "../geo.js";

export default function ResultCard({ prediction, error, loading, metrics }) {
  if (error) {
    return (
      <div className="card result" role="alert">
        <h2>Delay risk</h2>
        <p className="error">{error}</p>
      </div>
    );
  }
  if (!prediction) {
    return (
      <div className="card result">
        <h2>Delay risk</h2>
        <p className="hint">{loading ? "Running the model…" : "Enter a flight to see its predicted delay risk."}</p>
      </div>
    );
  }
  const p = prediction.probability;
  const base = prediction.baseline_rate;
  const rel = prediction.relative_to_baseline;
  const inp = prediction.inputs;
  const m = metrics.models[prediction.model.variant];

  return (
    <div className={`card result ${loading ? "stale" : ""}`}>
      <h2>Delay risk</h2>
      <div className="big">
        <span className="pct">{fmtPct(p)}</span>
        <span className="risk">{prediction.risk}</span>
      </div>
      <p className="sub">
        chance this flight arrives <strong>15+ minutes late</strong>
      </p>

      <div className="meter" role="img" aria-label={`${fmtPct(p)} delay probability; average flight ${fmtPct(base)}`}>
        <div className="fill" style={{ width: `${Math.min(100, p * 100)}%` }} />
        <div className="tick" style={{ left: `${base * 100}%` }} title={`Average flight: ${fmtPct(base)}`} />
      </div>
      <div className="meter-legend">
        <span>0%</span>
        <span>tick = average flight ({fmtPct(base)})</span>
        <span>100%</span>
      </div>

      <p className="compare">
        {rel >= 1.05
          ? `${rel.toFixed(1)}× the average flight's delay rate`
          : rel <= 0.95
          ? `${(1 / rel).toFixed(1)}× less likely than the average flight`
          : "About the same as the average flight"}
      </p>

      <dl className="facts">
        <dt>Flight</dt>
        <dd>
          {inp.airline} · {inp.origin.code} → {inp.dest.code}
        </dd>
        <dt>When</dt>
        <dd>
          {inp.weekday} {inp.date} · {inp.time}
        </dd>
        <dt>History</dt>
        <dd>{prediction.confidence}</dd>
      </dl>

      <details>
        <summary>About this model</summary>
        <p className="hint">
          Logistic regression on airline, origin, destination, scheduled departure hour and day of week
          (Model {prediction.model.variant}). Trained on {metrics.total_flights.toLocaleString()} flights from{" "}
          {metrics.date_min} to {metrics.date_max}. On the held-out last month it scored ROC-AUC {m.roc_auc}
          (a baseline with no route information scores 0.5). Outputs are rebalanced to the real{" "}
          {fmtPct(base)} delay rate, so they read as true probabilities. Weather and aircraft rotations are not
          in the data, so treat this as a risk estimate.
        </p>
      </details>
    </div>
  );
}
