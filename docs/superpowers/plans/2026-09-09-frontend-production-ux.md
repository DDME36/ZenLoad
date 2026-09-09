# Frontend Production UX Implementation Plan

> **For agentic workers:** Execute after the backend error contract in the backend hardening plan is stable. Work task by task, test first, and preserve the existing Obsidian purple visual identity.

**Goal:** Make the Vercel React frontend feel immediate, clear, accessible, and resilient when the Oracle backend is busy, offline, rate limited, or blocked by a social platform.

**Architecture:** Add a small typed error layer and focused React hooks for analysis health and download jobs. Keep the existing component tree and CSS system, then refine states and responsive behavior without redesigning the product.

**Tech Stack:** React 19, Vite, Vitest, Testing Library, lucide-react, plain CSS, service worker

**Spec:** `docs/superpowers/specs/2026-09-09-production-hardening-design.md`

## Global Constraints

- Keep the black/purple brand, Thai copy, one-link workflow, local history, and current supported-platform presentation.
- Do not show a waiting queue or fake progress. Busy work must be rejected with a visible retry timer.
- Preserve analyzed results when a download fails so the user can retry another format.
- Meet keyboard, focus, reduced-motion, contrast, and mobile touch requirements.
- Never persist job tokens or source URLs outside the current page/session and existing local history behavior.

---

### Task 1: Add a focused frontend test harness

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.js`
- Create: `frontend/src/test/setup.js`
- Create: `frontend/src/services/api.test.js`

- [ ] Add `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, and `@testing-library/user-event` as development dependencies.
- [ ] Add scripts: `test`, `test:watch`, and `test:coverage`; configure `environment: 'jsdom'`, setup file, CSS handling, and automatic mock restoration.
- [ ] Add a smoke test that mocks `fetch` and verifies a successful analyze response.
- [ ] Run `cd frontend && npm test -- --run`.
- [ ] Commit with `git add frontend/package.json frontend/package-lock.json frontend/vite.config.js frontend/src/test/setup.js frontend/src/services/api.test.js && git commit -m "test(frontend): add component test harness"`.

### Task 2: Preserve the backend error contract in the browser

**Files:**
- Modify: `frontend/src/services/api.js`
- Modify: `frontend/src/services/api.test.js`

- [ ] Add failing tests for structured 429 errors, `Retry-After`, malformed JSON, timeouts, network failures, and header-based job status/cancel requests.
- [ ] Introduce an `ApiError` and one response parser:

```js
export class ApiError extends Error {
  constructor(message, { code = 'UNKNOWN', suggestion = null, retryAfterSeconds = null, status = 0, requestId = null } = {}) {
    super(message)
    this.name = 'ApiError'
    Object.assign(this, { code, suggestion, retryAfterSeconds, status, requestId })
  }
}

async function readApiResponse(response) {
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.success === false) {
    throw new ApiError(payload?.error?.message || `เซิร์ฟเวอร์ตอบกลับ HTTP ${response.status}`, {
      ...payload?.error,
      status: response.status,
      retryAfterSeconds: payload?.error?.retryAfterSeconds ?? (Number(response.headers.get('retry-after')) || null),
    })
  }
  return payload
}
```

- [ ] Use `X-Job-Token` for status and cancel. Keep token query encoding only in `getDirectDownloadUrl`.
- [ ] Add `cache: 'no-store'` to analyze, job, and health calls. Keep abort semantics distinct from timeout semantics.
- [ ] Run `cd frontend && npm test -- --run src/services/api.test.js`.
- [ ] Commit with `git commit -am "fix(frontend): preserve structured API errors"`.

### Task 3: Make analysis and service health explicit

**Files:**
- Modify: `frontend/src/hooks/useFetch.js`
- Create: `frontend/src/hooks/useServiceHealth.js`
- Create: `frontend/src/hooks/useFetch.test.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/SmartInput.jsx`
- Modify: `frontend/src/styles/global.css`

- [ ] Add failing hook tests for idle, analyzing, success, error, cancel, and late-response suppression.
- [ ] Replace coupled booleans with a stable state shape: `{ status: 'idle'|'analyzing'|'success'|'error', data, error }`. Keep the last submitted URL available until reset.
- [ ] Add a health hook that checks once on mount, after network errors, and when the browser returns online. Avoid periodic polling.
- [ ] Show a compact “เซิร์ฟเวอร์ยังไม่พร้อม” banner only when health fails. Keep the input usable and retry health when the user submits.
- [ ] Change analysis copy to real stages without invented percentages: connecting, reading metadata, and taking longer than usual after 12 seconds.
- [ ] Move keyboard focus to the error alert or result heading after state transitions. Disable repeat submit while analyzing.
- [ ] Run `cd frontend && npm test -- --run src/hooks/useFetch.test.jsx`.
- [ ] Commit with `git add frontend/src/hooks/useFetch.js frontend/src/hooks/useServiceHealth.js frontend/src/hooks/useFetch.test.jsx frontend/src/App.jsx frontend/src/components/SmartInput.jsx frontend/src/styles/global.css && git commit -m "feat(ux): clarify analysis and service health"`.

### Task 4: Extract a reliable download-job state machine

**Files:**
- Create: `frontend/src/hooks/useDownloadJob.js`
- Create: `frontend/src/hooks/useDownloadJob.test.jsx`
- Modify: `frontend/src/components/ResultCard.jsx`
- Modify: `frontend/src/components/DownloadProgressPanel.jsx`

- [ ] Add failing tests for duplicate clicks, successful polling, busy rejection, failed jobs, cancellation during sleep/fetch, unmount cleanup, and retry from the same analyzed result.
- [ ] Move job refs, polling, elapsed time, cancellation, and state transitions out of `ResultCard` into `useDownloadJob`.
- [ ] Use a single state reducer with the transitions `idle → starting → downloading/merging/converting → ready`, plus `failed` and `cancelled`. Do not expose `queued` in user copy.
- [ ] Poll at 500 ms for the first 10 seconds, then 1 second; stop immediately on terminal status, abort, unmount, or hidden-page cancellation. Never start a second request while one is active.
- [ ] Keep `ResultCard` mounted on any error. Return a `retry()` action that reuses the selected option only after local or upstream retry time expires.
- [ ] Clean every timer, abort controller, and temporary DOM anchor. Do not create blob URLs for server files.
- [ ] Run `cd frontend && npm test -- --run src/hooks/useDownloadJob.test.jsx`.
- [ ] Commit with `git add frontend/src/hooks/useDownloadJob.js frontend/src/hooks/useDownloadJob.test.jsx frontend/src/components/ResultCard.jsx frontend/src/components/DownloadProgressPanel.jsx && git commit -m "refactor(download): make job lifecycle deterministic"`.

### Task 5: Add useful busy and platform error states

**Files:**
- Modify: `frontend/src/components/ErrorAlert.jsx`
- Modify: `frontend/src/components/DownloadProgressPanel.jsx`
- Create: `frontend/src/components/ErrorAlert.test.jsx`
- Modify: `frontend/src/styles/global.css`

- [ ] Add failing component tests for local capacity, client rate limit, upstream rate limit, authentication/private media, expired analysis, offline backend, and generic failure.
- [ ] Map backend codes to concise Thai titles and actions. Suggested categories:
  - `ANALYZER_BUSY` / `DOWNLOAD_BUSY`: “เครื่องกำลังทำงานเต็มกำลัง” with countdown and enabled retry at zero.
  - `TOO_MANY_REQUESTS`: “ส่งคำขอถี่เกินไป” with countdown.
  - `UPSTREAM_RATE_LIMITED`: name the platform limitation and advise a later retry.
  - `AUTH_REQUIRED` / `PRIVATE_CONTENT`: explain that public access or a valid cookie is required.
  - `ANALYZE_REQUIRED`: offer one-click reanalysis.
  - network/timeout: show a server retry action.
- [ ] Render errors with `role="alert"`; render progress with `role="status"` and `aria-live="polite"`. Keep icon-only close/cancel buttons labeled.
- [ ] Add visible focus rings, minimum 44 px touch targets, disabled/loading feedback, and a reduced-motion branch for all entrance/spin/progress animations.
- [ ] Run `cd frontend && npm test -- --run src/components/ErrorAlert.test.jsx`.
- [ ] Commit with `git add frontend/src/components/ErrorAlert.jsx frontend/src/components/DownloadProgressPanel.jsx frontend/src/components/ErrorAlert.test.jsx frontend/src/styles/global.css && git commit -m "feat(ux): add actionable production errors"`.

### Task 6: Polish layout and visual hierarchy without a redesign

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/Header.jsx`
- Modify: `frontend/src/components/SmartInput.jsx`
- Modify: `frontend/src/components/ResultCard.jsx`
- Modify: `frontend/src/components/AlbumGallery.jsx`
- Modify: `frontend/src/styles/global.css`

- [ ] Add screenshot-sized component tests or stable DOM assertions for 360 px, 768 px, and desktop layouts.
- [ ] Keep the hero and input above the fold on small screens. Reduce decorative height and spacing before shrinking readable text.
- [ ] Make one primary download action visually dominant; move secondary formats into a compact format group. Keep platform, filename/quality, and expected file type visible before click.
- [ ] Keep album actions sticky only when they do not obscure the last gallery item. Ensure image previews use stable aspect ratios and loading fallbacks.
- [ ] Make the result heading the focus target and preserve scroll position on download errors. Remove duplicate back/reset controls.
- [ ] Audit Thai line wrapping, long titles, safe-area insets, 200% zoom, keyboard-only flow, and high-contrast forced colors.
- [ ] Run `cd frontend && npm test -- --run` and `cd frontend && npm run build`.
- [ ] Commit with `git commit -am "feat(ui): polish responsive download flow"`.

### Task 7: Make the service worker update safely

**Files:**
- Modify: `frontend/public/sw.js`
- Modify: `frontend/src/main.jsx`
- Create: `frontend/src/services/serviceWorker.js`
- Create: `frontend/src/services/serviceWorker.test.js`

- [ ] Add tests for registration, update detection, and the rule that `/api/*`, `/health`, downloads, cross-origin media, and non-GET requests never enter Cache Storage.
- [ ] Version the static cache from build metadata and cache only immutable local fonts/icons plus the navigation shell.
- [ ] Use network-first navigation with a short timeout and fall back to cached `index.html`. Never cache API responses or proxied images.
- [ ] Surface an unobtrusive “มีเวอร์ชันใหม่” action when a worker is waiting; reload only after the user accepts.
- [ ] Run `cd frontend && npm test -- --run src/services/serviceWorker.test.js` and `cd frontend && npm run build`.
- [ ] Commit with `git add frontend/public/sw.js frontend/src/main.jsx frontend/src/services/serviceWorker.js frontend/src/services/serviceWorker.test.js && git commit -m "fix(pwa): make cache updates predictable"`.

### Task 8: Run the frontend release gate

**Files:**
- Modify if needed: `README.md`

- [ ] Run `cd frontend && npm test -- --run`.
- [ ] Run `cd frontend && npm run build`.
- [ ] Run `cd backend && bun test` against the final API contract.
- [ ] Preview the production build and manually verify Chrome responsive sizes 360×800, 768×1024, and 1440×900; verify keyboard and reduced-motion behavior.
- [ ] Verify no API payload, job token, or download response exists in Cache Storage or localStorage.
- [ ] Run `git diff --check` and inspect the final diff for accidental copy changes or visual regressions.
