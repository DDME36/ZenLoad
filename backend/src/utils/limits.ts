import { AppError } from './errors'
import { statfs } from 'node:fs/promises'

/**
 * Synchronously reserves capacity without retaining waiting callers.
 */
export class CapacityGate {
  private activeCount = 0

  constructor(
    private readonly maxConcurrency: number,
    private readonly busyError: AppError
  ) {}

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

  getActiveCount(): number {
    return this.activeCount
  }

  getLimit(): number {
    return this.maxConcurrency
  }

  getBusyError(): AppError {
    return this.busyError
  }
}

export const CAPACITY_RETRY_AFTER_SECONDS = 5

// Capacity สำหรับวิเคราะห์ URL (yt-dlp --dump-json ใช้ RAM เยอะ)
const MAX_CONCURRENT_ANALYZES = parseInt(process.env.MAX_CONCURRENT_ANALYZES || '2', 10)
export const analyzeCapacity = new CapacityGate(
  MAX_CONCURRENT_ANALYZES,
  new AppError(
    'ANALYZER_BUSY',
    'ระบบกำลังวิเคราะห์ลิงก์อื่นอยู่ กรุณาลองใหม่อีกครั้งในอีกสักครู่ครับ',
    429
  )
)

// Capacity สำหรับดาวน์โหลดไฟล์
const MAX_CONCURRENT_DOWNLOADS = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || '2', 10)
export const downloadCapacity = new CapacityGate(
  MAX_CONCURRENT_DOWNLOADS,
  new AppError(
    'DOWNLOAD_BUSY',
    'ระบบกำลังดาวน์โหลดไฟล์อื่นอยู่ กรุณาลองใหม่อีกครั้งในอีกสักครู่ครับ',
    429
  )
)

/**
 * Rate Limiter ต่อ Client IP (Sliding Window / Fixed Window)
 */
interface RateLimitRecord {
  count: number
  resetAt: number
}

export class IpRateLimiter {
  private records = new Map<string, RateLimitRecord>()

  constructor(
    private maxRequests: number,
    private windowMs: number,
    private errorMessage: string = 'คุณส่งคำขอถี่เกินไป กรุณารอสักครู่'
  ) {
    // ล้าง IP ที่หมดอายุทุก 5 นาที
    setInterval(() => {
      const now = Date.now()
      for (const [ip, rec] of this.records.entries()) {
        if (now > rec.resetAt) {
          this.records.delete(ip)
        }
      }
    }, 300000)
  }

  check(ip: string): void {
    const now = Date.now()
    const rec = this.records.get(ip)

    if (!rec || now > rec.resetAt) {
      this.records.set(ip, { count: 1, resetAt: now + this.windowMs })
      return
    }

    if (rec.count >= this.maxRequests) {
      const waitSeconds = Math.ceil((rec.resetAt - now) / 1000)
      throw new AppError(
        'TOO_MANY_REQUESTS',
        `${this.errorMessage} (กรุณารออีก ${waitSeconds} วินาที)`,
        429
      )
    }

    rec.count++
  }
}

// Rate limiters:
// Analyze: 20 ครั้งต่อ 1 นาที
export const analyzeRateLimiter = new IpRateLimiter(20, 60000, 'คุณส่งคำขอวิเคราะห์ลิงก์ถี่เกินไป')
// Download: 10 ครั้งต่อ 5 นาที
export const downloadRateLimiter = new IpRateLimiter(10, 300000, 'คุณเริ่มงานดาวน์โหลดถี่เกินไป')

/**
 * ตรวจสอบพื้นที่ดิสก์ว่างขั้นต่ำ (อย่างน้อย 1GB สำหรับ temp dir)
 */
export async function assertSufficientDiskSpace(targetDir: string, minFreeBytes: number = 1024 * 1024 * 1024): Promise<void> {
  try {
    if (typeof statfs === 'function') {
      const stats = await statfs(targetDir)
      const freeBytes = stats.bavail * stats.bsize
      if (freeBytes < minFreeBytes) {
        throw new AppError('DISK_SPACE_LOW', 'พื้นที่ว่างบนเซิร์ฟเวอร์ไม่เพียงพอสำหรับการดาวน์โหลดชั่วคราว', 507)
      }
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    // ถ้า OS ไม่รองรับ statfs ให้ข้ามไป
  }
}

// ขนาดไฟล์ดาวน์โหลดสูงสุดที่อนุญาต (Default: 2GB)
export const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '2048', 10)
export const MAX_DOWNLOAD_DURATION_MS = parseInt(process.env.MAX_DOWNLOAD_DURATION_MS || '900000', 10) // 15 mins
export const MAX_ANALYZE_DURATION_MS = parseInt(process.env.MAX_ANALYZE_DURATION_MS || '30000', 10) // 30 secs
