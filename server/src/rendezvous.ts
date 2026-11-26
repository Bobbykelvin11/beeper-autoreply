import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Encrypted "where is my server" rendezvous.
 * Cloudflare quick tunnels get a new random URL on every restart, so the worker publishes its
 * current URL, AES-256-GCM encrypted with a key derived from CONTROL_SECRET, to a ntfy topic whose
 * name is also derived from the secret. The control page derives the same topic/key and decrypts.
 * ntfy only ever sees random-looking ciphertext.
 */
export function rendezvousTopic(secret: string): string {
  return 'bar' + createHash('sha256').update(`beeper-autoreply/topic/${secret}`).digest('hex').slice(0, 40)
}

function key(secret: string): Buffer {
  return createHash('sha256').update(`beeper-autoreply/key/${secret}`).digest()
}

export function sealURL(secret: string, url: string, ts = Date.now()): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify({ url, ts }), 'utf8'), cipher.final()])
  return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64url')
}

export function openURL(secret: string, sealed: string): { url: string; ts: number } | null {
  try {
    const buf = Buffer.from(sealed, 'base64url')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(buf.length - 16)
    const ct = buf.subarray(12, buf.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', key(secret), iv)
    decipher.setAuthTag(tag)
    const out = JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8'))
    if (typeof out?.url !== 'string') return null
    return { url: out.url, ts: Number(out.ts) || 0 }
  } catch {
    return null
  }
}

export async function publishURL(ntfyBase: string, secret: string, url: string): Promise<void> {
  const res = await fetch(`${ntfyBase.replace(/\/+$/, '')}/${rendezvousTopic(secret)}`, {
    method: 'POST',
    body: sealURL(secret, url),
    headers: { 'Cache': 'yes', 'Title': 'beeper-autoreply' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`)
}

/** Ask cloudflared's metrics server for the current quick tunnel hostname. */
export async function discoverQuickTunnel(metricsAddr: string): Promise<string | null> {
  try {
    const res = await fetch(`http://${metricsAddr}/quicktunnel`, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return null
    const data = (await res.json()) as { hostname?: string }
    return data.hostname ? `https://${data.hostname}` : null
  } catch {
    return null
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}
