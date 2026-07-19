import { useEffect, useState } from "react";
import { api, urls } from "../api.js";
import { bytes } from "../lib/format.js";
import { Empty } from "./ui.jsx";
import { useLang } from "../i18n.jsx";

// Lightweight browser for a single gist (a small git repo of a few files).
export default function GistBrowser({ accountId, gid, description, onClose }) {
  const { t } = useLang();
  const [tree, setTree] = useState(null);
  const [file, setFile] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.gistTree(accountId, gid, "").then(setTree).catch((e) => setErr(e.message));
  }, [accountId, gid]);

  function open(name) {
    setErr("");
    api.gistBlob(accountId, gid, name)
      .then((b) => setFile({ name, blob: b }))
      .catch((e) => setErr(e.message));
  }

  return (
    <div className="browser">
      <div className="browser-bar">
        <button className="secondary sm" onClick={onClose}>{t("gist.back")}</button>
        <b className="browser-title">📝 {description || gid}</b>
        <a className="btn-link" href={urls.gistDownload(accountId, gid)}>{t("snap.zip")}</a>
      </div>
      {err && <div className="error">{err}</div>}

      {file ? (
        <div>
          <div className="row spread mb">
            <span className="crumb" onClick={() => setFile(null)}>← {file.name}</span>
            <span className="muted">{bytes(file.blob.size)}</span>
          </div>
          {file.blob.binary
            ? <Empty>{t("repo.binaryFile", { size: bytes(file.blob.size) })}</Empty>
            : <pre className="code">{file.blob.text}</pre>}
        </div>
      ) : (
        !tree ? <Empty>{t("common.loading")}</Empty> : (
          <table className="data">
            <tbody>
              {tree.entries.map((e) => (
                <tr key={e.name} className="clickable" onClick={() => open(e.name)}>
                  <td>📄 {e.name}</td>
                  <td className="right">{bytes(e.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
