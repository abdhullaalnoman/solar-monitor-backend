# solar_monitor

Solar site monitoring, built the same way as `sa_monitor`: two small
processes and a PostgreSQL (TimescaleDB) database.

- `src/server.js`       — REST API (add sites, read cards and charts)
- `src/solarWorker.js`  — WebSocket ingester (the only thing that writes readings)
- `src/calc.js`         — **every formula, in one short file**
- `src/solarEngine.js`  — applies the formulas to each new reading and saves the totals

## How it works (the whole idea)

1. Every 30 s – 2 min a site sends one line:
   `solar1:12,10,12,32,4.2,1,1,gra,70`
   = `solar_code : voltage, current, battery_voltage, temperature, internal_battery_volt, psu1, psu2, operator, signal_strength`
2. The worker checks `solar1` is in `solar_list` (if not, the line is skipped), then
   - saves the raw line in **solar_device_data** (never deleted),
   - works out power = voltage × current,
   - works out the small bit of energy made since the previous line, and **adds** it to today's row in **solar_energy_daily**,
   - rewrites the one row for that site in **solar_current_status** (latest power, battery SOC, backup time).
3. The API only reads those tables. Cards read today's row + the status row. Charts read `solar_energy_daily` (daily / monthly) or `solar_device_data` (last 24 h).

Because totals are added up as data arrives, the dashboard never has to scan millions of raw rows.

## The calculations (all in `src/calc.js`)

| What | Formula | Where the numbers come from |
|---|---|---|
| Current Power (W) | `voltage × current` | latest reading |
| Energy (kWh) | `watts × seconds since last reading ÷ 3600 ÷ 1000`, added to today | gap is capped at `MAX_GAP_SECONDS` (default 300) |
| Today's Revenue (৳) | `kWh × tariff_per_kwh` | `solar_list.tariff_per_kwh` (default 10) |
| Carbon Reduction (kg) | `kWh × co2_kg_per_kwh` | `solar_list.co2_kg_per_kwh` (default 0.55) |
| Battery SOC (%) | straight line from `batt_empty_volt` (0 %) to `batt_full_volt` (100 %) | `battery_voltage` + the two voltages in `solar_list` (default 11.5 V / 12.8 V) |
| Backup time (h) | `batt_capacity_ah × batt_nominal_volt × SOC% ÷ load_watt` | needs `batt_capacity_ah` and `load_watt` set, otherwise `null` |

**Please check these defaults** — they are starting guesses, not facts about your sites:
- **tariff 10 ৳/kWh** and **CO₂ 0.55 kg/kWh** — set your real values per site.
- **SOC from voltage** is a rough estimate (voltage moves with load/charging, and differs for lead-acid vs lithium). Set `batt_empty_volt` / `batt_full_volt` for your battery type.
- **Backup time uses a fixed `load_watt`** because the feed has no load-current field. If you later add one, change `backupHours` in `calc.js` to use it.
- I assumed `voltage` / `current` are the **solar panel** values and `battery_voltage` is the **site battery bank**. `internal_battery_volt` (4.2) is stored but not used.

Changing a tariff only affects readings from then on; old days keep the revenue they earned.
"Today" and "this month" follow `TIMEZONE` (Asia/Dhaka), so a new day starts at local midnight.

## Setup

### 1. Install
```bash
npm install
```

### 2. Create the database and tables
```bash
createdb solar_monitor                                  # or: CREATE DATABASE solar_monitor;  inside psql
psql -U postgres -d solar_monitor -f database/schema.sql
```
`schema.sql` runs `CREATE EXTENSION IF NOT EXISTS timescaledb;` itself, so TimescaleDB must be installed on the
server. It is safe to re-run: nothing is dropped.

### 3. Configure
```bash
cp .env.example .env     # set DB_PASSWORD and SOLAR_WS_URL at minimum
```

### 4. Add your sites (before the worker can store anything)
```bash
curl -X POST http://localhost:3200/api/solar -H "Content-Type: application/json" \
  -d '{"solar_code":"solar1","solar_name":"Site One"}'
```
Only `solar_code` is required. Add the real settings when you know them:
```bash
curl -X PATCH http://localhost:3200/api/solar/solar1 -H "Content-Type: application/json" \
  -d '{"tariff_per_kwh":12,"batt_capacity_ah":200,"batt_nominal_volt":12,"load_watt":150,"panel_capacity_w":1000}'
```
Or in SQL: `INSERT INTO solar_list (solar_code, solar_name) VALUES ('solar1','Site One');`
(the worker re-reads `solar_list` every minute).

### 5. Run both processes
```bash
npm start          # terminal 1 — API
npm run socket     # terminal 2 — WebSocket ingester
npm test           # optional — checks every formula with worked examples
```
Production with PM2:
```bash
pm2 start src/server.js --name solar_monitor-api
pm2 start src/solarWorker.js --name solar_monitor-worker
pm2 save && pm2 startup
```

## Data model

- `solar_list` — the sites (`solar_code`, `solar_name`) + settings used by the formulas.
- `solar_device_data` — every raw reading, forever (TimescaleDB hypertable), plus the calculated `power_w`.
- `solar_current_status` — one row per site: latest power, battery voltage, SOC, backup time, last seen.
- `solar_energy_daily` — one row per site per day: kWh, revenue, CO₂, peak power. Feeds the daily and monthly charts.

## Dashboard → API map

| Dashboard item | Endpoint |
|---|---|
| Current Power, Today's Energy, Carbon, Revenue, SOC, Backup time | `GET /api/dashboard/:solar_code/summary` |
| Same cards for all sites + totals | `GET /api/dashboard/summary` |
| Power Generation (Last 24 Hours) | `GET /api/dashboard/:solar_code/power-24h` |
| Daily Energy Generation (Current Month) | `GET /api/dashboard/:solar_code/daily` |
| Monthly Energy (kWh), Revenue (৳), Carbon Reduction (kg) | `GET /api/dashboard/:solar_code/monthly` |

See `api.md` for every endpoint with examples.

## Things to know
- If a site sends nothing for `ONLINE_WINDOW_SECONDS` (default 300) it is shown `online: false` and its current power reads 0.
- Energy during a feed outage longer than `MAX_GAP_SECONDS` is not estimated — only 5 minutes is counted for that gap.
- The API has no login and CORS is open (same as `sa_monitor`). Put it behind your network rules / a proxy before exposing it.
