// Thin fetch wrapper around the backend API.
const JSON_HEADERS = { "Content-Type": "application/json" };

// Query suffix that routes browse calls to a "download all starred" clone
// (current/starred/<owner>/<repo>). Empty for the user's own repos.
const _sq = (owner, src, hasQuery = false) =>
  src === "starred" ? `${hasQuery ? "&" : "?"}owner=${encodeURIComponent(owner)}&src=starred` : "";

// When the panel is password-locked and the session lapses, the API answers
// 401. A registered handler (see App) can then show the login screen.
let authFailHandler = null;
export function onAuthFail(fn) { authFailHandler = fn; }

async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? JSON_HEADERS : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    if (authFailHandler) authFailHandler();
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data.detail || detail;
    } catch {
      /* non-JSON error */
    }
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  // panel auth
  authStatus: () => req("GET", "/api/auth/status"),
  login: (password) => req("POST", "/api/auth/login", { password }),
  logout: () => req("POST", "/api/auth/logout"),
  setPassword: (current, next) => req("POST", "/api/auth/set-password", { current, new: next }),

  // health + alerts + restore + changes + config
  health: (id) => req("GET", `/api/accounts/${id}/health`),
  checkHealth: (id) => req("POST", `/api/accounts/${id}/health/check`),
  alerts: () => req("GET", "/api/alerts"),
  changes: (id) => req("GET", `/api/accounts/${id}/changes`),
  importConfig: (data) => req("POST", "/api/config/import", data),
  // Download the setup as JSON; a passphrase encrypts the file at rest.
  exportConfig: (passphrase) => req("POST", "/api/config/export", { passphrase: passphrase || "" }),
  restoreRepo: (id, repo, newName, priv) =>
    req("POST", `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/restore`, { new_name: newName, private: priv }),

  // accounts
  listAccounts: () => req("GET", "/api/accounts"),
  connectAccount: (label, token, org) => req("POST", "/api/accounts", { label, token, org: org || null }),
  // Check a GitHub token before connecting it (login, scopes, expiry).
  testToken: (token, org) => req("POST", "/api/accounts/test-token", { token, org: org || null }),
  updateToken: (id, token) => req("PUT", `/api/accounts/${id}`, { token }),
  deleteAccount: (id) => req("DELETE", `/api/accounts/${id}`),
  // Restore-test a sample of the backed-up repos (real clone) to prove the
  // backup is actually usable, not just present.
  restoreDrill: (id) => req("POST", `/api/accounts/${id}/restore-drill`),
  // Reclaim space from 'download all starred' clones you no longer star.
  pruneUnstarred: (id) => req("POST", `/api/accounts/${id}/prune-unstarred`),
  // Secret scan: committed .env / API keys / passwords in the backed-up repos.
  secretScan: (id) => req("GET", `/api/accounts/${id}/secret-scan`),
  runSecretScan: (id, force) => req("POST", `/api/accounts/${id}/secret-scan`, { force: !!force }),
  // One repo's own findings (for the in-repo warning strip) + per-repo counts
  // (for the repo-list badges).
  secretScanRepo: (id, name, owner = "", src = "") =>
    req("GET", `/api/accounts/${id}/secret-scan/repo?name=${encodeURIComponent(name)}&owner=${encodeURIComponent(owner)}&src=${encodeURIComponent(src)}`),
  secretScanCounts: (id) => req("GET", `/api/accounts/${id}/secret-scan/counts`),
  // Read the actual flagged line from the backup, on explicit request (eye button).
  revealSecret: (id, f) => req("POST", `/api/accounts/${id}/secret-scan/reveal`,
    { file: f.file, line: f.line, browse: f.browse }),
  deleted: (id) => req("GET", `/api/accounts/${id}/deleted`),

  version: () => req("GET", "/api/health"),
  updateCheck: () => req("GET", "/api/update-check"),

  // jobs
  listJobs: () => req("GET", "/api/jobs"),
  createJob: (job) => req("POST", "/api/jobs", job),
  updateJob: (id, job) => req("PUT", `/api/jobs/${id}`, job),
  deleteJob: (id) => req("DELETE", `/api/jobs/${id}`),
  runJob: (id) => req("POST", `/api/jobs/${id}/run`),
  stopJob: (id) => req("POST", `/api/jobs/${id}/stop`),
  jobProgress: (id) => req("GET", `/api/jobs/${id}/progress`),

  // runs
  listRuns: (jobId) => req("GET", `/api/runs${jobId ? `?job_id=${jobId}` : ""}`),

  // backup content (per account)
  summary: (id) => req("GET", `/api/accounts/${id}/summary`),
  repos: (id) => req("GET", `/api/accounts/${id}/repos`),
  deleteRepos: (id, names, starred = []) => req("POST", `/api/accounts/${id}/repos/delete`, { names, starred }),
  dirStorage: (id) => req("GET", `/api/accounts/${id}/storage`),
  pruneDir: (id, name) => req("POST", `/api/accounts/${id}/storage/prune`, { name }),
  starred: (id) => req("GET", `/api/accounts/${id}/starred`),
  starredLive: (id) => req("GET", `/api/accounts/${id}/starred-live`),
  gists: (id) => req("GET", `/api/accounts/${id}/gists`),
  social: (id) => req("GET", `/api/accounts/${id}/social`),
  snapshots: (id) => req("GET", `/api/accounts/${id}/snapshots`),

  // browse into a repo (git-backed). owner/src route to a starred clone.
  overview: (id, repo, owner = "", src = "") =>
    req("GET", `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/overview${_sq(owner, src)}`),
  refs: (id, repo, owner = "", src = "") =>
    req("GET", `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/refs${_sq(owner, src)}`),
  tree: (id, repo, ref, path, owner = "", src = "") =>
    req("GET", `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/tree?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path || "")}${_sq(owner, src, true)}`),
  blob: (id, repo, ref, path, owner = "", src = "") =>
    req("GET", `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/blob?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}${_sq(owner, src, true)}`),
  commits: (id, repo, ref, owner = "", src = "") =>
    req("GET", `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/commits?ref=${encodeURIComponent(ref)}${_sq(owner, src, true)}`),
  snapshotDetail: (id, name) => req("GET", `/api/accounts/${id}/snapshots/${name}/detail`),
  snapshotFile: (id, name, path) =>
    req("GET", `/api/accounts/${id}/snapshots/${name}/file?path=${encodeURIComponent(path)}`),

  // issues / pulls (readable view)
  threads: (id, repo, kind) =>
    req("GET", `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/${kind}`),
  thread: (id, repo, kind, number) =>
    req("GET", `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/${kind}/${number}`),

  // search + insights + gist browsing
  search: (id, q, mode) =>
    req("GET", `/api/accounts/${id}/search?q=${encodeURIComponent(q)}&mode=${mode}`),
  insights: (id) => req("GET", `/api/accounts/${id}/insights`),
  gistTree: (id, gid, path) =>
    req("GET", `/api/accounts/${id}/gists/${gid}/tree?path=${encodeURIComponent(path || "")}`),
  gistBlob: (id, gid, path) =>
    req("GET", `/api/accounts/${id}/gists/${gid}/blob?path=${encodeURIComponent(path)}`),

  // settings + storage
  getSettings: () => req("GET", "/api/settings"),
  saveSettings: (s) => req("PUT", "/api/settings", s),
  testNotification: () => req("POST", "/api/settings/test"),
  storage: () => req("GET", "/api/storage"),
  prune: () => req("POST", "/api/storage/prune"),

  // remote destinations (S3)
  destinations: () => req("GET", "/api/destinations"),
  createDestination: (d) => req("POST", "/api/destinations", d),
  updateDestination: (id, d) => req("PUT", `/api/destinations/${id}`, d),
  deleteDestination: (id) => req("DELETE", `/api/destinations/${id}`),
  testDestination: (id) => req("POST", `/api/destinations/${id}/test`),
  // Test a destination's connection from the form values, before saving it.
  testConfig: (d, id) => req("POST", `/api/destinations/test-config${id ? `?id=${id}` : ""}`, d),
  syncDestination: (id, accountId) => req("POST", `/api/destinations/${id}/sync?account_id=${accountId}`),
};

// Direct download URLs (used as <a href>) — the browser handles the file save.
export const urls = {
  repoDownload: (id, repo, ref, owner = "", src = "") =>
    `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/download?ref=${encodeURIComponent(ref)}${_sq(owner, src, true)}`,
  raw: (id, repo, ref, path, owner = "", src = "", inline = false) =>
    `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/raw?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}${_sq(owner, src, true)}${inline ? "&inline=1" : ""}`,
  snapshotDownload: (id, name) => `/api/accounts/${id}/snapshots/${name}/download`,
  gistDownload: (id, gid) => `/api/accounts/${id}/gists/${gid}/download`,
  accountDownload: (id) => `/api/accounts/${id}/download`,
  repoBundle: (id, repo, owner = "", src = "") =>
    `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/bundle${_sq(owner, src)}`,
};
