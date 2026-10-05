// src/routes/dashboard.js — numbers and charts for the solar dashboard
//
// Cards (one site):   GET /api/dashboard/:solar_code/summary
// Cards (all sites):  GET /api/dashboard/summary
// Chart 1:            GET /api/dashboard/:solar_code/power-24h
// Chart 2:            GET /api/dashboard/:solar_code/daily?month=YYYY-MM
// Charts 3-5:         GET /api/dashboard/:solar_code/monthly?year=YYYY   (kWh, ৳, kg)
// Raw readings:       GET /api/dashboard/:solar_code/raw?start_date=&end_date=

const express = require('express');
const router  = express.Router();
const { query } = require('../db');

const TIMEZONE = process.env.TIMEZONE || 'Asia/Dhaka';
const ONLINE_WINDOW_SECONDS = parseInt(process.env.ONLINE_WINDOW_SECONDS) || 300;

function serverError(res, err) {
  console.error('[DASHBOARD]', err.message);
  return res.status(500).json({ success: false, error: 'Internal server error' });
}
function notFound(res, code) {
  return res.status(404).json({ success: false, error: `solar_code '${code}' not found` });
}

// One SELECT used for both the single-site and all-sites cards.
// Today's numbers come from today's row in solar_energy_daily, so they
// are correct right after midnight even before the first new reading.
const SUMMARY_SQL = `
  SELECT
    l.solar_code,
    l.solar_name,
    l.solar_panel_voltage,
    l.solar_panel_watt,
    l.battery_voltage                                         AS battery_rated_voltage,
    l.battery_capacity,
    c.last_seen_at,
    COALESCE(c.last_seen_at > NOW() - make_interval(secs => $2), false) AS online,
    -- Card: Current Power Generation (0 if the site has gone quiet)
    CASE WHEN c.last_seen_at > NOW() - make_interval(secs => $2)
         THEN COALESCE(c.power_w, 0) ELSE 0 END               AS current_power_w,
    -- Cards: Today's Solar Energy / Carbon Reduction / Today's Revenue
    ROUND(COALESCE(d.energy_kwh, 0), 3)                       AS today_energy_kwh,
    ROUND(COALESCE(d.co2_kg, 0), 3)                           AS today_co2_kg,
    ROUND(COALESCE(d.revenue, 0), 2)                          AS today_revenue,
    COALESCE(d.peak_power_w, 0)                               AS today_peak_power_w,
    -- Battery
    c.battery_voltage,
    c.battery_current,
    c.soc_percent,
    c.backup_hours,
    -- Weather at the site
    c.sunlight_intensity,
    c.temperature,
    c.humidity
  FROM solar_list l
  LEFT JOIN solar_current_status c ON c.solar_code = l.solar_code
  LEFT JOIN solar_energy_daily d
         ON d.solar_code = l.solar_code
        AND d.day = (NOW() AT TIME ZONE $1)::date
`;

// GET /api/dashboard/summary — every site + overall totals
router.get('/summary', async (req, res) => {
  try {
    const result = await query(`${SUMMARY_SQL} ORDER BY l.solar_code`, [TIMEZONE, ONLINE_WINDOW_SECONDS]);
    const rows = result.rows;
    const sum = (key) => Math.round(rows.reduce((t, r) => t + Number(r[key] || 0), 0) * 1000) / 1000;
    res.json({
      success: true,
      count: rows.length,
      totals: {
        sites_online: rows.filter(r => r.online).length,
        current_power_w: sum('current_power_w'),
        today_energy_kwh: sum('today_energy_kwh'),
        today_co2_kg: sum('today_co2_kg'),
        today_revenue: sum('today_revenue'),
      },
      data: rows,
    });
  } catch (err) { serverError(res, err); }
});

// GET /api/dashboard/:solar_code/summary — the dashboard cards for one site
router.get('/:solar_code/summary', async (req, res) => {
  const { solar_code } = req.params;
  try {
    const result = await query(`${SUMMARY_SQL} WHERE l.solar_code = $3`, [TIMEZONE, ONLINE_WINDOW_SECONDS, solar_code]);
    if (result.rowCount === 0) return notFound(res, solar_code);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { serverError(res, err); }
});

// GET /api/dashboard/:solar_code/power-24h
// Chart: Power Generation (Last 24 Hours) — average watts in each 15-minute slot.
router.get('/:solar_code/power-24h', async (req, res) => {
  const { solar_code } = req.params;
  try {
    const siteCheck = await query('SELECT 1 FROM solar_list WHERE solar_code = $1', [solar_code]);
    if (siteCheck.rowCount === 0) return notFound(res, solar_code);

    const result = await query(
      `SELECT time_bucket('15 minutes', created_at) AS time,
              ROUND(AVG(power_w), 2)                AS power_w
       FROM solar_device_data
       WHERE solar_code = $1 AND created_at >= NOW() - INTERVAL '24 hours'
       GROUP BY 1
       ORDER BY 1`,
      [solar_code]
    );
    res.json({ success: true, solar_code, interval: '15 minutes', count: result.rowCount, data: result.rows });
  } catch (err) { serverError(res, err); }
});

// GET /api/dashboard/:solar_code/daily?month=2026-10
// Chart: Daily Energy Generation (Current Month). Every day of the month
// is returned, with 0 for days that have no data. Month defaults to this month.
router.get('/:solar_code/daily', async (req, res) => {
  const { solar_code } = req.params;
  const { month } = req.query;
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ success: false, error: 'month must look like 2026-10' });
  }

  try {
    const siteCheck = await query('SELECT 1 FROM solar_list WHERE solar_code = $1', [solar_code]);
    if (siteCheck.rowCount === 0) return notFound(res, solar_code);

    const result = await query(
      `WITH m AS (
         SELECT COALESCE($2::date, date_trunc('month', NOW() AT TIME ZONE $3)::date) AS first_day
       )
       SELECT to_char(g.day, 'YYYY-MM-DD')      AS day,
              ROUND(COALESCE(d.energy_kwh, 0), 3) AS energy_kwh,
              ROUND(COALESCE(d.revenue, 0), 2)    AS revenue,
              ROUND(COALESCE(d.co2_kg, 0), 3)     AS co2_kg,
              COALESCE(d.peak_power_w, 0)       AS peak_power_w
       FROM m,
            generate_series(m.first_day, (m.first_day + INTERVAL '1 month - 1 day')::date, INTERVAL '1 day') AS g(day)
       LEFT JOIN solar_energy_daily d
              ON d.solar_code = $1 AND d.day = g.day::date
       ORDER BY g.day`,
      [solar_code, month ? `${month}-01` : null, TIMEZONE]
    );
    res.json({ success: true, solar_code, count: result.rowCount, data: result.rows });
  } catch (err) { serverError(res, err); }
});

// GET /api/dashboard/:solar_code/monthly?year=2026
// Charts: Monthly Energy (kWh), Revenue (৳), Carbon Reduction (kg).
// One call returns all three numbers for each of the 12 months.
router.get('/:solar_code/monthly', async (req, res) => {
  const { solar_code } = req.params;
  const { year } = req.query;
  if (year && !/^\d{4}$/.test(year)) {
    return res.status(400).json({ success: false, error: 'year must look like 2026' });
  }

  try {
    const siteCheck = await query('SELECT 1 FROM solar_list WHERE solar_code = $1', [solar_code]);
    if (siteCheck.rowCount === 0) return notFound(res, solar_code);

    const result = await query(
      `WITH y AS (
         SELECT COALESCE($2::int, EXTRACT(YEAR FROM (NOW() AT TIME ZONE $3))::int) AS yr
       )
       SELECT to_char(m.month, 'YYYY-MM')           AS month,
              ROUND(COALESCE(SUM(d.energy_kwh), 0), 3) AS energy_kwh,
              ROUND(COALESCE(SUM(d.revenue), 0), 2)    AS revenue,
              ROUND(COALESCE(SUM(d.co2_kg), 0), 3)     AS co2_kg
       FROM y,
            generate_series(make_date(y.yr, 1, 1), make_date(y.yr, 12, 1), INTERVAL '1 month') AS m(month)
       LEFT JOIN solar_energy_daily d
              ON d.solar_code = $1
             AND d.day >= m.month::date
             AND d.day <  (m.month + INTERVAL '1 month')::date
       GROUP BY m.month
       ORDER BY m.month`,
      [solar_code, year || null, TIMEZONE]
    );
    res.json({ success: true, solar_code, count: result.rowCount, data: result.rows });
  } catch (err) { serverError(res, err); }
});

// GET /api/dashboard/:solar_code/raw?start_date=&end_date=&start_time=&end_time=&limit=&after_created_at=&after_id=
// Raw readings in time order, cursor-paginated (fast on millions of rows).
router.get('/:solar_code/raw', async (req, res) => {
  const { solar_code } = req.params;
  const { start_date, end_date, start_time, end_time, after_created_at, after_id } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 500, 1000);

  if (!start_date || !end_date) {
    return res.status(400).json({ success: false, error: 'start_date and end_date are required (YYYY-MM-DD)' });
  }
  const rangeStart = `${start_date} ${start_time || '00:00:00'}`;
  const rangeEnd   = `${end_date} ${end_time || '23:59:59'}`;
  if (Number.isNaN(Date.parse(rangeStart)) || Number.isNaN(Date.parse(rangeEnd))) {
    return res.status(400).json({ success: false, error: 'Invalid start/end date or time' });
  }

  try {
    const siteCheck = await query('SELECT 1 FROM solar_list WHERE solar_code = $1', [solar_code]);
    if (siteCheck.rowCount === 0) return notFound(res, solar_code);

    // Interpret the dates in the site timezone (Asia/Dhaka), not the server's.
    const params = [solar_code, rangeStart, rangeEnd, TIMEZONE];
    let cursorClause = '';
    if (after_created_at && after_id) {
      params.push(after_created_at, after_id);
      cursorClause = `AND (created_at, id) > ($${params.length - 1}::timestamptz, $${params.length}::bigint)`;
    }
    params.push(limit);

    const result = await query(
      `SELECT * FROM solar_device_data
       WHERE solar_code = $1
         AND created_at BETWEEN ($2::timestamp AT TIME ZONE $4) AND ($3::timestamp AT TIME ZONE $4)
         ${cursorClause}
       ORDER BY created_at ASC, id ASC
       LIMIT $${params.length}`,
      params
    );

    const last = result.rows[result.rows.length - 1];
    const next_cursor = result.rowCount === limit && last ? { created_at: last.created_at, id: last.id } : null;
    res.json({ success: true, solar_code, count: result.rowCount, limit, next_cursor, data: result.rows });
  } catch (err) { serverError(res, err); }
});

module.exports = router;