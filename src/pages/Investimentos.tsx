import { useMemo, useState, type ReactNode } from 'react'
import { Landmark } from 'lucide-react'
import {
  Card,
  Collapse,
  DataTable,
  Didatico,
  ExportBar,
  InfoTip,
  LiveBadge,
  SectionTitle,
  SliderField,
  StatTile,
  ToolPage,
  Verdict,
} from '../components/ui'
import { VLineChart, type SeriesDef } from '../components/charts'
import { useVizColors } from '../theme'
import { useRates } from '../lib/rates'
import { PRODUTOS_RF } from '../lib/dados2026'
import { aToM, fvSeries, irRegressivo, mToA } from '../lib/finance'
import { brl, brlCompact, meses as fmtMeses, num, pct } from '../lib/format'

/* ============================================================
   Simulação (aporte inicial + aportes mensais, IR aporte a aporte)
   ============================================================ */

interface PontoSerie {
  mes: number
  liquido: number
}

interface ResultadoSim {
  bruto: number
  ir: number
  taxas: number
  liquido: number
  rendimentoLiquido: number
  taxaLiquidaAa: number
  /** valor líquido se resgatar em cada mês (índice = mês) */
  serie: PontoSerie[]
}

const diasDe = (m: number) => Math.round((m * 365) / 12)
const fin = (v: number) => (Number.isFinite(v) ? v : 0)

/** Taxa anual constante que produziria o mesmo líquido com os mesmos fluxos (bissecção). */
function taxaLiquidaEquivalente(liquido: number, inicial: number, mensal: number, n: number): number {
  const investido = inicial + mensal * n
  if (!(investido > 0) || n <= 0 || !(liquido > 0)) return 0
  let lo = -95
  let hi = 300
  // Caso degenerado (ex.: só 1 aporte no fim do 1º mês): o VF não depende da taxa
  // e a bissecção colapsaria em -95%. Se até a taxa mínima já alcança o líquido, é 0.
  if (fvSeries(inicial, aToM(lo), n, mensal) >= liquido) return 0
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (fvSeries(inicial, aToM(mid), n, mensal) < liquido) lo = mid
    else hi = mid
  }
  return fin((lo + hi) / 2)
}

/**
 * Produto "clássico": capitaliza mensalmente; IR regressivo calculado
 * aporte a aporte (cada aporte tem o próprio prazo). Custódia (B3) acumulada
 * sobre o saldo que exceder a isenção.
 */
function simulaPadrao(
  taxaAa: number,
  prazoMeses: number,
  inicial: number,
  mensal: number,
  opts: { isento?: boolean; custodiaAaPct?: number; custodiaIsencao?: number } = {},
): ResultadoSim {
  const n = Math.max(1, Math.round(prazoMeses))
  const m = aToM(Math.max(-99, taxaAa))
  const aportes: Array<{ dep: number; valor: number; principal: number }> = []
  if (inicial > 0) aportes.push({ dep: 0, valor: inicial, principal: inicial })
  const serie: PontoSerie[] = [{ mes: 0, liquido: inicial }]
  let custodiaAcum = 0
  let bruto = inicial
  let ir = 0
  for (let t = 1; t <= n; t++) {
    for (const a of aportes) a.valor *= 1 + m
    if (mensal > 0) aportes.push({ dep: t, valor: mensal, principal: mensal })
    bruto = aportes.reduce((s, a) => s + a.valor, 0)
    if (opts.custodiaAaPct) {
      custodiaAcum += (opts.custodiaAaPct / 100 / 12) * Math.max(0, bruto - (opts.custodiaIsencao ?? 0))
    }
    ir = 0
    if (!opts.isento) {
      for (const a of aportes) {
        ir += Math.max(0, a.valor - a.principal) * irRegressivo(diasDe(t - a.dep))
      }
    }
    serie.push({ mes: t, liquido: fin(bruto - ir - custodiaAcum) })
  }
  const liquido = fin(bruto - ir - custodiaAcum)
  const investido = inicial + mensal * n
  return {
    bruto: fin(bruto),
    ir: fin(ir),
    taxas: fin(custodiaAcum),
    liquido,
    rendimentoLiquido: fin(liquido - investido),
    taxaLiquidaAa: taxaLiquidaEquivalente(liquido, inicial, mensal, n),
    serie,
  }
}

/**
 * Fundo DI: rende CDI − taxa de adm; come-cotas de 15% a cada 6 meses
 * (aproximação de maio/novembro), aporte a aporte. No resgate, a alíquota da
 * tabela regressiva (pelo prazo de CADA aporte) incide sobre o ganho TOTAL
 * acumulado, descontando o IR já retido nos come-cotas (IN RFB 1.585/2015) —
 * quem resgata antes de 720 dias paga a diferença sobre o que o come-cotas
 * tributou a só 15%.
 */
function simulaFundo(taxaAa: number, prazoMeses: number, inicial: number, mensal: number): ResultadoSim {
  const n = Math.max(1, Math.round(prazoMeses))
  const m = aToM(Math.max(-99, taxaAa))
  const cotas: Array<{ dep: number; valor: number; custo: number; irPago: number }> = []
  if (inicial > 0) cotas.push({ dep: 0, valor: inicial, custo: inicial, irPago: 0 })
  /** valor de mercado e IR complementar devidos num resgate no mês t */
  const resgateEm = (t: number) => {
    let valor = 0
    let irResgate = 0
    for (const a of cotas) {
      valor += a.valor
      const ganhoTotal = Math.max(0, a.valor + a.irPago - a.custo)
      irResgate += Math.max(0, ganhoTotal * irRegressivo(diasDe(t - a.dep)) - a.irPago)
    }
    return { valor, irResgate }
  }
  const serie: PontoSerie[] = [{ mes: 0, liquido: inicial }]
  for (let t = 1; t <= n; t++) {
    for (const a of cotas) a.valor *= 1 + m
    if (mensal > 0) cotas.push({ dep: t, valor: mensal, custo: mensal, irPago: 0 })
    if (t % 6 === 0) {
      for (const a of cotas) {
        // come-cotas: 15% sobre o ganho do aporte ainda não tributado
        const naoTributado = a.valor + a.irPago - a.custo - a.irPago / 0.15
        const cc = 0.15 * Math.max(0, naoTributado)
        a.valor -= cc
        a.irPago += cc
      }
    }
    const r = resgateEm(t)
    serie.push({ mes: t, liquido: fin(r.valor - r.irResgate) })
  }
  const fim = resgateEm(n)
  const irPagoTotal = cotas.reduce((s, a) => s + a.irPago, 0)
  const liquido = fin(fim.valor - fim.irResgate)
  const investido = inicial + mensal * n
  return {
    bruto: fin(fim.valor + irPagoTotal),
    ir: fin(irPagoTotal + fim.irResgate),
    taxas: 0,
    liquido,
    rendimentoLiquido: fin(liquido - investido),
    taxaLiquidaAa: taxaLiquidaEquivalente(liquido, inicial, mensal, n),
    serie,
  }
}

interface Produto {
  id: string
  nome: string
  taxaLabel: string
  garantia: string
  nota: string
  isento: boolean
  r: ResultadoSim
}

const DEGRAUS_IR = [
  { aliq: 22.5, label: 'até 180 dias' },
  { aliq: 20, label: '181–360 dias' },
  { aliq: 17.5, label: '361–720 dias' },
  { aliq: 15, label: 'mais de 720' },
] as const

/* ============================================================
   Página
   ============================================================ */

export default function Investimentos() {
  const rates = useRates()
  const c = useVizColors()

  // Inputs principais
  const [aporteInicial, setAporteInicial] = useState(10000)
  const [aporteMensal, setAporteMensal] = useState(500)
  const [prazo, setPrazo] = useState(24)

  // Indexadores (null = usa o valor ao vivo do BCB até o usuário editar)
  const [ipcaEdit, setIpcaEdit] = useState<number | null>(null)
  const [cdiEdit, setCdiEdit] = useState<number | null>(null)
  const [selicEdit, setSelicEdit] = useState<number | null>(null)
  const [trEdit, setTrEdit] = useState<number | null>(null)

  // Premissas dos produtos (defaults de dados2026.ts)
  const [cdbGrande, setCdbGrande] = useState<number>(PRODUTOS_RF.cdbGrandePctCdi)
  const [cdbMedio, setCdbMedio] = useState<number>(PRODUTOS_RF.cdbMedioPctCdi)
  const [cdbPequeno, setCdbPequeno] = useState<number>(PRODUTOS_RF.cdbPequenoPctCdi)
  const [lciPct, setLciPct] = useState<number>(PRODUTOS_RF.lciPctCdi)
  const [lcPct, setLcPct] = useState<number>(PRODUTOS_RF.lcPctCdi)
  const [selicSpread, setSelicSpread] = useState<number>(PRODUTOS_RF.tesouroSelicSpread)
  const [prefixado, setPrefixado] = useState<number>(PRODUTOS_RF.tesouroPrefixado)
  const [ipcaReal, setIpcaReal] = useState<number>(PRODUTOS_RF.tesouroIpcaReal)
  const [custodiaB3, setCustodiaB3] = useState<number>(PRODUTOS_RF.custodiaB3)
  const [fundoAdm, setFundoAdm] = useState<number>(PRODUTOS_RF.fundoDiTaxaAdm)

  const cdi = cdiEdit ?? rates.cdi
  const selic = selicEdit ?? rates.selic
  const tr = trEdit ?? rates.trMes
  const ipca = ipcaEdit ?? rates.ipca12m

  const calc = useMemo(() => {
    const ini = Math.max(0, aporteInicial)
    const mensal = Math.max(0, aporteMensal)
    const n = Math.max(1, Math.round(prazo))

    // Poupança: Lei 12.703/2012 — 0,5% a.m. + TR se Selic > 8,5% a.a.; senão 70% da Selic + TR.
    const pouMensal = selic > 8.5 ? 0.005 + tr / 100 : aToM(selic * 0.7) + tr / 100
    const pouAa = mToA(pouMensal)
    const ipcaMaisAa = ((1 + ipca / 100) * (1 + ipcaReal / 100) - 1) * 100

    const fgc = 'FGC até R$ 250 mil'
    const tn = 'Tesouro Nacional'

    const produtos: Produto[] = [
      {
        id: 'poupanca',
        nome: 'Poupança',
        taxaLabel: selic > 8.5 ? '0,5% a.m. + TR' : '70% da Selic + TR',
        garantia: fgc,
        nota: 'Tem liquidez diária (mas só rende na data de aniversário) e garantia do FGC.',
        isento: true,
        r: simulaPadrao(pouAa, n, ini, mensal, { isento: true }),
      },
      {
        id: 'cdbGrande',
        nome: 'CDB banco grande',
        taxaLabel: `${num(cdbGrande)}% do CDI`,
        garantia: fgc,
        nota: 'Coberto pelo FGC; bancos grandes costumam oferecer liquidez diária a 100% do CDI.',
        isento: false,
        r: simulaPadrao((cdi * cdbGrande) / 100, n, ini, mensal),
      },
      {
        id: 'cdbMedio',
        nome: 'CDB banco médio',
        taxaLabel: `${num(cdbMedio)}% do CDI`,
        garantia: fgc,
        nota: 'Coberto pelo FGC até R$ 250 mil; a liquidez normalmente é só no vencimento.',
        isento: false,
        r: simulaPadrao((cdi * cdbMedio) / 100, n, ini, mensal),
      },
      {
        id: 'cdbPequeno',
        nome: 'CDB banco pequeno',
        taxaLabel: `${num(cdbPequeno)}% do CDI`,
        garantia: fgc,
        nota: 'Coberto pelo FGC até R$ 250 mil por CPF e instituição — em geral sem liquidez antes do vencimento.',
        isento: false,
        r: simulaPadrao((cdi * cdbPequeno) / 100, n, ini, mensal),
      },
      {
        id: 'lci',
        nome: 'LCI/LCA',
        taxaLabel: `${num(lciPct)}% do CDI`,
        garantia: fgc,
        nota: 'Isenta de IR e coberta pelo FGC, mas com carência mínima de 9 meses para resgate.',
        isento: true,
        r: simulaPadrao((cdi * lciPct) / 100, n, ini, mensal, { isento: true }),
      },
      {
        id: 'lc',
        nome: 'LC',
        taxaLabel: `${num(lcPct)}% do CDI`,
        garantia: fgc,
        nota: 'Letra de Câmbio (financeiras): FGC até R$ 250 mil e IR normal, como um CDB.',
        isento: false,
        r: simulaPadrao((cdi * lcPct) / 100, n, ini, mensal),
      },
      {
        id: 'tSelic',
        nome: 'Tesouro Selic',
        taxaLabel: `Selic + ${pct(selicSpread, 2)}`,
        garantia: tn,
        nota: 'Garantia do Tesouro Nacional e liquidez diária sem sustos — o "colchão de emergência" clássico.',
        isento: false,
        r: simulaPadrao(selic + selicSpread, n, ini, mensal, {
          custodiaAaPct: custodiaB3,
          custodiaIsencao: 10000,
        }),
      },
      {
        id: 'tPre',
        nome: 'Tesouro Prefixado',
        taxaLabel: `${pct(prefixado, 1)} a.a.`,
        garantia: tn,
        nota: 'Garantia do Tesouro Nacional — mas a taxa só é garantida levando até o vencimento (antes disso há marcação a mercado).',
        isento: false,
        r: simulaPadrao(prefixado, n, ini, mensal, { custodiaAaPct: custodiaB3 }),
      },
      {
        id: 'tIpca',
        nome: 'Tesouro IPCA+',
        taxaLabel: `IPCA + ${pct(ipcaReal, 1)}`,
        garantia: tn,
        nota: 'Garantia do Tesouro Nacional e proteção contra a inflação — se levado até o vencimento.',
        isento: false,
        r: simulaPadrao(ipcaMaisAa, n, ini, mensal, { custodiaAaPct: custodiaB3 }),
      },
      {
        id: 'fundoDi',
        nome: 'Fundo DI',
        taxaLabel: `CDI − ${pct(fundoAdm, 1)} adm`,
        garantia: 'Sem FGC',
        nota: 'Liquidez diária, mas sem FGC e com come-cotas semestral comendo parte dos juros compostos.',
        isento: false,
        r: simulaFundo(cdi - fundoAdm, n, ini, mensal),
      },
    ]

    const ranking = [...produtos].sort((a, b) => b.r.liquido - a.r.liquido)
    const top4 = ranking.slice(0, 4)
    const chartData: Array<Record<string, number | string>> = []
    for (let t = 0; t <= n; t++) {
      const row: Record<string, number | string> = { mes: t }
      for (const p of top4) row[p.id] = Math.round(p.r.serie[t]?.liquido ?? 0)
      chartData.push(row)
    }
    const chartSeries: SeriesDef[] = top4.map((p, i) => ({ key: p.id, name: p.nome, colorIndex: i }))

    const aliqPrazo = irRegressivo(diasDe(n))
    const poupanca = produtos[0]
    const totalInvestido = ini + mensal * n

    return {
      produtos,
      ranking,
      top4,
      chartData,
      chartSeries,
      aliqPrazo,
      poupanca,
      totalInvestido,
      lciEquivCdb: lciPct / (1 - aliqPrazo),
      cdbPequenoEquivLci: cdbPequeno * (1 - aliqPrazo),
      n,
    }
  }, [
    aporteInicial,
    aporteMensal,
    prazo,
    cdi,
    selic,
    tr,
    ipca,
    cdbGrande,
    cdbMedio,
    cdbPequeno,
    lciPct,
    lcPct,
    selicSpread,
    prefixado,
    ipcaReal,
    custodiaB3,
    fundoAdm,
  ])

  const vencedor = calc.ranking[0]
  const segundo = calc.ranking[1]
  const temAporte = calc.totalInvestido > 0
  const diffSegundo = vencedor.r.liquido - segundo.r.liquido
  const maxRend = Math.max(0, ...calc.ranking.map(p => p.r.rendimentoLiquido))

  const fraseAporte =
    aporteMensal > 0 && aporteInicial > 0
      ? `${brl(aporteInicial)} + ${brl(aporteMensal)}/mês`
      : aporteMensal > 0
        ? `${brl(aporteMensal)}/mês`
        : brl(aporteInicial)

  // Derivados para exportação e didática (sempre com os números REAIS do cálculo)
  const lanterna = calc.ranking[calc.ranking.length - 1]
  const melhorIsento = calc.ranking.find(p => p.isento) ?? calc.poupanca
  const melhorTributado = calc.ranking.find(p => !p.isento) ?? vencedor
  const tributadoVence = melhorTributado.r.liquido >= melhorIsento.r.liquido
  const fundoDi = calc.produtos.find(p => p.id === 'fundoDi') ?? vencedor
  const posFundo = calc.ranking.findIndex(p => p.id === 'fundoDi') + 1
  const diasPrazo = diasDe(calc.n)
  const equivCurto = lciPct / (1 - 0.225) // ponto de empate LCI×CDB com IR de 22,5% (até 180 dias)
  const equivLongo = lciPct / (1 - 0.15) // idem com IR de 15% (mais de 720 dias)

  const resumo = [
    'vale a pena? — Renda fixa na prática',
    `Aportes: ${fraseAporte} por ${fmtMeses(calc.n)} (${brl(calc.totalInvestido)} investidos no total)`,
    `1º ${vencedor.nome} (${vencedor.taxaLabel}): ${brl(vencedor.r.liquido)} líquidos · ${pct(vencedor.r.taxaLiquidaAa, 2)} a.a.`,
    `2º ${segundo.nome} (${segundo.taxaLabel}): ${brl(segundo.r.liquido)} líquidos (${brl(Math.max(0, diffSegundo))} a menos)`,
    `Melhor isento de IR: ${melhorIsento.nome} — ${brl(melhorIsento.r.liquido)} líquidos`,
    `Alíquota de IR no prazo: ${pct(calc.aliqPrazo * 100, 1)} · equivalência: LCI/LCA a ${num(lciPct)}% do CDI = CDB a ${pct(calc.lciEquivCdb, 1)} do CDI`,
    `Vantagem sobre a poupança: ${brl(Math.max(0, vencedor.r.liquido - calc.poupanca.r.liquido))}`,
    'gerado por vale a pena? · Dexterity — valeapena-puce.vercel.app',
  ].join('\n')

  const r2 = (v: number) => Math.round(v * 100) / 100
  const csvExport = {
    nome: 'renda-fixa',
    colunas: [
      'Posição',
      'Produto',
      'Taxa',
      'Bruto (R$)',
      'IR (R$)',
      'Custos (R$)',
      'Líquido (R$)',
      'Taxa líquida (% a.a.)',
      'Garantia',
    ],
    linhas: calc.ranking.map((p, i): (string | number)[] => [
      `${i + 1}º`,
      p.nome,
      p.taxaLabel,
      r2(p.r.bruto),
      p.isento ? 0 : r2(p.r.ir),
      r2(p.r.taxas),
      r2(p.r.liquido),
      r2(p.r.taxaLiquidaAa),
      p.garantia,
    ]),
  }

  const premissas: [string, string][] = [
    ['Aporte inicial', brl(aporteInicial)],
    ['Aporte mensal', brl(aporteMensal)],
    ['Prazo até o resgate', `${fmtMeses(calc.n)} (${num(diasPrazo)} dias)`],
    ['Alíquota de IR no prazo', pct(calc.aliqPrazo * 100, 1)],
    ['CDI', `${pct(cdi, 2)} a.a.`],
    ['Selic', `${pct(selic, 2)} a.a.`],
    ['TR', `${pct(tr, 2)} a.m.`],
    ['IPCA projetado', `${pct(ipca, 2)} a.a.`],
    ['CDB banco grande', `${num(cdbGrande)}% do CDI`],
    ['CDB banco médio', `${num(cdbMedio)}% do CDI`],
    ['CDB banco pequeno', `${num(cdbPequeno)}% do CDI`],
    ['LCI/LCA', `${num(lciPct)}% do CDI`],
    ['LC (Letra de Câmbio)', `${num(lcPct)}% do CDI`],
    ['Tesouro Selic', `Selic + ${pct(selicSpread, 2)}`],
    ['Tesouro Prefixado', `${pct(prefixado, 1)} a.a.`],
    ['Tesouro IPCA+', `IPCA + ${pct(ipcaReal, 1)} a.a.`],
    ['Custódia B3', `${pct(custodiaB3, 2)} a.a.`],
    ['Fundo DI: taxa de adm.', `${pct(fundoAdm, 2)} a.a.`],
  ]

  return (
    <ToolPage
      icon={<Landmark size={20} />}
      title="Renda fixa na prática"
      description="CDB, LCI/LCA, LC, Tesouro e fundo DI — o que sobra de verdade depois do IR, custódia e come-cotas."
      inputs={
        <>
          <Card title="Seu investimento">
            <div className="space-y-4">
              <SliderField
                label="Aporte inicial"
                value={aporteInicial}
                onChange={setAporteInicial}
                min={0}
                max={500000}
                step={1000}
                format={brl}
              />
              <SliderField
                label="Aporte mensal"
                value={aporteMensal}
                onChange={setAporteMensal}
                min={0}
                max={20000}
                step={100}
                format={brl}
                hint="Aportes entram no fim de cada mês. Cada aporte tem o próprio prazo para efeito de IR regressivo."
              />
              <SliderField
                label="Prazo até o resgate"
                value={prazo}
                onChange={setPrazo}
                min={1}
                max={120}
                step={1}
                format={fmtMeses}
                hint="O prazo define a alíquota de IR (degraus em 180, 360 e 720 dias — Lei 11.033/2004) e quantos come-cotas o fundo sofre."
              />
              <SliderField
                label="IPCA projetado (% a.a.)"
                value={ipca}
                onChange={setIpcaEdit}
                min={0}
                max={15}
                step={0.1}
                format={v => pct(v, 2)}
                hint="Default: IPCA acumulado 12 meses (média BCB, série 13522). Usado só no Tesouro IPCA+."
              />
              <div className="pt-1">
                <LiveBadge live={rates.aoVivo} referencia={rates.referencia} />
              </div>
            </div>
          </Card>

          <Collapse title="Premissas avançadas — taxas e custos">
            <div className="space-y-4">
              <SectionTitle>Indexadores</SectionTitle>
              <SliderField
                label="CDI (% a.a.)"
                value={cdi}
                onChange={setCdiEdit}
                min={2}
                max={30}
                step={0.05}
                format={v => pct(v, 2)}
                hint="Média BCB (série 4389). É a referência de CDBs, LCI/LCA, LC e fundo DI."
              />
              <SliderField
                label="Selic (% a.a.)"
                value={selic}
                onChange={setSelicEdit}
                min={2}
                max={30}
                step={0.05}
                format={v => pct(v, 2)}
                hint="Meta Selic (BCB, série 432). Usada no Tesouro Selic e na regra da poupança."
              />
              <SliderField
                label="TR (% a.m.)"
                value={tr}
                onChange={setTrEdit}
                min={0}
                max={0.5}
                step={0.01}
                format={v => pct(v, 2)}
                hint="Taxa Referencial do mês (média BCB, série 226). Compõe o rendimento da poupança."
              />
              <SectionTitle>Produtos (% do CDI e taxas)</SectionTitle>
              <SliderField
                label="CDB banco grande"
                value={cdbGrande}
                onChange={setCdbGrande}
                min={80}
                max={140}
                step={1}
                format={v => `${num(v)}% CDI`}
                hint="Grandes varejistas pagam ~100% do CDI com liquidez diária (média de ofertas ago/2026)."
              />
              <SliderField
                label="CDB banco médio"
                value={cdbMedio}
                onChange={setCdbMedio}
                min={80}
                max={140}
                step={1}
                format={v => `${num(v)}% CDI`}
              />
              <SliderField
                label="CDB banco pequeno"
                value={cdbPequeno}
                onChange={setCdbPequeno}
                min={80}
                max={150}
                step={1}
                format={v => `${num(v)}% CDI`}
                hint="Bancos menores pagam mais para captar — o risco extra é coberto pelo FGC até R$ 250 mil."
              />
              <SliderField
                label="LCI/LCA"
                value={lciPct}
                onChange={setLciPct}
                min={70}
                max={110}
                step={1}
                format={v => `${num(v)}% CDI`}
                hint="Paga menos que CDB justamente porque é isenta de IR (Lei 11.033/2004). Média de emissões ago/2026."
              />
              <SliderField
                label="LC (Letra de Câmbio)"
                value={lcPct}
                onChange={setLcPct}
                min={80}
                max={140}
                step={1}
                format={v => `${num(v)}% CDI`}
              />
              <SliderField
                label="Tesouro Selic: spread"
                value={selicSpread}
                onChange={setSelicSpread}
                min={0}
                max={0.5}
                step={0.01}
                format={v => `+${pct(v, 2)}`}
                hint="Ágio/deságio do título sobre a Selic (título 2031 em ago/2026: ~+0,07%)."
              />
              <SliderField
                label="Tesouro Prefixado (% a.a.)"
                value={prefixado}
                onChange={setPrefixado}
                min={5}
                max={25}
                step={0.1}
                format={v => pct(v, 1)}
              />
              <SliderField
                label="Tesouro IPCA+: juro real"
                value={ipcaReal}
                onChange={setIpcaReal}
                min={2}
                max={12}
                step={0.1}
                format={v => `+${pct(v, 1)}`}
                hint="Juro acima da inflação. O rendimento nominal usado é (1 + IPCA) × (1 + juro real) − 1."
              />
              <SliderField
                label="Custódia B3 (% a.a.)"
                value={custodiaB3}
                onChange={setCustodiaB3}
                min={0}
                max={0.5}
                step={0.05}
                format={v => pct(v, 2)}
                hint="Taxa de custódia da B3 sobre o Tesouro Direto. No Tesouro Selic há isenção sobre os primeiros R$ 10 mil."
              />
              <SliderField
                label="Fundo DI: taxa de adm."
                value={fundoAdm}
                onChange={setFundoAdm}
                min={0}
                max={3}
                step={0.05}
                format={v => pct(v, 2)}
                hint="Descontada do rendimento antes do come-cotas. Fundos DI de corretoras grandes cobram de 0% a 0,5% a.a."
              />
            </div>
          </Collapse>
        </>
      }
      results={
        <>
          {temAporte ? (
            <Verdict
              winner={`${vencedor.nome}: ${brl(vencedor.r.liquido)} líquidos`}
              detail={
                <>
                  Investindo {fraseAporte} por {fmtMeses(calc.n)}, é a opção que mais deixa no seu
                  bolso — {brl(Math.max(0, diffSegundo))} a mais que {segundo.nome}, o 2º colocado.{' '}
                  {vencedor.nota}
                </>
              }
              tone="positive"
              badge={`${pct(vencedor.r.taxaLiquidaAa, 2)} a.a. líquida`}
            />
          ) : (
            <Verdict
              winner="Defina quanto você vai investir"
              detail="Ajuste o aporte inicial ou o aporte mensal ao lado para comparar o rendimento líquido dos dez produtos."
              tone="neutral"
            />
          )}

          <ExportBar pagina="investimentos" resumo={resumo} csv={csvExport} premissas={premissas} />

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile
              label="Melhor resultado líquido"
              value={vencedor.r.liquido}
              format={brl}
              sub={`investindo ${brl(calc.totalInvestido)} no total`}
              tone="accent"
            />
            <StatTile
              label="Taxa líquida equivalente"
              value={vencedor.r.taxaLiquidaAa}
              format={v => pct(v, 2)}
              sub="já com IR e custos descontados"
              tone="positive"
            />
            <StatTile
              label="Vantagem sobre a poupança"
              value={Math.max(0, vencedor.r.liquido - calc.poupanca.r.liquido)}
              format={brl}
              sub={`em ${fmtMeses(calc.n)}`}
              tone="positive"
            />
            <StatTile
              label="IR + custos do 1º lugar"
              value={vencedor.r.ir + vencedor.r.taxas}
              format={brl}
              sub={
                vencedor.isento
                  ? 'produto isento de IR'
                  : `alíquota de IR no prazo: ${pct(calc.aliqPrazo * 100, 1)}`
              }
              tone="neutral"
            />
          </div>

          <Card
            title={
              <span className="inline-flex items-center gap-1.5">
                Ranking líquido no prazo
                <InfoTip text="Rendimento líquido = o que sobra além do que você aportou, já descontados IR regressivo (Lei 11.033/2004), custódia B3 e come-cotas." />
              </span>
            }
            subtitle={`O que cada produto rende além dos ${brl(calc.totalInvestido)} investidos, em ${fmtMeses(calc.n)}`}
          >
            <div className="space-y-3">
              {calc.ranking.map((p, i) => {
                const w = maxRend > 0 ? Math.max(0, (p.r.rendimentoLiquido / maxRend) * 100) : 0
                const lider = i === 0 && temAporte
                return (
                  <div key={p.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        className={`flex items-center gap-1.5 text-xs ${lider ? 'font-bold text-ink' : 'font-medium text-ink-2'}`}
                      >
                        <span className="w-6 shrink-0 tnum text-mute">{i + 1}º</span>
                        {p.nome}
                        <span className="hidden text-[10px] font-normal text-mute sm:inline">
                          {p.taxaLabel}
                        </span>
                        {p.isento && (
                          <span className="rounded-full border border-line bg-surface-2 px-1.5 py-px text-[10px] font-medium text-positive">
                            isento de IR
                          </span>
                        )}
                      </span>
                      <span className={`shrink-0 text-xs tnum ${lider ? 'font-bold text-ink' : 'font-semibold text-ink-2'}`}>
                        {brl(p.r.rendimentoLiquido)}
                        <span className="ml-1 hidden font-normal text-mute sm:inline">
                          · {pct(p.r.taxaLiquidaAa, 2)} a.a.
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${w}%`,
                          background: lider ? c.series[0] : `${c.series[0]}59`,
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          <Card
            title="Se você resgatar antes: valor líquido mês a mês"
            subtitle="As 4 melhores opções do ranking — os saltos nas curvas são os degraus do IR regressivo (181, 361 e 721 dias)"
          >
            <VLineChart
              data={calc.chartData}
              series={calc.chartSeries}
              xKey="mes"
              xFormat={v => `${v}m`}
              yFormat={brlCompact}
              height={300}
            />
          </Card>

          <Card
            title="Isenção de IR vale quantos pontos de CDI?"
            subtitle="A conta de equivalência entre LCI/LCA (isenta) e CDB (tributado)"
          >
            <p className="text-sm leading-relaxed text-ink-2">
              No prazo de <strong className="text-ink">{fmtMeses(calc.n)}</strong>, a alíquota de IR é{' '}
              <strong className="text-ink">{pct(calc.aliqPrazo * 100, 1)}</strong>. Uma{' '}
              <strong className="text-ink">LCI/LCA a {num(lciPct)}% do CDI</strong> rende o mesmo
              líquido que um <strong className="text-ink">CDB a {pct(calc.lciEquivCdb, 1)} do CDI</strong>{' '}
              — abaixo disso, a isenção vence. Na direção oposta, o CDB de banco pequeno a{' '}
              {num(cdbPequeno)}% equivale a uma LCI a {pct(calc.cdbPequenoEquivLci, 1)} do CDI.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DEGRAUS_IR.map(d => {
                const ativo = Math.abs(d.aliq - calc.aliqPrazo * 100) < 0.01
                return (
                  <div
                    key={d.aliq}
                    className={`rounded-lg border px-3 py-2 text-center ${
                      ativo ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2'
                    }`}
                  >
                    <div className={`text-sm font-bold tnum ${ativo ? 'text-accent' : 'text-ink'}`}>
                      {pct(d.aliq, 1)}
                    </div>
                    <div className="mt-0.5 text-[10px] text-mute">{d.label}</div>
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-mute">
              IR regressivo (Lei 11.033/2004): a alíquota cai em degraus aos 180, 360 e 720 dias.
              Perto de cruzar um degrau, segurar o resgate algumas semanas pode render mais que
              trocar de produto — o gráfico acima mostra exatamente esses saltos.
            </p>
          </Card>

          <Card
            title="Detalhamento completo"
            subtitle={`Valores no resgate, em ${fmtMeses(calc.n)} — ordenado do melhor para o pior`}
          >
            <DataTable
              columns={['#', 'Produto', 'Taxa', 'Bruto', 'IR', 'Custos', 'Líquido', 'a.a. líq.', 'Garantia']}
              align={['l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'l']}
              rows={calc.ranking.map((p, i) => {
                const lider = i === 0 && temAporte
                const destaque = (v: ReactNode) =>
                  lider ? <strong className="font-bold text-ink">{v}</strong> : v
                return [
                  `${i + 1}º`,
                  destaque(p.nome),
                  p.taxaLabel,
                  brl(p.r.bruto),
                  p.isento ? <span className="text-positive">isento</span> : brl(p.r.ir),
                  p.r.taxas > 0.5 ? brl(p.r.taxas) : '—',
                  destaque(brl(p.r.liquido)),
                  destaque(pct(p.r.taxaLiquidaAa, 2)),
                  p.garantia,
                ]
              })}
            />
          </Card>

          {temAporte && (
            <Didatico
              passos={[
                {
                  t: 'Fizemos seu dinheiro render nos 10 produtos',
                  d: (
                    <>
                      Pegamos {fraseAporte} e simulamos, mês a mês, por {fmtMeses(calc.n)}. Do seu
                      bolso saem {brl(calc.totalInvestido)} — o que muda de um produto para outro é
                      quanto volta no resgate: de {brl(lanterna.r.liquido)} ({lanterna.nome}) até{' '}
                      {brl(vencedor.r.liquido)} ({vencedor.nome}).
                    </>
                  ),
                },
                {
                  t: 'Compare o líquido, não a taxa do anúncio',
                  d: (
                    <>
                      O {melhorTributado.nome} termina com {brl(melhorTributado.r.bruto)} brutos,
                      paga {brl(melhorTributado.r.ir + melhorTributado.r.taxas)} de IR e custos e
                      entrega {brl(melhorTributado.r.liquido)}. Já {melhorIsento.nome} não paga IR
                      nenhum e entrega {brl(melhorIsento.r.liquido)}.{' '}
                      {tributadoVence ? (
                        <>
                          Ou seja: aqui o tributado vence mesmo pagando imposto — isento nem sempre
                          ganha. A régua é a equivalência que a página calcula: no seu prazo, uma
                          LCI/LCA a {num(lciPct)}% do CDI só empata com um CDB a{' '}
                          {pct(calc.lciEquivCdb, 1)} do CDI, e o {melhorTributado.nome} paga mais
                          que isso.
                        </>
                      ) : (
                        <>
                          Aqui a isenção venceu — mas só porque nenhum tributado paga{' '}
                          {pct(calc.lciEquivCdb, 1)} do CDI, o ponto de empate com a LCI/LCA a{' '}
                          {num(lciPct)}% no seu prazo.
                        </>
                      )}
                    </>
                  ),
                },
                {
                  t: 'O IR anda numa escada que desce',
                  d: (
                    <>
                      A alíquota de IR cai em degraus: 22,5% até 180 dias, 20% até 360, 17,5% até
                      720 e 15% depois disso. Seu prazo de {fmtMeses(calc.n)} dá {num(diasPrazo)}{' '}
                      dias — degrau de {pct(calc.aliqPrazo * 100, 1)}. E cada aporte mensal conta o
                      próprio prazo: os aportes mais recentes, mais "novos", ainda pagam alíquotas
                      maiores no dia do resgate.
                    </>
                  ),
                },
                {
                  t: 'Come-cotas em uma frase',
                  d: (
                    <>
                      No Fundo DI, a cada 6 meses a Receita antecipa 15% de IR sobre o rendimento
                      (o "come-cotas") — esse dinheiro sai antes da hora e para de render juros
                      sobre juros, parte do motivo de o fundo ficar em {posFundo}º, com{' '}
                      {brl(fundoDi.r.liquido)}.
                    </>
                  ),
                },
              ]}
              analogia={
                <>
                  Escolher investimento pela taxa bruta é como escolher emprego pelo salário bruto.
                  Aqui, o "emprego com desconto em folha" ({melhorTributado.nome}:{' '}
                  {brl(melhorTributado.r.bruto)} menos{' '}
                  {brl(melhorTributado.r.ir + melhorTributado.r.taxas)} de descontos) deposita{' '}
                  {brl(melhorTributado.r.liquido)} na conta; o "emprego sem desconto" (
                  {melhorIsento.nome}) deposita {brl(melhorIsento.r.liquido)}. Quem paga mais no
                  contracheque é o {tributadoVence ? melhorTributado.nome : melhorIsento.nome} — e
                  é só isso que importa.
                </>
              }
              sensibilidade={
                <>
                  O prazo muda o ranking porque muda o IR: resgatando em até 180 dias, a mesma
                  LCI/LCA a {num(lciPct)}% do CDI equivale a um CDB a {pct(equivCurto, 1)} do CDI;
                  passando de 720 dias, a só {pct(equivLongo, 1)}. Hoje, com {fmtMeses(calc.n)}, o
                  empate fica em {pct(calc.lciEquivCdb, 1)} — e o CDB de banco pequeno paga{' '}
                  {num(cdbPequeno)}% do CDI, {cdbPequeno >= calc.lciEquivCdb ? 'acima' : 'abaixo'}{' '}
                  dessa linha.
                  {cdbPequeno >= calc.lciEquivCdb && cdbPequeno < equivCurto && (
                    <>
                      {' '}
                      Encurte o prazo para menos de 6 meses e o empate sobe para{' '}
                      {pct(equivCurto, 1)}: a resposta inverte a favor da isenção.
                    </>
                  )}
                </>
              }
            />
          )}

          <Card title="Premissas e letras miúdas">
            <ul className="list-disc space-y-2 pl-4 text-xs leading-relaxed text-ink-2">
              <li>
                <strong className="text-ink">IR aporte a aporte:</strong> cada aporte mensal tem o
                próprio prazo — os mais recentes pagam alíquotas maiores da tabela regressiva
                (Lei 11.033/2004).
              </li>
              <li>
                <strong className="text-ink">Poupança:</strong> regra da Lei 12.703/2012 — 0,5% a.m.
                + TR com Selic acima de 8,5% a.a. (senão, 70% da Selic). Isenta de IR, mas só rende
                na data de aniversário do depósito.
              </li>
              <li>
                <strong className="text-ink">Tesouro Direto:</strong> custódia B3 de{' '}
                {pct(custodiaB3, 2)} a.a. sobre o saldo (Tesouro Selic: isenta até R$ 10 mil).
                Prefixado e IPCA+ valem os números acima apenas no vencimento — antes disso o preço
                oscila com a marcação a mercado.
              </li>
              <li>
                <strong className="text-ink">Fundo DI:</strong> come-cotas de 15% a cada 6 meses
                (aproximação dos recolhimentos de maio/novembro); no resgate, a alíquota da tabela
                regressiva incide sobre o ganho total de cada aporte, descontando o que o
                come-cotas já reteve (IN RFB 1.585/2015). Fundos não têm cobertura do FGC.
              </li>
              <li>
                <strong className="text-ink">LCI/LCA:</strong> isentas de IR, porém com carência
                mínima de 9 meses para resgate (Res. CMN 5.119/2024) — não servem para reserva de
                emergência.
              </li>
              <li>
                <strong className="text-ink">FGC:</strong> garante até R$ 250 mil por CPF e por
                instituição, com teto global de R$ 1 milhão renovado a cada 4 anos.
              </li>
              <li>
                Taxas médias de mercado (ago/2026) — edite tudo em "Premissas avançadas". Ferramenta
                educacional; não é recomendação de investimento.
              </li>
            </ul>
          </Card>
        </>
      }
    />
  )
}
