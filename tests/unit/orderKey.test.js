import { describe, it, expect } from "vitest";
import { buildOrderKey } from "../../lib/orderKey.js";

describe("buildOrderKey", () => {
  it("以 後三碼_姓名 組成鍵", () => {
    expect(buildOrderKey("123", "王小明")).toBe("123_王小明");
  });
  it("去除姓名與後三碼前後空白", () => {
    expect(buildOrderKey(" 456 ", " 阿花 ")).toBe("456_阿花");
  });
  it("非法字元以 _ 取代", () => {
    expect(buildOrderKey("789", "A/B.C#D$E[F]")).toBe("789_A_B_C_D_E_F_");
  });
  it("同名同後三碼產生相同鍵（唯一性）", () => {
    expect(buildOrderKey("123", "小美")).toBe(buildOrderKey("123", "小美"));
  });
});
