import { useState } from "react";
import { api } from "../api.js";
import { useLang } from "../i18n.jsx";
import { SCOPES, emptyJob } from "./Jobs.jsx";

const SHIELD = (
  <svg width="72" height="72" viewBox="0 0 40 40">
    <defs><linearGradient id="wzMark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2997ff" /><stop offset="1" stopColor="#0055d4" /></linearGradient></defs>
    <rect x="1" y="1" width="38" height="38" rx="11" fill="url(#wzMark)" />
    <path d="M20 8.5l8 3.2v6c0 5.6-3.9 9-8 11.6c-4.1-2.6-8-6-8-11.6v-6z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
    <path d="M15.8 19.4l2.9 2.9l5.5-5.8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function Wizard({ onClose, onDone }) {
  const { t } = useLang();
  const [step, setStep] = useState(0);
  const [token, setToken] = useState("");
  const [isOrg, setIsOrg] = useState(false);
  const [org, setOrg] = useState("");
  const [account, setAccount] = useState(null);
  const [scope, setScope] = useState(emptyJob(0));
  const [freq, setFreq] = useState("daily");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const setSc = (k, v) => setScope((s) => ({ ...s, [k]: v }));

  async function connect() {
    setBusy(true); setErr("");
    try {
      const acc = await api.connectAccount("", token, isOrg ? org.trim() : null);
      setAccount(acc);
      setScope(emptyJob(acc.id));
      setStep(2);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function finish() {
    setBusy(true); setErr("");
    try {
      const interval = freq === "weekly" ? 10080 : 1440;
      const job = await api.createJob({
        ...scope, account_id: account.id, name: "Tam yedek",
        schedule_kind: freq === "manual" ? "manual" : "interval",
        interval_minutes: interval,
      });
      await api.runJob(job.id);   // kick off the first backup right away
      onDone();
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="wiz-overlay">
      <button className="wiz-skip" onClick={onClose}>{t("wiz.skip")}</button>
      <div className="wiz-dots">
        {[0, 1, 2, 3].map((i) => <span key={i} className={`wiz-dot ${i === step ? "on" : ""}`} />)}
      </div>

      <div className="wiz-body">
        {step === 0 && (
          <div className="wiz-center">
            {SHIELD}
            <h1>{t("wiz.welcomeTitle")}</h1>
            <p className="wiz-desc">{t("wiz.welcomeDesc")}</p>
            <button className="wiz-primary" onClick={() => setStep(1)}>{t("wiz.start")}</button>
          </div>
        )}

        {step === 1 && (
          <div className="wiz-center">
            <h1>{t("wiz.connectTitle")}</h1>
            <p className="wiz-desc">{t("wiz.connectDesc")}</p>
            <div className="card wiz-card">
              <label>Personal Access Token</label>
              <input type="password" value={token} autoFocus onChange={(e) => setToken(e.target.value)} placeholder="ghp_… / github_pat_…" />
              <div className="metapills" style={{ marginTop: 10 }}>
                <span className="muted" style={{ fontSize: 12.5 }}>{t("wiz.recommended")}</span>
                {["repo", "gist", "read:user", "read:org"].map((p) => <span className="metapill blue" key={p}>{p}</span>)}
              </div>
              <label className="chk" style={{ marginTop: 10 }}>
                <input type="checkbox" checked={isOrg} onChange={(e) => setIsOrg(e.target.checked)} /> {t("acc.isOrg")}
              </label>
              {isOrg && <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder={t("acc.orgName")} />}
              <div className="wiz-note">🔒 {t("wiz.encNote")}</div>
            </div>
            {err && <div className="error">{err}</div>}
            <div className="wiz-actions">
              <button className="secondary" onClick={() => setStep(0)}>{t("wiz.back")}</button>
              <button className="wiz-primary" disabled={busy || !token || (isOrg && !org.trim())} onClick={connect}>{busy ? "…" : t("wiz.connect")}</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="wiz-center">
            <h1>{t("wiz.scopeTitle")}</h1>
            <p className="wiz-desc">{t("wiz.connectedAs", { user: account?.username })} · {t("wiz.scopeDesc")}</p>
            <div className="card wiz-card">
              <div className="scopes">
                {SCOPES.filter(([k]) => !account?.is_org || !["starred", "gists"].includes(k)).map(([k]) => (
                  <label key={k} className="chk">
                    <input type="checkbox" checked={scope[k]} onChange={(e) => setSc(k, e.target.checked)} /> {t("scope." + k)}
                  </label>
                ))}
              </div>
            </div>
            <div className="wiz-actions">
              <button className="secondary" onClick={() => setStep(1)}>{t("wiz.back")}</button>
              <button className="wiz-primary" onClick={() => setStep(3)}>{t("wiz.continue")}</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="wiz-center">
            <h1>{t("wiz.scheduleTitle")}</h1>
            <p className="wiz-desc">{t("wiz.scheduleDesc")}</p>
            <div className="card wiz-card">
              {[["daily", t("wiz.daily")], ["weekly", t("wiz.weekly")], ["manual", t("wiz.manualOnly")]].map(([k, label]) => (
                <label key={k} className="row-item tap" style={{ borderRadius: 10, cursor: "pointer" }} onClick={() => setFreq(k)}>
                  <input type="radio" name="freq" checked={freq === k} onChange={() => setFreq(k)} style={{ width: "auto" }} />
                  <div className="row-body"><div className="row-title">{label}</div></div>
                </label>
              ))}
            </div>
            {err && <div className="error">{err}</div>}
            <div className="wiz-actions">
              <button className="secondary" onClick={() => setStep(2)}>{t("wiz.back")}</button>
              <button className="wiz-primary" disabled={busy} onClick={finish}>{busy ? "…" : t("wiz.startFirst")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
