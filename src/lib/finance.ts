/**
 * Matemática financeira central do app.
 * Convenções:
 *  - Taxas "Pct" são em pontos percentuais (14 = 14%); taxas sem sufixo são decimais (0.14).
 *  - Taxas mensais/anuais convertidas por juros compostos (padrão brasileiro).
 */

/** taxa anual (em %) → taxa mensal decimal. Ex.: 14 → 0.01098 */
export function aToM(annualPct: number): number {
  return Math.pow(1 + annualPct / 100, 1 / 12) - 1
}

/** taxa mensal decimal → taxa anual em %. Ex.: 0.01 → 12.68 */
export function mToA(monthly: number): number {
  return (Math.pow(1 + monthly, 12) - 1) * 100
}

/** taxa anual (em %) → taxa diária útil decimal (252 dias úteis) */
export function aToDu(annualPct: number): number {
  return Math.pow(1 + annualPct / 100, 1 / 252) - 1
}

/** Valor futuro de um principal + aportes mensais (aporte no fim de cada mês). */
export function fvSeries(pv: number, monthlyRate: number, months: number, pmt = 0): number {
  if (months <= 0) return pv
  const f = Math.pow(1 + monthlyRate, months)
  if (monthlyRate === 0) return pv + pmt * months
  return pv * f + pmt * ((f - 1) / monthlyRate)
}

/** Parcela fixa (Tabela Price). */
export function pmtPrice(principal: number, monthlyRate: number, n: number): number {
  if (n <= 0) return 0
  if (monthlyRate === 0) return principal / n
  const f = Math.pow(1 + monthlyRate, n)
  return (principal * monthlyRate * f) / (f - 1)
}

export interface AmortRow {
  mes: number
  parcela: number
  juros: number
  amortizacao: number
  saldo: number
  /** encargos extras (seguros/taxas) quando aplicável */
  extras?: number
}

/** Cronograma Tabela Price. `extrasFn` adiciona encargos por mês (seguros, taxa adm). */
export function priceSchedule(
  principal: number,
  monthlyRate: number,
  n: number,
  extrasFn?: (mes: number, saldo: number) => number,
): AmortRow[] {
  const parcelaBase = pmtPrice(principal, monthlyRate, n)
  const rows: AmortRow[] = []
  let saldo = principal
  for (let mes = 1; mes <= n; mes++) {
    const juros = saldo * monthlyRate
    const amortizacao = parcelaBase - juros
    saldo = Math.max(0, saldo - amortizacao)
    const extras = extrasFn ? extrasFn(mes, saldo) : 0
    rows.push({ mes, parcela: parcelaBase + extras, juros, amortizacao, saldo, extras })
  }
  return rows
}

/** Cronograma SAC (amortização constante, parcela decrescente). */
export function sacSchedule(
  principal: number,
  monthlyRate: number,
  n: number,
  extrasFn?: (mes: number, saldo: number) => number,
): AmortRow[] {
  const amortizacao = principal / n
  const rows: AmortRow[] = []
  let saldo = principal
  for (let mes = 1; mes <= n; mes++) {
    const juros = saldo * monthlyRate
    saldo = Math.max(0, saldo - amortizacao)
    const extras = extrasFn ? extrasFn(mes, saldo) : 0
    rows.push({ mes, parcela: amortizacao + juros + extras, juros, amortizacao, saldo, extras })
  }
  return rows
}

/** Alíquota de IR regressivo sobre renda fixa, por dias corridos. */
export function irRegressivo(dias: number): number {
  if (dias <= 180) return 0.225
  if (dias <= 360) return 0.2
  if (dias <= 720) return 0.175
  return 0.15
}

export interface RendimentoLiquido {
  bruto: number
  rendimentoBruto: number
  ir: number
  taxas: number
  liquido: number
  rendimentoLiquido: number
  /** taxa anual líquida equivalente, em % */
  taxaLiquidaAnualPct: number
}

/**
 * Rendimento líquido de um título que rende `pctDoCdi`% do CDI por `meses` meses.
 * `isento` (LCI/LCA) pula o IR. `taxaAdicionalPct` desconta custo anual (ex.: custódia).
 */
export function rendaFixaLiquida(
  aporte: number,
  taxaAnualPct: number,
  meses: number,
  opts: { isento?: boolean; taxaCustoAnualPct?: number } = {},
): RendimentoLiquido {
  const mRate = aToM(taxaAnualPct)
  const bruto = fvSeries(aporte, mRate, meses)
  const rendimentoBruto = bruto - aporte
  const dias = Math.round((meses * 365) / 12)
  const ir = opts.isento ? 0 : Math.max(0, rendimentoBruto) * irRegressivo(dias)
  // custo anual (ex.: custódia B3, taxa de administração) aproximado sobre o valor médio
  const custoAnual = (opts.taxaCustoAnualPct ?? 0) / 100
  const taxas = custoAnual > 0 ? ((aporte + bruto) / 2) * custoAnual * (meses / 12) : 0
  const liquido = bruto - ir - taxas
  const rendimentoLiquido = liquido - aporte
  const anos = meses / 12
  const taxaLiquidaAnualPct = anos > 0 && aporte > 0 ? (Math.pow(liquido / aporte, 1 / anos) - 1) * 100 : 0
  return { bruto, rendimentoBruto, ir, taxas, liquido, rendimentoLiquido, taxaLiquidaAnualPct }
}

/** VPL de uma série de fluxos mensais (fluxo[0] em t=0). */
export function npv(monthlyRate: number, cashflows: number[]): number {
  return cashflows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + monthlyRate, i), 0)
}

/** Soma de uma coluna do cronograma. */
export function totalOf(rows: AmortRow[], key: 'parcela' | 'juros' | 'amortizacao'): number {
  return rows.reduce((a, r) => a + r[key], 0)
}
