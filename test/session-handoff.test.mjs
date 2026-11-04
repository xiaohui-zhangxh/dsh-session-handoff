import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { apply } from '../index.js'

let tempRoots = []

function makeTempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `guard-${label}-`))
  tempRoots.push(dir)
  return dir
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

function shortId(id) {
  return String(id).replace(/[^a-zA-Z0-9]/g, '').slice(-8)
}

class TestHost {
  constructor({ home, cwd }) {
    this.home = home
    this.cwd = cwd
    this.sessionsById = new Map()
    this.agents = new Map()
    this.creates = []
    this.prompts = []
    this.renames = []
    this.logs = []
    this.workspaces = []
    this.createFailure = undefined
    this.renameFailure = undefined
    this.handler = undefined
    this.listeners = {}
    this.disposers = []
    this.projections = new Map()
    const self = this
    this.registry = {
      register: (definition) => {
        self.projections.set(definition.key, definition)
        return () => self.projections.delete(definition.key)
      },
      stateOf: (session, key) => {
        const definition = self.projections.get(key)
        if (definition === undefined) return undefined
        let state = definition.init(session.header, 0)
        for (const event of session.snapshotEvents()) state = definition.apply(state, event)
        return state
      },
    }
    self.projections.set('agentPreset', {
      key: 'agentPreset',
      init: (header) => header.agentPreset ?? null,
      apply: (state, event) => (event.type === 'agent-preset/selected' ? event.data.agentPreset : state),
    })
    self.projections.set('title', {
      key: 'title',
      init: () => null,
      apply: (state, event) => (event.type === 'session/title' ? event.data.title : state),
    })
    this.services = {
      sessions: { get: (id) => self.sessionsById.get(id), list: () => [...self.sessionsById.values()] },
      sessionProjections: this.registry,
      sessionController: {
        create: async (request) => {
          if (self.createFailure !== undefined && request.workspaceId !== undefined) {
            const error = new Error(self.createFailure.message)
            error.code = self.createFailure.code
            throw error
          }
          const sessionId = `session-cont-${self.creates.length + 1}-0000000000`
          self.creates.push({ ...request, createdId: sessionId })
          return { sessionId }
        },
        prompt: async (request) => {
          self.prompts.push(request)
          return { accepted: true }
        },
        rename: async (request) => {
          if (self.renameFailure !== undefined) throw self.renameFailure
          self.renames.push(request)
          return { title: request.title, seq: 0 }
        },
      },
      workingDirectory: { get: (session) => session.header.cwd },
      workspaceRegistry: {
        list: () => self.workspaces,
        get: (id) => self.workspaces.find((workspace) => workspace.id === id),
      },
      agents: { get: (id) => self.agents.get(id) },
      webServer: {
        register: ({ handler }) => {
          self.handler = handler
          return () => {}
        },
        getOrigin: () => 'http://127.0.0.1:1',
      },
    }
    this.ctx = {
      logger: { warn: (message) => self.logs.push(message) },
      on: (type, callback) => {
        self.listeners[type] = [...(self.listeners[type] ?? []), callback]
      },
      get: (name) => self.services[name],
      effect: (fn) => {
        self.disposers.push(fn())
      },
      inject: (deps, callback) => {
        const child = { ...self.ctx }
        for (const dep of deps) child[dep] = self.services[dep]
        callback(child)
      },
    }
  }

  load(config) {
    apply(this.ctx, config)
    return this
  }

  makeSession(id, extra = {}) {
    // An explicit null models a legacy header without a creation time; a
    // missing value takes the fixed default.
    const requested = extra.createdAt
    const createdAt = requested === null
      ? null
      : Number.isFinite(requested) ? requested : 1_700_000_000_000
    const header = { id, cwd: this.cwd, agentPreset: 'standard', origin: undefined, ...extra }
    if (createdAt === null) delete header.createdAt
    else header.createdAt = createdAt
    const session = {
      id,
      header,
      events: [],
      snapshotEvents() {
        return this.events
      },
    }
    this.sessionsById.set(id, session)
    return session
  }

  makeAgent(sessionId) {
    const agent = {
      followups: [],
      whenIdle: async () => {},
      followup(message) {
        agent.followups.push(message)
      },
    }
    this.agents.set(sessionId, agent)
    return agent
  }

  // One workspace record shaped like the Host's public Workspace interface:
  // membership is `sessionIds`, and the registry is the only lookup surface.
  makeWorkspace(id, sessionIds = []) {
    const workspace = { id, path: this.cwd, sessionIds }
    this.workspaces.push(workspace)
    return workspace
  }

  emit(session, event) {
    for (const callback of this.listeners['session/event'] ?? []) callback(session, event)
  }

  // `time` mirrors the durable event envelope timestamp the host stamps; the
  // run-time projection folds those spans.
  event(session, type, data, time = Date.now()) {
    const event = { type, seq: session.events.length, time, data }
    session.events.push(event)
    this.emit(session, event)
    return event
  }

  async turns(session, from, to) {
    for (let turn = from; turn <= to; turn += 1) {
      this.event(session, 'turn/start', { turn })
      this.event(session, 'user/message', { content: [{ type: 'text', text: `question ${turn}` }] })
      this.event(session, 'assistant/message', { message: { content: [{ type: 'text', text: `answer ${turn}` }] } })
      this.event(session, 'turn/end', { turn })
      await flush()
    }
  }

  // The plugin's projection view is what the Web client reads; exercise it the
  // way the real registry does (watermark fold then wire view).
  viewOf(session, overrides = {}) {
    const definition = this.projections.get('session-handoff')
    const projected = this.registry.stateOf(session, 'session-handoff')
    return definition.wire.view({ ...projected, ...overrides })
  }

  async send(request) {
    let status = 0
    let payload
    const response = {
      setHeader() {},
      end(value) {
        payload = JSON.parse(String(value))
      },
    }
    Object.defineProperty(response, 'statusCode', { get: () => status, set: (value) => { status = value } })
    await this.handler(request, response)
    return { status, body: payload }
  }

  async post(action, body = {}) {
    const chunks = [Buffer.from(JSON.stringify({ action, ...body }))]
    return this.send({
      method: 'POST',
      url: '/session-handoff/api',
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield* chunks
      },
    })
  }

  get(sessionId) {
    return this.send({
      method: 'GET',
      url: `/session-handoff/api?session=${encodeURIComponent(sessionId)}`,
      headers: {},
    })
  }
}

function instructionFile(followup) {
  const text = followup.content.map((block) => block.text).join('')
  const match = /交接文件写入这个绝对路径：(.+)/.exec(text)
  expect(match).not.toBeNull()
  return match[1].trim()
}

function writeHandoff(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '# handoff\n', 'utf8')
}

// Drive one complete handoff: turns up to the limit, the injected instruction
// turn, the handoff file it asks for, and the transfer turn.
async function handoffOnce(host, session, maxRounds = 10) {
  host.makeAgent(session.id)
  await host.turns(session, 1, maxRounds)
  const followup = host.agents.get(session.id).followups[0]
  const file = instructionFile(followup)
  writeHandoff(file)
  host.event(session, 'turn/start', { turn: maxRounds + 1 })
  host.event(session, 'turn/end', { turn: maxRounds + 1 })
  await flush()
  return file
}

function handoffDirFor(cwd) {
  return path.join(cwd, 'tmp', 'handoff')
}

function handoffFileFor(cwd, sessionId) {
  return path.join(handoffDirFor(cwd), `20261103-000000-${shortId(sessionId)}.md`)
}

function readStateFile(home) {
  return JSON.parse(fs.readFileSync(path.join(home, 'session-handoff.state.json'), 'utf8'))
}

beforeEach(() => {
  tempRoots = []
})

afterEach(() => {
  delete process.env.DSH_PROFILE_DIR
  for (const dir of tempRoots) fs.rmSync(dir, { recursive: true, force: true })
})

function setup(config) {
  const home = makeTempDir('home')
  const cwd = makeTempDir('cwd')
  process.env.DSH_PROFILE_DIR = home
  const host = new TestHost({ home, cwd }).load(config)
  return { home, cwd, host }
}

describe('session handoff', () => {
  test('hands off once and only once when the limit is reached', async () => {
    const { home, cwd, host } = setup({ enabled: true, autoHandoff: true, maxRounds: 10 })
    const session = host.makeSession('session-aaaabbbb-cccc-dddd-eeee-11112222aaaa')
    const agent = host.makeAgent(session.id)

    await host.turns(session, 1, 10)
    expect(agent.followups).toHaveLength(1)
    const file = instructionFile(agent.followups[0])
    expect(file).toContain(cwd)

    writeHandoff(file)
    host.event(session, 'turn/start', { turn: 11 })
    host.event(session, 'user/message', { content: [{ type: 'text', text: '[会话交接] 交接' }] })
    host.event(session, 'assistant/message', { message: { content: [{ type: 'text', text: `交接完成: ${file}` }] } })
    // The Host appends one turn/end per turn; a duplicated observation must not
    // spawn a second continuation.
    host.event(session, 'turn/end', { turn: 11 })
    host.event(session, 'turn/end', { turn: 11 })
    await flush()

    expect(host.creates).toHaveLength(1)
    expect(host.prompts).toHaveLength(1)
    expect(host.prompts[0].sessionId).toBe(host.creates[0].createdId)
    expect(host.viewOf(session).phase).toBe('transferred')

    // Coming back to the old session later produces further turns; none of them
    // may hand off again.
    await host.turns(session, 12, 13)
    expect(host.creates).toHaveLength(1)

    const stored = readStateFile(home).sessions[session.id]
    expect(stored.phase).toBe('transferred')
    expect(stored.newSessionId).toBe(host.creates[0].createdId)
  })

  test('a reloaded plugin never repeats the handoff (durable state)', async () => {
    const { home, cwd, host } = setup({ enabled: true, autoHandoff: true, maxRounds: 10 })
    const session = host.makeSession('session-aaaabbbb-cccc-dddd-eeee-33334444bbbb')
    const agent = host.makeAgent(session.id)
    await host.turns(session, 1, 10)
    const file = instructionFile(agent.followups[0])
    writeHandoff(file)
    host.event(session, 'turn/start', { turn: 11 })
    host.event(session, 'turn/end', { turn: 11 })
    await flush()
    expect(host.creates).toHaveLength(1)

    // Simulate a plugin reload: same home and live session, fresh in-memory phases.
    const rebooted = new TestHost({ home, cwd }).load({ enabled: true, autoHandoff: true, maxRounds: 10 })
    rebooted.sessionsById.set(session.id, session)
    rebooted.makeAgent(session.id)
    await rebooted.turns(session, 12, 12)
    expect(rebooted.creates).toHaveLength(0)
    expect(rebooted.viewOf(session).phase).toBe('transferred')
    expect(rebooted.viewOf(session).newSessionId).toBe(host.creates[0].createdId)
  })

  test('recovers a handoff that happened before this plugin copy loaded', async () => {
    const home = makeTempDir('home')
    const cwd = makeTempDir('cwd')
    process.env.DSH_PROFILE_DIR = home
    const host = new TestHost({ home, cwd }).load({ enabled: true, autoHandoff: true, maxRounds: 10 })
    const oldId = 'session-aaaabbbb-cccc-dddd-eeee-55556666cccc'
    const session = host.makeSession(oldId)
    await host.turns(session, 1, 10)
    const file = handoffFileFor(cwd, oldId)
    writeHandoff(file)
    host.event(session, 'turn/start', { turn: 11 })
    host.event(session, 'turn/end', { turn: 11 })

    // No state file on disk and no in-memory phase: only the handoff file and
    // the continuation's resume prompt prove the session was handed off.
    const restarted = new TestHost({ home, cwd }).load({ enabled: true, autoHandoff: true, maxRounds: 10 })
    // An older continuation from a previous, already-replaced handoff must not win
    // over the one whose resume prompt names this handoff file.
    const staleId = 'session-11112222-3333-4444-5555-666677778888aaa1'
    const stale = restarted.makeSession(staleId)
    stale.events.push({ type: 'user/message', data: { content: [{ type: 'text', text: `[会话交接] 这是上一会话 ${oldId} 的交接延续。\n交接文件：${path.join(cwd, 'tmp', 'handoff', 'old.md')}` }] } })
    const continuationId = 'session-99998888-7777-6666-5555-444433332222dddd'
    const continuation = restarted.makeSession(continuationId)
    continuation.events.push({ type: 'user/message', data: { content: [{ type: 'text', text: `[会话交接] 这是上一会话 ${oldId} 的交接延续。\n交接文件：${file}` }] } })
    restarted.sessionsById.set(oldId, session)

    const view = restarted.viewOf(session)
    expect(view.phase).toBe('transferred')
    expect(view.newSessionId).toBe(continuationId)
    restarted.makeAgent(oldId)
    await restarted.turns(session, 12, 12)
    expect(restarted.creates).toHaveLength(0)
    expect(readStateFile(home).sessions[oldId].phase).toBe('transferred')
  })

  test('keeps the selected agent preset for the continuation', async () => {
    const { cwd, host } = setup({ enabled: true, autoHandoff: true, maxRounds: 10 })
    const session = host.makeSession('session-aaaabbbb-cccc-dddd-eeee-77778888eeee')
    host.event(session, 'agent-preset/selected', { agentPreset: 'cordis' })
    const agent = host.makeAgent(session.id)
    await host.turns(session, 1, 10)
    const file = instructionFile(agent.followups[0])
    writeHandoff(file)
    host.event(session, 'turn/start', { turn: 11 })
    host.event(session, 'turn/end', { turn: 11 })
    await flush()
    expect(host.creates).toHaveLength(1)
    expect(host.creates[0].agentPreset).toBe('cordis')
    // An ungrouped session keeps the old behaviour: the continuation starts in
    // the same directory and stays ungrouped.
    expect(host.creates[0].workspaceId).toBeUndefined()
    expect(host.creates[0].cwd).toBe(cwd)
  })

  test('creates the continuation inside the current session workspace', async () => {
    const { host } = setup({ enabled: true, autoHandoff: true, maxRounds: 10 })
    const session = host.makeSession('session-aaaabbbb-cccc-dddd-eeee-123412341234')
    const workspace = host.makeWorkspace('workspace-1', [session.id])
    const agent = host.makeAgent(session.id)
    await host.turns(session, 1, 10)
    const file = instructionFile(agent.followups[0])
    writeHandoff(file)
    host.event(session, 'turn/start', { turn: 11 })
    host.event(session, 'turn/end', { turn: 11 })
    await flush()

    expect(host.creates).toHaveLength(1)
    // workspaceId and cwd are mutually exclusive for session.create; the
    // workspace also decides the new session's directory host-side.
    expect(host.creates[0].workspaceId).toBe(workspace.id)
    expect(host.creates[0].cwd).toBeUndefined()
    expect(host.prompts[0].sessionId).toBe(host.creates[0].createdId)
  })

  test('falls back to the working directory when the workspace disappears', async () => {
    const { cwd, host } = setup({ enabled: true, autoHandoff: true, maxRounds: 10 })
    const session = host.makeSession('session-aaaabbbb-cccc-dddd-eeee-432143214321')
    host.makeWorkspace('workspace-gone', [session.id])
    // The Host refuses the workspace before creating anything, so the retry is
    // the only Session that exists afterwards.
    host.createFailure = { code: 'workspace/not-found', message: 'workspace "workspace-gone" not found' }
    const agent = host.makeAgent(session.id)
    await host.turns(session, 1, 10)
    const file = instructionFile(agent.followups[0])
    writeHandoff(file)
    host.event(session, 'turn/start', { turn: 11 })
    host.event(session, 'turn/end', { turn: 11 })
    await flush()

    expect(host.creates).toHaveLength(1)
    expect(host.creates[0].workspaceId).toBeUndefined()
    expect(host.creates[0].cwd).toBe(cwd)
    expect(host.prompts).toHaveLength(1)
  })

  test('names the continuation from the source title and chain depth', async () => {
    const { host } = setup({ enabled: true, autoHandoff: true, maxRounds: 10 })
    const session = host.makeSession('session-aaaabbbb-cccc-dddd-eeee-a1b2c3d4e5f6')
    host.event(session, 'session/title', { title: '修复登录问题', messageSeqs: [], source: { kind: 'user' } })

    await handoffOnce(host, session)

    expect(host.renames).toEqual([{ sessionId: host.creates[0].createdId, title: '修复登录问题 第1次交接' }])
  })

  test('continues the handoff chain on the next session', async () => {
    const { host } = setup({ enabled: true, autoHandoff: true, maxRounds: 10 })
    const session = host.makeSession('session-aaaabbbb-cccc-dddd-eeee-b1c2d3e4f5a6')
    host.event(session, 'session/title', { title: '修复登录问题', messageSeqs: [], source: { kind: 'user' } })
    await handoffOnce(host, session)

    // The continuation carries the generated title; its next handoff must strip
    // the marker and advance the depth instead of nesting suffixes.
    const continuation = host.makeSession(host.creates[0].createdId)
    host.event(continuation, 'session/title', {
      title: host.renames[0].title,
      messageSeqs: [],
      source: { kind: 'user' },
    })
    await handoffOnce(host, continuation)

    expect(host.creates).toHaveLength(2)
    expect(host.renames[1]).toEqual({ sessionId: host.creates[1].createdId, title: '修复登录问题 第2次交接' })
  })

  test('falls back to a placeholder base when the source has no title', async () => {
    const { host } = setup({ enabled: true, autoHandoff: true, maxRounds: 10 })
    const session = host.makeSession('session-aaaabbbb-cccc-dddd-eeee-99887766aabb')

    await handoffOnce(host, session)

    expect(host.renames).toHaveLength(1)
    expect(host.renames[0].title).toMatch(/^会话 [A-Za-z0-9]{8} 第1次交接$/)
  })

  test('keeps the chain marker inside the title byte budget', async () => {
    const { host } = setup({ enabled: true, autoHandoff: true, maxRounds: 10 })
    const session = host.makeSession('session-aaaabbbb-cccc-dddd-eeee-ffeeddccbbaa')
    host.event(session, 'session/title', {
      title: '很长的标题'.repeat(30),
      messageSeqs: [],
      source: { kind: 'user' },
    })

    await handoffOnce(host, session)

    const title = host.renames[0].title
    expect(Buffer.byteLength(title, 'utf8')).toBeLessThanOrEqual(80)
    expect(title.endsWith(' 第1次交接')).toBe(true)
  })

  test('continues the handoff when naming the continuation fails', async () => {
    const { host } = setup({ enabled: true, autoHandoff: true, maxRounds: 10 })
    const session = host.makeSession('session-aaaabbbb-cccc-dddd-eeee-0f1e2d3c4b5a')
    host.renameFailure = new Error('title service unavailable')

    await handoffOnce(host, session)

    expect(host.logs.some((line) => line.includes('接续会话命名失败'))).toBe(true)
    expect(host.prompts).toHaveLength(1)
    expect(host.viewOf(session).phase).toBe('transferred')
  })

  test('projects the session start time for the status clock', async () => {
    const { host } = setup({ enabled: true, autoHandoff: true, maxRounds: 10 })
    const createdAt = 1_700_000_123_456
    const session = host.makeSession('session-aaaabbbb-cccc-dddd-eeee-aaaabbbbcccc', { createdAt })

    // The projection state owns the start time: its shape change must bump the
    // version, or a cached row written before the field existed would be served
    // as current.
    expect(host.projections.get('session-handoff').stateVersion).toBe(3)
    expect(host.viewOf(session).startedAt).toBe(createdAt)
    await host.turns(session, 1, 2)
    expect(host.viewOf(session).startedAt).toBe(createdAt)
    expect(host.viewOf(session).turns).toBe(2)

    // The read-only probe keeps its existing contract and exposes the same
    // value to every consumer.
    const probe = await host.get(session.id)
    expect(probe.status).toBe(200)
    expect(probe.body.startedAt).toBe(createdAt)
    expect(probe.body.guard.startedAt).toBe(createdAt)
    expect(probe.body.turns).toBe(2)
    expect(probe.body.guard.turns).toBe(2)
    expect(probe.body.guard.phase).toBe('idle')
    expect(probe.body.runMs).toBe(host.viewOf(session).runMs)
    expect(probe.body.guard.runMs).toBe(host.viewOf(session).runMs)
    expect(probe.body.runStartedAt).toBe(0)
    expect(probe.body.guard.runStartedAt).toBe(0)
    expect(probe.body.lastTurnEndedAt).toBe(host.viewOf(session).lastTurnEndedAt)
    expect(probe.body.guard.lastTurnEndedAt).toBe(host.viewOf(session).lastTurnEndedAt)
    expect(probe.body.lastTurnEndedAt).toBeGreaterThan(0)

    // With the session no longer live, only the persisted projection state can
    // answer: this fails if init never stores the creation time.
    host.sessionsById.delete(session.id)
    expect(host.viewOf(session).startedAt).toBe(createdAt)
  })

  test('sums turn run time and ignores idle gaps', () => {
    const { host } = setup({ enabled: true, autoHandoff: true, maxRounds: 50 })
    const session = host.makeSession('session-aaaabbbb-cccc-dddd-eeee-aaaabbbbdddd', { createdAt: 1_700_000_000_000 })
    const base = 1_700_000_000_000

    // The open turn is exposed by its start; only a closed turn contributes.
    host.event(session, 'turn/start', { turn: 1 }, base)
    expect(host.viewOf(session).runMs).toBe(0)
    expect(host.viewOf(session).runStartedAt).toBe(base)
    expect(host.viewOf(session).lastTurnEndedAt).toBe(0)
    host.event(session, 'turn/end', { turn: 1 }, base + 1_500)
    expect(host.viewOf(session).runMs).toBe(1_500)
    expect(host.viewOf(session).runStartedAt).toBe(0)
    expect(host.viewOf(session).lastTurnEndedAt).toBe(base + 1_500)

    // A one-hour idle gap between turns is not billed.
    host.event(session, 'turn/start', { turn: 2 }, base + 3_600_000)
    expect(host.viewOf(session).runMs).toBe(1_500)
    expect(host.viewOf(session).lastTurnEndedAt).toBe(base + 1_500)
    host.event(session, 'turn/end', { turn: 2 }, base + 3_600_000 + 2_500)
    expect(host.viewOf(session).runMs).toBe(4_000)
    expect(host.viewOf(session).lastTurnEndedAt).toBe(base + 3_600_000 + 2_500)

    // A duplicated `turn/end` never counts the same span twice.
    host.event(session, 'turn/end', { turn: 2 }, base + 3_600_000 + 2_500)
    expect(host.viewOf(session).runMs).toBe(4_000)
    expect(host.viewOf(session).lastTurnEndedAt).toBe(base + 3_600_000 + 2_500)

    // A turn that never ended (crash/abort) is dropped instead of being
    // stretched until the next task starts.
    host.event(session, 'turn/start', { turn: 3 }, base + 7_200_000)
    host.event(session, 'turn/start', { turn: 4 }, base + 7_200_000 + 800)
    expect(host.viewOf(session).runMs).toBe(4_000)
    expect(host.viewOf(session).runStartedAt).toBe(base + 7_200_000 + 800)
    expect(host.viewOf(session).lastTurnEndedAt).toBe(base + 3_600_000 + 2_500)
    expect(host.viewOf(session).turns).toBe(4)
  })

  test('reports no start time for a legacy session header', async () => {
    const { host } = setup({ enabled: true, autoHandoff: true, maxRounds: 10 })
    const session = host.makeSession('session-aaaabbbb-cccc-dddd-eeee-ddddeeeeffff', { createdAt: null })

    expect(session.header.createdAt).toBeUndefined()
    expect(host.viewOf(session).startedAt).toBe(0)
    const probe = await host.get(session.id)
    expect(probe.status).toBe(200)
    expect(probe.body.startedAt).toBe(0)
  })

  test('refuses a second handoff request while a transfer is pending', async () => {
    const { host } = setup({ enabled: true, autoHandoff: true, maxRounds: 10 })
    const session = host.makeSession('session-aaaabbbb-cccc-dddd-eeee-99990000ffff')
    const agent = host.makeAgent(session.id)
    await host.turns(session, 1, 5)
    const first = await host.post('handoff', { sessionId: session.id })
    expect(first.status).toBe(200)
    expect(agent.followups).toHaveLength(1)
    const second = await host.post('handoff', { sessionId: session.id })
    expect(second.status).toBe(409)
    expect(agent.followups).toHaveLength(1)
  })
})
