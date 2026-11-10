export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Row = [string, number]
export type Report = {
  since: string
  generatedAt: number
  sessions: number
  turns: number
  total_eff: number
  groups: Row[]
  projects: Row[]
  models: Row[]
  days: Row[]
}
export type View = 'tipo' | 'proyecto' | 'modelo' | 'dia'

declare module 'claude-code' {
  interface PluginState {
    'uso-max': {
      report: Shaped<Report | null>
      limits: Shaped<Limit[]>
      view: View
      status: string
    }
  }
}
