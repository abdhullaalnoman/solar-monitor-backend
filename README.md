# solar_monitor

Solar site monitoring, built the same way as `sa_monitor`: two small
processes and a PostgreSQL (TimescaleDB) database.

- `src/server.js`       — REST API (add sites, read cards and charts)
- `src/solarWorker.js`  — WebSocket ingester (the only thing that writes readings)
- `src/calc.js`         — **every formula, in one short file**
- `src/solarEngine.js`  — applies the formulas to each new reading and saves the totals

## How it works (the whole idea)

1. Every 30 s – 2 min a site sends one line:
   `solar1: 12,10,10,12,10,32,70,4.2,1,1,gra,70,16-9-2026, 1, 0,90`
   = `solar_code : solar_voltage, solar_current, sunlight_intensity, battery_voltage, battery_current, temperature, humidity, internal_battery_volt, psu1, psu2, operator, signal_strength, active, server1, server2, data_sequence`
2. The worker checks `solar1` is in `solar_list` (if not, the line is skipped), then
   - saves the raw line in **solar_device_data** (never deleted), with **data_time** = whole seconds since that site's previous line (0 for its first),
   - works out power = solar_voltage × solar_current,
   - works out the small bit of energy made since the previous line, and **adds** it to today's row in **solar_energy_daily**,
   - rewrites the one row for that site in **solar_current_status** (latest power, battery SOC, backup time).
3. The API only reads those tables. Cards read today's row + the status row. Charts read `solar_energy_daily` (daily / monthly) or `solar_device_data` (last 24 h).

Because totals are added up as data arrives, the dashboard never has to scan millions of raw rows.

## The calculations (all in `src/calc.js`)

| What | Formula | Where the numbers come from |
|---|---|---|
| Current Power (W) | `solar_voltage × solar_current` | latest reading |
| Average power | 1st reading: `P1` · 2nd: `(P1 + P2) / 2` · later: `(previous avg + new power) / 2` | kept in `solar_current_status.avg_power_w` |
| Energy of one reading (kWh) | `avg watts × data_time(s) ÷ 3600 = Wh`, then `÷ 1000`; added to today's total | `data_time` = seconds since the site's previous reading |
| Today's Revenue (৳) | `Today's Energy × 15.36` | flat PDB unit rate |
| Carbon Reduction (kg) | `Today's Energy × 0.62` | flat carbon factor |
| Battery SOC (%) | straight line from 0 % at 11.5 V to 100 % at 12.8 V (scaled by battery size, e.g. ×2 for 24 V) | live `battery_voltage` + `solar_list.battery_voltage` |
| Backup time (h) | `battery_capacity × SOC% ÷ battery_current` | `solar_list.battery_capacity` + live `battery_current`; `null` unless the battery is discharging |

**Please check these assumptions** — they are starting guesses, not facts about your sites:
- **15.36 ৳/kWh** and **0.62 kg/kWh** are fixed in `calc.js` (`UNIT_RATE`, `CARBON_FACTOR`), the same for all sites.
- **SOC from voltage** is a rough estimate (voltage moves with load/charging, and differs for lead-acid vs lithium). The 11.5 V / 12.8 V range is in `calc.js`.
- **Backup time assumes a positive `battery_current` means discharging.** If your logger reports the opposite, set `BATTERY_POSITIVE_IS_DISCHARGE=false` in `.env`.
- `solar_voltage` / `solar_current` are the **solar panel** values and `battery_voltage` / `battery_current` are the **site battery bank**. `sunlight_intensity`, `humidity`, `internal_battery_volt`, `psu1/2`, `active`, `server1/2` and `data_sequence` are stored but not used in any formula. `active` is kept as text exactly as sent (e.g. `16-9-2026`).

Revenue and carbon are always recalculated from the day's total energy, so they never drift from it.
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

**Already running the old version?** Run the migrations instead (once each, in order):
```bash
psql -U postgres -d solar_monitor -f migration1.sql
psql -U postgres -d solar_monitor -f migration2.sql
```

### 3. Configure
Set `DB_PASSWORD` and `SOLAR_WS_URL` in `.env` at minimum. Optional:
```
MAX_GAP_SECONDS=300     # longest data_time counted as generation; 0 = count it all
BATTERY_POSITIVE_IS_DISCHARGE=true
```

### 4. Add your sites (before the worker can store anything)
```bash
curl -X POST http://localhost:3200/api/solar -H "Content-Type: application/json" \
  -d '{"solar_code":"solar1","solar_name":"Site One"}'
```
Only `solar_code` is required. All the settings can be sent at creation, or added later:
```bash
curl -X POST http://localhost:3200/api/solar -H "Content-Type: application/json" \
  -d '{"solar_code":"solar1","solar_name":"Site One","solar_panel_voltage":18,"solar_panel_watt":1000,"battery_voltage":12,"battery_capacity":200}'

curl -X PATCH http://localhost:3200/api/solar/solar1 -H "Content-Type: application/json" \
  -d '{"battery_capacity":220}'
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

- `solar_list` — the sites: `solar_code`, `solar_name`, `solar_panel_voltage`, `solar_panel_watt`, `battery_voltage`, `battery_capacity`.
- `solar_device_data` — every raw reading, forever (TimescaleDB hypertable), plus the calculated `power_w` and `data_time` (seconds since the site's previous reading).
- `solar_current_status` — one row per site: latest values, power, SOC, backup time, last seen.
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
- Energy during a feed outage longer than `MAX_GAP_SECONDS` is not estimated — only 5 minutes is counted for that gap. `data_time` still stores the real gap.
- The API has no login and CORS is open (same as `sa_monitor`). Put it behind your network rules / a proxy before exposing it.