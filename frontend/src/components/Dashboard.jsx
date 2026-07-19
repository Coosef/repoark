import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import { bytes, relative, datetime } from "../lib/format.js";
import { LineChart, Empty } from "./ui.jsx";
import LiveProgress from "./Progress.jsx";
import BackupCalendar from "./BackupCalendar.jsx";
import { useLang } from "../i18n.jsx";

const RING_C = 2 * Math.PI * 63; // circumference for r=63

function Check() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" className="chk-circle">
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path d="M8 12.3l2.8 2.8l5.2-5.6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Dashboard({ accountId, accounts, jobs, onRefresh, onMsg, onGoTab }) {
  const { t } = useLang();
  const [summary, setSummary] = useState(null);
  const [runs, setRuns] = useState([]);
  const [insights, setInsights] = useState(null);
  const [deleted, setDeleted] = useState([]);
  const [store, setStore] = useState(null);
  const [dests, setDests] = useState([]);
  const [alerts, setAlerts] = useState({ token: [], failing: [] });
  const [healthInfo, setHealthInfo] = useState(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [changes, setChanges] = useState(null);

  const load = useCallback(() => {
    if (!accountId) return;
    api.summary(accountId).then(setSummary).catch(() => setSummary(null));
    api.listRuns().then(setRuns).catch(() => {});
    api.insights(accountId).then(setInsights).catch(() => {});
    api.deleted(accountId).then(setDeleted).catch(() => setDeleted([]));
    api.storage().then(setStore).catch(() => {});
    api.destinations().then(setDests).catch(() => {});
    api.alerts().then(setAlerts).catch(() => {});
    api.health(accountId).then(setHealthInfo).catch(() => setHealthInfo(null));
    api.changes(accountId).then(setChanges).catch(() => setChanges(null));
  }, [accountId]);

  async function verifyHealth() {
    setHealthBusy(true);
    try {
      const r = await api.checkHealth(accountId);
      setHealthInfo(r);
      onMsg(r.ok ? t("health.okMsg", { n: r.total }) : t("health.problemMsg", { n: r.problems.length }));
    } catch (e) {
      onMsg(t("toast.error", { msg: e.message }));
    } finally {
      setHealthBusy(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  if (!accountId) return <Empty>{t("dash.connectFirst")}</Empty>;
  if (!summary) return <Empty>{t("common.loading")}</Empty>;

  const myJobs = jobs.filter((j) => j.account_id === accountId);
  const myJobIds = new Set(myJobs.map((j) => j.id));
  const running = myJobs.find((j) => j.last_status === "running");
  const last = runs.filter((r) => myJobIds.has(r.job_id))[0];

  const pct = summary.runs_total
    ? Math.round(100 * (summary.runs_success + summary.runs_skipped) / summary.runs_total)
    : (last ? 100 : 0);
  const safe = summary.runs_error === 0;
  const ringColor = safe ? "var(--green)" : "var(--amber)";

  const cover = [
    { label: t("dash.repos"), count: summary.repos, ok: summary.repos > 0 },
    { label: t("dash.stars"), count: summary.stars, ok: summary.stars > 0 },
    { label: t("dash.gists"), count: summary.gists, ok: summary.gists > 0 },
    { label: t("dash.followers"), count: `${summary.followers}/${summary.following}`, ok: true },
    { label: t("dash.snapshot"), count: summary.snapshots, ok: summary.snapshots > 0 },
    { label: t("dash.social"), count: "✓", ok: true },
  ];

  const sizePoints = runs
    .filter((r) => myJobIds.has(r.job_id) && r.status === "success" && r.size_bytes)
    .slice().reverse()
    .map((r) => ({ label: datetime(r.started_at), value: r.size_bytes }));

  const nextRun = myJobs.map((j) => j.next_run_at).filter(Boolean).sort()[0];

  async function run(job) {
    try { await api.runJob(job.id); onRefresh(); }
    catch (e) { onMsg(t("toast.error", { msg: e.message })); }
  }

  return (
    <div>
      {/* Hero */}
      <div className="card hero">
        <div className="ring-wrap">
          <svg width="150" height="150" viewBox="0 0 150 150">
            <circle cx="75" cy="75" r="63" fill="none" stroke="var(--fill)" strokeWidth="13" />
            <circle cx="75" cy="75" r="63" fill="none" style={{ stroke: ringColor }} strokeWidth="13"
              strokeLinecap="round" strokeDasharray={`${(pct / 100) * RING_C} ${RING_C}`} transform="rotate(-90 75 75)" />
          </svg>
          <div className="ring-center">
            <div className="ring-pct">%{pct}</div>
            <div className="ring-sub">{t("side.protected")}</div>
          </div>
        </div>
        <div className="hero-body">
          <div className="hero-title">
            {safe ? t("dash.safe") : t("dash.attention")}
            <svg width="20" height="20" viewBox="0 0 24 24" style={{ color: ringColor }}>
              <path d="M12 3.5l6.5 2.6v4.9c0 4.6-3.2 7.4-6.5 9.5c-3.3-2.1-6.5-4.9-6.5-9.5V6.1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M9.2 12.2l2.1 2.1l3.8-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="hero-sub">
            {t("dash.lastNext", { last: last ? relative(last.started_at) : "—", next: nextRun ? relative(nextRun) : "—" })}
          </div>
          <div className="hero-health">
            <span className={`hdot ${healthInfo?.status || "unknown"}`} />
            <span className="muted">{t("health.label")}: </span>
            <b>{
              healthInfo?.status === "ok" ? t("health.verified")
                : healthInfo?.status === "problem" ? (healthInfo.note || t("health.problemShort"))
                  : t("health.notChecked")
            }</b>
            <button className="link" style={{ marginLeft: 8 }} onClick={verifyHealth} disabled={healthBusy}>
              {healthBusy ? t("health.checking") : t("health.verify")}
            </button>
          </div>
          <div className="cover">
            {cover.map((c) => (
              <div className="cover-item" key={c.label}>
                <Check /><span>{c.label}</span><span className="c">{c.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Proactive alerts: expiring tokens + failing jobs */}
      {alerts.token.map((a) => (
        <div className="group" key={"tok" + a.account_id} style={{ marginTop: 16 }}>
          <div className="row-item tap" onClick={() => onGoTab("accounts")}>
            <div className="isq lg isq-amber">⚠️</div>
            <div className="row-body">
              <div className="row-title">{a.expired ? t("alert.tokenExpired", { user: a.username }) : t("alert.tokenExpiring", { user: a.username, days: a.days })}</div>
              <div className="row-desc">{t("alert.tokenSub")}</div>
            </div>
            <div className="row-right"><span style={{ color: "var(--link)" }}>{t("alert.renewToken")}</span><span className="chev">›</span></div>
          </div>
        </div>
      ))}
      {alerts.failing.map((a) => (
        <div className="group" key={"fail" + a.job_id} style={{ marginTop: 16 }}>
          <div className="row-item tap" onClick={() => onGoTab("jobs")}>
            <div className="isq lg isq-pink">❌</div>
            <div className="row-body">
              <div className="row-title">{t("alert.jobFailing", { name: a.job_name })}</div>
              <div className="row-desc">{t("alert.jobFailingSub", { n: a.failures })}</div>
            </div>
            <div className="row-right"><span style={{ color: "var(--link)" }}>{t("alert.viewJob")}</span><span className="chev">›</span></div>
          </div>
        </div>
      ))}

      {/* Running banner */}
      {running && (
        <div className="card run-banner" style={{ display: "block" }}>
          <div className="row spread">
            <div className="card-lead"><span className="spinner" /><b>{t("dash.jobRunning", { name: running.name })}</b></div>
          </div>
          <LiveProgress jobId={running.id} running />
        </div>
      )}

      {/* Stat tiles */}
      <div className="stats" style={{ marginTop: 16 }}>
        <div className="stat"><div className="stat-value">{bytes(summary.total_size)}</div><div className="stat-label">{t("dash.totalSize")}</div><div className="stat-hint">{t("dash.totalHint")}</div></div>
        <div className="stat tap" onClick={() => onGoTab("timeline")}><div className="stat-value">{summary.snapshots}</div><div className="stat-label">{t("dash.snapshot")}</div><div className="stat-hint" style={{ color: "var(--link)" }}>{t("dash.snapHint")}</div></div>
        <div className="stat tap" onClick={() => onGoTab("kasa")}><div className="stat-value">{deleted.length}</div><div className="stat-label">{t("dash.vaultKept")}</div><div className="stat-hint">{deleted.length ? t("dash.deletedRepo") : t("dash.noDeleted")}</div></div>
        <div className="stat tap" onClick={() => onGoTab("settings")}><div className="stat-value">{dests.length}</div><div className="stat-label">{t("dash.remote")}</div><div className="stat-hint">{dests[0]?.last_sync_at ? relative(dests[0].last_sync_at) : t("dash.addTarget")}</div></div>
      </div>

      {/* What changed since the previous backup */}
      {changes && changes.has_data && (changes.added.length || changes.updated.length || changes.removed.length || changes.stars_after !== changes.stars_before) && (
        <div className="card whatsnew" style={{ marginTop: 16 }}>
          <h3>{t("changes.title")}</h3>
          <div className="wn-rows">
            {changes.added.length > 0 && (
              <div className="wn-row"><span className="wn-ic add">+</span><span>{t("changes.added", { n: changes.added.length })} <span className="muted">{changes.added.slice(0, 6).join(", ")}{changes.added.length > 6 ? "…" : ""}</span></span></div>
            )}
            {changes.updated.length > 0 && (
              <div className="wn-row"><span className="wn-ic upd">↻</span><span>{t("changes.updated", { n: changes.updated.length })} <span className="muted">{changes.updated.slice(0, 6).join(", ")}{changes.updated.length > 6 ? "…" : ""}</span></span></div>
            )}
            {changes.removed.length > 0 && (
              <div className="wn-row"><span className="wn-ic del">−</span><span>{t("changes.removed", { n: changes.removed.length })} <span className="muted">{changes.removed.slice(0, 6).join(", ")}{changes.removed.length > 6 ? "…" : ""}</span></span></div>
            )}
            {changes.stars_after !== changes.stars_before && (
              <div className="wn-row"><span className="wn-ic star">★</span><span>{t("changes.stars", { from: changes.stars_before, to: changes.stars_after })}</span></div>
            )}
          </div>
        </div>
      )}

      {/* Panels: size chart + storage */}
      <div className="panels">
        <div className="card">
          <div className="row spread">
            <h3>{t("dash.backupSize")}</h3>
            {sizePoints.length > 0 && <span className="pill">{t("dash.last")} {bytes(sizePoints[sizePoints.length - 1].value)}</span>}
          </div>
          <LineChart points={sizePoints} format={bytes} color="var(--accent)" />
        </div>
        <div className="card">
          <h3>{t("dash.storage")}</h3>
          {(() => {
            const b = summary.breakdown || {};
            const total = summary.total_size || 1;
            const segs = [
              { label: t("dash.repoCode"), value: b.repo_code || 0, color: "var(--accent)" },
              { label: t("dash.issueMeta"), value: b.issue_meta || 0, color: "var(--purple)" },
              { label: t("dash.gist"), value: b.gist || 0, color: "var(--teal)" },
              { label: t("dash.socialProfile"), value: b.social_profile || 0, color: "var(--amber)" },
            ];
            return (
              <>
                <div className="muted">{bytes(total)}{store ? ` · %${(100 * total / store.disk_total).toFixed(1)} ${t("dash.diskOf")}` : ""}</div>
                <div className="storagebar">
                  {segs.map((s) => <div key={s.label} style={{ width: `${100 * s.value / total}%`, background: s.color }} />)}
                </div>
                <div className="legend">
                  {segs.map((s) => (
                    <div className="legend-row" key={s.label} style={{ justifyContent: "space-between" }}>
                      <span><span className="dot" style={{ background: s.color }} />{s.label}</span>
                      <b>{bytes(s.value)}</b>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Backup activity calendar */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row spread">
          <h3>{t("cal.title")}</h3>
        </div>
        <div className="muted" style={{ marginBottom: 14 }}>{t("cal.sub")}</div>
        <BackupCalendar runs={runs} jobIds={myJobIds} />
      </div>

      {/* Languages + distribution */}
      {insights && insights.total > 0 && (
        <div className="panels">
          <div className="card">
            <h3>{t("dash.languages")}</h3>
            {insights.languages.slice(0, 7).map((l, i) => {
              const max = insights.languages[0].count || 1;
              const colors = ["var(--accent)", "var(--green)", "var(--amber)", "var(--purple)", "var(--pink)", "var(--teal)", "var(--muted)"];
              return (
                <div className="langrow" key={l.name}>
                  <span className="langname">{l.name === "Diğer" ? t("dash.otherLang") : l.name}</span>
                  <div className="langbar"><div style={{ width: `${100 * l.count / max}%`, background: colors[i % colors.length] }} /></div>
                  <span className="langcount">{l.count}</span>
                </div>
              );
            })}
          </div>
          <div className="card">
            <h3>{t("dash.distribution")}</h3>
            <div className="stor-row"><span>{t("dash.publicPrivate")}</span><b>{insights.public} · {insights.private}</b></div>
            <div className="stor-row"><span>{t("dash.forkArchived")}</span><b>{insights.forks} · {insights.archived}</b></div>
            <div className="stor-row"><span>{t("dash.starsReceived")}</span><b>{insights.total_stars}</b></div>
            {insights.top_starred[0] && <div className="stor-row"><span>{t("dash.topStarred")}</span><span className="muted">{insights.top_starred[0].name} ★{insights.top_starred[0].stars}</span></div>}
          </div>
        </div>
      )}

      {/* Deleted vault alert */}
      {deleted.length > 0 && (
        <div className="group" style={{ marginTop: 16 }}>
          <div className="row-item tap" onClick={() => onGoTab("kasa")}>
            <div className="isq lg isq-green">🛡️</div>
            <div className="row-body">
              <div className="row-title">{t("dash.deletedAlert", { n: deleted.length })}</div>
              <div className="row-desc">{t("dash.deletedAlertSub", { names: deleted.slice(0, 4).map((r) => r.name).join(", ") + (deleted.length > 4 ? "…" : "") })}</div>
            </div>
            <div className="row-right"><span style={{ color: "var(--link)" }}>{t("dash.openVault")}</span><span className="chev">›</span></div>
          </div>
        </div>
      )}

      {/* Jobs quick actions */}
      {myJobs.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row spread"><h3>{t("dash.jobs")}</h3><button className="link" onClick={() => onGoTab("jobs")}>{t("common.manageAll")} ›</button></div>
          {myJobs.map((job) => (
            <div className="jobrow" key={job.id}>
              <div className="row spread">
                <div>
                  <b>{job.name}</b>
                  <div className="muted">{t("dash.lastRun", { last: relative(job.last_run_at), next: job.next_run_at ? relative(job.next_run_at) : "—" })}</div>
                </div>
                <button className={job.last_status === "running" ? "secondary" : ""} onClick={() => run(job)} disabled={job.last_status === "running"}>
                  {job.last_status === "running" ? t("common.running") : t("common.backupNow")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
