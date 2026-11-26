'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Chat, type ChatMode } from '@/lib/client'
import { Card, ErrorNote, ModePicker, Toggle } from './ui'

export function Chats() {
  const [chats, setChats] = useState<Chat[] | null>(null)
  const [nts, setNts] = useState('')
  const [q, setQ] = useState('')
  const [onlyAllowed, setOnlyAllowed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback((refresh = false) => api<{ chats: Chat[]; noteToSelfChatID: string }>(`chats${refresh ? '?refresh=1' : ''}`).then(d => { setChats(d.chats); setNts(d.noteToSelfChatID) }).catch(e => setError(e.message)), [])
  useEffect(() => { load(true) }, [load])

  const shown = useMemo(() => (chats ?? []).filter(c => c.chatID !== nts && (!onlyAllowed || c.allowed) && (!q || `${c.title} ${c.network}`.toLowerCase().includes(q.toLowerCase()))), [chats, q, onlyAllowed, nts])

  async function update(c: Chat, patch: Partial<Chat>) {
    setError(null)
    setChats(list => list?.map(x => (x.chatID === c.chatID ? { ...x, ...patch } : x)) ?? null)
    try {
      await api(`chats/${encodeURIComponent(c.chatID)}`, 'PUT', patch)
    } catch (e) {
      setError((e as Error).message)
      load()
    }
  }

  return (
    <>
      <div className="toolbar">
        <h1>Chats</h1>
        <button className="link" onClick={() => load(true)}>Refresh</button>
      </div>
      <input className="search" placeholder="Search chats" value={q} onChange={e => setQ(e.target.value)} />
      <label className="check"><input type="checkbox" checked={onlyAllowed} onChange={e => setOnlyAllowed(e.target.checked)} /> Only allowed chats</label>
      <ErrorNote error={error} />
      {chats === null && <Card><p className="muted">Loading…</p></Card>}
      {chats?.length === 0 && <Card><p className="muted">No chats yet. Link Beeper and a chat network in the Link tab.</p></Card>}
      {shown.map(c => (
        <Card key={c.chatID}>
          <div className="chat-row">
            <button className="chat-title" onClick={() => setOpen(open === c.chatID ? null : c.chatID)}>
              <strong>{c.title || 'Untitled'}</strong>
              <small>{c.network}{c.type === 'group' ? ' · group' : ''}</small>
            </button>
            <Toggle checked={c.allowed} onChange={v => update(c, { allowed: v })} label={`Allow ${c.title}`} />
          </div>
          {c.allowed && (
            <ModePicker<ChatMode> value={c.mode} options={[['default', 'Default'], ['approve', 'Approve'], ['auto', 'Automatic']]} onChange={v => update(c, { mode: v })} />
          )}
          {open === c.chatID && (
            <textarea placeholder="Extra instructions for this chat, e.g. 'This is my mom, be sweet, reply in Yoruba'" defaultValue={c.instructions} rows={3} onBlur={e => e.target.value !== c.instructions && update(c, { instructions: e.target.value })} />
          )}
        </Card>
      ))}
    </>
  )
}
