import { NextResponse, type NextRequest } from 'next/server'
import { findServerURL } from '@/lib/rendezvous'
import { COOKIE, cookieOptions, seal, unseal } from '@/lib/session'
import { clientIPOf, vmFetch } from '@/lib/vm'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const session = unseal(req.cookies.get(COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'Signed out' }, { status: 401 })
  const { path } = await ctx.params
  const target = '/api/' + path.map(encodeURIComponent).join('/') + req.nextUrl.search
  const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.text()
  const init: RequestInit = { method: req.method, body }

  let vmURL = session.vmURL
  let upstream: Response | null = null
  try {
    upstream = await vmFetch(vmURL, session.secret, target, init, clientIPOf(req))
  } catch {
    upstream = null
  }
  // Quick-tunnel URLs change when the server restarts: look the new one up and retry once.
  if (!upstream || upstream.status === 502 || upstream.status === 530 || upstream.status === 404 && !(upstream.headers.get('content-type') ?? '').includes('json')) {
    const fresh = await findServerURL(session.secret).catch(() => null)
    if (fresh && fresh !== vmURL) {
      vmURL = fresh
      try {
        upstream = await vmFetch(vmURL, session.secret, target, init, clientIPOf(req))
      } catch {
        upstream = null
      }
    }
  }
  if (!upstream) return NextResponse.json({ error: 'Your server is not reachable right now' }, { status: 502 })
  const text = await upstream.text()
  const res = new NextResponse(text, { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' } })
  if (vmURL !== session.vmURL) res.cookies.set(COOKIE, seal({ secret: session.secret, vmURL }), cookieOptions)
  return res
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE }
