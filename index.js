import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const KEY = 'context-guard'
const ROUTE = '/context-guard/api'
const MARK = '[上下文守卫]'
const STATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const STATE_MAX_SESSIONS = 500
const DERIVED_NOTES = ['已生成交接文件', '此前已生成交接文件']
const DEFAULT_SETTINGS = {
  enabled: true,
  autoHandoff: true,
  maxRounds: 100,
  handoffDir: 'tmp/handoff',
}

function guardHomeDir() {
  return process.env.DSH_PROFILE_DIR ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
}

function settingsFile() {
  return path.join(guardHomeDir(), 'context-guard.settings.json')
}

function stateFile() {
  return path.join(guardHomeDir(), 'context-guard.state.json')
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizeSettings(...sources) {
  const merged = Object.assign({}, DEFAULT_SETTINGS, ...sources.filter((source) => source !== null && typeof source === 'object'))
  const handoffDir = typeof merged.handoffDir === 'string' && merged.handoffDir.trim() !== ''
    ? merged.handoffDir.trim()
    : DEFAULT_SETTINGS.handoffDir
  return {
    enabled: merged.enabled !== false,
    autoHandoff: merged.autoHandoff !== false,
    maxRounds: Math.round(clampNumber(merged.maxRounds, 1, 100000, DEFAULT_SETTINGS.maxRounds)),
    handoffDir,
  }
}

function readStoredSettings(logger) {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return {}
    logger(`上下文守卫：读取设置失败（使用默认值）：${describeError(error)}`)
    return {}
  }
}

function writeStoredSettings(settings, logger) {
  const file = settingsFile()
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    return true
  } catch (error) {
    logger(`上下文守卫：保存设置失败：${describeError(error)}`)
    return false
  }
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}

function normalizeStoredMeta(meta) {
  return {
    phase: typeof meta.phase === 'string' ? meta.phase : 'idle',
    handoffFile: typeof meta.handoffFile === 'string' ? meta.handoffFile : '',
    newSessionId: typeof meta.newSessionId === 'string' ? meta.newSessionId : '',
    reason: typeof meta.reason === 'string' ? meta.reason : '',
    note: typeof meta.note === 'string' ? meta.note : '',
    derived: meta.derived === true || DERIVED_NOTES.includes(meta.note),
    updatedAt: Number.isFinite(Number(meta.updatedAt)) ? Number(meta.updatedAt) : 0,
  }
}

// The transfer outlives the turn that starts it and must survive a plugin
// reload, so "already handed off" is kept on disk instead of in memory: a
// stale in-memory phase makes the same session spawn a second continuation.
function readStoredPhases(logger) {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return {}
    logger(`上下文守卫：读取交接状态失败（忽略并重建）：${describeError(error)}`)
    return {}
  }
  const sessions = parsed !== null && typeof parsed === 'object' ? parsed.sessions : undefined
  if (sessions === null || typeof sessions !== 'object') return {}
  const now = Date.now()
  const kept = {}
  const entries = Object.entries(sessions)
    .filter(([, meta]) => meta !== null && typeof meta === 'object' && now - normalizeStoredMeta(meta).updatedAt <= STATE_RETENTION_MS)
    .sort((left, right) => normalizeStoredMeta(right[1]).updatedAt - normalizeStoredMeta(left[1]).updatedAt)
    .slice(0, STATE_MAX_SESSIONS)
  for (const [sessionId, meta] of entries) kept[sessionId] = normalizeStoredMeta(meta)
  return kept
}

function writeStoredPhases(sessions, logger) {
  const file = stateFile()
  const temp = `${file}.${process.pid}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(temp, `${JSON.stringify({ version: 1, sessions }, null, 2)}\n`, 'utf8')
    fs.renameSync(temp, file)
    return true
  } catch (error) {
    logger(`上下文守卫：保存交接状态失败：${describeError(error)}`)
    try {
      fs.unlinkSync(temp)
    } catch (cleanupError) {
      logger(`上下文守卫：清理临时状态文件失败：${describeError(cleanupError)}`)
    }
    return false
  }
}

function formatStamp(time) {
  const d = new Date(time)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function shortId(id) {
  return String(id).replace(/[^a-zA-Z0-9]/g, '').slice(-8)
}

function textOfBlocks(content) {
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') text += block.text
  return text
}

function userTextMessage(text) {
  return {
    id: globalThis.crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

function sendJson(response, status, body) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  return JSON.parse(raw)
}

export function apply(ctx, config) {
  const logger = (message) => {
    try {
      ctx.logger?.warn?.(message)
    } catch {
      // Logging is owned by the Host; a logger failure must not break the guard.
    }
  }

  const settings = { current: normalizeSettings(config, readStoredSettings(logger)) }
  const storedPhases = readStoredPhases(logger)
  const phases = new Map()
  for (const [sessionId, meta] of Object.entries(storedPhases)) {
    const interrupted = meta.phase === 'transferring'
    phases.set(sessionId, {
      ...meta,
      attempts: 0,
      phase: interrupted ? 'failed' : meta.phase,
      note: interrupted ? (meta.note || '上次交接在插件重载时中断') : meta.note,
    })
  }
  const transfers = new Map()
  const continuations = new Map()
  let registry
  let webServer

  function webOrigin() {
    try {
      return webServer?.getOrigin?.()
    } catch (error) {
      logger(`上下文守卫：读取服务地址失败：${describeError(error)}`)
      return undefined
    }
  }

  const metaOf = (session) => phases.get(session.id)

  function persist(sessionId, meta) {
    storedPhases[sessionId] = {
      phase: meta.phase ?? 'idle',
      handoffFile: meta.handoffFile ?? '',
      newSessionId: meta.newSessionId ?? '',
      reason: meta.reason ?? '',
      note: meta.note ?? '',
      derived: meta.derived === true,
      updatedAt: Date.now(),
    }
    writeStoredPhases(storedPhases, logger)
  }

  function remember(sessionId, patch) {
    const previous = phases.get(sessionId) ?? { phase: 'idle', attempts: 0 }
    const next = { ...previous, ...patch }
    phases.set(sessionId, next)
    const changed = previous.phase !== next.phase
      || previous.handoffFile !== next.handoffFile
      || previous.newSessionId !== next.newSessionId
      || previous.note !== next.note
    if (changed) persist(sessionId, next)
    return next
  }

  function sessionCwd(session) {
    try {
      const workingDirectory = ctx.get('workingDirectory')
      if (workingDirectory !== undefined) return workingDirectory.get(session)
    } catch (error) {
      logger(`上下文守卫：解析会话目录失败：${describeError(error)}`)
    }
    return session.header.cwd ?? process.cwd()
  }

  function handoffFileFor(session) {
    const dir = path.resolve(sessionCwd(session), settings.current.handoffDir)
    return path.join(dir, `${formatStamp(Date.now())}-${shortId(session.id)}.md`)
  }

  function existingHandoff(session) {
    const dir = path.resolve(sessionCwd(session), settings.current.handoffDir)
    const token = shortId(session.id)
    try {
      for (const entry of fs.readdirSync(dir)) if (entry.includes(token) && entry.endsWith('.md')) return path.join(dir, entry)
    } catch (error) {
      if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') logger(`上下文守卫：扫描交接目录失败：${describeError(error)}`)
    }
    return undefined
  }

  // A continuation session records the source session and its handoff file in
  // the resume prompt, so a session that was handed off before this plugin copy
  // loaded can still be linked back to the conversation that continues it. When
  // one session was handed off more than once, the newest match wins.
  function continuationOf(sessionId, handoffFile) {
    const cacheKey = `${sessionId}\u0000${handoffFile ?? ''}`
    const cached = continuations.get(cacheKey)
    // A miss is cached only briefly: the continuation may still be loading.
    if (cached !== undefined && (cached.sessionId !== '' || Date.now() - cached.at <= 30000)) return cached.sessionId
    const marker = `${MARK} 这是上一会话 ${sessionId} 的交接延续`
    const fileLine = typeof handoffFile === 'string' && handoffFile !== '' ? `交接文件：${handoffFile}` : undefined
    let fallback = ''
    let found = ''
    try {
      const sessions = ctx.get('sessions')
      const list = sessions !== undefined && typeof sessions.list === 'function' ? sessions.list() : []
      for (let index = list.length - 1; index >= 0; index -= 1) {
        const other = list[index]
        if (other.id === sessionId) continue
        const hit = other.snapshotEvents().find((event) => event.type === 'user/message' && textOfBlocks(event.data?.content).includes(marker))
        if (hit === undefined) continue
        if (fileLine !== undefined && textOfBlocks(hit.data?.content).includes(fileLine)) {
          found = other.id
          break
        }
        if (fallback === '') fallback = other.id
      }
    } catch (error) {
      logger(`上下文守卫：查找接续会话失败：${describeError(error)}`)
    }
    const result = found !== '' ? found : fallback
    continuations.set(cacheKey, { sessionId: result, at: Date.now() })
    return result
  }

  function turnsOf(session) {
    return registry?.stateOf(session, KEY)?.turns ?? 0
  }

  function reachedLimit(turns) {
    return turns >= settings.current.maxRounds
  }

  // Memory wins; otherwise an expired phase leaves only the durable handoff file,
  // whose presence still proves this session was already handed off. Rows rebuilt
  // from that file are marked derived so a better continuation match can replace
  // the guessed one.
  function metaForSession(session, state) {
    const known = phases.get(session.id)
    if (known !== undefined) {
      if (known.phase === 'transferred' && known.derived === true) {
        const recovered = continuationOf(session.id, known.handoffFile)
        if (recovered !== known.newSessionId) return remember(session.id, { newSessionId: recovered })
      }
      return known
    }
    const turns = typeof state?.turns === 'number' ? state.turns : 0
    if (!reachedLimit(turns)) return undefined
    const file = existingHandoff(session)
    if (file === undefined) return undefined
    return remember(session.id, {
      phase: 'transferred',
      handoffFile: file,
      newSessionId: continuationOf(session.id, file),
      reason: `轮次 ${turns}/${settings.current.maxRounds}`,
      note: '已生成交接文件',
      derived: true,
    })
  }

  function handoffInstruction(file, reason, retry) {
    const lines = [
      `${MARK} 本会话已达到上限（${reason}），必须立刻把任务交接出去，再结束这一轮。`,
      '',
      '请严格按以下要求执行：',
      `1. 使用 write 工具把交接文件写入这个绝对路径：${file}`,
      '2. 交接文件用 Markdown，必须包含这些小节，且信息要具体到接手者不用回看本会话即可继续：',
      '   - 任务目标：用户原始需求与验收标准',
      '   - 当前进度：已完成的事项（含关键结论）',
      '   - 未完成事项：按优先级列出的下一步',
      '   - 关键文件：绝对路径 + 每个文件的作用 + 已做的改动',
      '   - 决策与约束：已定方案、被否决的方案、用户明确的偏好与禁止项',
      '   - 待确认问题：需要向用户澄清的点',
      '   - 环境信息：工作目录、运行命令、相关分支/任务号',
      '3. 只写这一份文件，不要继续原任务、不要开始新的探索、不要向用户提问。',
      '',
      `写完后只回复一行：交接完成: ${file}`,
    ]
    if (retry) lines.push('', '注意：上一轮没有在指定路径生成交接文件，这次必须先落盘文件再回复。')
    return lines.join('\n')
  }

  function resumePrompt(session, file, reason, fallback) {
    const lines = [
      `${MARK} 这是上一会话 ${session.id} 的交接延续。上一会话因 ${reason} 达到上限，已停止工作。`,
      `交接文件：${file}`,
      '',
      '请先读这个交接文件，确认任务目标、进度与下一步，然后直接继续执行任务。',
      '不要重复已完成的步骤，不要重新向用户索要已经提供过的信息。',
    ]
    if (fallback) lines.push('', '注意：交接文件由系统在模型未写入时自动生成，内容可能不完整。开始前先核对仓库与工作区现状，必要时再向用户确认。')
    return lines.join('\n')
  }

  function writeFallbackHandoff(session, file) {
    const userMessages = []
    let assistant = ''
    for (const event of session.snapshotEvents()) {
      if (event.type === 'user/message') {
        const text = textOfBlocks(event.data.content).trim()
        if (text !== '' && !text.startsWith(MARK)) userMessages.push(text)
      } else if (event.type === 'assistant/message') {
        const text = textOfBlocks(event.data.message.content).trim()
        if (text !== '') assistant = text
      }
    }
    const recent = userMessages.slice(-6)
    const clip = (text) => (text.length > 1200 ? `${text.slice(0, 1200)}…` : text)
    const body = [
      '# 会话交接（系统自动生成）',
      '',
      `- 原会话：${session.id}`,
      `- 生成时间：${new Date().toISOString()}`,
      `- 工作目录：${sessionCwd(session)}`,
      '- 说明：模型未按要求写入交接文件，以下内容由会话日志摘录，可能不完整。',
      '',
      '## 用户诉求（最近）',
      '',
      ...(recent.length === 0 ? ['（无）'] : recent.map((text, index) => `${index + 1}. ${clip(text)}`)),
      '',
      '## 最后一条助手回复',
      '',
      assistant === '' ? '（无）' : clip(assistant),
      '',
      '## 接手须知',
      '',
      '- 先核对仓库与工作区现状，再继续推进。',
      '- 未在本文档中体现的细节，需要向用户确认。',
      '',
    ].join('\n')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, body, 'utf8')
  }

  async function sendWhenIdle(agent, message) {
    if (typeof agent.whenIdle === 'function') {
      let timer
      const idle = Promise.resolve(agent.whenIdle()).catch(() => undefined)
      const bounded = new Promise((resolve) => {
        timer = setTimeout(resolve, 60000)
        timer.unref?.()
      })
      await Promise.race([idle, bounded]).finally(() => clearTimeout(timer))
    }
    agent.followup(message)
  }

  function selectedPreset(session) {
    try {
      const selected = ctx.get('sessionProjections')?.stateOf(session, 'agentPreset')
      if (typeof selected === 'string' && selected !== '') return selected
    } catch (error) {
      logger(`上下文守卫：读取会话预设失败：${describeError(error)}`)
    }
    return session.header.agentPreset
  }

  async function requestHandoff(session, reason) {
    const agent = ctx.get('agents')?.get(session.id)
    if (agent === undefined) {
      logger(`上下文守卫：会话 ${session.id} 没有 live agent，跳过交接`)
      return false
    }
    const current = metaForSession(session, registry?.stateOf(session, KEY))
    if (current !== undefined && current.phase !== 'reached' && current.phase !== 'failed') {
      logger(`上下文守卫：会话 ${session.id} 已在交接流程中（${current.phase}），忽略重复请求`)
      return false
    }
    const file = handoffFileFor(session)
    remember(session.id, {
      phase: 'awaiting-handoff',
      handoffFile: file,
      handoffAfterTurn: turnsOf(session),
      attempts: 0,
      reason,
    })
    try {
      await sendWhenIdle(agent, userTextMessage(handoffInstruction(file, reason, false)))
    } catch (error) {
      logger(`上下文守卫：注入交接指令失败：${describeError(error)}`)
      remember(session.id, { phase: 'failed', note: describeError(error) })
      return false
    }
    return true
  }

  async function retryHandoff(session, meta) {
    const agent = ctx.get('agents')?.get(session.id)
    if (agent === undefined) return false
    remember(session.id, { attempts: (meta.attempts ?? 0) + 1 })
    await sendWhenIdle(agent, userTextMessage(handoffInstruction(meta.handoffFile, meta.reason ?? '达到上限', true)))
    return true
  }

  async function createSessionAndContinue(session, file, reason, fallback) {
    const controller = ctx.get('sessionController')
    if (controller === undefined) {
      logger('上下文守卫：缺少 sessionController，无法创建接续会话')
      remember(session.id, { phase: 'failed', note: 'sessionController 不可用' })
      return
    }
    const created = await controller.create({
      cwd: sessionCwd(session),
      agentPreset: selectedPreset(session),
    })
    // Record the continuation before prompting: a crash between the two must not
    // let the next start create a fresh session for the same handoff.
    remember(session.id, { newSessionId: created.sessionId })
    try {
      const abort = new AbortController()
      await controller.prompt({
        requestId: globalThis.crypto.randomUUID(),
        sessionId: created.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: resumePrompt(session, file, reason, fallback) }],
      }, abort.signal)
    } catch (error) {
      logger(`上下文守卫：接续会话 ${created.sessionId} 已创建，但续接提示发送失败：${describeError(error)}`)
      remember(session.id, { phase: 'failed', note: `接续会话 ${created.sessionId} 已创建，但续接提示发送失败：${describeError(error)}` })
      return
    }
    remember(session.id, { phase: 'transferred', newSessionId: created.sessionId })
    logger(`上下文守卫：会话 ${session.id} 已交接给 ${created.sessionId}（${file}）`)
  }

  function scheduleTransfer(session, meta) {
    if (transfers.has(session.id)) return
    if (metaOf(session)?.phase === 'transferred') return
    remember(session.id, { phase: 'transferring' })
    const fallback = !fs.existsSync(meta.handoffFile)
    if (fallback) {
      try {
        writeFallbackHandoff(session, meta.handoffFile)
      } catch (error) {
        logger(`上下文守卫：写兜底交接文件失败：${describeError(error)}`)
      }
    }
    const task = createSessionAndContinue(session, meta.handoffFile, meta.reason ?? '达到上限', fallback)
      .catch((error) => {
        logger(`上下文守卫：创建接续会话失败：${describeError(error)}`)
        remember(session.id, { phase: 'failed', note: describeError(error) })
      })
      .finally(() => transfers.delete(session.id))
    transfers.set(session.id, task)
  }

  function onTurnEnd(session, turn) {
    if (!settings.current.enabled) return
    if (session.header.origin === 'subagent') return

    const meta = metaForSession(session, registry?.stateOf(session, KEY))
    if (meta?.phase === 'awaiting-handoff') {
      if (turn <= (meta.handoffAfterTurn ?? 0)) return
      if (!fs.existsSync(meta.handoffFile) && (meta.attempts ?? 0) < 1) {
        void retryHandoff(session, meta).catch((error) => {
          logger(`上下文守卫：重试交接失败：${describeError(error)}`)
          remember(session.id, { phase: 'failed', note: describeError(error) })
        })
        return
      }
      scheduleTransfer(session, meta)
      return
    }
    if (meta !== undefined && meta.phase !== 'idle') return

    const turns = turnsOf(session)
    if (!reachedLimit(turns)) return

    const previous = existingHandoff(session)
    if (previous !== undefined) {
      remember(session.id, {
        phase: 'transferred',
        handoffFile: previous,
        newSessionId: continuationOf(session.id, previous),
        note: '此前已生成交接文件',
        derived: true,
      })
      return
    }
    if (!settings.current.autoHandoff) {
      remember(session.id, { phase: 'reached', reason: `轮次 ${turns}/${settings.current.maxRounds}` })
      return
    }
    void requestHandoff(session, `轮次 ${turns}/${settings.current.maxRounds}`).catch((error) => {
      logger(`上下文守卫：请求交接失败：${describeError(error)}`)
      remember(session.id, { phase: 'failed', note: describeError(error) })
    })
  }

  // The session log dispatches `session/event` while its own append is still open;
  // appending from a listener throws, so every decision runs one microtask later.
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    const turn = event.data.turn
    queueMicrotask(() => {
      try {
        onTurnEnd(session, turn)
      } catch (error) {
        logger(`上下文守卫：轮次处理失败：${describeError(error)}`)
      }
    })
  })

  function mergedView(state) {
    const session = ctx.get('sessions')?.get(state.sessionId)
    const meta = session === undefined ? phases.get(state.sessionId) : metaForSession(session, state)
    return {
      turns: state.turns,
      phase: meta?.phase ?? state.phase,
      handoffFile: meta?.handoffFile ?? state.handoffFile,
      newSessionId: meta?.newSessionId ?? state.newSessionId,
      note: meta?.note ?? state.note,
      enabled: settings.current.enabled,
      autoHandoff: settings.current.autoHandoff,
      maxRounds: settings.current.maxRounds,
    }
  }

  const projectionDefinition = {
    key: KEY,
    stateVersion: 2,
    stateSchema: { parse: (value) => value },
    init: (header) => ({ sessionId: String(header.id), turns: 0, phase: 'idle', handoffFile: '', newSessionId: '', note: '' }),
    apply: (state, event) => {
      if (event.type === 'turn/start') {
        if (event.data.turn === state.turns) return state
        return { ...state, turns: event.data.turn }
      }
      if (event.type === 'turn/end') {
        const meta = phases.get(state.sessionId)
        return {
          ...state,
          phase: meta?.phase ?? 'idle',
          handoffFile: meta?.handoffFile ?? '',
          newSessionId: meta?.newSessionId ?? '',
          note: meta?.note ?? '',
        }
      }
      return state
    },
    wire: {
      viewSchema: { parse: (value) => value },
      view: (state) => mergedView(state),
    },
  }

  ctx.inject(['sessionProjections'], (projectionCtx) => {
    registry = projectionCtx.sessionProjections
    const disposeRegistration = registry.register(projectionDefinition)
    projectionCtx.effect(() => () => {
      registry = undefined
      disposeRegistration()
    })
  })

  function applySettingsPatch(patch) {
    const next = normalizeSettings(settings.current, patch)
    if (writeStoredSettings(next, logger)) settings.current = next
    return settings.current
  }

  const handler = async (request, response) => {
    try {
      const origin = request.headers.origin
      const site = request.headers['sec-fetch-site']
      if ((typeof origin === 'string' && origin !== '' && origin !== webOrigin()) || (typeof site === 'string' && site !== 'same-origin')) {
        sendJson(response, 403, { error: 'forbidden' })
        return
      }
      if (request.method === 'GET') {
        const url = new URL(request.url ?? ROUTE, 'http://localhost')
        const probe = url.searchParams.get('session')
        if (probe !== null) {
          const session = ctx.get('sessions')?.get(probe)
          if (session === undefined) {
            sendJson(response, 404, { error: '会话不在当前进程中' })
            return
          }
          const state = registry?.stateOf(session, KEY)
          const meta = metaForSession(session, state)
          sendJson(response, 200, {
            session: probe,
            guard: state === undefined && meta === undefined
              ? undefined
              : {
                  ...(state ?? { sessionId: probe }),
                  phase: meta?.phase ?? state?.phase ?? 'idle',
                  handoffFile: meta?.handoffFile ?? state?.handoffFile ?? '',
                  newSessionId: meta?.newSessionId ?? state?.newSessionId ?? '',
                  note: meta?.note ?? state?.note ?? '',
                },
            turns: turnsOf(session),
          })
          return
        }
        sendJson(response, 200, { settings: settings.current, file: settingsFile(), stateFile: stateFile(), source: import.meta.url })
        return
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      const body = await readJsonBody(request)
      if (body.action === 'settings') {
        const patch = {}
        for (const key of ['enabled', 'autoHandoff', 'maxRounds']) if (body[key] !== undefined) patch[key] = body[key]
        sendJson(response, 200, { settings: applySettingsPatch(patch) })
        return
      }
      if (body.action === 'handoff') {
        const session = ctx.get('sessions')?.get(typeof body.sessionId === 'string' ? body.sessionId : '')
        if (session === undefined) {
          sendJson(response, 404, { error: '会话不在当前进程中' })
          return
        }
        const turns = turnsOf(session)
        const reason = reachedLimit(turns) ? `轮次 ${turns}/${settings.current.maxRounds}` : `手动交接（轮次 ${turns}）`
        const started = await requestHandoff(session, reason)
        sendJson(response, started ? 200 : 409, started ? { started: true } : { error: '会话已在交接流程中或没有 live agent' })
        return
      }
      sendJson(response, 400, { error: `unknown action: ${String(body.action)}` })
    } catch (error) {
      sendJson(response, 500, { error: describeError(error) })
    }
  }

  ctx.inject(['webServer'], (webCtx) => {
    webServer = webCtx.webServer
    const disposeRoute = webCtx.webServer.register({ kind: 'exact', path: ROUTE, handler })
    webCtx.effect(() => () => {
      webServer = undefined
      disposeRoute()
    })
  })
}
