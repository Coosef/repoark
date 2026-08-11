import { useState } from "react";
import { api, urls } from "../api.js";
import { datetime } from "../lib/format.js";
import { useLang } from "../i18n.jsx";
import { useDialog } from "./Dialog.jsx";

function ConnectForm({ onConnected, onMsg }) {
  const { t } = useLang();
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [isOrg, setIsOrg] = useState(false);
  const [org, setOrg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const acc = await api.connectAccount(label, token, isOrg ? org.trim() : null);
      setLabel(""); setToken(""); setOrg(""); setIsOrg(false); setTestRes(null);
      onMsg(`@${acc.username} ✓`);
      onConnected();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function testToken() {
    setTesting(true);
    setTestRes(null);
    setErr("");
    try {
      setTestRes(await api.testToken(token, isOrg ? org.trim() : null));
    } catch (e) {
      setTestRes({ ok: false, error: e.message });
    } finally {
      setTesting(false);
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
      {testRes && (testRes.ok ? (
        <div className="test-ok">
          ✓ {t("acc.tokenOk")} — {testRes.is_org ? "🏢 " : "@"}{testRes.login}
          <div className="muted" style={{ fontWeight: 400, marginTop: 2 }}>
            {(testRes.scopes && testRes.scopes.length ? testRes.scopes.join(", ") + " · " : "")}
            {testRes.expires_at ? testRes.expires_at.slice(0, 10) : t("acc.tokenNoExpiry")}
          </div>
        </div>
      ) : (
        <div className="error">✗ {testRes.error}</div>
      ))}
      <div className="row">
        <button disabled={busy || !token || (isOrg && !org.trim())}>{busy ? t("acc.connecting") : t("acc.connectBtn")}</button>
        <button type="button" className="secondary" onClick={testToken}
                disabled={testing || !token || (isOrg && !org.trim())}>
          {testing ? t("dest.testing") : t("acc.testToken")}
        </button>
      </div>
    </form>
  );
}

export default function Accounts({ accounts, jobs, onRefresh, onAddJob, onMsg }) {
  const { t } = useLang();
  const { confirm, promptSecret } = useDialog();
  const [drilling, setDrilling] = useState(0);

  async function drill(acc) {
    setDrilling(acc.id);
    onMsg(t("acc.drillRunning"));
    try {
      const r = await api.restoreDrill(acc.id);
      if (r.total === 0) {
        onMsg(t("acc.drillEmpty"));
      } else if (r.ok) {
        onMsg(t("acc.drillOk", { ok: r.ok_count, n: r.sampled }));
      } else {
        const bad = (r.tested || []).filter((x) => !x.ok).map((x) => x.repo).join(", ");
        onMsg(t("acc.drillFail", { repos: bad }));
      }
    } catch (e) {
      onMsg(t("toast.error", { msg: e.message }));
    } finally {
      setDrilling(0);
    }
  }

  async function updateToken(acc) {
    const token = await promptSecret({
      title: t("acc.updateToken"),
      message: t("acc.newToken", { user: acc.username }),
      placeholder: t("acc.token"),
      confirmLabel: t("common.save"),
    });
    if (!token) return;
    try {
      await api.updateToken(acc.id, token);
      onMsg(t("acc.tokenUpdated", { user: acc.username }));
      onRefresh();
    } catch (e) {
      onMsg(t("toast.error", { msg: e.message }));
    }
  }

  async function remove(acc) {
    if (!(await confirm({ message: t("acc.removeConfirm", { user: acc.username }) }))) return;
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
              <button className="link" onClick={() => drill(a)} disabled={drilling === a.id}>
                {drilling === a.id ? t("dest.testing") : t("acc.restoreDrill")}
              </button>
              <button className="link" onClick={() => updateToken(a)}>{t("acc.updateToken")}</button>
              <button className="link danger" onClick={() => remove(a)}>{t("common.remove")}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
