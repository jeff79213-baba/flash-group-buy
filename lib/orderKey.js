// 由 (手機後三碼 + 姓名) 推導訂單文件 id（orderKey）
// 同活動內 (姓名 + 後三碼) 組合唯一，唯一性由文件 id 存在性天然強制
// Firestore 文件 id 非法字元：/ . # $ [ ] → 以 _ 取代
export function buildOrderKey(phoneLast3, name) {
  const phone = String(phoneLast3 || "").trim();
  const buyerName = String(name || "").trim();
  return phone + "_" + buyerName.replace(/[/.#$[\]]/g, "_");
}
