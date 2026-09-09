// ===== Platform Types =====
export type Platform =
  | 'youtube'
  | 'instagram'
  | 'facebook'
  | 'soundcloud'
  | 'tiktok'
  | 'twitter'
  | 'reddit'
  | 'vimeo'
  | 'dailymotion'
  | 'twitch'
  | 'direct'
  | 'unknown'

export type MediaKind = 'video' | 'audio' | 'image'

export type ContentType =
  | 'video'
  | 'audio'
  | 'image'
  | 'profile'
  | 'post'
  | 'reel'
  | 'watch'
  | 'album'
  | 'story'
  | 'playlist'
  | 'unknown'

export type DownloadStage =
  | 'queued'
  | 'downloading'
  | 'merging'
  | 'converting'
  | 'ready'

export interface DetectedUrl {
  platform: Platform
  contentType: ContentType
  originalUrl: string
  identifier: string
}

// ===== Media Item & Info (returned by /api/analyze) =====
export interface MediaItem {
  id: string
  kind: MediaKind
  title?: string
  thumbnail?: string
  url?: string
  duration?: number
  options: DownloadOption[]
}

export interface MediaInfo {
  platform: Platform
  contentType?: ContentType
  title: string
  author?: string
  uploader?: string
  thumbnail?: string
  description?: string
  items: MediaItem[]
  options: DownloadOption[] // Top-level options for backward compatibility
}

export interface DownloadOption {
  id: string
  label: string
  format: string
  quality?: string
  fileSize?: string
}

// ===== Download Result (internal) =====
export interface DownloadResult {
  redirectUrl?: string
  filePath?: string
  stream?: ReadableStream
  filename: string
  contentType: string
  fileSize?: number
  cleanup?: () => Promise<void>
}

// ===== API Response =====
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    suggestion?: string
  }
}
