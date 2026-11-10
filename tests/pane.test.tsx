import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'uso-max',
  component: 'Pane',
  requestId: 'uso-max',
  props: {
    title: 'Uso del plan Max',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const REPORT = {
  since: '2026-11-03T15:00:00+00:00',
  generatedAt: 1,
  sessions: 12,
  turns: 3490,
  total_eff: 254007981,
  groups: [['Subagentes (6)', 93007190], ['Instrucciones (system prompt y herramientas)', 56808468], ['Terminal (Bash)', 27788372]],
  projects: [['Proyecto Demo', 152751771], ['Sesiones generales (home)', 64981586]],
  models: [['claude-opus-5-5', 182515906], ['claude-sonnet-5-5', 63864641]],
  days: [['Mar 03', 203018130], ['Mié 04', 30889454]],
}

const wait = (ms: number) => new Promise<void>(done => { void mock.clock; const end = Date.now() + ms; const spin = (): void => { if (Date.now() >= end) done(); else void Promise.resolve().then(spin) }; spin() })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wire = (on: any) => {
  on('ui.status', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'uso' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: Date.now() }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 1000000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 4, resetsAt: new Date(Date.now() + 3 * 3600e3).toISOString() },
        { kind: 'seven_day', percentUsed: 53, resetsAt: new Date(Date.now() + 4 * 86400e3).toISOString() },
      ],
    },
  }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: JSON.stringify(REPORT), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
}

test('el panel dibuja límites y desglose en escritorio y terminal', async ($, on) => {
  wire(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await wait(300)

  for (const surface of ['desktop', 'terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Límites del plan/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Con margen/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Semana · todos los modelos/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /53%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Subagentes/ })).toBeDefined()
    await ui.press({ key: 'tab-proyecto' })
    expect(await ui.find({ type: 'Text', text: /Proyecto Demo/ })).toBeDefined()
    await ui.press({ key: 'tab-tipo' })
    await ui.unmount()
  }
})

test('el comando /uso abre el panel', async ($, on) => {
  wire(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ran = await $.command.run({ command: 'uso', args: '', origin: { kind: 'person' }, presentation: 'inline' } as never)
  expect(ran.text).toMatch(/Panel de uso/)
  await wait(300)
})
