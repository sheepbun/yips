import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDefaultConfig } from "#config/config";

const applyHardwareAwareStartupModelSelection = vi.fn().mockResolvedValue(undefined);
const ensureFreshLlamaSessionOnStartup = vi.fn().mockResolvedValue(undefined);
const createInkApp = vi.fn();
const render = vi.fn();
const waitUntilExit = vi.fn().mockResolvedValue(undefined);
const stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

let restartFromRender = false;
let transcriptFromRender: readonly string[] = ["title", "chat", "prompt"];

vi.mock("#app/version", () => ({
  getVersion: vi.fn().mockResolvedValue("test-version")
}));

vi.mock("#ui/tui/startup", () => ({
  applyHardwareAwareStartupModelSelection,
  ensureFreshLlamaSessionOnStartup
}));

vi.mock("#ui/tui/app", () => ({
  createInkApp,
  InkModule: {}
}));

vi.mock("ink", () => ({
  render
}));

describe("startTui exit transcript dump", () => {
  beforeEach(() => {
    restartFromRender = false;
    transcriptFromRender = ["title", "chat", "prompt"];
    applyHardwareAwareStartupModelSelection.mockClear();
    ensureFreshLlamaSessionOnStartup.mockClear();
    createInkApp.mockReset();
    render.mockReset();
    waitUntilExit.mockClear();
    stdoutWriteSpy.mockClear();

    createInkApp.mockReturnValue(() => null);
    render.mockImplementation((node: { props: Record<string, unknown> }) => {
      const props = node.props as {
        onRestartRequested: () => void;
        onExitTranscript: (lines: readonly string[]) => void;
      };
      props.onExitTranscript(transcriptFromRender);
      if (restartFromRender) {
        props.onRestartRequested();
      }
      return {
        waitUntilExit
      };
    });
  });

  it("prints transcript to stdout on true exit", async () => {
    const { startTui } = await import("#ui/tui/start-tui");
    const result = await startTui({ config: getDefaultConfig() });

    expect(result).toBe("exit");
    expect(stdoutWriteSpy).toHaveBeenCalledWith("title\nchat\nprompt\n");
  });

  it("does not print transcript when restart is requested", async () => {
    restartFromRender = true;

    const { startTui } = await import("#ui/tui/start-tui");
    const result = await startTui({ config: getDefaultConfig() });

    expect(result).toBe("restart");
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });
});
