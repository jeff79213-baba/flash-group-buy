import { describe, it, expect } from "vitest";
import { generateShareCode, isShareCodeValid } from "../../lib/sharecode.js";

describe("generateShareCode", () => {
  it("產生前3碼+3亂碼，共6碼", () => {
    const code = generateShareCode("MAY2025");
    expect(code).toMatch(/^MAY[A-Z0-9]{3}$/);
  });
  it("代碼太短時拋錯", () => {
    expect(() => generateShareCode("AB")).toThrow();
  });
  it("分享碼與原代碼不同", () => {
    expect(generateShareCode("MAY2025")).not.toBe("MAY2025");
  });
});

describe("isShareCodeValid", () => {
  it("以代碼前3碼開頭為有效", () => {
    expect(isShareCodeValid("MAYXYZ", "MAY2025")).toBe(true);
  });
  it("不以代碼前3碼開頭為無效", () => {
    expect(isShareCodeValid("ABCXYZ", "MAY2025")).toBe(false);
  });
});
