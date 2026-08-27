/**
 * Wrappers de gráfico (Recharts) com o tema do app.
 * Specs: linhas 2px, marcas finas, grid hairline recessivo, tooltip padrão,
 * legenda sempre presente para ≥2 séries, texto em tokens de tinta (nunca na cor da série).
 */
import type { ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useVizColors } from '../theme'

export interface SeriesDef {
  key: string
  name: string
  /** índice na paleta categórica (ordem fixa) */
  colorIndex?: number
  /** cor explícita (sobrepõe colorIndex) */
  color?: string
}

interface TooltipRowPayload {
  name?: string | number
  value?: number | string | Array<number | string>
  color?: string
  dataKey?: string | number
}

export function ChartTooltip({
  active,
  payload,
  label,
  labelFormat,
  valueFormat,
}: {
  active?: boolean
  payload?: TooltipRowPayload[]
  label?: string | number
  labelFormat?: (l: string | number) => ReactNode
  valueFormat: (v: number) => string
}) {
  const c = useVizColors()
  if (!active || !payload?.length) return null
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-xl"
      style={{ background: c.surface, borderColor: c.grid }}
    >
      {label !== undefined && (
        <div className="mb-1 font-semibold" style={{ color: c.ink }}>
          {labelFormat ? labelFormat(label) : label}
        </div>
      )}
      <div className="space-y-0.5">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5" style={{ color: c.ink2 }}>
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-semibold tnum" style={{ color: c.ink }}>
              {typeof p.value === 'number' ? valueFormat(p.value) : String(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const legendStyle = { fontSize: 11, paddingTop: 8 }

/** Gráfico de linhas padrão (≥1 série). */
export function VLineChart({
  data,
  series,
  xKey,
  xFormat,
  yFormat,
  height = 280,
  refY,
  refYLabel,
}: {
  data: Array<Record<string, number | string>>
  series: SeriesDef[]
  xKey: string
  xFormat?: (v: string | number) => string
  yFormat: (v: number) => string
  height?: number
  /** linha de referência horizontal (ex.: break-even) */
  refY?: number
  refYLabel?: string
}) {
  const c = useVizColors()
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={c.grid} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey={xKey}
          tickFormatter={xFormat}
          stroke={c.axis}
          tick={{ fill: c.mute, fontSize: 11 }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={yFormat}
          stroke="transparent"
          tick={{ fill: c.mute, fontSize: 11 }}
          tickLine={false}
          width={64}
        />
        <Tooltip
          content={<ChartTooltip valueFormat={yFormat} labelFormat={xFormat} />}
          cursor={{ stroke: c.axis, strokeWidth: 1 }}
        />
        {series.length > 1 && <Legend wrapperStyle={legendStyle} iconType="plainline" />}
        {refY !== undefined && (
          <ReferenceLine
            y={refY}
            stroke={c.mute}
            strokeDasharray="4 3"
            label={{ value: refYLabel, fill: c.mute, fontSize: 10, position: 'insideTopRight' }}
          />
        )}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color ?? c.series[s.colorIndex ?? i]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Gráfico de área (wash ~10% de opacidade). */
export function VAreaChart({
  data,
  series,
  xKey,
  xFormat,
  yFormat,
  height = 280,
  stacked = false,
}: {
  data: Array<Record<string, number | string>>
  series: SeriesDef[]
  xKey: string
  xFormat?: (v: string | number) => string
  yFormat: (v: number) => string
  height?: number
  stacked?: boolean
}) {
  const c = useVizColors()
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={c.grid} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey={xKey}
          tickFormatter={xFormat}
          stroke={c.axis}
          tick={{ fill: c.mute, fontSize: 11 }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={yFormat}
          stroke="transparent"
          tick={{ fill: c.mute, fontSize: 11 }}
          tickLine={false}
          width={64}
        />
        <Tooltip
          content={<ChartTooltip valueFormat={yFormat} labelFormat={xFormat} />}
          cursor={{ stroke: c.axis, strokeWidth: 1 }}
        />
        {series.length > 1 && <Legend wrapperStyle={legendStyle} iconType="plainline" />}
        {series.map((s, i) => {
          const color = s.color ?? c.series[s.colorIndex ?? i]
          return (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={color}
              strokeWidth={2}
              fill={color}
              fillOpacity={0.1}
              stackId={stacked ? 'a' : undefined}
              dot={false}
              activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }}
            />
          )
        })}
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** Barras (verticais) — ≤24px, ponta arredondada, gap de superfície. */
export function VBarChart({
  data,
  series,
  xKey,
  xFormat,
  yFormat,
  height = 280,
  stacked = false,
  colorByValue,
}: {
  data: Array<Record<string, number | string>>
  series: SeriesDef[]
  xKey: string
  xFormat?: (v: string | number) => string
  yFormat: (v: number) => string
  height?: number
  stacked?: boolean
  /** colore cada barra individualmente (só para 1 série): retorna cor por linha */
  colorByValue?: (row: Record<string, number | string>, index: number) => string
}) {
  const c = useVizColors()
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }} barCategoryGap="25%">
        <CartesianGrid stroke={c.grid} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey={xKey}
          tickFormatter={xFormat}
          stroke={c.axis}
          tick={{ fill: c.mute, fontSize: 11 }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={yFormat}
          stroke="transparent"
          tick={{ fill: c.mute, fontSize: 11 }}
          tickLine={false}
          width={64}
        />
        <Tooltip
          content={<ChartTooltip valueFormat={yFormat} labelFormat={xFormat} />}
          cursor={{ fill: c.grid, opacity: 0.35 }}
        />
        {series.length > 1 && <Legend wrapperStyle={legendStyle} iconType="circle" />}
        {series.map((s, i) => {
          const color = s.color ?? c.series[s.colorIndex ?? i]
          const isTop = stacked ? i === series.length - 1 : true
          return (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              fill={color}
              stackId={stacked ? 'a' : undefined}
              maxBarSize={24}
              radius={isTop ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              stroke={stacked ? c.surface : undefined}
              strokeWidth={stacked ? 1 : 0}
            >
              {colorByValue &&
                series.length === 1 &&
                data.map((row, idx) => <Cell key={idx} fill={colorByValue(row, idx)} />)}
            </Bar>
          )
        })}
      </BarChart>
    </ResponsiveContainer>
  )
}
