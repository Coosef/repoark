// Thin fetch wrapper around the backend API.
const JSON_HEADERS = { "Content-Type": "application/json" };

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
  restoreRepo: (id, repo, newName, priv) =>
    req("POST", `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/restore`, { new_name: newName, private: priv }),

  // accounts
  listAccounts: () => req("GET", "/api/accounts"),
  connectAccount: (label, token, org) => req("POST", "/api/accounts", { label, token, org: org || null }),
  updateToken: (id, token) => req("PUT", `/api/accounts/${id}`, { token }),
  deleteAccount: (id) => req("DELETE", `/api/accounts/${id}`),
  deleted: (id) => req("GET", `/api/accounts/${id}/deleted`),

  health: () => req("GET", "/api/health"),

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
  deleteRepos: (id, names) => req("POST", `/api/accounts/${id}/repos/delete`, { names }),
  storage: (id) => req("GET", `/api/accounts/${id}/storage`),
  pruneStorage: (id, name) => req("POST", `/api/accounts/${id}/storage/prune`, { name }),
  starred: (id) => req("GET", `/api/accounts/${id}/starred`),
  starredLive: (id) => req("GET", `/api/accounts/${id}/starred-live`),
  gists: (id) => req("GET", `/api/accounts/${id}/gists`),
  social: (id) => req("GET", `/api/accounts/${id}/social`),
  snapshots: (id) => req("GET", `/api/accounts/${id}/snapshots`),

  // browse into a repo (git-backed)
  overview: (id, repo) => req("GET", `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/overview`),
  refs: (id, repo) => req("GET", `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/refs`),
  tree: (id, repo, ref, path) =>
    req("GET", `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/tree?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path || "")}`),
  blob: (id, repo, ref, path) =>
    req("GET", `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/blob?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`),
  commits: (id, repo, ref) =>
    req("GET", `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/commits?ref=${encodeURIComponent(ref)}`),
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
  syncDestination: (id, accountId) => req("POST", `/api/destinations/${id}/sync?account_id=${accountId}`),
};

// Direct download URLs (used as <a href>) — the browser handles the file save.
export const urls = {
  repoDownload: (id, repo, ref) =>
    `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/download?ref=${encodeURIComponent(ref)}`,
  raw: (id, repo, ref, path) =>
    `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/raw?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`,
  snapshotDownload: (id, name) => `/api/accounts/${id}/snapshots/${name}/download`,
  gistDownload: (id, gid) => `/api/accounts/${id}/gists/${gid}/download`,
  accountDownload: (id) => `/api/accounts/${id}/download`,
  repoBundle: (id, repo) => `/api/accounts/${id}/repos/${encodeURIComponent(repo)}/bundle`,
  configExport: () => `/api/config/export`,
};
