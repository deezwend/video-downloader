import { useState } from 'react'
import { Film, Music } from 'lucide-react'
import type { MediaKind } from '../../../shared/types'
import { formatDuration } from '../format'

interface Props {
  src: string | null
  kind?: MediaKind
  duration?: number | null
}

export default function Thumb({ src, kind = 'video', duration }: Props) {
  const [failed, setFailed] = useState(false)
  const Icon = kind === 'audio' ? Music : Film
  return (
    <div className="thumb">
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <Icon size={20} />
      )}
      {duration ? <span className="duration">{formatDuration(duration)}</span> : null}
    </div>
  )
}
