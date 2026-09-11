import { join } from 'node:path'

const PORT = parseInt(process.env.PORT || '3003', 10)
const DIST_DIR = join(import.meta.dir, 'dist')

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    let pathname = url.pathname

    // จัดการ Base path /zenload เพื่อแมปเข้าสู่โฟลเดอร์ dist
    if (pathname === '/zenload' || pathname === '/zenload/') {
      pathname = '/index.html'
    } else if (pathname.startsWith('/zenload/')) {
      pathname = pathname.slice('/zenload'.length)
    }

    if (!pathname || pathname === '/') {
      pathname = '/index.html'
    }

    const filePath = join(DIST_DIR, pathname)
    const file = Bun.file(filePath)

    if (await file.exists()) {
      const mimeType = file.type || 'application/octet-stream'
      const headers = new Headers({
        'Content-Type': mimeType,
        'Content-Length': String(file.size),
        'Cache-Control': pathname.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
        'Accept-Ranges': 'bytes',
      })

      if (req.method === 'HEAD') {
        return new Response(null, { status: 200, headers })
      }
      return new Response(file, { status: 200, headers })
    }

    // SPA Fallback: ส่ง index.html หากไม่พบไฟล์ตรงตัว (รองรับ Routing ภายในเว็บ)
    const indexFile = Bun.file(join(DIST_DIR, 'index.html'))
    if (await indexFile.exists()) {
      const headers = new Headers({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      })
      if (req.method === 'HEAD') {
        headers.set('Content-Length', String(indexFile.size))
        return new Response(null, { status: 200, headers })
      }
      return new Response(indexFile, { status: 200, headers })
    }

    return new Response('Zenload Frontend build not found. Please run bun run build first.', { status: 404 })
  },
})

console.log(`🚀 Zenload Frontend production server running on http://localhost:${PORT}/zenload`)
