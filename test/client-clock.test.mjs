import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

// The client half is a browser bundle: it registers a factory on the DSH module
// loader instead of exporting ES modules. Evaluate it once with just enough of
// a browser kernel to reach the pure clock formatters it exposes for this test.
function loadClock() {
  const source = fs.readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')
  let definition
  const window = {
    __ModuleLoader__: {
      load: (value) => { definition = value },
    },
    setInterval: () => 0,
    clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
  }
  const React = {
    createElement: () => null,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
  }
  vm.runInNewContext(source, { window, Date, console })
  if (definition === undefined) throw new Error('client bundle did not register a module definition')
  const exported = definition.factory((id) => {
    if (id === 'react') return React
    throw new Error(`unexpected require: ${id}`)
  })
  return exported.clock
}

const clock = loadClock()
const at = (day, hour, minute, second = 0) => new Date(2026, 10, day, hour, minute, second, 0).getTime()

describe('status clock formatting', () => {
  test('labels a same-day start with its wall clock, an older one with its date', () => {
    const startedAt = at(3, 14, 32, 5)
    expect(clock.startClockText(startedAt, at(3, 15, 0))).toBe('14:32')
    expect(clock.startClockText(startedAt, at(3, 23, 59))).toBe('14:32')
    expect(clock.startClockText(startedAt, at(4, 0, 1))).toBe('11-03 14:32')
    expect(clock.startClockText(at(2, 23, 50), at(3, 0, 5))).toBe('11-02 23:50')
  })

  test('renders the full start timestamp for the tooltip and assistive text', () => {
    expect(clock.fullClockText(at(3, 14, 32, 5))).toBe('2026-11-03 14:32:05')
    expect(clock.fullClockText(at(2, 0, 7, 59))).toBe('2026-11-02 00:07:59')
  })

  test('buckets the elapsed duration', () => {
    expect(clock.elapsedText(0)).toBe('0秒')
    expect(clock.elapsedText(59_999)).toBe('59秒')
    // Exactly one minute keeps the second field.
    expect(clock.elapsedText(60_000)).toBe('1分00秒')
    expect(clock.elapsedText(12 * 60_000 + 3_000)).toBe('12分03秒')
    expect(clock.elapsedText(59 * 60_000 + 59_000)).toBe('59分59秒')
    // An hour no longer flips shape: minutes are always shown.
    expect(clock.elapsedText(60 * 60_000)).toBe('1小时00分')
    expect(clock.elapsedText(65 * 60_000 + 30_000)).toBe('1小时05分')
  })

  test('clamps a backwards clock to zero', () => {
    expect(clock.elapsedText(-5_000)).toBe('0秒')
  })
})
