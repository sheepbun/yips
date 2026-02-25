import { describe, expect, it, vi } from "vitest";

import { PulsingSpinner } from "#ui/spinner";
import { stripMarkup } from "#ui/title-box";

describe("PulsingSpinner", () => {
  it("starts inactive by default", () => {
    const spinner = new PulsingSpinner();
    expect(spinner.isActive()).toBe(false);
  });

  it("becomes active after start()", () => {
    const spinner = new PulsingSpinner();
    spinner.start();
    expect(spinner.isActive()).toBe(true);
  });

  it("becomes inactive after stop()", () => {
    const spinner = new PulsingSpinner();
    spinner.start();
    spinner.stop();
    expect(spinner.isActive()).toBe(false);
  });

  it("renders a frame with label and elapsed time", () => {
    const spinner = new PulsingSpinner("Thinking...");
    spinner.start();
    const result = spinner.render();
    const plain = stripMarkup(result);

    expect(plain).toContain("Thinking...");
    expect(plain).toMatch(/\(\d+s\)/);
  });

  it("formats elapsed time as minutes when over 60 seconds", () => {
    const nowSpy = vi.spyOn(Date, "now");
    try {
      nowSpy.mockReturnValue(1_000);
      const spinner = new PulsingSpinner("Thinking...");
      spinner.start();

      nowSpy.mockReturnValue(66_000);
      const plain = stripMarkup(spinner.render());
      expect(plain).toContain("(1m 5s)");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("cycles through frames on successive renders", () => {
    const nowSpy = vi.spyOn(Date, "now");
    try {
      nowSpy.mockReturnValue(1_000);
      const spinner = new PulsingSpinner("test");
      spinner.start();

      const frame1 = stripMarkup(spinner.render());
      nowSpy.mockReturnValue(1_080);
      const frame2 = stripMarkup(spinner.render());

      expect(frame1[0]).not.toBe(frame2[0]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("updates label", () => {
    const spinner = new PulsingSpinner("old");
    spinner.start();
    spinner.update("new label");
    const result = stripMarkup(spinner.render());
    expect(result).toContain("new label");
  });

  it("can override label on start()", () => {
    const spinner = new PulsingSpinner("default");
    spinner.start("override");
    const result = stripMarkup(spinner.render());
    expect(result).toContain("override");
  });

  it("computeOscillationColor returns valid RGB", () => {
    const color = PulsingSpinner.computeOscillationColor(0);
    expect(color.r).toBeGreaterThanOrEqual(0);
    expect(color.r).toBeLessThanOrEqual(255);
    expect(color.g).toBeGreaterThanOrEqual(0);
    expect(color.g).toBeLessThanOrEqual(255);
    expect(color.b).toBeGreaterThanOrEqual(0);
    expect(color.b).toBeLessThanOrEqual(255);
  });

  it("oscillation color changes at sub-second intervals", () => {
    const early = PulsingSpinner.computeOscillationColor(0);
    const later = PulsingSpinner.computeOscillationColor(0.25);

    expect(early).not.toEqual(later);
  });
});
