import { useState } from "react";
import { api } from "../api.js";
import { Empty } from "./ui.jsx";
import { useLang } from "../i18n.jsx";

export default function Search({ accountId, onOpen }) {
  const { t } = useLang();
  const [q, setQ] = useState("");
  const [mode, setMode] = useState("filename"); // filename | content
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [truncated, setTruncated] = useState(false);

  async function run(e) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      const d = await api.search(accountId, q.trim(), mode);
      setRes(d.results);
      setTruncated(d.truncated);
    } catch {
      setRes([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form className="row mb" onSubmit={run}>
        <input className="search" style={{ maxWidth: 380, margin: 0 }}
          placeholder={mode === "content" ? t("search.contentPh") : t("search.filePh")}
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ width: "auto" }} value={mode} onChange={(e) => { setMode(e.target.value); setRes(null); }}>
          <option value="filename">{t("search.filename")}</option>
          <option value="content">{t("search.content")}</option>
        </select>
        <button disabled={busy || q.trim().length < 2}>{busy ? t("search.searching") : t("search.go")}</button>
      </form>

      {res && res.length === 0 && <Empty>{t("search.none")}</Empty>}
      {res && res.length > 0 && (
        <>
          <div className="muted mb">{t("search.results", { n: res.length })}{truncated ? " " + t("search.limit") : ""}</div>
          <table className="data">
            <tbody>
              {res.map((r, i) => (
                <tr key={i} className="clickable" onClick={() => onOpen(r.repo, r.path)}>
                  <td>
                    <span className="pill">{r.repo}</span> {r.path}
                    {r.line && <span className="sub"> :{r.line}</span>}
                    {r.text && <div className="code-inline">{r.text}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
