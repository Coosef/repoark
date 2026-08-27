import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useLang } from "../i18n.jsx";

// The live-GitHub location of a finding. /blob/HEAD/ resolves to the default
// branch on GitHub, so no branch lookup is needed; #L anchors the exact line.
export function githubUrl(f) {
  if ((f.repo || "").startsWith("gist:")) return `https://gist.github.com/${f.repo.slice(5)}`;
  const full = f.full_name || ((f.repo || "").includes("/") ? f.repo : null);
  if (!full) return null;
  if (!f.file) return `https://github.com/${full}`;
  return `https://github.com/${full}/blob/HEAD/${encodeURI(f.file)}${f.line ? `#L${f.line}` : ""}`;
}

// Detail modal for one secret-scan finding, with two jump targets: the file
// inside RepoArk's own backup browser, and the live file on GitHub. The eye
// button fetches the real value from the backup on demand — never stored.
export default function FindingModal({ finding: f, accountId, onClose, onOpenPanel }) {
  const { t } = useLang();
  const [revealed, setRevealed] = useState(null);
  const [revealBusy, setRevealBusy] = useState(false);
  useEffect(() => { setRevealed(null); }, [f]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!f) return null;

  async function toggleReveal() {
    if (revealed != null) { setRevealed(null); return; }
    setRevealBusy(true);
    try {
      const r = await api.revealSecret(accountId, f);
      setRevealed(r.text);
    } catch (e) {
      setRevealed(`✗ ${e.message}`);
    } finally {
      setRevealBusy(false);
    }
  }

  const gh = githubUrl(f);
  const mono = { fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12.5, overflowWrap: "anywhere" };
  const row = (label, value) => (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
      <span className="muted" style={{ minWidth: 130, flexShrink: 0 }}>{label}</span>
      <span style={{ minWidth: 0 }}>{value}</span>
    </div>
  );

  return (
    <div className="dlg-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label={t("scan.detailTitle")} style={{ maxWidth: 520 }}>
        <h3 className="dlg-title">🔐 {t("scan.detailTitle")}</h3>
        <div style={{ display: "grid", gap: 8, margin: "10px 0 4px" }}>
          {row("Repo", <b style={{ overflowWrap: "anywhere" }}>{f.repo}</b>)}
          {row(t("scan.file"), <span style={mono}>{f.file}</span>)}
          {row(t("scan.line"), f.line ? <span style={mono}>{f.line}</span> : "—")}
          {row(t("scan.kind"), <>
            {t("scan.kind." + f.label)}{" "}
            <span className="pill" style={{ ...mono, fontSize: 11 }}>{f.kind}</span>
          </>)}
          {f.preview && row(t("scan.preview"), <>
            <span style={mono}>{f.preview}</span>
            {!!f.line && accountId && (
              <button type="button" className="link" style={{ marginLeft: 10 }}
                onClick={toggleReveal} disabled={revealBusy}>
                👁 {revealBusy ? "…" : revealed != null ? t("scan.hide") : t("scan.reveal")}
              </button>
            )}
          </>)}
          {revealed != null && (
            <div style={{ gridColumn: "1 / -1" }}>
              <pre style={{ ...mono, background: "var(--fill)", padding: "8px 10px",
                            borderRadius: 8, margin: 0, whiteSpace: "pre-wrap" }}>{revealed}</pre>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>{t("scan.revealNote")}</div>
            </div>
          )}
        </div>
        <div className="dlg-actions" style={{ flexWrap: "wrap" }}>
          <button type="button" className="dlg-cancel" onClick={onClose}>{t("common.close")}</button>
          {gh && (
            <a className="btn-link" href={gh} target="_blank" rel="noreferrer"
               style={{ display: "inline-flex", alignItems: "center" }}>
              ↗ {t("scan.openGithub")}
            </a>
          )}
          {onOpenPanel && (
            <button type="button" className="dlg-confirm" onClick={() => onOpenPanel(f)}>
              {t("scan.openPanel")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
