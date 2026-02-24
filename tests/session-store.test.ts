import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fakeHome = "";

async function loadSessionStore() {
  vi.resetModules();
  vi.doMock("node:os", () => ({
    homedir: () => fakeHome
  }));
  return import("../src/session-store.js");
}

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "yips-session-store-"));
});

afterEach(async () => {
  vi.doUnmock("node:os");
  vi.resetModules();
  if (fakeHome) {
    await rm(fakeHome, { recursive: true, force: true });
  }
});

describe("session-store", () => {
  it("slugifies first user message for session name", async () => {
    const store = await loadSessionStore();
    expect(store.slugifySessionNameFromMessage("Fix /sessions + title box today!")).toBe(
      "fix_sessions_title_box_today"
    );
    expect(store.slugifySessionNameFromMessage("!!!")).toBe("session");
  });

  it("creates, writes, lists, and loads sessions", async () => {
    const store = await loadSessionStore();
    const history = [
      { role: "user", content: "Implement /sessions for me" },
      { role: "assistant", content: "Done, loading list now." }
    ] as const;

    const created = await store.createSessionFileFromHistory(history, new Date("2026-02-24T03:12:45"));
    await store.writeSessionFile({
      path: created.path,
      username: "Katherine",
      history
    });

    const sessions = await store.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionName).toBe("implement_sessions_for_me");
    expect(sessions[0]?.display).toContain("Implement Sessions For Me");

    const loaded = await store.loadSession(created.path);
    expect(loaded.sessionName).toBe("implement_sessions_for_me");
    expect(loaded.history).toEqual([
      { role: "user", content: "Implement /sessions for me" },
      { role: "assistant", content: "Done, loading list now." }
    ]);
  });

  it("lists newest sessions first", async () => {
    const store = await loadSessionStore();
    const oldOne = await store.createSessionFileFromHistory(
      [{ role: "user", content: "old one" }],
      new Date("2026-02-24T01:00:00")
    );
    const newOne = await store.createSessionFileFromHistory(
      [{ role: "user", content: "new one" }],
      new Date("2026-02-24T02:00:00")
    );

    await store.writeSessionFile({
      path: oldOne.path,
      username: "Katherine",
      history: [{ role: "user", content: "old one" }]
    });
    await store.writeSessionFile({
      path: newOne.path,
      username: "Katherine",
      history: [{ role: "user", content: "new one" }]
    });

    const sessions = await store.listSessions();
    expect(sessions[0]?.sessionName).toBe("new_one");
    expect(sessions[1]?.sessionName).toBe("old_one");
  });
});
