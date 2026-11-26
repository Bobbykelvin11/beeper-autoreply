'use client'
import { useEffect, useState } from 'react'
import { api, type Settings } from '@/lib/client'
import { Card, ErrorNote, ModePicker, Row, Toggle } from './ui'

interface Preset { id: string; label: string; baseURL: string; model: string; needsKey: boolean }

export function SettingsView({ onSignOut }: { onSignOut: () => void }) {
  const [s, setS] = useState<Settings | null>(null)
  const [presets, setPresets] = useState<Preset[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [test, setTest] = useState<string | null>(null)

  useEffect(() => {
    api<{ settings: Settings; presets: Preset[] }>('settings').then(d => { setS(d.settings); setPresets(d.presets) }).catch(e => setError(e.message))
  }, [])

  if (!s) return <Card><p className="muted">{error ?? 'Loading…'}</p></Card>
  const set = (patch: (x: Settings) => Settings) => { setS(patch(s)); setSaved(false) }

  async function save() {
    setError(null)
    try {
      const d = await api<{ settings: Settings }>('settings', 'PUT', s)
      setS(d.settings)
      setSaved(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function testAI() {
    setTest('Thinking…')
    try {
      await save()
      const d = await api<{ reply: string | null; raw: string }>('test-ai', 'POST', { text: 'hey! are we still meeting later?' })
      setTest(d.reply ?? `(AI chose to skip) ${d.raw}`)
    } catch (e) {
      setTest(`Error: ${(e as Error).message}`)
    }
  }

  const num = (v: string) => Number(v)
  return (
    <>
      <h1>Settings</h1>
      <Card title="Who it replies to">
        <Row label="Default mode" hint="Per-chat modes override this">
          <ModePicker value={s.defaultMode} options={[['approve', 'Approve'], ['auto', 'Automatic']]} onChange={v => set(x => ({ ...x, defaultMode: v }))} />
        </Row>
        <Row label="All direct chats" hint="Reply in any 1-to-1 chat, not just allowed ones"><Toggle checked={s.allowAllDirectChats} onChange={v => set(x => ({ ...x, allowAllDirectChats: v }))} /></Row>
        <Row label="Group chats" hint="Allowed groups only"><Toggle checked={s.allowGroups} onChange={v => set(x => ({ ...x, allowGroups: v }))} /></Row>
      </Card>
      <Card title="Your voice">
        <label className="field"><span>Persona</span><textarea rows={4} value={s.persona} onChange={e => set(x => ({ ...x, persona: e.target.value }))} /></label>
        <label className="field"><span>Reply style</span><textarea rows={3} value={s.style} onChange={e => set(x => ({ ...x, style: e.target.value }))} /></label>
        <Row label="Add a tag" hint={`Adds “${s.autoTag.trim()}” to auto replies`}><Toggle checked={s.addAutoTag} onChange={v => set(x => ({ ...x, addAutoTag: v }))} /></Row>
        {s.addAutoTag && <input value={s.autoTag} onChange={e => set(x => ({ ...x, autoTag: e.target.value }))} />}
        <Row label="Messages of context"><input type="number" min={2} max={60} value={s.historyCount} onChange={e => set(x => ({ ...x, historyCount: num(e.target.value) }))} /></Row>
      </Card>
      <Card title="AI provider">
        <div className="presets">
          {presets.map(p => (
            <button key={p.id} className={`secondary ${s.provider.baseURL === p.baseURL ? 'active' : ''}`} onClick={() => set(x => ({ ...x, provider: { ...x.provider, baseURL: p.baseURL, model: p.model } }))}>{p.label}</button>
          ))}
        </div>
        <label className="field"><span>Base URL (OpenAI-compatible)</span><input value={s.provider.baseURL} onChange={e => set(x => ({ ...x, provider: { ...x.provider, baseURL: e.target.value } }))} /></label>
        <label className="field"><span>Model</span><input value={s.provider.model} onChange={e => set(x => ({ ...x, provider: { ...x.provider, model: e.target.value } }))} /></label>
        <label className="field"><span>API key (stored only on your server)</span><input type="password" placeholder="not needed for Ollama" value={s.provider.apiKey} onChange={e => set(x => ({ ...x, provider: { ...x.provider, apiKey: e.target.value } }))} /></label>
        <Row label="Creativity"><input type="number" step={0.1} min={0} max={1.5} value={s.provider.temperature} onChange={e => set(x => ({ ...x, provider: { ...x.provider, temperature: num(e.target.value) } }))} /></Row>
        <button className="secondary wide" onClick={testAI}>Test with a sample message</button>
        {test && <p className="reply">{test}</p>}
      </Card>
      <Card title="Quiet hours">
        <Row label="Enabled"><Toggle checked={s.quietHours.enabled} onChange={v => set(x => ({ ...x, quietHours: { ...x.quietHours, enabled: v } }))} /></Row>
        <Row label="From"><input type="time" value={s.quietHours.start} onChange={e => set(x => ({ ...x, quietHours: { ...x.quietHours, start: e.target.value } }))} /></Row>
        <Row label="Until"><input type="time" value={s.quietHours.end} onChange={e => set(x => ({ ...x, quietHours: { ...x.quietHours, end: e.target.value } }))} /></Row>
        <label className="field"><span>Time zone</span><input value={s.quietHours.timeZone} onChange={e => set(x => ({ ...x, quietHours: { ...x.quietHours, timeZone: e.target.value } }))} /></label>
        <Row label="During quiet hours">
          <ModePicker value={s.quietHours.behavior} options={[['hold-for-approval', 'Hold for me'], ['skip', "Don't reply"]]} onChange={v => set(x => ({ ...x, quietHours: { ...x.quietHours, behavior: v } }))} />
        </Row>
      </Card>
      <Card title="Human-like timing & limits">
        <Row label="Wait for more messages (s)"><input type="number" min={0} value={s.delay.debounceSeconds} onChange={e => set(x => ({ ...x, delay: { ...x.delay, debounceSeconds: num(e.target.value) } }))} /></Row>
        <Row label="Min delay (s)"><input type="number" min={0} value={s.delay.minSeconds} onChange={e => set(x => ({ ...x, delay: { ...x.delay, minSeconds: num(e.target.value) } }))} /></Row>
        <Row label="Max delay (s)"><input type="number" min={0} value={s.delay.maxSeconds} onChange={e => set(x => ({ ...x, delay: { ...x.delay, maxSeconds: num(e.target.value) } }))} /></Row>
        <Row label="Show typing…"><Toggle checked={s.delay.typing} onChange={v => set(x => ({ ...x, delay: { ...x.delay, typing: v } }))} /></Row>
        <Row label="Max per chat / hour"><input type="number" min={0} value={s.rateLimits.perChatPerHour} onChange={e => set(x => ({ ...x, rateLimits: { ...x.rateLimits, perChatPerHour: num(e.target.value) } }))} /></Row>
        <Row label="Max total / hour"><input type="number" min={0} value={s.rateLimits.globalPerHour} onChange={e => set(x => ({ ...x, rateLimits: { ...x.rateLimits, globalPerHour: num(e.target.value) } }))} /></Row>
        <Row label="Min gap per chat (s)"><input type="number" min={0} value={s.rateLimits.minGapSecondsPerChat} onChange={e => set(x => ({ ...x, rateLimits: { ...x.rateLimits, minGapSecondsPerChat: num(e.target.value) } }))} /></Row>
        <p className="muted small">WhatsApp and Instagram ban accounts for spammy automation. Keep limits low.</p>
      </Card>
      <Card title="Approve from Beeper">
        <Row label="Use “Note to self”" hint="Drafts arrive there; reply ok/no/edit + code"><Toggle checked={s.noteToSelf.enabled} onChange={v => set(x => ({ ...x, noteToSelf: { ...x.noteToSelf, enabled: v } }))} /></Row>
        <label className="field"><span>Note to self chat ID (leave empty to auto-detect)</span><input value={s.noteToSelf.chatID} onChange={e => set(x => ({ ...x, noteToSelf: { ...x.noteToSelf, chatID: e.target.value } }))} /></label>
        <Row label="Drafts expire after (h)"><input type="number" min={1} value={s.draftTTLHours} onChange={e => set(x => ({ ...x, draftTTLHours: num(e.target.value) }))} /></Row>
      </Card>
      <div className="sticky-save">
        <ErrorNote error={error} />
        <button className="primary wide" onClick={save}>{saved ? 'Saved ✓' : 'Save settings'}</button>
      </div>
      <button className="link center-block" onClick={onSignOut}>Sign out of this page</button>
    </>
  )
}
