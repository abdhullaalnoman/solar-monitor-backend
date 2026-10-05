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
{ "solar_code": "solar1", "solar_name": "Site One" }

PATCH — change only what you send. Editable fields:
solar_name, tariff_per_kwh, co2_kg_per_kwh, batt_empty_volt, batt_full_volt,
batt_capacity_ah, batt_nominal_volt, load_watt, panel_capacity_w
PATCH /api/solar/solar1
{ "tariff_per_kwh": 12, "load_watt": 150 }


Response — GET /api/dashboard/solar1/summary
{
  "success": true,
  "data": {
    "solar_code": "solar1",
    "solar_name": "Site One",
    "panel_capacity_w": 1000,
    "last_seen_at": "2026-10-04T11:02:16.305Z",
    "online": true,
    "current_power_w": 120,          // Current Power Generation (0 when offline)
    "today_energy_kwh": 3.482,       // Today's Solar Energy
    "today_co2_kg": 1.915,           // Carbon Emission Reduction
    "today_revenue": 34.82,          // Today's Revenue (৳)
    "today_peak_power_w": 640,
    "battery_voltage": 12.15,
    "soc_percent": 50,
    "backup_hours": 6,               // null until batt_capacity_ah and load_watt are set
    "temperature": 32
  }
}

Response — GET /api/dashboard/solar1/power-24h   (average W per 15 min)
{ "success": true, "solar_code": "solar1", "interval": "15 minutes", "count": 96,
  "data": [ { "time": "2026-10-04T11:00:00.000Z", "power_w": 82.5 } ] }

Response — GET /api/dashboard/solar1/daily   (every day of the month, 0 if no data)
{ "success": true, "solar_code": "solar1", "count": 31,
  "data": [ { "day": "2026-10-04", "energy_kwh": 3.482, "revenue": 34.82, "co2_kg": 1.915, "peak_power_w": 640 } ] }

Response — GET /api/dashboard/solar1/monthly   (12 months — one call feeds the kWh, ৳ and kg charts)
{ "success": true, "solar_code": "solar1", "count": 12,
  "data": [ { "month": "2026-10", "energy_kwh": 96.4, "revenue": 964, "co2_kg": 53.02 } ] }
