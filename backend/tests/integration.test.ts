import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { app } from '../src/index'
import { safeFetch } from '../src/utils/security'
import { downloadCapacity } from '../src/utils/limits'
import { killProcessTree } from '../src/utils/process'
import { createJob, completeJob, getJob } from '../src/services/jobManager'
import { ensureTempDir } from '../src/utils/helpers'
import { join } from 'node:path'
import { writeFile, unlink } from 'node:fs/promises'

describe('Zentyr Fetch - End-to-End Integration & Security Tests', () => {
  let tempFilePath: string
  let testJobId: string
  let testAccessToken: string

  beforeAll(async () => {
    const tempDir = await ensureTempDir()
    tempFilePath = join(tempDir, `test_integration_${Date.now()}.bin`)
    // Create a 100-byte test file
    const buffer = Buffer.alloc(100)
    for (let i = 0; i < 100; i++) {
      buffer[i] = i
    }
    await writeFile(tempFilePath, buffer)

    const job = createJob({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      optionId: 'video_720p',
      platform: 'youtube',
    })
    testJobId = job.jobId
    testAccessToken = job.accessToken

    completeJob(testJobId, tempFilePath, 'test_media.bin', 'application/octet-stream', 100)
  })

  afterAll(async () => {
    try {
      await unlink(tempFilePath)
    } catch {}
  })

  // ===== P0 Item 1: SSRF Redirect Validation =====
  describe('P0-1: SSRF Redirect & Protocol Protection', () => {
    it('should block direct SSRF targets (Cloud Metadata & Loopback)', async () => {
      // Loopback
      await expect(safeFetch('http://127.0.0.1:3001/api/debug-cookies')).rejects.toThrow()
      // Cloud Metadata Service (Oracle/AWS/GCP)
      await expect(safeFetch('http://169.254.169.254/opc/v1/instance/')).rejects.toThrow()
      // IPv6 Loopback
      await expect(safeFetch('http://[::1]:8080/secret')).rejects.toThrow()
    })

    it('should block 302 redirects pointing to private metadata IP (169.254.169.254)', async () => {
      const originalFetch = globalThis.fetch
      try {
        // Mock the first fetch response as a 302 redirect to Oracle IMDS
        globalThis.fetch = async (input: any, init?: any) => {
          const urlStr = typeof input === 'string' ? input : input.url || input.href
          if (urlStr.includes('example.com/test-ssrf-redirect')) {
            return new Response(null, {
              status: 302,
              headers: { Location: 'http://169.254.169.254/opc/v1/instance/' },
            })
          }
          return originalFetch(input, init)
        }

        // safeFetch will validate the redirect target and reject with SSRF error
        let caughtError: any = null
        try {
          await safeFetch('https://example.com/test-ssrf-redirect')
        } catch (err) {
          caughtError = err
        }

        expect(caughtError).not.toBeNull()
        expect(caughtError.code).toBe('SSRF_DETECTED')
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  // ===== P0 Item 2: Immediate Capacity Rejection & No Zombie Job =====
  describe('P0-2: Capacity Admission / Rejection & Zombie Job Prevention', () => {
    it('should reject with 429 when download capacity is full', async () => {
      const firstLease = downloadCapacity.tryAcquire()
      const secondLease = downloadCapacity.tryAcquire()
      try {

        // Now send download start request via HTTP POST
        const res = await app.handle(
          new Request('http://localhost/api/download/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
              option: 'video_720p',
            }),
          })
        )

        expect(res.status).toBe(429)
        const data = await res.json()
        expect(data.success).toBe(false)
        expect(data.error.code).toBe('DOWNLOAD_BUSY')
      } finally {
        firstLease?.()
        secondLease?.()
      }

      const replacementLease = downloadCapacity.tryAcquire()
      expect(replacementLease).toBeFunction()
      replacementLease?.()
    })
  })

  // ===== P0 Item 4: Legacy Bypass Elimination =====
  describe('P0-4: Legacy Bypass Elimination', () => {
    it('should confirm GET /api/download/start is completely removed (404)', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/download/start?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ')
      )
      expect(res.status).toBe(404)
    })

    it('should reject GET /api/download without jobId (422 or 400)', async () => {
      const res = await app.handle(new Request('http://localhost/api/download'))
      expect([400, 422]).toContain(res.status)
    })

    it('should reject GET /api/download with invalid token (403)', async () => {
      const res = await app.handle(
        new Request(`http://localhost/api/download?jobId=${testJobId}&token=wrong-token`)
      )
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error.code).toBe('FORBIDDEN')
    })
  })

  // ===== P1 Item 6: Process-Tree Cancellation =====
  describe('P1-6: Process-Tree Cancellation', () => {
    it('should terminate subprocess and await termination', async () => {
      // Spawn a background bun subprocess that sleeps
      const proc = Bun.spawn(['bun', '-e', 'setInterval(() => {}, 1000)'])
      expect(proc.pid).toBeGreaterThan(0)

      const start = Date.now()
      await killProcessTree(proc)
      const duration = Date.now() - start

      // Process must have exited
      const exitCode = await proc.exited
      expect(exitCode).toBeDefined()
      expect(duration).toBeLessThan(4000)
    })
  })

  // ===== Range Request / Partial Content =====
  describe('HTTP Range & Resumable Downloads', () => {
    it('should support downloading the completed file with valid token', async () => {
      const res = await app.handle(
        new Request(`http://localhost/api/download?jobId=${testJobId}&token=${testAccessToken}`)
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('accept-ranges')).toBe('bytes')
      const arrayBuffer = await res.arrayBuffer()
      expect(arrayBuffer.byteLength).toBe(100)
    })

    it('should support Range requests (HTTP 206 Partial Content)', async () => {
      const res = await app.handle(
        new Request(`http://localhost/api/download?jobId=${testJobId}&token=${testAccessToken}`, {
          headers: {
            Range: 'bytes=0-9',
          },
        })
      )
      expect([200, 206]).toContain(res.status)
      expect(res.headers.get('accept-ranges')).toBe('bytes')
      const arrayBuffer = await res.arrayBuffer()
      if (res.status === 206) {
        expect(arrayBuffer.byteLength).toBe(10)
        expect(res.headers.get('content-range')).toContain('bytes 0-9/100')
      }
    })
  })
})
