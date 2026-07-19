// Small formatting helpers shared across the panel.

export function bytes(n) {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// Current language, kept in sync by the LangProvider (see i18n.jsx).
let _lang = (typeof localStorage !== "undefined" && localStorage.getItem("rk-lang")) || "tr";
export function setFormatLang(l) { _lang = l; }

// Backend stores naive-UTC timestamps; append Z so the browser localizes.
function toDate(dt) {
  if (!dt) return null;
  return new Date(dt.endsWith("Z") ? dt : dt + "Z");
}

// Our language codes are valid BCP-47 tags, so the browser localizes directly.
const locale = () => _lang || "tr";

export function datetime(dt) {
  const d = toDate(dt);
  if (!d) return "—";
  try { return d.toLocaleString(locale()); } catch { return d.toLocaleString(); }
}

// Uses the browser's Intl so every installed language localizes correctly.
export function relative(dt) {
  const d = toDate(dt);
  if (!d) return "—";
  let rtf;
  try { rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" }); }
  catch { rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" }); }
  const secs = Math.round((d.getTime() - Date.now()) / 1000); // negative = past
  const a = Math.abs(secs);
  if (a < 45) return rtf.format(0, "second"); // numeric:"auto" -> "now"/"şimdi"/"jetzt"
  if (a < 3600) return rtf.format(Math.round(secs / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(secs / 3600), "hour");
  if (a < 2592000) return rtf.format(Math.round(secs / 86400), "day");
  if (a < 31536000) return rtf.format(Math.round(secs / 2592000), "month");
  return rtf.format(Math.round(secs / 31536000), "year");
}

export const STATUS_TR = {
  never: "hiç çalışmadı",
  running: "çalışıyor",
  success: "başarılı",
  skipped: "değişiklik yok",
  error: "hata",
};

// interval minutes -> friendly text
export function interval(min) {
  if (min % 1440 === 0) return `${min / 1440} günde bir`;
  if (min % 60 === 0) return `${min / 60} saatte bir`;
  return `${min} dakikada bir`;
}
