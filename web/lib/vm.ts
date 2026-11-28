import { findServerURL } from './rendezvous'

export async function vmFetch(vmURL: string, secret: string, path: string, init: RequestInit = {}, clientIP?: string): Promise<Response> {
  const headers = new Headers(init.headers)
  // The VM API sits on a private network; it rate-limits wrong keys per real client address.
  if (clientIP) headers.set('X-Forwarded-For', clientIP)
  headers.set('Authorization', `Bearer ${secret}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(vmURL.replace(/\/+$/, '') + path, { ...init, headers, cache: 'no-store', signal: AbortSignal.timeout(60_000) })
}

/** Find the server for this access key and check the key works. */
export function clientIPOf(req: { headers: Headers }): string | undefined {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined
}

export async function connect(secret: string, manualURL?: string, clientIP?: string): Promise<{ vmURL: string } | { error: string; status: number }> {
  // All-in-one deployment: VM_URL is fixed by the operator, so a user-supplied address is ignored.
  const fixed = process.env.VM_URL
  const vmURL = fixed || manualURL?.trim() || (await findServerURL(secret).catch(() => null))
  if (!vmURL) return { error: "Couldn't find your server. Check the access key, or wait 2 minutes after the server starts.", status: 404 }
  if (!fixed && !/^https:\/\//.test(vmURL) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(vmURL) && process.env.NODE_ENV === 'production') return { error: 'Server URL must start with https://', status: 400 }
  try {
    const res = await vmFetch(vmURL, secret, '/api/status', {}, clientIP)
    if (res.status === 401) return { error: 'Wrong access key', status: 401 }
    if (!res.ok) return { error: `Server answered HTTP ${res.status}`, status: 502 }
    return { vmURL }
  } catch {
    return { error: 'Your server is not reachable right now. Is the VM running?', status: 502 }
  }
}
