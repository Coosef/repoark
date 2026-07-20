import { useEffect, useState, useCallback } from "react";
import { api } from "./api.js";
import Dashboard from "./components/Dashboard.jsx";
import Accounts from "./components/Accounts.jsx";
import Jobs, { emptyJob } from "./components/Jobs.jsx";
import Content from "./components/Content.jsx";
import History from "./components/History.jsx";
import Settings from "./components/Settings.jsx";
import Kasa from "./components/Kasa.jsx";
import Timeline from "./components/Timeline.jsx";
import Wizard from "./components/Wizard.jsx";
import { RunPill } from "./components/Progress.jsx";
import { useLang, LANGS } from "./i18n.jsx";

const NAV = [
  { key: "dashboard", label: "Genel Bakış", d: "M4 4h6v8H4zM14 4h6v5h-6zM14 13h6v7h-6zM4 16h6v4H4z" },
  { key: "timeline", label: "Zaman Tüneli", d: "M12 8v4l3 2M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18" },
  { key: "jobs", label: "Yedek İşleri", d: "M12 7.5v5l3.5 2M21 12a9 9 0 1 1-2.6-6.3M21 3v4h-4" },
  { key: "kasa", label: "Kasa", d: "M12 3.3l7 2.8v5.4c0 5-3.5 8.1-7 10.2c-3.5-2.1-7-5.2-7-10.2V6.1z" },
  { key: "content", label: "İçerik", d: "M3 7l1.4-3h15.2L21 7M4 7v12a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7M3 7h18M10 11h4" },
  { key: "history", label: "Geçmiş", d: "M3 3v5h5M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3 8M12 8v4.5l3.5 2" },
  { key: "settings", label: "Ayarlar", d: "M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6M19.4 13a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0a1.6 1.6 0 0 0-2.7-1.1a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14.6a1.6 1.6 0 0 0-1-.6H2a2 2 0 0 1 0-4a1.6 1.6 0 0 0 1.6-1a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H8a1.6 1.6 0 0 0 1-1.6V3a2 2 0 0 1 4 0a1.6 1.6 0 0 0 1 1.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.6 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" },
];

function Icon({ d, size = 19 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function App() {
  const [accounts, setAccounts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [tab, setTab] = useState("dashboard");
  const [activeAccount, setActiveAccount] = useState(null);
  const [editing, setEditing] = useState(null);
  const [historyFocus, setHistoryFocus] = useState(null);
  const [msg, setMsg] = useState("");
  const [deletedCount, setDeletedCount] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [autoDecided, setAutoDecided] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [version, setVersion] = useState("");
  const [theme, setTheme] = useState(() => localStorage.getItem("rk-theme") || "light");
  const { lang, setLang, t } = useLang();

  const refresh = useCallback(() => {
    api.listAccounts().then((a) => { setAccounts(a); setLoaded(true); }).catch(() => {});
    api.listJobs().then(setJobs).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => { if (!activeAccount && accounts.length) setActiveAccount(accounts[0].id); }, [accounts, activeAccount]);
  useEffect(() => {
    if (!activeAccount) return;
    api.deleted(activeAccount).then((d) => setDeletedCount(d.length)).catch(() => {});
  }, [activeAccount, jobs]);
  useEffect(() => {
    localStorage.setItem("rk-theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  useEffect(() => { api.authStatus().then((s) => setAuthEnabled(s.enabled)).catch(() => {}); }, []);
  useEffect(() => { api.health().then((h) => setVersion(h.version || "")).catch(() => {}); }, []);

  // First run: auto-open the setup wizard when no account is connected yet,
  // unless the user ticked "don't show again". Decided once per session.
  useEffect(() => {
    if (!loaded || autoDecided) return;
    setAutoDecided(true);
    if (accounts.length === 0 && localStorage.getItem("rk-wizard-dismissed") !== "1") {
      setWizardOpen(true);
    }
  }, [loaded, accounts, autoDecided]);

  async function logout() {
    try { await api.logout(); } catch { /* ignore */ }
    window.location.reload();
  }
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(""), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  const runningJob = jobs.find((j) => j.last_status === "running");
  const runningCount = jobs.filter((j) => j.last_status === "running").length;
  const acc = accounts.find((a) => a.id === activeAccount) || accounts[0];
  const title = t("title." + tab);
  const sub = t("sub." + tab);
  function cycleLang() {
    const i = LANGS.findIndex((l) => l.code === lang);
    setLang(LANGS[(i + 1) % LANGS.length].code);
  }

  function addJob(accountId) { setEditing(emptyJob(accountId)); setTab("jobs"); }
  function showHistory(job) { setHistoryFocus(job.id); setTab("history"); }

  return (
    <div className="app" data-theme={theme}>
      <button className="mobile-hamburger" onClick={() => setMenuOpen(true)} aria-label="menu">
        <svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <svg width="38" height="38" viewBox="0 0 40 40">
            <defs><linearGradient id="raMark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2997ff" /><stop offset="1" stopColor="#0055d4" /></linearGradient></defs>
            <rect x="1" y="1" width="38" height="38" rx="9.5" fill="url(#raMark)" />
            <path d="M20 8.5l8 3.2v6c0 5.6-3.9 9-8 11.6c-4.1-2.6-8-6-8-11.6v-6z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
            <path d="M15.8 19.4l2.9 2.9l5.5-5.8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <div className="brand-name">RepoArk</div>
            <div className="brand-sub">{t("brand.sub")}</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.key} className={`nav-item ${tab === n.key ? "active" : ""}`} onClick={() => { setTab(n.key); setMenuOpen(false); }}>
              <Icon d={n.d} />
              <span style={{ flex: 1, textAlign: "left" }}>{t("nav." + n.key)}</span>
              {n.key === "jobs" && runningCount > 0 && <span className="dot" />}
              {n.key === "kasa" && deletedCount > 0 && <span className="pill" style={{ padding: "1px 8px", fontSize: 11.5, background: "var(--amberT)", color: "var(--amber)" }}>{deletedCount}</span>}
            </button>
          ))}
        </nav>

        <div className="side-spacer" />

        {runningCount > 0 && (
          <div className="side-run">
            <span className="spinner" />
            <div style={{ fontSize: 12.5, lineHeight: 1.3 }}>
              <b style={{ color: "var(--accent)" }}>{t("side.backing")}</b>
              <div className="muted">{runningCount}</div>
            </div>
          </div>
        )}

        <button className="side-btn" onClick={() => setWizardOpen(true)}>
          <Icon d="M12 5v14M5 12h14" size={16} />
          <span style={{ flex: 1, textAlign: "left" }}>{t("side.wizard")}</span>
        </button>
        <button className="side-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          <Icon d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" size={16} />
          <span style={{ flex: 1, textAlign: "left" }}>{t("side.appearance")}</span>
          <span className="val">{theme === "dark" ? t("theme.dark") : t("theme.light")}</span>
        </button>
        <button className="side-btn" onClick={cycleLang}>
          <Icon d="M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 0 0 0-17M3.5 12h17M12 3.5c2.3 2.3 3.4 5.2 3.4 8.5s-1.1 6.2-3.4 8.5c-2.3-2.3-3.4-5.2-3.4-8.5s1.1-6.2 3.4-8.5" size={16} />
          <span style={{ flex: 1, textAlign: "left" }}>{t("side.language")}</span>
          <span className="val">{LANGS.find((l) => l.code === lang)?.name}</span>
        </button>
        {authEnabled && (
          <button className="side-btn" onClick={logout}>
            <Icon d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5l5-5M15 12H5" size={16} />
            <span style={{ flex: 1, textAlign: "left" }}>{t("side.logout")}</span>
          </button>
        )}

        {acc && (
          <button className="acct-card" onClick={() => setTab("accounts")}>
            <div className="acct-avatar">{acc.username?.[0]?.toUpperCase() || "?"}</div>
            <div style={{ minWidth: 0 }}>
              <div className="acct-name">{acc.is_org ? acc.username : "@" + acc.username}</div>
              <div className="acct-safe"><span className="g" />{t("side.protected")}</div>
            </div>
          </button>
        )}
        {version && <div className="side-version">v{version}</div>}
      </aside>

      <main className="main">
        <div className="page">
          <div className="page-head">
            <div>
              <h1>{title}</h1>
              <div className="sub">{sub}{acc ? ` · ${acc.is_org ? acc.username : "@" + acc.username}` : ""}</div>
            </div>
            <div className="row" style={{ gap: 10 }}>
              {accounts.length > 1 && ["dashboard", "content"].includes(tab) && (
                <select style={{ width: "auto" }} value={activeAccount || ""} onChange={(e) => setActiveAccount(Number(e.target.value))}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.is_org ? a.username : "@" + a.username}</option>)}
                </select>
              )}
              {runningJob && <RunPill jobId={runningJob.id} />}
            </div>
          </div>

          {tab === "dashboard" && <Dashboard accountId={activeAccount} accounts={accounts} jobs={jobs} onRefresh={refresh} onMsg={setMsg} onGoTab={setTab} />}
          {tab === "accounts" && <Accounts accounts={accounts} jobs={jobs} onRefresh={refresh} onAddJob={addJob} onMsg={setMsg} />}
          {tab === "jobs" && <Jobs jobs={jobs} accounts={accounts} editing={editing} setEditing={setEditing} onRefresh={refresh} onMsg={setMsg} onShowHistory={showHistory} />}
          {tab === "timeline" && <Timeline accountId={activeAccount} />}
          {tab === "kasa" && <Kasa accountId={activeAccount} onMsg={setMsg} />}
          {tab === "content" && <Content accountId={activeAccount} onMsg={setMsg} />}
          {tab === "history" && <History jobs={jobs} focusJobId={historyFocus} />}
          {tab === "settings" && <Settings accounts={accounts} onMsg={setMsg} theme={theme} setTheme={setTheme} />}
        </div>
      </main>

      {msg && <div className="toast">{msg}</div>}
      {wizardOpen && <Wizard onClose={() => setWizardOpen(false)} onDone={refresh} />}
    </div>
  );
}
