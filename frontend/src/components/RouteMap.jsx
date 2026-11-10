import React, { useEffect, useMemo } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { fmtPct, greatCircle, seqColor } from "../geo.js";

function FitTo({ points, k }) {
  const map = useMap();
  useEffect(() => {
    if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 7 });
  }, [k]); // eslint-disable-line
  return null;
}

export default function RouteMap({ prediction, topData, airports, focusCodes, onSelectRow }) {
  const rows = topData?.rows ?? [];
  const group = topData?.group;

  const coords = (code) => airports.get(code);

  // Context layer: the chart's current top-N, coloured by average delay
  const avg = rows.map((r) => r.avg_delay);
  const [lo, hi] = [Math.min(...avg), Math.max(...avg)];
  const tone = (r) => seqColor(hi > lo ? (r.avg_delay - lo) / (hi - lo) : 0.6);

  const overlay = useMemo(() => {
    if (group === "airports")
      return rows.map((r) => ({ r, a: coords(r.id) })).filter((x) => x.a);
    if (group === "routes")
      return rows.map((r) => ({ r, a: coords(r.origin), b: coords(r.dest) })).filter((x) => x.a && x.b);
    return [];
  }, [rows, group, airports]); // eslint-disable-line

  // The predicted flight (inputs + model output)
  const route = prediction && {
    a: prediction.inputs.origin,
    b: prediction.inputs.dest,
    pts: greatCircle(prediction.inputs.origin, prediction.inputs.dest),
  };
  const mid = route ? route.pts[Math.floor(route.pts.length / 2)] : null;
  const labelIcon = prediction
    ? L.divIcon({
        className: "route-label",
        iconSize: [0, 0],
        html: `<div><span>${prediction.inputs.carrier} ${prediction.inputs.origin.code}→${prediction.inputs.dest.code} · ${prediction.inputs.time}</span><b>${fmtPct(prediction.probability)} delay risk</b></div>`,
      })
    : null;

  const overlayPts = overlay.flatMap((o) => [[o.a.lat, o.a.lon], ...(o.b ? [[o.b.lat, o.b.lon]] : [])]);
  const routePts = route ? [[route.a.lat, route.a.lon], [route.b.lat, route.b.lon]] : [];
  const focus = focusCodes.map(coords).filter(Boolean);

  return (
    <section className="card map-card">
      <div className="card-head">
        <div>
          <h2>Map</h2>
          <p className="hint">
            {prediction
              ? "Predicted flight in dark blue. Fainter marks show the chart's top results; click one to predict it."
              : "Choose a flight or click a chart bar to see its predicted delay on the map."}
          </p>
        </div>
      </div>

      <div className="map-wrap">
        <MapContainer center={[39, -98]} zoom={4} scrollWheelZoom style={{ height: "100%", width: "100%" }} worldCopyJump>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                     url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitTo points={overlayPts} k={`o:${group}:${rows.map((r) => r.id).join(",")}`} />
          <FitTo points={routePts.length ? routePts : focus.map((f) => [f.lat, f.lon])}
                 k={prediction ? `p:${prediction.inputs.carrier}${prediction.inputs.origin.code}${prediction.inputs.dest.code}` : `f:${focusCodes.join()}`} />

          {group === "routes" &&
            overlay.map(({ r, a, b }) => (
              <Polyline key={r.id} positions={greatCircle(a, b, 24)} pathOptions={{ color: tone(r), weight: 2.5, opacity: 0.75 }}
                        eventHandlers={{ click: () => onSelectRow(r, "routes", "origin") }}>
                <Tooltip sticky>{r.label} · {r.avg_delay} min avg · {r.pct_delayed}% delayed</Tooltip>
              </Polyline>
            ))}

          {group === "airports" &&
            overlay.map(({ r, a }) => (
              <CircleMarker key={r.id} center={[a.lat, a.lon]} radius={7}
                            pathOptions={{ color: "#fff", weight: 2, fillColor: tone(r), fillOpacity: 0.9 }}
                            eventHandlers={{ click: () => onSelectRow(r, "airports", topData.role) }}>
                <Tooltip>{r.label} · {r.avg_delay} min avg · {r.pct_delayed}% delayed · {r.flights.toLocaleString()} flights</Tooltip>
              </CircleMarker>
            ))}

          {!prediction &&
            focus.map((a) => (
              <CircleMarker key={a.code} center={[a.lat, a.lon]} radius={9} pathOptions={{ color: "#fff", weight: 2, fillColor: "#184f95", fillOpacity: 1 }}>
                <Tooltip permanent direction="top">{a.code}</Tooltip>
              </CircleMarker>
            ))}

          {route && (
            <>
              <Polyline positions={route.pts} pathOptions={{ color: "#184f95", weight: 4, opacity: 0.95 }} />
              {[route.a, route.b].map((a) => (
                <CircleMarker key={a.code} center={[a.lat, a.lon]} radius={9} pathOptions={{ color: "#fff", weight: 2, fillColor: "#184f95", fillOpacity: 1 }}>
                  <Tooltip permanent direction="top" offset={[0, -6]}>{a.code}</Tooltip>
                </CircleMarker>
              ))}
              <Marker position={mid} icon={labelIcon} interactive={false} />
            </>
          )}
        </MapContainer>

        {prediction && (
          <div className="map-card-overlay" aria-live="polite">
            <div className="k">Model input</div>
            <div>{prediction.inputs.airline}</div>
            <div>{prediction.inputs.origin.code} → {prediction.inputs.dest.code}</div>
            <div>{prediction.inputs.weekday}, {prediction.inputs.time}</div>
            <div className="k">Predicted</div>
            <div className="v">{fmtPct(prediction.probability)} <span>chance of 15+ min delay</span></div>
          </div>
        )}

        {overlay.length > 0 && (
          <div className="map-legend">
            <span>Avg delay</span>
            <i style={{ background: `linear-gradient(90deg, ${seqColor(0)}, ${seqColor(0.5)}, ${seqColor(1)})` }} />
            <span>{lo.toFixed(0)}–{hi.toFixed(0)} min</span>
          </div>
        )}
      </div>
    </section>
  );
}
