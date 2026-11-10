import React, { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getTop } from "../api.js";

const METRICS = {
  avg_delay: { label: "Average delay (min)", fmt: (v) => `${v.toFixed(1)} min` },
  pct_delayed: { label: "Flights delayed 15+ min (%)", fmt: (v) => `${v.toFixed(1)}%` },
  flights: { label: "Total flights", fmt: (v) => v.toLocaleString() },
};
const GROUPS = [
  ["airports", "Airports"],
  ["airlines", "Airlines"],
  ["routes", "Routes"],
];

const BAR = "#2a78d6"; // categorical slot 1: a single series
const BAR_SELECTED = "#184f95";

function Segmented({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function NumberField({ id, label, value, onChange, min = 0, max, step = 1, suffix }) {
  return (
    <div className="field compact">
      <label htmlFor={id}>{label}</label>
      <div className="with-suffix">
        <input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} value={value}
               onChange={(e) => onChange(e.target.value)} />
        {suffix && <span>{suffix}</span>}
      </div>
    </div>
  );
}

const chartLabel = (group, row) => (group === "airlines" ? row.name : row.label);
const selectedIdFor = (group, role, f) =>
  group === "routes" ? `${f.carrier}-${f.origin}-${f.dest}` : group === "airlines" ? f.carrier : role === "origin" ? f.origin : f.dest;

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="tip">
      <strong>{r.name}</strong>
      <div>{r.flights.toLocaleString()} flights</div>
      <div>{r.pct_delayed}% delayed 15+ min</div>
      <div>{r.avg_delay} min average delay</div>
      <div>{r.avg_delay_when_delayed} min when delayed</div>
      <em>Click to load into the predictor</em>
    </div>
  );
}

export default function TopChart({ form, onSelect, onData }) {
  const [group, setGroup] = useState("airports");
  const [role, setRole] = useState("origin");
  const [view, setView] = useState("chart");
  const [n, setN] = useState("10");
  const [sort, setSort] = useState("avg_delay");
  const [minFlights, setMinFlights] = useState("5"); // default minimum of 5 flights
  const [maxFlights, setMaxFlights] = useState("");
  const [minPct, setMinPct] = useState("0");
  const [minAvg, setMinAvg] = useState("0");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const nn = parseInt(n, 10), mf = parseInt(minFlights, 10);
    const mp = parseFloat(minPct), ma = parseFloat(minAvg);
    if ([nn, mf, mp, ma].some(Number.isNaN)) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      getTop(
        { group, role, n: Math.min(100, Math.max(1, nn)), min_flights: Math.max(1, mf), min_pct_delayed: mp,
          min_avg_delay: ma, max_flights: maxFlights, sort },
        ctrl.signal
      )
        .then((d) => { setData(d); setError(""); setLoading(false); onData?.({ group, role, rows: d.rows }); })
        .catch((e) => { if (e.name !== "AbortError") { setError(e.message); setLoading(false); } });
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [group, role, n, sort, minFlights, maxFlights, minPct, minAvg]); // eslint-disable-line

  const metric = METRICS[sort];
  const rows = data?.rows ?? [];
  const chartRows = useMemo(() => rows.map((r) => ({ ...r, value: r[sort], yLabel: chartLabel(group, r) })), [rows, sort, group]);
  const selId = selectedIdFor(group, role, form);
  const yWidth = group === "airlines" ? 130 : group === "routes" ? 112 : 48;

  return (
    <section className="card chart-card">
      <div className="card-head">
        <div>
          <h2>Most delayed {group === "airports" ? "airports" : group === "airlines" ? "airlines" : "routes"}</h2>
          <p className="hint">
            Based on {sort === "flights" ? "flight volume" : "arrival delays"} from Jan–Mar 2026.
            {data && ` ${data.total_matching.toLocaleString()} match your filters.`}
          </p>
        </div>
        <Segmented label="View" value={view} onChange={setView} options={[["chart", "Chart"], ["table", "Table"]]} />
      </div>

      <div className="controls">
        <Segmented label="Group by" value={group} onChange={setGroup} options={GROUPS} />
        {group === "airports" && (
          <Segmented label="Airport role" value={role} onChange={setRole} options={[["origin", "Departures"], ["dest", "Arrivals"]]} />
        )}
        <NumberField id="topn" label="Show top N" value={n} onChange={setN} min={1} max={100} />
        <div className="field compact">
          <label htmlFor="sort">Rank by</label>
          <select id="sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="avg_delay">Average delay</option>
            <option value="pct_delayed">% delayed</option>
            <option value="flights">Number of flights</option>
          </select>
        </div>
      </div>

      <details className="filters" open>
        <summary>Filters</summary>
        <div className="controls">
          <NumberField id="minf" label="Min flights" value={minFlights} onChange={setMinFlights} min={1} />
          <NumberField id="maxf" label="Max flights" value={maxFlights} onChange={setMaxFlights} min={1} />
          <NumberField id="minp" label="Min % delayed" value={minPct} onChange={setMinPct} max={100} suffix="%" />
          <NumberField id="mina" label="Min avg delay" value={minAvg} onChange={setMinAvg} step={0.5} suffix="min" />
        </div>
      </details>

      {error && <p className="error" role="alert">{error}</p>}
      {data && rows.length === 0 && (
        <p className="empty">No {group} match these filters. Lower the minimum flights or minimum delay.</p>
      )}

      {rows.length > 0 && view === "chart" && (
        <div className={loading ? "stale" : ""}>
          <div className="axis-title">{metric.label}</div>
          <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 30 + 36)}>
            <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 64, left: 4, bottom: 4 }} barCategoryGap={6}>
              <CartesianGrid horizontal={false} stroke="var(--grid)" />
              <XAxis type="number" tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={{ stroke: "var(--axis)" }} tickLine={false} />
              <YAxis type="category" dataKey="yLabel" width={yWidth} interval={0}
                     tick={{ fill: "var(--ink2)", fontSize: 12 }} axisLine={{ stroke: "var(--axis)" }} tickLine={false} />
              <Tooltip content={<Tip />} cursor={{ fill: "var(--wash)" }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} cursor="pointer" isAnimationActive={false}
                   onClick={(d) => onSelect(d.payload ?? d, group, role)}>
                {chartRows.map((r) => (
                  <Cell key={r.id} fill={r.id === selId ? BAR_SELECTED : BAR} />
                ))}
                {rows.length <= 12 && (
                  <LabelList dataKey="value" position="right" fill="var(--ink2)" fontSize={12}
                             formatter={(v) => metric.fmt(v)} />
                )}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="hint">Darker bar = the flight or airport currently loaded in the predictor.</p>
        </div>
      )}

      {rows.length > 0 && view === "table" && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th><th>{group === "routes" ? "Route" : group === "airlines" ? "Airline" : "Airport"}</th>
                <th className="num">Flights</th><th className="num">% delayed</th>
                <th className="num">Avg delay</th><th className="num">When delayed</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={r.id === selId ? "sel" : ""}>
                  <td>{i + 1}</td>
                  <td>{group === "airlines" ? r.name : `${r.label}`}<small>{group === "airports" ? r.name : ""}</small></td>
                  <td className="num">{r.flights.toLocaleString()}</td>
                  <td className="num">{r.pct_delayed}%</td>
                  <td className="num">{r.avg_delay} min</td>
                  <td className="num">{r.avg_delay_when_delayed} min</td>
                  <td><button type="button" className="link" onClick={() => onSelect(r, group, role)}>Load</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
