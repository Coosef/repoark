import { useEffect, useState } from "react";
import { api } from "../api.js";
import { relative } from "../lib/format.js";
import { Badge, Empty } from "./ui.jsx";
import { useLang } from "../i18n.jsx";

const empty = {
  name: "Hedef", type: "s3", enabled: true, endpoint: "", region: "", bucket: "",
  prefix: "", access_key: "", secret_key: "", path: "",
};

function DestForm({ initial, onSaved, onCancel }) {
  const { t } = useLang();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      if (d.id) await api.updateDestination(d.id, d);
      else await api.createDestination(d);
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>{d.id ? t("dest.editTarget") : t("dest.newTarget")}</h3>
      <div className="form-grid">
        <div><label>{t("dest.name")}</label><input value={d.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div><label>{t("dest.type")}</label>
          <select value={d.type} onChange={(e) => set("type", e.target.value)}>
            <option value="s3">S3 (AWS, MinIO, Backblaze…)</option>
            <option value="smb">SMB / Windows</option>
            <option value="local">NAS/NFS · {t("dest.localPath")}</option>
          </select>
        </div>
      </div>

      {d.type === "s3" && (
        <>
          <div className="form-grid">
            <div><label>{t("dest.bucket")}</label><input value={d.bucket} onChange={(e) => set("bucket", e.target.value)} placeholder="backups" required /></div>
            <div><label>{t("dest.region")}</label><input value={d.region} onChange={(e) => set("region", e.target.value)} placeholder="us-east-1" /></div>
          </div>
          <label>{t("dest.endpoint")} <span className="muted">{t("dest.endpointHint")}</span></label>
          <input value={d.endpoint} onChange={(e) => set("endpoint", e.target.value)} placeholder="https://s3.eu-central-003.backblazeb2.com" />
        </>
      )}

      {d.type === "smb" && (
        <div className="form-grid">
          <div><label>{t("dest.host")}</label><input value={d.endpoint} onChange={(e) => set("endpoint", e.target.value)} placeholder="192.168.1.10" required /></div>
          <div><label>{t("dest.share")}</label><input value={d.bucket} onChange={(e) => set("bucket", e.target.value)} placeholder="backups" required /></div>
        </div>
      )}

      {d.type === "local" && (
        <>
          <label>{t("dest.localPath")} <span className="muted">{t("dest.localPathHint")}</span></label>
          <input value={d.path} onChange={(e) => set("path", e.target.value)} placeholder="/mnt/nas/github-backup" required />
        </>
      )}

      {d.type !== "local" && (
        <>
          <label>{d.type === "smb" ? t("dest.subfolder") : t("dest.prefix")} <span className="muted">{t("dest.optional")}</span></label>
          <input value={d.prefix} onChange={(e) => set("prefix", e.target.value)} placeholder="github-backup" />
          <div className="form-grid">
            <div><label>{d.type === "smb" ? t("dest.username") : t("dest.accessKey")}</label>
              <input value={d.access_key} onChange={(e) => set("access_key", e.target.value)} /></div>
            <div><label>{d.type === "smb" ? t("dest.password") : t("dest.secretKey")} {d.secret_key_set && <span className="muted">{t("dest.saved")}</span>}</label>
              <input type="password" value={d.secret_key || ""} onChange={(e) => set("secret_key", e.target.value)} placeholder={d.secret_key_set ? t("dest.change") : ""} /></div>
          </div>
        </>
      )}

      <label className="chk"><input type="checkbox" checked={d.enabled} onChange={(e) => set("enabled", e.target.checked)} /> {t("dest.enabledAuto")}</label>
      {err && <div className="error">{err}</div>}
      <div className="row">
        <button disabled={busy}>{busy ? t("form.saving") : t("common.save")}</button>
        <button type="button" className="secondary" onClick={onCancel}>{t("common.cancel")}</button>
      </div>
    </form>
  );
}

export default function Destinations({ accounts, onMsg }) {
  const { t } = useLang();
  const [dests, setDests] = useState([]);
  const [editing, setEditing] = useState(null);
  const [acc, setAcc] = useState(null);
  const [openLog, setOpenLog] = useState(null);

  const load = () => api.destinations().then(setDests).catch(() => {});
  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => { if (!acc && accounts.length) setAcc(accounts[0].id); }, [accounts, acc]);

  async function test(d) {
    onMsg(t("toast.connTesting"));
    try {
      const r = await api.testDestination(d.id);
      onMsg(r.ok ? t("toast.connOk") : t("toast.connFail"));
      if (!r.ok) setOpenLog({ id: d.id, log: r.log });
    } catch (e) { onMsg(t("toast.error", { msg: e.message })); }
  }

  async function syncNow(d) {
    if (!acc) { onMsg(t("toast.needAccount")); return; }
    try {
      await api.syncDestination(d.id, acc);
      onMsg(t("toast.syncStarted", { name: d.name }));
      load();
    } catch (e) { onMsg(t("toast.error", { msg: e.message })); }
  }

  async function remove(d) {
    if (!confirm(`${d.name}?`)) return;
    await api.deleteDestination(d.id);
    load();
  }

  return (
    <div className="card">
      <div className="row spread">
        <span className="muted">{t("dest.desc")} <b>S3</b> (AWS, MinIO, Backblaze, Wasabi…), <b>SMB</b>, <b>NAS/NFS</b>.</span>
        <div className="row">
          {accounts.length > 1 && (
            <select value={acc || ""} style={{ width: "auto" }} onChange={(e) => setAcc(Number(e.target.value))}>
              {accounts.map((a) => <option key={a.id} value={a.id}>@{a.username}</option>)}
            </select>
          )}
          {!editing && <button className="secondary sm" onClick={() => setEditing(empty)}>{t("dest.addTarget")}</button>}
        </div>
      </div>

      {editing && (
        <DestForm initial={editing}
          onSaved={() => { setEditing(null); load(); }}
          onCancel={() => setEditing(null)} />
      )}

      {dests.length === 0 && !editing && <Empty>{t("dest.none")}</Empty>}

      {dests.map((d) => (
        <div className="jobrow" key={d.id}>
          <div className="row spread">
            <div>
              <b>{d.name}</b> <span className="pill">{d.type.toUpperCase()}</span> <Badge status={d.last_sync_status} />
              {!d.enabled && <span className="muted"> · {t("dest.off")}</span>}
              <div className="muted">
                {d.type === "local"
                  ? d.path
                  : d.type === "smb"
                    ? `smb://${d.endpoint}/${d.bucket}${d.prefix ? "/" + d.prefix : ""}`
                    : `${d.bucket}${d.prefix ? "/" + d.prefix : ""} · ${d.endpoint || "AWS S3"}`}
                {d.last_sync_at ? ` · ${relative(d.last_sync_at)}` : ` · ${t("dest.never")}`}
              </div>
            </div>
            <div className="row">
              <button className="secondary sm" onClick={() => test(d)}>{t("dest.test")}</button>
              <button className="sm" onClick={() => syncNow(d)} disabled={d.last_sync_status === "running"}>
                {d.last_sync_status === "running" ? t("dest.syncing") : t("dest.syncNow")}
              </button>
              <button className="link" onClick={() => setEditing({ ...d, secret_key: "" })}>{t("common.edit")}</button>
              <button className="link" onClick={() => setOpenLog(openLog?.id === d.id ? null : { id: d.id, log: d.last_sync_log })}>{t("common.log")}</button>
              <button className="link danger" onClick={() => remove(d)}>{t("common.delete")}</button>
            </div>
          </div>
          {openLog?.id === d.id && <pre className="log">{openLog.log || t("history.noLog")}</pre>}
        </div>
      ))}
    </div>
  );
}
