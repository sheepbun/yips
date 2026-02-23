import { describe, expect, it } from "vitest";

import { PulsingSpinner } from "../src/spinner";
import { stripMarkup } from "../src/title-box";

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

  it("cycles through frames on successive renders", () => {
    const spinner = new PulsingSpinner("test");
    spinner.start();

    const frame1 = stripMarkup(spinner.render());
    const frame2 = stripMarkup(spinner.render());

    expect(frame1[0]).not.toBe(frame2[0]);
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
});
