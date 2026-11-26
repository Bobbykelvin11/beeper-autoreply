import { ImageResponse } from 'next/og'

// App icons are drawn at request time so the repo has no binary files.
const SIZES = new Set([180, 192, 512])

export const dynamic = 'force-static'
export function generateStaticParams() {
  return [...SIZES].map(size => ({ size: String(size) }))
}

export async function GET(_req: Request, ctx: { params: Promise<{ size: string }> }) {
  const { size: raw } = await ctx.params
  const size = SIZES.has(Number(raw)) ? Number(raw) : 192
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#0f1115' }}>
        <svg width={size} height={size} viewBox="0 0 100 100">
          <path d="M26 18 H74 Q86 18 86 30 V62 Q86 74 74 74 H46 L30 88 V74 H26 Q14 74 14 62 V30 Q14 18 26 18 Z" fill="#7c5cff" />
          <path d="M55 26 L38 50 H50 L45 66 L63 42 H51 Z" fill="#ffffff" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  )
}
