import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateRmsDb,
  dbToMeterPercent,
  MIN_AUDIO_METER_DB,
} from "./audio-meter.ts";

test("silence stays at the meter floor", () => {
  assert.equal(calculateRmsDb(new Float32Array(128)), MIN_AUDIO_METER_DB);
});

test("full-scale samples read 0 dBFS", () => {
  assert.equal(calculateRmsDb(new Float32Array(128).fill(1)), 0);
});

test("half-scale samples read approximately -6 dBFS", () => {
  const reading = calculateRmsDb(new Float32Array(128).fill(0.5));
  assert.ok(reading > -6.1 && reading < -6);
});

test("dB values map to the visible meter range", () => {
  assert.equal(dbToMeterPercent(-60), 0);
  assert.equal(dbToMeterPercent(-30), 50);
  assert.equal(dbToMeterPercent(0), 100);
  assert.equal(dbToMeterPercent(12), 100);
});
