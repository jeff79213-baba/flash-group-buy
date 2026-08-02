// 分享碼 = 活動代碼前3碼 + 3碼亂碼（大寫字母+數字）
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function randChar() {
  return CHARS[Math.floor(Math.random() * CHARS.length)];
}
export function generateShareCode(shortCode, prefixLen = 3, randLen = 3) {
  const prefix = (shortCode || "").toUpperCase().slice(0, prefixLen);
  if (prefix.length < prefixLen) {
    throw new Error("活動代碼需至少 " + prefixLen + " 碼才能產生分享碼");
  }
  let rand = "";
  for (let i = 0; i < randLen; i++) rand += randChar();
  return prefix + rand;
}

// 驗證分享碼是否以該活動代碼前綴開頭（防呆，非安全性保證）
export function isShareCodeValid(shareCode, shortCode) {
  const prefix = (shortCode || "").toUpperCase().slice(0, 3);
  return (shareCode || "").toUpperCase().startsWith(prefix);
}
