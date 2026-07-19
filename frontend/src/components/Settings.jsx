import { useEffect, useState, useRef } from "react";
import { api, urls } from "../api.js";
import { bytes } from "../lib/format.js";
import { Empty, Switch, ISquare } from "./ui.jsx";
import Destinations from "./Destinations.jsx";
import { useLang, LANGS } from "../i18n.jsx";

function PanelPassword({ onMsg }) {
  const { t } = useLang();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () => api.authStatus().then((r) => setEnabled(r.enabled)).catch(() => {});
  useEffect(() => { refresh(); }, []);

  async function save() {
    setBusy(true);
    try {
      const r = await api.setPassword(cur, nw);
      setCur(""); setNw(""); setOpen(false);
      onMsg(r.enabled ? t("sec.saved") : t("sec.removed"));
      refresh();
    } catch (e) { onMsg(t("toast.error", { msg: e.message })); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try {
      await api.setPassword(cur, "");
      setCur(""); setNw(""); setOpen(false);
      onMsg(t("sec.removed"));
      refresh();
    } catch (e) { onMsg(t("toast.error", { msg: e.message })); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="group-label">{t("sec.title")}</div>
      <div className="group">
        <div className="row-item">
          <ISquare color="pink">🔐</ISquare>
          <div className="row-body">
            <div className="row-title">{t("sec.panelPassword")}</div>
            <div className="row-desc">{enabled ? t("sec.on") : t("sec.off")}</div>
          </div>
          <div className="row-right"><button className="secondary" onClick={() => setOpen((v) => !v)}>{enabled ? t("sec.change") : t("sec.set")}</button></div>
        </div>
        {open && (
          <div className="row-item" style={{ display: "block" }}>
            {enabled && (<><label>{t("sec.current")}</label><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></>)}
            <label>{t("sec.new")}</label>
            <input type="password" value={nw} onChange={(e) => setNw(e.target.value)} placeholder={t("sec.newPlaceholder")} />
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button disabled={busy || !nw} onClick={save}>{t("common.save")}</button>
              {enabled && <button className="secondary" disabled={busy} onClick={remove}>{t("sec.remove")}</button>}
              <button className="secondary" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>{enabled ? t("sec.removeHint") : t("sec.setHint")}</p>
          </div>
        )}
      </div>
    </>
  );
}

function ConfigBackup({ onMsg }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const data = JSON.parse(await file.text());
      const r = await api.importConfig(data);
      onMsg(t("cfg.imported", { a: r.accounts, j: r.jobs, d: r.destinations }));
    } catch (err) { onMsg(t("toast.error", { msg: err.message })); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="group-label">{t("cfg.title")}</div>
      <div className="group">
        <div className="row-item">
          <ISquare color="teal">💾</ISquare>
          <div className="row-body"><div className="row-title">{t("cfg.export")}</div><div className="row-desc">{t("cfg.exportDesc")}</div></div>
          <div className="row-right"><a className="btn-link" href={urls.configExport()} download>{t("cfg.download")}</a></div>
        </div>
        <div className="row-item">
          <ISquare color="purple">⬆️</ISquare>
          <div className="row-body"><div className="row-title">{t("cfg.import")}</div><div className="row-desc">{t("cfg.importDesc")}</div></div>
          <div className="row-right">
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={onFile} />
            <button className="secondary" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>{busy ? t("cfg.importing") : t("cfg.upload")}</button>
          </div>
        </div>
        <div className="row-item" style={{ display: "block" }}>
          <p className="muted" style={{ margin: 0 }}>⚠️ {t("cfg.warn")}</p>
        </div>
      </div>
    </>
  );
}

export default function Settings({ accounts = [], onMsg, theme, setTheme }) {
  const { t, lang, setLang } = useLang();
  const [s, setS] = useState(null);
  const [store, setStore] = useState(null);
  const [busy, setBusy] = useState(false);
  const [whenOpen, setWhenOpen] = useState(false);
  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));
  const loadStore = () => api.storage().then(setStore).catch(() => {});

  useEffect(() => {
    api.getSettings().then((d) => setS({ ...d, smtp_pass: "", telegram_token: "" })).catch(() => {});
    loadStore();
  }, []);

  if (!s) return <Empty>{t("common.loading")}</Empty>;

  async function save() {
    setBusy(true);
    try {
      const saved = await api.saveSettings(s);
      setS({ ...saved, smtp_pass: "", telegram_token: "" });
      onMsg(t("toast.settingsSaved"));
      loadStore();
    } catch (e) { onMsg(t("toast.error", { msg: e.message })); } finally { setBusy(false); }
  }
  async function test() {
    onMsg(t("toast.testSending"));
    try { const r = await api.testNotification(); onMsg(r.ok ? t("toast.testSent") : t("toast.error", { msg: (r.errors || []).join(" | ") })); }
    catch (e) { onMsg(t("toast.error", { msg: e.message })); }
  }
  async function prune() {
    try { const r = await api.prune(); onMsg(r.note || t("toast.pruned", { n: r.pruned })); loadStore(); }
    catch (e) { onMsg(t("toast.error", { msg: e.message })); }
  }

  const whenSummary = [s.notify_on_error && t("set.onError"), s.notify_on_change && t("set.onChange"), s.notify_on_success && t("set.onSuccess")].filter(Boolean).join(" + ") || "—";
  const diskPct = store ? Math.round(100 * store.disk_used / store.disk_total) : 0;

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Notifications */}
      <div className="group-label">{t("set.notifications")}</div>
      <div className="group">
        <div className="row-item">
          <ISquare color="blue">📧</ISquare>
          <div className="row-body">
            <div className="row-title">{t("set.email")}</div>
            <div className="row-desc">{s.smtp_user || t("set.emailDesc")}{s.smtp_host ? " · " + s.smtp_host : ""}</div>
          </div>
          <Switch on={s.email_enabled} onChange={(v) => set("email_enabled", v)} />
        </div>
        {s.email_enabled && (
          <div className="row-item" style={{ display: "block" }}>
            <div className="form-grid">
              <div><label>SMTP sunucu</label><input value={s.smtp_host} onChange={(e) => set("smtp_host", e.target.value)} placeholder="smtp.gmail.com" /></div>
              <div><label>Port</label><input type="number" value={s.smtp_port} onChange={(e) => set("smtp_port", Number(e.target.value))} /></div>
            </div>
            <div className="form-grid">
              <div><label>Kullanıcı</label><input value={s.smtp_user} onChange={(e) => set("smtp_user", e.target.value)} /></div>
              <div><label>Şifre {s.smtp_pass_set && <span className="muted">(kayıtlı)</span>}</label><input type="password" value={s.smtp_pass} onChange={(e) => set("smtp_pass", e.target.value)} placeholder={s.smtp_pass_set ? "değiştir" : ""} /></div>
            </div>
            <div className="form-grid">
              <div><label>Gönderen</label><input value={s.smtp_from} onChange={(e) => set("smtp_from", e.target.value)} /></div>
              <div><label>Alıcı</label><input value={s.smtp_to} onChange={(e) => set("smtp_to", e.target.value)} /></div>
            </div>
          </div>
        )}
        <div className="row-item">
          <ISquare color="teal">✈️</ISquare>
          <div className="row-body"><div className="row-title">{t("set.telegram")}</div><div className="row-desc">{t("set.telegramDesc")}</div></div>
          <Switch on={s.telegram_enabled} onChange={(v) => set("telegram_enabled", v)} />
        </div>
        {s.telegram_enabled && (
          <div className="row-item" style={{ display: "block" }}>
            <label>Bot token {s.telegram_token_set && <span className="muted">(kayıtlı)</span>}</label>
            <input type="password" value={s.telegram_token} onChange={(e) => set("telegram_token", e.target.value)} placeholder={s.telegram_token_set ? "değiştir" : "123456:ABC…"} />
            <label>Chat ID</label>
            <input value={s.telegram_chat_id} onChange={(e) => set("telegram_chat_id", e.target.value)} />
          </div>
        )}
        <div className="row-item tap" onClick={() => setWhenOpen((v) => !v)}>
          <ISquare color="amber">🔔</ISquare>
          <div className="row-body"><div className="row-title">{t("set.whenNotify")}</div></div>
          <div className="row-right">{whenSummary}<span className="chev">›</span></div>
        </div>
        {whenOpen && (
          <div className="row-item" style={{ display: "block" }}>
            <label className="chk"><input type="checkbox" checked={s.notify_on_error} onChange={(e) => set("notify_on_error", e.target.checked)} /> {t("set.onError")}</label>
            <label className="chk"><input type="checkbox" checked={s.notify_on_change} onChange={(e) => set("notify_on_change", e.target.checked)} /> {t("set.onChange")}</label>
            <label className="chk"><input type="checkbox" checked={s.notify_on_success} onChange={(e) => set("notify_on_success", e.target.checked)} /> {t("set.onSuccess")}</label>
          </div>
        )}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button disabled={busy} onClick={save}>{t("common.save")}</button>
        <button className="secondary" onClick={test}>{t("set.testNotify")}</button>
      </div>

      {/* Storage */}
      <div className="group-label">{t("set.storage")}</div>
      <div className="group">
        {store && (
          <div className="row-item" style={{ display: "block" }}>
            <div className="row spread"><div className="row-title">{t("set.diskUsage")}</div><span className="muted">{bytes(store.disk_used)} / {bytes(store.disk_total)}</span></div>
            <div className="storagebar">
              <div style={{ width: `${100 * store.backups_size / store.disk_total}%`, background: "var(--accent)" }} />
              <div style={{ width: `${100 * (store.disk_used - store.backups_size) / store.disk_total}%`, background: "var(--fill2)" }} />
            </div>
            <div className="legend" style={{ display: "flex", gap: 18 }}>
              <span className="legend-row"><span className="dot" style={{ background: "var(--accent)" }} />RepoArk {bytes(store.backups_size)}</span>
              <span className="legend-row"><span className="dot" style={{ background: "var(--muted)" }} />{t("set.otherData")}</span>
            </div>
          </div>
        )}
        <div className="row-item">
          <div className="row-body"><div className="row-title">{t("set.retention")}</div><div className="row-desc">{t("set.retentionDesc")}</div></div>
          <div className="row-right">
            <input type="number" min="0" style={{ width: 70, padding: "6px 9px" }} value={s.snapshot_retention} onChange={(e) => set("snapshot_retention", Number(e.target.value))} />
          </div>
        </div>
        <div className="row-item tap" onClick={prune}><div className="row-body"><div className="row-title" style={{ color: "var(--link)" }}>{t("set.pruneNow")}</div></div></div>
      </div>
      <div className="row" style={{ marginTop: 12 }}><button disabled={busy} onClick={save}>{t("common.save")}</button></div>

      {/* Remote destinations */}
      <div className="group-label">{t("set.remoteTargets")}</div>
      <Destinations accounts={accounts} onMsg={onMsg} />

      {/* General */}
      <div className="group-label">{t("set.general")}</div>
      <div className="group">
        <div className="row-item">
          <ISquare color="purple">🌗</ISquare>
          <div className="row-body"><div className="row-title">{t("side.appearance")}</div><div className="row-desc">{t("set.themeDesc")}</div></div>
          <div className="row-right">
            <div className="seg">
              <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")}>{t("theme.light")}</button>
              <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")}>{t("theme.dark")}</button>
            </div>
          </div>
        </div>
        <div className="row-item">
          <ISquare color="blue">🌐</ISquare>
          <div className="row-body"><div className="row-title">{t("side.language")}</div><div className="row-desc">{t("set.langDesc", { n: LANGS.length })}</div></div>
          <div className="row-right">
            <select style={{ width: "auto" }} value={lang} onChange={(e) => setLang(e.target.value)}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </div>
        </div>
        <div className="row-item">
          <ISquare color="gray">🔒</ISquare>
          <div className="row-body"><div className="row-title">{t("set.tokenEnc")}</div><div className="row-desc">{t("set.tokenEncDesc")}</div></div>
          <div className="row-right"><span className="badge badge-success">{t("set.active")}</span></div>
        </div>
      </div>

      {/* Security: panel password */}
      <PanelPassword onMsg={onMsg} />

      {/* Config backup / restore */}
      <ConfigBackup onMsg={onMsg} />
    </div>
  );
}
