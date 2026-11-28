import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE, cookieOptions, seal, unseal } from '@/lib/session'
import { clientIPOf, connect } from '@/lib/vm'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const s = unseal(req.cookies.get(COOKIE)?.value)
  return NextResponse.json({ signedIn: !!s, vmURL: s?.vmURL ?? null })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { accessKey?: string; vmURL?: string }
  const secret = String(body.accessKey ?? '').trim()
  if (secret.length < 12) return NextResponse.json({ error: 'Access key must be at least 12 characters' }, { status: 400 })
  const result = await connect(secret, body.vmURL, clientIPOf(req))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  const res = NextResponse.json({ ok: true, vmURL: result.vmURL })
  res.cookies.set(COOKIE, seal({ secret, vmURL: result.vmURL }), cookieOptions)
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE, '', { ...cookieOptions, maxAge: 0 })
  return res
}
