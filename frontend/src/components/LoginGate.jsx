import { useEffect, useState } from "react";
import { api, onAuthFail } from "../api.js";
import { useLang } from "../i18n.jsx";

// Wraps the whole app. If the panel is password-protected and the session is
// missing/expired, it shows a login screen instead of the app. When the panel
// has no password set, it renders the app straight through.
export default function LoginGate({ children }) {
  const { t } = useLang();
  const [state, setState] = useState("checking"); // checking | open | locked
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const check = () =>
    api.authStatus()
      .then((s) => setState(s.enabled && !s.authed ? "locked" : "open"))
      .catch(() => setState("open")); // never hard-lock on a status hiccup

  useEffect(() => {
    // Apply the saved theme so the login screen matches the app.
    document.documentElement.setAttribute("data-theme", localStorage.getItem("rk-theme") || "light");
    check();
    onAuthFail(() => setState("locked"));
  }, []);

  if (state === "checking") return null;
  if (state === "open") return children;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.login(pw);
      setPw("");
      await check();
    } catch {
      setErr(t("login.wrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <svg width="52" height="52" viewBox="0 0 40 40" style={{ marginBottom: 6 }}>
          <defs><linearGradient id="lgMark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2997ff" /><stop offset="1" stopColor="#0055d4" /></linearGradient></defs>
          <rect x="1" y="1" width="38" height="38" rx="9.5" fill="url(#lgMark)" />
          <path d="M20 8.5l8 3.2v6c0 5.6-3.9 9-8 11.6c-4.1-2.6-8-6-8-11.6v-6z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
          <path d="M15.8 19.4l2.9 2.9l5.5-5.8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h1 style={{ margin: "0 0 2px" }}>RepoArk</h1>
        <p className="muted" style={{ margin: "0 0 18px" }}>{t("login.prompt")}</p>
        <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t("login.password")} />
        {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
        <button style={{ marginTop: 14, width: "100%" }} disabled={busy || !pw}>
          {busy ? t("login.checking") : t("login.enter")}
        </button>
      </form>
    </div>
  );
}
