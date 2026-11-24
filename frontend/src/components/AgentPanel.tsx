import { useEffect, useRef, useState } from 'react'
import { api } from '../api.ts'
import { useT } from '../i18n.ts'
import { useEnter } from '../ime.ts'
import { report, useApp } from '../store.ts'
import { Icon } from './Icon.tsx'

export type Proposal = { style?: string; lyrics?: string; title?: string }
type Msg = { role: 'user' | 'assistant'; text: string; done?: 'applied' | 'ignored' }
type Tool = 'claude' | 'codex'

const KEY = 'sona.agent'
const BLOCK = /```sona\s*([\s\S]*?)(```|$)/

/** 回覆裡的 ```sona 區塊是提案，畫面上不顯示原文 */
function parse(text: string): { say: string; proposal: Proposal | null } {
  const m = text.match(BLOCK)
  if (!m) return { say: text.trim(), proposal: null }
  let proposal: Proposal | null = null
  try { proposal = JSON.parse(m[1]) } catch { /* 還在串流或格式壞掉 */ }
  return { say: text.slice(0, m.index).trim(), proposal }
}

export function AgentPanel({ mode, form, onApply, onClose }: {
  mode: string
  form: Proposal
  onApply: (p: Proposal) => void
  onClose: () => void
}) {
  const t = useT()
  const ai = useApp((s) => s.system?.ai_tools)
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] } })
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [tool, setTool] = useState<Tool>(() => (localStorage.getItem('sona.agentTool') as Tool) || (ai?.claude ? 'claude' : 'codex'))
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => { if (!busy) localStorage.setItem(KEY, JSON.stringify(msgs)) }, [msgs, busy])
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }) }, [msgs])

  const pickTool = (x: Tool) => { setTool(x); localStorage.setItem('sona.agentTool', x) }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    const history: Msg[] = [...msgs, { role: 'user', text }]
    setMsgs([...history, { role: 'assistant', text: '' }])
    setInput('')
    setBusy(true)
    try {
      await api.assist({ messages: history.map(({ role, text }) => ({ role, text })), mode, form, tool }, (d) =>
        setMsgs((m) => [...m.slice(0, -1), { role: 'assistant', text: m[m.length - 1].text + d }]))
    } catch (e) {
      report(e)
      setMsgs((m) => (m[m.length - 1].text ? m : m.slice(0, -1)))
    } finally { setBusy(false) }
  }
  const enter = useEnter(send)

  const mark = (i: number, done: Msg['done']) => setMsgs((m) => m.map((x, j) => (j === i ? { ...x, done } : x)))

  return (
    <aside className="agent">
      <header className="agent-head">
        <button className="icon-btn" title={t('agent.new')} disabled={busy || !msgs.length} onClick={() => setMsgs([])}>
          <Icon name="plus" size={18} />
        </button>
        {ai?.claude && ai?.codex && (
          <div className="segmented small">
            <button className={tool === 'claude' ? 'on' : ''} onClick={() => pickTool('claude')}>Claude Code</button>
            <button className={tool === 'codex' ? 'on' : ''} onClick={() => pickTool('codex')}>Codex</button>
          </div>
        )}
        <span className="grow" />
        <button className="icon-btn" title={t('agent.close')} onClick={onClose}><Icon name="x" size={18} /></button>
      </header>
      <div className="agent-list scroll" ref={list}>
        {msgs.map((m, i) => {
          if (m.role === 'user') return <div key={i} className="bubble">{m.text}</div>
          const { say, proposal } = parse(m.text)
          const last = i === msgs.length - 1
          return (
            <div key={i} className="agent-msg">
              {say && <p>{say}</p>}
              {last && busy && <div className="thinking" aria-label={t('agent.thinking')}><span /><span /><span /></div>}
              {proposal && !(last && busy) && (
                <div className="proposal">
                  {proposal.title && <Field label={t('create.title')} value={proposal.title} />}
                  {proposal.style && <Field label={t('create.style')} value={proposal.style} />}
                  {proposal.lyrics && <Field label={t('create.lyrics')} value={proposal.lyrics} lyrics />}
                  {m.done ? <div className="muted small">{t(m.done === 'applied' ? 'agent.applied' : 'agent.ignored')}</div> : (
                    <div className="proposal-actions">
                      <button className="btn small" onClick={() => { onApply(proposal); mark(i, 'applied') }}>{t('voice.apply')}</button>
                      <button className="btn ghost small" onClick={() => mark(i, 'ignored')}>{t('voice.ignore')}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="agent-input">
        <textarea className="input" rows={3} value={input} placeholder={t('agent.ph')}
          onChange={(e) => setInput(e.target.value)} {...enter} />
        <button className="icon-btn send" title={t('agent.send')} disabled={!input.trim() || busy} onClick={send}>
          <Icon name="send" size={18} />
        </button>
      </div>
    </aside>
  )
}

function Field({ label, value, lyrics }: { label: string; value: string; lyrics?: boolean }) {
  return (
    <div className="proposal-field">
      <span className="muted small">{label}</span>
      <div className={lyrics ? 'proposal-lyrics' : ''}>{value}</div>
    </div>
  )
}
