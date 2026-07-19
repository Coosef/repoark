import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import { datetime, bytes } from "../lib/format.js";
import { Empty } from "./ui.jsx";
import { useLang } from "../i18n.jsx";

function duration(a, b) {
  if (!a || !b) return "—";
  const s = Math.round((new Date(b) - new Date(a)) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}dk ${s % 60}s`;
}

export default function History({ jobs, focusJobId }) {
  const { t } = useLang();
  const [runs, setRuns] = useState([]);
  const [jobFilter, setJobFilter] = useState(focusJobId || "");
  const [openLog, setOpenLog] = useState(null);

  const load = useCallback(() => {
    api.listRuns(jobFilter || undefined).then(setRuns).catch(() => {});
  }, [jobFilter]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  const jobName = (id) => jobs.find((j) => j.id === id)?.name || `#${id}`;

  return (
    <div>
      <div className="row spread mb">
        <h3>{t("history.title")}</h3>
        <select style={{ width: "auto" }} value={jobFilter} onChange={(e) => setJobFilter(e.target.value ? Number(e.target.value) : "")}>
          <option value="">{t("common.all")}</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
      </div>

      {runs.length === 0 && <Empty>{t("history.noRuns")}</Empty>}

      {runs.length > 0 && (
        <div className="group">
          {runs.map((r) => {
            let note = "";
            try { note = JSON.parse(r.summary || "{}").note || ""; } catch {}
            const errNote = r.status === "error" ? t("history.errNote") : note;
            return (
              <div key={r.id}>
                <div className="row-item tap" onClick={() => setOpenLog(openLog === r.id ? null : r.id)}>
                  <span className={`sdot sdot-${r.status}`} />
                  <div className="row-body">
                    <div className="row-title">{jobName(r.job_id)}
                      {errNote && <span className="muted" style={{ fontWeight: 400 }}> · {errNote}</span>}</div>
                    <div className="row-desc">{datetime(r.started_at)} · {r.trigger === "schedule" ? t("history.auto") : t("history.manual")}</div>
                  </div>
                  <div className="row-right">
                    <span>{duration(r.started_at, r.finished_at)}</span>
                    <span style={{ minWidth: 60, textAlign: "right" }}>{r.size_bytes ? bytes(r.size_bytes) : "—"}</span>
                    <span className="chev">›</span>
                  </div>
                </div>
                {openLog === r.id && <pre className="log" style={{ margin: "0 16px 12px" }}>{r.log || t("history.noLog")}</pre>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
