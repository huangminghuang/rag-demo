import { describe, expect, it } from "vitest";
import { resolveIngestionAdminOptions } from "./admin";

describe("resolveIngestionAdminOptions", () => {
  it("uses explicit forceReindex when requested by an admin-triggered ingestion payload", () => {
    expect(
      resolveIngestionAdminOptions(
        {
          limit: 25,
          productFilter: "fortnite",
          forceReindex: true,
        },
        {
          CRAWL_LIMIT: "10",
          PRODUCT_FILTER: "unreal-engine",
        } as NodeJS.ProcessEnv,
      ),
    ).toEqual({
      limit: 25,
      productFilter: "fortnite",
      forceReindex: true,
    });
  });

  it("falls back to env defaults when admin payload values are absent or invalid", () => {
    expect(
      resolveIngestionAdminOptions(
        {
          limit: "not-a-number",
          forceReindex: false,
        },
        {
          CRAWL_LIMIT: "12",
          PRODUCT_FILTER: "unreal-engine",
        } as NodeJS.ProcessEnv,
      ),
    ).toEqual({
      limit: 12,
      productFilter: "unreal-engine",
      forceReindex: false,
    });
  });
});
