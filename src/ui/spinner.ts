/** Pulsing braille spinner with color oscillation. */

import { colorText, GRADIENT_PINK, GRADIENT_YELLOW, interpolateColor } from "#ui/colors";
import type { Rgb } from "#ui/colors";

const SPINNER_FRAMES = ["⠹", "⢸", "⣰", "⣤", "⣆", "⡇", "⠏", "⠛"] as const;
const FRAME_COUNT = SPINNER_FRAMES.length;
const OSCILLATION_RATE = 2.0;
const FRAME_INTERVAL_MS = 80;

export class PulsingSpinner {
  private label: string;
  private frameIndex: number;
  private startTime: number;
  private lastFrameTime: number;
  private active: boolean;

  constructor(label = "Thinking...") {
    this.label = label;
    this.frameIndex = 0;
    this.startTime = Date.now();
    this.lastFrameTime = this.startTime;
    this.active = false;
  }

  start(label?: string): void {
    if (label !== undefined) {
      this.label = label;
    }
    this.frameIndex = 0;
    this.startTime = Date.now();
    this.lastFrameTime = this.startTime;
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

  private formatElapsed(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    if (minutes === 0) {
      return `${remainder}s`;
    }
    return `${minutes}m ${remainder}s`;
  }

  render(): string {
    const now = Date.now();
    const elapsedSinceFrame = now - this.lastFrameTime;
    if (elapsedSinceFrame >= FRAME_INTERVAL_MS) {
      const frameSteps = Math.floor(elapsedSinceFrame / FRAME_INTERVAL_MS);
      this.frameIndex = (this.frameIndex + frameSteps) % FRAME_COUNT;
      this.lastFrameTime += frameSteps * FRAME_INTERVAL_MS;
    }
    const frame = SPINNER_FRAMES[this.frameIndex % FRAME_COUNT]!;

    const elapsedSeconds = Math.max(0, (now - this.startTime) / 1000);
    const elapsed = Math.floor(elapsedSeconds);
    const t = (Math.sin(elapsedSeconds * OSCILLATION_RATE) + 1) / 2;
    const color = interpolateColor(GRADIENT_PINK, GRADIENT_YELLOW, t);
    const timeText = this.formatElapsed(elapsed);

    const spinnerChar = colorText(frame, color);
    const labelText = colorText(this.label, color);
    const suffix = colorText(`(${timeText})`, color);

    return `${spinnerChar} ${labelText} ${suffix}`;
  }

  static computeOscillationColor(elapsedSeconds: number): Rgb {
    const t = (Math.sin(elapsedSeconds * OSCILLATION_RATE) + 1) / 2;
    return interpolateColor(GRADIENT_PINK, GRADIENT_YELLOW, t);
  }
}
