window.__ModuleLoader__.load({
  id: '@local/dsh-context-guard',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useRef, useEffect } = React

    const RADIUS = 5.5
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS
    const OPENED_MARKER_PREFIX = 'context-guard.opened.'
    let runtimeCtx

    const CSS = `
      .dsg-root { position: relative; display: inline-flex; }
      .dsg-trigger { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px;
        border: none; border-radius: 999px; background: transparent; font-family: inherit;
        font-size: 11px; line-height: 1; color: var(--dsw-alias-label-secondary); cursor: pointer; }
      .dsg-trigger:hover, .dsg-trigger[aria-expanded="true"] {
        background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
      .dsg-trigger:focus-visible { outline: 1px solid var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); outline-offset: 1px; }
      .dsg-count { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
      .dsg-ring-track { fill: none; stroke: var(--dsw-alias-border-l3, var(--dsw-alias-border-l1)); stroke-width: 2; }
      .dsg-ring-fill { fill: none; stroke: var(--dsw-alias-brand-primary); stroke-width: 2; stroke-linecap: round; }
      .dsg-sev-warn { color: var(--dsw-alias-state-warn-primary); }
      .dsg-sev-error { color: var(--dsw-alias-state-error-primary); }
      .dsg-count.dsg-sev-warn { font-weight: 600; }
      .dsg-count.dsg-sev-error { font-weight: 600; }
      .dsg-ring-warn { stroke: var(--dsw-alias-state-warn-primary); }
      .dsg-ring-error { stroke: var(--dsw-alias-state-error-primary); }
      .dsg-ring-alert { animation: dsg-breathe 2.4s ease-in-out infinite; }
      .dsg-ring-urgent { animation: dsg-breathe 1.1s ease-in-out infinite; }
      .dsg-ring-critical { animation: dsg-flash 1s ease-in-out infinite; }
      .dsg-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor;
        animation: dsg-breathe 1.1s ease-in-out infinite; }
      .dsg-hint { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 8px 10px;
        border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
      .dsg-hint-warn { color: var(--dsw-alias-state-warn-primary); }
      .dsg-hint-error { color: var(--dsw-alias-state-error-primary); }
      @keyframes dsg-breathe { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
      @keyframes dsg-flash { 0%, 100% { opacity: 1; stroke-width: 2; } 50% { opacity: .3; stroke-width: 3.2; } }
      @media (prefers-reduced-motion: reduce) {
        .dsg-ring-alert, .dsg-ring-urgent, .dsg-ring-critical, .dsg-dot { animation: none; }
      }

      .dsg-panel { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 100; box-sizing: border-box;
        width: 288px; padding: 12px; border: 1px solid var(--dsw-alias-border-inverted, var(--dsw-alias-border-l2));
        border-radius: 12px; background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1)));
        box-shadow: var(--dsw-shadow-lv3, 0 8px 24px rgba(0, 0, 0, .28));
        font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-secondary); cursor: default; }
      .dsg-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .dsg-head-label { color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
      .dsg-head-value { font-weight: 500; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
      .dsg-bar { display: flex; margin: 10px 0 12px; height: 4px; border-radius: 999px; overflow: hidden;
        background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
      .dsg-bar-fill { height: 100%; border-radius: 999px; background: var(--dsw-alias-brand-primary); }
      .dsg-bar-fill.dsg-warn { background: var(--dsw-alias-state-warn-primary); }
      .dsg-bar-fill.dsg-error { background: var(--dsw-alias-state-error-primary); }

      .dsg-field { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 3px 0; }
      .dsg-field-label { color: var(--dsw-alias-label-secondary); }
      .dsg-input { width: 84px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 6px; padding: 2px 6px; font-size: 12px; font-family: inherit; text-align: right;
        background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
      .dsg-input:focus-visible { outline: 1px solid var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); outline-offset: 1px; }

      .dsg-switch { display: inline-flex; align-items: center; flex: none; padding: 0; border: 0;
        background: transparent; cursor: pointer; }
      .dsg-switch-track { position: relative; display: inline-block; width: 26px; height: 14px; border-radius: 999px;
        background: var(--dsw-alias-border-l2, var(--dsw-alias-border-l1));
        transition: background-color 120ms ease-in-out; }
      .dsg-switch-thumb { position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%;
        background: var(--dsw-alias-bg-layer-1); box-shadow: 0 1px 2px rgba(0, 0, 0, .25);
        transition: transform 120ms ease-in-out; }
      .dsg-switch-track[data-on="true"] { background: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
      .dsg-switch-track[data-on="true"] .dsg-switch-thumb { transform: translateX(12px); }
      .dsg-switch:focus-visible .dsg-switch-track { outline: 1px solid var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); outline-offset: 2px; }
      .dsg-switch:disabled { cursor: default; opacity: .5; }

      .dsg-foot { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
      .dsg-btn { border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 2px 10px;
        font-size: 11px; font-family: inherit; color: var(--dsw-alias-label-primary); background: transparent; cursor: pointer; }
      .dsg-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
      .dsg-btn:focus-visible { outline: 1px solid var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); outline-offset: 1px; }
      .dsg-btn:disabled { color: var(--dsw-alias-label-dimmed, var(--dsw-alias-label-secondary)); opacity: .6; cursor: default; }
      .dsg-btn-primary { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); font-weight: 500; }

      .dsg-status { margin-top: 8px; }
      .dsg-note { color: var(--dsw-alias-state-warn-primary); }
      .dsg-error { color: var(--dsw-alias-state-error-primary); }
      .dsg-done { color: var(--dsw-alias-state-success-primary); }
    `

    const PHASE_TEXT = {
      'awaiting-handoff': '正在写交接文件…',
      'transferring': '正在创建接续会话…',
    }

    async function post(body) {
      const response = await fetch('/context-guard/api', {
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
        className: 'dsg-switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        disabled: disabled === true,
        onClick: () => onChange(!checked),
      },
      h('span', { className: 'dsg-switch-track', 'data-on': checked ? 'true' : 'false', 'aria-hidden': 'true' },
        h('span', { className: 'dsg-switch-thumb' })))
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
      const guard = read('context-guard')

      const [open, setOpen] = useState(false)
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
        if (!open) return undefined
        const onPointerDown = (event) => {
          if (event.target instanceof Node && rootRef.current?.contains(event.target) === true) return
          setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

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
          fetch(`/context-guard/api?session=${encodeURIComponent(sessionId)}`)
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
        status = h('span', { className: 'dsg-done' }, continuationId === '' ? '已交接' : `已交接 → ${continuationId.slice(0, 8)}`)
      } else if (effective.phase === 'reached') {
        status = h('span', { className: 'dsg-note' }, '已达上限（未开启自动交接）')
      } else if (effective.phase === 'failed') {
        status = h('span', { className: 'dsg-error' }, `交接失败：${effective.note || ''}`)
      } else if (PHASE_TEXT[effective.phase]) {
        status = h('span', { className: 'dsg-note' }, PHASE_TEXT[effective.phase])
      }

      const toggle = () => {
        if (open) {
          setOpen(false)
          setDraft(null)
          return
        }
        setDraft({
          maxRounds: String(maxRounds),
          enabled: settings.enabled !== false,
          autoHandoff: settings.autoHandoff !== false,
        })
        setNotice(null)
        setError(null)
        setOpen(true)
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

      const tone = transferred ? ' dsg-done' : ratio >= 1 ? ' dsg-error' : ratio >= 0.8 ? ' dsg-warn' : ''
      const tier = transferred ? 0 : ratio >= 1 ? 3 : ratio >= 0.9 ? 2 : ratio >= 0.8 ? 1 : 0
      const ringTone = tier === 3 ? ' dsg-ring-error dsg-ring-critical' : tier === 2 ? ' dsg-ring-error dsg-ring-urgent' : tier === 1 ? ' dsg-ring-warn dsg-ring-alert' : ''
      const countTone = tier >= 2 ? ' dsg-sev-error' : tier === 1 ? ' dsg-sev-warn' : ''
      const hint = transferred
        ? null
        : tier === 3
          ? (settings.autoHandoff !== false ? `轮次已满（${turns}/${maxRounds}），将自动交接开新会话` : `轮次已满（${turns}/${maxRounds}），请立即交接或开新会话`)
          : tier === 2
            ? `轮次已用 ${Math.round(ratio * 100)}%，接近上限，建议尽快开新会话`
            : null

      const panel = open && draft
        ? h('div', { className: 'dsg-panel', role: 'dialog', 'aria-label': '上下文守卫设置' },
          h('div', { className: 'dsg-head' },
            h('span', { className: 'dsg-head-label' }, '对话轮次'),
            h('span', { className: 'dsg-head-value' }, `${turns} / ${maxRounds}`)),
          h('div', { className: 'dsg-bar' },
            h('div', { className: 'dsg-bar-fill' + tone, style: { width: `${ratio * 100}%` } })),
          hint !== null
            ? h('div', { className: 'dsg-hint ' + (tier >= 2 ? 'dsg-hint-error' : 'dsg-hint-warn') },
              h('span', { className: 'dsg-dot', 'aria-hidden': 'true' }),
              h('span', null, hint))
            : null,
          h('div', { className: 'dsg-field' },
            h('span', { className: 'dsg-field-label' }, '最大轮次'),
            h('input', {
              className: 'dsg-input',
              type: 'number',
              min: 1,
              step: 1,
              'aria-label': '最大轮次',
              value: draft.maxRounds,
              onChange: (event) => setDraft({ ...draft, maxRounds: event.target.value }),
            })),
          h('div', { className: 'dsg-field' },
            h('span', { className: 'dsg-field-label' }, '达到上限后自动交接'),
            h(Switch, {
              checked: draft.autoHandoff,
              label: '达到上限后自动交接',
              onChange: (value) => setDraft({ ...draft, autoHandoff: value }),
            })),
          h('div', { className: 'dsg-field' },
            h('span', { className: 'dsg-field-label' }, '启用监控'),
            h(Switch, {
              checked: draft.enabled,
              label: '启用监控',
              onChange: (value) => setDraft({ ...draft, enabled: value }),
            })),
          status ? h('div', { className: 'dsg-status' }, status) : null,
          error ? h('div', { className: 'dsg-status dsg-error' }, error) : null,
          notice ? h('div', { className: 'dsg-status dsg-done' }, notice) : null,
          h('div', { className: 'dsg-foot' },
            canOpenContinuation ? h('button', { className: 'dsg-btn', type: 'button', disabled: busy, onClick: openContinuation }, '打开接续会话') : null,
            transferred ? null : h('button', { className: 'dsg-btn', type: 'button', disabled: busy, onClick: handoffNow }, '立即交接'),
            !transferred && tier >= 2 ? h('button', { className: 'dsg-btn', type: 'button', disabled: busy, onClick: startSession }, '开新会话') : null,
            h('button', { className: 'dsg-btn dsg-btn-primary', type: 'button', disabled: busy, onClick: save }, busy ? '保存中…' : '保存')))
        : null

      return h('div', { className: 'dsg-root', ref: rootRef },
        h('style', null, CSS),
        h('button', {
          type: 'button',
          className: 'dsg-trigger',
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-label': `上下文守卫：轮次 ${turns}/${maxRounds}${transferred ? '，已交接' : ''}`,
          title: hint ?? undefined,
          onClick: toggle,
        },
        h('svg', { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true },
          h('circle', { className: 'dsg-ring-track', cx: 7, cy: 7, r: RADIUS }),
          h('circle', {
            className: 'dsg-ring-fill' + ringTone,
            cx: 7,
            cy: 7,
            r: RADIUS,
            strokeDasharray: `${CIRCUMFERENCE * ratio} ${CIRCUMFERENCE}`,
            transform: 'rotate(-90 7 7)',
          })),
        h('span', null, '轮次'),
        h('span', { className: 'dsg-count' + (transferred ? ' dsg-done' : countTone) }, `${turns}/${maxRounds}`),
        transferred
          ? h('span', { className: 'dsg-done' }, '· 已交接')
          : tier === 3 ? h('span', { className: 'dsg-sev-error' }, '· 开会话') : null),
        panel)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        runtimeCtx = ctx
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'context-guard',
          order: 20,
        }, Guard))
      },
    }
  },
})
