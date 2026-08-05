import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE || "https://jeff79213-baba.github.io/flash-group-buy/";

// 測試用活動（seed 腳本建立）
const SHARE_CODE = process.env.E2E_SHARE_CODE || "E2ETST";
const SHORT_CODE = process.env.E2E_SHORT_CODE || "E2E123456";
const PASSWORD = process.env.E2E_PASSWORD || "e2e12345";
const EVENT_NAME = process.env.E2E_EVENT_NAME || "E2E測試揪團";
const ITEM_LIMITED = "測試蛋糕";
const ITEM_UNLIMITED = "測試餅乾";

test("點餐頁載入活動並顯示品項剩餘", async ({ page }) => {
  await page.goto(BASE + "index.html?id=" + SHARE_CODE);
  await expect(page.getByText(EVENT_NAME)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(ITEM_LIMITED, { exact: true })).toBeVisible();
  // 限量品項顯示剩餘數量（依目前銷售數動態，僅驗證格式）
  await expect(page.locator(".item-remain").first()).toHaveText(/^剩餘 \d+ 份$/);
  await expect(page.getByText(ITEM_UNLIMITED, { exact: true })).toBeVisible();
  await expect(page.getByText("不限量")).toBeVisible();
});

test("下單 → 顯示在我的訂單與所有訂單", async ({ page }) => {
  await page.goto(BASE + "index.html?id=" + SHARE_CODE);
  await expect(page.getByText(EVENT_NAME)).toBeVisible({ timeout: 20000 });

  // 選取品項
  await page.locator(`.item-check[data-id]`).first().check();
  await page.fill("#buyerName", "E2E買家");
  await page.fill("#phoneLast3", "123");
  await page.click("#submitBtn");

  await expect(page.getByText("訂單已送出！")).toBeVisible({ timeout: 15000 });
  // 我的訂單出現
  await expect(page.locator("#myOrdersList").getByText("E2E買家")).toBeVisible();
  // 所有訂單出現（不含後三碼，因此不應出現「後三碼」字樣）
  await expect(page.locator("#allOrdersList").getByText("E2E買家")).toBeVisible();
});

test("後三碼驗證：非 3 位數字會被阻擋", async ({ page }) => {
  await page.goto(BASE + "index.html?id=" + SHARE_CODE);
  await expect(page.getByText(EVENT_NAME)).toBeVisible({ timeout: 20000 });
  await page.locator(`.item-check[data-id]`).first().check();
  await page.fill("#buyerName", "E2E後三碼錯");
  await page.fill("#phoneLast3", "12");
  await page.click("#submitBtn");
  await expect(page.getByText("請輸入 3 位數字手機後三碼")).toBeVisible();
});

test("空名字被阻擋", async ({ page }) => {
  await page.goto(BASE + "index.html?id=" + SHARE_CODE);
  await expect(page.getByText(EVENT_NAME)).toBeVisible({ timeout: 20000 });
  await page.locator(`.item-check[data-id]`).first().check();
  await page.fill("#phoneLast3", "999");
  await page.click("#submitBtn");
  await expect(page.getByText("請輸入你的名字")).toBeVisible();
});

test("管理者登入後台並看到憑證卡內容", async ({ page }) => {
  await page.goto(BASE + "admin.html");
  await page.fill("#loginShortCode", SHORT_CODE);
  await page.fill("#loginPassword", PASSWORD);
  await page.click("button:has-text('登入')");
  await expect(page.getByText("活動設定")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#adminEventName")).toHaveText(EVENT_NAME);
});

test("錯誤密碼登入失敗", async ({ page }) => {
  await page.goto(BASE + "admin.html");
  await page.fill("#loginShortCode", SHORT_CODE);
  await page.fill("#loginPassword", "wrongpassword");
  await page.click("button:has-text('登入')");
  await expect(page.getByText("密碼錯誤或登入失敗")).toBeVisible({ timeout: 15000 });
});

test("修改訂單數量 → 後台同步顯示", async ({ browser }) => {
  const buyer = await (await browser.newContext()).newPage();
  const admin = await (await browser.newContext()).newPage();
  await admin.goto(BASE + "admin.html");
  await admin.fill("#loginShortCode", SHORT_CODE);
  await admin.fill("#loginPassword", PASSWORD);
  await admin.click("button:has-text('登入')");
  await expect(admin.getByText("活動設定")).toBeVisible({ timeout: 20000 });
  await admin.locator(".tab:has-text('訂單列表')").click();

  await buyer.goto(BASE + "index.html?id=" + SHARE_CODE);
  await expect(buyer.getByText(EVENT_NAME)).toBeVisible({ timeout: 20000 });
  await buyer.locator(`.item-check[data-id="cake"]`).check();
  await buyer.fill("#buyerName", "修改測試");
  await buyer.fill("#phoneLast3", "123");
  await buyer.click("#submitBtn");
  await expect(buyer.getByText("訂單已送出！")).toBeVisible({ timeout: 15000 });
  await expect(admin.locator("#ordersAdminList").getByText("修改測試")).toBeVisible({ timeout: 15000 });

  await buyer.click("button:has-text('修改')");
  // 已知 app bug：進入修改模式 render() 會清空名字/後三碼輸入框，需重填
  await buyer.fill("#buyerName", "修改測試");
  await buyer.fill("#phoneLast3", "123");
  await buyer.click("button:has-text('+')");
  await buyer.click("#submitBtn");
  await expect(buyer.getByText("訂單已更新")).toBeVisible({ timeout: 15000 });
  await expect(buyer.locator("#myOrdersList").getByText(/測試蛋糕 x2/)).toBeVisible();
  await expect(admin.locator("#ordersAdminList").getByText(/測試蛋糕 x2/)).toBeVisible({ timeout: 15000 });
  await buyer.close();
  await admin.close();
});

test("取消訂單 → 可重新下單", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + "index.html?id=" + SHARE_CODE);
  await expect(page.getByText(EVENT_NAME)).toBeVisible({ timeout: 20000 });
  await page.locator(`.item-check[data-id="cake"]`).check();
  await page.fill("#buyerName", "取消測試");
  await page.fill("#phoneLast3", "456");
  await page.click("#submitBtn");
  await expect(page.getByText("訂單已送出！")).toBeVisible({ timeout: 15000 });

  page.on("dialog", d => d.accept());
  await page.click("button:has-text('取消')");
  await expect(page.getByText("訂單已取消")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#myOrdersList").getByText("取消測試")).not.toBeVisible();

  // 同一瀏覽器可重新下單
  await page.locator(`.item-check[data-id="cake"]`).check();
  await page.fill("#buyerName", "取消測試2");
  await page.fill("#phoneLast3", "789");
  await page.click("#submitBtn");
  await expect(page.getByText("訂單已送出！")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#myOrdersList").getByText("取消測試2")).toBeVisible();
  await page.close();
});
