/**
 * Carro — Alugar × comprar.
 * Compara em VPL (taxa de desconto = custo de oportunidade líquido de 15% de IR):
 * Comprar (à vista ou financiado) × Assinatura 0 km.
 */
import { useMemo, useState } from 'react'
import { Car } from 'lucide-react'
import {
  Card,
  Collapse,
  DataTable,
  Didatico,
  ExportBar,
  InfoTip,
  LiveBadge,
  Segmented,
  SliderField,
  StatTile,
  ToolPage,
  Verdict,
} from '../components/ui'
import { VBarChart, VLineChart, type SeriesDef } from '../components/charts'
import { aToM, pmtPrice, priceSchedule } from '../lib/finance'
import { brl, brlCents, brlCompact, meses, num, pct } from '../lib/format'
import { useRates } from '../lib/rates'
import { CATEGORIAS_CARRO, IPVA_ESTADOS, type CategoriaCarro } from '../lib/dados2026'

/** Alíquota de IR de renda fixa acima de 720 dias — usada para o "CDI líquido". */
const IR_LONGO_PRAZO = 0.15

const NOME_CURTO: Record<string, string> = {
  popular: 'Popular',
  sedan: 'Sedan',
  suv: 'SUV',
  picape: 'Picape',
  premium: 'Premium',
  eletrico: 'Elétrico',
}

type ModoCompra = 'avista' | 'financiado'

/** Rótulo do eixo X em meses → "hoje", "3º ano", "18m". */
function labelMes(v: string | number): string {
  const m = Number(v)
  if (!Number.isFinite(m)) return String(v)
  if (m === 0) return 'hoje'
  if (m % 12 === 0) return `${m / 12}º ano`
  return `${m}m`
}

export default function Carro() {
  const rates = useRates()
  const cat0 = CATEGORIAS_CARRO[0]

  /* ------------------------- inputs principais ------------------------- */
  const [categoriaId, setCategoriaId] = useState(cat0.id)
  const [valorCarro, setValorCarro] = useState(cat0.valorRef)
  const [kmMes, setKmMes] = useState(1000)
  const [horizonteAnos, setHorizonteAnos] = useState(5)
  const [uf, setUf] = useState('SP')
  const [modoCompra, setModoCompra] = useState<ModoCompra>('avista')
  /** idade do carro na compra: 0 (0 km), 1 ou 2 anos (seminovo) */
  const [idadeCompra, setIdadeCompra] = useState(0)
  const [entradaPct, setEntradaPct] = useState(20)
  const [prazoFin, setPrazoFin] = useState(48)
  const [taxaFinUser, setTaxaFinUser] = useState<number | null>(null)
  const [assinaturaMes, setAssinaturaMes] = useState(cat0.assinaturaMes)
  /** dias por ano em que você ficaria sem contrato de assinatura (viagens, férias) */
  const [diasSemCarroAno, setDiasSemCarroAno] = useState(0)
  /** cashback do cartão de crédito, % sobre o que pode ser pago no cartão */
  const [cashbackPct, setCashbackPct] = useState(1)
  const [custoOpUser, setCustoOpUser] = useState<number | null>(null)

  /* ------------------------ premissas avançadas ------------------------ */
  const [seguroPctAno, setSeguroPctAno] = useState(cat0.seguroPct * 100)
  const [manutencaoAno, setManutencaoAno] = useState(cat0.manutencaoAno)
  const [depAno1Pct, setDepAno1Pct] = useState(cat0.depAno1 * 100)
  const [depSegPct, setDepSegPct] = useState(cat0.depSeguintes * 100)
  const estadoSel = IPVA_ESTADOS.find(e => e.uf === uf) ?? IPVA_ESTADOS[0]
  const [licenciamento, setLicenciamento] = useState(estadoSel.licenciamento)

  /** defaults ao vivo (BCB) enquanto o usuário não mexe no slider */
  const taxaFin = taxaFinUser ?? rates.veiculos
  const custoOp = custoOpUser ?? rates.cdi

  const selecionarCategoria = (c: CategoriaCarro) => {
    setCategoriaId(c.id)
    setValorCarro(c.valorRef)
    setAssinaturaMes(c.assinaturaMes)
    setSeguroPctAno(c.seguroPct * 100)
    setManutencaoAno(c.manutencaoAno)
    setDepAno1Pct(c.depAno1 * 100)
    setDepSegPct(c.depSeguintes * 100)
  }

  const selecionarUf = (novo: string) => {
    setUf(novo)
    const e = IPVA_ESTADOS.find(x => x.uf === novo)
    if (e) setLicenciamento(e.licenciamento)
  }

  /* ----------------------------- simulação ----------------------------- */
  const sim = useMemo(() => {
    const anos = Math.min(10, Math.max(1, Math.round(horizonteAnos)))
    const N = anos * 12
    const descontoAa = Math.max(0, custoOp) * (1 - IR_LONGO_PRAZO)
    const d = aToM(descontoAa)

    const dep1 = Math.min(Math.max(depAno1Pct, 0), 99) / 100
    const dep2 = Math.min(Math.max(depSegPct, 0), 99) / 100
    const f1 = Math.pow(1 - dep1, 1 / 12)
    const f2 = Math.pow(1 - dep2, 1 / 12)
    /** valor de mercado do carro com `m` meses de idade (contados do 0 km) */
    const valorEm = (m: number) =>
      valorCarro * Math.pow(f1, Math.min(m, 12)) * Math.pow(f2, Math.max(0, m - 12))

    // seminovo: você compra o carro já com `idadeM` meses — paga o valor
    // depreciado e pula a perda forte do 1º ano
    const idadeM = Math.min(2, Math.max(0, Math.round(idadeCompra))) * 12
    const precoCompra = valorEm(idadeM)
    /** valor do carro no mês `m` da POSSE (idade total = idadeM + m) */
    const valorPosse = (m: number) => valorEm(idadeM + m)

    // cashback do cartão: vale para o que dá para pagar no cartão —
    // assinatura, seguro e manutenção (compra, parcelas e IPVA ficam fora)
    const cb = Math.min(Math.max(cashbackPct, 0), 10) / 100

    // dias sem carro: na assinatura/aluguel mensal dá para devolver o carro ou
    // não renovar nesses períodos — a mensalidade efetiva cai proporcionalmente
    const fracSemCarro = Math.min(Math.max(diasSemCarroAno, 0), 365) / 365
    const assinaturaEfetiva = Math.max(0, assinaturaMes) * (1 - fracSemCarro)
    const subMes = assinaturaEfetiva * (1 - cb)

    const financiado = modoCompra === 'financiado'
    const entrada = financiado
      ? (precoCompra * Math.min(Math.max(entradaPct, 0), 100)) / 100
      : precoCompra
    const principal = Math.max(0, precoCompra - entrada)
    const nFin = Math.max(1, Math.round(prazoFin))
    const parcelas = financiado ? priceSchedule(principal, aToM(Math.max(0, taxaFin)), nFin) : []
    const parcelaFin = parcelas[0]?.parcela ?? 0

    let pvSaidasBuy = entrada // t0: entrada (financiado) ou preço cheio (à vista)
    let pvParcelas = 0
    let pvSub = 0
    let pvSeguro = 0
    let pvManut = 0
    let pvIpva = 0

    const chartData: Array<{ mes: number; comprar: number; assinatura: number }> = [
      { mes: 0, comprar: 0, assinatura: 0 },
    ]
    const gastoAnoBuy: number[] = Array.from({ length: anos }, () => 0)
    gastoAnoBuy[0] = entrada
    const tabela: Array<{
      ano: number
      valorFim: number
      gastoBuy: number
      gastoSub: number
      vpBuy: number
      vpSub: number
    }> = []

    for (let m = 1; m <= N; m++) {
      const df = Math.pow(1 + d, -m)
      const v = valorPosse(m)
      // seguro e manutenção já líquidos do cashback do cartão
      const seguroM = (((Math.max(0, seguroPctAno) / 100) * v) / 12) * (1 - cb)
      const manutM = (Math.max(0, manutencaoAno) / 12) * (1 - cb)
      const ipvaM = (estadoSel.aliquota * v) / 12 + Math.max(0, licenciamento) / 12
      const parcela = financiado && m <= nFin ? parcelas[m - 1].parcela : 0
      const saldo = financiado && m <= nFin ? parcelas[m - 1].saldo : 0

      pvSeguro += seguroM * df
      pvManut += manutM * df
      pvIpva += ipvaM * df
      pvParcelas += parcela * df
      pvSaidasBuy += (seguroM + manutM + ipvaM + parcela) * df
      pvSub += subMes * df

      gastoAnoBuy[Math.ceil(m / 12) - 1] += seguroM + manutM + ipvaM + parcela

      // custo líquido em VP se vender o carro (e quitar o saldo devedor) no mês m
      const comprarSeVender = pvSaidasBuy - (v - saldo) * df
      chartData.push({ mes: m, comprar: comprarSeVender, assinatura: pvSub })

      if (m % 12 === 0) {
        tabela.push({
          ano: m / 12,
          valorFim: v,
          gastoBuy: gastoAnoBuy[m / 12 - 1],
          gastoSub: subMes * 12,
          vpBuy: comprarSeVender,
          vpSub: pvSub,
        })
      }
    }

    const dfN = Math.pow(1 + d, -N)
    const revenda = valorPosse(N)
    const saldoN = financiado && N <= nFin ? parcelas[N - 1].saldo : 0
    const custoBuy = pvSaidasBuy - (revenda - saldoN) * dfN
    const custoSub = pvSub

    // decomposição em VP — as fatias somam exatamente o custo total de comprar
    const depVP = precoCompra - revenda * dfN
    const jurosVP = financiado ? entrada + pvParcelas + saldoN * dfN - precoCompra : 0

    // Break-even robusto: as linhas podem se cruzar mais de uma vez (ex.: depreciação
    // baixa no 1º ano e alta nos seguintes). O break-even honesto é o primeiro mês a
    // partir do qual comprar fica mais barato ATÉ O FIM do horizonte — senão o badge
    // poderia contradizer o veredito.
    let ultimoMesComprarPior = 0
    let comprarJaFoiMaisBarato = false
    for (let m = 1; m <= N; m++) {
      if (chartData[m].comprar > chartData[m].assinatura) ultimoMesComprarPior = m
      else comprarJaFoiMaisBarato = true
    }
    const breakEven: number | null = ultimoMesComprarPior < N ? ultimoMesComprarPior + 1 : null

    const diff = custoSub - custoBuy // > 0 → comprar é mais barato
    const eqMes = pmtPrice(Math.abs(diff), d, N)
    const kmTotais = Math.max(1, kmMes) * N

    return {
      anos,
      N,
      descontoAa,
      financiado,
      entrada,
      parcelaFin,
      precoCompra,
      assinaturaEfetiva,
      revenda,
      saldoN,
      custoBuy,
      custoSub,
      depVP,
      jurosVP,
      pvSeguro,
      pvManut,
      pvIpva,
      breakEven,
      comprarJaFoiMaisBarato,
      diff,
      eqMes,
      custoKmBuy: custoBuy / kmTotais,
      custoKmSub: custoSub / kmTotais,
      chartData,
      tabela,
    }
  }, [
    horizonteAnos,
    custoOp,
    depAno1Pct,
    depSegPct,
    valorCarro,
    idadeCompra,
    modoCompra,
    entradaPct,
    prazoFin,
    taxaFin,
    seguroPctAno,
    manutencaoAno,
    estadoSel.aliquota,
    licenciamento,
    assinaturaMes,
    diasSemCarroAno,
    cashbackPct,
    kmMes,
  ])

  /* ------------------------------ veredito ------------------------------ */
  const seminovoTxt =
    idadeCompra === 0 ? '' : ` o seminovo de ${idadeCompra} ${idadeCompra === 1 ? 'ano' : 'anos'}`
  const compraLabel =
    (sim.financiado ? 'comprar' : 'comprar à vista') +
    seminovoTxt +
    (sim.financiado ? ' financiado' : '')
  const buyWins = sim.diff > 0
  const empate = Math.abs(sim.diff) < Math.max(sim.custoBuy, sim.custoSub, 1) * 0.02

  const verdictWinner = empate
    ? 'Empate técnico — decida pela conveniência'
    : buyWins
      ? `Vale mais a pena ${compraLabel}: economia de ${brlCents(sim.eqMes)}/mês`
      : `Vale mais a pena assinar: economia de ${brlCents(sim.eqMes)}/mês`
  const verdictDetail = `No horizonte de ${sim.anos} ${sim.anos === 1 ? 'ano' : 'anos'}, ${compraLabel} custa ${brl(
    sim.custoBuy,
  )} e a assinatura ${brl(sim.custoSub)}, em valor presente. Diferença de ${brl(
    Math.abs(sim.diff),
  )} — o equivalente a ${brlCents(sim.eqMes)} por mês. A conta já desconta o que o dinheiro renderia a ${pct(
    sim.descontoAa,
    1,
  )} a.a. (custo de oportunidade líquido de 15% de IR).`
  const verdictBadge = empate
    ? 'Diferença menor que 2%'
    : sim.breakEven === null
      ? sim.comprarJaFoiMaisBarato
        ? 'Assinatura vence no seu horizonte'
        : 'Assinatura lidera o período todo'
      : sim.breakEven <= 1
        ? 'Comprar ganha desde o 1º mês'
        : `Break-even: ${meses(sim.breakEven)}`

  /* ------------------------------ gráficos ------------------------------ */
  const linhaSeries: SeriesDef[] = [
    { key: 'comprar', name: sim.financiado ? 'Comprar (financiado)' : 'Comprar (à vista)', colorIndex: 0 },
    { key: 'assinatura', name: 'Assinatura', colorIndex: 1 },
  ]

  /**
   * Se a taxa do financiamento for MENOR que o custo de oportunidade, o "custo de
   * juros" em VP fica negativo (financiar barato vale dinheiro). Fatia negativa não
   * funciona em barra empilhada, então mostramos como crédito no texto — e o
   * subtítulo deixa de prometer que as fatias somam o total.
   */
  const jurosCredito = sim.financiado && sim.jurosVP < 0 ? -sim.jurosVP : 0
  const compSeries: SeriesDef[] = [
    { key: 'dep', name: 'Depreciação', colorIndex: 0 },
    ...(sim.financiado && sim.jurosVP > 0
      ? [{ key: 'jur', name: 'Juros do financiamento', colorIndex: 5 } satisfies SeriesDef]
      : []),
    { key: 'seg', name: 'Seguro', colorIndex: 2 },
    { key: 'man', name: 'Manutenção', colorIndex: 3 },
    { key: 'ipva', name: 'IPVA + licenciamento', colorIndex: 4 },
    { key: 'ass', name: 'Assinatura (tudo incluso)', colorIndex: 1 },
  ]
  const compData = [
    {
      opcao: 'Comprar',
      dep: Math.max(0, sim.depVP),
      jur: Math.max(0, sim.jurosVP),
      seg: sim.pvSeguro,
      man: sim.pvManut,
      ipva: sim.pvIpva,
      ass: 0,
    },
    { opcao: 'Assinatura', dep: 0, jur: 0, seg: 0, man: 0, ipva: 0, ass: sim.custoSub },
  ]

  const pctRevenda = sim.precoCompra > 0 ? (sim.revenda / sim.precoCompra) * 100 : 0

  /* --------------------------- exportação (R3.2) --------------------------- */
  const categoriaNome = CATEGORIAS_CARRO.find(c => c.id === categoriaId)?.nome ?? categoriaId

  const resumo = [
    'vale a pena? — Carro: alugar × comprar',
    verdictWinner,
    `Horizonte de ${sim.anos} ${sim.anos === 1 ? 'ano' : 'anos'} · ${categoriaNome} de ${brl(valorCarro)}${
      idadeCompra > 0 ? ` (seminovo de ${idadeCompra} ${idadeCompra === 1 ? 'ano' : 'anos'}: ${brl(sim.precoCompra)})` : ''
    } · ${num(kmMes)} km/mês`,
    `Comprar ${sim.financiado ? 'financiado' : 'à vista'}: ${brl(sim.custoBuy)} em valor presente (revenda de ${brl(sim.revenda)} já abatida)`,
    `Assinatura 0 km: ${brl(sim.custoSub)} em valor presente (${brl(assinaturaMes)}/mês)`,
    `Custo por km: comprar ${brlCents(sim.custoKmBuy)} · assinar ${brlCents(sim.custoKmSub)}`,
    `Taxa de desconto: ${pct(sim.descontoAa, 1)} a.a. (custo de oportunidade de ${pct(custoOp, 1)} líquido de 15% de IR)`,
    'gerado por vale a pena? · Dexterity — valeapena-flame.vercel.app',
  ].join('\n')

  const csv = {
    nome: 'ano-a-ano',
    colunas: [
      'Ano',
      'Valor do carro (R$)',
      'Gasto no ano — comprar (R$)',
      'Gasto no ano — assinatura (R$)',
      'VP acumulado — comprar (R$)',
      'VP acumulado — assinatura (R$)',
    ],
    linhas: sim.tabela.map(r => [
      r.ano,
      Math.round(r.valorFim),
      Math.round(r.gastoBuy),
      Math.round(r.gastoSub),
      Math.round(r.vpBuy),
      Math.round(r.vpSub),
    ]),
  }

  const premissas: [string, string][] = [
    ['Categoria', categoriaNome],
    ['Valor do carro (0 km)', brl(valorCarro)],
    [
      'Idade na compra',
      idadeCompra === 0
        ? '0 km'
        : `${idadeCompra} ${idadeCompra === 1 ? 'ano' : 'anos'} (${brl(sim.precoCompra)})`,
    ],
    ['Uso', `${num(kmMes)} km/mês`],
    ['Horizonte', `${sim.anos} ${sim.anos === 1 ? 'ano' : 'anos'}`],
    ['Estado (IPVA)', `${uf} · ${pct(estadoSel.aliquota * 100, 1)} a.a.`],
    [
      'Forma de compra',
      sim.financiado
        ? `Financiado — ${pct(entradaPct, 0)} de entrada, ${num(prazoFin)}×, ${pct(taxaFin, 1)} a.a.`
        : 'À vista',
    ],
    ['Assinatura 0 km', `${brl(assinaturaMes)}/mês`],
    ['Dias sem carro/ano', diasSemCarroAno === 0 ? 'nenhum' : `${num(diasSemCarroAno)} dias`],
    ['Cashback do cartão', pct(cashbackPct, 2)],
    ['Custo de oportunidade', `${pct(custoOp, 1)} a.a. (${pct(sim.descontoAa, 1)} líq. de IR)`],
    ['Seguro', `${pct(seguroPctAno, 1)}/ano`],
    ['Manutenção', `${brl(manutencaoAno)}/ano`],
    ['Depreciação', `${pct(depAno1Pct, 0)} no 1º ano · ${pct(depSegPct, 0)} a.a. depois`],
    ['Licenciamento', `${brl(licenciamento)}/ano`],
  ]

  /* ---------------------------- didática (R3.3) ---------------------------- */
  // depreciação no 1º ano DA POSSE (para seminovo, a perda já é a da idade atual)
  const depAno1Posse = Math.max(0, sim.precoCompra - (sim.tabela[0]?.valorFim ?? sim.precoCompra))
  const mesesAssinaturaEquiv = assinaturaMes > 0 ? depAno1Posse / assinaturaMes : 0
  const outrosVP = sim.pvSeguro + sim.pvManut + sim.pvIpva
  // quanto 30 dias/ano a mais sem carro tirariam do custo da assinatura (VP)
  const fracSemCarro = Math.min(Math.max(diasSemCarroAno, 0), 365) / 365
  const economia30d = fracSemCarro < 1 ? (sim.custoSub / (1 - fracSemCarro)) * (30 / 365) : 0

  /* -------------------------------- página ------------------------------- */
  return (
    <ToolPage
      icon={<Car size={20} />}
      title="Carro: alugar × comprar"
      description="Comprar (0 km ou seminovo, à vista ou financiado) ou assinar um 0 km? Comparação em valor presente, com depreciação, IPVA, seguro, cashback e custo de oportunidade."
      inputs={
        <>
          <Card title="O carro e o uso">
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="text-xs font-medium text-ink-2">Categoria</span>
                  <InfoTip text="Ao trocar, os defaults de preço, depreciação, seguro, manutenção e mensalidade de assinatura mudam para os valores típicos da categoria (síntese FIPE/KBB e cotações 2026). Tudo continua editável." />
                </div>
                <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-surface-2 p-1">
                  {CATEGORIAS_CARRO.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selecionarCategoria(c)}
                      className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                        categoriaId === c.id
                          ? 'bg-accent text-accent-ink shadow-sm'
                          : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      {NOME_CURTO[c.id] ?? c.nome}
                    </button>
                  ))}
                </div>
              </div>
              <SliderField
                label="Valor do carro (0 km)"
                value={valorCarro}
                onChange={setValorCarro}
                min={20000}
                max={600000}
                step={5000}
                format={brl}
                hint="Preço do carro novo. Default: valor típico da categoria (referências FIPE 2026)."
              />
              <SliderField
                label="Quanto você roda"
                value={kmMes}
                onChange={setKmMes}
                min={300}
                max={5000}
                step={100}
                format={v => `${num(v)} km/mês`}
                hint="Usado para o custo por km. Combustível fica FORA da conta: você abastece igual nos dois cenários, então ele não muda a comparação. Assinaturas têm franquia típica de 1.000–2.000 km/mês — se você roda muito acima, ajuste a mensalidade."
              />
              <SliderField
                label="Horizonte"
                value={horizonteAnos}
                onChange={setHorizonteAnos}
                min={1}
                max={10}
                step={1}
                format={v => (v === 1 ? '1 ano' : `${v} anos`)}
                hint="Por quanto tempo você pretende ficar com o carro. No fim do período, a revenda entra como crédito para quem comprou."
              />
              <Segmented
                label="Estado (IPVA + licenciamento)"
                hint="Alíquota de IPVA do estado sobre o valor venal do carro + taxa anual de licenciamento (CRLV). Pagos só por quem compra — na assinatura já estão na mensalidade."
                options={IPVA_ESTADOS.map(e => ({ value: e.uf, label: e.uf }))}
                value={uf}
                onChange={selecionarUf}
              />
            </div>
          </Card>

          <Card title="Compra × assinatura">
            <div className="space-y-4">
              <Segmented
                label="Idade do carro na compra"
                hint="0 km ou seminovo. Comprando com 1–2 anos você paga o valor já depreciado e pula a perda forte do 1º ano — o preço de compra é estimado pela curva de depreciação sobre o 0 km de referência. A assinatura segue sendo de um 0 km."
                options={[
                  { value: '0', label: '0 km' },
                  { value: '1', label: '1 ano' },
                  { value: '2', label: '2 anos' },
                ]}
                value={String(idadeCompra) as '0' | '1' | '2'}
                onChange={v => setIdadeCompra(Number(v))}
              />
              {idadeCompra > 0 && (
                <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-mute">
                  Preço de compra estimado:{' '}
                  <strong className="tnum text-ink">{brl(sim.precoCompra)}</strong> — o 0 km de{' '}
                  {brl(valorCarro)} menos a depreciação de {idadeCompra}{' '}
                  {idadeCompra === 1 ? 'ano' : 'anos'}
                </p>
              )}
              <Segmented
                label="Forma de compra"
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
                    hint="Percentual do valor pago à vista na compra. O restante vira financiamento pela Tabela Price."
                  />
                  <SliderField
                    label="Prazo do financiamento"
                    value={prazoFin}
                    onChange={setPrazoFin}
                    min={12}
                    max={60}
                    step={6}
                    format={v => `${num(v)} meses`}
                    hint="Se o horizonte da análise terminar antes do contrato, o saldo devedor é quitado com a venda do carro."
                  />
                  <SliderField
                    label="Taxa do financiamento"
                    value={taxaFin}
                    onChange={setTaxaFinUser}
                    min={2}
                    max={60}
                    step={0.5}
                    format={v => `${pct(v, 1)} a.a.`}
                    hint="Default: taxa média BCB para aquisição de veículos por pessoa física (série SGS 20749). Bancos cobram menos com bom relacionamento e entrada maior."
                  />
                  <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-mute">
                    Parcela estimada:{' '}
                    <strong className="tnum text-ink">{brlCents(sim.parcelaFin)}</strong> × {num(prazoFin)}
                    {' '}· entrada de <strong className="tnum text-ink">{brl(sim.entrada)}</strong>
                  </p>
                </>
              )}
              <SliderField
                label="Assinatura 0 km"
                value={assinaturaMes}
                onChange={setAssinaturaMes}
                min={500}
                max={15000}
                step={50}
                format={v => `${brl(v)}/mês`}
                hint="Mensalidade de assinatura de carro 0 km (Localiza Meoo, Movida etc., cotações 2026). Já inclui IPVA, seguro, manutenção e documentação — por isso esses custos não são somados do lado da assinatura."
              />
              <SliderField
                label="Dias sem carro por ano"
                value={diasSemCarroAno}
                onChange={setDiasSemCarroAno}
                min={0}
                max={120}
                step={5}
                format={v => (v === 0 ? 'nenhum' : `${num(v)} dias`)}
                hint="Viagens, férias, temporadas de home office… Na assinatura/aluguel mensal você pode devolver o carro ou não renovar nesses períodos — descontamos a mensalidade proporcionalmente. Quem compra paga IPVA, seguro e depreciação mesmo com o carro parado."
              />
              <SliderField
                label="Cashback do cartão"
                value={cashbackPct}
                onChange={setCashbackPct}
                min={0}
                max={5}
                step={0.25}
                format={v => pct(v, 2)}
                hint="Cashback do seu cartão de crédito, aplicado ao que dá para pagar no cartão: mensalidade da assinatura, seguro e manutenção. Compra do carro, parcelas do financiamento e IPVA ficam de fora."
              />
              <SliderField
                label="Custo de oportunidade"
                value={custoOp}
                onChange={setCustoOpUser}
                min={0}
                max={30}
                step={0.5}
                format={v => `${pct(v, 1)} a.a.`}
                hint="O que o seu dinheiro renderia investido (default: CDI, média BCB ao vivo). Para trazer os fluxos a valor presente aplicamos 15% de IR sobre o rendimento — a alíquota de renda fixa acima de 720 dias (Lei 11.033/2004)."
              />
              <LiveBadge live={rates.aoVivo} referencia={rates.referencia} />
            </div>
          </Card>

          <Collapse title="Premissas avançadas">
            <div className="space-y-4">
              <SliderField
                label="Seguro"
                value={seguroPctAno}
                onChange={setSeguroPctAno}
                min={0}
                max={15}
                step={0.5}
                format={v => `${pct(v, 1)}/ano`}
                hint="Prêmio anual como % do valor do carro (média de mercado da categoria). Aplicado sobre o valor já depreciado a cada mês."
              />
              <SliderField
                label="Manutenção"
                value={manutencaoAno}
                onChange={setManutencaoAno}
                min={0}
                max={20000}
                step={100}
                format={v => `${brl(v)}/ano`}
                hint="Revisões, pneus e desgaste — média anual típica da categoria."
              />
              <SliderField
                label="Depreciação no 1º ano"
                value={depAno1Pct}
                onChange={setDepAno1Pct}
                min={0}
                max={40}
                step={1}
                format={v => pct(v, 0)}
                hint="Perda de valor no 1º ano (síntese FIPE/KBB 2026). Um 0 km deprecia mais forte assim que sai da concessionária."
              />
              <SliderField
                label="Depreciação nos anos seguintes"
                value={depSegPct}
                onChange={setDepSegPct}
                min={0}
                max={30}
                step={1}
                format={v => `${pct(v, 0)} a.a.`}
                hint="Depreciação geométrica ao ano, do 2º ano em diante (síntese FIPE/KBB 2026)."
              />
              <SliderField
                label="Licenciamento anual"
                value={licenciamento}
                onChange={setLicenciamento}
                min={0}
                max={1000}
                step={10}
                format={brl}
                hint="Taxa anual de licenciamento (CRLV) do estado selecionado — atualiza ao trocar o estado."
              />
            </div>
          </Collapse>
        </>
      }
      results={
        <>
          <Verdict
            winner={verdictWinner}
            detail={verdictDetail}
            tone={empate ? 'neutral' : 'positive'}
            badge={verdictBadge}
          />

          <ExportBar pagina="carro" resumo={resumo} csv={csv} premissas={premissas} />

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile
              label={sim.financiado ? 'Comprar financiado — VP' : 'Comprar à vista — VP'}
              value={sim.custoBuy}
              format={brl}
              sub={`custo total em ${sim.anos} ${sim.anos === 1 ? 'ano' : 'anos'}, já com a revenda`}
              tone={!empate && buyWins ? 'positive' : 'neutral'}
            />
            <StatTile
              label="Assinatura — VP"
              value={sim.custoSub}
              format={brl}
              sub={
                diasSemCarroAno > 0 || cashbackPct > 0
                  ? `${brl(sim.assinaturaEfetiva * (1 - cashbackPct / 100))}/mês líquido × ${num(sim.N)} meses`
                  : `${brl(assinaturaMes)}/mês × ${num(sim.N)} meses`
              }
              tone={!empate && !buyWins ? 'positive' : 'neutral'}
            />
            <StatTile
              label="Custo por km (melhor opção)"
              value={Math.min(sim.custoKmBuy, sim.custoKmSub)}
              format={brlCents}
              sub={`comprar ${brlCents(sim.custoKmBuy)} · assinar ${brlCents(sim.custoKmSub)}`}
              tone="accent"
            />
            <StatTile
              label="Revenda estimada"
              value={sim.revenda}
              format={brl}
              sub={`${pct(pctRevenda, 0)} do preço de compra após ${sim.anos} ${sim.anos === 1 ? 'ano' : 'anos'}${
                idadeCompra > 0 ? ` (carro com ${idadeCompra + sim.anos} anos)` : ''
              }`}
            />
          </div>

          <Card
            title="Custo acumulado em valor presente"
            subtitle="A linha de comprar desconta, mês a mês, quanto você recuperaria vendendo o carro (e quitando o financiamento) naquele momento"
          >
            <VLineChart
              data={sim.chartData}
              series={linhaSeries}
              xKey="mes"
              xFormat={labelMes}
              yFormat={brlCompact}
            />
            <p className="mt-3 text-[11px] leading-relaxed text-mute">
              {sim.breakEven === null
                ? sim.comprarJaFoiMaisBarato
                  ? 'As linhas chegam a se cruzar, mas a assinatura termina mais barata no seu horizonte — comprar só compensaria segurando o carro por mais tempo.'
                  : 'A linha da assinatura fica abaixo durante todo o horizonte: assinar sai mais barato mesmo contando a revenda do carro.'
                : sim.breakEven <= 1
                  ? 'Comprar já é mais barato desde o primeiro mês — mesmo que você vendesse o carro logo em seguida.'
                  : `O cruzamento das linhas é o break-even: a partir de ${meses(sim.breakEven)}, comprar fica mais barato que assinar até o fim do horizonte.`}
            </p>
          </Card>

          <Card
            title="De onde vem o custo"
            subtitle={`Composição em valor presente no horizonte de ${sim.anos} ${sim.anos === 1 ? 'ano' : 'anos'}${
              jurosCredito > 0
                ? ' — o crédito do financiamento barato não vira fatia (veja a nota abaixo)'
                : ' — as fatias somam o custo total de cada opção'
            }`}
          >
            <VBarChart
              data={compData}
              series={compSeries}
              xKey="opcao"
              yFormat={brlCompact}
              stacked
              height={300}
            />
            <p className="mt-3 text-[11px] leading-relaxed text-mute">
              Na compra, a depreciação costuma ser o maior custo — o carro que você compra por{' '}
              {brl(sim.precoCompra)} vale {brl(sim.revenda)} no fim.
              {idadeCompra > 0 &&
                ' Comprando seminovo, a fatia de depreciação encolhe: a perda forte do 1º ano ficou com o dono anterior.'}{' '}
              Na assinatura, IPVA, seguro e manutenção já estão embutidos na mensalidade.
              {jurosCredito > 0 &&
                ` Sua taxa de financiamento está abaixo do custo de oportunidade: em valor presente, financiar gera um crédito de ${brl(
                  jurosCredito,
                )} — por isso as fatias de "Comprar" somam mais que o custo total mostrado no veredito.`}
            </p>
          </Card>

          <Card
            title="Detalhamento ano a ano"
            subtitle="VP acumulado de comprar = custo líquido, em valor presente, se você vendesse o carro (e quitasse o financiamento) no fim daquele ano"
          >
            <DataTable
              columns={[
                'Ano',
                'Valor do carro',
                'Gasto no ano — comprar',
                'Gasto no ano — assinatura',
                'VP acum. — comprar',
                'VP acum. — assinatura',
              ]}
              align={['l', 'r', 'r', 'r', 'r', 'r']}
              rows={sim.tabela.map(r => [
                `${r.ano}º`,
                brl(r.valorFim),
                brl(r.gastoBuy),
                brl(r.gastoSub),
                <strong key="b" className={r.vpBuy <= r.vpSub ? 'text-positive' : 'text-ink'}>
                  {brl(r.vpBuy)}
                </strong>,
                <strong key="s" className={r.vpSub < r.vpBuy ? 'text-positive' : 'text-ink'}>
                  {brl(r.vpSub)}
                </strong>,
              ])}
            />
            <p className="mt-2 text-[11px] text-mute">
              "Gasto no ano — comprar" é nominal e inclui {sim.financiado ? 'entrada e parcelas' : 'o preço do carro'}{' '}
              no 1º ano; a revenda aparece apenas nas colunas de VP. Verde = opção mais barata até ali.
            </p>
          </Card>

          <Didatico
            passos={[
              {
                t: 'Trouxemos tudo para dinheiro de hoje (VPL)',
                d: (
                  <>
                    Somamos cada gasto dos próximos {sim.anos} {sim.anos === 1 ? 'ano' : 'anos'} e
                    trouxemos tudo para dinheiro de hoje, porque R$ 100 daqui a {sim.anos}{' '}
                    {sim.anos === 1 ? 'ano' : 'anos'} valem menos que R$ 100 agora — dá para saber
                    quanto seus R$ 100 renderiam no CDI. Usamos {pct(sim.descontoAa, 1)} ao ano (seu
                    custo de oportunidade de {pct(custoOp, 1)}, já tirando 15% de imposto). Só assim
                    comprar ({brl(sim.custoBuy)}) e assinar ({brl(sim.custoSub)}) podem ser comparados
                    de igual para igual.
                  </>
                ),
              },
              {
                t: 'A depreciação é o maior custo invisível do carro próprio',
                d: (
                  <>
                    Ninguém manda boleto de "depreciação", mas ela existe: seu carro sai de{' '}
                    {brl(sim.precoCompra)} e vai valendo menos a cada ano. Em dinheiro de hoje, essa
                    perda soma {brl(Math.max(0, sim.depVP))}
                    {sim.depVP > outrosVP
                      ? <> — mais do que seguro ({brl(sim.pvSeguro)}), manutenção ({brl(sim.pvManut)}) e
                        IPVA ({brl(sim.pvIpva)}) somados.</>
                      : <>, contra {brl(outrosVP)} de seguro, manutenção e IPVA juntos.</>}
                    {sim.financiado && sim.jurosVP > 0 && (
                      <> Os juros do financiamento adicionam mais {brl(sim.jurosVP)}.</>
                    )}
                  </>
                ),
              },
              {
                t: 'A revenda volta como crédito',
                d: (
                  <>
                    No fim de {sim.anos} {sim.anos === 1 ? 'ano' : 'anos'} você ainda tem um carro que
                    vale {brl(sim.revenda)} — dá para vender e recuperar esse dinheiro. Por isso ele
                    entra como um "dinheiro de volta" na conta de quem compra
                    {sim.saldoN > 0 && (
                      <>, já descontando o saldo devedor de {brl(sim.saldoN)} que ainda falta pagar ao banco</>
                    )}
                    . Sem esse crédito, comprar pareceria bem mais caro do que é de verdade.
                  </>
                ),
              },
              {
                t: 'O resultado final',
                d: (
                  <>
                    Feitas as contas, a diferença entre as duas opções é de {brl(Math.abs(sim.diff))}{' '}
                    no período — o mesmo que {brlCents(sim.eqMes)} por mês no seu bolso
                    {empate
                      ? ', menos de 2% do custo total: empate técnico, decida pela conveniência.'
                      : buyWins
                        ? ', a favor de comprar.'
                        : ', a favor de assinar.'}{' '}
                    Por km rodado: comprar custa {brlCents(sim.custoKmBuy)} e assinar{' '}
                    {brlCents(sim.custoKmSub)}.
                  </>
                ),
              },
            ]}
            analogia={
              <>
                Carro 0 km é como celular novo: perde valor assim que sai da caixa. No seu caso, o
                carro de {brl(sim.precoCompra)} perde {brl(depAno1Posse)} só no 1º ano com você — o
                equivalente a {num(mesesAssinaturaEquiv, 1)} meses de assinatura ({brl(assinaturaMes)}
                /mês) que evaporam sem você rodar um km a mais por causa disso.
              </>
            }
            sensibilidade={
              <>
                Hoje você contou {diasSemCarroAno === 0 ? 'nenhum dia' : `${num(diasSemCarroAno)} dias`}{' '}
                sem carro por ano — cada 30 dias a mais (férias, home office) tirariam cerca de{' '}
                {brl(economia30d)} do custo da assinatura, o que pode inverter o resultado. O horizonte
                também pesa: períodos curtos favorecem a assinatura (a depreciação forte do início fica
                toda com quem compra) e períodos longos favorecem a compra, que dilui essa perda.
              </>
            }
          />

          <Card title="Premissas e fontes" subtitle="Tudo é editável nos controles ao lado">
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-ink-2">
              <li>
                Taxa de desconto: custo de oportunidade de {pct(custoOp, 2)} a.a. (default: CDI, média BCB{' '}
                {rates.aoVivo ? 'ao vivo' : 'de referência'}) líquido de 15% de IR — alíquota de renda fixa acima
                de 720 dias (Lei 11.033/2004) — resultando em {pct(sim.descontoAa, 2)} a.a.
              </li>
              <li>
                Depreciação geométrica: {pct(depAno1Pct, 0)} no 1º ano e {pct(depSegPct, 0)} a.a. nos seguintes
                (síntese FIPE/KBB 2026). A revenda de {brl(sim.revenda)} volta como crédito no fim do horizonte.
              </li>
              <li>
                Assinatura 0 km (Localiza Meoo, Movida etc.) já inclui IPVA, seguro, manutenção e documentação —
                nada disso é somado do lado da assinatura. Franquia típica de 1.000–2.000 km/mês.
              </li>
              {idadeCompra > 0 && (
                <li>
                  Compra de seminovo: preço estimado de {brl(sim.precoCompra)} pela curva de depreciação sobre o
                  0 km de {brl(valorCarro)}. A revenda considera o carro com {idadeCompra + sim.anos} anos no fim
                  do horizonte. Preços reais de seminovos variam com a tabela FIPE e o estado do carro.
                </li>
              )}
              {diasSemCarroAno > 0 && (
                <li>
                  Dias sem carro: {num(diasSemCarroAno)} dias/ano fora do contrato de assinatura → mensalidade
                  efetiva de {brl(sim.assinaturaEfetiva)}/mês. Pressupõe plano flexível (mensal ou pausável) —
                  contratos longos de assinatura podem não permitir. Quem compra segue pagando os custos fixos.
                </li>
              )}
              {cashbackPct > 0 && (
                <li>
                  Cashback de {pct(cashbackPct, 2)} no cartão, aplicado à assinatura, ao seguro e à manutenção.
                  Compra do carro, parcelas do financiamento e IPVA não passam pelo cartão.
                </li>
              )}
              <li>Combustível fica fora dos dois lados: o gasto é praticamente igual nos dois cenários.</li>
              <li>
                IPVA de {pct(estadoSel.aliquota * 100, 1)} a.a. ({uf}) sobre o valor venal depreciado +
                licenciamento de {brl(licenciamento)}/ano, pagos só por quem compra.
              </li>
              {sim.financiado && (
                <li>
                  Financiamento pela Tabela Price a {pct(taxaFin, 2)} a.a. (default: média BCB de aquisição de
                  veículos PF, série SGS 20749).
                  {sim.saldoN > 0
                    ? ` Como o horizonte termina antes do contrato, o saldo devedor de ${brl(sim.saldoN)} é quitado com a venda.`
                    : ' O contrato é quitado dentro do horizonte da análise.'}
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
