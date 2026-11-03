window.__ModuleLoader__.load({
  id: '@local/dsh-session-handoff',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useRef, useEffect } = React

    const RADIUS = 5.5
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS
    const OPENED_MARKER_PREFIX = 'session-handoff.opened.'
    let runtimeCtx

    const CSS = `
      .shd-root { position: relative; display: inline-flex; align-items: center; gap: 8px; }
      .shd-anchor { position: relative; display: inline-flex; align-items: center; }
      .shd-clock { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; line-height: 1;
        color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
        font-variant-numeric: tabular-nums; white-space: nowrap; }
      .shd-clock-key { color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
      .shd-clock-value { color: var(--dsw-alias-label-secondary); }
      .shd-clock-sep { color: var(--dsw-alias-label-dimmed, var(--dsw-alias-label-tertiary)); }
      .shd-divider { flex: none; width: 1px; height: 12px;
        background: var(--dsw-alias-border-l1, var(--dsw-alias-border-l2)); }
      .shd-trigger { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px;
        border: none; border-radius: 999px; background: transparent; font-family: inherit;
        font-size: 11px; line-height: 1; color: var(--dsw-alias-label-secondary); cursor: pointer; }
      .shd-trigger:hover, .shd-trigger[aria-expanded="true"] {
        background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
      .shd-trigger:focus-visible { outline: 1px solid var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); outline-offset: 1px; }
      .shd-count { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
      .shd-ring-track { fill: none; stroke: var(--dsw-alias-border-l3, var(--dsw-alias-border-l1)); stroke-width: 2; }
      .shd-ring-fill { fill: none; stroke: var(--dsw-alias-brand-primary); stroke-width: 2; stroke-linecap: round; }
      .shd-sev-warn { color: var(--dsw-alias-state-warn-primary); }
      .shd-sev-error { color: var(--dsw-alias-state-error-primary); }
      .shd-count.shd-sev-warn { font-weight: 600; }
      .shd-count.shd-sev-error { font-weight: 600; }
      .shd-ring-warn { stroke: var(--dsw-alias-state-warn-primary); }
      .shd-ring-error { stroke: var(--dsw-alias-state-error-primary); }
      .shd-ring-alert { animation: shd-breathe 2.4s ease-in-out infinite; }
      .shd-ring-urgent { animation: shd-breathe 1.1s ease-in-out infinite; }
      .shd-ring-critical { animation: shd-flash 1s ease-in-out infinite; }
      .shd-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor;
        animation: shd-breathe 1.1s ease-in-out infinite; }
      .shd-hint { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 8px 10px;
        border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
      .shd-hint-warn { color: var(--dsw-alias-state-warn-primary); }
      .shd-hint-error { color: var(--dsw-alias-state-error-primary); }
      @keyframes shd-breathe { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
      @keyframes shd-flash { 0%, 100% { opacity: 1; stroke-width: 2; } 50% { opacity: .3; stroke-width: 3.2; } }
      @media (prefers-reduced-motion: reduce) {
        .shd-ring-alert, .shd-ring-urgent, .shd-ring-critical, .shd-dot { animation: none; }
      }

      .shd-panel { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 100; box-sizing: border-box;
        width: 288px; padding: 12px; border: 1px solid var(--dsw-alias-border-inverted, var(--dsw-alias-border-l2));
        border-radius: 12px; background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1)));
        box-shadow: var(--dsw-shadow-lv3, 0 8px 24px rgba(0, 0, 0, .28));
        font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-secondary); cursor: default; }
      .shd-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .shd-head-label { color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
      .shd-head-value { font-weight: 500; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
      .shd-bar { display: flex; margin: 10px 0 12px; height: 4px; border-radius: 999px; overflow: hidden;
        background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
      .shd-bar-fill { height: 100%; border-radius: 999px; background: var(--dsw-alias-brand-primary); }
      .shd-bar-fill.shd-warn { background: var(--dsw-alias-state-warn-primary); }
      .shd-bar-fill.shd-error { background: var(--dsw-alias-state-error-primary); }

      .shd-field { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 3px 0; }
      .shd-field-label { color: var(--dsw-alias-label-secondary); }

      /* Clock panel skin shared with the composer's token/stat dialogs: menu
         surface, icon + title heading, a rule under it, then dt/dd rows. */
      .shd-stat-panel { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 100; box-sizing: border-box;
        width: max-content; min-width: min(300px, calc(100vw - 24px)); max-width: min(440px, calc(100vw - 24px));
        padding: 16px; border: 0; border-radius: var(--dsw-radius-lg, 12px);
        background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1)));
        backdrop-filter: var(--dsw-menu-backdrop-filter, none);
        box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0, 0, 0, .28));
        font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); cursor: default; }
      .shd-stat-title { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 8px;
        color: var(--dsw-alias-label-primary); font-weight: 500; }
      .shd-stat-title-label { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
      .shd-stat-title-label svg { width: 14px; height: 14px; flex: none; }
      .shd-stat-rule { margin-bottom: 10px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
      .shd-stat-details { display: grid; grid-template-columns: minmax(76px, auto) minmax(0, 1fr);
        gap: 6px 16px; margin: 0; color: var(--dsw-alias-label-tertiary); }
      .shd-stat-details dt, .shd-stat-details dd { min-width: 0; margin: 0; }
      .shd-stat-details dd { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; text-align: right; }
      .shd-input { width: 84px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 6px; padding: 2px 6px; font-size: 12px; font-family: inherit; text-align: right;
        background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
      .shd-input:focus-visible { outline: 1px solid var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); outline-offset: 1px; }

      .shd-switch { display: inline-flex; align-items: center; flex: none; padding: 0; border: 0;
        background: transparent; cursor: pointer; }
      .shd-switch-track { position: relative; display: inline-block; width: 26px; height: 14px; border-radius: 999px;
        background: var(--dsw-alias-border-l2, var(--dsw-alias-border-l1));
        transition: background-color 120ms ease-in-out; }
      .shd-switch-thumb { position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%;
        background: var(--dsw-alias-bg-layer-1); box-shadow: 0 1px 2px rgba(0, 0, 0, .25);
        transition: transform 120ms ease-in-out; }
      .shd-switch-track[data-on="true"] { background: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
      .shd-switch-track[data-on="true"] .shd-switch-thumb { transform: translateX(12px); }
      .shd-switch:focus-visible .shd-switch-track { outline: 1px solid var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); outline-offset: 2px; }
      .shd-switch:disabled { cursor: default; opacity: .5; }

      .shd-foot { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
      .shd-btn { border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 2px 10px;
        font-size: 11px; font-family: inherit; color: var(--dsw-alias-label-primary); background: transparent; cursor: pointer; }
      .shd-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
      .shd-btn:focus-visible { outline: 1px solid var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); outline-offset: 1px; }
      .shd-btn:disabled { color: var(--dsw-alias-label-dimmed, var(--dsw-alias-label-secondary)); opacity: .6; cursor: default; }
      .shd-btn-primary { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); font-weight: 500; }

      .shd-status { margin-top: 8px; }
      .shd-note { color: var(--dsw-alias-state-warn-primary); }
      .shd-error { color: var(--dsw-alias-state-error-primary); }
      .shd-done { color: var(--dsw-alias-state-success-primary); }
    `

    const PHASE_TEXT = {
      'awaiting-handoff': '正在写交接文件…',
      'transferring': '正在创建接续会话…',
    }

    const pad2 = (value) => String(value).padStart(2, '0')

    // Start wall clock: same-day labels stay short (14:32); an older session
    // also names its date (11-02 14:32).
    function startClockText(startedAt, now) {
      const start = new Date(startedAt)
      const current = new Date(now)
      const hourMinute = `${pad2(start.getHours())}:${pad2(start.getMinutes())}`
      const sameDay = start.getFullYear() === current.getFullYear()
        && start.getMonth() === current.getMonth()
        && start.getDate() === current.getDate()
      return sameDay ? hourMinute : `${pad2(start.getMonth() + 1)}-${pad2(start.getDate())} ${hourMinute}`
    }

    function fullClockText(startedAt) {
      const start = new Date(startedAt)
      return `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`
        + ` ${pad2(start.getHours())}:${pad2(start.getMinutes())}:${pad2(start.getSeconds())}`
    }

    // Elapsed duration: seconds keep the reading alive under a minute and for
    // the first hour; longer sessions show whole hours plus minutes.
    function elapsedText(ms) {
      const total = Math.max(0, Math.floor(ms / 1000))
      if (total < 60) return `${total}秒`
      const minutes = Math.floor(total / 60)
      if (minutes < 60) return `${minutes}分${pad2(total % 60)}秒`
      return `${Math.floor(minutes / 60)}小时${pad2(minutes % 60)}分`
    }

    // Run time is the sum of each turn's span: idle time between turns is not
    // billed, and the open turn is added live from its start timestamp.
    function runTotalMs(runMs, runStartedAt, now) {
      const closed = Number.isFinite(runMs) && runMs > 0 ? runMs : 0
      const open = Number.isFinite(runStartedAt) && runStartedAt > 0 && Number.isFinite(now)
        ? Math.max(0, now - runStartedAt)
        : 0
      return closed + open
    }

    // Ticking clock shared by the pill and the panel: while a turn is open the
    // reading follows it per second; an idle session does not schedule a timer.
    function useTickNow(runStartedAt) {
      const active = Number.isFinite(runStartedAt) && runStartedAt > 0
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        if (!active) return undefined
        setNow(Date.now())
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(timer)
      }, [active, runStartedAt])
      return now
    }

    // One isolated ticker: only an open turn advances the reading, and it
    // refreshes without re-rendering the turn pill, its ring, or the panel.
    function StartClock({ startedAt, runMs, runStartedAt }) {
      const now = useTickNow(runStartedAt)
      return h('span', {
        className: 'shd-clock',
        title: `会话启动于 ${fullClockText(startedAt)}`,
      },
      h('span', { className: 'shd-clock-key' }, '启动'),
      h('span', { className: 'shd-clock-value' }, startClockText(startedAt, now)),
      h('span', { className: 'shd-clock-sep', 'aria-hidden': 'true' }, '·'),
      h('span', { className: 'shd-clock-key' }, '工作时间'),
      h('span', { className: 'shd-clock-value' }, elapsedText(runTotalMs(runMs, runStartedAt, now))))
    }

    // The same total rendered inside the clock panel, ticking while a turn runs.
    function WorkTotal({ runMs, runStartedAt }) {
      const now = useTickNow(runStartedAt)
      return h('span', null, elapsedText(runTotalMs(runMs, runStartedAt, now)))
    }

    async function post(body) {
      const response = await fetch('/session-handoff/api', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error((data && data.error) || `HTTP ${response.status}`)
      return data
    }

    function Switch({ checked, disabled, label, onChange }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        className: 'shd-switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        disabled: disabled === true,
        onClick: () => onChange(!checked),
      },
      h('span', { className: 'shd-switch-track', 'data-on': checked ? 'true' : 'false', 'aria-hidden': 'true' },
        h('span', { className: 'shd-switch-thumb' })))
    }

    // The continuation is opened at most once per (session, continuation) pair.
    // A marker shared by every window keeps a second open page from navigating
    // the same session again, which is what made a handed-off session impossible
    // to re-enter: every mount used to redirect away from it.
    function continuationOpened(sessionId, continuationId) {
      const marker = `${OPENED_MARKER_PREFIX}${sessionId}.${continuationId}`
      try {
        if (window.localStorage.getItem(marker) === '1') return true
        window.localStorage.setItem(marker, '1')
        return false
      } catch {
        return false
      }
    }

    function Guard(props) {
      const read = typeof props.useProjection === 'function' ? props.useProjection : () => undefined
      const guard = read('session-handoff')

      const [open, setOpen] = useState(false)
      const [clockOpen, setClockOpen] = useState(false)
      const [draft, setDraft] = useState(null)
      const [override, setOverride] = useState(null)
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState(null)
      const [error, setError] = useState(null)
      const [live, setLive] = useState(null)
      const [settled, setSettled] = useState(false)
      const rootRef = useRef(null)
      const openedRef = useRef(null)
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      const projectionPhase = guard === undefined ? 'idle' : guard.phase
      const transient = projectionPhase === 'awaiting-handoff' || projectionPhase === 'transferring'

      useEffect(() => {
        if (!open && !clockOpen) return undefined
        const onPointerDown = (event) => {
          if (event.target instanceof Node && rootRef.current?.contains(event.target) === true) return
          setOpen(false)
          setClockOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          setOpen(false)
          setClockOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open, clockOpen])

      // The host finishes the transfer after the last turn is committed, so the
      // projection push never reaches this page. Ask the read-only probe while a
      // transfer is in flight, then publish the settled value into the store.
      useEffect(() => {
        if (!transient || sessionId === '') return undefined
        let cancelled = false
        let timer
        let attempts = 0
        const tick = () => {
          attempts += 1
          fetch(`/session-handoff/api?session=${encodeURIComponent(sessionId)}`)
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
              if (cancelled || data === null || !data.guard) return
              setLive(data)
              if (data.guard.phase === 'transferred') {
                setSettled(true)
                return
              }
              if (data.guard.phase === 'failed') return
              if (attempts < 45) timer = setTimeout(tick, 2000)
            })
            .catch(() => {
              if (!cancelled && attempts < 45) timer = setTimeout(tick, 3000)
            })
        }
        timer = setTimeout(tick, 1500)
        return () => {
          cancelled = true
          clearTimeout(timer)
        }
      }, [transient, sessionId])

      const effective = live !== null && live.guard !== undefined ? live.guard : guard

      // Only a transfer this page watched settle may move the user: opening an
      // already handed-off session must leave the reader where they are.
      useEffect(() => {
        if (!settled || effective === undefined || effective.phase !== 'transferred') return
        const next = typeof effective.newSessionId === 'string' ? effective.newSessionId : ''
        if (next === '' || sessionId === '' || openedRef.current === next) return
        openedRef.current = next
        const sessions = runtimeCtx === undefined ? undefined : runtimeCtx.get('sessions')
        if (sessions !== undefined && typeof sessions.refreshProjections === 'function') void sessions.refreshProjections(sessionId)
        if (continuationOpened(sessionId, next)) return
        const uiWorkspace = runtimeCtx === undefined ? undefined : runtimeCtx.get('uiWorkspace')
        if (uiWorkspace !== undefined && typeof uiWorkspace.openSession === 'function') uiWorkspace.openSession(next)
      }, [settled, effective, sessionId])

      if (guard === undefined) return null

      const startedAt = Number.isFinite(guard.startedAt) && guard.startedAt > 0 ? guard.startedAt : 0
      const runMs = Number.isFinite(guard.runMs) && guard.runMs > 0 ? guard.runMs : 0
      const runStartedAt = Number.isFinite(guard.runStartedAt) && guard.runStartedAt > 0 ? guard.runStartedAt : 0
      const lastTurnEndedAt = Number.isFinite(guard.lastTurnEndedAt) && guard.lastTurnEndedAt > 0
        ? guard.lastTurnEndedAt
        : 0
      // The run reading needs the host half that reports turn spans; a host
      // from before that field keeps the turn-only status bar.
      const clockVisible = startedAt > 0 && Number.isFinite(guard.runMs)

      const settings = override || {
        maxRounds: guard.maxRounds,
        enabled: guard.enabled,
        autoHandoff: guard.autoHandoff,
      }
      const turns = guard.turns || 0
      const maxRounds = settings.maxRounds > 0 ? settings.maxRounds : 100
      const ratio = Math.max(0, Math.min(1, turns / maxRounds))
      const transferred = effective.phase === 'transferred'
      const continuationId = typeof effective.newSessionId === 'string' ? effective.newSessionId : ''
      const canOpenContinuation = continuationId !== '' && (transferred || effective.phase === 'failed')

      let status = null
      if (transferred) {
        status = h('span', { className: 'shd-done' }, continuationId === '' ? '已交接' : `已交接 → ${continuationId.slice(0, 8)}`)
      } else if (effective.phase === 'reached') {
        status = h('span', { className: 'shd-note' }, '已达上限（未开启自动交接）')
      } else if (effective.phase === 'failed') {
        status = h('span', { className: 'shd-error' }, `交接失败：${effective.note || ''}`)
      } else if (PHASE_TEXT[effective.phase]) {
        status = h('span', { className: 'shd-note' }, PHASE_TEXT[effective.phase])
      }

      const toggle = () => {
        if (open) {
          setOpen(false)
          setDraft(null)
          return
        }
        setClockOpen(false)
        setDraft({
          maxRounds: String(maxRounds),
          enabled: settings.enabled !== false,
          autoHandoff: settings.autoHandoff !== false,
        })
        setNotice(null)
        setError(null)
        setOpen(true)
      }

      // The clock pill opens the read-only time panel; the two panels are
      // mutually exclusive and share the same outside-click/Escape close.
      const toggleClock = () => {
        if (clockOpen) {
          setClockOpen(false)
          return
        }
        setOpen(false)
        setDraft(null)
        setNotice(null)
        setError(null)
        setClockOpen(true)
      }

      const save = async () => {
        if (!draft) return
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          const data = await post({
            action: 'settings',
            enabled: draft.enabled,
            autoHandoff: draft.autoHandoff,
            maxRounds: Number(draft.maxRounds),
          })
          setOverride(data.settings)
          setDraft(null)
          setNotice('已保存')
          setOpen(false)
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          setBusy(false)
        }
      }

      const handoffNow = async () => {
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          await post({ action: 'handoff', sessionId: props.sessionId })
          setNotice('已请求交接')
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          setBusy(false)
        }
      }

      const startSession = () => {
        const uiWorkspace = runtimeCtx === undefined ? undefined : runtimeCtx.get('uiWorkspace')
        if (uiWorkspace === undefined || typeof uiWorkspace.startSession !== 'function') {
          setError('当前界面不支持直接开新会话')
          return
        }
        try {
          uiWorkspace.startSession()
          setNotice('已打开新会话')
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      }

      const openContinuation = () => {
        if (continuationId === '') {
          setError('还没有接续会话')
          return
        }
        const uiWorkspace = runtimeCtx === undefined ? undefined : runtimeCtx.get('uiWorkspace')
        if (uiWorkspace === undefined || typeof uiWorkspace.openSession !== 'function') {
          setError('当前界面不支持切换会话')
          return
        }
        try {
          uiWorkspace.openSession(continuationId)
          setNotice('已切换到接续会话')
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      }

      const tone = transferred ? ' shd-done' : ratio >= 1 ? ' shd-error' : ratio >= 0.8 ? ' shd-warn' : ''
      const tier = transferred ? 0 : ratio >= 1 ? 3 : ratio >= 0.9 ? 2 : ratio >= 0.8 ? 1 : 0
      const ringTone = tier === 3 ? ' shd-ring-error shd-ring-critical' : tier === 2 ? ' shd-ring-error shd-ring-urgent' : tier === 1 ? ' shd-ring-warn shd-ring-alert' : ''
      const countTone = tier >= 2 ? ' shd-sev-error' : tier === 1 ? ' shd-sev-warn' : ''
      const hint = transferred
        ? null
        : tier === 3
          ? (settings.autoHandoff !== false ? `轮次已满（${turns}/${maxRounds}），将自动交接开新会话` : `轮次已满（${turns}/${maxRounds}），请立即交接或开新会话`)
          : tier === 2
            ? `轮次已用 ${Math.round(ratio * 100)}%，接近上限，建议尽快开新会话`
            : null

      const panel = open && draft
        ? h('div', { className: 'shd-panel', role: 'dialog', 'aria-label': '会话交接设置' },
          h('div', { className: 'shd-head' },
            h('span', { className: 'shd-head-label' }, '对话轮次'),
            h('span', { className: 'shd-head-value' }, `${turns} / ${maxRounds}`)),
          h('div', { className: 'shd-bar' },
            h('div', { className: 'shd-bar-fill' + tone, style: { width: `${ratio * 100}%` } })),
          hint !== null
            ? h('div', { className: 'shd-hint ' + (tier >= 2 ? 'shd-hint-error' : 'shd-hint-warn') },
              h('span', { className: 'shd-dot', 'aria-hidden': 'true' }),
              h('span', null, hint))
            : null,
          h('div', { className: 'shd-field' },
            h('span', { className: 'shd-field-label' }, '最大轮次'),
            h('input', {
              className: 'shd-input',
              type: 'number',
              min: 1,
              step: 1,
              'aria-label': '最大轮次',
              value: draft.maxRounds,
              onChange: (event) => setDraft({ ...draft, maxRounds: event.target.value }),
            })),
          h('div', { className: 'shd-field' },
            h('span', { className: 'shd-field-label' }, '达到上限后自动交接'),
            h(Switch, {
              checked: draft.autoHandoff,
              label: '达到上限后自动交接',
              onChange: (value) => setDraft({ ...draft, autoHandoff: value }),
            })),
          h('div', { className: 'shd-field' },
            h('span', { className: 'shd-field-label' }, '启用监控'),
            h(Switch, {
              checked: draft.enabled,
              label: '启用监控',
              onChange: (value) => setDraft({ ...draft, enabled: value }),
            })),
          status ? h('div', { className: 'shd-status' }, status) : null,
          error ? h('div', { className: 'shd-status shd-error' }, error) : null,
          notice ? h('div', { className: 'shd-status shd-done' }, notice) : null,
          h('div', { className: 'shd-foot' },
            canOpenContinuation ? h('button', { className: 'shd-btn', type: 'button', disabled: busy, onClick: openContinuation }, '打开接续会话') : null,
            transferred ? null : h('button', { className: 'shd-btn', type: 'button', disabled: busy, onClick: handoffNow }, '立即交接'),
            !transferred && tier >= 2 ? h('button', { className: 'shd-btn', type: 'button', disabled: busy, onClick: startSession }, '开新会话') : null,
            h('button', { className: 'shd-btn shd-btn-primary', type: 'button', disabled: busy, onClick: save }, busy ? '保存中…' : '保存')))
        : null

      // The clock/token panels share one stat-dialog skin: icon + title, a rule,
      // then right-aligned dt/dd rows.
      const clockIcon = h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        fill: 'none',
        strokeWidth: 1,
        'aria-hidden': 'true',
      },
      h('path', {
        d: 'M8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14Z',
        stroke: 'currentColor',
      }),
      h('path', { d: 'M8 4.31V8.46L11 10.08', stroke: 'currentColor' }))

      const clockPanel = clockOpen && clockVisible
        ? h('div', { className: 'shd-stat-panel', role: 'dialog', 'aria-label': '工时记录' },
          h('div', { className: 'shd-stat-title' },
            h('span', { className: 'shd-stat-title-label' },
              clockIcon,
              h('span', null, '工时记录'))),
          h('div', { className: 'shd-stat-rule', 'aria-hidden': 'true' }),
          h('dl', { className: 'shd-stat-details' },
            h('dt', null, '启动时间'),
            h('dd', null, fullClockText(startedAt)),
            h('dt', null, '最后对话结束时间'),
            h('dd', null, lastTurnEndedAt > 0 ? fullClockText(lastTurnEndedAt) : '—'),
            h('dt', null, '总工作时间'),
            h('dd', null, h(WorkTotal, { runMs, runStartedAt }))))
        : null

      return h('div', { className: 'shd-root', ref: rootRef },
        h('style', null, CSS),
        clockVisible
          ? h('span', { className: 'shd-anchor' },
            h('button', {
              type: 'button',
              // No aria-label: the live text ("启动 … · 工作时间 …") is the
              // accessible name, so assistive tech reads the current reading.
              className: 'shd-trigger shd-clock-trigger',
              'aria-haspopup': 'dialog',
              'aria-expanded': clockOpen,
              onClick: toggleClock,
            },
            h(StartClock, { startedAt, runMs, runStartedAt })),
            clockPanel)
          : null,
        clockVisible ? h('span', { className: 'shd-divider', 'aria-hidden': 'true' }) : null,
        h('span', { className: 'shd-anchor' },
          h('button', {
            type: 'button',
            className: 'shd-trigger',
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            'aria-label': `会话交接：${startedAt > 0 ? `启动于 ${fullClockText(startedAt)}，` : ''}轮次 ${turns}/${maxRounds}${transferred ? '，已交接' : ''}`,
            title: hint ?? undefined,
            onClick: toggle,
          },
          h('svg', { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true },
            h('circle', { className: 'shd-ring-track', cx: 7, cy: 7, r: RADIUS }),
            h('circle', {
              className: 'shd-ring-fill' + ringTone,
              cx: 7,
              cy: 7,
              r: RADIUS,
              strokeDasharray: `${CIRCUMFERENCE * ratio} ${CIRCUMFERENCE}`,
              transform: 'rotate(-90 7 7)',
            })),
          h('span', null, '轮次'),
          h('span', { className: 'shd-count' + (transferred ? ' shd-done' : countTone) }, `${turns}/${maxRounds}`),
          transferred
            ? h('span', { className: 'shd-done' }, '· 已交接')
            : tier === 3 ? h('span', { className: 'shd-sev-error' }, '· 开会话') : null),
          panel))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        runtimeCtx = ctx
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'session-handoff',
          order: 20,
        }, Guard))
      },
      // Pure display formatters, exported so the clock's date/duration buckets
      // stay covered by a plain unit test.
      clock: { startClockText, fullClockText, elapsedText, runTotalMs },
    }
  },
})
