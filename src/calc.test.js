// Run with: npm test
// Worked examples for every formula in calc.js.
const assert = require('assert');
const c = require('./calc');

// 12 V x 10 A = 120 W
assert.strictEqual(c.powerW(12, 10), 120);
assert.strictEqual(c.powerW(null, 10), 0);
assert.strictEqual(c.powerW(0, 0), 0);

// Running average: 1st = P1, then (previous avg + new power) / 2
assert.strictEqual(c.runningAvgPower(null, 120), 120);
assert.strictEqual(c.runningAvgPower(120, 200), 160);   // (120 + 200) / 2
assert.strictEqual(c.runningAvgPower(160, 100), 130);   // (160 + 100) / 2

// Energy: avg 160 W for 120 s = 160 x (120/3600) = 5.3333 Wh = 0.005333 kWh
assert.strictEqual(c.round(c.energyKwh(160, 120), 6), 0.005333);
// first reading: data_time 0 -> 0 kWh
assert.strictEqual(c.energyKwh(120, 0), 0);
// a gap above the limit is cut: 120 W, 3600 s, limit 300 s -> 0.01 kWh
assert.strictEqual(c.round(c.energyKwh(120, 3600, 300), 6), 0.01);
// no limit when maxGap is 0
assert.strictEqual(c.round(c.energyKwh(120, 3600, 0), 6), 0.12);

// Revenue = kWh x 15.36 ; Carbon = kWh x 0.62
assert.strictEqual(c.UNIT_RATE, 15.36);
assert.strictEqual(c.CARBON_FACTOR, 0.62);
assert.strictEqual(c.round(c.revenue(10), 2), 153.6);
assert.strictEqual(c.round(c.co2Kg(10), 2), 6.2);

// SOC on a 12 V battery: 11.5 V = 0 %, 12.8 V = 100 %
assert.strictEqual(c.socPercent(12.8, 12), 100);
assert.strictEqual(c.socPercent(11.5, 12), 0);
assert.strictEqual(c.socPercent(12.15, 12), 50);
assert.strictEqual(c.socPercent(13.5, 12), 100); // clamped
assert.strictEqual(c.socPercent(10, 12), 0);     // clamped
assert.strictEqual(c.socPercent(null, 12), null);
assert.strictEqual(c.socPercent(12.15, null), null);
// 24 V battery scales: 24.3 V is 50 %
assert.strictEqual(c.socPercent(24.3, 24), 50);

// 100 Ah at 50 % = 50 Ah left ; drawing 10 A -> 5 h
assert.strictEqual(c.backupHours(50, 100, 10), 5);
assert.strictEqual(c.backupHours(50, 100, -10, false), 5);   // negative = discharging
assert.strictEqual(c.backupHours(50, 100, -10), null);       // charging -> no backup time
assert.strictEqual(c.backupHours(50, 100, 0), null);
assert.strictEqual(c.backupHours(50, null, 10), null);
assert.strictEqual(c.backupHours(null, 100, 10), null);

console.log('calc.js — all examples passed');