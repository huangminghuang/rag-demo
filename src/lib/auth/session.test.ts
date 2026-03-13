import { describe, expect, it } from "vitest";

describe("session token", () => {
  it("creates and parses a valid session token", async () => {
    process.env.AUTH_SESSION_SECRET = "test-secret";

    const { createSessionToken, parseSessionToken } = await import("./session");
    const token = createSessionToken({
      id: "user-1",
      email: "user@example.com",
      name: "Test User",
      role: "user",
    });

    const user = parseSessionToken(token);
    expect(user).toMatchObject({
      id: "user-1",
      email: "user@example.com",
      name: "Test User",
      role: "user",
    });
  });

  it("rejects tampered token", async () => {
    process.env.AUTH_SESSION_SECRET = "test-secret";

    const { createSessionToken, parseSessionToken } = await import("./session");
    const token = createSessionToken({
      id: "user-1",
      email: "user@example.com",
      name: "Test User",
      role: "user",
    });

    const tampered = `${token}tamper`;
    const user = parseSessionToken(tampered);
    expect(user).toBeNull();
  });
});
