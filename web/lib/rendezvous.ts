import { createDecipheriv, createHash } from 'node:crypto'

// Must match server/src/rendezvous.ts
export function rendezvousTopic(secret: string): string {
  return 'bar' + createHash('sha256').update(`beeper-autoreply/topic/${secret}`).digest('hex').slice(0, 40)
}

export function openURL(secret: string, sealed: string): { url: string; ts: number } | null {
  try {
    const key = createHash('sha256').update(`beeper-autoreply/key/${secret}`).digest()
    const buf = Buffer.from(sealed.trim(), 'base64url')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(buf.length - 16)
    const ct = buf.subarray(12, buf.length - 16)
    const d = createDecipheriv('aes-256-gcm', key, iv)
    d.setAuthTag(tag)
    const out = JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'))
    if (typeof out?.url !== 'string' || !/^https:\/\//.test(out.url)) return null
    return { url: out.url, ts: Number(out.ts) || 0 }
  } catch {
    return null
  }
}

/** Parse ntfy's newline-delimited JSON poll output and return the newest URL we can decrypt. */
export function latestFromNtfy(secret: string, ndjson: string): string | null {
  let best: { url: string; ts: number } | null = null
  for (const line of ndjson.split('\n')) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line) as { event?: string; message?: string }
      if (ev.event !== 'message' || !ev.message) continue
      const opened = openURL(secret, ev.message)
      if (opened && (!best || opened.ts >= best.ts)) best = opened
    } catch { /* skip */ }
  }
  return best?.url ?? null
}

export async function findServerURL(secret: string): Promise<string | null> {
  if (process.env.VM_URL) return process.env.VM_URL
  const base = (process.env.NTFY_URL || 'https://ntfy.sh').replace(/\/+$/, '')
  const res = await fetch(`${base}/${rendezvousTopic(secret)}/json?poll=1&since=24h`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
  if (!res.ok) return null
  return latestFromNtfy(secret, await res.text())
}
