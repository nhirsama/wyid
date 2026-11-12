import { describe, expect, it } from "vitest";
import { decodeAccountSegments } from "@/lib/account/routes";

describe("native application IDs in catch-all routes", () => {
  it.each(["project:app", "project%3Aapp"])("normalizes a native resource pair exactly once: %s", id => {
    expect(decodeAccountSegments(["apps", id])).toEqual(["apps", "project:app"]);
  });
  it.each(["%2Fapps", "%5Capps", "%00", "%0A", "%ZZ", ".", "..", "%2e%2e"])("rejects unsafe segments: %s", value => {
    expect(() => decodeAccountSegments(["apps", value])).toThrow();
  });
  it("does not recursively decode double-encoded resource IDs", () => {
    expect(decodeAccountSegments(["apps", "project%253Aapp"])).toEqual(["apps", "project%3Aapp"]);
  });
});
