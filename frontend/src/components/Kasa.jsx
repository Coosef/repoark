import { useEffect, useState } from "react";
import { api, urls } from "../api.js";
import { bytes } from "../lib/format.js";
import { Empty } from "./ui.jsx";
import { useLang } from "../i18n.jsx";

export default function Kasa({ accountId, onMsg }) {
  const { t } = useLang();
  const [items, setItems] = useState(null);

  useEffect(() => {
    if (!accountId) return;
    api.deleted(accountId).then(setItems).catch(() => setItems([]));
  }, [accountId]);

  if (!accountId) return <Empty>{t("dash.connectFirst")}</Empty>;
  if (!items) return <Empty>{t("common.loading")}</Empty>;

  return (
    <div>
      <div className="group" style={{ marginBottom: 16 }}>
        <div className="row-item">
          <div className="isq lg isq-green">🛡️</div>
          <div className="row-body">
            <div className="row-title">{t("kasa.protectOn")}</div>
            <div className="row-desc">{t("kasa.protectDesc")}</div>
          </div>
        </div>
      </div>

      {items.length === 0 && <Empty>{t("kasa.empty")}</Empty>}

      {items.length > 0 && (
        <div className="group">
          {items.map((r) => (
            <div className="row-item" key={r.name}>
              <div className="isq lg isq-gray">📁</div>
              <div className="row-body">
                <div className="row-title">{r.name} <span className="badge badge-success">{t("kasa.kept")}</span></div>
                <div className="row-desc">{t("kasa.gone", { size: bytes(r.size_bytes) })}</div>
              </div>
              <div className="row-right">
                <a className="btn-link" href={urls.repoBundle(accountId, r.name)}>⬇ .bundle</a>
                <a className="btn-link" style={{ background: "var(--greenT)", color: "var(--greenTx)" }}
                  href={urls.repoBundle(accountId, r.name)}>{t("kasa.restore")}</a>
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && <p className="muted" style={{ marginTop: 14 }}>{t("kasa.restoreNote")}</p>}
    </div>
  );
}
