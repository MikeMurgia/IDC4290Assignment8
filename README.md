# Flight Delay Dashboard (Assignment 8)

An interactive React + FastAPI data product built on the BTS On-Time Reporting data (Jan–Mar 2026, ~1.6M flights) and the logistic-regression model from `logRegPlane.py`.

1. **Predict a flight:** choose airline, origin, destination, date and scheduled departure time and get the probability the flight arrives 15+ minutes late.
2. **Top N chart:** most delayed airports (departures or arrivals), airlines or routes. Change N, rank by average delay / % delayed / flight count, and filter by min/max flights (default min 5), min % delayed and min average delay. Chart and table views.
3. **Map:** shows the predicted flight (inputs + predicted risk). Selecting a bar in the chart, or entering a flight in the form, runs the model and updates the map. Top-N airports/routes appear as fainter context marks and are clickable too.

## Run it

```bash
pip install -r backend/requirements.txt


# NOT NECESSARY, only needed to be ran once, artifacts were pushed
# Put the three BTS files (.csv or .xlsx) in data/, then train + aggregate (~1 min)
python backend/prepare.py --data data/

# 1. Build the React app
cd frontend && npm install && npm run build && cd ..

# 2. Serve API + app on http://localhost:8000
uvicorn backend.app:app --port 8000
```

Development with hot reload: run `uvicorn backend.app:app --port 8000` and `npm run dev` in `frontend/` (Vite proxies `/api` to port 8000, app at http://localhost:5173).

`backend/artifacts/` (trained model + aggregates, ~200 KB) is committed so the app runs without the raw data; rerun `prepare.py` to refresh it.

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/predict` | `{carrier, origin, dest, date, time}` -> delay probability, risk label, comparison to the average flight, data confidence, resolved airport coordinates |
| `GET /api/top` | `group` (airports/airlines/routes), `role` (origin/dest), `n`, `sort`, `min_flights` (default 5), `max_flights`, `min_pct_delayed`, `min_avg_delay` |
| `GET /api/meta` | airlines, airports with coordinates, date range, model metrics |
| `GET /docs` | interactive OpenAPI docs |

## Model and data notes

- **Target** is identical to `logRegPlane.py` (a delay-cause column is present, i.e. arrival 15+ min late); it matches BTS `ARR_DEL15` on 100% of flights. Cancelled and diverted flights are excluded.
- **Scheduled departure time (`CRS_DEP_TIME`) replaces actual `DEP_TIME`.** The script's own comment flags `DEP_TIME` as leakage, and a traveller choosing a flight only knows the schedule.
- **Day of week added (Model C).** Held-out March results (trained on Jan+Feb): Model A ROC-AUC 0.582, Model B (repo model with hour) 0.632, Model C (+ day of week) 0.634. Model C is served, refit on all three months.
- **Probabilities are prior-corrected.** `class_weight="balanced"` makes raw outputs behave as if 50% of flights were delayed (a typical flight scored ~70%). The API shifts the logit by the real base rate (21.8%) so outputs read as true probabilities. This does not change ranking or AUC.
- **Destination codes:** the exported workbooks contain `DEST_AIRPORT_ID` but no `DEST` column, so `prepare.py` maps IDs to IATA codes using the origin columns (all 346 airports mapped).
- The model uses airline, route, hour and weekday only. Weather and aircraft rotations are not in the data, so treat it as a risk estimate (ROC-AUC ~0.63), not a forecast.

## Design for scale

- The model loads once at startup and predicts in milliseconds; no raw data is read at request time.
- All Top-N views come from small pre-aggregated tables (largest is ~10k rows), so filter/sort requests are sub-millisecond and the dataset can grow to years of flights without changing request cost.
- Frontend debounces inputs and cancels stale requests; the API is stateless, so it can run behind multiple workers (`uvicorn --workers N`) or in a container.

## Known limits

- With the default minimum of 5 flights, the top of the delay ranking is dominated by low-volume routes and airports. Raise **Min flights** to see statistically stable results.
- Map tiles load from OpenStreetMap and need internet access in the browser.
