// src/solarEngine.js — turns one parsed reading into stored numbers.
//
// For every reading that arrives it does 3 simple things:
//   1. works out power (W) and the small slice of energy since the last reading
//   2. ADDS that slice to today's row in solar_energy_daily (energy, revenue, CO2)
//   3. rewrites the single row in solar_current_status (latest values + battery)
//
// All formulas are in calc.js — this file only moves numbers in and out of the DB.

require('dotenv').config();
const { query } = require('./db');
const calc = require('./calc');

const TIMEZONE = process.env.TIMEZONE || 'Asia/Dhaka';
const MAX_GAP_SECONDS = parseInt(process.env.MAX_GAP_SECONDS) || 300;

// Revenue / carbon are no longer per-site settings — one value for all sites (set in .env).
const TARIFF_PER_KWH = Number(process.env.TARIFF_PER_KWH ?? 10);      // ৳ per kWh
const CO2_KG_PER_KWH = Number(process.env.CO2_KG_PER_KWH ?? 0.55);    // kg CO2 per kWh
// Does a POSITIVE battery_current mean the battery is discharging? (used for backup time)
const BATTERY_POSITIVE_IS_DISCHARGE = (process.env.BATTERY_POSITIVE_IS_DISCHARGE ?? 'true') !== 'false';

// { [solar_code]: Date of the previous reading } — used to measure the gap
const lastSeen = new Map();

// Postgres returns NUMERIC columns as strings; turn them into numbers (or null).
const num = (v) => (v === null || v === undefined ? null : Number(v));

// Reload "last seen" from the DB so a worker restart doesn't lose the gap.
async function preloadEngine() {
  lastSeen.clear();
  const res = await query('SELECT solar_code, last_seen_at FROM solar_current_status');
  for (const r of res.rows) lastSeen.set(r.solar_code, new Date(r.last_seen_at));
  console.log(`[SOLAR ENGINE] Preloaded ${res.rowCount} site(s)`);
}

// Whole SECONDS since this site's previous reading. 0 for the site's very first reading.
// This is the number stored in solar_device_data.data_time.
function secondsSinceLast(code, now) {
  const prev = lastSeen.get(code);
  return prev ? Math.max(0, Math.round((now - prev) / 1000)) : 0;
}

// row     = parsed reading (solar_voltage, solar_current, battery_voltage, ...)
// site    = that site's row from solar_list (battery_voltage, battery_capacity, ...)
// now     = when the reading arrived
// gapSec  = secondsSinceLast(code, now), measured BEFORE this reading was saved
async function processReading(row, site, now, gapSec) {
  const code = row.solar_code;

  try {
    // 1. Power and energy since the previous reading
    const power_w = calc.powerW(row.solar_voltage, row.solar_current);
    const kwh = calc.energyKwh(power_w, gapSec, MAX_GAP_SECONDS);   // first reading: gap 0 -> nothing added
    const rev = calc.revenue(kwh, TARIFF_PER_KWH);
    const co2 = calc.co2Kg(kwh, CO2_KG_PER_KWH);

    // 2. Add to today's totals (a new row is created at local midnight)
    await query(
      `INSERT INTO solar_energy_daily (solar_code, day, energy_kwh, revenue, co2_kg, peak_power_w)
       VALUES ($1, (($2::timestamptz) AT TIME ZONE $3)::date, $4, $5, $6, $7)
       ON CONFLICT (solar_code, day) DO UPDATE SET
         energy_kwh   = solar_energy_daily.energy_kwh + EXCLUDED.energy_kwh,
         revenue      = solar_energy_daily.revenue    + EXCLUDED.revenue,
         co2_kg       = solar_energy_daily.co2_kg     + EXCLUDED.co2_kg,
         peak_power_w = GREATEST(solar_energy_daily.peak_power_w, EXCLUDED.peak_power_w),
         updated_at   = NOW()`,
      [code, now, TIMEZONE, kwh, rev, co2, power_w]
    );

    // 3. Battery
    const soc = calc.socPercent(row.battery_voltage, num(site.battery_voltage));
    const backup = calc.backupHours(
      soc, num(site.battery_capacity), row.battery_current, BATTERY_POSITIVE_IS_DISCHARGE
    );

    // 4. Rewrite the one "current" row for this site
    await query(
      `INSERT INTO solar_current_status
         (solar_code, last_seen_at, solar_voltage, solar_current, sunlight_intensity,
          battery_voltage, battery_current, temperature, humidity,
          power_w, soc_percent, backup_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (solar_code) DO UPDATE SET
         last_seen_at       = EXCLUDED.last_seen_at,
         solar_voltage      = EXCLUDED.solar_voltage,
         solar_current      = EXCLUDED.solar_current,
         sunlight_intensity = EXCLUDED.sunlight_intensity,
         battery_voltage    = EXCLUDED.battery_voltage,
         battery_current    = EXCLUDED.battery_current,
         temperature        = EXCLUDED.temperature,
         humidity           = EXCLUDED.humidity,
         power_w            = EXCLUDED.power_w,
         soc_percent        = EXCLUDED.soc_percent,
         backup_hours       = EXCLUDED.backup_hours`,
      [code, now, row.solar_voltage, row.solar_current, row.sunlight_intensity,
       row.battery_voltage, row.battery_current, row.temperature, row.humidity,
       power_w, soc, backup]
    );

    lastSeen.set(code, now);
    console.log(
      `[SOLAR ENGINE] ${code} | ${power_w} W | gap ${gapSec}s | +${kwh.toFixed(5)} kWh | SOC ${soc ?? 'N/A'}% | backup ${backup ?? 'N/A'} h`
    );
  } catch (err) {
    console.error(`[SOLAR ENGINE] Failed processing ${code} (did you run the migration / schema.sql?):`, err.message);
  }
}

module.exports = { preloadEngine, processReading, secondsSinceLast };