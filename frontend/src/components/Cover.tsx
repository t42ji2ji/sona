import type { CSSProperties } from 'react'

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** 單色封面：灰階斜向漸層，id 決定角度、hue 只留一點點色溫，同一首永遠一樣 */
export function Cover({ id, hue, className = '', style }: { id: string; hue: number; className?: string; style?: CSSProperties }) {
  const r = hash(id)
  const background = `linear-gradient(${r % 360}deg, hsl(${hue} 6% 22%), hsl(${hue} 4% 9%))`
  return <div className={`cover ${className}`} style={{ background, ...style }} />
}
