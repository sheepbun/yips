/** Pulsing braille spinner with color oscillation. */

import { colorText, DIM_GRAY, GRADIENT_PINK, GRADIENT_YELLOW, interpolateColor } from "./colors";
import type { Rgb } from "./colors";

const SPINNER_FRAMES = ["⠹", "⢸", "⣰", "⣤", "⣆", "⡇", "⠏", "⠛"] as const;
const FRAME_COUNT = SPINNER_FRAMES.length;
const OSCILLATION_HZ = 2;

export class PulsingSpinner {
  private label: string;
  private frameIndex: number;
  private startTime: number;
  private active: boolean;

  constructor(label = "Thinking...") {
    this.label = label;
    this.frameIndex = 0;
    this.startTime = Date.now();
    this.active = false;
  }

  start(label?: string): void {
    if (label !== undefined) {
      this.label = label;
    }
    this.frameIndex = 0;
    this.startTime = Date.now();
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  update(label: string): void {
    this.label = label;
  }

  isActive(): boolean {
    return this.active;
  }

  getElapsed(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  render(): string {
    const frame = SPINNER_FRAMES[this.frameIndex % FRAME_COUNT]!;
    this.frameIndex = (this.frameIndex + 1) % FRAME_COUNT;

    const elapsed = this.getElapsed();
    const t = (Math.sin(elapsed * Math.PI * OSCILLATION_HZ) + 1) / 2;
    const color = interpolateColor(GRADIENT_PINK, GRADIENT_YELLOW, t);

    const spinnerChar = colorText(frame, color);
    const labelText = colorText(this.label, color);
    const suffix = colorText(`(${elapsed}s)`, DIM_GRAY);

    return `${spinnerChar} ${labelText} ${suffix}`;
  }

  static computeOscillationColor(elapsedSeconds: number): Rgb {
    const t = (Math.sin(elapsedSeconds * Math.PI * OSCILLATION_HZ) + 1) / 2;
    return interpolateColor(GRADIENT_PINK, GRADIENT_YELLOW, t);
  }
}
