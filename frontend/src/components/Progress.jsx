import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ProgressBar } from "./ui.jsx";
import { useLang } from "../i18n.jsx";

// Compact header pill shown while any backup is running.
export function RunPill({ jobId }) {
  const { t } = useLang();
  const [pct, setPct] = useState(null);
  useEffect(() => {
    let active = true;
    const tick = () => api.jobProgress(jobId).then((d) => active && setPct(d.running ? d.percent : null)).catch(() => {});
    tick();
    const iv = setInterval(tick, 1500);
    return () => { active = false; clearInterval(iv); };
  }, [jobId]);
  return (
    <span className="run-pill">
      <span className="spinner" />{t("side.backing")}{pct != null ? ` %${pct}` : ""}
    </span>
  );
}

// Backend emits Turkish phase/message labels; map the known ones to i18n keys.
const PHASE_KEYS = {
  "Repolar": "phase.repos",
  "Yıldızlar": "phase.stars",
  "Gist'ler": "phase.gists",
  "Değişiklik kontrolü": "phase.checking",
  "Profil & sosyal": "phase.social",
  "Snapshot": "phase.snapshot",
};
const MSG_KEYS = { "başlıyor…": "phase.starting" };

// Polls a job's live progress while it is running.
export default function LiveProgress({ jobId, running }) {
  const { t } = useLang();
  const [p, setP] = useState(null);

  useEffect(() => {
    if (!running) {
      setP(null);
      return;
    }
    let active = true;
    const tick = () =>
      api.jobProgress(jobId).then((d) => active && setP(d)).catch(() => {});
    tick();
    const t = setInterval(tick, 1500);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [jobId, running]);

  if (!running || !p || !p.running) return null;

  const phaseLabel = PHASE_KEYS[p.phase] ? t(PHASE_KEYS[p.phase]) : p.phase;
  const msgLabel = p.message && (MSG_KEYS[p.message] ? t(MSG_KEYS[p.message]) : p.message);
  const label =
    p.total > 0 ? `${p.done}/${p.total} repo` : phaseLabel;
  return (
    <div className="live">
      <div className="live-head">
        <span className="spinner" /> {phaseLabel}
        {msgLabel ? <span className="live-msg"> · {msgLabel}</span> : null}
        <span className="live-elapsed">{p.elapsed}s</span>
      </div>
      <ProgressBar percent={p.percent} label={label} />
    </div>
  );
}
