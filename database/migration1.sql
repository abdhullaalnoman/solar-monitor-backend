-- ============================================================
-- Migration 1 — new feed format + new site settings
-- Run once:  psql -U postgres -d solar_monitor -f migration1.sql
-- Safe to re-run. Runs in one transaction: if anything fails, nothing changes.
--
-- New feed:
--   solar1: solar_voltage,solar_current,sunlight_intensity,battery_voltage,battery_current,
--           temperature,humidity,internal_battery_volt,psu1,psu2,operator,signal_strength,
--           active,server1,server2,data_sequence
-- ============================================================
BEGIN;

-- ── 1. solar_list: add the 4 new settings ───────────────────
ALTER TABLE solar_list ADD COLUMN IF NOT EXISTS solar_panel_voltage NUMERIC(10,2);  -- panel rated voltage (V)
ALTER TABLE solar_list ADD COLUMN IF NOT EXISTS solar_panel_watt    NUMERIC(10,2);  -- panel rated power (W)
ALTER TABLE solar_list ADD COLUMN IF NOT EXISTS battery_voltage     NUMERIC(10,2);  -- battery bank rated voltage (V)
ALTER TABLE solar_list ADD COLUMN IF NOT EXISTS battery_capacity    NUMERIC(10,2);  -- battery bank capacity (Ah)

-- keep the values you already entered, then remove the old columns
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'solar_list' AND column_name = 'panel_capacity_w') THEN
    UPDATE solar_list SET
      solar_panel_watt = COALESCE(solar_panel_watt, panel_capacity_w),
      battery_voltage  = COALESCE(battery_voltage,  batt_nominal_volt),
      battery_capacity = COALESCE(battery_capacity, batt_capacity_ah);
  END IF;
END $$;

ALTER TABLE solar_list DROP COLUMN IF EXISTS tariff_per_kwh;
ALTER TABLE solar_list DROP COLUMN IF EXISTS co2_kg_per_kwh;
ALTER TABLE solar_list DROP COLUMN IF EXISTS batt_empty_volt;
ALTER TABLE solar_list DROP COLUMN IF EXISTS batt_full_volt;
ALTER TABLE solar_list DROP COLUMN IF EXISTS batt_capacity_ah;
ALTER TABLE solar_list DROP COLUMN IF EXISTS batt_nominal_volt;
ALTER TABLE solar_list DROP COLUMN IF EXISTS load_watt;
ALTER TABLE solar_list DROP COLUMN IF EXISTS panel_capacity_w;

-- ── 2. solar_device_data: rename 2 old columns, add the new ones ──
-- Old rows keep their history (data_time stays NULL for them).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'solar_device_data' AND column_name = 'voltage')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'solar_device_data' AND column_name = 'solar_voltage') THEN
    ALTER TABLE solar_device_data RENAME COLUMN voltage TO solar_voltage;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'solar_device_data' AND column_name = 'current')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'solar_device_data' AND column_name = 'solar_current') THEN
    ALTER TABLE solar_device_data RENAME COLUMN "current" TO solar_current;
  END IF;
END $$;

ALTER TABLE solar_device_data ADD COLUMN IF NOT EXISTS sunlight_intensity NUMERIC(10,2);
ALTER TABLE solar_device_data ADD COLUMN IF NOT EXISTS battery_current    NUMERIC(10,2);
ALTER TABLE solar_device_data ADD COLUMN IF NOT EXISTS humidity           NUMERIC(10,2);
ALTER TABLE solar_device_data ADD COLUMN IF NOT EXISTS active             VARCHAR(50);   -- e.g. '16-9-2026' (kept as text, exactly as sent)
ALTER TABLE solar_device_data ADD COLUMN IF NOT EXISTS server1            INTEGER;
ALTER TABLE solar_device_data ADD COLUMN IF NOT EXISTS server2            INTEGER;
ALTER TABLE solar_device_data ADD COLUMN IF NOT EXISTS data_sequence      INTEGER;
ALTER TABLE solar_device_data ADD COLUMN IF NOT EXISTS data_time          INTEGER;       -- seconds since this site's previous reading (0 for its first)

-- ── 3. solar_current_status: same renames + the new live values ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'solar_current_status' AND column_name = 'voltage')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'solar_current_status' AND column_name = 'solar_voltage') THEN
    ALTER TABLE solar_current_status RENAME COLUMN voltage TO solar_voltage;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'solar_current_status' AND column_name = 'current')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'solar_current_status' AND column_name = 'solar_current') THEN
    ALTER TABLE solar_current_status RENAME COLUMN "current" TO solar_current;
  END IF;
END $$;

ALTER TABLE solar_current_status ADD COLUMN IF NOT EXISTS sunlight_intensity NUMERIC(10,2);
ALTER TABLE solar_current_status ADD COLUMN IF NOT EXISTS battery_current    NUMERIC(10,2);
ALTER TABLE solar_current_status ADD COLUMN IF NOT EXISTS humidity           NUMERIC(10,2);

COMMIT;
