'use client'
import { useState } from 'react'

export function Login({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState('')
  const [url, setUrl] = useState('')
  const [showUrl, setShowUrl] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessKey: key, vmURL: url || undefined }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sign-in failed')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <img src="/icons/192" alt="" width={72} height={72} />
      <h1>Auto-Reply</h1>
      <p className="muted">Enter the access key you chose when you created your server.</p>
      <form onSubmit={submit}>
        <input type="password" autoComplete="current-password" placeholder="Access key" value={key} onChange={e => setKey(e.target.value)} />
        {showUrl ? (
          <input type="url" placeholder="https://…trycloudflare.com (optional)" value={url} onChange={e => setUrl(e.target.value)} />
        ) : (
          <button type="button" className="link" onClick={() => setShowUrl(true)}>I have a server address</button>
        )}
        <button className="primary" disabled={busy || key.length < 12}>{busy ? 'Connecting…' : 'Sign in'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="muted small">Tip: in Safari tap Share → Add to Home Screen to use this like an app.</p>
    </main>
  )
}
