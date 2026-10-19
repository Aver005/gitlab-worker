import { describe, it, expect } from "bun:test";
import { buildTimeTrackingWidget } from "../src/api.ts";

describe("buildTimeTrackingWidget", () => {
  it("returns undefined when nothing is set", () => {
    expect(buildTimeTrackingWidget({})).toBeUndefined();
    expect(buildTimeTrackingWidget({ spendSummary: "x" })).toBeUndefined();
  });

  it("puts estimate and spend into one widget", () => {
    expect(
      buildTimeTrackingWidget({ estimate: "3h", spend: "1h30m", spendSummary: "review" })
    ).toEqual({
      timeEstimate: "3h",
      timelog: { timeSpent: "1h30m", summary: "review" },
    });
  });

  it("omits an empty summary", () => {
    expect(buildTimeTrackingWidget({ spend: "2h" })).toEqual({
      timelog: { timeSpent: "2h" },
    });
  });

  it("validates durations", () => {
    expect(() => buildTimeTrackingWidget({ estimate: "two hours" })).toThrow();
    expect(() => buildTimeTrackingWidget({ spend: "1x" })).toThrow();
  });
});
