/** Formatação pt-BR para valores monetários, percentuais e prazos. */

const brlFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

const brlCentsFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** R$ 12.345 (sem centavos — padrão para valores grandes) */
export function brl(v: number): string {
  if (!Number.isFinite(v)) return '—'
  return brlFmt.format(v)
}

/** R$ 1.234,56 (com centavos — parcelas, salários) */
export function brlCents(v: number): string {
  if (!Number.isFinite(v)) return '—'
  return brlCentsFmt.format(v)
}

/** R$ 1,2 mi / R$ 450 mil — para eixos e chips */
export function brlCompact(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (abs >= 1_000) return `${sign}R$ ${(abs / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
  return `${sign}R$ ${abs.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}

/** 13,9% (v em pontos percentuais, ex.: 13.9) */
export function pct(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '—'
  return `${v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
}

/** 1.234 */
export function num(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString('pt-BR', { maximumFractionDigits: digits })
}

/** 30 meses → "2 anos e 6 meses" */
export function meses(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  const m = Math.round(n)
  const anos = Math.floor(m / 12)
  const resto = m % 12
  if (anos === 0) return `${resto} ${resto === 1 ? 'mês' : 'meses'}`
  const anosTxt = `${anos} ${anos === 1 ? 'ano' : 'anos'}`
  if (resto === 0) return anosTxt
  return `${anosTxt} e ${resto} ${resto === 1 ? 'mês' : 'meses'}`
}

/** parse de input numérico pt-BR ("1.234,56" → 1234.56) */
export function parseNum(s: string): number {
  const cleaned = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const v = parseFloat(cleaned)
  return Number.isFinite(v) ? v : 0
}
