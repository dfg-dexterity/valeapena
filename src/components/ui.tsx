import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  Copy,
  FileDown,
  GraduationCap,
  HelpCircle,
  Lightbulb,
  Printer,
  SlidersHorizontal,
} from 'lucide-react'
import { useTheme } from '../theme'

/* ============================================================
   Blocos de layout
   ============================================================ */

export function Card({
  title,
  subtitle,
  right,
  children,
  className = '',
}: {
  title?: ReactNode
  subtitle?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`themed rounded-2xl border border-line bg-surface p-5 ${className}`}>
      {(title || right) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-mute">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 mt-1 text-[11px] font-semibold uppercase tracking-wider text-mute">
      {children}
    </h3>
  )
}

/** Colapsável para "premissas avançadas". */
export function Collapse({
  title,
  children,
  defaultOpen = false,
}: {
  title: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div data-collapse={open ? 'open' : 'closed'} className="rounded-xl border border-line">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-xs font-semibold text-ink-2 hover:text-ink"
      >
        {title}
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-line px-4 py-4">{children}</div>}
    </div>
  )
}

/* ============================================================
   Inputs
   ============================================================ */

function FieldShell({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: ReactNode
  hint?: string
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <label htmlFor={htmlFor} className="text-xs font-medium text-ink-2">
          {label}
        </label>
        {hint && <InfoTip text={hint} />}
      </div>
      {children}
    </div>
  )
}

/** Tooltip "?" com explicação da premissa. */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <HelpCircle size={13} className="cursor-help text-mute" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-60 -translate-x-1/2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-ink-2 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  )
}

/**
 * Campo principal do app: slider + valor editável.
 * `format` controla a exibição do valor (ex.: brl, pct).
 */
export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
  hint,
  parse,
}: {
  label: ReactNode
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  format: (v: number) => string
  hint?: string
  /** parse do texto digitado; default: número pt-BR */
  parse?: (s: string) => number
}) {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const fill = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0

  const commit = () => {
    setEditing(false)
    const parser = parse ?? defaultParse
    const v = parser(draft)
    if (!Number.isFinite(v)) return
    // snap ao step (evita valores tipo 37,5 num slider de step 1)
    const snapped = step > 0 ? min + Math.round((v - min) / step) * step : v
    const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(step || 1)) + 1))
    onChange(clamp(parseFloat(snapped.toFixed(decimals)), min, max))
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <label htmlFor={id} className="text-xs font-medium text-ink-2">
            {label}
          </label>
          {hint && <InfoTip text={hint} />}
        </div>
        {editing ? (
          <input
            autoFocus
            className="w-28 rounded-md border border-accent bg-surface-2 px-2 py-0.5 text-right text-xs font-semibold text-ink outline-none"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(String(value).replace('.', ','))
              setEditing(true)
            }}
            className="rounded-md px-1.5 py-0.5 text-xs font-semibold tnum text-ink hover:bg-surface-2"
            title="Clique para digitar"
          >
            {format(value)}
          </button>
        )}
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--fill' as never]: `${fill}%` }}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full"
      />
    </div>
  )
}

function defaultParse(s: string): number {
  const cleaned = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  return parseFloat(cleaned)
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

/** Campo numérico simples com sufixo (ex.: "meses", "km"). */
export function NumberField({
  label,
  value,
  onChange,
  suffix,
  hint,
  min,
  max,
  step = 1,
}: {
  label: ReactNode
  value: number
  onChange: (v: number) => void
  suffix?: string
  hint?: string
  min?: number
  max?: number
  step?: number
}) {
  const id = useId()
  return (
    <FieldShell label={label} hint={hint} htmlFor={id}>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 focus-within:border-accent">
        <input
          id={id}
          type="number"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className="w-full bg-transparent text-sm font-semibold tnum text-ink outline-none"
        />
        {suffix && <span className="shrink-0 text-xs text-mute">{suffix}</span>}
      </div>
    </FieldShell>
  )
}

/** Controle segmentado (ex.: SAC × Price, Presencial × Híbrido × Remoto). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  hint,
}: {
  options: Array<{ value: T; label: ReactNode }>
  value: T
  onChange: (v: T) => void
  label?: ReactNode
  hint?: string
}) {
  const body = (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-line bg-surface-2 p-1">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
            value === o.value ? 'bg-accent text-accent-ink shadow-sm' : 'text-ink-2 hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
  if (!label) return body
  return (
    <FieldShell label={label} hint={hint}>
      {body}
    </FieldShell>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  hint?: string
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
      <span className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
        {label}
        {hint && <InfoTip text={hint} />}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-surface-3'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`}
        />
      </button>
    </label>
  )
}

/* ============================================================
   Saídas
   ============================================================ */

/** Número animado (count-up suave ao mudar). */
export function AnimatedNumber({ value, format }: { value: number; format: (v: number) => string }) {
  const [display, setDisplay] = useState(value)
  const raf = useRef(0)
  const fromRef = useRef(value)
  useEffect(() => {
    const from = fromRef.current
    const to = value
    if (from === to || !Number.isFinite(from) || !Number.isFinite(to)) {
      fromRef.current = to
      setDisplay(to)
      return
    }
    const start = performance.now()
    const dur = 350
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(from + (to - from) * eased)
      if (p < 1) raf.current = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    raf.current = requestAnimationFrame(tick)
    // aba oculta pausa o rAF — garante que o valor final sempre chega
    const fallback = setTimeout(() => {
      cancelAnimationFrame(raf.current)
      fromRef.current = to
      setDisplay(to)
    }, dur + 150)
    return () => {
      cancelAnimationFrame(raf.current)
      clearTimeout(fallback)
    }
  }, [value])
  return <span>{format(display)}</span>
}

/** Tile de estatística: rótulo + valor + contexto. */
export function StatTile({
  label,
  value,
  format,
  sub,
  tone = 'neutral',
}: {
  label: ReactNode
  value: number
  format: (v: number) => string
  sub?: ReactNode
  tone?: 'neutral' | 'positive' | 'negative' | 'accent'
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-positive'
      : tone === 'negative'
        ? 'text-negative'
        : tone === 'accent'
          ? 'text-accent'
          : 'text-ink'
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
      <div className="text-[11px] font-medium text-mute">{label}</div>
      <div className={`mt-1 text-xl font-bold ${toneClass}`}>
        <AnimatedNumber value={value} format={format} />
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-mute">{sub}</div>}
    </div>
  )
}

/**
 * O veredito — a resposta do app à pergunta "vale a pena?".
 * `winner` é a opção vencedora; `detail` explica em uma frase o porquê.
 */
export function Verdict({
  winner,
  detail,
  tone = 'positive',
  badge,
}: {
  winner: ReactNode
  detail: ReactNode
  tone?: 'positive' | 'negative' | 'neutral'
  badge?: ReactNode
}) {
  const styles =
    tone === 'positive'
      ? 'border-positive/40 bg-positive-soft'
      : tone === 'negative'
        ? 'border-negative/40 bg-negative-soft'
        : 'border-line-strong bg-surface-2'
  const dot = tone === 'positive' ? 'bg-positive' : tone === 'negative' ? 'bg-negative' : 'bg-mute'
  return (
    <div className={`themed rounded-2xl border p-5 ${styles}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-mute">Veredito</span>
        {badge && (
          <span className="ml-auto rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11px] font-semibold text-ink-2">
            {badge}
          </span>
        )}
      </div>
      <div className="mt-2 text-xl font-bold leading-snug text-ink">{winner}</div>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{detail}</p>
    </div>
  )
}

/** Tabela de dados compacta. */
export function DataTable({
  columns,
  rows,
  align = [],
}: {
  columns: ReactNode[]
  rows: ReactNode[][]
  /** 'r' para alinhar coluna à direita */
  align?: Array<'l' | 'r'>
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line bg-surface-2">
            {columns.map((c, i) => (
              <th
                key={i}
                className={`px-3 py-2 font-semibold text-mute ${align[i] === 'r' ? 'text-right' : 'text-left'}`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0 hover:bg-surface-2/60">
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={`px-3 py-2 tnum text-ink-2 ${align[j] === 'r' ? 'text-right' : 'text-left'}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Chip de fonte de dado ao vivo (BCB). */
export function LiveBadge({ live, referencia }: { live: boolean; referencia: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-ink-2">
      <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-positive live-dot' : 'bg-mute'}`} />
      {live ? 'Taxas ao vivo · BCB' : 'Taxas de referência'} · {referencia}
    </span>
  )
}

/* ============================================================
   Exportação (PDF/impressão, CSV, resumo)
   ============================================================ */

/**
 * Imprime a página sempre no tema claro: se o tema atual for dark,
 * troca para light, espera o re-render dos gráficos (~450 ms),
 * chama `window.print()` e restaura o tema no `afterprint`.
 */
export function usePrintExport() {
  const { theme, set } = useTheme()
  return useCallback(() => {
    if (theme === 'dark') {
      const restore = () => {
        set('dark')
        window.removeEventListener('afterprint', restore)
      }
      window.addEventListener('afterprint', restore)
      set('light')
      window.setTimeout(() => window.print(), 450)
    } else {
      window.print()
    }
  }, [theme, set])
}

function csvCell(v: string | number): string {
  const s = typeof v === 'number' ? String(v).replace('.', ',') : v
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function tituloDoSlug(slug: string): string {
  const s = slug.replace(/-/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Barra de exportação: PDF/imprimir, CSV (Excel pt-BR) e copiar resumo.
 * Inclui um cabeçalho `.print-only` (logo Dexterity + título + data +
 * premissas) visível apenas na impressão.
 */
export function ExportBar({
  pagina,
  resumo,
  csv,
  premissas,
}: {
  /** slug para nome de arquivo (ex.: "morar") */
  pagina: string
  /** texto multi-linha pronto para a área de transferência */
  resumo: string
  csv?: { nome: string; colunas: string[]; linhas: (string | number)[][] }
  premissas?: [string, string][]
}) {
  const print = usePrintExport()
  const [copiado, setCopiado] = useState(false)

  const baixarCsv = useCallback(() => {
    if (!csv) return
    const linhas = [csv.colunas, ...csv.linhas]
    const corpo = linhas.map(l => l.map(csvCell).join(';')).join('\r\n')
    // BOM para o Excel pt-BR reconhecer UTF-8; separador ";" e decimais com vírgula
    const blob = new Blob(['\ufeff' + corpo], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${pagina}-${csv.nome}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [csv, pagina])

  const copiar = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(resumo)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      /* clipboard indisponível */
    }
  }, [resumo])

  const btn =
    'flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink'

  return (
    <>
      <div className="print-hide flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-mute">
          Exportar
        </span>
        <button type="button" onClick={print} className={btn}>
          <Printer size={13} />
          PDF / imprimir
        </button>
        {csv && (
          <button type="button" onClick={baixarCsv} className={btn}>
            <FileDown size={13} />
            CSV
          </button>
        )}
        <button type="button" onClick={copiar} className={btn}>
          <Copy size={13} />
          {copiado ? 'Copiado ✓' : 'Copiar resumo'}
        </button>
      </div>
      <div className="print-only">
        <div className="mb-4 flex items-center justify-between gap-4 border-b border-line pb-3">
          <img src="/brand/logo-cor.svg" alt="Dexterity" style={{ height: 28 }} />
          <div className="text-right">
            <div className="font-display text-base font-bold text-ink">
              vale a pena? · {tituloDoSlug(pagina)}
            </div>
            <div className="text-[11px] text-mute">
              gerado em {new Date().toLocaleDateString('pt-BR')}
            </div>
          </div>
        </div>
        {premissas && premissas.length > 0 && (
          <div className="mb-4">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-mute">
              Premissas usadas
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {premissas.map(([k, v], i) => (
                <div key={i} className="flex justify-between gap-3 text-[11px]">
                  <span className="text-ink-2">{k}</span>
                  <span className="tnum font-semibold text-ink">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

/* ============================================================
   Didática — "Entenda o resultado"
   ============================================================ */

/**
 * Card educativo posicionado no fim dos resultados (antes de premissas/
 * fontes): passo a passo numerado + analogia + sensibilidade.
 */
export function Didatico({
  passos,
  analogia,
  sensibilidade,
}: {
  passos: { t: string; d: ReactNode }[]
  analogia?: ReactNode
  sensibilidade?: ReactNode
}) {
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <GraduationCap size={15} className="text-accent" />
          Entenda o resultado
        </span>
      }
    >
      <ol className="space-y-3">
        {passos.map((p, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold tnum text-accent">
              {i + 1}
            </span>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-ink">{p.t}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-ink-2">{p.d}</div>
            </div>
          </li>
        ))}
      </ol>
      {analogia && (
        <div className="mt-4 rounded-xl bg-surface-2 p-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Lightbulb size={13} className="text-warning" />
            Em outras palavras…
          </div>
          <div className="text-xs leading-relaxed text-ink-2">{analogia}</div>
        </div>
      )}
      {sensibilidade && (
        <div className="mt-3 rounded-xl border border-line p-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink">
            <SlidersHorizontal size={13} className="text-accent" />
            O que mudaria a resposta
          </div>
          <div className="text-xs leading-relaxed text-ink-2">{sensibilidade}</div>
        </div>
      )}
    </Card>
  )
}

/** Layout padrão de página de ferramenta: título + descrição + grid inputs/resultados. */
export function ToolPage({
  icon,
  title,
  description,
  inputs,
  results,
}: {
  icon: ReactNode
  title: ReactNode
  description: ReactNode
  inputs: ReactNode
  results: ReactNode
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8">
      <header className="animate-fadeup mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            {icon}
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink">{title}</h1>
            <p className="mt-0.5 text-sm text-mute">{description}</p>
          </div>
        </div>
      </header>
      <div className="tool-grid grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="print-hide animate-fadeup-1 space-y-4 lg:sticky lg:top-20 lg:self-start">
          {inputs}
        </div>
        <div className="animate-fadeup-2 min-w-0 space-y-5">{results}</div>
      </div>
    </div>
  )
}
