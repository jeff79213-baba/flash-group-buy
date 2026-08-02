import { describe, it, expect } from "vitest";
import { MAX_EDITS, canEdit, canDelete, remainingEdits } from "../../lib/editlimit.js";

describe("editlimit", () => {
  it("MAX_EDITS 為 3", () => {
    expect(MAX_EDITS).toBe(3);
  });
  it("未達上限可改/刪", () => {
    expect(canEdit(0)).toBe(true);
    expect(canDelete(2)).toBe(true);
  });
  it("達上限不可改/刪", () => {
    expect(canEdit(3)).toBe(false);
    expect(canDelete(3)).toBe(false);
  });
  it("剩餘次數計算", () => {
    expect(remainingEdits(1)).toBe(2);
    expect(remainingEdits(4)).toBe(0);
  });
});
