import { useState, useEffect } from "react";
import { api } from "../api.js";
import { relative, bytes } from "../lib/format.js";
import { Badge, Empty, Switch } from "./ui.jsx";
import LiveProgress from "./Progress.jsx";
import { useLang } from "../i18n.jsx";
import { useDialog } from "./Dialog.jsx";

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
  issues: true, starred: true, starred_clone: false, starred_repos: "", gists: true, releases: false,
  skip_archived: false, exclude: "",
  enabled: true, schedule_kind: "interval", interval_minutes: 1440,
  cron: "", skip_unchanged: true,
});

function StarredPicker({ accountId, value, onChange }) {
  const { t } = useLang();
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let active = true;
    setList(null); setErr("");
    api.starredLive(accountId)
      .then((d) => active && setList(d))
      .catch((e) => active && setErr(e.message));
    return () => { active = false; };
  }, [accountId]);

  let selected = [];
  try { selected = JSON.parse(value || "[]"); } catch { selected = []; }
  const selSet = new Set(selected);
  const toggle = (fn) => {
    const s = new Set(selected);
    s.has(fn) ? s.delete(fn) : s.add(fn);
    onChange(JSON.stringify([...s]));
  };

  if (err) return <div className="error">{err}</div>;
  if (list === null) return <div className="muted" style={{ padding: "6px 2px" }}>{t("form.starredLoading")}</div>;
  if (list.length === 0) return <div className="muted" style={{ padding: "6px 2px" }}>{t("form.starredNone")}</div>;

  // GitHub reports sizes in KiB. Biggest repos first so the heavy ones — the
  // ones worth thinking twice about — are easy to spot and (de)select.
  const sorted = [...list].sort((a, b) => (b.size_kb || 0) - (a.size_kb || 0));
  const totalKb = list.reduce((s, r) => s + (r.size_kb || 0), 0);
  const selKb = list.reduce((s, r) => (selSet.has(r.full_name) ? s + (r.size_kb || 0) : s), 0);
  const selectAll = () => onChange(JSON.stringify(list.map((r) => r.full_name)));

  return (
    <div>
      <div className="star-summary">
        <span>{t("form.starredSummary", { count: list.length, total: bytes(totalKb * 1024) })}</span>
        <span className="star-sel">{t("form.starredSelSummary", { count: selected.length, size: bytes(selKb * 1024) })}</span>
        <span style={{ marginLeft: "auto" }} />
        <button type="button" className="link" onClick={selectAll}>{t("content.selectAll")}</button>
        <button type="button" className="link" onClick={() => onChange("[]")}>{t("form.starredClear")}</button>
      </div>
      <div className="star-picker">
        {sorted.map((r) => (
          <label key={r.full_name} className="chk">
            <input type="checkbox" checked={selSet.has(r.full_name)} onChange={() => toggle(r.full_name)} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{r.full_name}</span>
            {r.language && <span className="muted" style={{ fontSize: 12 }}>{r.language}</span>}
            <span className="star-size">{bytes((r.size_kb || 0) * 1024)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// Display order Mon..Sun; values are cron day-of-week numbers (0 = Sunday).
const WEEK = [1, 2, 3, 4, 5, 6, 0];

// Localized short weekday name via the browser's Intl. 2024-01-07 is a Sunday,
// so adding `dow` days lands on the wanted weekday in any locale.
function weekdayLabel(lang, dow) {
  try {
    return new Intl.DateTimeFormat(lang || "tr", { weekday: "short" })
      .format(new Date(2024, 0, 7 + dow));
  } catch {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow];
  }
}

// Best-effort read of a cron string back into the friendly builder. Returns null
// for anything that isn't one of our three simple shapes (then we fall back to
// the raw "custom" editor so hand-written crons are never clobbered).
function parseCron(cron) {
  const p = (cron || "").trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [m, h, dom, mon, dowRaw] = p;
  const int = (s) => /^\d+$/.test(s);
  if (!int(m) || !int(h) || mon !== "*") return null;
  const minute = Math.min(59, +m), hour = Math.min(23, +h);
  const dow = dowRaw.replace(/\b7\b/g, "0");
  if (dom === "*" && dowRaw === "*") return { freq: "daily", hour, minute, days: [1], dom: 1 };
  if (dom === "*" && /^[0-6](,[0-6])*$/.test(dow))
    return { freq: "weekly", hour, minute, days: [...new Set(dow.split(",").map(Number))], dom: 1 };
  if (int(dom) && dowRaw === "*")
    return { freq: "monthly", hour, minute, days: [1], dom: Math.min(31, Math.max(1, +dom)) };
  return null;
}

function buildCron(s) {
  if (s.freq === "weekly") {
    const d = (s.days.length ? [...s.days] : [1]).sort((a, b) => a - b).join(",");
    return `${s.minute} ${s.hour} * * ${d}`;
  }
  if (s.freq === "monthly") return `${s.minute} ${s.hour} ${s.dom} * *`;
  return `${s.minute} ${s.hour} * * *`;
}

const pad = (n) => String(n).padStart(2, "0");

// Friendly schedule builder: the user picks daily / weekly / monthly + a time
// (and days or day-of-month), and we assemble the cron string in the background.
// Power users can flip to "custom" to type a raw cron directly.
function CronBuilder({ value, onChange }) {
  const { t, lang } = useLang();
  const initial = parseCron(value);
  const [advanced, setAdvanced] = useState(!!value && !initial);
  const [s, setS] = useState(initial || { freq: "daily", hour: 3, minute: 0, days: [1], dom: 1 });

  // Keep the parent's cron valid from the start (new job → empty field, or a
  // preset we just parsed). Runs once on mount.
  useEffect(() => {
    if (!advanced && (!value || initial)) onChange(buildCron(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upd = (patch) => { const next = { ...s, ...patch }; setS(next); onChange(buildCron(next)); };
  const toggleDay = (d) => {
    const set = new Set(s.days);
    set.has(d) ? set.delete(d) : set.add(d);
    upd({ days: [...set] });
  };
  const setTime = (v) => {
    const [hh, mm] = (v || "3:0").split(":").map((x) => parseInt(x, 10) || 0);
    upd({ hour: Math.min(23, hh), minute: Math.min(59, mm) });
  };
  const toggleAdvanced = (on) => { setAdvanced(on); if (!on) onChange(buildCron(s)); };

  return (
    <div className="cron-builder">
      {!advanced ? (
        <>
          <div className="cron-row">
            <div className="cron-field">
              <label>{t("form.schedule")}</label>
              <select value={s.freq} onChange={(e) => upd({ freq: e.target.value })}>
                <option value="daily">{t("sched.freqDaily")}</option>
                <option value="weekly">{t("sched.freqWeekly")}</option>
                <option value="monthly">{t("sched.freqMonthly")}</option>
              </select>
            </div>
            <div className="cron-field">
              <label>{t("sched.atTime")}</label>
              <input type="time" value={`${pad(s.hour)}:${pad(s.minute)}`} onChange={(e) => setTime(e.target.value)} />
            </div>
            {s.freq === "monthly" && (
              <div className="cron-field">
                <label>{t("sched.dayOfMonth")}</label>
                <input type="number" min="1" max="31" value={s.dom}
                  onChange={(e) => upd({ dom: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />
              </div>
            )}
          </div>
          {s.freq === "weekly" && (
            <div className="cron-week">
              <label>{t("sched.onDays")}</label>
              <div className="cron-days">
                {WEEK.map((d) => (
                  <button type="button" key={d}
                    className={"cron-day" + (s.days.includes(d) ? " on" : "")}
                    onClick={() => toggleDay(d)}>{weekdayLabel(lang, d)}</button>
                ))}
              </div>
            </div>
          )}
          <div className="cron-expr muted">{t("sched.exprLabel")}: <code>{buildCron(s)}</code></div>
        </>
      ) : (
        <div className="cron-field">
          <label>{t("sched.freqCustom")}</label>
          <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="0 3 * * *" />
        </div>
      )}
      <label className="chk" style={{ marginTop: 4 }}>
        <input type="checkbox" checked={advanced} onChange={(e) => toggleAdvanced(e.target.checked)} />
        {t("sched.freqCustom")}
      </label>
    </div>
  );
}

function JobForm({ accounts, initial, onSaved, onCancel }) {
  const { t } = useLang();
  const [job, setJob] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k, v) => setJob((j) => ({ ...j, [k]: v }));
  const isOrg = !!accounts.find((a) => a.id === job.account_id)?.is_org;
  const starMode = (job.starred_repos || "").trim() ? "selected" : "all";

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
      {job.starred && !isOrg && job.starred_clone && (
        <div className="star-mode">
          <label className="chk">
            <input type="radio" name="starmode" checked={starMode === "all"} onChange={() => set("starred_repos", "")} />
            {t("form.starredAll")}
          </label>
          <label className="chk">
            <input type="radio" name="starmode" checked={starMode === "selected"} onChange={() => set("starred_repos", "[]")} />
            {t("form.starredSelected")}
          </label>
          {starMode === "selected" && (
            <>
              <div className="muted" style={{ margin: "6px 0 0" }}>{t("form.starredPick")}</div>
              <StarredPicker accountId={job.account_id} value={job.starred_repos}
                onChange={(v) => set("starred_repos", v)} />
            </>
          )}
        </div>
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
        </div>
      </div>
      {job.schedule_kind === "cron" && (
        <CronBuilder value={job.cron} onChange={(c) => set("cron", c)} />
      )}

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
  const { t, lang } = useLang();
  const { confirm } = useDialog();
  async function run(job) {
    try {
      await api.runJob(job.id);
      onMsg(t("toast.jobStarted", { name: job.name }));
      onRefresh();
    } catch (e) {
      onMsg(t("toast.error", { msg: e.message }));
    }
  }

  async function stop(job) {
    try {
      await api.stopJob(job.id);
      onMsg(t("toast.jobStopped", { name: job.name }));
      onRefresh();
    } catch (e) {
      onMsg(t("toast.error", { msg: e.message }));
    }
  }

  async function remove(job) {
    if (!(await confirm({ message: t("jobs.deleteConfirm", { name: job.name }),
                          confirmLabel: t("common.delete") }))) return;
    await api.deleteJob(job.id);
    onRefresh();
  }

  async function toggleEnabled(job) {
    try { await api.updateJob(job.id, { ...job, enabled: !job.enabled }); onRefresh(); }
    catch (e) { onMsg(t("toast.error", { msg: e.message })); }
  }

  const scheduleText = (job) => {
    if (job.schedule_kind === "cron") {
      const p = parseCron(job.cron);
      if (!p) return t("sched.cron", { cron: job.cron });
      const time = `${pad(p.hour)}:${pad(p.minute)}`;
      if (p.freq === "daily") return t("sched.dailyAt", { time });
      if (p.freq === "monthly") return t("sched.monthlyAt", { d: p.dom, time });
      const days = [...p.days].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b))
        .map((d) => weekdayLabel(lang, d)).join(", ");
      return `${days} · ${time}`;
    }
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
                {isRunning && <button className="stop-btn" onClick={() => stop(job)}>{t("common.stop")}</button>}
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
