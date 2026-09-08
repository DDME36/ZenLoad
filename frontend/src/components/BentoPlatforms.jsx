import React, { memo } from 'react'
import {
  Youtube,
  Instagram,
  Facebook,
  Music2,
  Twitter,
  Cloud,
  Sparkles,
  Video,
  Image,
  Film,
  User,
  Zap,
  ShieldCheck,
  Layers,
} from 'lucide-react'

const BENTO_FEATURES = [
  {
    id: 'tiktok',
    name: 'TikTok',
    icon: Music2,
    brandColor: '#00f2ea',
    glowColor: 'rgba(0, 242, 234, 0.22)',
    borderColor: 'rgba(0, 242, 234, 0.4)',
    gradient: 'linear-gradient(135deg, rgba(0, 242, 234, 0.12), rgba(255, 0, 79, 0.10))',
    mediaTypes: [
      { icon: Video, label: 'วิดีโอ' },
      { icon: Image, label: 'รูปภาพ' },
      { icon: Music2, label: 'เสียงเพลง' },
    ],
  },
  {
    id: 'youtube',
    name: 'YouTube',
    icon: Youtube,
    brandColor: '#ff2d55',
    glowColor: 'rgba(255, 45, 85, 0.22)',
    borderColor: 'rgba(255, 45, 85, 0.4)',
    gradient: 'linear-gradient(135deg, rgba(239, 68, 68, 0.12), rgba(185, 28, 28, 0.05))',
    mediaTypes: [
      { icon: Video, label: 'วิดีโอ 4K' },
      { icon: Music2, label: 'เสียง MP3' },
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: Instagram,
    brandColor: '#e1306c',
    glowColor: 'rgba(225, 48, 108, 0.22)',
    borderColor: 'rgba(225, 48, 108, 0.4)',
    gradient: 'linear-gradient(135deg, rgba(236, 72, 153, 0.12), rgba(249, 115, 22, 0.08))',
    mediaTypes: [
      { icon: Film, label: 'Reels' },
      { icon: Image, label: 'รูปภาพ' },
      { icon: User, label: 'โปรไฟล์' },
    ],
  },
  {
    id: 'facebook',
    name: 'Facebook',
    icon: Facebook,
    brandColor: '#1877f2',
    glowColor: 'rgba(24, 119, 242, 0.22)',
    borderColor: 'rgba(24, 119, 242, 0.4)',
    gradient: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(29, 78, 216, 0.05))',
    mediaTypes: [
      { icon: Video, label: 'วิดีโอ' },
      { icon: Film, label: 'Reels' },
      { icon: User, label: 'โปรไฟล์' },
    ],
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    icon: Cloud,
    brandColor: '#ff5500',
    glowColor: 'rgba(255, 85, 0, 0.22)',
    borderColor: 'rgba(255, 85, 0, 0.4)',
    gradient: 'linear-gradient(135deg, rgba(249, 115, 22, 0.12), rgba(194, 65, 12, 0.05))',
    mediaTypes: [
      { icon: Music2, label: 'เพลง HQ' },
      { icon: Image, label: 'ภาพปก' },
    ],
  },
  {
    id: 'twitter',
    name: 'X (Twitter)',
    icon: Twitter,
    brandColor: '#1d9bf0',
    glowColor: 'rgba(29, 155, 240, 0.22)',
    borderColor: 'rgba(29, 155, 240, 0.4)',
    gradient: 'linear-gradient(135deg, rgba(56, 189, 248, 0.12), rgba(2, 132, 199, 0.05))',
    mediaTypes: [
      { icon: Video, label: 'วิดีโอ' },
      { icon: Film, label: 'GIF / ภาพ' },
    ],
  },
]

function BentoPlatforms() {
  return (
    <section className="zen-bento-section" aria-labelledby="bento-heading">
      <div className="zen-bento-header">
        <h2 id="bento-heading" className="zen-bento-title">
          <Sparkles size={16} className="zen-bento-sparkle text-purple" aria-hidden="true" />
          <span>สื่อทุกรูปแบบ ครอบคลุมทุกแพลตฟอร์ม</span>
        </h2>
        <p className="zen-bento-subtitle">
          ดาวน์โหลดวิดีโอ รูปภาพ และเสียงต้นฉบับได้ทันที
        </p>
      </div>

      <div className="zen-bento-grid">
        {BENTO_FEATURES.map((feat, idx) => {
          const Icon = feat.icon
          return (
            <article
              key={feat.id}
              className={`zen-bento-card zen-bento-card--${feat.id}`}
              style={{
                '--card-gradient': feat.gradient,
                '--card-border-hover': feat.borderColor,
                '--card-glow': feat.glowColor,
                '--brand-color': feat.brandColor,
                '--stagger-delay': `${idx * 0.07}s`,
              }}
            >
              <div className="zen-bento-card__top">
                <div
                  className="zen-bento-card__icon-wrap"
                  style={{ color: feat.brandColor }}
                >
                  <Icon size={20} aria-hidden="true" />
                </div>
                <h3 className="zen-bento-card__name">{feat.name}</h3>
              </div>

              <div className="zen-bento-card__media-row">
                {feat.mediaTypes.map((item, i) => {
                  const MediaIcon = item.icon
                  return (
                    <span key={i} className="zen-media-chip" title={`${feat.name}: ${item.label}`}>
                      <MediaIcon size={13} className="zen-media-chip__icon" aria-hidden="true" />
                      <span className="zen-media-chip__label">{item.label}</span>
                    </span>
                  )
                })}
              </div>
            </article>
          )
        })}
      </div>

      <div className="zen-bento-footer">
        <div className="zen-bento-perk">
          <Zap size={14} className="zen-bento-perk__icon text-purple" aria-hidden="true" />
          <span>เซิร์ฟเวอร์สตรีมตรง ไม่บีบอัดซ้ำ</span>
        </div>
        <div className="zen-bento-perk">
          <ShieldCheck size={14} className="zen-bento-perk__icon text-purple" aria-hidden="true" />
          <span>ปลอดภัย 100% ไม่มีโฆษณาสแปม</span>
        </div>
        <div className="zen-bento-perk">
          <Layers size={14} className="zen-bento-perk__icon text-purple" aria-hidden="true" />
          <span>รองรับ PWA ติดตั้งใช้งานเหมือนแอปจริง</span>
        </div>
      </div>
    </section>
  )
}

export default memo(BentoPlatforms)

