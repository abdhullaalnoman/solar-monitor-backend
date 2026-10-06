// src/solarEngine.js — turns one parsed reading into stored numbers.
//
// For every reading that arrives it does 3 simple things:
//   1. power = solar_voltage x solar_current, then a running average of power
//        (1st reading: P1 | 2nd: (P1+P2)/2 | later: (previous avg + new power)/2)
//   2. energy for this reading = avg watts x data_time (s -> hours) / 1000  = kWh
//      ADDED to today's row in solar_energy_daily; then for that day
//        revenue = energy_kwh x 15.36      carbon = energy_kwh x 0.62
//   3. battery: full Wh = battery_voltage x battery_capacity; remain + solar energy (max full), then - battery energy used (min 0);
//      SOC % = remain / full x 100
//   4. rewrites the single row in solar_current_status (latest values + battery + avg)
//
// All formulas are in calc.js — this file only moves numbers in and out of the DB.

require('dotenv').config();
const { query } = require('./db');
const calc = require('./calc');

const TIMEZONE = process.env.TIMEZONE || 'Asia/Dhaka';
// A data_time longer than this is cut to this many seconds when counting energy
// (so an outage is not counted as generation). Set MAX_GAP_SECONDS=0 to count the full data_time.
const MAX_GAP_SECONDS = process.env.MAX_GAP_SECONDS === undefined ? 300 : parseInt(process.env.MAX_GAP_SECONDS);

// { [solar_code]: Date of the previous reading } — used to measure the gap
const lastSeen = new Map();
// { [solar_code]: running average power (W) after the previous reading }
const lastAvg = new Map();
// { [solar_code]: energy left in the battery (Wh) after the previous reading }
const lastRemain = new Map();

// Postgres returns NUMERIC columns as strings; turn them into numbers (or null).
const num = (v) => (v === null || v === undefined ? null : Number(v));

// Reload "last seen" from the DB so a worker restart doesn't lose the gap.
async function preloadEngine() {
  lastSeen.clear();
  lastAvg.clear();
  lastRemain.clear();
  const res = await query('SELECT solar_code, last_seen_at, avg_power_w, battery_remain_wh FROM solar_current_status');
  for (const r of res.rows) {
    lastSeen.set(r.solar_code, new Date(r.last_seen_at));
    if (r.avg_power_w !== null) lastAvg.set(r.solar_code, Number(r.avg_power_w));
    if (r.battery_remain_wh !== null) lastRemain.set(r.solar_code, Number(r.battery_remain_wh));
  }
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
    // 1. Power, running average, and the energy of this reading
    const power_w = calc.powerW(row.solar_voltage, row.solar_current);
    const avg_w   = calc.runningAvgPower(lastAvg.get(code) ?? null, power_w);
    const kwh     = calc.energyKwh(avg_w, gapSec, MAX_GAP_SECONDS);   // first reading: data_time 0 -> 0 kWh

    // 2. Add the energy to today's total, then re-derive today's revenue + carbon from the total
    //    (a new row is created at local midnight)
    await query(
      `INSERT INTO solar_energy_daily (solar_code, day, energy_kwh, revenue, co2_kg, peak_power_w)
       VALUES ($1, (($2::timestamptz) AT TIME ZONE $3)::date,
               $4::numeric, $4::numeric * $5::numeric, $4::numeric * $6::numeric, $7)
       ON CONFLICT (solar_code, day) DO UPDATE SET
         energy_kwh   = solar_energy_daily.energy_kwh + EXCLUDED.energy_kwh,
         revenue      = (solar_energy_daily.energy_kwh + EXCLUDED.energy_kwh) * $5::numeric,
         co2_kg       = (solar_energy_daily.energy_kwh + EXCLUDED.energy_kwh) * $6::numeric,
         peak_power_w = GREATEST(solar_energy_daily.peak_power_w, EXCLUDED.peak_power_w),
         updated_at   = NOW()`,
      [code, now, TIMEZONE, kwh, calc.UNIT_RATE, calc.CARBON_FACTOR, power_w]
    );

    // 3. Battery: full Wh = battery_voltage x battery_capacity (solar_list)
    //    remain = remain + solar energy (up to full), then - battery energy used (down to 0)
    //    The same MAX_GAP_SECONDS limit as the energy is applied to data_time.
    const batterySec = MAX_GAP_SECONDS > 0 ? Math.min(gapSec, MAX_GAP_SECONDS) : gapSec;
    const fullWh = calc.batteryFullWh(num(site.battery_voltage), num(site.battery_capacity));
    const remainWh = calc.batteryRemainWh(
      lastRemain.get(code) ?? null, fullWh, power_w, row.battery_voltage, row.battery_current, batterySec
    );
    const soc = calc.socPercent(remainWh, fullWh);
    const backup = calc.backupHours(soc, num(site.battery_capacity), row.battery_current);

    // 4. Rewrite the one "current" row for this site
    await query(
      `INSERT INTO solar_current_status
         (solar_code, last_seen_at, solar_voltage, solar_current, sunlight_intensity,
          battery_voltage, battery_current, temperature, humidity,
          power_w, avg_power_w, battery_remain_wh, soc_percent, backup_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
         avg_power_w        = EXCLUDED.avg_power_w,
         battery_remain_wh  = EXCLUDED.battery_remain_wh,
         soc_percent        = EXCLUDED.soc_percent,
         backup_hours       = EXCLUDED.backup_hours`,
      [code, now, row.solar_voltage, row.solar_current, row.sunlight_intensity,
       row.battery_voltage, row.battery_current, row.temperature, row.humidity,
       power_w, avg_w, remainWh, soc, backup]
    );

    lastSeen.set(code, now);
    lastAvg.set(code, avg_w);
    if (remainWh === null) lastRemain.delete(code); else lastRemain.set(code, remainWh);
    console.log(
      `[SOLAR ENGINE] ${code} | ${power_w} W | avg ${avg_w.toFixed(2)} W | data_time ${gapSec}s | +${kwh.toFixed(6)} kWh | battery ${remainWh ?? 'N/A'} Wh | SOC ${soc ?? 'N/A'}% | backup ${backup ?? 'N/A'} h`
    );
  } catch (err) {
    console.error(`[SOLAR ENGINE] Failed processing ${code} (did you run the migration / schema.sql?):`, err.message);
  }
}

module.exports = { preloadEngine, processReading, secondsSinceLast };