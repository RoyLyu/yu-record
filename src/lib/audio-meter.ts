export const MIN_AUDIO_METER_DB = -60;
export const MAX_AUDIO_METER_DB = 0;

export function calculateRmsDb(samples: Float32Array) {
  if (samples.length === 0) {
    return MIN_AUDIO_METER_DB;
  }

  let sumOfSquares = 0;
  for (const sample of samples) {
    sumOfSquares += sample * sample;
  }

  const rms = Math.sqrt(sumOfSquares / samples.length);
  const db = 20 * Math.log10(Math.max(rms, 0.001));
  return Math.max(MIN_AUDIO_METER_DB, Math.min(MAX_AUDIO_METER_DB, db));
}

export function dbToMeterPercent(db: number) {
  const clamped = Math.max(MIN_AUDIO_METER_DB, Math.min(MAX_AUDIO_METER_DB, db));
  return ((clamped - MIN_AUDIO_METER_DB) /
    (MAX_AUDIO_METER_DB - MIN_AUDIO_METER_DB)) *
    100;
}
