/**
 * Parcelar.tsx — Parcelar ou à vista?
 * A conta do dia a dia: o desconto à vista compensa abrir mão do dinheiro
 * rendendo até a última parcela? Compara as duas pontas em valor presente,
 * mostra o desconto de equilíbrio e a taxa que o parcelamento embute.
 */
import { useMemo, useState } from 'react'
import { CreditCard } from 'lucide-react'
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
  Toggle,
  ToolPage,
  Verdict,
} from '../components/ui'
import { VLineChart } from '../components/charts'
import { useRates } from '../lib/rates'
import { aToM, irRegressivo, mToA } from '../lib/finance'
import { brl, brlCents, brlCompact, num, pct } from '../lib/format'

type ModoAVista = 'desconto' | 'valor'
type Primeira = 'ato' | 'trinta'

/** Situações típicas do dia a dia — só pontos de partida, tudo editável. */
const PRESETS = [
  {
    id: 'celular',
    label: 'Eletrônico',
    total: 4000,
    parcelas: 10,
    desconto: 10,
    primeira: 'trinta' as Primeira,
  },
  { id: 'ipva', label: 'IPVA', total: 2500, parcelas: 3, desconto: 3, primeira: 'ato' as Primeira },
  { id: 'iptu', label: 'IPTU', total: 1800, parcelas: 10, desconto: 6, primeira: 'ato' as Primeira },
  {
    id: 'seguro',
    label: 'Seguro',
    total: 3500,
    parcelas: 12,
    desconto: 8,
    primeira: 'ato' as Primeira,
  },
  {
    id: 'escola',
    label: 'Anuidade',
    total: 12000,
    parcelas: 12,
    desconto: 7,
    primeira: 'ato' as Primeira,
  },
] as const

export default function Parcelar() {
  const rates = useRates()

  /* ------------------------------ Inputs ------------------------------ */
  const [total, setTotal] = useState(4000)
  const [nParcelas, setNParcelas] = useState(10)
  const [modo, setModo] = useState<ModoAVista>('desconto')
  const [descontoPct, setDescontoPct] = useState(10)
  const [precoAVista, setPrecoAVista] = useState(3600)
  const [primeira, setPrimeira] = useState<Primeira>('trinta')

  // Onde o dinheiro fica enquanto as parcelas correm
  const [pctCdi, setPctCdi] = useState(100)
  const [isento, setIsento] = useState(false)
  /** null = seguir o CDI ao vivo; número = valor editado pelo usuário */
  const [cdiCustom, setCdiCustom] = useState<number | null>(null)

  const cdiAA = cdiCustom ?? rates.cdi

  function aplicarPreset(p: (typeof PRESETS)[number]) {
    setTotal(p.total)
    setNParcelas(p.parcelas)
    setModo('desconto')
    setDescontoPct(p.desconto)
    setPrecoAVista(Math.round(p.total * (1 - p.desconto / 100)))
    setPrimeira(p.primeira)
  }

  /* ------------------------------ Modelo ------------------------------ */
  const calc = useMemo(() => {
    const n = Math.max(2, Math.round(nParcelas))
    const parcela = total / n
    const aVista =
      modo === 'desconto' ? total * (1 - descontoPct / 100) : Math.max(0, precoAVista)
    const descontoEfetivoPct = total > 0 ? (1 - aVista / total) * 100 : 0

    // Rendimento líquido da aplicação onde o dinheiro fica esperando as parcelas.
    // IR regressivo pelo prazo médio das parcelas (aproximação explicada na didática).
    const defas = primeira === 'ato' ? 0 : 1
    const brutaAA = cdiAA * (pctCdi / 100)
    const iBruta = aToM(brutaAA)
    const prazoMedioMeses = (n - 1) / 2 + defas
    const diasIr = Math.max(1, Math.round((prazoMedioMeses * 365) / 12))
    const aliqIr = isento ? 0 : irRegressivo(diasIr)
    const i = iBruta * (1 - aliqIr)
    const liquidaAA = mToA(i)

    // Valor presente do parcelamento: parcelas nos meses defas … defas+n−1
    const vpEm = (j: number) => {
      let s = 0
      for (let k = 0; k < n; k++) s += parcela / Math.pow(1 + j, k + defas)
      return s
    }
    const vpParcelado = vpEm(i)

    /** > 0 → à vista custa menos em dinheiro de hoje */
    const economiaAVista = vpParcelado - aVista
    /** desconto (sobre o total parcelado) em que as duas pontas empatam */
    const descEquilibrioPct = total > 0 ? (1 - vpParcelado / total) * 100 : 0

    // Taxa embutida no parcelamento: j tal que VP(parcelas) = preço à vista.
    // vpEm é decrescente em j — bissecção no intervalo [−90% a.m., 300% a.m.].
    let taxaEmbutida = NaN
    if (aVista > 0 && parcela > 0) {
      let lo = -0.9
      let hi = 3
      if (vpEm(hi) <= aVista && aVista <= vpEm(lo)) {
        for (let it = 0; it < 100; it++) {
          const mid = (lo + hi) / 2
          if (vpEm(mid) > aVista) lo = mid
          else hi = mid
        }
        taxaEmbutida = (lo + hi) / 2
      }
    }
    const taxaEmbutidaAA = Number.isFinite(taxaEmbutida) ? mToA(taxaEmbutida) : NaN
    /** parcelamento realmente sem juro embutido (sem desconto à vista, ou à vista mais caro) */
    const semJuros = !Number.isFinite(taxaEmbutida) || taxaEmbutida <= 1e-6

    // Os dois caminhos com o mesmo dinheiro no bolso hoje
    const caixa0 = Math.max(total, aVista)
    const H = defas + n - 1
    const serie: Array<{ mes: number; parcelado: number; aVista: number }> = []
    const saldoV0 = caixa0 - aVista
    let saldoP = caixa0 - (defas === 0 ? parcela : 0)
    const linhas: Array<{
      mes: number
      pago: number
      rendimento: number
      saldoP: number
      saldoV: number
    }> = []
    serie.push({ mes: 0, parcelado: saldoP, aVista: saldoV0 })
    linhas.push({
      mes: 0,
      pago: defas === 0 ? parcela : 0,
      rendimento: 0,
      saldoP,
      saldoV: saldoV0,
    })
    for (let m = 1; m <= H; m++) {
      const rendimento = saldoP * i
      saldoP += rendimento
      const paga = m >= defas && m < defas + n
      if (paga) saldoP -= parcela
      const saldoV = saldoV0 * Math.pow(1 + i, m)
      serie.push({ mes: m, parcelado: saldoP, aVista: saldoV })
      linhas.push({ mes: m, pago: paga ? parcela : 0, rendimento, saldoP, saldoV })
    }
    const sobraParcelado = serie[serie.length - 1].parcelado
    const sobraAVista = serie[serie.length - 1].aVista
    const diferencaFim = sobraParcelado - sobraAVista
    const rendimentoTotal = linhas.reduce((a, l) => a + l.rendimento, 0)

    // Sensibilidade: vantagem de parcelar (R$ de hoje) para cada desconto à vista
    const sweep: Array<{ desconto: number; vantagem: number }> = []
    for (let d = 0; d <= 25; d += 1) {
      sweep.push({ desconto: d, vantagem: total * (1 - d / 100) - vpParcelado })
    }

    return {
      n,
      parcela,
      aVista,
      descontoEfetivoPct,
      defas,
      i,
      liquidaAA,
      brutaAA,
      aliqIr,
      vpParcelado,
      economiaAVista,
      descEquilibrioPct,
      taxaEmbutida,
      taxaEmbutidaAA,
      semJuros,
      caixa0,
      serie,
      linhas,
      sobraParcelado,
      sobraAVista,
      diferencaFim,
      rendimentoTotal,
      sweep,
    }
  }, [total, nParcelas, modo, descontoPct, precoAVista, primeira, pctCdi, isento, cdiAA])

  /* ------------------------------ Veredito ------------------------------ */
  const empate = Math.abs(calc.economiaAVista) < Math.max(1, total * 0.002)
  const aVistaGanha = calc.economiaAVista > 0
  const tone: 'positive' | 'negative' | 'neutral' = empate ? 'neutral' : 'positive'

  const verdictWinner = empate
    ? 'Empate técnico — pode escolher pelo conforto'
    : aVistaGanha
      ? `À vista — economiza ${brl(calc.economiaAVista)}`
      : `Parcelar — sobra ${brl(-calc.economiaAVista)}`

  const verdictDetail = empate ? (
    <>
      O desconto de {pct(calc.descontoEfetivoPct, 1)} praticamente empata com o desconto de
      equilíbrio de <strong>{pct(calc.descEquilibrioPct, 1)}</strong>. A diferença entre as duas
      pontas é de {brl(Math.abs(calc.economiaAVista))} em {calc.n} parcelas — decida pelo que for
      mais confortável para o seu fluxo de caixa.
    </>
  ) : aVistaGanha ? (
    <>
      O desconto de {pct(calc.descontoEfetivoPct, 1)} vale mais do que o rendimento do dinheiro
      parado: para empatar, o desconto precisaria ser de apenas{' '}
      <strong>{pct(calc.descEquilibrioPct, 1)}</strong>. Pagando à vista você desembolsa{' '}
      {brl(calc.aVista)} em vez de {calc.n} × {brlCents(calc.parcela)}, e sai{' '}
      <strong>{brl(calc.economiaAVista)}</strong> na frente em dinheiro de hoje.
    </>
  ) : (
    <>
      O desconto de {pct(calc.descontoEfetivoPct, 1)} não paga o que o dinheiro rende enquanto as
      parcelas correm: seria preciso <strong>{pct(calc.descEquilibrioPct, 1)}</strong> para empatar.
      Deixando os {brl(calc.caixa0)} rendendo {pct(calc.liquidaAA, 2)} a.a. líquidos e pagando{' '}
      {calc.n} × {brlCents(calc.parcela)}, sobram <strong>{brl(-calc.economiaAVista)}</strong> a
      mais para você.
    </>
  )

  /* ------------------------------ Exportação ------------------------------ */
  /** acima de 1.000% a.a. o número anualizado deixa de comunicar — vira rótulo */
  const taxaAaTxt = calc.taxaEmbutidaAA > 999 ? 'mais de 1.000% a.a.' : `${pct(calc.taxaEmbutidaAA, 1)} a.a.`

  const taxaTxt = calc.semJuros
    ? 'sem juros embutidos'
    : `${pct(calc.taxaEmbutida * 100, 2)} a.m. (${taxaAaTxt})`

  const resumo = [
    'vale a pena? — Parcelar ou à vista?',
    `Veredito: ${verdictWinner}`,
    `Compra: ${brl(total)} em ${calc.n}x de ${brlCents(calc.parcela)} ou ${brl(calc.aVista)} à vista (desconto de ${pct(calc.descontoEfetivoPct, 1)})`,
    `Desconto de equilíbrio: ${pct(calc.descEquilibrioPct, 1)}`,
    `Taxa embutida no parcelamento: ${taxaTxt}`,
    `Diferença em dinheiro de hoje: ${brl(Math.abs(calc.economiaAVista))} a favor de ${aVistaGanha ? 'pagar à vista' : 'parcelar'}`,
    `Aplicação: ${pct(pctCdi, 0)} do CDI (${pct(calc.brutaAA, 2)} a.a. bruto, ${pct(calc.liquidaAA, 2)} a.a. líquido${isento ? ', isento de IR' : `, IR de ${pct(calc.aliqIr * 100, 1)}`})`,
    'gerado por vale a pena? · Dexterity — valeapena-puce.vercel.app',
  ].join('\n')

  const r2 = (v: number) => Math.round(v * 100) / 100
  const csv = {
    nome: 'mes-a-mes',
    colunas: [
      'Mês',
      'Parcela paga (R$)',
      'Rendimento do mês (R$)',
      'Saldo parcelando (R$)',
      'Saldo pagando à vista (R$)',
      'Diferença (R$)',
    ],
    linhas: calc.linhas.map(l => [
      l.mes,
      r2(l.pago),
      r2(l.rendimento),
      r2(l.saldoP),
      r2(l.saldoV),
      r2(l.saldoP - l.saldoV),
    ]),
  }

  const premissas: [string, string][] = [
    ['Preço parcelado (total)', brl(total)],
    ['Parcelas', `${num(calc.n)} × ${brlCents(calc.parcela)}`],
    ['Preço à vista', `${brl(calc.aVista)} (desconto de ${pct(calc.descontoEfetivoPct, 1)})`],
    ['Primeira parcela', primeira === 'ato' ? 'no ato' : 'em 30 dias'],
    ['Aplicação', `${pct(pctCdi, 0)} do CDI${isento ? ' — isenta de IR' : ''}`],
    ['CDI', `${pct(cdiAA, 2)} a.a.`],
    ['Rendimento líquido', `${pct(calc.liquidaAA, 2)} a.a.`],
    ['IR aplicado', isento ? 'isento' : pct(calc.aliqIr * 100, 1)],
  ]

  /* ------------------------------ Render ------------------------------ */
  return (
    <ToolPage
      icon={<CreditCard size={20} />}
      title="Parcelar ou à vista?"
      description="A conta do dia a dia: o desconto à vista paga o que o seu dinheiro renderia até a última parcela?"
      inputs={
        <>
          <Card
            title="A compra"
            subtitle="Comece por uma situação comum e ajuste os números da sua"
          >
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => aplicarPreset(p)}
                    className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-2 transition-colors hover:border-accent/50 hover:bg-surface-2 hover:text-ink"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <SliderField
                label="Preço parcelado (total)"
                value={total}
                onChange={setTotal}
                min={100}
                max={60000}
                step={50}
                format={brl}
                hint="A soma de todas as parcelas — o preço de etiqueta quando a loja anuncia “em até Nx”."
              />
              <SliderField
                label="Número de parcelas"
                value={nParcelas}
                onChange={v => setNParcelas(Math.round(v))}
                min={2}
                max={24}
                step={1}
                format={v => `${num(v)}x de ${brlCents(total / Math.max(2, Math.round(v)))}`}
              />
              <Segmented<Primeira>
                options={[
                  { value: 'trinta', label: 'Em 30 dias' },
                  { value: 'ato', label: 'No ato' },
                ]}
                value={primeira}
                onChange={setPrimeira}
                label="Primeira parcela"
                hint="No cartão a primeira parcela cai na próxima fatura (≈ 30 dias) — mais um mês de rendimento a favor de parcelar. No carnê ou boleto do IPVA/IPTU, a primeira costuma ser no ato."
              />
            </div>
          </Card>

          <Card title="O preço à vista">
            <div className="space-y-4">
              <Segmented<ModoAVista>
                options={[
                  { value: 'desconto', label: 'Desconto %' },
                  { value: 'valor', label: 'Preço fechado' },
                ]}
                value={modo}
                onChange={setModo}
              />
              {modo === 'desconto' ? (
                <SliderField
                  label="Desconto à vista"
                  value={descontoPct}
                  onChange={setDescontoPct}
                  min={0}
                  max={30}
                  step={0.5}
                  format={v => pct(v, 1)}
                  hint="Quanto a loja tira do preço para receber tudo agora. Pix e dinheiro costumam ter 5–10%; IPVA e IPTU têm descontos definidos em lei municipal/estadual."
                />
              ) : (
                <SliderField
                  label="Preço à vista"
                  value={precoAVista}
                  onChange={setPrecoAVista}
                  min={0}
                  max={Math.max(1000, Math.round(total * 1.2))}
                  step={50}
                  format={brl}
                  hint="Use quando a loja já dá o valor fechado do Pix, em vez de um percentual."
                />
              )}
              <p className="text-[11px] text-mute">
                À vista: <strong className="tnum text-ink">{brl(calc.aVista)}</strong> · desconto de{' '}
                {pct(calc.descontoEfetivoPct, 1)} · economia nominal de{' '}
                {brl(Math.max(0, total - calc.aVista))}
              </p>
            </div>
          </Card>

          <Card title="Onde o dinheiro fica esperando">
            <div className="space-y-4">
              <SliderField
                label="Rendimento da aplicação"
                value={pctCdi}
                onChange={setPctCdi}
                min={50}
                max={130}
                step={5}
                format={v => `${num(v)}% do CDI`}
                hint="Conta que rende automaticamente costuma pagar 100% do CDI. Poupança rende bem menos — use ~70%."
              />
              <Toggle
                checked={isento}
                onChange={setIsento}
                label="Aplicação isenta de IR (LCI/LCA)"
                hint="Sem isenção, o rendimento sofre IR regressivo (22,5% até 180 dias, 20% até 360, 17,5% até 720, 15% depois)."
              />
              <p className="text-[11px] text-mute">
                Rende <strong className="tnum text-ink">{pct(calc.liquidaAA, 2)} a.a.</strong>{' '}
                líquidos ({pct(calc.brutaAA, 2)} bruto
                {isento ? ', isento' : `, IR de ${pct(calc.aliqIr * 100, 1)}`})
              </p>
              <LiveBadge live={rates.aoVivo} referencia={rates.referencia} />
            </div>
          </Card>

          <Collapse title="Premissas avançadas">
            <div className="space-y-4">
              <SliderField
                label="CDI"
                value={cdiAA}
                onChange={setCdiCustom}
                min={0}
                max={30}
                step={0.05}
                format={v => `${pct(v, 2)} a.a.`}
                hint="Default: CDI do dia, direto da API do Banco Central. Edite para simular outro cenário de juros."
              />
              <p className="text-[11px] leading-relaxed text-mute">
                A conta assume que você tem o dinheiro para pagar à vista hoje. Se não tem,
                parcelar não é escolha — é a única opção; nesse caso o número que importa é a taxa
                embutida abaixo, comparada com o crédito mais barato que você consegue.
              </p>
            </div>
          </Collapse>
        </>
      }
      results={
        <>
          <Verdict
            winner={verdictWinner}
            detail={verdictDetail}
            tone={tone}
            badge={`equilíbrio em ${pct(calc.descEquilibrioPct, 1)}`}
          />

          <ExportBar pagina="parcelar" resumo={resumo} csv={csv} premissas={premissas} />

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile
              label="Diferença hoje"
              value={Math.abs(calc.economiaAVista)}
              format={brl}
              sub={aVistaGanha ? 'a favor de pagar à vista' : 'a favor de parcelar'}
              tone="accent"
            />
            <StatTile
              label="Desconto de equilíbrio"
              value={calc.descEquilibrioPct}
              format={v => pct(v, 1)}
              sub={`você tem ${pct(calc.descontoEfetivoPct, 1)}`}
              tone={aVistaGanha ? 'positive' : 'negative'}
            />
            <StatTile
              label="Taxa embutida"
              value={calc.semJuros ? 0 : calc.taxaEmbutida * 100}
              format={v => (calc.semJuros ? 'sem juros' : `${pct(v, 2)} a.m.`)}
              sub={
                calc.semJuros
                  ? 'o prazo sai de graça'
                  : `${taxaAaTxt} — CDI em ${pct(cdiAA, 2)}`
              }
              tone={
                !calc.semJuros && calc.taxaEmbutidaAA > calc.liquidaAA ? 'negative' : 'positive'
              }
            />
            <StatTile
              label="Sobra no fim"
              value={Math.max(calc.sobraParcelado, calc.sobraAVista)}
              format={brl}
              sub={`${brl(Math.abs(calc.diferencaFim))} a mais que a outra ponta`}
            />
          </div>

          <Card
            title="O mesmo dinheiro, dois caminhos"
            subtitle={`Você separa ${brl(calc.caixa0)} para a compra: numa ponta paga tudo hoje e deixa a sobra render; na outra deixa render e vai pagando as parcelas`}
          >
            <VLineChart
              data={calc.serie}
              series={[
                { key: 'parcelado', name: 'Parcelando', colorIndex: 0 },
                { key: 'aVista', name: 'Pagando à vista', colorIndex: 1 },
              ]}
              xKey="mes"
              xFormat={v => `${v}m`}
              yFormat={brlCompact}
            />
            <p className="mt-3 text-[11px] leading-relaxed text-mute">
              No mês {calc.serie.length - 1} sobram {brl(calc.sobraParcelado)} parcelando contra{' '}
              {brl(calc.sobraAVista)} pagando à vista. A linha que termina mais alto é a decisão
              certa — e a distância entre elas ({brl(Math.abs(calc.diferencaFim))}) é o que está em
              jogo.
            </p>
          </Card>

          <Card
            title="A partir de que desconto vale pagar à vista"
            subtitle="Vantagem de parcelar, em dinheiro de hoje, para cada desconto oferecido — onde a linha cruza o zero está o equilíbrio"
          >
            <VLineChart
              data={calc.sweep}
              series={[{ key: 'vantagem', name: 'Vantagem de parcelar', colorIndex: 0 }]}
              xKey="desconto"
              xFormat={v => `${v}%`}
              yFormat={brlCompact}
              refY={0}
              refYLabel="empate"
              height={240}
            />
            <p className="mt-3 text-[11px] leading-relaxed text-mute">
              Com {calc.n} parcelas e {pct(calc.liquidaAA, 2)} a.a. líquidos, o ponto de virada é{' '}
              <strong className="text-ink">{pct(calc.descEquilibrioPct, 1)}</strong>. Desconto
              maior que isso: pague à vista. Menor: parcele e deixe o dinheiro render. É a regra de
              bolso que você leva para a loja.
            </p>
          </Card>

          <Card
            title={
              <span className="inline-flex items-center gap-1.5">
                Mês a mês
                <InfoTip text="Saldo parcelando = o dinheiro separado rendendo e pagando uma parcela por mês. Saldo à vista = a sobra depois de pagar tudo hoje, rendendo sem saques." />
              </span>
            }
          >
            <DataTable
              columns={['Mês', 'Parcela', 'Rendimento', 'Parcelando', 'À vista', 'Diferença']}
              align={['l', 'r', 'r', 'r', 'r', 'r']}
              rows={calc.linhas.map(l => [
                l.mes === 0 ? 'Hoje' : `Mês ${l.mes}`,
                l.pago > 0 ? brlCents(l.pago) : '—',
                l.rendimento > 0 ? brlCents(l.rendimento) : '—',
                brl(l.saldoP),
                brl(l.saldoV),
                <span
                  key="dif"
                  className={`font-semibold ${l.saldoP - l.saldoV >= 0 ? 'text-positive' : 'text-negative'}`}
                >
                  {brl(l.saldoP - l.saldoV)}
                </span>,
              ])}
            />
          </Card>

          <Didatico
            passos={[
              {
                t: 'As duas ofertas não são comparáveis do jeito que aparecem',
                d: (
                  <>
                    {brl(calc.aVista)} hoje e {calc.n} × {brlCents(calc.parcela)} são quantias em
                    momentos diferentes. Dinheiro no futuro vale menos que dinheiro agora, porque o
                    dinheiro de agora pode render. Então trouxemos as parcelas para hoje: elas
                    equivalem a <strong>{brl(calc.vpParcelado)}</strong>.
                  </>
                ),
              },
              {
                t: 'Quanto o dinheiro rende enquanto você paga',
                d: (
                  <>
                    Numa aplicação a {pct(pctCdi, 0)} do CDI ({pct(calc.brutaAA, 2)} a.a.), o
                    rendimento líquido fica em {pct(calc.liquidaAA, 2)} a.a.
                    {isento
                      ? ' — isento de IR, como LCI e LCA.'
                      : ` — já descontado o IR de ${pct(calc.aliqIr * 100, 1)}, a alíquota do prazo médio das parcelas.`}{' '}
                    Ao longo das {calc.n} parcelas isso soma{' '}
                    <strong>{brl(calc.rendimentoTotal)}</strong> de juros a seu favor.
                  </>
                ),
              },
              {
                t: `O desconto precisa ser de ${pct(calc.descEquilibrioPct, 1)} para empatar`,
                d: (
                  <>
                    Esse é o número que interessa: abaixo dele, o desconto não paga o rendimento
                    perdido e parcelar é melhor; acima, à vista é melhor. A loja te ofereceu{' '}
                    {pct(calc.descontoEfetivoPct, 1)} — {aVistaGanha ? 'acima' : 'abaixo'} do
                    equilíbrio, por isso o veredito é {aVistaGanha ? 'pagar à vista' : 'parcelar'}.
                  </>
                ),
              },
              {
                t: 'Parcelamento “sem juros” quase nunca é sem juros',
                d: !calc.semJuros ? (
                  <>
                    Se existe desconto à vista, a diferença entre os dois preços é juro com outro
                    nome. Aqui o parcelamento embute{' '}
                    <strong>{pct(calc.taxaEmbutida * 100, 2)} ao mês</strong> ({taxaAaTxt}) —
                    contra {pct(cdiAA, 2)} a.a. do CDI.{' '}
                    {calc.taxaEmbutidaAA > calc.liquidaAA
                      ? 'Você está pagando mais caro pelo prazo do que ganha deixando o dinheiro aplicado.'
                      : 'Ainda assim é crédito mais barato do que o seu dinheiro rende — por isso compensa alongar.'}
                  </>
                ) : (
                  <>
                    Aqui não há juro embutido: o preço à vista não é menor que o parcelado, então o
                    prazo sai de graça. Nesse caso parcelar ganha sempre — o dinheiro fica com você
                    rendendo {pct(calc.liquidaAA, 2)} a.a. enquanto as parcelas correm —, desde que
                    a parcela caiba no orçamento.
                  </>
                ),
              },
              {
                t: 'A parte honesta do modelo',
                d: (
                  <>
                    A conta pressupõe três coisas: você tem os {brl(calc.caixa0)} hoje, o dinheiro
                    realmente fica aplicado (não é gasto em outra coisa) e você paga as faturas em
                    dia. Se qualquer uma falhar, parcelar deixa de ser vantagem — o rotativo do
                    cartão cobra por mês mais do que qualquer aplicação paga por ano. E cada
                    parcelamento ocupa limite: dez “12x sem juros” viram um orçamento travado.
                  </>
                ),
              },
            ]}
            analogia={
              <>
                O desconto à vista é o aluguel que a loja está disposta a pagar para usar o seu
                dinheiro antes da hora. Aqui, esse aluguel vale {pct(calc.descontoEfetivoPct, 1)} e
                o seu dinheiro cobraria {pct(calc.descEquilibrioPct, 1)} para se mudar.{' '}
                {aVistaGanha
                  ? 'A loja está pagando mais do que vale — aceite.'
                  : 'A loja está pagando menos do que vale — fique com o dinheiro e parcele.'}
              </>
            }
            sensibilidade={
              <>
                Dois números mexem na resposta: o <strong>desconto</strong> e o{' '}
                <strong>número de parcelas</strong>. Quanto mais longo o parcelamento, mais tempo o
                dinheiro rende e maior o desconto necessário para empatar — em {calc.n} parcelas ele
                é {pct(calc.descEquilibrioPct, 1)}. Se o CDI cair pela metade, o equilíbrio cai
                junto e pagar à vista passa a ganhar com descontos bem menores.
              </>
            }
          />

          <Card title="Onde essa conta aparece no seu dia a dia">
            <ul className="space-y-2 text-xs leading-relaxed text-ink-2">
              <li>
                <strong className="text-ink">IPVA e IPTU</strong> — cota única com desconto ou
                parcelas sem juros no carnê. É o caso mais puro: mesmo produto, dois preços.
              </li>
              <li>
                <strong className="text-ink">Seguro do carro e anuidades</strong> — escola,
                faculdade, academia, plano anual de software. O desconto à vista costuma ser maior
                do que o equilíbrio.
              </li>
              <li>
                <strong className="text-ink">Eletrônicos e eletrodomésticos</strong> — “10% no Pix
                ou 10x sem juros”. Com 10 parcelas e o CDI de hoje, 10% quase sempre vence.
              </li>
              <li>
                <strong className="text-ink">Passagens, móveis, reformas</strong> — sempre que
                aparecer um preço para o Pix e outro para o cartão, a diferença é juro disfarçado.
              </li>
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-mute">
              Ferramenta educacional de comparação. Os valores dos atalhos acima são apenas pontos
              de partida — descontos de IPVA e IPTU mudam por estado e município a cada ano.
            </p>
          </Card>
        </>
      }
    />
  )
}
