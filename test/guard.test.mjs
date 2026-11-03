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
    this.logs = []
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
    this.services = {
      sessions: { get: (id) => self.sessionsById.get(id), list: () => [...self.sessionsById.values()] },
      sessionProjections: this.registry,
      sessionController: {
        create: async (request) => {
          const sessionId = `session-cont-${self.creates.length + 1}-0000000000`
          self.creates.push({ ...request, createdId: sessionId })
          return { sessionId }
        },
        prompt: async (request) => {
          self.prompts.push(request)
          return { accepted: true }
        },
      },
      workingDirectory: { get: (session) => session.header.cwd },
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
    const session = {
      id,
      header: { id, cwd: this.cwd, agentPreset: 'standard', origin: undefined, ...extra },
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

  emit(session, event) {
    for (const callback of this.listeners['session/event'] ?? []) callback(session, event)
  }

  event(session, type, data) {
    const event = { type, seq: session.events.length, data }
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
    const definition = this.projections.get('context-guard')
    const projected = this.registry.stateOf(session, 'context-guard')
    return definition.wire.view({ ...projected, ...overrides })
  }

  async post(action, body = {}) {
    const chunks = [Buffer.from(JSON.stringify({ action, ...body }))]
    const request = {
      method: 'POST',
      url: '/context-guard/api',
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield* chunks
      },
    }
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

function handoffDirFor(cwd) {
  return path.join(cwd, 'tmp', 'handoff')
}

function handoffFileFor(cwd, sessionId) {
  return path.join(handoffDirFor(cwd), `20261103-000000-${shortId(sessionId)}.md`)
}

function readStateFile(home) {
  return JSON.parse(fs.readFileSync(path.join(home, 'context-guard.state.json'), 'utf8'))
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

describe('context guard handoff', () => {
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
    host.event(session, 'user/message', { content: [{ type: 'text', text: '[上下文守卫] 交接' }] })
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
    stale.events.push({ type: 'user/message', data: { content: [{ type: 'text', text: `[上下文守卫] 这是上一会话 ${oldId} 的交接延续。\n交接文件：${path.join(cwd, 'tmp', 'handoff', 'old.md')}` }] } })
    const continuationId = 'session-99998888-7777-6666-5555-444433332222dddd'
    const continuation = restarted.makeSession(continuationId)
    continuation.events.push({ type: 'user/message', data: { content: [{ type: 'text', text: `[上下文守卫] 这是上一会话 ${oldId} 的交接延续。\n交接文件：${file}` }] } })
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
    const { host } = setup({ enabled: true, autoHandoff: true, maxRounds: 10 })
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
