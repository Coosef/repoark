import { useEffect, useState, useRef, useCallback } from "react";
import { api } from "../api.js";
import { datetime } from "../lib/format.js";
import { Empty } from "./ui.jsx";
import FindingModal from "./SecretFinding.jsx";
import { useLang } from "../i18n.jsx";

// Secret-scan findings grouped per repo: a repo header, then each hit as
// "file:line · masked preview" with a kind chip. Click opens the detail modal.
function ScanFindings({ findings, t, onSelect }) {
  const groups = [];
  const idx = {};
  for (const f of findings) {
    if (!(f.repo in idx)) { idx[f.repo] = groups.length; groups.push({ repo: f.repo, items: [] }); }
    groups[idx[f.repo]].items.push(f);
  }
  const mono = { fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12, overflowWrap: "anywhere" };
  return (
    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
      {groups.slice(0, 30).map((g) => (
        <div key={g.repo}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            📁 {g.repo} <span className="muted" style={{ fontWeight: 400 }}>({g.items.length})</span>
          </div>
          <div style={{ display: "grid", gap: 4, paddingLeft: 12 }}>
            {g.items.slice(0, 12).map((f, i) => (
              <div key={i} className="tap" onClick={() => onSelect(f)}
                style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", cursor: "pointer" }}>
                <span className="pill">{t("scan.kind." + f.label)}</span>
                <span style={mono}>{f.file}{f.line ? `:${f.line}` : ""}{f.preview ? ` · ${f.preview}` : ""}</span>
                <span className="chev" style={{ marginLeft: "auto" }}>›</span>
              </div>
            ))}
            {g.items.length > 12 && <div className="muted">{t("scan.more", { n: g.items.length - 12 })}</div>}
          </div>
        </div>
      ))}
      {groups.length > 30 && <div className="muted">{t("scan.more", { n: groups.length - 30 })}</div>}
    </div>
  );
}

// The dedicated Security page: run scans, watch live progress, and work
// through the findings — own repos (urgent) and starred (informational) in
// their own cards, each finding opening the detail modal with jump links.
export default function SecurityPage({ accountId, onMsg, onOpenFinding }) {
  const { t } = useLang();
  const [secrets, setSecrets] = useState(null);
  const [secBusy, setSecBusy] = useState(false);
  const [secModal, setSecModal] = useState(null);

  const load = useCallback(() => {
    if (!accountId) return;
    api.secretScan(accountId).then(setSecrets).catch(() => setSecrets(null));
  }, [accountId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  async function rescan(force) {
    setSecBusy(true);
    try {
      setSecrets(await api.runSecretScan(accountId, !!force));
    } catch (e) {
      onMsg(t("toast.error", { msg: e.message }));
    } finally {
      setSecBusy(false);
    }
  }

  // Poll fast while a scan runs; announce the outcome once when it finishes.
  const prevRunning = useRef(false);
  useEffect(() => {
    if (prevRunning.current && secrets && !secrets.running) {
      onMsg(secrets.total > 0 ? t("scan.foundToast", { n: secrets.total }) : t("scan.none"));
    }
    prevRunning.current = !!secrets?.running;
    if (!secrets?.running) return;
    const id = setInterval(() => {
      api.secretScan(accountId).then(setSecrets).catch(() => {});
    }, 1500);
    return () => clearInterval(id);
  }, [secrets?.running, accountId]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!accountId) return <Empty>{t("dash.connectFirst")}</Empty>;
  if (!secrets) return <Empty>{t("common.loading")}</Empty>;

  const busy = secBusy || secrets.running;

  return (
    <div>
      {/* Live progress while a scan runs */}
      {secrets.running && (
        <div className="card">
          <div className="card-lead"><span className="spinner" /><b>🔐 {t("scan.progressTitle")}</b></div>
          {secrets.progress?.total > 0 && (
            <>
              <div className="storagebar" style={{ marginTop: 12 }}>
                <div style={{ width: `${Math.round(100 * secrets.progress.done / secrets.progress.total)}%`, background: "var(--accent)" }} />
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                {t("scan.progress", { done: secrets.progress.done, total: secrets.progress.total, repo: secrets.progress.current || "…" })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Never scanned yet: explain and offer the first scan */}
      {!secrets.running && !secrets.scanned_at && (
        <div className="card">
          <h3>🔐 {t("scan.title")}</h3>
          <p className="muted">{t("scan.note")}</p>
          <button onClick={() => rescan(false)} disabled={busy}>{t("scan.scanNow")}</button>
        </div>
      )}

      {/* Scan done and clean */}
      {!secrets.running && secrets.scanned_at && secrets.total === 0 && (
        <div className="card">
          <div className="row spread">
            <div>
              <b style={{ color: "var(--green)" }}>🔐 {t("scan.none")}</b>{" "}
              <span className="muted">
                — {t("scan.scannedCount", { n: secrets.repos_scanned })} · {t("scan.last", { date: datetime(secrets.scanned_at) })}
              </span>
            </div>
            <button className="secondary" onClick={() => rescan(true)} disabled={busy}>{t("scan.scanNow")}</button>
          </div>
        </div>
      )}

      {/* Own repos: urgent */}
      {secrets.own?.total > 0 && (
        <div className="card" style={{ marginTop: 16, borderColor: "var(--pink)" }}>
          <div className="row spread">
            <h3>🔐 {t("scan.title")}</h3>
            <button className="secondary" onClick={() => rescan(true)} disabled={busy}>
              {busy ? t("scan.scanning") : t("scan.scanNow")}
            </button>
          </div>
          <div className="muted">
            <b style={{ color: "var(--pink)" }}>{t("scan.summary", { n: secrets.own.total, repos: secrets.own.repos })}</b>
            {" — "}{t("scan.sub")}
          </div>
          <ScanFindings findings={secrets.own.findings} t={t} onSelect={setSecModal} />
          <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            {t("scan.note")}{secrets.scanned_at ? ` · ${t("scan.last", { date: datetime(secrets.scanned_at) })}` : ""}
          </div>
        </div>
      )}

      {/* Starred repos: informational */}
      {secrets.starred?.total > 0 && (
        <div className="card" style={{ marginTop: 16, borderColor: "var(--amber)" }}>
          <div className="row spread">
            <h3>⭐ {t("scan.starredTitle")}</h3>
            {!(secrets.own?.total > 0) && !secrets.running && (
              <button className="secondary" onClick={() => rescan(true)} disabled={busy}>
                {busy ? t("scan.scanning") : t("scan.scanNow")}
              </button>
            )}
          </div>
          <div className="muted">
            <b style={{ color: "var(--amber)" }}>{t("scan.summary", { n: secrets.starred.total, repos: secrets.starred.repos })}</b>
            {" — "}{t("scan.starredSub")}
          </div>
          <ScanFindings findings={secrets.starred.findings} t={t} onSelect={setSecModal} />
          <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            {secrets.scanned_at ? t("scan.last", { date: datetime(secrets.scanned_at) }) : ""}
          </div>
        </div>
      )}

      {secModal && (
        <FindingModal finding={secModal} accountId={accountId} onClose={() => setSecModal(null)}
          onOpenPanel={(f) => { setSecModal(null); onOpenFinding && onOpenFinding(f); }} />
      )}
    </div>
  );
}
