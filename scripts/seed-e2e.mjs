// E2E 測試活動 seed：使用 firebase CLI 已登入使用者的 OAuth access token 直接操作
// flash-group-buy-sk 的 Firestore REST API（等同管理員全權）。
// 不依賴匿名登入（避免 REST 匿名 signUp 被 Firebase 限流）。
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = "https://firestore.googleapis.com/v1/projects/flash-group-buy-sk/databases/(default)/documents";
const evId = "E2ETST";

// 讀 firebase CLI 快取的 access token
const config = JSON.parse(readFileSync(join(homedir(), ".config", "configstore", "firebase-tools.json"), "utf8"));
const TOKEN = config.tokens.access_token;
const H = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" };

async function j(r) { const t = await r.text(); try { return JSON.parse(t); } catch { return { _html: t.slice(0, 200) }; } }

(async () => {
  // 清舊資料（orders / rate_limits / counters）
  for (const sub of ["orders", "rate_limits", "counters"]) {
    const url = BASE + "/fgq_events/" + evId + "/" + sub;
    const r = await fetch(url + "?pageSize=300", { headers: H });
    const data = await j(r);
    for (const d of data.documents || []) {
      // d.name 已是完整 REST 路徑（projects/.../documents/...），中文段由 fetch 自動編碼
      const r = await fetch("https://firestore.googleapis.com/v1/" + d.name, { method: "DELETE", headers: H });
      if (r.status !== 200) console.log("  delete fail", d.name, r.status);
    }
    console.log("cleared", sub);
  }
  // 活動本體
  await fetch(BASE + "/fgq_events/" + evId, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ fields: { name: { stringValue: "E2E測試揪團" }, shortCode: { stringValue: "E2E123456" }, shareCode: { stringValue: "E2ETST" }, createdAt: { timestampValue: new Date().toISOString() } } })
  });
  // 管理密碼
  await fetch(BASE + "/fgq_admin/" + evId, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ fields: { adminPassword: { stringValue: "e2e12345" }, createdAt: { timestampValue: new Date().toISOString() } } })
  });
  // 品項：測試蛋糕（限量50）、測試餅乾（不限量）
  for (const [id, item] of [["cake", { name: "測試蛋糕", price: 100, limit: 50 }], ["cookie", { name: "測試餅乾", price: 50, limit: 0 }]]) {
    await fetch(BASE + "/fgq_events/" + evId + "/items/" + id, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ fields: { name: { stringValue: item.name }, price: { integerValue: item.price }, limit: { integerValue: item.limit }, createdAt: { timestampValue: new Date().toISOString() } } })
    });
  }
  console.log("E2E 活動已就緒（OAuth seed，專案 flash-group-buy-sk）");
})().catch(e => { console.error(e); process.exit(1); });
