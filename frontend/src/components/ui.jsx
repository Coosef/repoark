import { useLang } from "../i18n.jsx";

export function Badge({ status }) {
  const { t } = useLang();
  return <span className={`badge badge-${status}`}>{t("status." + status)}</span>;
}

export function StatCard({ icon, value, label, hint, accent }) {
  return (
    <div className="stat">
      <div className="stat-icon" style={accent ? { background: accent + "22", color: accent } : undefined}>{icon}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function ProgressBar({ percent, label }) {
  const p = Math.max(0, Math.min(100, percent || 0));
  return (
    <div className="pbar-wrap">
      <div className="pbar">
        <div className="pbar-fill" style={{ width: `${p}%` }} />
      </div>
      {label && <span className="pbar-label">{label}</span>}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Switch({ on, onChange }) {
  return (
    <button type="button" className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)}>
      <span className="knob" />
    </button>
  );
}

// A colored icon square (iOS settings style). color = blue|green|amber|purple|pink|teal|gray
export function ISquare({ color = "blue", lg, children }) {
  return <div className={`isq ${lg ? "lg" : ""} isq-${color}`}>{children}</div>;
}

// --- Minimal dependency-free SVG charts ---

// Line + area chart for a single series of {label, value}, with y-axis labels
// and a value label on each point. Uniform scaling keeps the text readable.
export function LineChart({ points, color = "#2f81f7", format = (v) => v }) {
  const { t } = useLang();
  if (!points || points.length === 0) return <Empty>{t("common.noData")}</Empty>;
  const w = 480;
  const h = 150;
  const padL = 56;   // room for y-axis labels
  const padT = 18;   // room for value labels above points
  const padB = 22;   // room for x-axis (dates)
  const padR = 12;
  const max = Math.max(...points.map((p) => p.value), 1);
  const n = points.length;
  const x = (i) => padL + (n === 1 ? (w - padL - padR) / 2 : (i * (w - padL - padR)) / (n - 1));
  const y = (v) => padT + (1 - v / max) * (h - padT - padB);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
  const area = `${line} L${x(n - 1)},${h - padB} L${x(0)},${h - padB} Z`;
  const mid = max / 2;

  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} style={{ height: "auto" }}>
      {/* y gridlines + labels */}
      {[{ v: max, yy: y(max) }, { v: mid, yy: y(mid) }, { v: 0, yy: y(0) }].map((g, i) => (
        <g key={i}>
          <line x1={padL} y1={g.yy} x2={w - padR} y2={g.yy} stroke="#21262d" strokeWidth="1" />
          <text x={padL - 6} y={g.yy + 3} textAnchor="end" className="axis-label">{format(g.v)}</text>
        </g>
      ))}
      <path d={area} fill={color} opacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r="3" fill={color} />
          {(i === n - 1 || n <= 6) && (
            <text x={x(i)} y={y(p.value) - 7} textAnchor="middle" className="pt-label">{format(p.value)}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

// Donut chart for status distribution: segments [{label, value, color}].
export function Donut({ segments, size = 120 }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <Empty>Veri yok</Empty>;
  const r = size / 2 - 10;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="#21262d" strokeWidth="12" />
        {segments.map((seg, i) => {
          const len = (seg.value / total) * circ;
          const el = (
            <circle
              key={i}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth="12"
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${c} ${c})`}
            >
              <title>{`${seg.label}: ${seg.value}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
        <text x={c} y={c - 2} textAnchor="middle" className="donut-total">{total}</text>
        <text x={c} y={c + 16} textAnchor="middle" className="donut-sub">çalışma</text>
      </svg>
      <div className="legend">
        {segments.map((s, i) => (
          <div key={i} className="legend-row">
            <span className="dot" style={{ background: s.color }} />
            {s.label} <b>{s.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
