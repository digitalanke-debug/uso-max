import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit, Report, View } from '../types'

const PANE = 'uso-max'
const REFRESH_MS = 10 * 60 * 1000

const report = atom({ plugin: 'uso-max', key: 'report' } as const, null, { shape: 'report-1' })
const limits = atom({ plugin: 'uso-max', key: 'limits' } as const, [], { shape: 'limits-1' })
const view = atom({ plugin: 'uso-max', key: 'view' } as const, 'tipo')
const status = atom({ plugin: 'uso-max', key: 'status' } as const, 'sin datos')

const LABELS: Record<string, string> = {
  five_hour: 'Bloque de 5 horas',
  seven_day: 'Semana · todos los modelos',
  seven_day_opus: 'Semana · Opus',
  seven_day_sonnet: 'Semana · Sonnet',
  seven_day_fable: 'Semana · Fable',
  spend_limit: 'Límite de gasto',
}

const limitLabel = (kind: string) => LABELS[kind] ?? kind.replaceAll('_', ' ')

const resetsIn = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return 'se reinicia ya'
  const min = Math.round(ms / 60000)
  if (min < 60) return `se reinicia en ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `se reinicia en ${h} h ${min % 60} min`
  return `se reinicia en ${Math.round(h / 24)} días`
}

const TRACK = 'rgba(128,128,128,0.22)'
const PALETTE = ['#D97757', '#3987E5', '#1BAF7A', '#EDA100', '#9085E9', '#E87BA4', '#3DB8C5', '#E66767', '#8FA63A']

const hue = (pct: number) => (pct < 60 ? '#1BAF7A' : pct < 85 ? '#EDA100' : '#E34948')

const verdict = (pct: number) => (pct < 60 ? 'Con margen' : pct < 85 ? 'Ojo, va alto' : 'Casi al límite')

const bar = (pct: number, width: number) => {
  const w = Math.max(4, width)
  const fill = Math.min(w, Math.max(0, Math.round((pct / 100) * w)))
  return { fill: '█'.repeat(fill), rest: '░'.repeat(w - fill) }
}

const modelName = (m: string) =>
  m
    .replace('claude-', '')
    .replace(/-(\d)-(\d)$/, ' $1.$2')
    .replace(/^(\w)/, c => c.toUpperCase())

const sinceWeekStart = (list: Limit[], now: number) => {
  const week = list.find(l => l.kind.startsWith('seven_day') && l.resetsAt)
  const end = week?.resetsAt ? Date.parse(week.resetsAt) : NaN
  const start = Number.isFinite(end) ? end - 7 * 24 * 3600 * 1000 : now - 7 * 24 * 3600 * 1000
  return new Date(start).toISOString()
}

const statusLine = (list: Limit[]) => {
  if (list.length === 0) return 'Max · sin lectura de límites aún'
  const parts = list.map(l => {
    const short = l.kind === 'five_hour' ? '5h' : l.kind === 'seven_day' ? 'semana' : l.kind.replace('seven_day_', 'sem. ')
    const b = bar(l.percentUsed, 8)
    return `${short} ${b.fill}${b.rest} ${Math.round(l.percentUsed)}%`
  })
  return 'Max · ' + parts.join(' · ')
}

async function readLimits($: EngineInterface) {
  const usage = await $.session.usage()
  const list: Limit[] = usage.rateLimits.map(l => ({
    kind: l.kind,
    percentUsed: l.percentUsed,
    resetsAt: l.resetsAt,
  }))
  if (list.length > 0) await update($, limits, () => list)
  const current = list.length > 0 ? list : await read($, limits)
  $.ui.status(statusLine(current))
  return current
}

let isRunning = false

async function refresh($: EngineInterface) {
  if (isRunning) return
  isRunning = true
  try {
    await update($, status, () => 'analizando transcripts…')
    const now = await $.clock.now()
    const list = await readLimits($)
    const since = sinceWeekStart(list, now)
    const run = await $.process.run(
      ['python3', '-I', `${$.plugin.root}/scripts/analizar.py`, since],
      { timeoutMs: 5 * 60 * 1000 },
    )
    if (run.exitCode !== 0) {
      const why = run.stderr.trim().split('\n').pop() ?? `código ${run.exitCode}`
      await update($, status, () => `error al analizar: ${why.slice(0, 120)}`)
      return
    }
    const data = JSON.parse(run.stdout) as Report
    await update($, report, () => data)
    await update($, status, () => 'actualizado')
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    await update($, status, () => `error: ${why.slice(0, 120)}`)
  } finally {
    isRunning = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'uso',
      description: 'Abre el panel de uso del plan Max y lo actualiza',
    })
    void $.ui.open({ id: PANE, title: 'Uso del plan Max' })
    void refresh($)
    $.clock.every(REFRESH_MS, () => refresh($))
    return next(e)
  })

  on('command.run', { command: 'uso' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Uso del plan Max', focus: true })
    void refresh($)
    return { text: 'Panel de uso abierto; actualizando datos.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.rateLimits.length > 0) {
      const list: Limit[] = e.rateLimits.map(l => ({
        kind: l.kind,
        percentUsed: l.percentUsed,
        resetsAt: l.resetsAt,
      }))
      await update($, limits, () => list)
      $.ui.status(statusLine(list))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Svg = 'Svg' in table ? table.Svg : undefined
    const [data, list, current, state] = await Promise.all([
      read($, report),
      read($, limits),
      read($, view),
      read($, status),
    ])
    const cols = Math.max(36, e.props.bodyColumns ?? e.viewport?.columns ?? 60)
    const inner = cols - 6
    const px = Math.round(inner * 7.2)
    const now = Date.now()

    const meter = (pct: number, color: string, height: number, alt: string) => {
      const p = Math.min(100, Math.max(0, pct))
      if (Svg) {
        const w = Math.max(p > 0 ? 14 : 0, p * 10)
        const source =
          `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="10" viewBox="0 0 1000 10" preserveAspectRatio="none">` +
          `<rect x="0" y="0" width="1000" height="10" rx="10" ry="5" fill="${TRACK}"/>` +
          `<rect x="0" y="0" width="${w.toFixed(1)}" height="10" rx="10" ry="5" fill="${color}"/></svg>`
        return <Svg source={source} alt={alt} width={px} height={height} />
      }
      const b = bar(p, inner)
      return (
        <Text>
          <Text color={color}>{b.fill}</Text>
          <Text dimColor>{b.rest}</Text>
        </Text>
      )
    }

    const stacked = (parts: Array<[string, number, string]>, total: number) => {
      if (Svg) {
        let x = 0
        const rects = parts
          .map(([, v, c]) => {
            const w = (v / total) * 1000
            const r = `<rect x="${x.toFixed(1)}" y="0" width="${Math.max(0, w - 3).toFixed(1)}" height="10" fill="${c}"/>`
            x += w
            return r
          })
          .join('')
        const source =
          `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="10" viewBox="0 0 1000 10" preserveAspectRatio="none">` +
          `<defs><clipPath id="r"><rect x="0" y="0" width="1000" height="10" rx="10" ry="5"/></clipPath></defs>` +
          `<rect x="0" y="0" width="1000" height="10" rx="10" ry="5" fill="${TRACK}"/><g clip-path="url(#r)">${rects}</g></svg>`
        return <Svg source={source} alt="Reparto del gasto de la semana" width={px} height={14} />
      }
      return (
        <Text>
          {parts.map(([, v, c]) => (
            <Text color={c}>{'█'.repeat(Math.max(1, Math.round((v / total) * inner)))}</Text>
          ))}
        </Text>
      )
    }

    const raw =
      data === null
        ? []
        : current === 'tipo'
          ? data.groups
          : current === 'proyecto'
            ? data.projects
            : current === 'modelo'
              ? data.models.map(([k, v]) => [modelName(k), v] as [string, number])
              : data.days
    const rows = raw.map(([label, value], n) => [label, value, PALETTE[n % PALETTE.length] ?? '#888888'] as [string, number, string])
    const total = Math.max(1, data?.total_eff ?? 1)
    const shown = rows.reduce((sum, [, v]) => sum + v, 0)
    const max = Math.max(1, ...rows.map(([, v]) => v))

    const tabs: Array<[View, string, string]> = [
      ['tipo', 'Tipo', '1'],
      ['proyecto', 'Proyecto', '2'],
      ['modelo', 'Modelo', '3'],
      ['dia', 'Día', '4'],
    ]

    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text size="heading" weight="semibold">
            <Text color="claude">◆ </Text>Límites del plan
          </Text>
          <Text dimColor size="caption">
            Max
          </Text>
        </Box>

        {list.length === 0 && (
          <Text dimColor>Aún sin lectura: llega con la primera respuesta del modelo.</Text>
        )}
        {list.map(l => {
          const color = hue(l.percentUsed)
          return (
            <Box
              flexDirection="column"
              key={`lim-${l.kind}`}
              borderStyle="round"
              borderColor={color}
              paddingX={1}
            >
              <Box flexDirection="row" justifyContent="space-between" alignItems="center">
                <Text weight="medium" wrap="truncate">
                  {limitLabel(l.kind)}
                </Text>
                <Text tabular weight="bold" size="heading" color={color}>
                  {Math.round(l.percentUsed)}%
                </Text>
              </Box>
              {meter(l.percentUsed, color, 8, `${limitLabel(l.kind)}: ${Math.round(l.percentUsed)}% usado`)}
              <Box flexDirection="row" justifyContent="space-between">
                <Text dimColor size="caption">
                  {resetsIn(l.resetsAt, now)}
                </Text>
                <Text size="caption" color={color}>
                  {verdict(l.percentUsed)}
                </Text>
              </Box>
            </Box>
          )
        })}

        <Box flexDirection="row" justifyContent="space-between" alignItems="center" marginTop={1}>
          <Text size="heading" weight="semibold">
            <Text color="claude">◆ </Text>En qué se gastó
          </Text>
          <Button key="refresh" label="↻ Actualizar" hotkey="r" dimColor onPress={() => refresh($)} />
        </Box>

        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {tabs.map(([id, label, key]) => (
            <Button
              key={`tab-${id}`}
              label={label}
              hotkey={key}
              variant={current === id ? 'primary' : 'secondary'}
              onPress={() => update($, view, () => id)}
            />
          ))}
        </Box>

        {data === null && <Text dimColor>{state}</Text>}
        {data !== null && rows.length === 0 && (
          <Text dimColor>Todavía no hay consumo registrado en esta semana del plan.</Text>
        )}

        {rows.length > 0 && stacked(rows, Math.max(shown, 1))}

        {rows.length > 0 && (
          <Box flexDirection="column" gap={Svg ? 1 : 0}>
            {rows.map(([label, value, color]) => {
              const pct = (value / total) * 100
              return (
                <Box flexDirection="column" key={`row-${current}-${label}`}>
                  <Box flexDirection="row" justifyContent="space-between">
                    <Text wrap="truncate">
                      <Text color={color}>● </Text>
                      {label}
                    </Text>
                    <Text tabular weight="semibold" color={color}>
                      {pct < 1 ? '<1' : Math.round(pct)}%
                    </Text>
                  </Box>
                  {meter((value / max) * 100, color, 5, `${label}: ${Math.round(pct)}% del gasto`)}
                </Box>
              )
            })}
          </Box>
        )}

        {data !== null && (
          <Text dimColor size="caption">
            Semana desde {data.since.slice(0, 10)} · {data.sessions} sesiones · {data.turns} turnos ·{' '}
            {Math.round(data.total_eff / 1e6)} M tokens-eq · {state}
          </Text>
        )}
      </Box>
    )
  })
}
