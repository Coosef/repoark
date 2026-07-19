import { useEffect, useState } from "react";
import { api, urls } from "../api.js";
import { bytes } from "../lib/format.js";
import { Empty } from "./ui.jsx";
import { useLang } from "../i18n.jsx";

export default function SnapshotDetail({ accountId, name, onClose }) {
  const { t } = useLang();
  const [detail, setDetail] = useState(null);
  const [file, setFile] = useState(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    api.snapshotDetail(accountId, name).then(setDetail).catch((e) => setErr(e.message));
  }, [accountId, name]);

  function open(path) {
    setErr("");
    api.snapshotFile(accountId, name, path)
      .then((f) => setFile({ path, ...f }))
      .catch((e) => setErr(e.message));
  }

  return (
    <div className="browser">
      <div className="browser-bar">
        <button className="secondary sm" onClick={onClose}>{t("snap.back")}</button>
        <b className="browser-title">🗂️ {name}</b>
        {detail && <span className="muted">{t("snap.files", { n: detail.count })}</span>}
        <a className="btn-link" href={urls.snapshotDownload(accountId, name)}>{t("snap.zip")}</a>
      </div>

      {err && <div className="error">{err}</div>}

      {file && (
        <div className="mb">
          <div className="row spread mb">
            <span className="crumb" onClick={() => setFile(null)}>← {file.path}</span>
            <span className="muted">{bytes(file.size)}</span>
          </div>
          {file.truncated && <div className="muted mb">{t("repo.truncated")}</div>}
          <pre className="code">{file.text}</pre>
        </div>
      )}

      {!file && (
        !detail ? <Empty>{t("common.loading")}</Empty> : (
          <>
            <input className="search" placeholder={t("snap.searchFile")} value={q} onChange={(e) => setQ(e.target.value)} />
            <table className="data">
              <thead><tr><th>{t("snap.file")}</th><th className="right">{t("snap.size")}</th></tr></thead>
              <tbody>
                {detail.files.filter((f) => f.path.toLowerCase().includes(q.toLowerCase())).map((f) => (
                  <tr key={f.path} className="clickable" onClick={() => open(f.path)}>
                    <td>📄 {f.path}</td>
                    <td className="right">{bytes(f.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )
      )}
    </div>
  );
}
