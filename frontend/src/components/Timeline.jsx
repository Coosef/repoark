import { useEffect, useState } from "react";
import { api } from "../api.js";
import { bytes } from "../lib/format.js";
import { Empty } from "./ui.jsx";
import SnapshotDetail from "./SnapshotDetail.jsx";
import { useLang } from "../i18n.jsx";

// Parse a snapshot dir name "YYYYMMDD-HHMMSS" into a readable label.
function label(name) {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!m) return name;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return d.toLocaleString("tr-TR");
}

export default function Timeline({ accountId }) {
  const { t } = useLang();
  const [snaps, setSnaps] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    if (!accountId) return;
    api.snapshots(accountId).then(setSnaps).catch(() => setSnaps([]));
  }, [accountId]);

  if (!accountId) return <Empty>{t("dash.connectFirst")}</Empty>;
  if (open) return <SnapshotDetail accountId={accountId} name={open} onClose={() => setOpen(null)} />;
  if (!snaps) return <Empty>{t("common.loading")}</Empty>;
  if (snaps.length === 0) return <Empty>{t("timeline.empty")}</Empty>;

  return (
    <div className="timeline">
      {snaps.map((s, i) => (
        <div className="tl-item" key={s.name}>
          <div className="tl-marker">
            <div className="tl-dot" />
            {i < snaps.length - 1 && <div className="tl-line" />}
          </div>
          <div className="group tl-card">
            <div className="row-item tap" onClick={() => setOpen(s.name)}>
              <div className="isq lg isq-purple">🗂️</div>
              <div className="row-body">
                <div className="row-title">{label(s.name)}</div>
                <div className="row-desc">{t("timeline.files", { n: s.files, size: bytes(s.size_bytes) })}{i === 0 ? " · " + t("timeline.newest") : ""}</div>
              </div>
              <div className="row-right"><span style={{ color: "var(--link)" }}>{t("timeline.browse")}</span><span className="chev">›</span></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
