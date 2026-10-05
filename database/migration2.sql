-- ============================================================
-- Migration 2 — running-average energy + flat rates (15.36 ৳/kWh, 0.62 kg/kWh)
-- Run once:  psql -U postgres -d solar_monitor -f migration2.sql
-- Safe to re-run. Runs in one transaction. Run migration1.sql first.
-- ============================================================
BEGIN;

-- the running average each site's energy calculation continues from
ALTER TABLE solar_current_status ADD COLUMN IF NOT EXISTS avg_power_w NUMERIC(12,2);
UPDATE solar_current_status SET avg_power_w = power_w WHERE avg_power_w IS NULL;

-- Re-price every existing day at the flat rates so old and new days match.
-- (energy_kwh of old days is NOT changed)
UPDATE solar_energy_daily
SET revenue = energy_kwh * 15.36,
    co2_kg  = energy_kwh * 0.62;

COMMIT;
