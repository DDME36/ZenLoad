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
      return new Response(file)
    }

    // SPA Fallback: ส่ง index.html หากไม่พบไฟล์ตรงตัว (รองรับ Routing ภายในเว็บ)
    const indexFile = Bun.file(join(DIST_DIR, 'index.html'))
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      })
    }

    return new Response('Zenload Frontend build not found. Please run bun run build first.', { status: 404 })
  },
})

console.log(`🚀 Zenload Frontend production server running on http://localhost:${PORT}/zenload`)
