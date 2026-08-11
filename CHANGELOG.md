# Changelog

All notable changes to RepoArk are documented here. Versions match the
`VERSION` file and the published image tag `ghcr.io/coosef/repoark:<version>`.

## [1.10.0]
### Changed
- **Safer remote sync.** A local fault can no longer wipe the offsite copy:
  RepoArk refuses to sync an empty local tree onto the remote, and uses
  rclone `--backup-dir` so anything a sync would delete or overwrite on the
  remote is moved to a sibling `__archive__` folder (previous state always
  recoverable) instead of being deleted — closing the gap where a corrupted or
  empty local backup would mirror-delete the good remote copy.

## [1.9.0]
### Added
- **Stale-backup alert** on the dashboard: a scheduled job that hasn't succeeded
  in far longer than its cadence is flagged, so a job that quietly stopped
  (expired token, full disk, misconfig) doesn't go unnoticed.
- **Post-sync verify**: after a remote sync, RepoArk runs `rclone check`
  (size-only, no data transfer) to confirm the remote copy actually matches
  local, surfacing a silent partial sync in the sync log.

## [1.8.0]
### Added
- A **Verify backup** button per account (a real "restore drill"): it actually
  clones a random sample of the backed-up mirrors into a throwaway working tree
  and confirms they check out — proving the backup is genuinely restorable, not
  just that its git objects are reachable. Reports how many repos passed.

## [1.7.0]
### Added
- A **Test token** button on the connect-account form: check a GitHub token
  before saving it and see the resolved login, its scopes, expiry, and remaining
  API rate — so a bad or expired token is caught up front instead of by a failed
  backup.

## [1.6.4]
### Security
- Harden the destination connection test (1.6.3): a saved destination's secret
  is now only ever tested against its own saved endpoint. A request could no
  longer reuse a stored secret while supplying a different (attacker-chosen)
  endpoint, which could have exfiltrated the secret. Added a regression test.

## [1.6.3]
### Added
- A **Test** button in the remote-destination form: check that a destination
  actually connects right there while adding/editing it, without saving or
  running a whole backup. Shows a clear success/failure result inline.

## [1.6.2]
### Changed
- Account management (connect a GitHub account, update its token, remove it) now
  lives in **Settings** where users expect it, instead of only opening from the
  sidebar account card. The account card and the token-expiry alert now open
  Settings too.

## [1.6.1]
### Fixed
- The friendly schedule builder now understands weekday ranges (e.g. `1-5` =
  Mon–Fri) instead of silently dropping to the raw-cron box.
- The dashboard's 4-second refresh no longer re-renders the page (or re-fetches
  the deleted-count) when nothing actually changed.

## [1.6.0]
### Changed
- Destructive actions (delete a repo backup, account, job, or destination) and
  the "update token" prompt now use a styled in-app dialog instead of the raw
  browser confirm()/prompt() — clearer copy, a red confirm button, keyboard
  focus trap + Escape, and a masked field for the token.
### Fixed
- A couple of hard-coded Turkish strings (empty states, the chart labels) now
  respect the selected language, and Arabic renders right-to-left.
- Wide tables and README content scroll on small screens instead of overflowing;
  keyboard focus is now visible on buttons and inputs.

## [1.5.0]
### Added
- First automated test suite (`backend/tests`) and a CI gate: the image is no
  longer published unless the tests pass.
- Docker `HEALTHCHECK` so CasaOS/Docker can restart a wedged process.
- `tini` as PID 1 for correct signal handling and child-process reaping on
  stop/update.
- This changelog.
### Changed
- Reproducible frontend builds (`npm ci` against the committed lockfile) and a
  patched Vite toolchain (0 known advisories).
- Directory sizes on the dashboard are cached briefly instead of re-walking the
  whole backup tree on every refresh (much faster with a large starred tree).

## [1.4.0]
### Fixed
- A backup no longer reports **success** when work was incomplete: if a selected
  starred repo fails to clone, the run is marked **partial** and the change
  fingerprint is not advanced, so the missing repos are retried next run instead
  of being silently skipped.
- **Stop** and the timeout watchdog now kill the whole process group, so the git
  children the engine spawns are terminated instead of orphaned.
- A scheduled run and a manual **Run now** can no longer run two engines against
  the same mirrors at once (which could corrupt them).
### Added
- A **partial** run status (amber) in all 15 languages.
- Disk-space guard before a backup (`REPOARK_MIN_FREE_MB`, default 500).
- Run-history retention (`REPOARK_RUN_HISTORY`, default 200).
- SQLite WAL + busy_timeout to end "database is locked" under concurrency.

## [1.3.0]
### Security
- README rendering is sanitized (DOMPurify) — a hostile starred-repo README can
  no longer run script in the panel.
- Security headers on every response (CSP, X-Frame-Options, nosniff).
- `config/export` (which contains every token/password) is refused unless a
  panel password is set, and an imported file can't overwrite an existing one.
- Login brute-force lockout, `Secure` cookie over HTTPS, 7-day sessions,
  8-character minimum password, and a startup warning when the panel is open.
- Inline file serving only returns real image types; anything else is served as
  inert text.

## [1.2.0]
### Added
- README links and images work in-panel against the backup (own + starred repos).
