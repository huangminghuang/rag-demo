import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_OAUTH_JSON_PATH;
}

async function loadModule() {
  vi.resetModules();
  return import("./googleOAuthCredentials");
}

afterEach(() => {
  resetEnv();
  vi.restoreAllMocks();
});

describe("getGoogleOAuthCredentials", () => {
  it("uses environment variables when both are set", async () => {
    process.env.GOOGLE_CLIENT_ID = "env-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "env-client-secret";

    const { getGoogleOAuthCredentials } = await loadModule();
    const credentials = getGoogleOAuthCredentials();

    expect(credentials).toEqual({
      clientId: "env-client-id",
      clientSecret: "env-client-secret",
      source: "env",
    });
  });

  it("falls back to .secrets/google_oauth.json when env vars are missing", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-fallback-"));
    const secretsDir = path.join(tempDir, ".secrets");
    fs.mkdirSync(secretsDir, { recursive: true });

    const oauthFile = path.join(secretsDir, "google_oauth.json");
    fs.writeFileSync(
      oauthFile,
      JSON.stringify({
        web: {
          client_id: "file-client-id",
          client_secret: "file-client-secret",
        },
      }),
      "utf8"
    );

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);

    const { getGoogleOAuthCredentials } = await loadModule();
    const credentials = getGoogleOAuthCredentials();

    expect(credentials).toEqual({
      clientId: "file-client-id",
      clientSecret: "file-client-secret",
      source: "file",
    });

    cwdSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("throws when no env credentials and no valid fallback file", async () => {
    process.env.GOOGLE_OAUTH_JSON_PATH = ".secrets/does-not-exist.json";

    const { getGoogleOAuthCredentials } = await loadModule();

    expect(() => getGoogleOAuthCredentials()).toThrow(
      /Google OAuth credentials not found/
    );
  });
});
