import { useEffect, useState } from 'react'

import { isLarkAppId, type LarkDomain, type LarkStatus } from '../../../shared/contracts'
import { useTranslation } from '../i18n/use-translation'
import { useAppStore } from '../store/use-app-store'

// What the Lark app must be granted before the bot can read and answer messages. Names are the
// platform's own identifiers, so they are never translated.
const LARK_PERMISSIONS: ReadonlyArray<string> = [
  'im:message.group_at_msg:readonly',
  'im:message.group_msg',
  'im:message:readonly',
  'im:message:send_as_bot',
  'im:resource',
  'contact:contact.base:readonly'
]

const formatRemaining = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

const errorText = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback)

/**
 * The body of Settings' Lark section. Mounted only while the dialog is open, so "refetch the
 * status on every open" and "subscribe while visible" are simply this component's lifetime.
 * The App Secret lives only in the uncontrolled-in-spirit input: it is cleared the moment a save
 * has been sent and is never read back from the main process (which only reports `secretSet`).
 */
export default function LarkSettings() {
  const { t, locale } = useTranslation()
  const [status, setStatus] = useState<LarkStatus | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [domain, setDomain] = useState<LarkDomain>('feishu')
  const [appId, setAppId] = useState('')
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [copied, setCopied] = useState(false)
  // Shown only after a save was attempted, so the field does not turn red while being typed.
  const [appIdRejected, setAppIdRejected] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.codeflai
      .larkStatus()
      .then((next) => {
        if (cancelled) return
        setStatus(next)
        setEnabled(next.enabled)
        setDomain(next.domain)
        setAppId(next.appId)
      })
      .catch(() => undefined)
    // Later broadcasts refresh the connection, members and pairing only: the form fields hold
    // what the user is typing and must not be overwritten underneath them.
    const unsubscribe = window.codeflai.onLarkStatusChanged((next) => {
      if (!cancelled) setStatus(next)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const pairing = status?.pairing
  useEffect(() => {
    if (!pairing) return undefined
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [pairing])

  const report = (error: unknown): void => {
    useAppStore.setState({ notice: { message: errorText(error, t('notice.genericError')), tone: 'error' } })
  }

  const save = async (): Promise<void> => {
    const trimmed = appId.trim()
    // The main process enforces the same rule; checking here gives a readable message instead
    // of a schema error.
    if (trimmed !== '' && !isLarkAppId(trimmed)) {
      setAppIdRejected(true)
      return
    }
    setAppIdRejected(false)
    setSaving(true)
    try {
      adopt(await window.codeflai.larkSaveConfig({ enabled, domain, appId: trimmed, ...(secret === '' ? {} : { appSecret: secret }) }))
      setSecret('')
    } catch (error) {
      report(error)
    } finally {
      setSaving(false)
    }
  }

  // Pairing and member changes answer with the fresh status; the broadcast covers changes the
  // main process makes on its own (connection, a code redeemed from chat).
  const adopt = (next: LarkStatus | undefined): void => {
    if (next) setStatus(next)
  }

  const startPairing = (role: 'owner' | 'member'): void => {
    void window.codeflai.larkStartPairing(role).then(adopt).catch(report)
  }

  const copy = (text: string): void => {
    void navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => undefined)
  }

  const members = status?.members ?? []
  const owner = members.find((member) => member.role === 'owner')
  const connection = status?.connection ?? 'off'
  const connectionLabel = {
    off: t('settings.larkConnectionOff'),
    connecting: t('settings.larkConnectionConnecting'),
    connected: t('settings.larkConnectionConnected'),
    error: t('settings.larkConnectionError')
  }[connection]
  const remaining = pairing ? new Date(pairing.expiresAt).getTime() - now : 0
  // Without the mention: a pasted "@Codeflai" is plain text, not a mention the bot receives.
  const messageToSend = pairing ? `绑定 ${pairing.code}` : ''

  return (
    <>
      <p className="settings-dialog-hint">{t('settings.larkHint')}</p>

      <div className="settings-dialog-section">
        <span className="settings-dialog-label" id="settings-lark-enable-label">
          {t('settings.larkEnable')}
        </span>
        <button
          type="button"
          className="settings-switch"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="settings-lark-enable-label"
          onClick={() => setEnabled(!enabled)}
        >
          <span className="settings-switch-thumb" aria-hidden="true" />
        </button>
      </div>

      <div className="settings-dialog-section">
        <span className="settings-dialog-label" id="settings-lark-domain-label">
          {t('settings.larkDomain')}
        </span>
        <select
          className="settings-select"
          aria-labelledby="settings-lark-domain-label"
          value={domain}
          onChange={(event) => setDomain(event.target.value === 'lark' ? 'lark' : 'feishu')}
        >
          <option value="feishu">{t('settings.larkDomainFeishu')}</option>
          <option value="lark">{t('settings.larkDomainLark')}</option>
        </select>
      </div>

      <div className="settings-dialog-section">
        <label className="settings-dialog-label" htmlFor="settings-lark-app-id">
          {t('settings.larkAppId')}
        </label>
        <input
          id="settings-lark-app-id"
          className="settings-input"
          type="text"
          spellCheck={false}
          autoComplete="off"
          value={appId}
          aria-invalid={appIdRejected || undefined}
          aria-describedby={appIdRejected ? 'settings-lark-app-id-error' : undefined}
          onChange={(event) => setAppId(event.target.value)}
        />
      </div>
      {appIdRejected && (
        <p id="settings-lark-app-id-error" className="settings-dialog-hint settings-lark-error" role="alert">
          {t('settings.larkAppIdInvalid')}
        </p>
      )}

      <div className="settings-dialog-section">
        <label className="settings-dialog-label" htmlFor="settings-lark-app-secret">
          {t('settings.larkAppSecret')}
        </label>
        <input
          id="settings-lark-app-secret"
          className="settings-input"
          type="password"
          autoComplete="off"
          placeholder={status?.secretSet ? t('settings.larkSecretSetPlaceholder') : ''}
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
        />
      </div>

      <div className="settings-dialog-section">
        <span className="settings-update-status" data-status={connection}>
          {t('settings.larkConnection', { state: connectionLabel })}
          {status?.error ? ` — ${status.error}` : ''}
        </span>
        <button type="button" className="settings-update-button" disabled={saving} onClick={() => void save()}>
          {t('settings.larkSave')}
        </button>
      </div>

      <h4 className="settings-subsection-title">{t('settings.larkMembers')}</h4>
      {owner === undefined && <p className="settings-dialog-hint">{t('settings.larkNoOwner')}</p>}
      <ul className="settings-lark-members">
        {members.map((member) => (
          <li key={member.openId} className="settings-lark-member">
            <span className="settings-lark-member-name">{member.name || member.openId}</span>
            {member.role === 'owner' && <span className="settings-lark-badge">{t('settings.larkOwnerBadge')}</span>}
            <span className="settings-dialog-hint">
              {t('settings.larkAddedOn', { date: new Date(member.addedAt).toLocaleDateString(locale) })}
            </span>
            {member.role === 'owner' ? (
              <button type="button" className="settings-update-button" onClick={() => startPairing('owner')}>
                {t('settings.larkRebind')}
              </button>
            ) : (
              <button
                type="button"
                className="settings-update-button"
                aria-label={t('settings.larkRemoveMember', { name: member.name || member.openId })}
                onClick={() => void window.codeflai.larkRemoveMember(member.openId).then(adopt).catch(report)}
              >
                {t('settings.larkRemove')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="settings-dialog-section">
        {owner === undefined ? (
          <button type="button" className="settings-update-button" onClick={() => startPairing('owner')}>
            {t('settings.larkBindMe')}
          </button>
        ) : (
          <button type="button" className="settings-update-button" onClick={() => startPairing('member')}>
            {t('settings.larkAddTeammate')}
          </button>
        )}
      </div>

      {pairing && (
        <div className="settings-lark-pairing">
          <span className="settings-dialog-label">
            {t('settings.larkPairingTitle', {
              role: pairing.role === 'owner' ? t('settings.larkPairingRoleOwner') : t('settings.larkPairingRoleMember')
            })}
          </span>
          <code className="settings-lark-code">{pairing.code}</code>
          <span className="settings-dialog-hint">
            {remaining > 0 ? t('settings.larkPairingExpires', { time: formatRemaining(remaining) }) : t('settings.larkPairingExpired')}
          </span>
          <span className="settings-dialog-hint">{t('settings.larkPairingSend')}</span>
          <div className="settings-lark-send">
            <code>{messageToSend}</code>
            <button type="button" className="settings-update-button" onClick={() => copy(messageToSend)}>
              {copied ? t('settings.larkCopied') : t('settings.larkCopy')}
            </button>
          </div>
        </div>
      )}

      <p className="settings-dialog-hint">{t('settings.larkPermissions')}</p>
      <ul className="settings-lark-permissions">
        {LARK_PERMISSIONS.map((permission) => (
          <li key={permission}>
            <code>{permission}</code>
          </li>
        ))}
      </ul>
      <p className="settings-dialog-hint">{t('settings.larkSetupHint')}</p>
    </>
  )
}
