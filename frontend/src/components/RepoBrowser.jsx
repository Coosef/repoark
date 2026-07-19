import { useEffect, useState, useCallback } from "react";
import { marked } from "marked";
import { api, urls } from "../api.js";
import { bytes, relative } from "../lib/format.js";
import { Empty } from "./ui.jsx";
import { useLang } from "../i18n.jsx";

// A few common GitHub language colors for the About panel dot (fallback gray).
const LANG_COLORS = {
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5", Go: "#00ADD8",
  Java: "#b07219", "C++": "#f34b7d", C: "#555555", "C#": "#178600", Ruby: "#701516",
  PHP: "#4F5D95", Rust: "#dea584", Swift: "#F05138", Kotlin: "#A97BFF", Dart: "#00B4AB",
  Shell: "#89e051", HTML: "#e34c26", CSS: "#563d7c", Vue: "#41b883", Svelte: "#ff3e00",
  "Jupyter Notebook": "#DA5B0B", PowerShell: "#012456", Dockerfile: "#384d54", Lua: "#000080",
};
const langColor = (l) => LANG_COLORS[l] || "var(--muted)";

export default function RepoBrowser({ accountId, repo, initialPath, onClose }) {
  const { t } = useLang();
  const [refs, setRefs] = useState({ head: "HEAD", branches: [], tags: [] });
  const [ref, setRef] = useState("HEAD");
  const [view, setView] = useState(initialPath ? "files" : "overview"); // overview | files | commits | issues | pulls
  const [path, setPath] = useState("");
  const [tree, setTree] = useState(null);
  const [file, setFile] = useState(null); // {path, blob}
  const [commits, setCommits] = useState(null);
  const [threads, setThreads] = useState(null);
  const [thread, setThread] = useState(null);
  const [overview, setOverview] = useState(null);
  const [readmeHtml, setReadmeHtml] = useState("");
  const [err, setErr] = useState("");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreName, setRestoreName] = useState(repo);
  const [restorePriv, setRestorePriv] = useState(true);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreResult, setRestoreResult] = useState(null);

  async function doRestore() {
    setRestoreBusy(true);
    setErr("");
    setRestoreResult(null);
    try {
      const r = await api.restoreRepo(accountId, repo, restoreName.trim(), restorePriv);
      setRestoreResult(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      setRestoreBusy(false);
    }
  }

  useEffect(() => {
    api.refs(accountId, repo).then((r) => {
      setRefs(r);
      setRef(r.head || "HEAD");
    }).catch((e) => setErr(e.message));
    api.overview(accountId, repo).then((o) => {
      setOverview(o);
      if (o.readme) {
        api.blob(accountId, repo, o.default_branch || "HEAD", o.readme)
          .then((b) => !b.binary && setReadmeHtml(marked.parse(b.text || "")))
          .catch(() => {});
      }
    }).catch(() => {});
  }, [accountId, repo]);

  const loadTree = useCallback((p) => {
    setFile(null);
    setErr("");
    api.tree(accountId, repo, ref, p)
      .then((t) => { setTree(t); setPath(p); })
      .catch((e) => setErr(e.message));
  }, [accountId, repo, ref]);

  useEffect(() => {
    if (!ref) return;
    setErr("");
    if (view === "files") loadTree("");
    else if (view === "commits") api.commits(accountId, repo, ref).then(setCommits).catch((e) => setErr(e.message));
    else if (view === "issues" || view === "pulls") {
      setThread(null);
      setThreads(null);
      api.threads(accountId, repo, view).then(setThreads).catch((e) => setErr(e.message));
    }
  }, [ref, view, loadTree, accountId, repo]);

  // Jump straight to a file when opened from a search result.
  const [openedInitial, setOpenedInitial] = useState(false);
  useEffect(() => {
    if (initialPath && ref && !openedInitial) {
      setOpenedInitial(true);
      api.blob(accountId, repo, ref, initialPath)
        .then((b) => setFile({ path: initialPath, blob: b }))
        .catch(() => {});
    }
  }, [ref, initialPath, openedInitial, accountId, repo]);

  function openFile(name) {
    const full = path ? `${path}/${name}` : name;
    setErr("");
    api.blob(accountId, repo, ref, full)
      .then((b) => setFile({ path: full, blob: b }))
      .catch((e) => setErr(e.message));
  }

  function openDir(name) {
    loadTree(path ? `${path}/${name}` : name);
  }

  function crumbTo(i) {
    const parts = path.split("/").filter(Boolean);
    loadTree(parts.slice(0, i + 1).join("/"));
  }

  const shortSha = ref.length >= 12 && !refs.branches.includes(ref) && !refs.tags.includes(ref);

  const refSelect = (
    <select value={shortSha ? "" : ref} onChange={(e) => setRef(e.target.value)} style={{ width: "auto", minWidth: 130 }}>
      {shortSha && <option value="">commit: {ref.slice(0, 8)}</option>}
      <optgroup label={t("repo.branches")}>{refs.branches.map((b) => <option key={b} value={b}>{b}</option>)}</optgroup>
      {refs.tags.length > 0 && (
        <optgroup label={t("repo.tags")}>{refs.tags.map((tg) => <option key={tg} value={tg}>{tg}</option>)}</optgroup>
      )}
    </select>
  );

  return (
    <div className="browser">
      <button className="back-link" onClick={onClose}>{t("repo.back")}</button>
      <div className="row spread" style={{ alignItems: "flex-start", marginTop: 4 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 26 }}>{repo}</h2>
          {overview && (
            <div className="muted" style={{ marginTop: 2 }}>
              {[overview.meta.language, overview.meta.size != null && bytes((overview.meta.size || 0) * 1024),
                overview.meta.pushed_at && relative(overview.meta.pushed_at), t("repo.upToDate")].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      </div>

      {overview && (
        <div className="metapills">
          <span className="metapill blue">{overview.meta.private ? t("repo.private") : t("repo.public")}</span>
          {overview.meta.language && <span className="metapill">{overview.meta.language}</span>}
          <span className="metapill">⭐ {overview.meta.stars ?? 0}</span>
          <span className="metapill">{overview.branches} {t("repo.branch")} · {overview.tags} {t("repo.tag")}</span>
          <span className="metapill">{overview.commits} {t("repo.commit")}</span>
          {overview.meta.fork && <span className="metapill">🍴 fork</span>}
          {overview.meta.archived && <span className="metapill">📦 {t("repo.archived")}</span>}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <a className="metapill blue" href={urls.repoDownload(accountId, repo, ref)}>⬇ Zip</a>
            <a className="metapill" href={urls.repoBundle(accountId, repo)} title={t("repo.bundleTitle")}>⬇ .bundle</a>
            <button className="metapill" onClick={() => { setRestoreName(repo); setRestorePriv(overview.meta.private ?? true); setRestoreResult(null); setRestoreOpen((v) => !v); }}>↑ {t("repo.restore")}</button>
          </span>
        </div>
      )}

      {restoreOpen && (
        <div className="card" style={{ marginBottom: 4 }}>
          <div className="group-label" style={{ margin: "0 0 6px" }}>{t("repo.restoreTitle")}</div>
          <p className="muted" style={{ marginTop: 0 }}>{t("repo.restoreDesc")}</p>
          {restoreResult ? (
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <span style={{ color: "var(--green)" }}>✓</span>
              <a className="btn-link" href={restoreResult.html_url} target="_blank" rel="noreferrer">{restoreResult.full_name}</a>
              <span className="muted">{t("repo.restoreDone")}</span>
            </div>
          ) : (
            <>
              <label>{t("repo.restoreName")}</label>
              <input value={restoreName} onChange={(e) => setRestoreName(e.target.value)} style={{ maxWidth: 320 }} />
              <label className="chk" style={{ marginTop: 10 }}>
                <input type="checkbox" checked={restorePriv} onChange={(e) => setRestorePriv(e.target.checked)} />
                {t("repo.restorePrivate")}
              </label>
              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <button onClick={doRestore} disabled={restoreBusy || !restoreName.trim()}>{restoreBusy ? t("repo.restoring") : t("repo.restoreBtn")}</button>
                <button className="secondary" onClick={() => setRestoreOpen(false)}>{t("common.cancel")}</button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="row spread" style={{ margin: "14px 0 16px" }}>
        <div className="browser-tabs">
          <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>{t("repo.overview")}</button>
          <button className={view === "files" ? "active" : ""} onClick={() => setView("files")}>{t("repo.files")}</button>
          <button className={view === "commits" ? "active" : ""} onClick={() => setView("commits")}>{t("repo.commits")}</button>
          <button className={view === "issues" ? "active" : ""} onClick={() => setView("issues")}>Issues</button>
          <button className={view === "pulls" ? "active" : ""} onClick={() => setView("pulls")}>PR</button>
        </div>
        {["files", "commits"].includes(view) && refSelect}
      </div>

      {err && <div className="error">{err}</div>}

      {view === "overview" && (
        !overview ? <Empty>{t("common.loading")}</Empty> : (
          <div className="ov-layout">
            <div className="ov-main">
              {overview.last_commit && (
                <div className="ov-lastcommit" onClick={() => setView("commits")}>
                  <div className="ov-lc-ic">🕐</div>
                  <div className="ov-lc-body">
                    <div className="ov-lc-msg">{overview.last_commit.message}</div>
                    <div className="ov-lc-meta">{overview.last_commit.author} · <code>{overview.last_commit.sha.slice(0, 7)}</code> · {relative(overview.last_commit.date)}</div>
                  </div>
                  <span className="ov-lc-count">{overview.commits} {t("repo.commit")} ›</span>
                </div>
              )}
              {readmeHtml ? (
                <div className="card readme-card">
                  <div className="readme-head">
                    <svg width="15" height="15" viewBox="0 0 24 24" style={{ opacity: .6 }}><path d="M4 4h9l5 5v11H4zM13 4v5h5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
                    README{overview.readme ? "" : ".md"}
                  </div>
                  <div className="readme markdown" dangerouslySetInnerHTML={{ __html: readmeHtml }} />
                </div>
              ) : <Empty>{t("repo.noReadme")}</Empty>}
            </div>

            <aside className="ov-side">
              <div className="card ov-about">
                <div className="ov-about-head">{t("repo.about")}</div>
                {overview.meta.description
                  ? <p className="ov-desc">{overview.meta.description}</p>
                  : <p className="ov-desc muted">{t("repo.noDesc")}</p>}
                <div className="ov-facts">
                  {overview.meta.language && (
                    <div className="ov-fact"><span className="langdot" style={{ background: langColor(overview.meta.language) }} />{overview.meta.language}</div>
                  )}
                  <div className="ov-fact">⭐ {overview.meta.stars ?? 0} {t("repo.starsWord")}</div>
                  {overview.meta.size != null && <div className="ov-fact">💾 {bytes((overview.meta.size || 0) * 1024)}</div>}
                  {overview.meta.pushed_at && <div className="ov-fact">🕐 {relative(overview.meta.pushed_at)}</div>}
                  <div className="ov-fact">{overview.meta.private ? t("repo.private") : t("repo.public")}</div>
                </div>
                <div className="ov-stats">
                  <div className="ov-stat" onClick={() => { setRef(refs.head || "HEAD"); setView("files"); }}><b>{overview.branches}</b><span>{t("repo.branches")}</span></div>
                  <div className="ov-stat"><b>{overview.tags}</b><span>{t("repo.tags")}</span></div>
                  <div className="ov-stat" onClick={() => setView("commits")}><b>{overview.commits}</b><span>{t("repo.commits")}</span></div>
                </div>
              </div>
              <div className="restore-note">{t("repo.restoreNote", { repo })}</div>
            </aside>
          </div>
        )
      )}

      {view === "files" && !file && (
        <>
          <div className="crumbs">
            <span className="crumb" onClick={() => loadTree("")}>{repo}</span>
            {path.split("/").filter(Boolean).map((seg, i) => (
              <span key={i}> / <span className="crumb" onClick={() => crumbTo(i)}>{seg}</span></span>
            ))}
          </div>
          {!tree ? <Empty>{t("common.loading")}</Empty> : (
            <table className="data">
              <tbody>
                {path && (
                  <tr className="clickable" onClick={() => crumbTo(path.split("/").filter(Boolean).length - 2)}>
                    <td colSpan="2">📁 ..</td>
                  </tr>
                )}
                {tree.entries.map((e) => (
                  <tr key={e.name} className="clickable"
                    onClick={() => e.type === "dir" ? openDir(e.name) : openFile(e.name)}>
                    <td>{e.type === "dir" ? "📁" : "📄"} {e.name}</td>
                    <td className="right">{e.type === "dir" ? "" : bytes(e.size)}</td>
                  </tr>
                ))}
                {tree.entries.length === 0 && <tr><td className="muted">{t("repo.empty")}</td></tr>}
              </tbody>
            </table>
          )}
        </>
      )}

      {view === "files" && file && (
        <div>
          <div className="row spread mb">
            <span className="crumb" onClick={() => setFile(null)}>← {file.path}</span>
            <a className="btn-link" href={urls.raw(accountId, repo, ref, file.path)}>{t("repo.downloadFile")}</a>
          </div>
          {file.blob.binary ? (
            <Empty>{t("repo.binaryFile", { size: bytes(file.blob.size) })}</Empty>
          ) : (
            <>
              {file.blob.truncated && <div className="muted mb">{t("repo.truncated")}</div>}
              <pre className="code">{file.blob.text}</pre>
            </>
          )}
        </div>
      )}

      {view === "commits" && (
        !commits ? <Empty>{t("common.loading")}</Empty> : (
          <table className="data">
            <thead><tr><th>{t("repo.msg")}</th><th>{t("repo.author")}</th><th>{t("repo.date")}</th><th></th></tr></thead>
            <tbody>
              {commits.map((c) => (
                <tr key={c.sha}>
                  <td>{c.message}<div className="sub">{c.sha.slice(0, 10)}</div></td>
                  <td>{c.author}</td>
                  <td className="sub">{c.date.slice(0, 16)}</td>
                  <td><button className="link" onClick={() => { setRef(c.sha); setView("files"); }}>{t("repo.browseVersion")}</button></td>
                </tr>
              ))}
              {commits.length === 0 && <tr><td className="muted" colSpan="4">{t("repo.noCommits")}</td></tr>}
            </tbody>
          </table>
        )
      )}

      {(view === "issues" || view === "pulls") && !thread && (
        !threads ? <Empty>{t("common.loading")}</Empty> : threads.length === 0 ? (
          <Empty>{t("repo.noThreads", { kind: view === "issues" ? "issue" : "PR" })}</Empty>
        ) : (
          <table className="data">
            <thead><tr><th>#</th><th>{t("repo.title2")}</th><th>{t("repo.state")}</th><th className="right">{t("repo.comment")}</th></tr></thead>
            <tbody>
              {threads.map((t) => (
                <tr key={t.number} className="clickable"
                  onClick={() => api.thread(accountId, repo, view, t.number).then(setThread).catch((e) => setErr(e.message))}>
                  <td className="sub">#{t.number}</td>
                  <td>{t.title}</td>
                  <td><span className={`state state-${t.state}`}>{t.state}</span></td>
                  <td className="right">{t.comments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {(view === "issues" || view === "pulls") && thread && (
        <div className="thread">
          <div className="row spread mb">
            <span className="crumb" onClick={() => setThread(null)}>{t("repo.list")}</span>
            {thread.html_url && <a className="btn-link" href={thread.html_url} target="_blank" rel="noreferrer">{t("repo.openGithub")}</a>}
          </div>
          <h3>#{thread.number} · {thread.title} <span className={`state state-${thread.state}`}>{thread.state}</span></h3>
          <div className="muted mb">{thread.user} · {thread.created_at?.slice(0, 16)}
            {thread.labels?.length ? " · " + thread.labels.join(", ") : ""}</div>
          <div className="comment">
            <div className="comment-head">{thread.user}</div>
            <div className="comment-body">{thread.body || <span className="muted">{t("repo.noContent")}</span>}</div>
          </div>
          {thread.comments.map((c, i) => (
            <div className="comment" key={i}>
              <div className="comment-head">{c.user} · {c.created_at?.slice(0, 16)}</div>
              <div className="comment-body">{c.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
