-- ============================================================
-- Migration 3 — battery energy tracking (remain Wh -> SOC %)
-- Run once:  psql -U postgres -d solar_monitor -f migration3.sql
-- Safe to re-run. Run migration1.sql and migration2.sql first.
-- ============================================================
BEGIN;

-- Energy left in the battery (Wh). NULL = not started yet: each site starts
-- from FULL on its next reading, then follows the increase/decrease rule.
ALTER TABLE solar_current_status ADD COLUMN IF NOT EXISTS battery_remain_wh NUMERIC(14,4);

COMMIT;
