import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const COOKIE = 'bar_session'
const MAX_AGE_S = 60 * 60 * 24 * 30

export interface Session {
  secret: string
  vmURL: string
  exp: number
}

let devKey: Buffer | null = null

function key(): Buffer {
  const k = process.env.SESSION_KEY
  if (k && k.length >= 16) return createHash('sha256').update(k).digest()
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_KEY is not set on this deployment')
  devKey ??= randomBytes(32)
  return devKey
}

export function seal(s: Omit<Session, 'exp'>, now = Date.now()): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([c.update(JSON.stringify({ ...s, exp: now + MAX_AGE_S * 1000 }), 'utf8'), c.final()])
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64url')
}

export function unseal(token: string | undefined, now = Date.now()): Session | null {
  if (!token) return null
  try {
    const buf = Buffer.from(token, 'base64url')
    const d = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12))
    d.setAuthTag(buf.subarray(buf.length - 16))
    const s = JSON.parse(Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8')) as Session
    if (!s.secret || !s.vmURL || s.exp < now) return null
    return s
  } catch {
    return null
  }
}

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: MAX_AGE_S,
}
