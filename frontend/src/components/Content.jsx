import { useEffect, useState } from "react";
import { api } from "../api.js";
import { bytes } from "../lib/format.js";
import { Empty } from "./ui.jsx";
import RepoBrowser from "./RepoBrowser.jsx";
import SnapshotDetail from "./SnapshotDetail.jsx";
import GistBrowser from "./GistBrowser.jsx";
import Search from "./Search.jsx";
import { useLang } from "../i18n.jsx";

const TABS = [
  ["repos", "Repolar"],
  ["search", "Arama"],
  ["starred", "Yıldızlar"],
  ["gists", "Gist'ler"],
  ["social", "Sosyal"],
  ["snapshots", "Snapshot'lar"],
  ["storage", "Depolama"],
];

const stars = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".0", "") + "k" : (n ?? 0));

export default function Content({ accountId, onMsg }) {
  const { t } = useLang();
  const [tab, setTab] = useState("repos");
  // loaded holds {tab, data} so we never render one tab's markup against
  // another tab's data during the brief window before a fetch resolves.
  const [loaded, setLoaded] = useState(null);
  const [q, setQ] = useState("");
  const [repo, setRepo] = useState(null);       // {name, path?} open repo browser
  const [gist, setGist] = useState(null);       // {id, description} open gist browser
  const [snapshot, setSnapshot] = useState(null); // open snapshot detail
  const [gone, setGone] = useState(new Set());  // repos deleted from GitHub
  const [repoFilter, setRepoFilter] = useState("all"); // all | own | starred | other
  const [selMode, setSelMode] = useState(false);       // multi-select for bulk delete
  const [sel, setSel] = useState(new Set());           // selected repo names
  const [bump, setBump] = useState(0);                 // re-fetch trigger after delete

  useEffect(() => {
    if (!accountId) return;
    api.deleted(accountId).then((d) => setGone(new Set(d.map((r) => r.name)))).catch(() => {});
  }, [accountId]);

  useEffect(() => {
    // "search" has no list payload of its own.
    if (!accountId || tab === "search") { setLoaded({ tab, data: null }); return; }
    let active = true;
    setLoaded(null);
    setQ("");
    setSelMode(false);
    setSel(new Set());
    const load = tab === "storage" ? api.dirStorage : api[tab];
    load(accountId)
      .then((data) => active && setLoaded({ tab, data }))
      .catch(() => active && setLoaded({ tab, data: null }));
    return () => { active = false; };
  }, [tab, accountId, bump]);

  async function pruneOne(name, sizeBytes) {
    if (!confirm(t("storage.delConfirm", { name, size: bytes(sizeBytes) }))) return;
    try {
      const r = await api.pruneDir(accountId, name);
      onMsg && onMsg(t("storage.freed", { size: bytes(r.freed_bytes) }));
      setBump((b) => b + 1);
    } catch (e) {
      onMsg && onMsg(t("toast.error", { msg: e.message }));
    }
  }

  async function delNames(names) {
    if (!names.length) return;
    const msg = names.length === 1
      ? t("content.delConfirm", { name: names[0] })
      : t("content.delBulk", { n: names.length });
    if (!confirm(msg)) return;
    try {
      const r = await api.deleteRepos(accountId, names);
      onMsg && onMsg(t("content.deleted", { n: r.deleted, size: bytes(r.freed_bytes) }));
      setSel(new Set());
      setSelMode(false);
      setBump((b) => b + 1);
    } catch (e) {
      onMsg && onMsg(t("toast.error", { msg: e.message }));
    }
  }

  if (!accountId) return <Empty>Önce bir hesap bağla.</Empty>;
  if (repo) return <RepoBrowser accountId={accountId} repo={repo.name} initialPath={repo.path} onClose={() => setRepo(null)} />;
  if (gist) return <GistBrowser accountId={accountId} gid={gist.id} description={gist.description} onClose={() => setGist(null)} />;
  if (snapshot) return <SnapshotDetail accountId={accountId} name={snapshot} onClose={() => setSnapshot(null)} />;

  const ready = loaded && loaded.tab === tab;
  const data = ready ? loaded.data : null;
  const filter = (s) => (s || "").toLowerCase().includes(q.toLowerCase());

  return (
    <div>
      <div className="subtabs">
        {TABS.map(([k]) => (
          <button key={k} className={`subtab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{t("tab." + k)}</button>
        ))}
      </div>

      {["repos", "starred", "gists"].includes(tab) && (
        <input className="search" placeholder={t("content.search")} value={q} onChange={(e) => setQ(e.target.value)} />
      )}

      {tab === "search" && (
        <Search accountId={accountId} onOpen={(repoName, path) => setRepo({ name: repoName, path })} />
      )}

      {tab !== "search" && !ready && <Empty>{t("common.loading")}</Empty>}

      {ready && tab === "repos" && (() => {
        const all = data || [];
        const kind = (r) => r.kind || "own";
        const hasExtra = all.some((r) => kind(r) === "starred" || kind(r) === "other");
        const count = (k) => all.filter((r) => kind(r) === k).length;
        const rows = all
          .filter((r) => filter(r.name) || filter(r.full_name))
          .filter((r) => repoFilter === "all" || kind(r) === repoFilter);
        const rowNames = rows.map((r) => r.name);
        const allSel = rowNames.length > 0 && rowNames.every((n) => sel.has(n));
        const toggle = (name) => setSel((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
        const seg = (k, label) => <button className={repoFilter === k ? "on" : ""} onClick={() => setRepoFilter(k)}>{label}</button>;
        const amber = { marginLeft: 8, background: "var(--amberT)", color: "var(--amber)" };
        return (
          <>
            <div className="row spread" style={{ marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
              {hasExtra ? (
                <div className="seg">
                  {seg("all", `${t("content.filterAll")} ${all.length}`)}
                  {seg("own", `${t("content.filterOwn")} ${count("own")}`)}
                  {count("starred") > 0 && seg("starred", `⭐ ${t("content.filterStarred")} ${count("starred")}`)}
                  {count("other") > 0 && seg("other", `${t("content.filterOther")} ${count("other")}`)}
                </div>
              ) : <span />}
              <div className="row" style={{ gap: 10 }}>
                {selMode ? (
                  <>
                    <button className="link" onClick={() => setSel(new Set(allSel ? [] : rowNames))}>{t("content.selectAll")}</button>
                    <button className="stop-btn" disabled={sel.size === 0} onClick={() => delNames([...sel])}>{t("common.delete")} ({sel.size})</button>
                    <button className="link" onClick={() => { setSelMode(false); setSel(new Set()); }}>{t("common.cancel")}</button>
                  </>
                ) : (
                  all.length > 0 && <button className="link" onClick={() => setSelMode(true)}>{t("content.select")}</button>
                )}
              </div>
            </div>
            <div className="group">
              {rows.map((r) => {
                const k = kind(r);
                const checked = sel.has(r.name);
                return (
                  <div className={`frow ${selMode && checked ? "sel" : ""}`} key={r.name}
                    onClick={() => selMode ? toggle(r.name) : setRepo({ name: r.name })}>
                    {selMode
                      ? <input type="checkbox" checked={checked} readOnly style={{ width: "auto", pointerEvents: "none" }} />
                      : k === "starred"
                        ? <div className="isq isq-amber">⭐</div>
                        : k === "other"
                          ? <div className="isq" style={{ background: "var(--amberT)", color: "var(--amber)" }}>?</div>
                          : <div className="folder-ic"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M3 7l1.4-3h5.2l1.4 2h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg></div>}
                    <div className="row-body">
                      <div className="row-title">
                        {k === "starred" && r.full_name ? r.full_name : r.name}
                        {k === "starred" && <span className="badge" style={amber}>{t("content.starredTag")}</span>}
                        {k === "other" && <span className="badge" style={amber}>{t("content.filterOther")}</span>}
                        {gone.has(r.name) && <span className="badge badge-success" style={{ marginLeft: 8 }}>{t("content.vault")}</span>}
                      </div>
                      <div className="row-desc">{[bytes(r.size_bytes), r.language, r.private ? t("content.private") : null, gone.has(r.name) ? t("content.onlyBackup") : null].filter(Boolean).join(" · ")}</div>
                    </div>
                    {!selMode && (
                      <button className="row-del" title={t("common.delete")} onClick={(e) => { e.stopPropagation(); delNames([r.name]); }}>
                        <svg width="16" height="16" viewBox="0 0 24 24"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                    )}
                    {!selMode && <span className="chev">›</span>}
                  </div>
                );
              })}
              {rows.length === 0 && <div className="row-item"><span className="muted">{t("content.noRepos")}</span></div>}
            </div>
          </>
        );
      })()}

      {ready && tab === "starred" && (
        <div className="group">
          {(data || []).filter((r) => filter(r.full_name)).map((r) => (
            <a className="frow" key={r.full_name} href={r.html_url} target="_blank" rel="noreferrer">
              <div className="isq isq-amber">⭐</div>
              <div className="row-body">
                <div className="row-title">{r.full_name}</div>
                {r.description && <div className="row-desc">{r.description}</div>}
              </div>
              <div className="row-right">
                {r.language && <span className="pill">{r.language}</span>}
                <span>★ {stars(r.stars)}</span>
              </div>
            </a>
          ))}
          {(data || []).length === 0 && <div className="row-item"><span className="muted">{t("content.noStars")}</span></div>}
        </div>
      )}

      {ready && tab === "gists" && (
        <div className="group">
          {(data || []).filter((g) => filter(g.description) || filter(g.id)).map((g) => (
            <div className="frow" key={g.id} onClick={() => setGist({ id: g.id, description: g.description })}>
              <div className="isq isq-purple" style={{ fontSize: 13, fontWeight: 700 }}>{"</>"}</div>
              <div className="row-body">
                <div className="row-title">{g.description || t("content.noGistDesc")}</div>
                <div className="row-desc">{(g.files || []).join(" · ") || g.id}</div>
              </div>
              <span className="chev">›</span>
            </div>
          ))}
          {(data || []).length === 0 && <div className="row-item"><span className="muted">{t("content.noGists")}</span></div>}
        </div>
      )}

      {ready && tab === "social" && data && (
        <div className="grid-2">
          <div className="card">
            <h3>{t("content.followers")} <span className="muted" style={{ fontWeight: 400 }}>{(data.followers || []).length}</span></h3>
            <div className="chips">
              {(data.followers || []).length === 0 && <span className="muted">{t("content.socialNone")}</span>}
              {(data.followers || []).map((u) => (
                <a className="chip" key={u} href={`https://github.com/${u}`} target="_blank" rel="noreferrer">{u}</a>
              ))}
            </div>
          </div>
          <div className="card">
            <h3>{t("content.following")} <span className="muted" style={{ fontWeight: 400 }}>{(data.following || []).length}</span></h3>
            <div className="chips">
              {(data.following || []).length === 0 && <span className="muted">{t("content.socialNone")}</span>}
              {(data.following || []).map((u) => (
                <a className="chip" key={u} href={`https://github.com/${u}`} target="_blank" rel="noreferrer">{u}</a>
              ))}
            </div>
          </div>
        </div>
      )}

      {ready && tab === "snapshots" && (
        <div className="group">
          {(data || []).map((s) => (
            <div className="frow" key={s.name} onClick={() => setSnapshot(s.name)}>
              <div className="isq lg isq-purple">🗂️</div>
              <div className="row-body">
                <div className="row-title">{s.name}</div>
                <div className="row-desc">{s.files} dosya · {bytes(s.size_bytes)}</div>
              </div>
              <span className="chev">›</span>
            </div>
          ))}
          {(data || []).length === 0 && <div className="row-item"><span className="muted">{t("content.noSnaps")}</span></div>}
        </div>
      )}

      {ready && tab === "storage" && (
        <div className="group">
          {(data || []).map((s) => (
            <div className="frow" key={s.name}>
              <div className="folder-ic"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M3 7l1.4-3h5.2l1.4 2h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg></div>
              <div className="row-body">
                <div className="row-title">{s.name}{s.protected && <span className="badge badge-success" style={{ marginLeft: 8 }}>✓</span>}</div>
                <div className="row-desc">{bytes(s.size_bytes)}</div>
              </div>
              {!s.protected && (
                <button className="row-del" title={t("common.delete")} onClick={() => pruneOne(s.name, s.size_bytes)}>
                  <svg width="16" height="16" viewBox="0 0 24 24"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              )}
            </div>
          ))}
          {(data || []).length === 0 && <div className="row-item"><span className="muted">{t("content.noRepos")}</span></div>}
        </div>
      )}
    </div>
  );
}
