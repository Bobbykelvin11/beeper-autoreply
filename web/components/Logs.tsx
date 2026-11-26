'use client'
import { useEffect, useState } from 'react'
import { api, timeAgo } from '@/lib/client'
import { Card, ErrorNote } from './ui'

interface Log { ts: number; level: string; msg: string; chatID?: string }

export function Logs() {
  const [logs, setLogs] = useState<Log[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const load = () => api<{ logs: Log[] }>('logs').then(d => setLogs(d.logs)).catch(e => setError(e.message))
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [])
  return (
    <>
      <h1>Activity</h1>
      <ErrorNote error={error} />
      <Card>
        {logs?.length === 0 && <p className="muted">No activity yet.</p>}
        <ul className="logs">
          {logs?.map((l, i) => (
            <li key={i} className={l.level}>
              <small>{timeAgo(l.ts)}</small> {l.msg}
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
