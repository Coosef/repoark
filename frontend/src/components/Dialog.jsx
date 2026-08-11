import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLang } from "../i18n.jsx";

// A single in-app modal that replaces the native, unstyled confirm()/prompt()
// dialogs. confirm()/promptSecret() each return a Promise so call sites read
// almost the same as before:  if (!(await confirm({message}))) return;
const DialogCtx = createContext(null);
export const useDialog = () => useContext(DialogCtx);

export function DialogProvider({ children }) {
  const { t } = useLang();
  const [dlg, setDlg] = useState(null);      // null when closed
  const [val, setVal] = useState("");        // prompt input text
  const resolver = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const lastFocus = useRef(null);

  const close = useCallback((result) => {
    setDlg(null);
    const r = resolver.current;
    resolver.current = null;
    if (r) r(result);
    const el = lastFocus.current;
    lastFocus.current = null;
    if (el) { try { el.focus(); } catch { /* opener gone */ } }
  }, []);

  const open = useCallback((cfg) => new Promise((res) => {
    lastFocus.current = document.activeElement;
    resolver.current = res;
    setVal("");
    setDlg(cfg);
  }), []);

  const confirm = useCallback(
    (opts) => open({ kind: "confirm", danger: true, ...opts }), [open]);
  const promptSecret = useCallback(
    (opts) => open({ kind: "prompt", secret: true, ...opts }), [open]);

  const cancelValue = () => (dlg?.kind === "prompt" ? null : false);

  // Focus the primary control on open, trap Tab inside, close on Escape.
  useEffect(() => {
    if (!dlg) return;
    const focusEl = dlg.kind === "prompt"
      ? inputRef.current
      : panelRef.current?.querySelector(".dlg-confirm");
    focusEl?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(cancelValue()); return; }
      if (e.key !== "Tab") return;
      const f = panelRef.current?.querySelectorAll(
        "button:not([disabled]), input, [href], [tabindex]:not([tabindex='-1'])");
      if (!f || !f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dlg, close]);

  return (
    <DialogCtx.Provider value={{ confirm, promptSecret }}>
      {children}
      {dlg && (
        <div
          className="dlg-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(cancelValue()); }}
        >
          <div className="dlg" role="dialog" aria-modal="true"
               aria-label={dlg.title || dlg.message || ""} ref={panelRef}>
            {dlg.title && <h3 className="dlg-title">{dlg.title}</h3>}
            {dlg.message && <p className="dlg-msg">{dlg.message}</p>}
            {dlg.kind === "prompt" && (
              <input
                ref={inputRef}
                className="dlg-input"
                type={dlg.secret ? "password" : "text"}
                autoComplete={dlg.secret ? "new-password" : "off"}
                placeholder={dlg.placeholder || ""}
                value={val}
                onChange={(e) => setVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && val.trim()) close(val.trim()); }}
              />
            )}
            <div className="dlg-actions">
              <button type="button" className="dlg-cancel" onClick={() => close(cancelValue())}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className={`dlg-confirm ${dlg.danger ? "danger" : ""}`}
                disabled={dlg.kind === "prompt" && !val.trim()}
                onClick={() => close(dlg.kind === "prompt" ? val.trim() : true)}
              >
                {dlg.confirmLabel || (dlg.danger ? t("common.delete") : t("common.save"))}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogCtx.Provider>
  );
}
