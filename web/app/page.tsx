'use client'
import { useEffect, useState } from 'react'
import { Login } from '@/components/Login'
import { Home } from '@/components/Home'
import { Drafts } from '@/components/Drafts'
import { Chats } from '@/components/Chats'
import { Link } from '@/components/Link'
import { SettingsView } from '@/components/SettingsView'
import { Logs } from '@/components/Logs'

const TABS: Array<[string, string, string]> = [
  ['home', 'Home', '⌂'],
  ['drafts', 'Approve', '✓'],
  ['chats', 'Chats', '💬'],
  ['link', 'Link', '🔗'],
  ['settings', 'Settings', '⚙'],
  ['logs', 'Activity', '≡'],
]

export default function Page() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [tab, setTab] = useState('home')

  useEffect(() => {
    fetch('/api/session', { cache: 'no-store' }).then(r => r.json()).then(d => setSignedIn(!!d.signedIn)).catch(() => setSignedIn(false))
  }, [])

  useEffect(() => {
    // any 401 from the proxy means the cookie is gone
    const orig = window.fetch
    window.fetch = async (...args) => {
      const res = await orig(...args)
      const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url
      if (res.status === 401 && url.includes('/api/vm/')) {
        const body = await res.clone().json().catch(() => ({}))
        if (body.error === 'Signed out') setSignedIn(false)
      }
      return res
    }
    return () => { window.fetch = orig }
  }, [])

  async function signOut() {
    await fetch('/api/session', { method: 'DELETE' })
    setSignedIn(false)
  }

  if (signedIn === null) return <main className="app"><p className="muted center">Loading…</p></main>
  if (!signedIn) return <Login onDone={() => setSignedIn(true)} />

  return (
    <div className="shell">
      <main className="app">
        {tab === 'home' && <Home go={setTab} />}
        {tab === 'drafts' && <Drafts />}
        {tab === 'chats' && <Chats />}
        {tab === 'link' && <Link />}
        {tab === 'settings' && <SettingsView onSignOut={signOut} />}
        {tab === 'logs' && <Logs />}
      </main>
      <nav className="tabs">
        {TABS.map(([id, label, icon]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <span aria-hidden>{icon}</span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
