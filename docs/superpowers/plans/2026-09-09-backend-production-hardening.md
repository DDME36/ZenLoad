# Backend Production Hardening Implementation Plan

> **For agentic workers:** Execute this plan task by task. Keep each commit small, run the named tests after every task, and do not deploy from this plan.

**Goal:** Make the Bun/Elysia backend safe and predictable on Oracle Ubuntu Free Tier while keeping downloads immediate: admit work only when a slot is available, otherwise return a useful 429 response.

**Architecture:** Keep the current route and downloader structure. Replace the queued semaphore with atomic capacity leases, centralize API errors and response headers, require analyzed options for downloads, protect job credentials, bound proxy streams, and restrict operational diagnostics. SQLite remains the only persistent store.

**Tech Stack:** Bun, TypeScript, Elysia, bun:test, SQLite, yt-dlp, gallery-dl, ffmpeg

**Spec:** `docs/superpowers/specs/2026-09-09-production-hardening-design.md`

## Global Constraints

- Preserve the public-by-link product model; do not add accounts, passwords, CAPTCHA, Redis, or a waiting queue.
- Default to two concurrent analyses and two concurrent downloads.
- Never log raw source URLs, cookies, proxy credentials, job access tokens, or signed CDN URLs.
- Do not expose `/api/logs` publicly.
- Keep all existing platform adapters working and preserve the analyze cache path used by Facebook and Instagram.
- Write a failing test before each behavior change and commit only after the focused and full backend suites pass.

---

### Task 1: Replace waiting queues with atomic capacity leases

**Files:**
- Modify: `backend/src/utils/limits.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/tests/jobManager.test.ts`
- Modify: `backend/tests/api.test.ts`

- [ ] Add a failing unit test proving the third immediate acquisition fails when a two-slot gate is full, no waiter is retained, and a released lease can be acquired once.
- [ ] Replace `BoundedSemaphore` with a lease-returning `CapacityGate` so admission and reservation happen in one synchronous operation:

```ts
export class CapacityGate {
  private activeCount = 0

  constructor(private readonly maxConcurrency: number, private readonly busyError: AppError) {}

  tryAcquire(): (() => void) | null {
    if (this.activeCount >= this.maxConcurrency) return null
    this.activeCount += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.activeCount = Math.max(0, this.activeCount - 1)
    }
  }

  getActiveCount(): number { return this.activeCount }
  getBusyError(): AppError { return this.busyError }
}
```

- [ ] Remove queue length and timeout settings. Export `analyzeCapacity` and `downloadCapacity` with environment-configurable concurrency limits and `retryAfterSeconds: 5`.
- [ ] Acquire analysis capacity after cache lookup and release it in `finally`.
- [ ] Acquire download capacity inside `POST /api/download/start` before disk checks and SQLite job creation. Pass the release lease into `runDownloadJob`; release it exactly once in its `finally`. If admission fails, return 429 without creating a job.
- [ ] Update `/health` and `/api/system/status` to report `{ active, limit }` and remove all queue fields and queue wording.
- [ ] Run `cd backend && bun test tests/jobManager.test.ts tests/api.test.ts`.
- [ ] Commit with `git commit -am "fix(api): reject work immediately at capacity"`.

### Task 2: Standardize API errors, retry timing, and safe response headers

**Files:**
- Modify: `backend/src/utils/errors.ts`
- Create: `backend/src/utils/http.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/src/types.ts`
- Modify: `backend/tests/api.test.ts`

- [ ] Add failing integration tests for the JSON envelope, `Retry-After`, `Cache-Control: no-store`, request IDs, and Elysia validation failures.
- [ ] Extend `AppError` with `retryAfterSeconds?: number` and introduce a single serializer:

```ts
export function sendApiError(error: unknown, set: ApiSet, requestId: string): ApiResponse {
  const appError = normalizeError(error)
  set.status = appError.statusCode
  set.headers['cache-control'] = 'no-store'
  set.headers['x-request-id'] = requestId
  if (appError.retryAfterSeconds) set.headers['retry-after'] = String(appError.retryAfterSeconds)
  return { success: false, error: {
    code: appError.code,
    message: appError.message,
    suggestion: appError.suggestion,
    retryAfterSeconds: appError.retryAfterSeconds,
    requestId,
  }}
}
```

- [ ] Add an Elysia derive hook that accepts a valid incoming `x-request-id` or creates `crypto.randomUUID()`, and add it to every API response.
- [ ] Route all thrown rate limit, capacity, validation, job, and unexpected errors through the serializer. Return 429 for local capacity and upstream rate limits, but use distinct codes: `ANALYZER_BUSY`, `DOWNLOAD_BUSY`, `UPSTREAM_RATE_LIMITED`, and `TOO_MANY_REQUESTS`.
- [ ] Add `Cache-Control: no-store` and `Referrer-Policy: no-referrer` to job start, status, cancel, and error responses. Add `X-Content-Type-Options: nosniff` to all API responses.
- [ ] Change `IpRateLimiter.check()` to return its reset time or throw an `AppError` containing `retryAfterSeconds`.
- [ ] Run `cd backend && bun test tests/api.test.ts tests/errorClassifier.test.ts`.
- [ ] Commit with `git add backend/src/utils/errors.ts backend/src/utils/http.ts backend/src/index.ts backend/src/types.ts backend/tests/api.test.ts && git commit -m "feat(api): return structured retryable errors"`.

### Task 3: Validate download requests against analyzed media

**Files:**
- Create: `backend/src/utils/downloadOptions.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/tests/api.test.ts`
- Create: `backend/tests/downloadOptions.test.ts`

- [ ] Add failing tests for valid top-level options, valid album item options, unknown options, missing cache entries, oversized option strings, and a URL that differs from the analyzed canonical URL.
- [ ] Implement a pure validator that derives the allowed option IDs from `cachedMeta.options`, `cachedMeta.items[].options`, and generated `item_N` IDs:

```ts
export function assertDownloadOption(meta: MediaInfo | undefined, optionId: string): void {
  if (!meta) throw new AppError('ANALYZE_REQUIRED', 'กรุณาวิเคราะห์ลิงก์นี้อีกครั้งก่อนดาวน์โหลด', 409)
  if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(optionId)) throw new AppError('INVALID_OPTION', 'ตัวเลือกดาวน์โหลดไม่ถูกต้อง', 400)
  const allowed = collectAllowedOptionIds(meta)
  if (!allowed.has(optionId)) throw new AppError('INVALID_OPTION', 'ไม่พบตัวเลือกนี้ในผลการวิเคราะห์', 400)
}
```

- [ ] In `/api/download/start`, canonicalize the URL, fetch its cache entry, validate the option before reserving capacity or writing SQLite, and pass that exact cached object into `runDownloadJob` so it cannot be replaced by a later cache lookup.
- [ ] Adjust existing API tests to seed the media cache before starting a job. Verify rejected requests create no job and consume no capacity.
- [ ] Run `cd backend && bun test tests/downloadOptions.test.ts tests/api.test.ts tests/socialDownloads.test.ts`.
- [ ] Commit with `git add backend/src/utils/downloadOptions.ts backend/src/index.ts backend/tests/api.test.ts backend/tests/downloadOptions.test.ts && git commit -m "fix(download): require analyzed download options"`.

### Task 4: Harden job identifiers, credentials, cancellation, and file delivery

**Files:**
- Modify: `backend/src/services/jobManager.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/tests/jobManager.test.ts`
- Modify: `backend/tests/api.test.ts`

- [ ] Add failing tests for UUID job IDs, equal-length and unequal-length bad tokens, status access through `X-Job-Token`, cancellation idempotency, and safe Unicode filenames.
- [ ] Generate both job IDs and access tokens with `crypto.randomUUID()`.
- [ ] Compare SHA-256 token digests with `timingSafeEqual` after checking buffer lengths. Keep existing plaintext SQLite rows compatible during this release; add a migration note for hashed-at-rest tokens after the deployed frontend uses headers.
- [ ] Update frontend-facing API support so status and cancel prefer `X-Job-Token`. Keep the query token only on the final browser download URL because a native navigation cannot set a custom header.
- [ ] Sanitize CR/LF, quotes, slashes, control characters, and overlong names before constructing `Content-Disposition`. Preserve `filename*=UTF-8''...`.
- [ ] Make cancel return success for an already aborted job owned by the same token, and make every abort path terminate attached subprocesses and remove partial files before releasing capacity.
- [ ] Run `cd backend && bun test tests/jobManager.test.ts tests/api.test.ts tests/streamFile.test.ts`.
- [ ] Commit with `git commit -am "fix(download): harden job access and delivery"`.

### Task 5: Bound and sanitize the image proxy

**Files:**
- Modify: `backend/src/utils/security.ts`
- Create: `backend/src/utils/boundedResponse.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/tests/security.test.ts`
- Modify: `backend/tests/api.test.ts`

- [ ] Add failing tests showing redirects to private IPs are rejected, upstream authorization/cookie headers never cross origins, non-image responses fail, and a chunked response is aborted after 15 MiB even without `Content-Length`.
- [ ] Add a byte-counting `ReadableStream` wrapper that cancels the upstream reader after the configured maximum:

```ts
export function limitResponseBody(body: ReadableStream<Uint8Array>, maxBytes: number, abort: () => void) {
  let received = 0
  const reader = body.getReader()
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) return controller.close()
      received += value.byteLength
      if (received > maxBytes) { abort(); return controller.error(new AppError('IMAGE_TOO_LARGE', 'รูปภาพมีขนาดเกินกำหนด', 413)) }
      controller.enqueue(value)
    },
    cancel: () => reader.cancel(),
  })
}
```

- [ ] Use the wrapper in `/api/proxy-image`; keep the header pre-check as an early rejection. Return only an approved image MIME type and add `nosniff`.
- [ ] Redact image URLs in proxy error logs by logging hostname plus a short SHA-256 request fingerprint.
- [ ] Preserve `safeFetch` SSRF checks on every redirect and strip `Cookie`, `Authorization`, and `Proxy-Authorization` when the origin changes.
- [ ] Run `cd backend && bun test tests/security.test.ts tests/api.test.ts tests/proxyPropagation.test.ts`.
- [ ] Commit with `git add backend/src/utils/security.ts backend/src/utils/boundedResponse.ts backend/src/index.ts backend/tests/security.test.ts backend/tests/api.test.ts && git commit -m "fix(proxy): enforce streamed image limits"`.

### Task 6: Remove public diagnostics and redact operational logs

**Files:**
- Modify: `backend/src/index.ts`
- Modify: `backend/src/utils/helpers.ts`
- Create: `backend/src/utils/logging.ts`
- Modify: `backend/tests/api.test.ts`
- Create: `backend/tests/logging.test.ts`

- [ ] Add failing tests proving `/api/logs` returns 404 in production and log metadata redacts cookies, tokens, signed query strings, source URLs, and proxy credentials.
- [ ] Remove the public `/api/logs` route. Operators will use `journalctl -u zenload-backend.service` and the local log file over SSH.
- [ ] Add structured redaction for keys matching `cookie`, `authorization`, `token`, `proxy`, and `url`. Log `{ platform, requestId, hostHash, errorCode }` instead of raw source URLs/IPs.
- [ ] Stop using raw client IP in human-readable messages. Determine the client IP from the socket by default; trust forwarding headers only when `TRUST_PROXY_HEADERS=true`, since the Oracle port may be reachable directly.
- [ ] Add bounded body validation: URLs at most 2,048 characters, job IDs/tokens at most 128 characters, and JSON bodies at most 8 KiB.
- [ ] Run `cd backend && bun test tests/logging.test.ts tests/api.test.ts`.
- [ ] Commit with `git add backend/src/index.ts backend/src/utils/helpers.ts backend/src/utils/logging.ts backend/tests/api.test.ts backend/tests/logging.test.ts && git commit -m "fix(security): close diagnostics and redact logs"`.

### Task 7: Run the complete backend release gate

**Files:**
- Modify if needed: `README.md`

- [ ] Run `cd backend && bun run typecheck`.
- [ ] Run `cd backend && bun test`.
- [ ] Run `cd frontend && npm run build` to catch API contract import/build issues.
- [ ] Start the backend locally with a disposable `DATA_DIR` and `TEMP_DIR`; verify `/health`, one cached analyze flow, immediate 429 at capacity, cancellation, and a ranged file response.
- [ ] Inspect `git diff --check` and `git status --short`; remove test databases and temporary downloads.
- [ ] Update the README API section with the final response envelope and capacity behavior.
- [ ] Commit with `git commit -am "docs(api): document production limits and errors"`.
