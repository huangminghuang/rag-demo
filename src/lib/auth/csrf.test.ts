import { describe, expect, it } from "vitest";

describe("csrf helpers", () => {
  it("allows safe methods without CSRF header", async () => {
    const { requireCsrf } = await import("./csrf");
    const req = new Request("http://localhost:3000/api/test", { method: "GET" });
    expect(requireCsrf(req)).toBeNull();
  });

  it("rejects missing CSRF token on mutating method", async () => {
    const { requireCsrf } = await import("./csrf");
    const req = new Request("http://localhost:3000/api/test", { method: "POST" });
    const result = requireCsrf(req);
    expect(result?.status).toBe(403);
  });

  it("accepts matching CSRF cookie and header on mutating method", async () => {
    const { requireCsrf } = await import("./csrf");
    const token = "csrf-token-123";
    const req = new Request("http://localhost:3000/api/test", {
      method: "POST",
      headers: {
        cookie: `csrf_token=${token}`,
        "x-csrf-token": token,
      },
    });
    expect(requireCsrf(req)).toBeNull();
  });
});
