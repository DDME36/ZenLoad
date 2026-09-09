# Production Deployment and Operations Implementation Plan

> **For agentic workers:** Execute only after backend and frontend plans pass locally. Prepare and validate every artifact before asking for the final production restart. Never modify `zentyr.service`.

**Goal:** Make Vercel and the Oracle Ubuntu Free Tier deployment repeatable, observable, and safe to recover without adding paid infrastructure.

**Architecture:** Keep Vercel as the public HTTPS frontend and reverse proxy, and keep one Bun systemd service on Oracle. Store SQLite and cookies outside release replacement paths, use systemd limits and sandboxing compatible with yt-dlp/ffmpeg, and provide scripts for preflight and smoke verification.

**Tech Stack:** Vercel, Ubuntu systemd, Bun, Bash, curl, SQLite, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-09-09-production-hardening-design.md`

## Global Constraints

- Target host is `ubuntu@161.118.239.92`; SSH credentials remain local and must never enter Git or logs.
- Production backend directory is `/home/ubuntu/zenload-backend/`.
- Restart only `zenload-backend.service`; never read, stop, restart, enable, edit, or replace `zentyr.service`.
- Never overwrite production cookies, SQLite data, `.env`, downloads, or logs during a release.
- Do not add a proxy subscription, Redis, object storage, or paid monitoring.
- Prepare a reviewable release before any restart. Deployment/restart is the final production mutation.

---

### Task 1: Define and validate production configuration

**Files:**
- Modify: `backend/.env.example`
- Modify: `frontend/.env.example`
- Create: `ops/env/production.env.example`
- Create: `backend/src/config.ts`
- Create: `backend/tests/config.test.ts`

- [ ] Add failing tests for invalid integers, wildcard production CORS, missing data/temp directories, invalid public URLs, and proxy URLs that contain unsupported schemes.
- [ ] Centralize parsing so bad production configuration fails at startup with variable names but never values:

```ts
export const config = {
  port: intEnv('PORT', 3001, { min: 1, max: 65535 }),
  frontendUrl: urlEnv('FRONTEND_URL', 'http://localhost:5173'),
  backendPublicUrl: urlEnv('BACKEND_PUBLIC_URL', ''),
  maxConcurrentAnalyzes: intEnv('MAX_CONCURRENT_ANALYZES', 2, { min: 1, max: 4 }),
  maxConcurrentDownloads: intEnv('MAX_CONCURRENT_DOWNLOADS', 2, { min: 1, max: 4 }),
  maxFileSizeMb: intEnv('MAX_FILE_SIZE_MB', 2048, { min: 1, max: 4096 }),
}
```

- [ ] Set the documented production frontend to `https://zenload-z.vercel.app`; document `TRUST_PROXY_HEADERS`, timeouts, file limits, log level, `DATA_DIR`, and `TEMP_DIR`.
- [ ] Remove obsolete queue variables from examples and docs.
- [ ] Run `cd backend && bun test tests/config.test.ts && bun run typecheck`.
- [ ] Commit with `git add backend/.env.example frontend/.env.example ops/env/production.env.example backend/src/config.ts backend/tests/config.test.ts && git commit -m "chore(config): validate production settings"`.

### Task 2: Add Vercel security and cache policy

**Files:**
- Modify: `frontend/vercel.json`
- Create: `scripts/check-vercel-config.mjs`
- Modify: `package.json`

- [ ] Add a failing configuration check for missing security headers, accidental API caching, a changed production origin, and invalid JSON.
- [ ] Add global headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `X-Frame-Options: DENY`, and a CSP compatible with self-hosted fonts/assets and the current inline JSON-LD.
- [ ] Add `Cache-Control: no-store` specifically for `/api/(.*)` and `/health`; retain one-year immutable caching only for hashed assets.
- [ ] Keep the Vercel rewrite so browsers see same-origin HTTPS. Document the Oracle firewall requirement: public ingress on port 3001 should be restricted where practical because Vercel egress IPs are not fixed on standard plans.
- [ ] Run `node scripts/check-vercel-config.mjs` and `cd frontend && npm run build`.
- [ ] Commit with `git add frontend/vercel.json scripts/check-vercel-config.mjs package.json && git commit -m "fix(vercel): add production security headers"`.

### Task 3: Add a safe systemd service template

**Files:**
- Create: `ops/systemd/zenload-backend.service.example`
- Create: `ops/systemd/README.md`

- [ ] Create a template with `User=ubuntu`, explicit working directory, environment file, restart backoff, stop timeout, file descriptor limit, memory ceiling, and child-process cleanup:

```ini
[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/zenload-backend
EnvironmentFile=/home/ubuntu/zenload-backend/.env
ExecStart=/home/ubuntu/.bun/bin/bun run src/index.ts
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillMode=control-group
LimitNOFILE=4096
MemoryHigh=750M
MemoryMax=900M
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/home/ubuntu/zenload-backend/data /home/ubuntu/zenload-backend/logs /home/ubuntu/zenload-tmp
```

- [ ] Document ownership and directory creation before enabling hardening. Confirm yt-dlp, gallery-dl, ffmpeg, deno, cookies, SQLite WAL, and temp paths remain readable/writable.
- [ ] Include `systemd-analyze verify ops/systemd/zenload-backend.service.example` in the operator steps. Do not install the template automatically.
- [ ] Commit with `git add ops/systemd && git commit -m "ops: document hardened backend service"`.

### Task 4: Add non-destructive release and smoke scripts

**Files:**
- Create: `scripts/release-backend.sh`
- Create: `scripts/smoke-production.sh`
- Create: `scripts/preflight-production.sh`
- Modify: `README.md`

- [ ] Make `preflight-production.sh` check Bun, yt-dlp, gallery-dl, ffmpeg, deno, directory permissions, free disk, expected service name, and required environment variables without printing secrets.
- [ ] Make `release-backend.sh` stage into a timestamped directory, install locked dependencies, typecheck/test, then switch the application files while excluding `.env`, `cookies.txt`, `data/`, `logs/`, and temp files. Keep one previous release for rollback.
- [ ] Require the service name argument to equal `zenload-backend.service`; exit for every other value. Use `systemctl cat` and `systemctl show` only for that exact unit.
- [ ] Make `smoke-production.sh` check `/health`, rejected invalid URL, no public `/api/logs`, security headers, a real YouTube analyze call, and an analyze-to-download-start-to-cancel flow. Treat Facebook/Instagram cloud-IP blocks as separately reported upstream limitations.
- [ ] Run `bash -n scripts/preflight-production.sh scripts/release-backend.sh scripts/smoke-production.sh` and ShellCheck if available.
- [ ] Commit with `git add scripts README.md && git commit -m "ops: add safe release and smoke checks"`.

### Task 5: Add CI gates without deployment credentials

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `.gitignore`

- [ ] Add jobs for backend install/typecheck/tests, frontend clean install/tests/build, Vercel config validation, and secret-pattern scanning for private keys/cookies/tokens.
- [ ] Cache dependency downloads only; never cache cookies, `.env`, SQLite, output files, or production logs.
- [ ] Pin action major versions and use least-privilege `contents: read` permissions.
- [ ] Ensure `.gitignore` covers `.env*` except examples, `cookies*.txt`, `*.sqlite*`, `*.db*`, temp download directories, private keys, and local deployment artifacts.
- [ ] Validate workflow syntax locally and run every CI command once.
- [ ] Commit with `git add .github .gitignore && git commit -m "ci: add production release gates"`.

### Task 6: Prepare and review the production release

**Files:**
- Create: `docs/operations/release-checklist.md`
- Create: `docs/operations/incident-recovery.md`

- [ ] Document backup commands for `.env`, cookies, and SQLite using read-only copies with restrictive permissions.
- [ ] Document rollback: stop only `zenload-backend.service`, restore the previous application release, retain the current database unless its migration failed, then start and run smoke checks.
- [ ] Document diagnosis for disk full, memory pressure, stale jobs after restart, upstream 429/auth walls, missing yt-dlp/gallery-dl, and Vercel-to-Oracle connectivity.
- [ ] Build the frontend, run all frontend/backend tests, run secret scanning, and inspect `git diff --check`.
- [ ] Confirm the live target and local release commit, then present the exact files and smoke steps for review before the final production restart.

### Task 7: Deploy only after the release is reviewable

**Files:**
- No source changes expected.

- [ ] Use the local SSH key under `C:\Users\MIGHTYBIT\Desktop\ORC` without copying it or its contents into the workspace.
- [ ] Run the remote preflight and back up `.env`, cookies, and SQLite metadata.
- [ ] Upload the reviewed release, install locked dependencies, and run remote typecheck/tests before switching releases.
- [ ] Restart only `zenload-backend.service`, verify it is active, and inspect its recent journal with secrets redacted.
- [ ] Run the production smoke script against the Oracle backend and `https://zenload-z.vercel.app/`.
- [ ] Push the reviewed commits to `https://github.com/DDME36/ZenLoad.git`; verify the Vercel deployment and social preview.
- [ ] Record final commit SHA, deployment time, test totals, health response, and known Facebook/Instagram upstream limitations.
