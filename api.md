Base URL: http://localhost:3200

Solar sites (CRUD)
GET    /api/solar
POST   /api/solar
GET    /api/solar/solar1
PATCH  /api/solar/solar1
DELETE /api/solar/solar1

Dashboard — cards
GET /api/dashboard/summary                  all sites + totals
GET /api/dashboard/solar1/summary           one site

Dashboard — charts
GET /api/dashboard/solar1/power-24h
GET /api/dashboard/solar1/daily
GET /api/dashboard/solar1/daily?month=2026-10
GET /api/dashboard/solar1/monthly
GET /api/dashboard/solar1/monthly?year=2026

Raw readings (cursor-paginated)
GET /api/dashboard/solar1/raw?start_date=2026-10-01&end_date=2026-10-04
GET /api/dashboard/solar1/raw?start_date=2026-10-01&end_date=2026-10-04&start_time=09:00:00&end_time=18:00:00&limit=500
GET /api/dashboard/solar1/raw?start_date=2026-10-01&end_date=2026-10-04&after_created_at=2026-10-02T04:22:10.000Z&after_id=1234

System
GET /health


POST — add a site (only solar_code is required)
POST /api/solar
{
  "solar_code": "solar1",
  "solar_name": "Site One",
  "solar_panel_voltage": 18,     // V
  "solar_panel_watt": 1000,      // W
  "battery_voltage": 12,         // V  (rated) — needed for SOC
  "battery_capacity": 200        // Ah         — needed for backup time
}

PATCH — change only what you send. Editable fields:
solar_name, solar_panel_voltage, solar_panel_watt, battery_voltage, battery_capacity
PATCH /api/solar/solar1
{ "battery_capacity": 220 }
(numbers must be numeric and not negative, otherwise 400; send null to clear one)


Response — GET /api/dashboard/solar1/summary
{
  "success": true,
  "data": {
    "solar_code": "solar1",
    "solar_name": "Site One",
    "solar_panel_voltage": 18,
    "solar_panel_watt": 1000,
    "battery_rated_voltage": 12,     // from solar_list.battery_voltage
    "battery_capacity": 200,
    "last_seen_at": "2026-10-05T11:02:16.305Z",
    "online": true,
    "current_power_w": 120,          // Current Power Generation (0 when offline)
    "today_energy_kwh": 3.482,       // Today's Solar Energy
    "today_co2_kg": 1.915,           // Carbon Emission Reduction
    "today_revenue": 34.82,          // Today's Revenue (৳)
    "today_peak_power_w": 640,
    "battery_voltage": 12.15,        // live reading
    "battery_current": 10,           // live reading
    "soc_percent": 50,
    "backup_hours": 10,              // null if capacity not set, or battery not discharging
    "sunlight_intensity": 10,
    "temperature": 32,
    "humidity": 70
  }
}

Date-wise record — GET /api/dashboard/solar1/energy-by-date?start_date=2026-10-01&end_date=2026-10-05
(one row per day; days with no data are 0; defaults to the last 30 days; max 366 days)
{ "success": true, "solar_code": "solar1", "count": 5,
  "totals": { "energy_kwh": 14.2, "revenue": 218.11, "co2_kg": 8.804 },
  "data": [ { "day": "2026-10-01", "energy_kwh": 2.9, "revenue": 44.54, "co2_kg": 1.798, "peak_power_w": 640 }, ... ] }

Chart calls (they all read the same per-day table, so they always match the cards):
  power-24h  -> Power Generation (Last 24 Hours)
  daily      -> Daily Energy Generation (Current Month): energy_kwh, revenue, co2_kg per day
  monthly    -> Monthly Energy (kWh), Revenue (৳), Carbon Reduction (kg): per month
  energy-by-date -> the same per day, for any date range

Raw readings (GET /api/dashboard/solar1/raw) return every column of solar_device_data, including
data_time = seconds since that site's previous reading (0 for its first).

Response — GET /api/dashboard/solar1/power-24h   (average W per 15 min)
{ "success": true, "solar_code": "solar1", "interval": "15 minutes", "count": 96,
  "data": [ { "time": "2026-10-04T11:00:00.000Z", "power_w": 82.5 } ] }

Response — GET /api/dashboard/solar1/daily   (every day of the month, 0 if no data)
{ "success": true, "solar_code": "solar1", "count": 31,
  "data": [ { "day": "2026-10-04", "energy_kwh": 3.482, "revenue": 34.82, "co2_kg": 1.915, "peak_power_w": 640 } ] }

Response — GET /api/dashboard/solar1/monthly   (12 months — one call feeds the kWh, ৳ and kg charts)
{ "success": true, "solar_code": "solar1", "count": 12,
  "data": [ { "month": "2026-10", "energy_kwh": 96.4, "revenue": 964, "co2_kg": 53.02 } ] }