const BASE = 'https://firestore.googleapis.com/v1/projects/flash-group-buy-sk/databases/(default)/documents';
const AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=AIzaSyCRjAya1_8gZHLSS6ATNOn7xaqD-Vokd7s';
async function j(r) { const t = await r.text(); try { return JSON.parse(t); } catch { return { _html: t.slice(0, 150) }; } }
async function putDoc(url, body, H) {
  let r = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) });
  if (r.status === 409) {
    // 舊活動殘留（前一次 run 的 DELETE 因新帳號無 session 而被拒絕）→ PATCH 更新既有文件
    r = await fetch(url, { method: 'PATCH', headers: H, body: JSON.stringify(body) });
  }
  return r;
}

(async () => {
  const a = await j(await fetch(AUTH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) }));
  const H = { Authorization: 'Bearer ' + a.idToken, 'Content-Type': 'application/json' };
  const evId = 'E2ETST';
  // 清舊活動（若存在）
  await fetch(BASE + '/fgq_events/' + evId, { method: 'DELETE', headers: H }).catch(() => {});
  await fetch(BASE + '/fgq_admin/' + evId, { method: 'DELETE', headers: H }).catch(() => {});
  // 建活動
  await putDoc(BASE + '/fgq_events?documentId=' + evId, { fields: { name: { stringValue: 'E2E測試揪團' }, shortCode: { stringValue: 'E2E123456' }, shareCode: { stringValue: 'E2ETST' }, createdAt: { timestampValue: new Date().toISOString() } } }, H);
  await putDoc(BASE + '/fgq_admin?documentId=' + evId, { fields: { adminPassword: { stringValue: 'e2e12345' }, createdAt: { timestampValue: new Date().toISOString() } } }, H);
  await fetch(BASE + '/fgq_sessions?documentId=' + a.localId, { method: 'POST', headers: H, body: JSON.stringify({ fields: { eventId: { stringValue: evId }, adminPassword: { stringValue: 'e2e12345' }, createdAt: { timestampValue: new Date().toISOString() } } }) });
  // 清舊訂單（session 建立後此帳號已是管理員，可刪除；避免上輪殘留訂單造成重複匹配）
  try {
    const od = await fetch(BASE + '/fgq_events/' + evId + '/orders?pageSize=300', { headers: H });
    const docs = ((await od.json()).documents) || [];
    for (const d of docs) await fetch(BASE + '/fgq_events/' + evId + '/orders/' + encodeURIComponent(d.name.split('/').pop()), { method: 'DELETE', headers: H }).catch(() => {});
  } catch (e) {}
  // 清舊 rate_limits（以 orderKey 為鍵，避免冷卻殘留影響測試）
  try {
    const rl = await fetch(BASE + '/fgq_events/' + evId + '/rate_limits?pageSize=300', { headers: H });
    const rdocs = ((await rl.json()).documents) || [];
    for (const d of rdocs) await fetch(BASE + '/fgq_events/' + evId + '/rate_limits/' + encodeURIComponent(d.name.split('/').pop()), { method: 'DELETE', headers: H }).catch(() => {});
  } catch (e) {}
  // 重設計數器（保持剩餘數量乾淨）
  try {
    for (const c of ['__total', '__orders', 'cake', 'cookie']) {
      await fetch(BASE + '/fgq_events/' + evId + '/counters/' + c, { method: 'DELETE', headers: H }).catch(() => {});
    }
  } catch (e) {}
  // 品項：測試蛋糕（限量50）、測試餅乾（不限量）
  await putDoc(BASE + '/fgq_events/' + evId + '/items?documentId=cake', { fields: { name: { stringValue: '測試蛋糕' }, price: { integerValue: 100 }, limit: { integerValue: 50 }, createdAt: { timestampValue: new Date().toISOString() } } }, H);
  await putDoc(BASE + '/fgq_events/' + evId + '/items?documentId=cookie', { fields: { name: { stringValue: '測試餅乾' }, price: { integerValue: 50 }, limit: { integerValue: 0 }, createdAt: { timestampValue: new Date().toISOString() } } }, H);
  console.log('E2E 活動已就緒，管理員 uid:', a.localId);
})().catch(e => { console.error(e); process.exit(1); });
