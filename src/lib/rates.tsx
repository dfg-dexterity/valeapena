/**
 * Taxas de mercado — busca ao vivo no Banco Central (API SGS, CORS liberado)
 * com fallback embutido (valores de ago/2026 capturados na build).
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export interface MarketRates {
  /** Selic meta, % a.a. */
  selic: number
  /** CDI, % a.a. */
  cdi: number
  /** IPCA acumulado 12 meses, % */
  ipca12m: number
  /** TR do mês, % a.m. */
  trMes: number
  /** Poupança, % a.m. */
  poupancaMes: number
  /** Taxa média financ. imobiliário PF — taxas de mercado, % a.a. (SGS 20772) */
  imobMercado: number
  /** Taxa média financ. imobiliário PF — taxas reguladas (SFH), % a.a. (SGS 20773) */
  imobRegulado: number
  /** Taxa média financ. imobiliário PF — total, % a.a. (SGS 20774) */
  imobTotal: number
  /** Taxa média aquisição de veículos PF, % a.a. (SGS 20749) */
  veiculos: number
  /** data de referência aproximada dos dados */
  referencia: string
  /** true quando os valores vieram da API ao vivo */
  aoVivo: boolean
}

/** Fallback capturado em 27/08/2026 (SGS BCB). */
export const FALLBACK_RATES: MarketRates = {
  selic: 14.0,
  cdi: 13.9,
  ipca12m: 4.44,
  trMes: 0.1709,
  poupancaMes: 0.6718,
  imobMercado: 14.31,
  imobRegulado: 10.82,
  imobTotal: 11.22,
  veiculos: 26.44,
  referencia: 'ago/2026',
  aoVivo: false,
}

const SGS: Record<string, keyof Omit<MarketRates, 'referencia' | 'aoVivo'>> = {
  '432': 'selic',
  '4389': 'cdi',
  '13522': 'ipca12m',
  '226': 'trMes',
  '195': 'poupancaMes',
  '20772': 'imobMercado',
  '20773': 'imobRegulado',
  '20774': 'imobTotal',
  '20749': 'veiculos',
}

async function fetchSgs(serie: string): Promise<number | null> {
  try {
    const r = await fetch(
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/1?formato=json`,
      { signal: AbortSignal.timeout(6000) },
    )
    if (!r.ok) return null
    const data = (await r.json()) as Array<{ data: string; valor: string }>
    const v = parseFloat(data?.[0]?.valor)
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

export async function fetchRates(): Promise<MarketRates> {
  const entries = Object.entries(SGS)
  const results = await Promise.all(entries.map(([serie]) => fetchSgs(serie)))
  const merged = { ...FALLBACK_RATES }
  let anyLive = false
  results.forEach((v, i) => {
    if (v !== null) {
      anyLive = true
      const key = entries[i][1]
      merged[key] = v
    }
  })
  const hoje = new Date()
  return {
    ...merged,
    aoVivo: anyLive,
    referencia: anyLive
      ? hoje.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
      : FALLBACK_RATES.referencia,
  }
}

export interface BankRate {
  banco: string
  taxaMesPct: number
  taxaAnoPct: number
}

/**
 * Taxas de financiamento de veículos por banco (API Olinda/BCB, CORS liberado).
 * Retorna os bancos mais baratos primeiro.
 */
export async function fetchVehicleBankRates(): Promise<BankRate[]> {
  try {
    const url =
      'https://olinda.bcb.gov.br/olinda/servico/taxaJuros/versao/v2/odata/TaxasJurosDiariaPorInicioPeriodo?' +
      '%24format=json&%24top=3000&%24orderby=InicioPeriodo%20desc&%24select=InstituicaoFinanceira,TaxaJurosAoMes,TaxaJurosAoAno,Modalidade,InicioPeriodo'
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return []
    const data = (await r.json()) as {
      value: Array<{
        InstituicaoFinanceira: string
        TaxaJurosAoMes: number
        TaxaJurosAoAno: number
        Modalidade: string
        InicioPeriodo: string
      }>
    }
    const veic = data.value.filter(v => v.Modalidade.toLowerCase().includes('veículos'))
    if (veic.length === 0) return []
    const latest = veic[0].InicioPeriodo
    const seen = new Set<string>()
    const out: BankRate[] = []
    for (const v of veic) {
      if (v.InicioPeriodo !== latest) continue
      if (seen.has(v.InstituicaoFinanceira)) continue
      seen.add(v.InstituicaoFinanceira)
      out.push({ banco: v.InstituicaoFinanceira, taxaMesPct: v.TaxaJurosAoMes, taxaAnoPct: v.TaxaJurosAoAno })
    }
    return out.sort((a, b) => a.taxaAnoPct - b.taxaAnoPct)
  } catch {
    return []
  }
}

const RatesContext = createContext<MarketRates>(FALLBACK_RATES)

export function RatesProvider({ children }: { children: ReactNode }) {
  const [rates, setRates] = useState<MarketRates>(FALLBACK_RATES)
  useEffect(() => {
    let alive = true
    fetchRates().then(r => {
      if (alive) setRates(r)
    })
    return () => {
      alive = false
    }
  }, [])
  return <RatesContext.Provider value={rates}>{children}</RatesContext.Provider>
}

export function useRates(): MarketRates {
  return useContext(RatesContext)
}
