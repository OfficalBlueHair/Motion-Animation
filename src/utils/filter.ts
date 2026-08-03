/**
 * A highly responsive Low-Pass Exponential Filter
 */
export class LowPassFilter {
  private lastValue: number | null = null;

  filter(value: number, alpha: number): number {
    if (this.lastValue === null) {
      this.lastValue = value;
      return value;
    }
    const result = alpha * value + (1.0 - alpha) * this.lastValue;
    this.lastValue = result;
    return result;
  }

  reset() {
    this.lastValue = null;
  }
}

/**
 * OneEuroFilter implementation for high-quality skeletal motion capture.
 * Automatically adapts the cutoff frequency based on velocity (derivative)
 * to ensure smoothness when stationary and low-latency when moving fast.
 */
export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private freq: number;
  
  private xFilter: LowPassFilter;
  private dxFilter: LowPassFilter;
  private lastRawValue: number | null = null;
  private lastTime: number | null = null;

  constructor(freq: number = 30, minCutoff: number = 0.5, beta: number = 0.03, dCutoff: number = 1.0) {
    this.freq = freq;
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilter = new LowPassFilter();
    this.dxFilter = new LowPassFilter();
  }

  private calculateAlpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(value: number, timestampMs: number): number {
    let dt = 1.0 / this.freq;
    if (this.lastTime !== null) {
      const computedDt = (timestampMs - this.lastTime) / 1000.0;
      if (computedDt > 0) {
        dt = computedDt;
      }
    }
    this.lastTime = timestampMs;

    // Estimate derivative (rate of change)
    const dValue = this.lastRawValue === null ? 0.0 : (value - this.lastRawValue) / dt;
    this.lastRawValue = value;

    // Filter derivative
    const alphaD = this.calculateAlpha(this.dCutoff, dt);
    const filteredDValue = this.dxFilter.filter(dValue, alphaD);

    // Calculate adaptive cutoff frequency
    const cutoff = this.minCutoff + this.beta * Math.abs(filteredDValue);

    // Filter value
    const alphaX = this.calculateAlpha(cutoff, dt);
    return this.xFilter.filter(value, alphaX);
  }

  reset() {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastRawValue = null;
    this.lastTime = null;
  }
}
