import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMeta, predict } from "./api.js";
import PredictForm from "./components/PredictForm.jsx";
import ResultCard from "./components/ResultCard.jsx";
import TopChart from "./components/TopChart.jsx";
import RouteMap from "./components/RouteMap.jsx";

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function App() {
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState("");
  const [form, setForm] = useState({ carrier: "DL", origin: "ATL", dest: "LGA", date: localToday(), time: "17:30" });
  const [prediction, setPrediction] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [topData, setTopData] = useState(null);
  const ctrl = useRef(null);

  const airportMap = useMemo(() => new Map((meta?.airports ?? []).map((a) => [a.code, a])), [meta]);

  const run = useCallback(
    (f) => {
      if (f.origin === f.dest) {
        setError("Origin and destination must be different airports.");
        setPrediction(null);
        return;
      }
      if (!airportMap.has(f.origin) || !airportMap.has(f.dest)) {
        setError("Choose an origin and destination from the list.");
        return;
      }
      ctrl.current?.abort();
      ctrl.current = new AbortController();
      setLoading(true);
      setError("");
      predict({ carrier: f.carrier, origin: f.origin, dest: f.dest, date: f.date, time: f.time }, ctrl.current.signal)
        .then((p) => { setPrediction(p); setLoading(false); })
        .catch((e) => {
          if (e.name === "AbortError") return;
          setError(e.message);
          setLoading(false);
        });
    },
    [airportMap]
  );

  useEffect(() => {
    getMeta().then(setMeta).catch((e) => setMetaError(e.message));
  }, []);

  // First prediction once the airport list has loaded
  useEffect(() => {
    if (meta) run(form);
  }, [meta]); // eslint-disable-line

  // Selecting a chart bar or map mark loads it into the form and runs the model
  const select = useCallback(
    (row, group, role) => {
      const next = { ...form };
      if (group === "routes") Object.assign(next, { carrier: row.carrier, origin: row.origin, dest: row.dest });
      else if (group === "airlines") next.carrier = row.carrier;
      else if (role === "origin") next.origin = row.id;
      else next.dest = row.id;
      setForm(next);
      run(next);
    },
    [form, run]
  );

  if (metaError)
    return (
      <main className="page">
        <p className="error">Could not reach the API: {metaError}. Start it with <code>uvicorn backend.app:app --port 8000</code>.</p>
      </main>
    );
  if (!meta) return <main className="page"><p className="hint">Loading…</p></main>;

  const focusCodes = [form.origin, form.dest].filter((c) => airportMap.has(c));

  return (
    <main className="page">
      <header>
        <h1>Flight Delay Dashboard</h1>
        <p>
          Predict the risk that a flight arrives 15+ minutes late, and see which airports, airlines and routes were
          worst from {meta.metrics.date_min} to {meta.metrics.date_max} ({meta.metrics.total_flights.toLocaleString()} US flights).
        </p>
      </header>

      <div className="layout">
        <div className="col">
          <PredictForm form={form} setForm={setForm} meta={meta} onSubmit={run} loading={loading} />
          <ResultCard prediction={prediction} error={error} loading={loading} metrics={meta.metrics} />
        </div>
        <div className="col">
          <TopChart form={form} onSelect={select} onData={setTopData} />
          <RouteMap prediction={prediction} topData={topData} airports={airportMap} focusCodes={focusCodes} onSelectRow={select} />
        </div>
      </div>
    </main>
  );
}
