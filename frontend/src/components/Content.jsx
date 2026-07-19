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
];

const stars = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".0", "") + "k" : (n ?? 0));

export default function Content({ accountId }) {
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
  const [repoFilter, setRepoFilter] = useState("all"); // all | own | starred

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
    api[tab](accountId)
      .then((data) => active && setLoaded({ tab, data }))
      .catch(() => active && setLoaded({ tab, data: null }));
    return () => { active = false; };
  }, [tab, accountId]);

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
        const hasStarred = (data || []).some((r) => r.kind === "starred");
        const rows = (data || [])
          .filter((r) => filter(r.name))
          .filter((r) => repoFilter === "all" || r.kind === repoFilter);
        const ownCount = (data || []).filter((r) => r.kind !== "starred").length;
        const starCount = (data || []).length - ownCount;
        return (
          <>
            {hasStarred && (
              <div className="seg" style={{ marginBottom: 12 }}>
                <button className={repoFilter === "all" ? "on" : ""} onClick={() => setRepoFilter("all")}>{t("content.filterAll")} {(data || []).length}</button>
                <button className={repoFilter === "own" ? "on" : ""} onClick={() => setRepoFilter("own")}>{t("content.filterOwn")} {ownCount}</button>
                <button className={repoFilter === "starred" ? "on" : ""} onClick={() => setRepoFilter("starred")}>⭐ {t("content.filterStarred")} {starCount}</button>
              </div>
            )}
            <div className="group">
              {rows.map((r) => (
                <div className="frow" key={r.name} onClick={() => setRepo({ name: r.name })}>
                  {r.kind === "starred"
                    ? <div className="isq isq-amber">⭐</div>
                    : <div className="folder-ic"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M3 7l1.4-3h5.2l1.4 2h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg></div>}
                  <div className="row-body">
                    <div className="row-title">
                      {r.kind === "starred" && r.full_name ? r.full_name : r.name}
                      {r.kind === "starred" && <span className="badge" style={{ marginLeft: 8, background: "var(--amberT)", color: "var(--amber)" }}>{t("content.starredTag")}</span>}
                      {gone.has(r.name) && <span className="badge badge-success" style={{ marginLeft: 8 }}>{t("content.vault")}</span>}
                    </div>
                    <div className="row-desc">{[bytes(r.size_bytes), r.language, r.private ? t("content.private") : null, gone.has(r.name) ? t("content.onlyBackup") : null].filter(Boolean).join(" · ")}</div>
                  </div>
                  <span className="chev">›</span>
                </div>
              ))}
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
    </div>
  );
}
