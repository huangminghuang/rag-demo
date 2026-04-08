import { describe, expect, it } from "vitest";
import { resolveAmbiguityGatekeeperConfig } from "./ambiguityGatekeeperConfig";

function asProcessEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

describe("resolveAmbiguityGatekeeperConfig", () => {
  it("resolves deterministic defaults", () => {
    expect(resolveAmbiguityGatekeeperConfig({} as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      modelName: "gemini-2.5-flash",
      apiVersion: "v1beta",
      timeoutMs: 2000,
      debug: false,
    });
  });

  it("resolves explicit overrides", () => {
    expect(
      resolveAmbiguityGatekeeperConfig(
        asProcessEnv({
          AMBIGUITY_GATEKEEPER_ENABLED: "true",
          AMBIGUITY_GATEKEEPER_MODEL_NAME: "gemini-2.5-flash-lite",
          AMBIGUITY_GATEKEEPER_MODEL_API_VERSION: "v1",
          AMBIGUITY_GATEKEEPER_TIMEOUT_MS: "1500",
          AMBIGUITY_GATEKEEPER_DEBUG: "true",
        }),
      ),
    ).toEqual({
      enabled: true,
      modelName: "gemini-2.5-flash-lite",
      apiVersion: "v1",
      timeoutMs: 1500,
      debug: true,
    });
  });

  it("rejects invalid timeout values", () => {
    expect(() =>
      resolveAmbiguityGatekeeperConfig(
        asProcessEnv({
          AMBIGUITY_GATEKEEPER_TIMEOUT_MS: "0",
        }),
      ),
    ).toThrow("AMBIGUITY_GATEKEEPER_TIMEOUT_MS must be a positive integer");

    expect(() =>
      resolveAmbiguityGatekeeperConfig(
        asProcessEnv({
          AMBIGUITY_GATEKEEPER_TIMEOUT_MS: "1.5",
        }),
      ),
    ).toThrow("AMBIGUITY_GATEKEEPER_TIMEOUT_MS must be a positive integer");

    expect(() =>
      resolveAmbiguityGatekeeperConfig(
        asProcessEnv({
          AMBIGUITY_GATEKEEPER_TIMEOUT_MS: "2000ms",
        }),
      ),
    ).toThrow("AMBIGUITY_GATEKEEPER_TIMEOUT_MS must be a positive integer");
  });
});
