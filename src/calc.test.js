// Run with: npm test
// Worked examples for every formula in calc.js.
const assert = require('assert');
const c = require('./calc');

// 12 V x 10 A = 120 W
assert.strictEqual(c.powerW(12, 10), 120);
assert.strictEqual(c.powerW(null, 10), 0);
assert.strictEqual(c.powerW(0, 0), 0);

// 120 W for 60 s = 0.002 kWh
assert.strictEqual(c.round(c.energyKwh(120, 60), 6), 0.002);
// a 1-hour gap is capped at 300 s -> 120 W x 300 s = 0.01 kWh
assert.strictEqual(c.round(c.energyKwh(120, 3600, 300), 6), 0.01);

// 10 kWh x 10 ৳ = 100 ৳ ; 10 kWh x 0.55 = 5.5 kg
assert.strictEqual(c.revenue(10, 10), 100);
assert.strictEqual(c.co2Kg(10, 0.55), 5.5);

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