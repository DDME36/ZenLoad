# Zenload Production Hardening Design

**Date:** 2026-09-09

**Status:** Proposed
**Deployment:** Vercel frontend, Oracle Ubuntu Free Tier backend, public-by-link access

## Objective

Make Zenload dependable and safe for personal use and a small trusted group without adding accounts, advertising, paid infrastructure, or a visible waiting queue. Preserve the current black-purple identity and simple paste-download flow.

Success means a user can paste a supported URL, understand the current state, start a download immediately when capacity is available, recover from errors without reloading, and use the site comfortably on mobile. The Oracle instance must remain responsive when several requests arrive together or a downloader process fails.

## Constraints

- Keep the current architecture: Vercel/Vite frontend, Bun/Elysia backend, yt-dlp, gallery-dl, ffmpeg, and SQLite jobs.
- Optimize for Oracle Ubuntu Free Tier and a small user group.
- Anyone with the URL may use the site; no account or password gate.
- Do not add Redis, object storage, paid monitoring, or paid proxy services.
- Do not keep users in a download queue. Admit work immediately when a slot is free; reject quickly and clearly when capacity is full.
- Keep existing platform support and avoid unrelated visual redesigns.

## Architecture

The request flow remains:

```text
Browser on Vercel
  -> URL analysis API on Oracle
  -> platform detector and extractor
  -> immediate capacity admission
  -> background download job
  -> bounded temporary file
  -> token-protected download response
  -> automatic cleanup
```

The backend remains a single service. Internal boundaries will be tightened so routing, admission control, extraction, file lifecycle, and HTTP responses have clear responsibilities. Large service files may be split only where this directly improves safety or testability.

## Immediate Admission and Capacity

Analysis and download semaphores will operate without waiting queues. When capacity is available, the request starts immediately. When all slots are in use, the API returns HTTP 429 with a stable machine code and a short retry suggestion.

Default limits will remain conservative and configurable through environment variables:

- Two concurrent analyses.
- Two concurrent downloads.
- Zero queued analyses and downloads.
- A short `Retry-After` header on capacity and rate-limit responses.

The admission check and slot acquisition must be atomic so simultaneous requests cannot oversubscribe the instance. Every success, failure, timeout, and cancellation path must release its slot exactly once.

## Security Hardening

The existing SSRF protections remain the base. The hardening pass will verify and improve:

- URL parsing, supported protocols, redirect validation, DNS rebinding checks, and private or metadata address blocking.
- Credential stripping on cross-origin redirects and redaction of cookies, tokens, signed CDN queries, and full user URLs in logs.
- Strict validation of download options so a client cannot invoke an option unsupported by the analyzed item or platform.
- Image proxy domain policy, content-type checks, response-size limits, timeouts, and safe redirect behavior.
- Job ownership tokens using constant-time comparison where practical, unpredictable identifiers, and non-cacheable private job responses.
- Download response headers including content-type protection, safe filenames, range validation, and cache policy.
- CORS restricted to the production Vercel origin plus explicitly configured local development origins.
- Request body limits and consistent rate-limit headers.
- Cookie files kept outside the repository with restrictive permissions and no secret-bearing diagnostics.
- Error responses that do not expose filesystem paths, subprocess arguments, stack traces, cookies, or upstream signed URLs.

Public content extraction remains best-effort. Facebook and Instagram can restrict cloud IPs; the product must explain these upstream limits accurately rather than presenting them as internal failures.

## Reliability and Resource Control

Each external operation will have an abort signal and bounded duration. Subprocesses must be attached to their job, terminated as a process tree, and detached in a `finally` path. Partial output must be deleted after failure or cancellation.

Before work starts, the backend will validate available disk space. Streamed and file-based downloads will enforce the configured maximum size even when the upstream server omits or lies about `Content-Length`.

SQLite will remain the job store. Startup recovery will mark interrupted work as failed and clean partial files. Periodic cleanup will remove expired jobs and orphan directories without touching cookie or persistent configuration directories.

Health endpoints will be divided by purpose:

- `/health` provides only a minimal liveness response suitable for Vercel and service checks.
- Detailed operational status stays limited to non-sensitive booleans and counts; it will not reveal paths, process IDs, environment values, or credentials.

Structured logs will include a request or job identifier, platform, operation, duration, outcome, and safe error code. They will not log full signed media URLs or secrets.

## API and Error Model

The frontend will receive a consistent error shape with `code`, Thai `message`, optional `suggestion`, and optional `retryAfterSeconds`. Important states include:

- Unsupported or malformed URL.
- Server currently busy with no waiting queue.
- User rate limited.
- Upstream platform rate limited or requiring authentication.
- Private, removed, or unavailable content.
- Analysis or download timeout.
- File too large or insufficient disk space.
- Download expired, cancelled, or interrupted by a restart.

Capacity errors and upstream throttling must use distinct codes so the interface never tells the user the Zenload server is busy when Instagram is the component imposing a limit.

## UX and UI

The current layout, branding, motion language, and single-input flow remain. Improvements will focus on clarity and resilience:

- Keep the paste-and-analyze action prominent and usable with keyboard, touch, and pasted text.
- Show concise stages: checking link, preparing file, downloading, processing, and ready.
- Remove all waiting-queue language and queue positions.
- For a busy server, keep the entered link and offer a single retry action after a short countdown.
- For upstream restrictions, show platform-specific guidance without asking users to repeatedly retry.
- Preserve results when a download fails so the user can select another quality or retry.
- Make cancel behavior immediate and visibly confirmed.
- Ensure buttons cannot start duplicate jobs from rapid taps.
- Improve focus management, status announcements, reduced-motion behavior, contrast, tap targets, truncation, and small-screen layouts.
- Use skeletons only during analysis; use determinate progress where reliable and stage-based progress otherwise.
- Keep history local to the browser and make its privacy behavior clear without adding consent dialogs.
- Add a compact service-unavailable presentation when Oracle cannot be reached.

Visual work will refine spacing, hierarchy, state colors, and component consistency rather than replacing the existing theme.

## Frontend Performance and PWA

The production build will be checked for unnecessary assets and render-blocking work. Fonts and the social preview remain self-hosted. Images will receive explicit sizing and lazy loading where appropriate. Event listeners, intervals, object URLs, and network requests must clean up when components unmount.

The service worker will be reviewed to ensure API and download responses are never cached, navigation fallback does not trap external or download URLs, and new frontend deployments are adopted predictably.

## Deployment and Operations

Vercel continues to deploy the frontend from the GitHub `main` branch. Oracle continues to run only `zenload-backend.service`; `zentyr.service` is outside the scope and must not be changed.

Production configuration will be documented with safe defaults for origins, concurrency, file limits, timeouts, data directories, and optional cookies. A short operator guide will cover deployment, health verification, log inspection, restart, rollback, disk checks, and cookie refresh without printing secrets.

No deployment step will overwrite cookie data or the SQLite database. Backend rollout will verify the new revision, run tests or type checks before restart, restart only `zenload-backend.service`, and test health plus one lightweight end-to-end path.

## Testing and Acceptance

Backend verification will cover:

- URL and redirect security, including cross-origin credential removal.
- Atomic no-queue admission and exact slot release on every terminal path.
- Rate-limit codes and headers.
- Job token enforcement and download range handling.
- Timeouts, cancellation, process-tree termination, stream limits, cleanup, and startup recovery.
- Image proxy content type, size, and destination rules.
- Error classification for supported platforms without live platform calls in the normal test suite.

Frontend verification will cover core state behavior: submit, invalid input, busy server, analysis failure, successful result, duplicate-click prevention, download progress, cancellation, retry, completed download, and expired job. Accessibility checks will cover keyboard navigation, visible focus, status announcements, reduced motion, and mobile tap targets.

Release acceptance requires:

- Backend tests and TypeScript checks pass.
- Frontend production build succeeds.
- No secrets or runtime data are tracked by Git.
- Vercel serves the new build and rewrites API calls to Oracle.
- Oracle health checks pass after restart.
- A supported public link completes analyze-to-download.
- Busy capacity fails immediately with a clear retry action and no queued job row.
- Cancellation frees resources and removes partial files.

## Scope Boundaries

This pass does not promise that Facebook or Instagram will allow extraction from an Oracle cloud IP. It does not add authentication, billing, advertising, analytics, user accounts, proxy purchasing, browser automation, or distributed workers. Those would be separate product decisions.
