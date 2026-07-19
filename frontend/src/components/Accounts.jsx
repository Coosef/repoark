import { useState } from "react";
import { api, urls } from "../api.js";
import { datetime } from "../lib/format.js";
import { useLang } from "../i18n.jsx";

function ConnectForm({ onConnected, onMsg }) {
  const { t } = useLang();
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [isOrg, setIsOrg] = useState(false);
  const [org, setOrg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const acc = await api.connectAccount(label, token, isOrg ? org.trim() : null);
      setLabel(""); setToken(""); setOrg(""); setIsOrg(false);
      onMsg(`@${acc.username} ✓`);
      onConnected();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card connect" onSubmit={submit}>
      <h3>{t("acc.connect")}</h3>
      <p className="muted">{t("acc.tokenHint")}</p>
      <label>{t("acc.label")}</label>
      <input value={label} onChange={(e) => setLabel(e.target.value)} />
      <label>{t("acc.token")}</label>
      <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_… / github_pat_…" required />
      <label className="chk">
        <input type="checkbox" checked={isOrg} onChange={(e) => setIsOrg(e.target.checked)} />
        {t("acc.isOrg")}
      </label>
      {isOrg && (
        <>
          <label>{t("acc.orgName")}</label>
          <input value={org} onChange={(e) => setOrg(e.target.value)} required />
        </>
      )}
      {err && <div className="error">{err}</div>}
      <button disabled={busy || !token || (isOrg && !org.trim())}>{busy ? t("acc.connecting") : t("acc.connectBtn")}</button>
    </form>
  );
}

export default function Accounts({ accounts, jobs, onRefresh, onAddJob, onMsg }) {
  const { t } = useLang();
  async function updateToken(acc) {
    const token = prompt(t("acc.newToken", { user: acc.username }));
    if (!token) return;
    try {
      await api.updateToken(acc.id, token.trim());
      onMsg(t("acc.tokenUpdated", { user: acc.username }));
      onRefresh();
    } catch (e) {
      onMsg(t("toast.error", { msg: e.message }));
    }
  }

  async function remove(acc) {
    if (!confirm(t("acc.removeConfirm", { user: acc.username }))) return;
    try {
      await api.deleteAccount(acc.id);
      onRefresh();
    } catch (e) {
      onMsg(t("toast.error", { msg: e.message }));
    }
  }

  return (
    <div className="grid">
      <ConnectForm onConnected={onRefresh} onMsg={onMsg} />
      {accounts.map((a) => {
        const count = jobs.filter((j) => j.account_id === a.id).length;
        return (
          <div className="card" key={a.id}>
            <div className="row spread">
              <h3>{a.label}</h3>
              <span className="pill">{a.is_org ? "🏢 " : "@"}{a.username}{a.is_org ? " (org)" : ""}</span>
            </div>
            <p className="muted">{t("acc.connected", { date: datetime(a.created_at) })}</p>
            <p className="muted">{t("acc.jobCount", { n: count })}</p>
            <div className="row">
              <button className="secondary" onClick={() => onAddJob(a.id)}>{t("acc.addJob")}</button>
              <a className="btn-link" href={urls.accountDownload(a.id)}>{t("acc.downloadAll")}</a>
            </div>
            <div className="row">
              <button className="link" onClick={() => updateToken(a)}>{t("acc.updateToken")}</button>
              <button className="link danger" onClick={() => remove(a)}>{t("common.remove")}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
