/**
 * Elétrico — vale a pena comprar um elétrico?
 * Compara em VPL (taxa de desconto = custo de oportunidade líquido de 15% de IR):
 * Elétrico (BEV) × Combustão (ICE) × Híbrido plug-in (PHEV, opcional), mantendo o
 * carro por N anos — energia × combustível, infra de recarga em casa, depreciação,
 * IPVA, seguro, manutenção, bateria e financiamento. Engenharia herdada de Carro.tsx
 * (valorEm, Price, break-even robusto, decomposição com identidade exata, pmtPrice).
 */
import { useId, useMemo, useState } from 'react'
import { BatteryCharging } from 'lucide-react'
import {
  Card,
  Collapse,
  DataTable,
  Didatico,
  ExportBar,
  InfoTip,
  LiveBadge,
  NumberField,
  Segmented,
  SliderField,
  StatTile,
  Toggle,
  ToolPage,
  Verdict,
} from '../components/ui'
import { VBarChart, VLineChart, type SeriesDef } from '../components/charts'
import { aToM, pmtPrice, priceSchedule } from '../lib/finance'
import { brl, brlCents, brlCompact, meses, num, pct } from '../lib/format'
import { useRates } from '../lib/rates'
import {
  BATERIA_2026,
  CATEGORIAS_EV,
  CENARIOS_RECARGA,
  COMBUSTIVEIS_2026,
  DEPRECIACAO_EV,
  IPVA_EV_UF,
  MOTORIZACAO_NOME,
  PERDAS_RECARGA,
  RECARGA_PUBLICA_KWH,
  SOLAR_KWH_MARGINAL,
  SP_CAPITAL_DEVOLUCAO_IPVA_BEV,
  TARIFAS_ENERGIA,
  ipvaPhevSp,
  type CategoriaEV,
  type CenarioRecargaId,
  type Motorizacao,
} from '../lib/eletrico2026'

// motor:start
/** Alíquota de IR de renda fixa acima de 720 dias — usada para o "CDI líquido". */
const IR_LONGO_PRAZO = 0.15
/** Etanol rende ~70% da gasolina em km/l (regra dos 70%). */
const ETANOL_FATOR = 0.7
/** Grade de km/mês da varredura do break-even e do gráfico custo × km. */
const KM_GRID = { min: 100, max: 5000, step: 50 }

interface ParamsMotor {
  /** meses do horizonte (múltiplo de 12) */
  N: number
  /** taxa mensal de desconto (decimal) */
  d: number
  /** reajuste anual de energia/combustível (decimal), aplicado a cada 12 meses */
  reajM: number
  precos: Record<Motorizacao, number>
  /** depreciação no 1º ano e a.a. nos seguintes (decimais) */
  dep1: Record<Motorizacao, number>
  dep2: Record<Motorizacao, number>
  seguroPct: Record<Motorizacao, number>
  manutAno: Record<Motorizacao, number>
  /** custo de energia/combustível por km, no ano 1 */
  custoKm: Record<Motorizacao, number>
  /** alíquota de IPVA (decimal) por motorização e ano da posse (0 = 1º ano) */
  ipvaAliq: (o: Motorizacao, anoIdx: number) => number
  licenciamento: number
  /** benefício do rodízio para bev/phev, R$/ano (0 se não se aplica) */
  rodizioAno: number
  financiado: boolean
  /** decimal */
  entradaPct: number
  nFin: number
  taxaFinM: number
  /** cenário ≠ "rua": há infra em casa (capex, recorrente, residual) */
  temInfra: boolean
  capexInfra: number
  recorrenteAno: number
  /** fração do capex recuperada em N (decimal) */
  residualPct: number
  bateriaKwh: Record<Motorizacao, number>
  custoKwhBateria: number
  /** probabilidade de troca fora da garantia (decimal) */
  probTroca: number
  garantiaMeses: number
}

interface ResultadoMotor {
  preco: number
  entrada: number
  parcelaFin: number
  valorN: number
  saldoN: number
  capex: number
  residual: number
  /** custo total em VP = PV(t0 + saídas) − PV(venda em N) */
  custo: number
  // fatias em VP — somam exatamente `custo`
  dep: number
  energia: number
  seguro: number
  manut: number
  ipva: number
  juros: number
  infra: number
  bateria: number
  /** custo em VP "se vender no mês m" (índice 0..N; infra recuperada só em N → linha[N] = custo) */
  linha: number[]
  /** gasto nominal por ano (ano 1 inclui entrada/preço + infra) */
  gastoAno: number[]
  /** valor do carro no fim de cada ano */
  valorAno: number[]
}

function simularMotor(p: ParamsMotor, o: Motorizacao, kmMes: number): ResultadoMotor {
  const preco = Math.max(0, p.precos[o])
  const f1 = Math.pow(1 - p.dep1[o], 1 / 12)
  const f2 = Math.pow(1 - p.dep2[o], 1 / 12)
  /** valor de mercado do carro com `m` meses de idade */
  const valorEm = (m: number) => preco * Math.pow(f1, Math.min(m, 12)) * Math.pow(f2, Math.max(0, m - 12))

  const entrada = p.financiado ? preco * p.entradaPct : preco
  const parcelas = p.financiado ? priceSchedule(Math.max(0, preco - entrada), p.taxaFinM, p.nFin) : []
  const parcelaFin = parcelas[0]?.parcela ?? 0

  const eletrificado = o !== 'ice'
  const temInfra = eletrificado && p.temInfra
  const capex = temInfra ? Math.max(0, p.capexInfra) : 0
  const recorrenteM = temInfra ? Math.max(0, p.recorrenteAno) / 12 : 0
  const residual = temInfra ? capex * p.residualPct : 0
  const rodizioM = eletrificado ? Math.max(0, p.rodizioAno) / 12 : 0
  const provisaoM =
    p.garantiaMeses > 0 ? (Math.max(0, p.bateriaKwh[o]) * p.custoKwhBateria * p.probTroca) / p.garantiaMeses : 0
  const custoKm = p.custoKm[o]
  const anos = p.N / 12

  let pvSaidas = entrada + capex // t0
  let pvEnergia = 0
  let pvSeguro = 0
  let pvManut = 0
  let pvIpva = 0
  let pvParcelas = 0
  let pvInfra = 0
  let pvBateria = 0
  const linha: number[] = [0]
  const gastoAno: number[] = Array.from({ length: anos }, () => 0)
  gastoAno[0] = entrada + capex
  const valorAno: number[] = []

  for (let m = 1; m <= p.N; m++) {
    const df = Math.pow(1 + p.d, -m)
    const v = valorEm(m)
    const anoIdx = Math.floor((m - 1) / 12)
    const reaj = Math.pow(1 + p.reajM, anoIdx)
    const energiaM = kmMes * custoKm * reaj
    const seguroM = (p.seguroPct[o] * v) / 12
    const manutM = (p.manutAno[o] / 12) * reaj
    const ipvaM = (p.ipvaAliq(o, anoIdx) * v) / 12 + p.licenciamento / 12 - rodizioM
    const emFin = p.financiado && m <= p.nFin
    const parcela = emFin ? parcelas[m - 1].parcela : 0
    const saldo = emFin ? parcelas[m - 1].saldo : 0
    const bateriaM = m <= p.garantiaMeses ? provisaoM : 0

    pvEnergia += energiaM * df
    pvSeguro += seguroM * df
    pvManut += manutM * df
    pvIpva += ipvaM * df
    pvParcelas += parcela * df
    pvInfra += recorrenteM * df
    pvBateria += bateriaM * df
    const saida = energiaM + seguroM + manutM + ipvaM + parcela + recorrenteM + bateriaM
    pvSaidas += saida * df
    gastoAno[anoIdx] += saida

    // custo líquido em VP se vender o carro (e quitar o saldo) no mês m — a infra só
    // é recuperada em N, para que linha[N] seja exatamente `custo`
    linha.push(pvSaidas - (v - saldo + (m === p.N ? residual : 0)) * df)
    if (m % 12 === 0) valorAno.push(v)
  }

  const dfN = Math.pow(1 + p.d, -p.N)
  const valorN = valorEm(p.N)
  const saldoN = p.financiado && p.N <= p.nFin ? parcelas[p.N - 1].saldo : 0
  const custo = pvSaidas - (valorN - saldoN + residual) * dfN

  // decomposição em VP — identidade exata: Σ fatias = custo
  const dep = preco - valorN * dfN
  const juros = p.financiado ? entrada + pvParcelas + saldoN * dfN - preco : 0
  const infra = capex - residual * dfN + pvInfra

  return {
    preco,
    entrada,
    parcelaFin,
    valorN,
    saldoN,
    capex,
    residual,
    custo,
    dep,
    energia: pvEnergia,
    seguro: pvSeguro,
    manut: pvManut,
    ipva: pvIpva,
    juros,
    infra,
    bateria: pvBateria,
    linha,
    gastoAno,
    valorAno,
  }
}

interface ResultadoSim {
  bev: ResultadoMotor
  ice: ResultadoMotor
  phev?: ResultadoMotor
}

/** Simula todas as motorizações ativas para um dado km/mês. */
function simular(p: ParamsMotor, comPhev: boolean, kmMes: number): ResultadoSim {
  const r: ResultadoSim = { bev: simularMotor(p, 'bev', kmMes), ice: simularMotor(p, 'ice', kmMes) }
  if (comPhev) r.phev = simularMotor(p, 'phev', kmMes)
  return r
}

type BreakEvenKm =
  | { tipo: 'sempre' }
  | { tipo: 'nunca' }
  | { tipo: 'apartir'; km: number }
  | { tipo: 'ate'; km: number }

/**
 * Break-even em km/mês (elétrico × combustão) a partir da varredura.
 * Cobre os dois extremos ("sempre"/"nunca") e o caso invertido em que o elétrico
 * só vence rodando POUCO (recarga cara na rua: custo/km do elétrico > combustão).
 */
function breakEvenKmDe(kms: number[], venceEm: boolean[]): BreakEvenKm {
  if (venceEm.every(Boolean)) return { tipo: 'sempre' }
  if (!venceEm.some(Boolean)) return { tipo: 'nunca' }
  if (venceEm[0]) {
    const iPerde = venceEm.findIndex(v => !v)
    return { tipo: 'ate', km: kms[iPerde - 1] }
  }
  const iVence = venceEm.findIndex(Boolean)
  return { tipo: 'apartir', km: kms[iVence] }
}
// motor:end

type ModoCompra = 'avista' | 'financiado'

const NOME_CURTO: Record<CategoriaEV['id'], string> = {
  compacto: 'Compacto',
  medio: 'Médio',
  suv: 'SUV',
}

const CENARIO_CURTO: Record<CenarioRecargaId, string> = {
  tomada: 'Tomada dedicada',
  wallbox: 'Wallbox',
  padrao: 'Wallbox + padrão',
  condominio: 'Condomínio',
  rua: 'Só na rua',
}

/** Chaves com default derivado (categoria/UF/distribuidora/cenário/BCB) que o usuário pode sobrescrever. */
type OvKey =
  | 'precoBev'
  | 'precoIce'
  | 'precoPhev'
  | 'kwh100Bev'
  | 'kmlIce'
  | 'segBev'
  | 'segIce'
  | 'segPhev'
  | 'manBev'
  | 'manIce'
  | 'manPhev'
  | 'kwh100Phev'
  | 'kmlPhev'
  | 'bateriaKwh'
  | 'tarifa'
  | 'capex'
  | 'recorrente'
  | 'fracCasa'
  | 'perdas'
  | 'licenciamento'
  | 'taxaFin'
  | 'reajuste'
  | 'custoOp'

const KEYS_CATEGORIA: OvKey[] = [
  'precoBev',
  'precoIce',
  'precoPhev',
  'kwh100Bev',
  'kmlIce',
  'segBev',
  'segIce',
  'segPhev',
  'manBev',
  'manIce',
  'manPhev',
  'kwh100Phev',
  'kmlPhev',
  'bateriaKwh',
]
const KEYS_CENARIO: OvKey[] = ['capex', 'recorrente', 'fracCasa', 'perdas']

/** Rótulo do eixo X em meses → "hoje", "3º ano", "18m". */
function labelMes(v: string | number): string {
  const m = Number(v)
  if (!Number.isFinite(m)) return String(v)
  if (m === 0) return 'hoje'
  if (m % 12 === 0) return `${m / 12}º ano`
  return `${m}m`
}

function labelKm(v: string | number): string {
  const k = Number(v)
  return Number.isFinite(k) ? `${num(k)} km` : String(v)
}

const selectClass =
  'w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs font-semibold text-ink outline-none focus:border-accent'

export default function Eletrico() {
  const rates = useRates()
  const idUf = useId()
  const idDist = useId()

  /* ------------------------- inputs principais ------------------------- */
  const [categoriaId, setCategoriaId] = useState<CategoriaEV['id']>('compacto')
  const [incluirPhev, setIncluirPhev] = useState(false)
  const [kmMes, setKmMes] = useState(1250)
  const [horizonteAnos, setHorizonteAnos] = useState(5)
  const [uf, setUf] = useState('SP')
  const [capitalSp, setCapitalSp] = useState(false)
  const [rodizioAno, setRodizioAno] = useState(0)
  const [modoCompra, setModoCompra] = useState<ModoCompra>('avista')
  const [entradaPct, setEntradaPct] = useState(20)
  const [prazoFin, setPrazoFin] = useState(48)

  /* ------------------------ energia e combustível ------------------------ */
  const [distribuidora, setDistribuidora] = useState(TARIFAS_ENERGIA[0].distribuidora)
  const [branca, setBranca] = useState(false)
  const [solar, setSolar] = useState(false)
  const [gasolina, setGasolina] = useState(COMBUSTIVEIS_2026.gasolina)
  const [etanol, setEtanol] = useState(COMBUSTIVEIS_2026.etanol)
  const [flex, setFlex] = useState(true)
  const [precoPublico, setPrecoPublico] = useState(RECARGA_PUBLICA_KWH)

  /* ---------------------------- recarga em casa ---------------------------- */
  const [cenarioId, setCenarioId] = useState<CenarioRecargaId>('wallbox')

  /* ------------------------ premissas avançadas ------------------------ */
  const [depPct, setDepPct] = useState<Record<Motorizacao, { ano1: number; seguintes: number }>>({
    bev: { ano1: DEPRECIACAO_EV.bev.ano1 * 100, seguintes: DEPRECIACAO_EV.bev.seguintes * 100 },
    phev: { ano1: DEPRECIACAO_EV.phev.ano1 * 100, seguintes: DEPRECIACAO_EV.phev.seguintes * 100 },
    ice: { ano1: DEPRECIACAO_EV.ice.ano1 * 100, seguintes: DEPRECIACAO_EV.ice.seguintes * 100 },
  })
  const setDep = (o: Motorizacao, campo: 'ano1' | 'seguintes') => (v: number) =>
    setDepPct(d => ({ ...d, [o]: { ...d[o], [campo]: v } }))
  const [fracEl, setFracEl] = useState(60)
  const [custoKwhBat, setCustoKwhBat] = useState(BATERIA_2026.custoPorKwh)
  const [probTroca, setProbTroca] = useState(BATERIA_2026.probTroca * 100)
  const [garantiaAnos, setGarantiaAnos] = useState(BATERIA_2026.garantiaAnos)
  const [residualPct, setResidualPct] = useState(0)

  /** overrides do usuário sobre defaults derivados (padrão `xUser ?? default`) */
  const [ov, setOv] = useState<Partial<Record<OvKey, number>>>({})
  const setK = (k: OvKey) => (v: number) => setOv(o => ({ ...o, [k]: v }))
  const clearK = (keys: OvKey[]) =>
    setOv(o => {
      const n = { ...o }
      for (const k of keys) delete n[k]
      return n
    })

  /* ------------------------------ derivados ------------------------------ */
  const cat = CATEGORIAS_EV.find(c => c.id === categoriaId) ?? CATEGORIAS_EV[0]
  const phevDisponivel = cat.phev !== undefined
  const phevAtivo = phevDisponivel && incluirPhev
  const phevRef = cat.phev ?? { kwh100: 20, kml: 13, bateria: 19, autonomiaKm: 58 }
  const ufSel = IPVA_EV_UF.find(e => e.uf === uf) ?? IPVA_EV_UF[0]
  const tarifaSel = TARIFAS_ENERGIA.find(t => t.distribuidora === distribuidora) ?? TARIFAS_ENERGIA[0]
  const cen = CENARIOS_RECARGA.find(c => c.id === cenarioId) ?? CENARIOS_RECARGA[1]
  const rua = cen.id === 'rua'
  const capital = uf === 'SP' && capitalSp

  const precoBev = ov.precoBev ?? cat.preco.bev
  const precoIce = ov.precoIce ?? cat.preco.ice
  const precoPhev = ov.precoPhev ?? cat.preco.phev ?? cat.preco.bev
  const kwh100Bev = ov.kwh100Bev ?? cat.kwh100Bev
  const kmlIce = ov.kmlIce ?? cat.kmlIce
  const segBev = ov.segBev ?? cat.seguroPct.bev * 100
  const segIce = ov.segIce ?? cat.seguroPct.ice * 100
  const segPhev = ov.segPhev ?? cat.seguroPct.phev * 100
  const manBev = ov.manBev ?? cat.manutencaoAno.bev
  const manIce = ov.manIce ?? cat.manutencaoAno.ice
  const manPhev = ov.manPhev ?? cat.manutencaoAno.phev
  const kwh100Phev = ov.kwh100Phev ?? phevRef.kwh100
  const kmlPhev = ov.kmlPhev ?? phevRef.kml
  const bateriaKwh = ov.bateriaKwh ?? cat.bateriaBev
  const tarifa = ov.tarifa ?? (branca ? tarifaSel.brancaForaPonta : tarifaSel.convencional)
  const capexInfra = ov.capex ?? cen.capex
  const recorrenteAno = ov.recorrente ?? cen.recorrenteAno
  const fracCasa = rua ? 0 : (ov.fracCasa ?? cen.fracCasa * 100)
  const perdas = ov.perdas ?? cen.perdas * 100
  const licenciamento = ov.licenciamento ?? ufSel.licenciamento
  /** defaults ao vivo (BCB) enquanto o usuário não mexe no slider */
  const taxaFin = ov.taxaFin ?? rates.veiculos
  const reajuste = ov.reajuste ?? rates.ipca12m
  const custoOp = ov.custoOp ?? rates.cdi
  const fracElEf = rua ? 0 : fracEl

  const selecionarCategoria = (id: CategoriaEV['id']) => {
    setCategoriaId(id)
    clearK(KEYS_CATEGORIA)
  }
  const selecionarUf = (novo: string) => {
    setUf(novo)
    // distribuidora acompanha a UF (a primeira da lista, ou a média nacional)
    if (tarifaSel.uf !== novo) {
      const t = TARIFAS_ENERGIA.find(x => x.uf === novo) ?? TARIFAS_ENERGIA[TARIFAS_ENERGIA.length - 1]
      setDistribuidora(t.distribuidora)
      clearK(['licenciamento', 'tarifa'])
    } else {
      clearK(['licenciamento'])
    }
  }
  const selecionarDistribuidora = (nome: string) => {
    setDistribuidora(nome)
    clearK(['tarifa'])
  }
  const alternarBranca = (v: boolean) => {
    setBranca(v)
    clearK(['tarifa'])
  }
  const selecionarCenario = (id: CenarioRecargaId) => {
    setCenarioId(id)
    clearK(KEYS_CENARIO)
  }

  /* ----------------------------- simulação ----------------------------- */
  const sim = useMemo(() => {
    const anos = Math.min(10, Math.max(3, Math.round(horizonteAnos)))
    const N = anos * 12
    const descontoAa = Math.max(0, custoOp) * (1 - IR_LONGO_PRAZO)
    const d = aToM(descontoAa)
    const reajM = Math.max(0, reajuste) / 100

    // custo do kWh e custo por km
    const kwhCasa = solar ? SOLAR_KWH_MARGINAL : Math.max(0, tarifa)
    const fracCasaEf = Math.min(100, Math.max(0, fracCasa)) / 100
    const perdasCasa = Math.min(50, Math.max(0, perdas)) / 100
    const kwhCasaEf = kwhCasa * (1 + perdasCasa)
    const kwhRuaEf = Math.max(0, precoPublico) * (1 + PERDAS_RECARGA.dc)
    const custoKwhBev = fracCasaEf * kwhCasaEf + (1 - fracCasaEf) * kwhRuaEf
    const custoKmBev = (Math.max(0, kwh100Bev) / 100) * custoKwhBev
    const kml = Math.max(1, kmlIce)
    const custoKmGas = Math.max(0, gasolina) / kml
    const custoKmEta = Math.max(0, etanol) / (kml * ETANOL_FATOR)
    const usaEtanol = flex && custoKmEta < custoKmGas
    const custoKmIce = usaEtanol ? custoKmEta : custoKmGas
    const kmlP = Math.max(1, kmlPhev)
    const custoKmPhevGas = Math.max(0, gasolina) / kmlP
    const custoKmPhevEta = Math.max(0, etanol) / (kmlP * ETANOL_FATOR)
    const custoKmPhevComb = flex ? Math.min(custoKmPhevGas, custoKmPhevEta) : custoKmPhevGas
    const fracElDec = Math.min(100, Math.max(0, fracElEf)) / 100
    const custoKmPhevEl = (Math.max(0, kwh100Phev) / 100) * custoKwhBev
    const custoKmPhev = fracElDec * custoKmPhevEl + (1 - fracElDec) * custoKmPhevComb

    const clampDep = (v: number) => Math.min(Math.max(v, 0), 99) / 100
    const ipvaAliq = (o: Motorizacao, anoIdx: number) => {
      if (o === 'phev' && uf === 'SP') return ipvaPhevSp(anoIdx)
      const base = ufSel[o]
      return o === 'bev' && capital ? base * (1 - SP_CAPITAL_DEVOLUCAO_IPVA_BEV) : base
    }

    const p: ParamsMotor = {
      N,
      d,
      reajM,
      precos: { bev: precoBev, ice: precoIce, phev: precoPhev },
      dep1: { bev: clampDep(depPct.bev.ano1), ice: clampDep(depPct.ice.ano1), phev: clampDep(depPct.phev.ano1) },
      dep2: {
        bev: clampDep(depPct.bev.seguintes),
        ice: clampDep(depPct.ice.seguintes),
        phev: clampDep(depPct.phev.seguintes),
      },
      seguroPct: { bev: Math.max(0, segBev) / 100, ice: Math.max(0, segIce) / 100, phev: Math.max(0, segPhev) / 100 },
      manutAno: { bev: Math.max(0, manBev), ice: Math.max(0, manIce), phev: Math.max(0, manPhev) },
      custoKm: { bev: custoKmBev, ice: custoKmIce, phev: custoKmPhev },
      ipvaAliq,
      licenciamento: Math.max(0, licenciamento),
      rodizioAno: capital ? Math.max(0, rodizioAno) : 0,
      financiado: modoCompra === 'financiado',
      entradaPct: Math.min(Math.max(entradaPct, 0), 100) / 100,
      nFin: Math.max(1, Math.round(prazoFin)),
      taxaFinM: aToM(Math.max(0, taxaFin)),
      temInfra: !rua,
      capexInfra,
      recorrenteAno,
      residualPct: Math.min(Math.max(residualPct, 0), 100) / 100,
      bateriaKwh: { bev: bateriaKwh, ice: 0, phev: phevRef.bateria },
      custoKwhBateria: Math.max(0, custoKwhBat),
      probTroca: Math.min(Math.max(probTroca, 0), 100) / 100,
      garantiaMeses: Math.max(0, Math.round(garantiaAnos)) * 12,
    }

    const km = Math.max(1, kmMes)
    const res = simular(p, phevAtivo, km)

    // break-even em meses (elétrico × combustão) — regra robusta do Carro: primeiro
    // mês a partir do qual o elétrico fica mais barato ATÉ O FIM; null se nunca
    let ultimoMesBevPior = 0
    let bevJaFoiMaisBarato = false
    for (let m = 1; m <= N; m++) {
      if (res.bev.linha[m] > res.ice.linha[m]) ultimoMesBevPior = m
      else bevJaFoiMaisBarato = true
    }
    const breakEvenMes: number | null = ultimoMesBevPior < N ? ultimoMesBevPior + 1 : null

    // varredura em km/mês: custo VP × km (3 séries) + break-even em km
    const grid: Array<Record<string, number>> = []
    const kms: number[] = []
    const venceEm: boolean[] = []
    for (let k = KM_GRID.min; k <= KM_GRID.max; k += KM_GRID.step) {
      const r = simular(p, phevAtivo, k)
      const row: Record<string, number> = { km: k, bev: r.bev.custo, ice: r.ice.custo }
      if (r.phev) row.phev = r.phev.custo
      grid.push(row)
      kms.push(k)
      venceEm.push(r.bev.custo <= r.ice.custo)
    }
    const breakEvenKm = breakEvenKmDe(kms, venceEm)

    // gráfico 1: VP acumulado × mês
    const chartMes: Array<Record<string, number>> = []
    for (let m = 0; m <= N; m++) {
      const row: Record<string, number> = { mes: m, bev: res.bev.linha[m], ice: res.ice.linha[m] }
      if (res.phev) row.phev = res.phev.linha[m]
      chartMes.push(row)
    }

    // sensibilidades (para a didática). km: a energia é linear em km, então o efeito de
    // +100 km/mês na diferença (combustão − elétrico) é exato via fator de anuidade com
    // reajuste. Depreciação: re-simula o elétrico com +1 p.p. no 1º ano — o efeito no
    // custo total é bem menor que a fatia "depreciação" sozinha (seguro e IPVA caem junto
    // com o valor) e em horizontes longos pode até ser negativo
    let anuidade = 0
    for (let m = 1; m <= N; m++) anuidade += Math.pow(1 + reajM, Math.floor((m - 1) / 12)) * Math.pow(1 + d, -m)
    const por100km = 100 * (custoKmIce - custoKmBev) * anuidade
    const custoBevComDep1 = (dep1: number) =>
      simularMotor({ ...p, dep1: { ...p.dep1, bev: Math.min(0.99, Math.max(0, dep1)) } }, 'bev', km).custo
    const porPpDep = custoBevComDep1(p.dep1.bev + 0.01) - res.bev.custo
    // em que depreciação do 1º ano (p.p. inteiro, 0–60) o resultado elétrico × combustão
    // inverte: o valor mais próximo do atual em que o sinal da diferença muda (null = nenhum)
    const diffBevIceAtual = res.ice.custo - res.bev.custo
    const depAtualPp = p.dep1.bev * 100
    let depInvertePp: number | null = null
    for (let pp = 0; pp <= 60; pp++) {
      const dif = res.ice.custo - custoBevComDep1(pp / 100)
      if (dif !== 0 && Math.sign(dif) !== Math.sign(diffBevIceAtual)) {
        if (depInvertePp === null || Math.abs(pp - depAtualPp) < Math.abs(depInvertePp - depAtualPp)) depInvertePp = pp
      }
    }

    // veredito
    const custos: Record<Motorizacao, number> = {
      bev: res.bev.custo,
      ice: res.ice.custo,
      phev: res.phev?.custo ?? Number.POSITIVE_INFINITY,
    }
    const ativos: Motorizacao[] = phevAtivo ? ['bev', 'ice', 'phev'] : ['bev', 'ice']
    const vencedor = ativos.reduce((a, b) => (custos[b] < custos[a] ? b : a))
    const melhorEletrificado: Motorizacao = phevAtivo && custos.phev < custos.bev ? 'phev' : 'bev'
    const rival: Motorizacao = vencedor === 'ice' ? melhorEletrificado : 'ice'
    const diff = custos[rival] - custos[vencedor]
    const eqMes = pmtPrice(diff, d, N)
    const empate = diff < Math.max(custos[vencedor], custos[rival], 1) * 0.02

    const kmTotais = km * N
    const energiaMes = { bev: km * custoKmBev, ice: km * custoKmIce, phev: km * custoKmPhev }

    // recarga em casa: horas e custo de 1.000 km
    const potKw = cen.potenciaKw
    const horas100 = potKw > 0 ? bateriaKwh / (potKw * 0.9) : null
    const horas2080 = potKw > 0 ? (0.6 * bateriaKwh) / (potKw * 0.9) : null
    const kwhDia = ((km / 30) * kwh100Bev) / 100
    const horasNoite = potKw > 0 ? (kwhDia * (1 + perdasCasa)) / potKw : null
    const mil = {
      casa: 10 * kwh100Bev * kwhCasaEf,
      rua: 10 * kwh100Bev * kwhRuaEf,
      gasolina: (1000 / kml) * Math.max(0, gasolina),
      etanol: (1000 / (kml * ETANOL_FATOR)) * Math.max(0, etanol),
    }

    // tabela ano a ano
    const tabela = Array.from({ length: anos }, (_, i) => ({
      ano: i + 1,
      valorBev: res.bev.valorAno[i],
      valorIce: res.ice.valorAno[i],
      valorPhev: res.phev?.valorAno[i] ?? 0,
      gastoBev: res.bev.gastoAno[i],
      gastoIce: res.ice.gastoAno[i],
      gastoPhev: res.phev?.gastoAno[i] ?? 0,
      vpBev: res.bev.linha[(i + 1) * 12],
      vpIce: res.ice.linha[(i + 1) * 12],
      vpPhev: res.phev?.linha[(i + 1) * 12] ?? 0,
    }))

    return {
      anos,
      N,
      d,
      descontoAa,
      financiado: p.financiado,
      res,
      custos,
      ativos,
      vencedor,
      rival,
      diff,
      eqMes,
      empate,
      breakEvenMes,
      bevJaFoiMaisBarato,
      breakEvenKm,
      grid,
      chartMes,
      tabela,
      custoKm: { bev: custoKmBev, ice: custoKmIce, phev: custoKmPhev },
      custoKmTotal: { bev: res.bev.custo / kmTotais, ice: res.ice.custo / kmTotais, phev: (res.phev?.custo ?? 0) / kmTotais },
      custoKwhBev,
      kwhCasa,
      kwhCasaEf,
      kwhRuaEf,
      usaEtanol,
      energiaMes,
      horas100,
      horas2080,
      horasNoite,
      kwhDia,
      mil,
      por100km,
      porPpDep,
      depInvertePp,
      anuidade,
    }
  }, [
    horizonteAnos,
    custoOp,
    reajuste,
    solar,
    tarifa,
    fracCasa,
    perdas,
    precoPublico,
    kwh100Bev,
    kmlIce,
    gasolina,
    etanol,
    flex,
    kmlPhev,
    fracElEf,
    kwh100Phev,
    uf,
    ufSel,
    capital,
    precoBev,
    precoIce,
    precoPhev,
    depPct,
    segBev,
    segIce,
    segPhev,
    manBev,
    manIce,
    manPhev,
    licenciamento,
    rodizioAno,
    modoCompra,
    entradaPct,
    prazoFin,
    taxaFin,
    rua,
    capexInfra,
    recorrenteAno,
    residualPct,
    bateriaKwh,
    phevRef.bateria,
    custoKwhBat,
    probTroca,
    garantiaAnos,
    kmMes,
    phevAtivo,
    cen.potenciaKw,
  ])

  /* ------------------------------ veredito ------------------------------ */
  const nome = (o: Motorizacao) => MOTORIZACAO_NOME[o].toLowerCase()
  const bevVence = sim.vencedor !== 'ice'
  const infraTxt = rua
    ? `não tem infra em casa — 100% da recarga na rua a ${brlCents(precoPublico)}/kWh`
    : `inclui ${brl(sim.res.bev.capex)} de infra de recarga em casa (${CENARIO_CURTO[cen.id].toLowerCase()}${
        recorrenteAno > 0 ? ` + ${brl(recorrenteAno)}/ano` : ''
      })`

  const verdictWinner = sim.empate
    ? `Empate técnico: ${nome(sim.vencedor)} e ${nome(sim.rival)} ficam a ${brl(sim.diff)} um do outro em ${
        sim.anos
      } anos (≈ ${brlCents(sim.eqMes)}/mês) — decida pela conveniência`
    : sim.vencedor === 'bev'
      ? `Vale a pena o elétrico: economiza ${brl(sim.diff)} em ${sim.anos} anos (≈ ${brlCents(sim.eqMes)}/mês)`
      : sim.vencedor === 'phev'
        ? `Vale a pena o híbrido plug-in: economiza ${brl(sim.diff)} em ${sim.anos} anos (≈ ${brlCents(sim.eqMes)}/mês)`
        : `O combustão ainda sai mais barato: ${brl(sim.diff)} a menos em ${sim.anos} anos (≈ ${brlCents(sim.eqMes)}/mês)`

  const verdictDetail = `Rodando ${num(kmMes)} km/mês por ${sim.anos} anos, o elétrico custa ${brl(
    sim.res.bev.custo,
  )} em valor presente e o combustão ${brl(sim.res.ice.custo)}${
    sim.res.phev ? `; o híbrido plug-in, ${brl(sim.res.phev.custo)}` : ''
  } — já descontada a revenda e somando energia/combustível, seguro, manutenção, IPVA e provisão de bateria. A conta do elétrico ${infraTxt}. Tudo em dinheiro de hoje, descontado a ${pct(
    sim.descontoAa,
    1,
  )} a.a. (o que o seu dinheiro renderia investido, já sem o IR).`

  const badgeKm =
    sim.breakEvenKm.tipo === 'sempre'
      ? 'Elétrico vence em qualquer km/mês'
      : sim.breakEvenKm.tipo === 'nunca'
        ? `Elétrico não vence em ${sim.anos} anos`
        : sim.breakEvenKm.tipo === 'apartir'
          ? `Elétrico vence com ${num(sim.breakEvenKm.km)}+ km/mês`
          : `Elétrico vence só até ${num(sim.breakEvenKm.km)} km/mês`

  /* ------------------------------ gráficos ------------------------------ */
  const linhaSeries: SeriesDef[] = [
    { key: 'bev', name: 'Elétrico', colorIndex: 0 },
    { key: 'ice', name: 'Combustão', colorIndex: 1 },
    ...(sim.res.phev ? [{ key: 'phev', name: 'Híbrido plug-in', colorIndex: 2 } satisfies SeriesDef] : []),
  ]

  // barras empilhadas: 8 fatias em ordem fixa; fatia negativa vira crédito (nota)
  const fatias: Array<{ key: string; name: string; colorIndex: number; de: (r: ResultadoMotor) => number }> = [
    { key: 'dep', name: 'Depreciação', colorIndex: 0, de: r => r.dep },
    { key: 'ene', name: 'Energia / combustível', colorIndex: 1, de: r => r.energia },
    { key: 'seg', name: 'Seguro', colorIndex: 2, de: r => r.seguro },
    { key: 'man', name: 'Manutenção', colorIndex: 3, de: r => r.manut },
    { key: 'ipva', name: 'IPVA + licenciamento', colorIndex: 4, de: r => r.ipva },
    { key: 'jur', name: 'Juros do financiamento', colorIndex: 5, de: r => r.juros },
    { key: 'inf', name: 'Recarga em casa (infra)', colorIndex: 6, de: r => r.infra },
    { key: 'bat', name: 'Provisão de bateria', colorIndex: 7, de: r => r.bateria },
  ]
  const creditos: string[] = []
  const compData = sim.ativos.map(o => {
    const r = sim.res[o]!
    const row: Record<string, number | string> = { opcao: MOTORIZACAO_NOME[o] }
    for (const f of fatias) {
      const v = f.de(r)
      if (v < -0.005) {
        creditos.push(`${f.name.toLowerCase()} do ${nome(o)}: crédito de ${brl(-v)}`)
        row[f.key] = 0
      } else row[f.key] = v
    }
    return row
  })
  const compSeries: SeriesDef[] = fatias
    .filter(f => compData.some(row => Number(row[f.key]) > 0))
    .map(f => ({ key: f.key, name: f.name, colorIndex: f.colorIndex }))

  /* ---------------------------- números úteis ---------------------------- */
  const b = sim.res.bev
  const i = sim.res.ice
  const ph = sim.res.phev
  const economiaEnergia = i.energia - b.energia
  const economiaManIpva = i.manut + i.ipva - (b.manut + b.ipva)
  const depAMais = b.dep - i.dep
  const premio = precoBev - precoIce
  const pctInfra = b.custo > 0 ? (b.infra / b.custo) * 100 : 0
  const perdaBevPct = precoBev > 0 ? (1 - b.valorN / precoBev) * 100 : 0
  const perdaIcePct = precoIce > 0 ? (1 - i.valorN / precoIce) * 100 : 0
  const diffBevIce = i.custo - b.custo
  const combustivelTxt = sim.usaEtanol ? 'etanol' : 'gasolina'

  /* --------------------------- exportação --------------------------- */
  const resumo = [
    'vale a pena? — Elétrico × híbrido plug-in × combustão',
    verdictWinner,
    `${cat.nome} · ${num(kmMes)} km/mês · ${sim.anos} anos · ${ufSel.uf}${capital ? ' (capital)' : ''} · ${
      sim.financiado ? 'financiado' : 'à vista'
    }`,
    `Elétrico (${cat.exemplos.bev}, ${brl(precoBev)}): ${brl(b.custo)} em VP · ${brlCents(sim.custoKm.bev)}/km em energia`,
    `Combustão (${cat.exemplos.ice}, ${brl(precoIce)}): ${brl(i.custo)} em VP · ${brlCents(sim.custoKm.ice)}/km a ${combustivelTxt}`,
    ...(ph
      ? [`Híbrido plug-in (${cat.exemplos.phev}, ${brl(precoPhev)}): ${brl(ph.custo)} em VP · ${brlCents(sim.custoKm.phev)}/km`]
      : []),
    `Recarga: ${cen.nome} — ${infraTxt} · ${num(fracCasa)}% dos kWh em casa a ${brlCents(sim.kwhCasa)}/kWh`,
    `Break-even: ${badgeKm.toLowerCase()}${sim.breakEvenMes !== null ? ` · em meses: ${meses(sim.breakEvenMes)}` : ''}`,
    `Taxa de desconto: ${pct(sim.descontoAa, 1)} a.a. (custo de oportunidade de ${pct(custoOp, 1)} líquido de 15% de IR)`,
    'gerado por vale a pena? · Dexterity — valeapena-puce.vercel.app',
  ].join('\n')

  const csv = {
    nome: 'ano-a-ano',
    colunas: [
      'Ano',
      'Valor — elétrico (R$)',
      'Valor — combustão (R$)',
      ...(ph ? ['Valor — híbrido plug-in (R$)'] : []),
      'Gasto no ano — elétrico (R$)',
      'Gasto no ano — combustão (R$)',
      ...(ph ? ['Gasto no ano — híbrido plug-in (R$)'] : []),
      'VP acumulado — elétrico (R$)',
      'VP acumulado — combustão (R$)',
      ...(ph ? ['VP acumulado — híbrido plug-in (R$)'] : []),
    ],
    linhas: sim.tabela.map(r => [
      r.ano,
      Math.round(r.valorBev),
      Math.round(r.valorIce),
      ...(ph ? [Math.round(r.valorPhev)] : []),
      Math.round(r.gastoBev),
      Math.round(r.gastoIce),
      ...(ph ? [Math.round(r.gastoPhev)] : []),
      Math.round(r.vpBev),
      Math.round(r.vpIce),
      ...(ph ? [Math.round(r.vpPhev)] : []),
    ]),
  }

  const premissas: [string, string][] = [
    ['Categoria', `${cat.nome} — ${cat.exemplos.bev} × ${cat.exemplos.ice}${ph ? ` × ${cat.exemplos.phev}` : ''}`],
    ['Preços', `elétrico ${brl(precoBev)} · combustão ${brl(precoIce)}${ph ? ` · híbrido plug-in ${brl(precoPhev)}` : ''}`],
    ['Uso', `${num(kmMes)} km/mês por ${sim.anos} anos`],
    ['Estado', `${ufSel.nome}${capital ? ' — capital (50% do IPVA do elétrico de volta + rodízio)' : ''}`],
    [
      'Forma de compra',
      sim.financiado ? `Financiado — ${pct(entradaPct, 0)} de entrada, ${num(prazoFin)}×, ${pct(taxaFin, 1)} a.a.` : 'À vista',
    ],
    ['Energia em casa', solar ? `solar (Fio B) ${brlCents(SOLAR_KWH_MARGINAL)}/kWh` : `${tarifaSel.distribuidora} ${brlCents(tarifa)}/kWh${branca ? ' (tarifa branca fora de ponta)' : ''}`],
    ['Recarga pública', `${brlCents(precoPublico)}/kWh · ${num(100 - fracCasa)}% dos kWh`],
    ['Cenário de recarga', `${cen.nome} — ${brl(capexInfra)} + ${brl(recorrenteAno)}/ano · perdas ${pct(perdas, 0)}`],
    ['Combustível', `gasolina ${brlCents(gasolina)}/l · etanol ${brlCents(etanol)}/l${flex ? ' (flex: o mais barato)' : ''}`],
    ['Consumo', `elétrico ${num(kwh100Bev, 1)} kWh/100 km · combustão ${num(kmlIce, 1)} km/l${ph ? ` · híbrido plug-in ${num(kwh100Phev, 1)} kWh/100 km, ${num(kmlPhev, 1)} km/l, ${pct(fracElEf, 0)} elétrico` : ''}`],
    ['Depreciação (1º ano / a.a.)', `elétrico ${pct(depPct.bev.ano1, 0)} / ${pct(depPct.bev.seguintes, 0)} · combustão ${pct(depPct.ice.ano1, 0)} / ${pct(depPct.ice.seguintes, 0)}${ph ? ` · híbrido plug-in ${pct(depPct.phev.ano1, 0)} / ${pct(depPct.phev.seguintes, 0)}` : ''}`],
    ['Seguro (% do valor/ano)', `elétrico ${pct(segBev, 1)} · combustão ${pct(segIce, 1)}${ph ? ` · híbrido plug-in ${pct(segPhev, 1)}` : ''}`],
    ['Manutenção (R$/ano)', `elétrico ${brl(manBev)} · combustão ${brl(manIce)}${ph ? ` · híbrido plug-in ${brl(manPhev)}` : ''}`],
    ['Bateria', `${num(bateriaKwh, 1)} kWh · ${brl(custoKwhBat)}/kWh · ${pct(probTroca, 0)} de troca em ${garantiaAnos} anos`],
    ['Reajuste energia/combustível', `${pct(reajuste, 1)} a.a.`],
    ['Custo de oportunidade', `${pct(custoOp, 1)} a.a. (${pct(sim.descontoAa, 1)} líq. de IR)`],
  ]

  /* -------------------------------- página ------------------------------- */
  return (
    <ToolPage
      icon={<BatteryCharging size={20} />}
      title="Vale a pena comprar um elétrico?"
      description="Elétrico, híbrido plug-in ou combustão equivalente, mantendo por alguns anos? Comparação em valor presente com energia × combustível, infra de recarga em casa, depreciação, IPVA, seguro, manutenção e bateria."
      inputs={
        <>
          <Card title="Os carros">
            <div className="space-y-4">
              <Segmented
                label="Categoria"
                hint="Ao trocar, os defaults de preço, consumo, seguro, manutenção e bateria mudam para os modelos de referência da categoria (tabelas set/2026). Tudo continua editável."
                options={CATEGORIAS_EV.map(c => ({ value: c.id, label: NOME_CURTO[c.id] }))}
                value={categoriaId}
                onChange={selecionarCategoria}
              />
              <p className="-mt-2 text-[11px] leading-relaxed text-mute">
                Referências: <strong className="text-ink-2">{cat.exemplos.bev}</strong> ×{' '}
                <strong className="text-ink-2">{cat.exemplos.ice}</strong>
                {cat.exemplos.phev && (
                  <>
                    {' '}
                    × <strong className="text-ink-2">{cat.exemplos.phev}</strong>
                  </>
                )}
              </p>
              <SliderField
                label="Preço do elétrico"
                value={precoBev}
                onChange={setK('precoBev')}
                min={60000}
                max={500000}
                step={10}
                format={brl}
                hint={`Preço de tabela do ${cat.exemplos.bev} (set/2026). Clique no valor para digitar o preço negociado.`}
              />
              <SliderField
                label="Preço do combustão"
                value={precoIce}
                onChange={setK('precoIce')}
                min={60000}
                max={500000}
                step={10}
                format={brl}
                hint={`Preço de tabela do ${cat.exemplos.ice} (set/2026), o equivalente a combustão da categoria.`}
              />
              {phevDisponivel ? (
                <Toggle
                  label="Incluir híbrido plug-in"
                  checked={incluirPhev}
                  onChange={setIncluirPhev}
                  hint={`Híbrido plug-in (PHEV): adiciona o ${cat.exemplos.phev} como terceira opção — roda parte dos km na bateria (recarregada em casa) e o resto a combustão.`}
                />
              ) : (
                <div className="pointer-events-none opacity-50" aria-disabled="true">
                  <Toggle label="Incluir híbrido plug-in" checked={false} onChange={() => {}} />
                  <p className="text-[11px] leading-relaxed text-mute">
                    Sem híbrido plug-in de referência nesta categoria — a opção existe em SUV (GWM Haval H6 PHEV19).
                  </p>
                </div>
              )}
              {phevAtivo && (
                <SliderField
                  label="Preço do híbrido plug-in"
                  value={precoPhev}
                  onChange={setK('precoPhev')}
                  min={60000}
                  max={500000}
                  step={10}
                  format={brl}
                  hint={`Preço de tabela do ${cat.exemplos.phev} (set/2026).`}
                />
              )}
              <SliderField
                label="Quanto você roda"
                value={kmMes}
                onChange={setKmMes}
                min={300}
                max={5000}
                step={50}
                format={v => `${num(v)} km/mês`}
                hint="É o parâmetro que mais muda a resposta: cada km rodado custa menos no elétrico. Default: 1.250 km/mês (15 mil km/ano, média brasileira)."
              />
              <SliderField
                label="Horizonte"
                value={horizonteAnos}
                onChange={setHorizonteAnos}
                min={3}
                max={10}
                step={1}
                format={v => `${v} anos`}
                hint="Por quanto tempo você fica com o carro. No fim, a revenda de cada um entra como crédito."
              />
              <div>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <label htmlFor={idUf} className="text-xs font-medium text-ink-2">
                    Estado (IPVA + licenciamento)
                  </label>
                  <InfoTip
                    text={`Alíquotas de IPVA 2026 por motorização (Sefaz estaduais; ABVE jan/2026): elétrico ${pct(
                      ufSel.bev * 100,
                      1,
                    )}, híbrido plug-in ${pct(ufSel.phev * 100, 1)}, combustão ${pct(ufSel.ice * 100, 1)}. ${ufSel.nota ?? ''}`}
                  />
                </div>
                <select id={idUf} value={uf} onChange={e => selecionarUf(e.target.value)} className={selectClass}>
                  {IPVA_EV_UF.map(e => (
                    <option key={e.uf} value={e.uf}>
                      {e.uf} — {e.nome} · elétrico {pct(e.bev * 100, 1)} / combustão {pct(e.ice * 100, 1)}
                    </option>
                  ))}
                </select>
              </div>
              {uf === 'SP' && (
                <>
                  <Toggle
                    label="Moro na capital de SP"
                    checked={capitalSp}
                    onChange={setCapitalSp}
                    hint="Lei municipal 15.997/2014 (prorrogada até 2030): a Prefeitura devolve 50% do IPVA do elétrico (até ~R$ 3.642/ano) e isenta elétricos e híbridos do rodízio."
                  />
                  {capitalSp && (
                    <NumberField
                      label="Quanto vale o rodízio para você"
                      value={rodizioAno}
                      onChange={setRodizioAno}
                      suffix="R$/ano"
                      min={0}
                      step={100}
                      hint="Opcional: quanto você pagaria por ano para não ficar um dia por semana sem carro (Uber, segundo carro, tempo). Entra como benefício do elétrico e do híbrido. Default 0."
                    />
                  )}
                </>
              )}
              <Segmented
                label="Forma de compra"
                hint="Mesmos termos para todos os carros. Financiado: entrada à vista + parcelas pela Tabela Price."
                options={[
                  { value: 'avista', label: 'À vista' },
                  { value: 'financiado', label: 'Financiado' },
                ]}
                value={modoCompra}
                onChange={setModoCompra}
              />
              {modoCompra === 'financiado' && (
                <>
                  <SliderField
                    label="Entrada"
                    value={entradaPct}
                    onChange={setEntradaPct}
                    min={0}
                    max={90}
                    step={5}
                    format={v => pct(v, 0)}
                    hint="Percentual do preço pago à vista. O restante vira financiamento pela Tabela Price."
                  />
                  <SliderField
                    label="Prazo do financiamento"
                    value={prazoFin}
                    onChange={setPrazoFin}
                    min={12}
                    max={60}
                    step={6}
                    format={v => `${num(v)} meses`}
                    hint="Se o horizonte terminar antes do contrato, o saldo devedor é quitado com a venda do carro."
                  />
                  <SliderField
                    label="Taxa do financiamento"
                    value={taxaFin}
                    onChange={setK('taxaFin')}
                    min={2}
                    max={60}
                    step={0.5}
                    format={v => `${pct(v, 1)} a.a.`}
                    hint="Default: taxa média BCB para aquisição de veículos por pessoa física (série SGS 20749). Linhas 'verdes' (BB, Caixa/Finame) chegam a 0,75–1,12% a.m. para elétricos."
                  />
                  <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-mute">
                    Parcelas: elétrico <strong className="tnum text-ink">{brlCents(b.parcelaFin)}</strong> · combustão{' '}
                    <strong className="tnum text-ink">{brlCents(i.parcelaFin)}</strong>
                    {ph && (
                      <>
                        {' '}
                        · híbrido plug-in <strong className="tnum text-ink">{brlCents(ph.parcelaFin)}</strong>
                      </>
                    )}{' '}
                    × {num(prazoFin)}
                  </p>
                  <LiveBadge live={rates.aoVivo} referencia={rates.referencia} />
                </>
              )}
            </div>
          </Card>

          <Card title="Energia e combustível">
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <label htmlFor={idDist} className="text-xs font-medium text-ink-2">
                    Distribuidora de energia
                  </label>
                  <InfoTip text="Tarifa residencial (B1) com impostos e bandeira amarela — ANEEL, tarifas homologadas, leitura 11/09/2026. Escolher a distribuidora preenche a tarifa abaixo (continua editável)." />
                </div>
                <select
                  id={idDist}
                  value={distribuidora}
                  onChange={e => selecionarDistribuidora(e.target.value)}
                  className={selectClass}
                >
                  {TARIFAS_ENERGIA.map(t => (
                    <option key={t.distribuidora} value={t.distribuidora}>
                      {t.distribuidora} ({t.uf}) — {brlCents(t.convencional)}/kWh
                    </option>
                  ))}
                </select>
              </div>
              <Toggle
                label="Tenho energia solar com sobra de créditos"
                checked={solar}
                onChange={setSolar}
                hint={`Lei 14.300/2022: em 2026 o kWh compensado paga só 60% do Fio B (a parte da tarifa que remunera a rede da distribuidora) — ≈ ${brlCents(
                  SOLAR_KWH_MARGINAL,
                )}/kWh com impostos. Só vale se o seu sistema injeta excedente; se não sobra crédito, o carro desloca energia que a casa usaria e o kWh custa a tarifa cheia — deixe desligado.`}
              />
              {solar ? (
                <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-mute">
                  Com solar e sobra de créditos, cada kWh carregado em casa custa{' '}
                  <strong className="tnum text-ink">{brlCents(SOLAR_KWH_MARGINAL)}</strong> (só o Fio B — a parte da tarifa
                  que paga o uso da rede). Se o
                  sistema não gera excedente, desligue e use a tarifa cheia de {brlCents(tarifaSel.convencional)}
                  /kWh.
                </p>
              ) : (
                <>
                  <Toggle
                    label="Tarifa branca (carrego à noite)"
                    checked={branca}
                    onChange={alternarBranca}
                    hint={`Usa a tarifa fora de ponta (${brlCents(
                      tarifaSel.brancaForaPonta,
                    )}/kWh na ${tarifaSel.distribuidora}, 21h30–16h30) no lugar da convencional. Só vale a pena se ≥ 85–90% do consumo da CASA inteira ficar fora de ponta — chuveiro elétrico e ar-condicionado das 17h30 às 21h30 anulam o ganho. Adesão < 3% dos residenciais (ANEEL 2025).`}
                  />
                  <SliderField
                    label="Tarifa de energia em casa"
                    value={tarifa}
                    onChange={setK('tarifa')}
                    min={0.5}
                    max={2}
                    step={0.01}
                    format={v => `${brlCents(v)}/kWh`}
                    hint={`Default: ${tarifaSel.distribuidora}, ${
                      branca ? 'tarifa branca fora de ponta' : 'tarifa convencional'
                    } com ICMS, PIS/COFINS e bandeira amarela (set/2026). Confira na sua conta: valor total ÷ kWh.`}
                  />
                </>
              )}
              <SliderField
                label="Recarga pública"
                value={precoPublico}
                onChange={setPrecoPublico}
                min={1}
                max={4}
                step={0.05}
                format={v => `${brlCents(v)}/kWh`}
                hint="Mistura de AC (shopping/hotel, R$ 1,50–2,20) e DC rápido (rodovia, R$ 2,10–3,20) — EVblog/Canaltech set/2026. Viagens longas: use R$ 2,90."
              />
              <SliderField
                label="Gasolina"
                value={gasolina}
                onChange={setGasolina}
                min={4}
                max={10}
                step={0.05}
                format={v => `${brlCents(v)}/l`}
                hint="Média Brasil ANP, semana 30/08–05/09/2026: R$ 6,51/l (mín. 5,44 · máx. 8,99)."
              />
              <SliderField
                label="Etanol"
                value={etanol}
                onChange={setEtanol}
                min={2.5}
                max={8}
                step={0.05}
                format={v => `${brlCents(v)}/l`}
                hint="Média Brasil ANP, mesma semana: R$ 3,95/l (paridade de 60,7% — abaixo de 70%, o etanol compensa no flex)."
              />
              <Toggle
                label="Flex: abasteço o que estiver mais barato"
                checked={flex}
                onChange={setFlex}
                hint="Custo/km do combustão = o menor entre gasolina ÷ km/l e etanol ÷ (km/l × 0,70). Desligado: só gasolina."
              />
              <SliderField
                label="Consumo do elétrico"
                value={kwh100Bev}
                onChange={setK('kwh100Bev')}
                min={8}
                max={25}
                step={0.5}
                format={v => `${num(v, 1)} kWh/100 km`}
                hint={`Uso real na bateria (≈ Inmetro ÷ 0,8), sem perdas de recarga — elas entram no cenário de recarga. Default do ${cat.exemplos.bev}: ${num(cat.kwh100Bev, 1)} kWh/100 km.`}
              />
              <SliderField
                label="Consumo do combustão"
                value={kmlIce}
                onChange={setK('kmlIce')}
                min={6}
                max={20}
                step={0.5}
                format={v => `${num(v, 1)} km/l`}
                hint={`km/l de gasolina em uso real (≈ 90% do Inmetro cidade). Default do ${cat.exemplos.ice}: ${num(cat.kmlIce, 1)} km/l.`}
              />
            </div>
          </Card>

          <Card title="Recarga em casa">
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="text-xs font-medium text-ink-2">Onde você vai carregar</span>
                  <InfoTip text="NBR 17019:2022 e NBR 5410: tomada comum compartilhada é vetada — o mínimo seguro é circuito exclusivo + tomada industrial + DR tipo A (proteção contra choque) + DPS (contra surtos). Aumento de carga na distribuidora é gratuito (REN 1.000/2021; 15–30 dias; o padrão de entrada é obra do cliente). Em condomínio: comunicação/assembleia, ART (responsável técnico) obrigatória e cabo do medidor até a vaga a até R$ 120/m (Lei SP 18.403/2026)." />
                </div>
                <div className="space-y-1">
                  {CENARIOS_RECARGA.map(c => {
                    const ativo = c.id === cenarioId
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selecionarCenario(c.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                          ativo
                            ? 'border-accent bg-accent-soft font-semibold text-ink'
                            : 'border-line bg-surface-2 text-ink-2 hover:text-ink'
                        }`}
                      >
                        <span>{c.nome}</span>
                        <span className="tnum shrink-0 text-[11px] text-mute">{c.capex > 0 ? brl(c.capex) : 'R$ 0'}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-mute">
                  {cen.descricao}
                  {cen.faixa !== '—' && <> Faixa verificada: {cen.faixa}.</>}
                </p>
              </div>
              {!rua && (
                <>
                  <SliderField
                    label="Custo único da infra"
                    value={capexInfra}
                    onChange={setK('capex')}
                    min={0}
                    max={20000}
                    step={100}
                    format={brl}
                    hint={`Equipamento + instalação + ART (o registro do eletricista responsável), pago no dia zero (cotações WEG/Intelbras/BYD/Enel X e eletricistas 2026). Default do cenário: ${brl(cen.capex)}.`}
                  />
                  <SliderField
                    label="Custo recorrente da infra"
                    value={recorrenteAno}
                    onChange={setK('recorrente')}
                    min={0}
                    max={1200}
                    step={10}
                    format={v => `${brl(v)}/ano`}
                    hint="Stand-by do wallbox (~R$ 44/ano), inspeção (~R$ 50/ano) e, em condomínio, taxa de gestão/submedição se houver."
                  />
                  <SliderField
                    label="Fração dos kWh carregada em casa"
                    value={fracCasa}
                    onChange={setK('fracCasa')}
                    min={0}
                    max={100}
                    step={5}
                    format={v => pct(v, 0)}
                    hint="O resto é recarga pública ao preço acima. Setor brasileiro: ~80–85% das recargas acontecem em casa (IEA: ~75% em local privado)."
                  />
                </>
              )}
              {rua && (
                <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-mute">
                  Sem ponto em casa: 0% dos kWh em casa e 100% em carregadores públicos a {brlCents(precoPublico)}/kWh
                  (com 8% de perdas). Custo de infra zero.
                </p>
              )}
              {!rua && (
                <SliderField
                  label="Perdas de recarga"
                  value={perdas}
                  onChange={setK('perdas')}
                  min={0}
                  max={25}
                  step={1}
                  format={v => pct(v, 0)}
                  hint="Energia que a rede entrega e não chega à bateria (ADAC ago/2026): tomada 2,2 kW ~15%, wallbox 7 kW ~7%, DC ~8%. Somada ao consumo carregado em casa; na rua usamos 8%."
                />
              )}
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-mute">
                {cen.potenciaKw > 0 ? (
                  <>
                    A <strong className="text-ink">{num(cen.potenciaKw, 1)} kW</strong>, a bateria de{' '}
                    {num(bateriaKwh, 1)} kWh do {cat.exemplos.bev} carrega de 0 a 100% em{' '}
                    <strong className="tnum text-ink">{num(sim.horas100 ?? 0, 1)} h</strong> (20→80%:{' '}
                    {num(sim.horas2080 ?? 0, 1)} h). Seus {num(kmMes)} km/mês pedem ≈ {num(sim.kwhDia, 1)} kWh/dia —{' '}
                    <strong className="tnum text-ink">{num(sim.horasNoite ?? 0, 1)} h</strong> por noite.
                  </>
                ) : (
                  <>Sem carregador em casa: cada 100 km pedem ≈ {num(kwh100Bev * (1 + PERDAS_RECARGA.dc), 1)} kWh na rua.</>
                )}
              </p>
            </div>
          </Card>

          <Collapse title="Premissas avançadas">
            <div className="space-y-4">
              <SliderField
                label="Depreciação do elétrico no 1º ano"
                value={depPct.bev.ano1}
                onChange={setDep('bev', 'ano1')}
                min={0}
                max={40}
                step={1}
                format={v => pct(v, 0)}
                hint="Fipe safra 2025 via Motor Show ago/2026: elétricos −20,2% no 1º ano (compactos chineses 12–16%; sedãs/SUVs > R$ 250 mil 22–28%). É o parâmetro mais incerto — novos cortes de tabela (BYD/GWM) puxam o usado para baixo."
              />
              <SliderField
                label="Depreciação do elétrico nos anos seguintes"
                value={depPct.bev.seguintes}
                onChange={setDep('bev', 'seguintes')}
                min={0}
                max={30}
                step={1}
                format={v => `${pct(v, 0)} a.a.`}
                hint="Geométrica sobre o residual, calibrada para bater Fipe 2 anos (−25%) e ~34% em 3 anos para a geração atual. A degradação da bateria (~2%/ano) já está refletida aqui."
              />
              <SliderField
                label="Depreciação do combustão no 1º ano"
                value={depPct.ice.ano1}
                onChange={setDep('ice', 'ano1')}
                min={0}
                max={40}
                step={1}
                format={v => pct(v, 0)}
                hint="Fipe safra 2025: combustão −14,2% no 1º ano (KBB mai/2026: 8–12%)."
              />
              <SliderField
                label="Depreciação do combustão nos anos seguintes"
                value={depPct.ice.seguintes}
                onChange={setDep('ice', 'seguintes')}
                min={0}
                max={30}
                step={1}
                format={v => `${pct(v, 0)} a.a.`}
                hint="Geométrica sobre o residual (Fipe 2 anos: −16,5%; 3 anos: −19,6%)."
              />
              {phevAtivo && (
                <>
                  <SliderField
                    label="Depreciação do híbrido plug-in no 1º ano"
                    value={depPct.phev.ano1}
                    onChange={setDep('phev', 'ano1')}
                    min={0}
                    max={40}
                    step={1}
                    format={v => pct(v, 0)}
                    hint="Bright jul/2026: híbridos plug-in de R$ 250–350 mil −22,2% no 1º ano (deflacionado); default 18%."
                  />
                  <SliderField
                    label="Depreciação do híbrido plug-in nos anos seguintes"
                    value={depPct.phev.seguintes}
                    onChange={setDep('phev', 'seguintes')}
                    min={0}
                    max={30}
                    step={1}
                    format={v => `${pct(v, 0)} a.a.`}
                    hint="Fipe jul/2026, 3 anos: Haval H6 PHEV ≈ −27%, Song Plus −38%."
                  />
                </>
              )}
              <SliderField
                label="Seguro do elétrico"
                value={segBev}
                onChange={setK('segBev')}
                min={0}
                max={10}
                step={0.1}
                format={v => `${pct(v, 1)}/ano`}
                hint="IPSA/TEx jun/2026: mediana prêmio/valor de 3,7% para elétricos (compactos baratos ~4,1%: bateria é até 40% do valor e o reparo é especializado). Aplicado sobre o valor já depreciado."
              />
              <SliderField
                label="Seguro do combustão"
                value={segIce}
                onChange={setK('segIce')}
                min={0}
                max={10}
                step={0.1}
                format={v => `${pct(v, 1)}/ano`}
                hint="IPSA/TEx jun/2026: 3,4% para gasolina; cotações ago/2026 da categoria."
              />
              {phevAtivo && (
                <SliderField
                  label="Seguro do híbrido plug-in"
                  value={segPhev}
                  onChange={setK('segPhev')}
                  min={0}
                  max={10}
                  step={0.1}
                  format={v => `${pct(v, 1)}/ano`}
                  hint="IPSA/TEx jun/2026: híbridos 2,7% — default 3,0% para o híbrido plug-in."
                />
              )}
              <SliderField
                label="Manutenção do elétrico"
                value={manBev}
                onChange={setK('manBev')}
                min={0}
                max={10000}
                step={100}
                format={v => `${brl(v)}/ano`}
                hint="CustoCarro abr/2026 (5 anos / 75 mil km): revisões R$ 1.450 + pneus R$ 7.500 + filtros R$ 300 — sem óleo, correias ou freios. Pneus desgastam 20–30% mais rápido."
              />
              <SliderField
                label="Manutenção do combustão"
                value={manIce}
                onChange={setK('manIce')}
                min={0}
                max={10000}
                step={100}
                format={v => `${brl(v)}/ano`}
                hint="CustoCarro abr/2026 (5 anos / 75 mil km): revisões R$ 4.870 + pneus R$ 5.500 + freios R$ 1.500 + óleo/correias/velas R$ 2.200 + filtros R$ 800."
              />
              {phevAtivo && (
                <>
                  <SliderField
                    label="Manutenção do híbrido plug-in"
                    value={manPhev}
                    onChange={setK('manPhev')}
                    min={0}
                    max={10000}
                    step={100}
                    format={v => `${brl(v)}/ano`}
                    hint="Dois trens de força: revisões a cada 10 mil km como o combustão, freios regenerativos duram mais."
                  />
                  {rua ? (
                    <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-mute">
                      Híbrido plug-in sem recarga em casa: 0% dos km em modo elétrico — ele roda como um híbrido a combustão a{' '}
                      {num(kmlPhev, 1)} km/l.
                    </p>
                  ) : (
                    <SliderField
                      label="Híbrido plug-in: fração elétrica dos km"
                      value={fracEl}
                      onChange={setFracEl}
                      min={0}
                      max={100}
                      step={5}
                      format={v => pct(v, 0)}
                      hint={`Quantos km você roda na bateria (autonomia elétrica real ≈ ${phevRef.autonomiaKm} km). Com recarga diária em casa e uso urbano, 60% é típico (faixa 30–85%).`}
                    />
                  )}
                  <SliderField
                    label="Híbrido plug-in: consumo em modo elétrico"
                    value={kwh100Phev}
                    onChange={setK('kwh100Phev')}
                    min={10}
                    max={35}
                    step={0.5}
                    format={v => `${num(v, 1)} kWh/100 km`}
                    hint="Derivado de bateria ÷ autonomia Inmetro (19 kWh ÷ 74 km, útil ~80%) — híbridos plug-in são mais pesados que elétricos puros."
                  />
                  <SliderField
                    label="Híbrido plug-in: consumo em modo híbrido"
                    value={kmlPhev}
                    onChange={setK('kmlPhev')}
                    min={6}
                    max={20}
                    step={0.5}
                    format={v => `${num(v, 1)} km/l`}
                    hint="km/l de gasolina com a bateria vazia (Haval H6 PHEV19: 13,6 cidade / 12,3 estrada)."
                  />
                </>
              )}
              <SliderField
                label="Bateria do elétrico"
                value={bateriaKwh}
                onChange={setK('bateriaKwh')}
                min={10}
                max={120}
                step={0.5}
                format={v => `${num(v, 1)} kWh`}
                hint={`Capacidade útil (default do ${cat.exemplos.bev}: ${num(cat.bateriaBev, 1)} kWh). Usada nas horas de recarga e na provisão de troca.`}
              />
              <SliderField
                label="Custo de troca da bateria"
                value={custoKwhBat}
                onChange={setCustoKwhBat}
                min={500}
                max={3000}
                step={50}
                format={v => `${brl(v)}/kWh`}
                hint="NSC Total jun/2026: R$ 1.300–1.800/kWh instalado (Dolphin Mini 38 kWh: R$ 50–65 mil; troca por módulo R$ 5–20 mil)."
              />
              <SliderField
                label="Chance de trocar a bateria fora da garantia"
                value={probTroca}
                onChange={setProbTroca}
                min={0}
                max={50}
                step={1}
                format={v => pct(v, 0)}
                hint="Provisão mensal = kWh × custo × chance ÷ meses de garantia, enquanto durar a garantia. Geotab jan/2026: degradação de 2,3% a.a. (81,6% após 8 anos) e a garantia cobre < 70% — troca é evento de cauda. A degradação já está na depreciação; não somamos duas vezes."
              />
              <SliderField
                label="Garantia da bateria"
                value={garantiaAnos}
                onChange={setGarantiaAnos}
                min={1}
                max={10}
                step={1}
                format={v => `${v} anos`}
                hint="Padrão do setor: 8 anos / 160 mil km / 70% (BYD e GWM: 8 anos / 200 mil km em 2026)."
              />
              {!rua && (
                <SliderField
                  label="Infra recuperada na venda"
                  value={residualPct}
                  onChange={setResidualPct}
                  min={0}
                  max={50}
                  step={5}
                  format={v => pct(v, 0)}
                  hint="% do custo da infra que volta no fim (wallbox é removível, mas não há mercado de usados; cabos e padrão ficam no imóvel). Default 0 = custo afundado."
                />
              )}
              <SliderField
                label="Reajuste de energia e combustível"
                value={reajuste}
                onChange={setK('reajuste')}
                min={0}
                max={15}
                step={0.5}
                format={v => `${pct(v, 1)} a.a.`}
                hint="Aplicado à tarifa, à recarga pública e aos combustíveis a cada 12 meses (e à manutenção). Default: IPCA acumulado 12 meses (BCB). A ANEEL projeta +8% nas tarifas em 2026."
              />
              <SliderField
                label="Licenciamento anual"
                value={licenciamento}
                onChange={setK('licenciamento')}
                min={0}
                max={1000}
                step={1}
                format={brl}
                hint="Taxa anual de licenciamento (CRLV) do estado — atualiza ao trocar o estado. Igual para as três motorizações."
              />
              <SliderField
                label="Custo de oportunidade"
                value={custoOp}
                onChange={setK('custoOp')}
                min={0}
                max={30}
                step={0.5}
                format={v => `${pct(v, 1)} a.a.`}
                hint="O que o seu dinheiro renderia investido (default: CDI, BCB ao vivo). Para trazer a valor presente aplicamos 15% de IR — alíquota de renda fixa acima de 720 dias."
              />
              <LiveBadge live={rates.aoVivo} referencia={rates.referencia} />
            </div>
          </Collapse>
        </>
      }
      results={
        <>
          <Verdict
            winner={verdictWinner}
            detail={verdictDetail}
            tone={sim.empate ? 'neutral' : bevVence ? 'positive' : 'negative'}
            badge={badgeKm}
          />

          <ExportBar pagina="eletrico" resumo={resumo} csv={csv} premissas={premissas} />

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile
              label={
                <span className="inline-flex items-center gap-1">
                  Elétrico — VP
                  <InfoTip
                    text={`VP = valor presente: tudo o que você gasta em ${sim.anos} anos trazido para dinheiro de hoje, já descontando a revenda no fim. Quanto menor, melhor.`}
                  />
                </span>
              }
              value={b.custo}
              format={brl}
              sub={`${cat.exemplos.bev} · revenda de ${brl(b.valorN)} já abatida`}
              tone={!sim.empate && sim.vencedor === 'bev' ? 'positive' : 'neutral'}
            />
            <StatTile
              label="Combustão — VP"
              value={i.custo}
              format={brl}
              sub={`${cat.exemplos.ice} · revenda de ${brl(i.valorN)} já abatida`}
              tone={!sim.empate && sim.vencedor === 'ice' ? 'positive' : 'neutral'}
            />
            {ph && (
              <StatTile
                label="Híbrido plug-in — VP"
                value={ph.custo}
                format={brl}
                sub={`${cat.exemplos.phev} · revenda de ${brl(ph.valorN)} já abatida`}
                tone={!sim.empate && sim.vencedor === 'phev' ? 'positive' : 'neutral'}
              />
            )}
            <StatTile
              label="Custo por km — elétrico (só energia)"
              value={sim.custoKm.bev}
              format={brlCents}
              sub={`combustão ${brlCents(sim.custoKm.ice)}/km a ${combustivelTxt}${
                ph ? ` · híbrido plug-in ${brlCents(sim.custoKm.phev)}/km` : ''
              }`}
              tone="accent"
            />
            <StatTile
              label="Energia por mês — elétrico (1º ano)"
              value={sim.energiaMes.bev}
              format={brl}
              sub={`combustão ${brl(sim.energiaMes.ice)}/mês a ${combustivelTxt}${
                ph ? ` · híbrido plug-in ${brl(sim.energiaMes.phev)}/mês` : ''
              }`}
            />
            <StatTile
              label="Infra de recarga (VP)"
              value={b.infra}
              format={brl}
              sub={
                rua
                  ? 'nenhuma — 100% na rua'
                  : `${brl(b.capex)} hoje + ${brl(recorrenteAno)}/ano${b.residual > 0 ? ` − ${brl(b.residual)} na venda` : ''}`
              }
            />
            <StatTile
              label="Economia em manutenção + IPVA (VP)"
              value={economiaManIpva}
              format={brl}
              sub={
                economiaManIpva >= 0
                  ? `o elétrico gasta menos que o combustão em ${sim.anos} anos`
                  : `o elétrico gasta mais que o combustão em ${sim.anos} anos`
              }
              tone={economiaManIpva >= 0 ? 'positive' : 'negative'}
            />
            <StatTile
              label={depAMais >= 0 ? 'Depreciação a mais do elétrico (VP)' : 'Depreciação a menos do elétrico (VP)'}
              value={Math.abs(depAMais)}
              format={brl}
              sub={`elétrico perde ${pct(perdaBevPct, 0)} em ${sim.anos} anos; combustão, ${pct(perdaIcePct, 0)}`}
              tone={depAMais >= 0 ? 'neutral' : 'positive'}
            />
          </div>

          <Card
            title="Custo acumulado em valor presente"
            subtitle="Cada linha desconta, mês a mês, quanto você recuperaria vendendo o carro (e quitando o financiamento) naquele momento — a infra de recarga fica na casa: só volta no fim, e só a fração que você definir nas premissas avançadas"
          >
            <VLineChart data={sim.chartMes} series={linhaSeries} xKey="mes" xFormat={labelMes} yFormat={brlCompact} />
            <p className="mt-3 text-[11px] leading-relaxed text-mute">
              {sim.breakEvenMes === null
                ? sim.bevJaFoiMaisBarato
                  ? 'As linhas chegam a se cruzar, mas o combustão termina mais barato no seu horizonte — o elétrico só compensaria segurando o carro por mais tempo (ou rodando mais).'
                  : 'A linha do combustão fica abaixo durante todo o horizonte: o elétrico começa com mais dinheiro parado (preço + infra) e a economia por km não recupera a diferença.'
                : sim.breakEvenMes <= 1
                  ? 'O elétrico já é mais barato desde o primeiro mês — mesmo que você vendesse o carro logo em seguida.'
                  : `O cruzamento das linhas é o break-even em tempo: a partir de ${meses(
                      sim.breakEvenMes,
                    )}, o elétrico fica mais barato que o combustão até o fim do horizonte.`}
            </p>
          </Card>

          <Card
            title="De onde vem o custo"
            subtitle={`Composição em valor presente no horizonte de ${sim.anos} anos${
              creditos.length > 0
                ? ' — os créditos não viram fatia (veja a nota abaixo)'
                : ' — as fatias somam o custo total de cada motorização'
            }`}
          >
            <VBarChart data={compData} series={compSeries} xKey="opcao" yFormat={brlCompact} stacked height={320} />
            <p className="mt-3 text-[11px] leading-relaxed text-mute">
              No elétrico, a depreciação pesa {brl(Math.max(0, b.dep))} contra {brl(Math.max(0, i.dep))} no combustão;
              em compensação, rodar custa {brl(b.energia)} contra {brl(i.energia)} no período
              {!rua && <>, e a infra de recarga entra com {brl(b.infra)}</>}.
              {creditos.length > 0 && (
                <>
                  {' '}
                  Créditos fora do gráfico: {creditos.join('; ')} — por isso as fatias dessa barra somam mais que o custo
                  total mostrado nos indicadores.
                </>
              )}
            </p>
          </Card>

          <Card
            title="Custo em valor presente × quilometragem"
            subtitle={`Mesma conta, variando só o quanto você roda (${num(KM_GRID.min)}–${num(
              KM_GRID.max,
            )} km/mês) — o cruzamento das linhas é o break-even em km`}
          >
            <VLineChart data={sim.grid} series={linhaSeries} xKey="km" xFormat={labelKm} yFormat={brlCompact} />
            <p className="mt-3 text-[11px] leading-relaxed text-mute">
              {sim.breakEvenKm.tipo === 'apartir'
                ? `Com as suas premissas o elétrico passa a custar menos que o combustão a partir de ${num(
                    sim.breakEvenKm.km,
                  )} km/mês (você roda ${num(kmMes)}). Cada 100 km/mês a mais tiram ${brl(
                    Math.abs(sim.por100km),
                  )} da diferença em ${sim.anos} anos.`
                : sim.breakEvenKm.tipo === 'ate'
                  ? `Aqui a lógica inverte: com recarga cara, o elétrico custa ${brlCents(
                      sim.custoKm.bev,
                    )}/km contra ${brlCents(sim.custoKm.ice)}/km do combustão — ele só vence rodando até ${num(
                      sim.breakEvenKm.km,
                    )} km/mês.`
                  : sim.breakEvenKm.tipo === 'sempre'
                    ? `O elétrico custa menos em qualquer quilometragem da grade — mesmo a ${num(
                        KM_GRID.min,
                      )} km/mês a economia em depreciação, IPVA ou seguro já cobre o prêmio de preço.`
                    : `Nem a ${num(KM_GRID.max)} km/mês o elétrico alcança o combustão neste horizonte: a diferença de ${brl(
                        Math.abs(diffBevIce),
                      )} vem de preço, depreciação e infra, e cada 100 km/mês a mais ${
                        sim.por100km >= 0 ? 'só recuperam' : 'ainda pioram'
                      } ${brl(Math.abs(sim.por100km))}${
                        sim.por100km < 0 ? ' — com recarga tão cara, o km do elétrico custa mais que o do combustão' : ''
                      }.`}
            </p>
          </Card>

          <Card
            title="Recarga em casa"
            subtitle={`${cen.nome}${cen.potenciaKw > 0 ? ` · ${num(cen.potenciaKw, 1)} kW` : ''} · bateria de ${num(
              bateriaKwh,
              1,
            )} kWh`}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
                <div className="text-[11px] font-medium text-mute">20 → 80%</div>
                <div className="mt-1 text-xl font-bold tnum text-ink">
                  {sim.horas2080 === null ? '—' : `${num(sim.horas2080, 1)} h`}
                </div>
                <div className="mt-0.5 text-[11px] text-mute">
                  {sim.horas2080 === null ? 'sem ponto em casa' : 'recarga do dia a dia'}
                </div>
              </div>
              <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
                <div className="text-[11px] font-medium text-mute">0 → 100%</div>
                <div className="mt-1 text-xl font-bold tnum text-ink">
                  {sim.horas100 === null ? '—' : `${num(sim.horas100, 1)} h`}
                </div>
                <div className="mt-0.5 text-[11px] text-mute">
                  {sim.horas100 === null ? 'sem ponto em casa' : 'carga completa (90% de eficiência AC)'}
                </div>
              </div>
              <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
                <div className="text-[11px] font-medium text-mute">Por noite</div>
                <div className="mt-1 text-xl font-bold tnum text-ink">
                  {sim.horasNoite === null ? '—' : `${num(sim.horasNoite, 1)} h`}
                </div>
                <div className="mt-0.5 text-[11px] text-mute">
                  ≈ {num(sim.kwhDia, 1)} kWh/dia para {num(kmMes)} km/mês
                </div>
              </div>
              <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
                <div className="text-[11px] font-medium text-mute">kWh que você paga</div>
                <div className="mt-1 text-xl font-bold tnum text-ink">{brlCents(sim.custoKwhBev)}</div>
                <div className="mt-0.5 text-[11px] text-mute">
                  média {num(fracCasa)}% casa / {num(100 - fracCasa)}% rua, com perdas
                </div>
              </div>
            </div>
            <div className="mt-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-mute">
                Quanto custa rodar 1.000 km
              </div>
              <DataTable
                columns={['Como', 'R$ por 1.000 km', 'Base']}
                align={['l', 'r', 'l']}
                rows={[
                  [
                    'Elétrico carregado em casa',
                    <strong key="c" className="text-positive">
                      {brl(sim.mil.casa)}
                    </strong>,
                    `${num(kwh100Bev, 1)} kWh/100 km × ${brlCents(sim.kwhCasa)}/kWh + ${pct(perdas, 0)} de perdas`,
                  ],
                  [
                    'Elétrico carregado na rua',
                    brl(sim.mil.rua),
                    `${num(kwh100Bev, 1)} kWh/100 km × ${brlCents(precoPublico)}/kWh + 8% de perdas`,
                  ],
                  [
                    'Combustão a gasolina',
                    brl(sim.mil.gasolina),
                    `${num(kmlIce, 1)} km/l × ${brlCents(gasolina)}/l`,
                  ],
                  [
                    'Combustão a etanol',
                    brl(sim.mil.etanol),
                    `${num(kmlIce * ETANOL_FATOR, 1)} km/l × ${brlCents(etanol)}/l${
                      flex ? (sim.usaEtanol ? ' — é o que a conta usa' : ' — gasolina está mais barata') : ' (flex desligado)'
                    }`,
                  ],
                ]}
              />
              <p className="mt-2 text-[11px] leading-relaxed text-mute">
                {rua
                  ? `Sem ponto em casa, você paga ${brl(sim.mil.rua)} por 1.000 km — ${
                      sim.mil.rua < Math.min(sim.mil.gasolina, sim.mil.etanol)
                        ? 'ainda abaixo do combustão, mas com menos folga'
                        : 'mais do que o combustão'
                    }. Um ponto em casa cai para ${brl(sim.mil.casa)}.`
                  : `Carregar em casa custa ${num(
                      Math.min(sim.mil.gasolina, sim.mil.etanol) / Math.max(1, sim.mil.casa),
                      1,
                    )}× menos que abastecer — a diferença que paga os ${brl(
                      capexInfra,
                    )} da infra (${CENARIO_CURTO[cen.id].toLowerCase()}) em ${
                      sim.energiaMes.ice - sim.energiaMes.bev > 0
                        ? `${num(capexInfra / (sim.energiaMes.ice - sim.energiaMes.bev), 0)} meses`
                        : '— (não paga)'
                    } só com a economia de energia.`}
              </p>
            </div>
          </Card>

          <Card
            title="Detalhamento ano a ano"
            subtitle="VP acumulado = custo líquido, em valor presente, se você vendesse o carro (e quitasse o financiamento) no fim daquele ano. Verde = mais barato até ali"
          >
            <DataTable
              columns={[
                'Ano',
                'Valor — elétrico',
                'Valor — combustão',
                ...(ph ? ['Valor — híbrido plug-in'] : []),
                'Gasto — elétrico',
                'Gasto — combustão',
                ...(ph ? ['Gasto — híbrido plug-in'] : []),
                'VP acum. — elétrico',
                'VP acum. — combustão',
                ...(ph ? ['VP acum. — híbrido plug-in'] : []),
              ]}
              align={['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r']}
              rows={sim.tabela.map(r => {
                const vps = [r.vpBev, r.vpIce, ...(ph ? [r.vpPhev] : [])]
                const menor = Math.min(...vps)
                const cel = (v: number, k: string) => (
                  <strong key={k} className={v <= menor ? 'text-positive' : 'text-ink'}>
                    {brl(v)}
                  </strong>
                )
                return [
                  `${r.ano}º`,
                  brl(r.valorBev),
                  brl(r.valorIce),
                  ...(ph ? [brl(r.valorPhev)] : []),
                  brl(r.gastoBev),
                  brl(r.gastoIce),
                  ...(ph ? [brl(r.gastoPhev)] : []),
                  cel(r.vpBev, 'b'),
                  cel(r.vpIce, 'i'),
                  ...(ph ? [cel(r.vpPhev, 'p')] : []),
                ]
              })}
            />
            <p className="mt-2 text-[11px] text-mute">
              "Gasto" é nominal e inclui {sim.financiado ? 'entrada e parcelas' : 'o preço do carro'}
              {!rua && ' e a infra de recarga'} no 1º ano, mais energia/combustível, seguro, manutenção, IPVA e provisão
              de bateria; a revenda aparece só nas colunas de VP.
            </p>
          </Card>

          <Didatico
            passos={[
              {
                t: 'Trouxemos tudo para dinheiro de hoje (VPL)',
                d: (
                  <>
                    Somamos cada gasto dos próximos {sim.anos} anos — compra, energia ou combustível, seguro, manutenção,
                    IPVA, bateria — tiramos a revenda no fim e trouxemos tudo para dinheiro de hoje a{' '}
                    {pct(sim.descontoAa, 1)} ao ano (seu custo de oportunidade de {pct(custoOp, 1)}, já tirando 15% de
                    imposto). Só assim o elétrico ({brl(b.custo)})
                    {ph ? (
                      <>
                        , o combustão ({brl(i.custo)}) e o híbrido plug-in ({brl(ph.custo)})
                      </>
                    ) : (
                      <> e o combustão ({brl(i.custo)})</>
                    )}{' '}
                    podem ser comparados de igual para igual.
                  </>
                ),
              },
              {
                t: 'O elétrico custa mais na compra, mas menos para rodar',
                d: (
                  <>
                    {premio > 0
                      ? `Você paga ${brl(premio)} a mais pelo elétrico (${brl(precoBev)} contra ${brl(precoIce)})`
                      : `Aqui o elétrico nem custa mais: ${brl(precoBev)} contra ${brl(precoIce)} do combustão`}
                    {!rua && <>, mais {brl(b.capex)} de infra em casa</>}. Em troca, cada km custa{' '}
                    {brlCents(sim.custoKm.bev)} no elétrico contra {brlCents(sim.custoKm.ice)} no combustão a{' '}
                    {combustivelTxt}: a {num(kmMes)} km/mês são {brl(sim.energiaMes.bev)} contra {brl(sim.energiaMes.ice)}{' '}
                    por mês — em {sim.anos} anos, {brl(economiaEnergia)} de economia em dinheiro de hoje.{' '}
                    {economiaManIpva >= 0
                      ? `Manutenção e IPVA somam mais ${brl(economiaManIpva)} a favor do elétrico`
                      : `Manutenção e IPVA tiram ${brl(-economiaManIpva)} dessa vantagem`}
                    , e o seguro {b.seguro > i.seguro ? `custa ${brl(b.seguro - i.seguro)} a mais` : `custa ${brl(i.seguro - b.seguro)} a menos`}.
                  </>
                ),
              },
              {
                t: 'A depreciação do elétrico é maior — e é o número mais incerto',
                d: (
                  <>
                    O elétrico de {brl(precoBev)} vale {brl(b.valorN)} depois de {sim.anos} anos (perde{' '}
                    {pct(perdaBevPct, 0)}); o combustão de {brl(precoIce)} vale {brl(i.valorN)} (perde{' '}
                    {pct(perdaIcePct, 0)}). Em dinheiro de hoje isso custa {brl(Math.max(0, b.dep))} contra{' '}
                    {brl(Math.max(0, i.dep))} (mais do que a perda de tabela, porque a revenda só chega daqui a {sim.anos}{' '}
                    anos e vale menos hoje) — {depAMais >= 0 ? `${brl(depAMais)} a mais` : `${brl(-depAMais)} a menos`}{' '}
                    para o elétrico. É o parâmetro mais incerto da conta: a Fipe da safra 2025 mostra −20% no 1º ano
                    para elétricos contra −14% para combustão, mas compactos chineses já depreciam igual ou menos, e a
                    guerra de preços (BYD, GWM, Geely cortando tabela do 0 km) puxa o usado junto.{' '}
                    {sim.porPpDep >= 0
                      ? `Cada 1 ponto a mais na depreciação do 1º ano custa ≈ ${brl(sim.porPpDep)} em valor presente (menos do que parece: seguro e IPVA caem junto com o valor do carro).`
                      : `Curioso: neste horizonte, cada 1 ponto a mais na depreciação do 1º ano até reduz o custo em ≈ ${brl(-sim.porPpDep)} — o seguro e o IPVA que você deixa de pagar sobre um carro que vale menos superam a perda na revenda.`}
                  </>
                ),
              },
              {
                t: rua ? 'Sem ponto em casa, a recarga pública come a vantagem' : 'A infra em casa é parte da conta',
                d: rua ? (
                  <>
                    Carregando só na rua a {brlCents(precoPublico)}/kWh, o elétrico custa {brlCents(sim.custoKm.bev)}
                    /km — {sim.custoKm.bev < sim.custoKm.ice ? 'ainda abaixo' : 'acima'} dos{' '}
                    {brlCents(sim.custoKm.ice)}/km do combustão. Com um ponto em casa a {brlCents(sim.kwhCasa)}/kWh o
                    custo cairia para {brlCents((kwh100Bev / 100) * sim.kwhCasaEf)}/km. Se o cenário mudar (mudança,
                    condomínio que libera), refaça a conta.
                  </>
                ) : (
                  <>
                    {cen.nome} custa {brl(b.capex)} hoje{recorrenteAno > 0 && <> mais {brl(recorrenteAno)}/ano</>}
                    {b.residual > 0 && <>, recuperando {brl(b.residual)} na venda</>}: {brl(b.infra)} em valor presente,{' '}
                    {pct(pctInfra, 1)} do custo total do elétrico. A {num(cen.potenciaKw, 1)} kW, seus {num(kmMes)} km/mês
                    pedem ≈ {num(sim.horasNoite ?? 0, 1)} h de recarga por noite. O aumento de carga na distribuidora é
                    gratuito (15–30 dias); o padrão de entrada e o cabo até a vaga são obra sua.
                  </>
                ),
              },
              {
                t: 'Regra de bolso',
                d: (
                  <>
                    {sim.breakEvenKm.tipo === 'apartir' && (
                      <>
                        A partir de <strong className="text-ink">{num(sim.breakEvenKm.km)} km/mês</strong> o elétrico
                        vence o combustão — você roda {num(kmMes)}. Cada 100 km/mês a mais tiram {brl(Math.abs(sim.por100km))}{' '}
                        da diferença em {sim.anos} anos.
                      </>
                    )}
                    {sim.breakEvenKm.tipo === 'ate' && (
                      <>
                        Com recarga cara, o elétrico só vence rodando até{' '}
                        <strong className="text-ink">{num(sim.breakEvenKm.km)} km/mês</strong> — acima disso, cada km na
                        rua custa mais que o combustível.
                      </>
                    )}
                    {sim.breakEvenKm.tipo === 'sempre' && (
                      <>
                        Com as suas premissas o elétrico vence em <strong className="text-ink">qualquer quilometragem</strong>{' '}
                        — o que decide não é o km, é depreciação, IPVA e seguro.
                      </>
                    )}
                    {sim.breakEvenKm.tipo === 'nunca' && (
                      <>
                        Com as suas premissas o elétrico <strong className="text-ink">não alcança o combustão</strong> nem
                        a {num(KM_GRID.max)} km/mês em {sim.anos} anos: a diferença de {brl(Math.abs(diffBevIce))} vem de
                        preço, depreciação e infra. Segurar o carro por mais tempo dilui a depreciação.
                      </>
                    )}{' '}
                    Por km rodado no total: elétrico {brlCents(sim.custoKmTotal.bev)}, combustão{' '}
                    {brlCents(sim.custoKmTotal.ice)}
                    {ph && <>, híbrido plug-in {brlCents(sim.custoKmTotal.phev)}</>}.
                  </>
                ),
              },
            ]}
            analogia={
              premio + b.capex > 0 ? (
                <>
                  Comprar um elétrico é como assinar um plano caro com mensalidade barata: você paga{' '}
                  {brl(premio + b.capex)} a mais na entrada ({premio > 0 ? `${brl(premio)} do carro` : 'nada do carro'}
                  {b.capex > 0 && <> e {brl(b.capex)} de infra</>}) para gastar {brl(Math.max(0, sim.energiaMes.ice - sim.energiaMes.bev))} a
                  menos por mês rodando. A conta fecha quando os meses de economia pagam a entrada — e a depreciação
                  decide se o plano ainda compensa na hora de sair.
                </>
              ) : (
                <>
                  No seu caso o plano caro virou barato: o elétrico custa {brl(-premio)} a menos que o combustão na compra
                  e ainda gasta {brl(Math.max(0, sim.energiaMes.ice - sim.energiaMes.bev))} a menos por mês rodando. Só
                  a depreciação mais forte e o seguro mais caro podem virar a conta.
                </>
              )
            }
            sensibilidade={
              <>
                Quilometragem e depreciação invertem o resultado. Hoje a diferença é de {brl(Math.abs(diffBevIce))}{' '}
                {diffBevIce >= 0 ? 'a favor do elétrico' : 'a favor do combustão'}; cada 100 km/mês{' '}
                {sim.por100km >= 0 ? 'a mais dão' : 'a menos dão'} {brl(Math.abs(sim.por100km))} ao elétrico
                {sim.breakEvenKm.tipo === 'apartir' && <> (ele vence a partir de {num(sim.breakEvenKm.km)} km/mês)</>}.
                Na depreciação, cada 1 ponto no 1º ano do elétrico{' '}
                {sim.porPpDep >= 0 ? `custa ${brl(sim.porPpDep)}` : `tira ${brl(-sim.porPpDep)} do custo`}:{' '}
                {sim.depInvertePp !== null
                  ? `o resultado inverte se ela ${sim.depInvertePp > depPct.bev.ano1 ? 'passar de' : 'cair para'} ${pct(
                      sim.depInvertePp,
                      0,
                    )} (hoje ${pct(depPct.bev.ano1, 0)})`
                  : `nenhuma depreciação entre 0% e 60% no 1º ano inverteria o resultado (hoje ${pct(
                      depPct.bev.ano1,
                      0,
                    )})`}
                . O horizonte também pesa: períodos longos diluem a depreciação forte do início e a infra.
              </>
            }
          />

          <Card title="Premissas e fontes" subtitle="Pesquisa de 11/09/2026 — tudo é editável nos controles ao lado">
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-ink-2">
              <li>
                Taxa de desconto: custo de oportunidade de {pct(custoOp, 2)} a.a. (default: CDI, BCB{' '}
                {rates.aoVivo ? 'ao vivo' : 'de referência'}) líquido de 15% de IR (Lei 11.033/2004) → {pct(sim.descontoAa, 2)}{' '}
                a.a. Reajuste de energia e combustível de {pct(reajuste, 1)} a.a. (default: IPCA 12 m).
              </li>
              <li>
                Preços de tabela set/2026: {cat.exemplos.bev} {brl(precoBev)} × {cat.exemplos.ice} {brl(precoIce)}
                {ph && <> × {cat.exemplos.phev} {brl(precoPhev)}</>}. Mercado: eletrificados foram 22% dos leves em ago/2026
                (ABVE) — 100% elétricos ≈ 10%, híbrido plug-in ≈ 8%.
              </li>
              <li>
                Energia: {solar ? (
                  <>solar com sobra de créditos — kWh a {brlCents(SOLAR_KWH_MARGINAL)} (60% do Fio B, a parte da tarifa que paga o uso da rede — Lei 14.300/2022)</>
                ) : (
                  <>
                    {tarifaSel.distribuidora} {brlCents(tarifa)}/kWh {branca ? 'fora de ponta (tarifa branca)' : 'convencional'} com
                    impostos e bandeira amarela (ANEEL, tarifas homologadas, leitura 11/09/2026)
                  </>
                )}
                ; recarga pública {brlCents(precoPublico)}/kWh (EVblog/Canaltech set/2026); perdas de {pct(perdas, 0)} em
                casa e 8% na rua (ADAC ago/2026). kWh médio pago: {brlCents(sim.custoKwhBev)}.
              </li>
              <li>
                Combustíveis ANP (média Brasil, 30/08–05/09/2026): gasolina {brlCents(gasolina)}/l, etanol {brlCents(etanol)}/l.
                Consumo real: elétrico {num(kwh100Bev, 1)} kWh/100 km (etiqueta do Inmetro, o PBEV, ÷ 0,8), combustão {num(kmlIce, 1)} km/l
                (≈ 90% do Inmetro cidade){flex && <>; flex abastece o mais barato (etanol ≤ 70% do preço da gasolina)</>}.
              </li>
              <li>
                Depreciação nominal: elétrico {pct(depPct.bev.ano1, 0)} no 1º ano e {pct(depPct.bev.seguintes, 0)} a.a.;
                combustão {pct(depPct.ice.ano1, 0)} e {pct(depPct.ice.seguintes, 0)} a.a.
                {ph && <>; híbrido plug-in {pct(depPct.phev.ano1, 0)} e {pct(depPct.phev.seguintes, 0)} a.a.</>} — Fipe safras 2023–25 via
                Motor Show (ago/2026), KBB (mai/2026), Bright (jul/2026). Revendas de {brl(b.valorN)} × {brl(i.valorN)}
                {ph && <> × {brl(ph.valorN)}</>} voltam como crédito em {sim.anos} anos.
              </li>
              <li>
                IPVA {ufSel.nome} 2026: elétrico {pct(ufSel.bev * 100, 1)}, híbrido plug-in {pct(ufSel.phev * 100, 1)}
                {uf === 'SP' && ' (2026; sobe 1 ponto por ano a partir de 2027)'}, combustão {pct(ufSel.ice * 100, 1)} sobre o valor
                depreciado (Sefaz estaduais; ABVE jan/2026) + licenciamento de {brl(licenciamento)}/ano.
                {capital && (
                  <>
                    {' '}
                    Capital de SP (Lei 15.997/2014): 50% do IPVA do elétrico de volta
                    {rodizioAno > 0 && <> e rodízio avaliado em {brl(rodizioAno)}/ano para elétrico e híbrido plug-in</>}.
                  </>
                )}
                {ufSel.nota && <> {ufSel.nota}</>}
              </li>
              <li>
                Seguro (IPSA/TEx jun/2026 + cotações ago/2026): elétrico {pct(segBev, 1)}, combustão {pct(segIce, 1)}
                {ph && <>, híbrido plug-in {pct(segPhev, 1)}</>} do valor por ano. Manutenção + pneus a 15 mil km/ano (CustoCarro abr/2026):
                elétrico {brl(manBev)}, combustão {brl(manIce)}{ph && <>, híbrido plug-in {brl(manPhev)}</>} por ano.
              </li>
              <li>
                Bateria: {num(bateriaKwh, 1)} kWh; troca a {brl(custoKwhBat)}/kWh (NSC Total jun/2026: R$ 1.300–1.800/kWh);
                {' '}{pct(probTroca, 0)} de chance fora da garantia de {garantiaAnos} anos → provisão de {brl(b.bateria)} em VP.
                Degradação de 2,3% a.a. (Geotab jan/2026) já está na depreciação — não somamos duas vezes.
              </li>
              {rua ? (
                <li>
                  Recarga: sem ponto em casa — 100% dos kWh em carregadores públicos a {brlCents(precoPublico)}/kWh (25,5 mil
                  pontos no país em mai/2026, 66% AC — ABVE/Tupi). Sem custo de infra; o híbrido plug-in roda 100% a combustão.
                </li>
              ) : (
                <li>
                  Recarga em casa: {cen.nome} — {brl(capexInfra)} hoje{recorrenteAno > 0 && <> + {brl(recorrenteAno)}/ano</>},{' '}
                  {pct(residualPct, 0)} recuperado na venda (NBR 17019:2022 / NBR 5410; cotações WEG/Intelbras/BYD/Enel X 2026;
                  aumento de carga gratuito pela REN 1.000/2021; condomínio: Lei SP 18.403/2026). {num(fracCasa)}% dos kWh em
                  casa.
                  {sim.horas100 !== null && <> Carga completa em {num(sim.horas100, 1)} h a {num(cen.potenciaKw, 1)} kW.</>}
                </li>
              )}
              {sim.financiado && (
                <li>
                  Financiamento pela Tabela Price a {pct(taxaFin, 2)} a.a. (default: média BCB de aquisição de veículos PF, SGS
                  20749), {pct(entradaPct, 0)} de entrada, {num(prazoFin)} meses, mesmos termos para os três carros.
                  {b.saldoN > 0
                    ? ` Como o horizonte termina antes do contrato, o saldo devedor (${brl(b.saldoN)} no elétrico) é quitado com a venda.`
                    : ' O contrato é quitado dentro do horizonte.'}
                </li>
              )}
              <li>Ferramenta educacional de comparação — não é recomendação financeira.</li>
            </ul>
          </Card>
        </>
      }
    />
  )
}
