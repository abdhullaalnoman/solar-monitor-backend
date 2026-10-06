-- ============================================================
-- solar_monitor — full schema (safe to re-run)
--
-- Every CREATE is IF NOT EXISTS and there are no DROP statements,
-- so re-running this on an existing database never touches data.
--
-- Tables:
--   1. solar_list            site profile + the numbers used in calculations
--   2. solar_device_data     every raw reading, forever (TimescaleDB hypertable)
--   3. solar_current_status  ONE row per site = what the dashboard cards show
--   4. solar_energy_daily    ONE row per site per day = energy / revenue / CO2
--                            (feeds the daily + monthly charts)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ── 1. solar_list — the sites you add (code + name), plus settings ──
-- You only NEED solar_code (and a name). Everything else has a default
-- and can be changed any time with PATCH /api/solar/:solar_code.

CREATE TABLE IF NOT EXISTS solar_list (
    id                  SERIAL PRIMARY KEY,
    solar_code          VARCHAR(50)   NOT NULL UNIQUE,   -- e.g. 'solar1' — matches the feed prefix
    solar_name          VARCHAR(100),                    -- human-readable site name

    solar_panel_voltage NUMERIC(10,2),                   -- panel rated voltage (V)
    solar_panel_watt    NUMERIC(10,2),                   -- panel rated power (W)
    battery_voltage     NUMERIC(10,2),                   -- battery bank rated voltage (V) — used for Battery SOC
    battery_capacity    NUMERIC(10,2),                   -- battery bank capacity (Ah)     — used for Backup time

    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── 2. solar_device_data — raw readings (one row per feed message) ──
-- Columns match the feed order exactly:
--   solar1: solar_voltage,solar_current,sunlight_intensity,battery_voltage,battery_current,temperature,
--           humidity,internal_battery_volt,psu1,psu2,operator,signal_strength,active,server1,server2,data_sequence
-- An empty value between two commas is stored as NULL.

CREATE TABLE IF NOT EXISTS solar_device_data (
    id                      BIGSERIAL,
    solar_code              VARCHAR(50)  NOT NULL,

    solar_voltage           NUMERIC(10,2),   -- solar panel voltage (V)
    solar_current           NUMERIC(10,2),   -- solar panel current (A)
    sunlight_intensity      NUMERIC(10,2),
    battery_voltage         NUMERIC(10,2),   -- site battery bank voltage (V)
    battery_current         NUMERIC(10,2),   -- site battery bank current (A)
    temperature             NUMERIC(10,2),   -- °C
    humidity                NUMERIC(10,2),   -- %
    internal_battery_volt   NUMERIC(10,2),   -- the logger's own small battery (V)
    psu1                    NUMERIC(10,2),
    psu2                    NUMERIC(10,2),
    operator                VARCHAR(50),     -- SIM operator, e.g. 'gra'
    signal_strength         NUMERIC(10,2),
    active                  VARCHAR(50),     -- as sent, e.g. '16-9-2026'
    server1                 INTEGER,
    server2                 INTEGER,
    data_sequence           INTEGER,

    power_w                 NUMERIC(12,2),   -- solar_voltage x solar_current, calculated when the reading arrives
    data_time               INTEGER,         -- SECONDS since this site's previous reading (0 for its very first)

    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

SELECT create_hypertable(
    'solar_device_data', 'created_at',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_solar_device_data_code
    ON solar_device_data (solar_code, created_at DESC);

-- ── 3. solar_current_status — one row per site, always the latest ──
-- Holds the latest power + battery numbers. It is rewritten on every
-- incoming reading, so reading it is instant (no scanning of history).
-- Today's energy / revenue / CO2 are NOT here — the API reads them from
-- solar_energy_daily (today's row), so they reset correctly at midnight.

CREATE TABLE IF NOT EXISTS solar_current_status (
    solar_code          VARCHAR(50)  PRIMARY KEY,
    last_seen_at        TIMESTAMPTZ  NOT NULL,

    -- latest raw values
    solar_voltage       NUMERIC(10,2),
    solar_current       NUMERIC(10,2),
    sunlight_intensity  NUMERIC(10,2),
    battery_voltage     NUMERIC(10,2),
    battery_current     NUMERIC(10,2),
    temperature         NUMERIC(10,2),
    humidity            NUMERIC(10,2),

    -- Card 1: Current Power Generation
    power_w             NUMERIC(12,2) NOT NULL DEFAULT 0,
    avg_power_w         NUMERIC(12,2),   -- running average used for energy: (previous avg + new power) / 2

    -- Battery
    soc_percent         NUMERIC(6,2),    -- 0-100, NULL if it cannot be calculated
    backup_hours        NUMERIC(10,2)    -- NULL if battery capacity is not set or the battery is not discharging
);

-- ── 4. solar_energy_daily — one row per site per day ──
-- Every reading ADDS its energy slice to today's row:
--   slice (kWh) = avg power (W) x data_time (s) / 3600 / 1000
-- and the row's revenue / CO2 are then set from the day's total:
--   revenue = energy_kwh x 15.36        co2_kg = energy_kwh x 0.62
-- The "day" follows the TIMEZONE in .env (Asia/Dhaka), so a new day starts at local midnight.
-- This table is the date-wise record: one row per site per date.

CREATE TABLE IF NOT EXISTS solar_energy_daily (
    solar_code      VARCHAR(50)   NOT NULL,
    day             DATE          NOT NULL,
    -- 6 decimals on purpose: each reading adds a tiny slice, and rounding
    -- every slice to 2-3 decimals would lose most of it. The API rounds for display.
    energy_kwh      NUMERIC(16,6) NOT NULL DEFAULT 0,
    revenue         NUMERIC(16,6) NOT NULL DEFAULT 0,
    co2_kg          NUMERIC(16,6) NOT NULL DEFAULT 0,
    peak_power_w    NUMERIC(12,2) NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (solar_code, day)
);

-- ============================================================
--  USEFUL QUERIES
-- ============================================================
-- SELECT * FROM solar_list ORDER BY solar_code;
-- SELECT * FROM solar_current_status;
-- SELECT * FROM solar_energy_daily WHERE solar_code='solar1' ORDER BY day DESC LIMIT 31;
-- SELECT * FROM solar_device_data WHERE solar_code='solar1' ORDER BY created_at DESC LIMIT 20;