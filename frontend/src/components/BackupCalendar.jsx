import { useLang } from "../i18n.jsx";

// GitHub-style activity heatmap of backup runs over the last ~18 weeks.
const DAY_MS = 86400000;
const WEEKS = 18;
const RANK = { skipped: 1, success: 2, error: 3 };

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function BackupCalendar({ runs, jobIds }) {
  const { t } = useLang();

  // Best (highest-signal) status per calendar day.
  const byDay = {};
  for (const r of runs || []) {
    if (jobIds && !jobIds.has(r.job_id)) continue;
    if (!r.started_at) continue;
    const d = new Date(r.started_at.endsWith("Z") ? r.started_at : r.started_at + "Z");
    const key = dayKey(d);
    const st = r.status === "running" ? "success" : r.status;
    if (!RANK[st]) continue;
    if (!byDay[key] || RANK[st] > RANK[byDay[key]]) byDay[key] = st;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = (today.getDay() + 6) % 7;                 // Mon=0 … Sun=6
  const start = new Date(today.getTime() - ((WEEKS - 1) * 7 + dow) * DAY_MS);

  const weeks = [];
  let cur = new Date(start);
  for (let w = 0; w < WEEKS; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const key = dayKey(cur);
      col.push({ key, status: byDay[key], future: cur > today });
      cur = new Date(cur.getTime() + DAY_MS);
    }
    weeks.push(col);
  }

  const activeDays = Object.keys(byDay).length;

  return (
    <div className="cal">
      <div className="cal-grid">
        {weeks.map((col, wi) => (
          <div className="cal-col" key={wi}>
            {col.map((c) => (
              <div
                key={c.key}
                className={`cal-cell ${c.future ? "future" : c.status || "none"}`}
                title={c.future ? "" : `${c.key}${c.status ? " · " + t("cal." + c.status) : ""}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="cal-legend">
        <span>{t("cal.activeDays", { n: activeDays })}</span>
        <span className="cal-key">
          <span className="cal-cell none" />
          <span className="cal-cell skipped" />
          <span className="cal-cell success" />
          <span className="cal-cell error" />
        </span>
      </div>
    </div>
  );
}
