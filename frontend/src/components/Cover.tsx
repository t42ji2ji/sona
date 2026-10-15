import type { CSSProperties } from 'react'

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** 依 hue 生成的 mesh gradient 封面；id 決定光斑位置，同一首永遠一樣 */
export function Cover({ id, hue, className = '', style }: { id: string; hue: number; className?: string; style?: CSSProperties }) {
  const r = hash(id)
  const at = (k: number) => `${(r >>> (k * 4)) % 90 + 5}% ${(r >>> (k * 4 + 2)) % 90 + 5}%`
  const background = [
    `radial-gradient(at ${at(0)}, hsl(${hue} 90% 64%) 0, transparent 55%)`,
    `radial-gradient(at ${at(1)}, hsl(${hue + 48} 95% 58%) 0, transparent 50%)`,
    `radial-gradient(at ${at(2)}, hsl(${hue - 42} 85% 50%) 0, transparent 58%)`,
    `radial-gradient(at ${at(3)}, hsl(${hue + 160} 70% 55% / .55) 0, transparent 40%)`,
    `linear-gradient(${r % 360}deg, hsl(${hue - 20} 60% 16%), hsl(${hue + 30} 70% 8%))`,
  ].join(',')
  return <div className={`cover ${className}`} style={{ background, ...style }} />
}
