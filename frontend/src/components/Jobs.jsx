import { useState } from "react";
import { api } from "../api.js";
import { relative } from "../lib/format.js";
import { Badge, Empty, Switch } from "./ui.jsx";
import LiveProgress from "./Progress.jsx";
import { useLang } from "../i18n.jsx";

export const SCOPES = [
  ["repos", "Repolar (kod)"],
  ["private", "Özel repolar"],
  ["forks", "Fork'lar"],
  ["wikis", "Wiki'ler"],
  ["issues", "Issue / PR"],
  ["starred", "Yıldızlar"],
  ["gists", "Gist'ler"],
  ["releases", "Release'ler"],
];

export const emptyJob = (accountId) => ({
  account_id: accountId,
  name: "",
  repos: true, private: true, forks: false, wikis: true,
  issues: true, starred: true, starred_clone: false, gists: true, releases: false,
  skip_archived: false, exclude: "",
  enabled: true, schedule_kind: "interval", interval_minutes: 1440,
  cron: "", skip_unchanged: true,
});

function JobForm({ accounts, initial, onSaved, onCancel }) {
  const { t } = useLang();
  const [job, setJob] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k, v) => setJob((j) => ({ ...j, [k]: v }));
  const isOrg = !!accounts.find((a) => a.id === job.account_id)?.is_org;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      if (job.id) await api.updateJob(job.id, job);
      else await api.createJob(job);
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card wide" onSubmit={submit}>
      <h3>{job.id ? t("form.editJob") : t("form.newJob")}</h3>
      <div className="form-grid">
        <div>
          <label>{t("form.account")}</label>
          <select value={job.account_id} disabled={!!job.id}
            onChange={(e) => set("account_id", Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.label} (@{a.username})</option>
            ))}
          </select>
        </div>
        <div>
          <label>{t("form.jobName")}</label>
          <input value={job.name} onChange={(e) => set("name", e.target.value)} placeholder={t("form.jobNamePlaceholder")} />
        </div>
      </div>

      <label>{t("form.whatBackup")}{isOrg && <span className="muted"> {t("form.orgNote")}</span>}</label>
      <div className="scopes">
        {SCOPES.filter(([k]) => !isOrg || !["starred", "gists"].includes(k)).map(([key]) => (
          <label key={key} className="chk">
            <input type="checkbox" checked={job[key]} onChange={(e) => set(key, e.target.checked)} />
            {t("scope." + key)}
          </label>
        ))}
      </div>
      {job.starred && !isOrg && (
        <label className="chk warn">
          <input type="checkbox" checked={job.starred_clone} onChange={(e) => set("starred_clone", e.target.checked)} />
          {t("form.starredClone")}
        </label>
      )}

      <label className="chk">
        <input type="checkbox" checked={job.skip_archived} onChange={(e) => set("skip_archived", e.target.checked)} />
        {t("form.skipArchived")}
      </label>
      <label>{t("form.exclude")} <span className="muted">{t("form.excludeHint")}</span></label>
      <input value={job.exclude} onChange={(e) => set("exclude", e.target.value)} placeholder="repo-1 repo-2" />

      <div className="form-grid">
        <div>
          <label>{t("form.schedule")}</label>
          <select value={job.schedule_kind} onChange={(e) => set("schedule_kind", e.target.value)}>
            <option value="interval">{t("form.interval")}</option>
            <option value="cron">{t("form.cronOpt")}</option>
            <option value="manual">{t("form.manualOpt")}</option>
          </select>
        </div>
        <div>
          {job.schedule_kind === "interval" && (
            <>
              <label>{t("form.everyMin")}</label>
              <input type="number" min="1" value={job.interval_minutes}
                onChange={(e) => set("interval_minutes", Number(e.target.value))} />
              <span className="muted">{t("form.everyMinHint")}</span>
            </>
          )}
          {job.schedule_kind === "cron" && (
            <>
              <label>Cron</label>
              <input value={job.cron} onChange={(e) => set("cron", e.target.value)} placeholder="0 3 * * *" />
            </>
          )}
        </div>
      </div>

      <label className="chk">
        <input type="checkbox" checked={job.skip_unchanged} onChange={(e) => set("skip_unchanged", e.target.checked)} />
        {t("form.skipUnchanged")}
      </label>
      <label className="chk">
        <input type="checkbox" checked={job.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        {t("form.enabled")}
      </label>

      {err && <div className="error">{err}</div>}
      <div className="row">
        <button disabled={busy}>{busy ? t("form.saving") : t("common.save")}</button>
        <button type="button" className="secondary" onClick={onCancel}>{t("common.cancel")}</button>
      </div>
    </form>
  );
}

export default function Jobs({ jobs, accounts, editing, setEditing, onRefresh, onMsg, onShowHistory }) {
  const { t } = useLang();
  async function run(job) {
    try {
      await api.runJob(job.id);
      onMsg(t("toast.jobStarted", { name: job.name }));
      onRefresh();
    } catch (e) {
      onMsg(t("toast.error", { msg: e.message }));
    }
  }

  async function remove(job) {
    if (!confirm(t("jobs.deleteConfirm", { name: job.name }))) return;
    await api.deleteJob(job.id);
    onRefresh();
  }

  async function toggleEnabled(job) {
    try { await api.updateJob(job.id, { ...job, enabled: !job.enabled }); onRefresh(); }
    catch (e) { onMsg(t("toast.error", { msg: e.message })); }
  }

  const scheduleText = (job) => {
    if (job.schedule_kind === "cron") return t("sched.cron", { cron: job.cron });
    if (job.schedule_kind === "manual") return t("sched.manual");
    const m = job.interval_minutes;
    if (m % 1440 === 0) return t("sched.everyDays", { n: m / 1440 });
    if (m % 60 === 0) return t("sched.everyHours", { n: m / 60 });
    return t("sched.everyMinutes", { n: m });
  };

  return (
    <div>
      {editing && (
        <JobForm accounts={accounts} initial={editing}
          onSaved={() => { setEditing(null); onRefresh(); }}
          onCancel={() => setEditing(null)} />
      )}

      {jobs.length === 0 && !editing && accounts.length === 0 && <Empty>{t("jobs.connectFirst")}</Empty>}

      <div className="grid">
        {jobs.map((job) => {
          const isRunning = job.last_status === "running";
          return (
            <div className="card" key={job.id}>
              <div className="row spread">
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{job.name}</div>
                  <div className="muted" style={{ marginTop: 2 }}>📅 {scheduleText(job)}</div>
                </div>
                <Switch on={job.enabled} onChange={() => toggleEnabled(job)} />
              </div>
              <div className="chips">
                {SCOPES.filter(([k]) => job[k]).map(([k]) => <span className="chip" key={k}>{t("scope." + k)}</span>)}
              </div>
              {isRunning ? (
                <LiveProgress jobId={job.id} running />
              ) : (
                <div className="row" style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 2px" }}>
                  <span className={`sdot sdot-${job.last_status}`} />
                  <span>{relative(job.last_run_at)} · <Badge status={job.last_status} /></span>
                  <span style={{ marginLeft: "auto" }}>{t("jobs.next", { next: job.next_run_at ? relative(job.next_run_at) : "—" })}</span>
                </div>
              )}
              <div className="row" style={{ marginTop: 8 }}>
                <button onClick={() => run(job)} disabled={isRunning}>{isRunning ? t("common.running") : t("common.runNow")}</button>
                <button className="link" onClick={() => setEditing(job)}>{t("common.edit")}</button>
                <button className="link" onClick={() => onShowHistory(job)}>{t("common.history")}</button>
                <button className="link danger" onClick={() => remove(job)}>{t("common.delete")}</button>
              </div>
            </div>
          );
        })}
        {!editing && accounts.length > 0 && (
          <button className="dashed" onClick={() => setEditing(emptyJob(accounts[0].id))}>
            <svg width="26" height="26" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            {t("jobs.newJob")}
          </button>
        )}
      </div>
    </div>
  );
}
