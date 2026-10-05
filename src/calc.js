// src/calc.js — every formula in one place.

// Battery SOC range, as a share of the battery's rated voltage (solar_list.battery_voltage).
// For a 12 V battery: 11.5 V = 0 %  and  12.8 V = 100 %. A 24 V battery scales to 23 V / 25.6 V.
// Lead-acid vs lithium differ — change these two numbers for your battery type.
const EMPTY_VOLT_RATIO = 11.5 / 12;
const FULL_VOLT_RATIO  = 12.8 / 12;

function powerW(solarVoltage, solarCurrent) {
  if (solarVoltage == null || solarCurrent == null) return 0;
  const p = solarVoltage * solarCurrent;
  return p > 0 ? round(p, 2) : 0;
}

function energyKwh(power_w, gapSec, maxGapSec = 300) {
  const sec = Math.min(Math.max(gapSec, 0), maxGapSec);
  return (power_w * sec) / 3600 / 1000;
}

function revenue(kwh, tariffPerKwh) {
  return kwh * tariffPerKwh;
}

function co2Kg(kwh, co2PerKwh) {
  return kwh * co2PerKwh;
}

// batteryVolt = live reading, ratedVolt = solar_list.battery_voltage
function socPercent(batteryVolt, ratedVolt) {
  if (batteryVolt == null || !ratedVolt) return null;
  const empty = ratedVolt * EMPTY_VOLT_RATIO;
  const full  = ratedVolt * FULL_VOLT_RATIO;
  const pct = ((batteryVolt - empty) / (full - empty)) * 100;
  return round(Math.min(100, Math.max(0, pct)), 2);
}

// Hours the battery can keep supplying the CURRENT discharge rate.
// capacityAh = solar_list.battery_capacity, batteryCurrent = live battery_current (A).
// positiveIsDischarge: does a positive battery_current mean the battery is discharging?
// Returns null when the battery is charging / idle (there is no "backup time" then).
function backupHours(soc, capacityAh, batteryCurrent, positiveIsDischarge = true) {
  if (soc == null || !capacityAh || batteryCurrent == null) return null;
  const dischargeA = positiveIsDischarge ? batteryCurrent : -batteryCurrent;
  if (dischargeA <= 0) return null;
  const ahLeft = capacityAh * (soc / 100);
  return round(ahLeft / dischargeA, 2);
}

function round(n, digits) {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

module.exports = { powerW, energyKwh, revenue, co2Kg, socPercent, backupHours, round };