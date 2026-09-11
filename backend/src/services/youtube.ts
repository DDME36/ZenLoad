import { videoQualityOptions } from '../utils/mediaQuality'
import type { MediaInfo, DownloadResult, DownloadStage, MediaItem } from '../types'
import { AppError, classifyYtDlpError } from '../utils/errors'
import { sanitizeFilename, truncateDescription, ensureTempDir, log, getYtDlpArgs } from '../utils/helpers'
import { killProcessTree, cleanupPartialFiles } from '../utils/process'
import { MAX_FILE_SIZE_MB } from '../utils/limits'
import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * ดึงข้อมูลวิดีโอ YouTube (Default Client First + Smart Cookie Fallback + Typed Error Retries)
 */
export async function getYoutubeInfo(url: string, signal?: AbortSignal): Promise<MediaInfo> {
  const baseArgs = [
    'yt-dlp',
    '--dump-json',
    '--no-download',
    '--no-playlist',
    '--socket-timeout', '30',
    '--age-limit', '21',
    url
  ]

  // 1. ลอง Default Client เสมอเป็นอันดับแรก
  let defaultRes = await runYtDlpJson(baseArgs, signal)
  if (defaultRes.success && defaultRes.data) {
    return processYoutubeInfo(defaultRes.data)
  }

  // 1.1 หากพบปัญหาจากคุกกี้ที่หมดอายุหรือ invalid ชัดเจน
  // ให้ลอง Fallback ทันทีโดยไม่ส่งคุกกี้ เพราะวิดีโอส่วนใหญ่สามารถดึงได้โดยตรง
  const isCookieIssue =
    defaultRes.error?.includes('The provided YouTube account cookies are no longer valid') ||
    defaultRes.error?.includes('The page needs to be reloaded')
    
  if (isCookieIssue) {
    log('warn', `YouTube cookie issue detected (${defaultRes.error?.trim().slice(0, 100)}). Retrying without cookies...`)
    const noCookieRes = await runYtDlpJson(baseArgs, signal, { noCookies: true })
    if (noCookieRes.success && noCookieRes.data) {
      log('info', `✅ Success without cookies for YouTube`)
      return processYoutubeInfo(noCookieRes.data)
    }
  }

  // 2. วิเคราะห์ Error เพื่อตัดสินใจว่าจะ Retry Client หรือไม่
  const classified = classifyYtDlpError(defaultRes.error || '')
  log('warn', `YouTube default client failed: ${classified.type} (${defaultRes.error?.substring(0, 100)})`)

  if (!classified.canRetryWithClient) {
    throw new AppError(classified.type, classified.userMessage, classified.statusCode)
  }

  // 3. สลับไปลอง Client เฉพาะเมื่อเกิด Challenge หรือ Bot detection (โดยไม่ส่งคุกกี้ที่อาจโดนปฏิเสธ)
  const retryClients = [
    {
      name: 'android',
      args: [
        'yt-dlp',
        '--dump-json',
        '--no-download',
        '--no-playlist',
        '--socket-timeout', '30',
        '--user-agent', 'com.google.android.youtube/19.09.37 (Linux; U; Android 13; en_US)',
        '--extractor-args', 'youtube:player_client=android',
        '--age-limit', '21',
        url
      ]
    },
    {
      name: 'ios',
      args: [
        'yt-dlp',
        '--dump-json',
        '--no-download',
        '--no-playlist',
        '--socket-timeout', '30',
        '--extractor-args', 'youtube:player_client=ios',
        '--age-limit', '21',
        url
      ]
    }
  ]

  for (const client of retryClients) {
    if (signal?.aborted) {
      throw new AppError('ANALYZE_ABORTED', 'การวิเคราะห์ถูกยกเลิก', 499)
    }

    log('info', `Retrying with ${client.name} client...`)
    await new Promise(r => setTimeout(r, 800))

    const res = await runYtDlpJson(client.args, signal, { noCookies: true })
    if (res.success && res.data) {
      log('info', `✅ Success with ${client.name} client`)
      return processYoutubeInfo(res.data)
    }
  }

  throw new AppError(classified.type, classified.userMessage, classified.statusCode)
}

async function runYtDlpJson(args: string[], signal?: AbortSignal, options?: { noCookies?: boolean }): Promise<{ success: boolean; data?: any; error?: string }> {
  const finalArgs = options?.noCookies ? args : getYtDlpArgs(args)
  const proc = Bun.spawn(finalArgs, {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })

  const onAbort = () => killProcessTree(proc)
  if (signal) signal.addEventListener('abort', onAbort)

  try {
    const [output, errorOutput] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited

    if (exitCode === 0 && output.trim()) {
      return { success: true, data: JSON.parse(output) }
    }
    return { success: false, error: errorOutput }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

/**
 * ประมวลผลข้อมูลวิดีโอจาก yt-dlp และสร้างโครงสร้าง MediaInfo พร้อม items[]
 */
function processYoutubeInfo(info: any): MediaInfo {
  const options: MediaInfo['options'] = []

  options.push(...videoQualityOptions(info.formats))

  if (options.length === 0) {
    options.push({ id: 'video_best', label: 'วิดีโอ · สูงสุดที่มี', format: 'mp4', quality: 'best' })
  }

  // Audio options
  options.push({ id: 'audio_mp3', label: 'MP3', format: 'mp3', quality: 'best' })

  options.push({ id: 'audio_m4a', label: 'M4A (AAC)', format: 'm4a', quality: 'best' })

  const thumbnail = info.thumbnail || (info.id ? `https://img.youtube.com/vi/${info.id}/maxresdefault.jpg` : '')
  const title = info.title || 'Unknown Video'

  const videoItem: MediaItem = {
    id: info.id || 'video_1',
    kind: 'video',
    title,
    thumbnail,
    duration: info.duration,
    options,
  }

  return {
    platform: 'youtube',
    contentType: 'video',
    title,
    thumbnail,
    description: truncateDescription(info.description, 200),
    items: [videoItem],
    options,
  }
}

/**
 * ดาวน์โหลดวิดีโอ/เสียง YouTube (Default First + Sub-stage Progress + Metadata Reuse)
 */
export async function downloadYoutube(
  url: string,
  optionId: string,
  signal?: AbortSignal,
  onProgress?: (progress: number, stage: DownloadStage) => void,
  cachedMeta?: { title?: string; filename?: string }
): Promise<DownloadResult> {
  const isAudio = optionId.startsWith('audio_')

  let formatArgs: string[]
  let defaultExt: string
  let defaultContentType: string

  if (isAudio) {
    if (optionId === 'audio_wav') {
      defaultExt = 'wav'
      defaultContentType = 'audio/wav'
      formatArgs = ['-f', 'bestaudio/best', '-x', '--audio-format', 'wav', '--audio-quality', '0']
    } else if (optionId === 'audio_m4a') {
      defaultExt = 'm4a'
      defaultContentType = 'audio/mp4'
      formatArgs = ['-f', 'bestaudio/best', '-x', '--audio-format', 'm4a', '--audio-quality', '0']
    } else {
      defaultExt = 'mp3'
      defaultContentType = 'audio/mpeg'
      formatArgs = ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0']
    }
  } else {
    defaultExt = 'mp4'
    defaultContentType = 'video/mp4'
    const qMatch = optionId.match(/(\d+)p$/)
    if (qMatch) {
      const height = qMatch[1]
      formatArgs = [
        '-f',
        `bestvideo[height=${height}]+bestaudio[ext=m4a]/bestvideo[height=${height}]+bestaudio/best[height=${height}]/bestvideo[height=${height}]`,
        '--merge-output-format', 'mp4',
        '--postprocessor-args', 'Merger:-c:v copy -c:a aac -b:a 192k'
      ]
    } else {
      formatArgs = [
        '-f',
        'bestvideo+bestaudio[ext=m4a]/bestvideo+bestaudio/best',
        '--merge-output-format', 'mp4',
        '--postprocessor-args', 'Merger:-c:v copy -c:a aac -b:a 192k'
      ]
    }
  }

  // ใช้ Metadata เดิม (ไม่ spawn --get-title ซ้ำหากมีชื่ออยู่แล้ว)
  let baseTitle = cachedMeta?.title || ''
  if (!baseTitle) {
    try {
      const tp = Bun.spawn(getYtDlpArgs(['yt-dlp', '--get-title', '--no-playlist', url]), {
        stdout: 'pipe',
        stderr: 'pipe',
      })
      baseTitle = (await new Response(tp.stdout).text()).trim()
    } catch {}
  }
  baseTitle = baseTitle || 'youtube_download'

  const tempDir = await ensureTempDir()
  const uniqueId = Math.random().toString(36).substring(7)
  const outputTemplate = join(tempDir, `yt_${uniqueId}.%(ext)s`)

  // กลยุทธ์การดาวน์โหลด: Default Modern Client First
  const strategies = [
    // 1. Default Client (ใช้การต่อรองสตรีมที่ดีที่สุดของ yt-dlp เช่น visionos/web)
    {
      name: 'default',
      args: [
        'yt-dlp',
        '--newline',
        ...formatArgs,
        '-o', outputTemplate,
        '--no-playlist',
        '--socket-timeout', '30',
        '--retries', '2',
        '--force-overwrites',
        '--no-part',
        '--max-filesize', `${MAX_FILE_SIZE_MB}M`,
        url
      ]
    },
    // 2. Direct download without cookies (ป้องกันปัญหาคุกกี้หลุด/หมดอายุ/The page needs to be reloaded)
    {
      name: 'no-cookies',
      noCookies: true,
      args: [
        'yt-dlp',
        '--newline',
        ...formatArgs,
        '-o', outputTemplate,
        '--no-playlist',
        '--socket-timeout', '30',
        '--retries', '2',
        '--force-overwrites',
        '--no-part',
        '--max-filesize', `${MAX_FILE_SIZE_MB}M`,
        url
      ]
    },
    // 3. Fallback: Best combined format (เมื่อความละเอียดที่ระบุไม่พบ)
    {
      name: 'fallback-format',
      args: [
        'yt-dlp',
        '--newline',
        '-f', isAudio ? 'bestaudio/best' : 'bestvideo+bestaudio[ext=m4a]/best',
        ...(isAudio
          ? ['-x', '--audio-format', defaultExt]
          : ['--merge-output-format', 'mp4', '--postprocessor-args', 'Merger:-c:v copy -c:a aac -b:a 192k']),
        '-o', outputTemplate,
        '--no-playlist',
        '--socket-timeout', '30',
        '--force-overwrites',
        '--no-part',
        '--max-filesize', `${MAX_FILE_SIZE_MB}M`,
        url
      ]
    },
    // 4. Android client fallback
    {
      name: 'android',
      args: [
        'yt-dlp',
        '--newline',
        ...formatArgs,
        '-o', outputTemplate,
        '--no-playlist',
        '--socket-timeout', '30',
        '--retries', '2',
        '--force-overwrites',
        '--no-part',
        '--max-filesize', `${MAX_FILE_SIZE_MB}M`,
        '--extractor-args', 'youtube:player_client=android',
        url
      ]
    }
  ]

  let lastError = ''

  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i]

    if (signal?.aborted) {
      throw new AppError('DOWNLOAD_ABORTED', 'การดาวน์โหลดถูกยกเลิกโดยผู้ใช้งาน', 499)
    }

    log('info', `YouTube downloading [${strategy.name}] → ${baseTitle}`)
    onProgress?.(2, 'downloading')

    const skipCookies = (strategy as any).noCookies || strategy.args.includes('youtube:player_client=android') || strategy.args.includes('youtube:player_client=ios')
    const spawnArgs = skipCookies ? strategy.args : getYtDlpArgs(strategy.args)

    const proc = Bun.spawn(spawnArgs, {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })

    const onAbort = () => {
      killProcessTree(proc)
      cleanupPartialFiles(join(tempDir, `yt_${uniqueId}`)).catch(() => {})
    }
    if (signal) signal.addEventListener('abort', onAbort)

    const stdoutReader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let stdoutBuffer = ''
    let maxProgress = 2
    let streamCount = 0

    const readStdout = async () => {
      while (true) {
        const { done, value } = await stdoutReader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        stdoutBuffer += chunk

        // yt-dlp outputs progress updates with \r or \n
        const lines = stdoutBuffer.split(/[\r\n]+/)
        stdoutBuffer = lines.pop() || ''

        for (const line of lines) {
          if (line.includes('[download] Destination:')) {
            streamCount++
          }

          // 1. ตรวจจับ Fragment downloads ก่อน: เช่น "(frag 0/77)", "(frag 12/77)"
          const fragMatch = line.match(/\(frag\s+(\d+)\/(\d+)\)/i)
          if (fragMatch && onProgress) {
            const currentFrag = parseInt(fragMatch[1], 10)
            const totalFrags = parseInt(fragMatch[2], 10)
            if (totalFrags > 0) {
              const fragPct = Math.round((currentFrag / totalFrags) * 95)
              if (fragPct > maxProgress) {
                maxProgress = fragPct
                onProgress(Math.min(maxProgress, 98), 'downloading')
              }
              continue
            }
          }

          // 2. ตรวจจับ % ปกติ (เมื่อไม่มี frag)
          const dlMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/i)
          if (dlMatch && onProgress) {
            const rawPct = parseFloat(dlMatch[1])
            if (!isNaN(rawPct)) {
              let mappedPct = rawPct
              if (streamCount >= 2) {
                mappedPct = 85 + (rawPct * 0.1) // สตรีมที่สอง (เสียง) วิ่งช่วง 85% - 95%
              } else if (!isAudio) {
                mappedPct = rawPct * 0.85 // สตรีมแรก (วิดีโอ) วิ่งช่วง 0% - 85%
              }

              const rounded = Math.round(mappedPct)
              if (rounded > maxProgress) {
                maxProgress = rounded
                onProgress(Math.min(maxProgress, 98), 'downloading')
              }
            }
          } else if (line.includes('[Merger]') || line.includes('[ffmpeg] Merging')) {
            if (95 > maxProgress) maxProgress = 95
            onProgress?.(maxProgress, 'merging')
          } else if (line.includes('[ExtractAudio]') || line.includes('[FixupM3u8]')) {
            if (97 > maxProgress) maxProgress = 97
            onProgress?.(maxProgress, 'converting')
          }
        }
      }
    }

    let errorOutput = ''
    let exitCode = 0

    try {
      const [_, err] = await Promise.all([
        readStdout(),
        new Response(proc.stderr).text(),
      ])
      errorOutput = err
      exitCode = await proc.exited
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    // ตรวจสอบไฟล์จริงที่ output ออกมา
    const dirFiles = await readdir(tempDir)
    const matchingFile = dirFiles.find(f => f.startsWith(`yt_${uniqueId}.`))

    if (exitCode === 0 && matchingFile) {
      const actualFilePath = join(tempDir, matchingFile)
      const fileStat = await stat(actualFilePath)

      if (fileStat.size > 0) {
        const actualExt = matchingFile.split('.').pop()?.toLowerCase() || defaultExt
        const detectedMime = Bun.file(actualFilePath).type || defaultContentType
        const finalFilename = `${sanitizeFilename(baseTitle)}.${actualExt}`

        onProgress?.(100, 'ready')
        log('info', `✅ YouTube download succeeded (${(fileStat.size / 1024 / 1024).toFixed(1)} MB) [${actualExt}]`)

        return {
          filePath: actualFilePath,
          filename: finalFilename,
          contentType: detectedMime,
          fileSize: fileStat.size,
        }
      } else {
        try { await unlink(actualFilePath) } catch {}
      }
    }

    lastError = errorOutput
    const classified = classifyYtDlpError(errorOutput)

    // ตรวจสอบว่าควรลอง strategy ถัดไปหรือไม่
    if (i === 0) {
      if (classified.type === 'AUTH_REQUIRED' || classified.type === 'NOT_FOUND' || classified.type === 'RATE_LIMITED') {
        // ข้อผิดพลาดที่ไม่สามารถ bypass ด้วยการเปลี่ยน client ได้ -> หยุดทันที ไม่ลองต่อ
        throw new AppError(classified.type, classified.userMessage, classified.statusCode)
      }
      if (classified.type === 'FORMAT_UNAVAILABLE') {
        // ข้ามไป fallback format
        continue
      }
    }
  }

  const classified = classifyYtDlpError(lastError)
  throw new AppError(classified.type, classified.userMessage, classified.statusCode)
}

