const paths = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  next: 'M6 5.5v13l9-6.5zM16.5 5h2v14h-2z',
  prev: 'M18 5.5v13l-9-6.5zM5.5 5h2v14h-2z',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z',
  folder: 'M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.4l2 2H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5Z',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  mic: 'M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3ZM6 11.5a6 6 0 0 0 12 0M12 17.5V20',
  upload: 'M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19h14',
  grid: 'M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z',
  list: 'M4 6h16M4 12h16M4 18h16',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 20 20',
  volume: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  mute: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5',
  create: 'M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9ZM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8Z',
  library: 'M5 4.5v15M9.5 4.5v15M14 5l4.5 14.5',
  voice: 'M4 12h1.5M7.5 8.5v7M11 5v14M14.5 8v8M18 10.5v3M20.5 12H20',
  queue: 'M4 6h11M4 11h11M4 16h7M17.5 14v6M15 17h5',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.3 3h-4l-.3 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.3 2.6h4l.3-2.6a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z',
  stems: 'M4 7h16M4 12h10M4 17h13',
}

export type IconName = keyof typeof paths
const filled: IconName[] = ['play', 'pause', 'next', 'prev']

export function Icon({ name, size = 20, fill }: { name: IconName; size?: number; fill?: boolean }) {
  const solid = fill ?? filled.includes(name)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden
      fill={solid ? 'currentColor' : 'none'} stroke={solid ? 'none' : 'currentColor'}
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  )
}
