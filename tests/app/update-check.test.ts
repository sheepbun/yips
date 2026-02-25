import { describe, expect, it, vi } from "vitest";

import { checkForUpdates } from "#app/update-check";

describe("checkForUpdates", () => {
  it("uses local package.json name by default", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: "0.1.1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await checkForUpdates("0.1.1", { fetchImpl });
    expect(result.status).toBe("up-to-date");
    expect(fetchImpl).toHaveBeenCalledWith("https://registry.npmjs.org/%40sheepbun%2Fyips/latest");
  });

  it("returns update-available when registry version is newer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: "0.2.0" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await checkForUpdates("0.1.0", { fetchImpl });
    expect(result.status).toBe("update-available");
    expect(result.latestVersion).toBe("0.2.0");
    expect(result.currentVersion).toBe("0.1.0");
  });

  it("returns up-to-date when versions match", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: "0.1.0" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await checkForUpdates("0.1.0", { fetchImpl });
    expect(result.status).toBe("up-to-date");
    expect(result.latestVersion).toBe("0.1.0");
  });

  it("returns unknown when registry request fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));

    const result = await checkForUpdates("0.1.0", { fetchImpl });
    expect(result.status).toBe("unknown");
    expect(result.latestVersion).toBeNull();
    expect(result.error).toContain("boom");
  });
});
