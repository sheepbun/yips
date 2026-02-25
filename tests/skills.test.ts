import { describe, expect, it, vi } from "vitest";

import { executeFetchSkill, executeSearchSkill, executeSkillCall } from "../src/skills";
import type { SkillCall } from "../src/types";

describe("skills", () => {
  it("executeSearchSkill parses duckduckgo html results", async () => {
    const html = [
      '<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpost">Example Post</a>',
      '<a class="result__a" href="https://example.org">Example Org</a>'
    ].join("\n");

    const output = await executeSearchSkill(
      { query: "example", maxResults: 2 },
      vi.fn().mockResolvedValue(
        new Response(html, {
          status: 200,
          headers: { "content-type": "text/html" }
        })
      ) as unknown as typeof fetch
    );

    expect(output).toContain("Search results for: example");
    expect(output).toContain("Example Post");
    expect(output).toContain("https://example.com/post");
    expect(output).toContain("https://example.org/");
  });

  it("executeFetchSkill normalizes html and supports truncation", async () => {
    const output = await executeFetchSkill(
      { url: "https://example.com", maxChars: 20 },
      vi.fn().mockResolvedValue(
        new Response("<html><body>Hello <b>world</b> and beyond</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })
      ) as unknown as typeof fetch
    );

    expect(output).toContain("Fetched: https://example.com/");
    expect(output).toContain("Hello world and beyo");
    expect(output).toContain("[truncated at 20 chars]");
  });

  it("executeSkillCall runs build through vt session", async () => {
    const vtSession = {
      runCommand: vi.fn().mockResolvedValue({
        exitCode: 0,
        output: "Build complete.",
        timedOut: false
      })
    };

    const call: SkillCall = {
      id: "sk-1",
      name: "build",
      arguments: { command: "npm run build" }
    };

    const result = await executeSkillCall(call, {
      workingDirectory: process.cwd(),
      vtSession: vtSession as never
    });

    expect(vtSession.runCommand).toHaveBeenCalledWith("npm run build", expect.any(Object));
    expect(result.status).toBe("ok");
    expect(result.output).toContain("Build command: npm run build");
  });

  it("executeSkillCall validates virtual_terminal command", async () => {
    const call: SkillCall = {
      id: "sk-2",
      name: "virtual_terminal",
      arguments: {}
    };

    const result = await executeSkillCall(call, {
      workingDirectory: process.cwd(),
      vtSession: { runCommand: vi.fn() } as never
    });

    expect(result.status).toBe("error");
    expect(result.output).toContain("requires a non-empty 'command'");
  });
});
