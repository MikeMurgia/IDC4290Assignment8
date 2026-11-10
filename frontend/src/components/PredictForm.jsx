import React from "react";
import AirportPicker from "./AirportPicker.jsx";

export default function PredictForm({ form, setForm, meta, onSubmit, loading }) {
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const swap = () => setForm((f) => ({ ...f, origin: f.dest, dest: f.origin }));

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
    >
      <h2>Predict a flight</h2>
      <p className="hint">Pick a flight, or click a bar in the chart to load one.</p>

      <div className="field">
        <label htmlFor="airline">Airline</label>
        <select id="airline" value={form.carrier} onChange={(e) => set("carrier")(e.target.value)}>
          {meta.airlines.map((a) => (
            <option key={a.code} value={a.code}>
              {a.name} ({a.code})
            </option>
          ))}
        </select>
      </div>

      <div className="od">
        <AirportPicker id="origin" label="Origin" value={form.origin} onChange={set("origin")} airports={meta.airports} />
        <button type="button" className="swap" onClick={swap} aria-label="Swap origin and destination" title="Swap">
          ⇅
        </button>
        <AirportPicker id="dest" label="Destination" value={form.dest} onChange={set("dest")} airports={meta.airports} />
      </div>

      <div className="row2">
        <div className="field">
          <label htmlFor="date">Date</label>
          <input id="date" type="date" value={form.date} onChange={(e) => set("date")(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="time">Scheduled departure</label>
          <input id="time" type="time" value={form.time} onChange={(e) => set("time")(e.target.value)} required />
        </div>
      </div>

      <button className="primary" type="submit" disabled={loading}>
        {loading ? "Predicting…" : "Predict delay"}
      </button>
    </form>
  );
}
