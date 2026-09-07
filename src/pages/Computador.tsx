/**
 * Computador.tsx — Upgrade de computador: vale a pena?
 * Converte tempo economizado em dinheiro, compara com o custo do upgrade
 * corrigido pelo custo de oportunidade (CDI) e responde com payback, VPL e ROI.
 */
import { useMemo, useState } from 'react'
import { Laptop } from 'lucide-react'
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
import { VBarChart, VLineChart } from '../components/charts'
import { useVizColors } from '../theme'
import { useRates } from '../lib/rates'
import { aToM, fvSeries } from '../lib/finance'
import { brl, brlCents, brlCompact, meses, num, pct } from '../lib/format'

/** Jornada de referência: 44 h/semana × 4 semanas = 176 h/mês. */
const HORAS_MES = 176

type ModoGanho = 'minutos' | 'pct'
type ModoHora = 'salario' | 'hora'

export default function Computador() {
  const rates = useRates()
  const c = useVizColors()

  /* ------------------------------ Inputs ------------------------------ */
  const [custoNovo, setCustoNovo] = useState(15000)
  const [revendaAtual, setRevendaAtual] = useState(3000)
  const [vidaAnos, setVidaAnos] = useState(3)

  const [modoHora, setModoHora] = useState<ModoHora>('salario')
  const [salarioMes, setSalarioMes] = useState(10000)
  const [horaCustom, setHoraCustom] = useState(60)

  const [modoGanho, setModoGanho] = useState<ModoGanho>('minutos')
  const [minutosDia, setMinutosDia] = useState(30)
  const [velocidadePct, setVelocidadePct] = useState(30)
  const [pctTempoAfetado, setPctTempoAfetado] = useState(25)

  // Avançado
  const [horasDia, setHorasDia] = useState(8)
  const [diasMes, setDiasMes] = useState(21)
  /** null = seguir o CDI ao vivo; número = valor editado pelo usuário */
  const [custoOpCustom, setCustoOpCustom] = useState<number | null>(null)
  const [revendaNovoPct, setRevendaNovoPct] = useState(35)

  // CDI líquido de 15% de IR — mesma convenção da página do carro
  const custoOportunidade = custoOpCustom ?? rates.cdi * 0.85

  /* ------------------------------ Modelo ------------------------------ */
  const calc = useMemo(() => {
    const valorHora =
      modoHora === 'salario' ? (salarioMes > 0 ? salarioMes / HORAS_MES : 0) : Math.max(0, horaCustom)

    // fração do tempo (nas tarefas afetadas) que a máquina X% mais rápida devolve: 1 − 1/(1+X)
    const fracEconomia = velocidadePct > 0 ? 1 - 1 / (1 + velocidadePct / 100) : 0
    const horasEcoDiaBruta =
      modoGanho === 'minutos'
        ? Math.max(0, minutosDia) / 60
        : Math.max(0, horasDia) * (Math.max(0, pctTempoAfetado) / 100) * fracEconomia
    // não dá para economizar mais horas do que se trabalha
    const horasEcoDia = Math.min(horasEcoDiaBruta, Math.max(0, horasDia))
    const horasEcoMes = horasEcoDia * Math.max(0, diasMes)
    const valorMes = horasEcoMes * valorHora

    // Fluxo em t0 = custo − revenda do atual. Pode ser negativo (revenda > custo):
    // a sobra entra no VPL como caixa; para série/payback o custo não fica negativo.
    const custoLiquidoBruto = custoNovo - revendaAtual
    const custoLiquido = Math.max(0, custoLiquidoBruto)
    const sobraRevenda = Math.max(0, -custoLiquidoBruto)
    const n = Math.max(1, Math.round(vidaAnos * 12))
    const i = aToM(Math.max(0, custoOportunidade))
    const revendaFinal = Math.max(0, custoNovo * (revendaNovoPct / 100))

    // Série mensal: valor acumulado (reinvestido a CDI) × custo corrigido pelo CDI
    const serie: Array<{ mes: number; ganho: number; custo: number }> = []
    let payback = custoLiquido === 0 ? 0 : NaN
    for (let m = 0; m <= n; m++) {
      const ganho = fvSeries(0, i, m, valorMes)
      const custo = custoLiquido * Math.pow(1 + i, m)
      if (!Number.isFinite(payback) && m > 0 && ganho >= custo) payback = m
      serie.push({ mes: m, ganho, custo })
    }

    // VPL na vida útil (benefícios mensais + revenda do novo no fim, descontados a CDI)
    let fAnuidade = 0 // Σ 1/(1+i)^m — VP de R$ 1/mês durante a vida útil
    for (let m = 1; m <= n; m++) fAnuidade += 1 / Math.pow(1 + i, m)
    const vpBeneficios = valorMes * fAnuidade
    const vpRevenda = revendaFinal / Math.pow(1 + i, n)
    const vpl = -custoLiquidoBruto + vpBeneficios + vpRevenda
    const roiPct = custoLiquido > 0 ? (vpl / custoLiquido) * 100 : NaN

    // Minutos/dia que empatam com o CDI (VPL = 0), na jornada e valor de hora atuais
    const valorMesEquilibrio = Math.max(0, custoLiquidoBruto - vpRevenda) / (fAnuidade || 1)
    const minutosEquilibrio =
      valorHora > 0 && diasMes > 0 && fAnuidade > 0
        ? (valorMesEquilibrio / (valorHora * diasMes)) * 60
        : NaN

    // Custo de adiar 1 mês: benefício perdido − rendimento do capital que ficou investido
    // (com sobra de revenda o sinal inverte: adiar também adia a sobra rendendo CDI)
    const custoEsperaMes = valorMes - custoLiquidoBruto * i

    // Cenários de sensibilidade sobre o ganho estimado
    const cenarios = [
      { fator: 0.5, label: 'Ganho −50%' },
      { fator: 1, label: 'Estimado' },
      { fator: 1.5, label: 'Ganho +50%' },
    ].map(x => ({
      label: x.label,
      vpl: -custoLiquidoBruto + vpBeneficios * x.fator + vpRevenda,
    }))

    // Tabela ano a ano
    const tabela: Array<{
      ano: number
      horas: number
      valorAno: number
      ganhoAcum: number
      custoAcum: number
      saldo: number
    }> = []
    for (let a = 1; a * 12 <= n; a++) {
      const row = serie[a * 12]
      tabela.push({
        ano: a,
        horas: horasEcoMes * 12,
        valorAno: valorMes * 12,
        ganhoAcum: row.ganho,
        custoAcum: row.custo,
        saldo: row.ganho - row.custo,
      })
    }

    return {
      valorHora,
      horasEcoDia,
      horasEcoMes,
      valorMes,
      custoLiquido,
      sobraRevenda,
      n,
      taxaMes: i,
      revendaFinal,
      serie,
      payback,
      vpl,
      roiPct,
      custoEsperaMes,
      minutosEquilibrio,
      cenarios,
      tabela,
    }
  }, [
    modoHora,
    salarioMes,
    horaCustom,
    modoGanho,
    minutosDia,
    velocidadePct,
    pctTempoAfetado,
    horasDia,
    diasMes,
    custoNovo,
    revendaAtual,
    vidaAnos,
    custoOportunidade,
    revendaNovoPct,
  ])

  /* ------------------------------ Veredito ------------------------------ */
  const pagaNaVida = Number.isFinite(calc.payback) && calc.payback <= calc.n
  const valeAPena = pagaNaVida && calc.vpl > 0
  const tone: 'positive' | 'negative' | 'neutral' = valeAPena
    ? 'positive'
    : calc.vpl > 0
      ? 'neutral'
      : 'negative'

  const verdictWinner =
    calc.custoLiquido === 0
      ? 'Vale a pena — a revenda do atual cobre o novo'
      : valeAPena
        ? `Vale a pena — se paga em ${meses(calc.payback)}`
        : calc.vpl > 0
          ? 'No limite — só fecha a conta com a revenda no fim'
          : 'Não vale a pena com essas premissas'

  const verdictDetail =
    calc.custoLiquido === 0 ? (
      <>
        A revenda do atual ({brl(revendaAtual)}) cobre o computador novo
        {calc.sobraRevenda > 0 && <> — e ainda sobram {brl(calc.sobraRevenda)}</>}. Cada mês você
        ganha <strong>{num(calc.horasEcoMes, 1)} h</strong> (≈ {brl(calc.valorMes)}) sem
        desembolso: VPL de <strong>{brl(calc.vpl)}</strong> na vida útil.
      </>
    ) : valeAPena ? (
      <>
        Você economiza <strong>{num(calc.horasEcoMes, 1)} h/mês</strong> (≈ {brl(calc.valorMes)}),
        e o investimento líquido de {brl(calc.custoLiquido)} se paga antes do fim da vida útil de{' '}
        {vidaAnos} {vidaAnos === 1 ? 'ano' : 'anos'}. Enquanto a troca não acontece, cada mês custa
        ≈ <strong>{brl(Math.max(0, calc.custoEsperaMes))}</strong> em produtividade não capturada.
      </>
    ) : calc.vpl > 0 ? (
      <>
        O ganho de {brl(calc.valorMes)}/mês não cobre o custo dentro da vida útil — o VPL só fica
        positivo ({brl(calc.vpl)}) por causa da revenda estimada de {brl(calc.revendaFinal)} no
        fim. Margem pequena: qualquer frustração no ganho de tempo vira prejuízo.
      </>
    ) : (
      <>
        O ganho de {brl(calc.valorMes)}/mês não cobre o investimento de {brl(calc.custoLiquido)} em{' '}
        {vidaAnos} {vidaAnos === 1 ? 'ano' : 'anos'} a {pct(custoOportunidade, 2)} a.a. — VPL de{' '}
        <strong>{brl(calc.vpl)}</strong>. Para a conta fechar, o upgrade precisa devolver mais
        tempo, custar menos ou durar mais.
      </>
    )

  /* ------------------------------ Exportação ------------------------------ */
  const anosTxt = `${vidaAnos} ${vidaAnos === 1 ? 'ano' : 'anos'}`
  const paybackTxt = Number.isFinite(calc.payback)
    ? calc.payback === 0
      ? 'imediato (custo líquido zero)'
      : meses(calc.payback)
    : `não se paga em ${anosTxt}`

  const resumo = [
    'vale a pena? — Computador mais rápido',
    `Veredito: ${verdictWinner}`,
    `Payback: ${paybackTxt} · vida útil de ${anosTxt}`,
    `VPL em ${anosTxt}: ${brl(calc.vpl)} (inclui revenda de ${brl(calc.revendaFinal)} no fim)`,
    `Tempo economizado: ${num(calc.horasEcoDia * 60)} min/dia útil ≈ ${num(calc.horasEcoMes, 1)} h/mês, valendo ${brl(calc.valorMes)}/mês (hora a ${brlCents(calc.valorHora)})`,
    `Investimento líquido: ${brl(calc.custoLiquido)} (novo ${brl(custoNovo)} − revenda do atual ${brl(revendaAtual)})`,
    `Custo de oportunidade: ${pct(custoOportunidade, 2)} a.a. (CDI líquido de IR)`,
    'gerado por vale a pena? · Dexterity — valeapena-flame.vercel.app',
  ].join('\n')

  const r2 = (v: number) => Math.round(v * 100) / 100
  const csv = {
    nome: 'ano-a-ano',
    colunas: [
      'Ano',
      'Horas poupadas',
      'Valor gerado no ano (R$)',
      'Acumulado a CDI (R$)',
      'Custo + juros (R$)',
      'Saldo (R$)',
    ],
    linhas: calc.tabela.map(r => [
      r.ano,
      r2(r.horas),
      r2(r.valorAno),
      r2(r.ganhoAcum),
      r2(r.custoAcum),
      r2(r.saldo),
    ]),
  }

  const premissas: [string, string][] = [
    ['Computador novo', brl(custoNovo)],
    ['Revenda do atual', brl(revendaAtual)],
    ['Vida útil', anosTxt],
    [
      'Valor da hora',
      modoHora === 'salario'
        ? `${brlCents(calc.valorHora)} (salário ${brl(salarioMes)} ÷ ${HORAS_MES} h)`
        : brlCents(calc.valorHora),
    ],
    [
      'Ganho estimado',
      modoGanho === 'minutos'
        ? `${num(minutosDia)} min/dia útil`
        : `+${pct(velocidadePct, 0)} de velocidade em ${pct(pctTempoAfetado, 0)} do tempo`,
    ],
    ['Horas trabalhadas/dia', `${num(horasDia, 1)} h`],
    ['Dias úteis/mês', num(diasMes)],
    ['Custo de oportunidade', `${pct(custoOportunidade, 2)} a.a.`],
    ['Revenda do novo no fim', `${pct(revendaNovoPct, 0)} (${brl(calc.revendaFinal)})`],
  ]

  /* ------------------------------ Render ------------------------------ */
  return (
    <ToolPage
      icon={<Laptop size={20} />}
      title="Computador mais rápido"
      description="Quanto tempo — e dinheiro — um upgrade devolve, contra o CDI."
      inputs={
        <>
          <Card title="O upgrade">
            <div className="space-y-4">
              <SliderField
                label="Custo do computador novo"
                value={custoNovo}
                onChange={setCustoNovo}
                min={2000}
                max={60000}
                step={500}
                format={brl}
              />
              <SliderField
                label="Revenda do atual"
                value={revendaAtual}
                onChange={setRevendaAtual}
                min={0}
                max={30000}
                step={250}
                format={brl}
                hint="Quanto a sua máquina atual vale hoje no mercado usado. Entra abatendo o investimento inicial."
              />
              <SliderField
                label="Vida útil do novo"
                value={vidaAnos}
                onChange={v => setVidaAnos(Math.round(v))}
                min={1}
                max={6}
                step={1}
                format={v => `${num(v)} ${v === 1 ? 'ano' : 'anos'}`}
                hint="Horizonte em que o novo computador segue rápido o bastante para sustentar o ganho estimado. Ciclo típico: 3–4 anos."
              />
            </div>
          </Card>

          <Card title="Quanto vale a sua hora">
            <div className="space-y-4">
              <Segmented<ModoHora>
                options={[
                  { value: 'salario', label: 'Salário mensal' },
                  { value: 'hora', label: 'Valor da hora' },
                ]}
                value={modoHora}
                onChange={setModoHora}
              />
              {modoHora === 'salario' ? (
                <SliderField
                  label="Salário / renda mensal"
                  value={salarioMes}
                  onChange={setSalarioMes}
                  min={1500}
                  max={60000}
                  step={500}
                  format={brl}
                  hint="Valor da hora = renda ÷ 176 h (jornada de 44 h/semana × 4 semanas). Prefere outro divisor? Use o modo 'Valor da hora'."
                />
              ) : (
                <SliderField
                  label="Valor da sua hora"
                  value={horaCustom}
                  onChange={setHoraCustom}
                  min={10}
                  max={600}
                  step={5}
                  format={brlCents}
                  hint="Para autônomos e PJs: o valor efetivamente faturável de uma hora de trabalho."
                />
              )}
              <p className="text-[11px] text-mute">
                Sua hora vale <strong className="tnum text-ink">{brlCents(calc.valorHora)}</strong>
              </p>
            </div>
          </Card>

          <Card title="Ganho de produtividade">
            <div className="space-y-4">
              <Segmented<ModoGanho>
                options={[
                  { value: 'minutos', label: 'Minutos/dia' },
                  { value: 'pct', label: '% mais rápido' },
                ]}
                value={modoGanho}
                onChange={setModoGanho}
                label="Como estimar o ganho"
                hint="Honestidade primeiro: tempo economizado só vira dinheiro se for usado em trabalho que gera valor (mais entregas, mais horas faturáveis). Se virar ócio, o retorno é qualidade de vida — não caixa."
              />
              {modoGanho === 'minutos' ? (
                <SliderField
                  label="Minutos economizados por dia"
                  value={minutosDia}
                  onChange={setMinutosDia}
                  min={5}
                  max={240}
                  step={5}
                  format={v => `${num(v)} min`}
                  hint="Some as esperas que a máquina nova elimina: boot, builds, exportações, abas travando, renderizações."
                />
              ) : (
                <>
                  <SliderField
                    label="Quanto mais rápido"
                    value={velocidadePct}
                    onChange={setVelocidadePct}
                    min={5}
                    max={200}
                    step={5}
                    format={v => `+${pct(v, 0)}`}
                    hint="Uma máquina +30% mais rápida reduz o tempo dessas tarefas a 1/1,3 — economiza ~23% do tempo gasto nelas (fórmula: 1 − 1/(1+g))."
                  />
                  <SliderField
                    label="% do tempo em tarefas afetadas"
                    value={pctTempoAfetado}
                    onChange={setPctTempoAfetado}
                    min={5}
                    max={100}
                    step={5}
                    format={v => pct(v, 0)}
                    hint="Parcela do expediente em tarefas limitadas pela máquina (compilar, renderizar, processar). Escrever e-mail não fica mais rápido."
                  />
                </>
              )}
              <p className="text-[11px] text-mute">
                Ganho estimado:{' '}
                <strong className="tnum text-ink">{num(calc.horasEcoDia * 60)} min/dia útil</strong>{' '}
                ≈ {num(calc.horasEcoMes, 1)} h/mês
              </p>
            </div>
          </Card>

          <Collapse title="Premissas avançadas">
            <div className="space-y-4">
              <SliderField
                label="Horas trabalhadas por dia"
                value={horasDia}
                onChange={setHorasDia}
                min={1}
                max={12}
                step={0.5}
                format={v => `${num(v, 1)} h`}
              />
              <SliderField
                label="Dias úteis por mês"
                value={diasMes}
                onChange={v => setDiasMes(Math.round(v))}
                min={10}
                max={26}
                step={1}
                format={v => `${num(v)} dias`}
                hint="Média brasileira: ~21 dias úteis/mês, já descontando feriados."
              />
              <SliderField
                label="Custo de oportunidade"
                value={custoOportunidade}
                onChange={setCustoOpCustom}
                min={0}
                max={30}
                step={0.25}
                format={v => `${pct(v, 2)} a.a.`}
                hint="Default: CDI líquido de 15% de IR (Lei 11.033/2004) — o que o dinheiro renderia investido, já descontado o imposto, em vez de virar computador."
              />
              <SliderField
                label="Revenda do novo no fim"
                value={revendaNovoPct}
                onChange={setRevendaNovoPct}
                min={0}
                max={80}
                step={5}
                format={v => pct(v, 0)}
                hint="Computadores retêm tipicamente 30–40% do valor após 3 anos no mercado usado. Entra como fluxo positivo no fim da vida útil."
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
            tone={tone}
            badge={
              Number.isFinite(calc.roiPct)
                ? `ROI ${pct(calc.roiPct, 0)} em ${vidaAnos} ${vidaAnos === 1 ? 'ano' : 'anos'}`
                : `VPL ${brl(calc.vpl)}`
            }
          />

          <ExportBar pagina="computador" resumo={resumo} csv={csv} premissas={premissas} />

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile
              label="Payback"
              value={calc.payback}
              format={meses}
              sub={
                pagaNaVida
                  ? calc.payback === 0
                    ? 'imediato — custo líquido zero'
                    : `dentro da vida útil de ${vidaAnos} ${vidaAnos === 1 ? 'ano' : 'anos'}`
                  : 'não se paga na vida útil'
              }
              tone={pagaNaVida ? 'positive' : 'negative'}
            />
            <StatTile
              label={`VPL em ${vidaAnos} ${vidaAnos === 1 ? 'ano' : 'anos'}`}
              value={calc.vpl}
              format={brl}
              sub={`inclui revenda de ${brl(calc.revendaFinal)} no fim`}
              tone={calc.vpl >= 0 ? 'positive' : 'negative'}
            />
            <StatTile
              label="Horas economizadas/ano"
              value={calc.horasEcoMes * 12}
              format={v => `${num(v)} h`}
              sub={`${num(calc.horasEcoDia * 60)} min por dia útil`}
              tone="accent"
            />
            <StatTile
              label="Valor gerado/mês"
              value={calc.valorMes}
              format={brl}
              sub={`hora a ${brlCents(calc.valorHora)}`}
            />
          </div>

          <Card
            title="Quando o upgrade se paga"
            subtitle="Valor acumulado do tempo economizado (reinvestido a CDI) × custo do upgrade corrigido — o cruzamento é o payback"
          >
            <VLineChart
              data={calc.serie}
              series={[
                { key: 'ganho', name: 'Valor gerado (acumulado)', colorIndex: 0 },
                { key: 'custo', name: 'Custo do upgrade + CDI', colorIndex: 1 },
              ]}
              xKey="mes"
              xFormat={v => `${v}m`}
              yFormat={brlCompact}
            />
          </Card>

          <Card
            title="E se a estimativa estiver errada?"
            subtitle="VPL na vida útil se o ganho de tempo real for metade, igual ou 50% maior que o estimado"
          >
            <VBarChart
              data={calc.cenarios}
              series={[{ key: 'vpl', name: 'VPL' }]}
              xKey="label"
              yFormat={brlCompact}
              height={240}
              colorByValue={row => (Number(row.vpl) < 0 ? c.negative : c.positive)}
            />
          </Card>

          <Card
            title={
              <span className="inline-flex items-center gap-1.5">
                Detalhamento ano a ano
                <InfoTip text="Acumulado (a CDI) = valor do tempo economizado reinvestido mês a mês. Custo + juros = investimento líquido corrigido pelo mesmo CDI. O saldo não inclui a revenda do novo — ela entra só no VPL." />
              </span>
            }
          >
            <DataTable
              columns={[
                'Ano',
                'Horas poupadas',
                'Valor gerado',
                'Acumulado (a CDI)',
                'Custo + juros',
                'Saldo',
              ]}
              align={['l', 'r', 'r', 'r', 'r', 'r']}
              rows={calc.tabela.map(r => [
                `Ano ${r.ano}`,
                `${num(r.horas)} h`,
                brl(r.valorAno),
                brl(r.ganhoAcum),
                brl(r.custoAcum),
                <span
                  key="saldo"
                  className={`font-semibold ${r.saldo >= 0 ? 'text-positive' : 'text-negative'}`}
                >
                  {brl(r.saldo)}
                </span>,
              ])}
            />
            <p className="mt-3 text-[11px] leading-relaxed text-mute">
              Leitura honesta: a conta acima assume que cada hora liberada vira trabalho que gera
              valor. Se o tempo economizado não tiver uso produtivo, o retorno real é conforto e
              qualidade de vida — que valem algo, mas não aparecem no extrato.
            </p>
          </Card>

          <Didatico
            passos={[
              {
                t: 'Seu tempo virou dinheiro',
                d: (
                  <>
                    O computador novo devolve{' '}
                    <strong>{num(calc.horasEcoDia * 60)} min por dia útil</strong>. Em um mês de{' '}
                    {num(diasMes)} dias, isso soma {num(calc.horasEcoMes, 1)} h. Como a sua hora
                    vale {brlCents(calc.valorHora)}, esse tempo vale{' '}
                    <strong>{brl(calc.valorMes)} por mês</strong>.
                  </>
                ),
              },
              {
                t: 'Quanto sai do bolso de verdade',
                d:
                  calc.custoLiquido === 0 ? (
                    <>
                      O novo custa {brl(custoNovo)}, mas a revenda do atual ({brl(revendaAtual)})
                      cobre tudo
                      {calc.sobraRevenda > 0 && <> — e ainda sobram {brl(calc.sobraRevenda)}</>}.
                      Nada sai do bolso.
                    </>
                  ) : (
                    <>
                      O novo custa {brl(custoNovo)}, mas você vende o atual por {brl(revendaAtual)}
                      . Então o investimento de verdade é{' '}
                      <strong>{brl(calc.custoLiquido)}</strong>.
                    </>
                  ),
              },
              {
                t: Number.isFinite(calc.payback)
                  ? calc.payback === 0
                    ? 'O upgrade se paga na hora'
                    : `O computador se paga em ${meses(calc.payback)}`
                  : 'O computador não se paga na vida útil',
                d: Number.isFinite(calc.payback) ? (
                  calc.payback === 0 ? (
                    <>
                      Como o custo líquido é zero, cada um dos {brl(calc.valorMes)} mensais já é
                      lucro desde o primeiro mês.
                    </>
                  ) : (
                    <>
                      Somando {brl(calc.valorMes)} todo mês (e deixando render), o valor acumulado
                      alcança o custo de {brl(calc.custoLiquido)} corrigido no{' '}
                      <strong>mês {num(calc.payback)}</strong> — dali em diante, o upgrade só dá
                      lucro. Isso {pagaNaVida ? 'cabe' : 'NÃO cabe'} na vida útil de {anosTxt}.
                    </>
                  )
                ) : (
                  <>
                    Mesmo somando {brl(calc.valorMes)} por mês, o acumulado não alcança os{' '}
                    {brl(calc.custoLiquido)} corrigidos dentro de {anosTxt}. Só a revenda no fim
                    pode salvar a conta — e {calc.vpl > 0 ? 'salva por pouco' : 'nem ela salva'}.
                  </>
                ),
              },
              {
                t: 'Por que comparamos com o CDI',
                d: (
                  <>
                    {calc.custoLiquido > 0 ? (
                      <>
                        Os {brl(calc.custoLiquido)} não estão parados: se ficassem investidos,
                        renderiam {pct(custoOportunidade, 2)} ao ano no CDI — cerca de{' '}
                        {brl(calc.custoLiquido * calc.taxaMes)} já no primeiro mês.{' '}
                      </>
                    ) : (
                      <>
                        Todo dinheiro tem um uso alternativo: investido, renderia{' '}
                        {pct(custoOportunidade, 2)} ao ano no CDI.{' '}
                      </>
                    )}
                    Por isso trouxemos tudo para dinheiro de hoje: R$ 100 daqui a {anosTxt} valem
                    menos que R$ 100 agora, porque dá para saber quanto esses R$ 100 renderiam no
                    CDI até lá. Feito esse ajuste, sobra o VPL de <strong>{brl(calc.vpl)}</strong>{' '}
                    — o quanto o upgrade ganha (ou perde) do dinheiro investido.
                  </>
                ),
              },
              {
                t: 'A parte honesta do modelo',
                d: (
                  <>
                    Essa conta assume que cada uma das {num(calc.horasEcoMes, 1)} h/mês liberadas
                    vira trabalho que gera valor — como avisa o balãozinho do campo “Como estimar o
                    ganho”. Se o tempo virar ócio, o retorno real é conforto e qualidade de vida,
                    não os {brl(calc.valorMes)}/mês no extrato.
                  </>
                ),
              },
            ]}
            analogia={
              <>
                É como uma torneira pingando: cada espera do computador lento parece só um pingo de{' '}
                {num(calc.horasEcoDia * 60)} min por dia. Mas em um ano o balde acumula{' '}
                {num(calc.horasEcoMes * 12)} h
                {horasDia > 0 && Math.floor((calc.horasEcoMes * 12) / horasDia) >= 1 && (
                  <>
                    {' '}
                    — pelo menos {num(Math.floor((calc.horasEcoMes * 12) / horasDia))}{' '}
                    {Math.floor((calc.horasEcoMes * 12) / horasDia) === 1
                      ? 'dia inteiro'
                      : 'dias inteiros'}{' '}
                    de trabalho
                  </>
                )}
                . Fechar a torneira custa {brl(calc.custoLiquido)}; a pergunta é se a água que você
                para de perder ({brl(calc.valorMes)}/mês) paga o encanador.
              </>
            }
            sensibilidade={
              <>
                O número que mais mexe na resposta é o de <strong>minutos por dia</strong>.{' '}
                {Number.isFinite(calc.minutosEquilibrio) && calc.minutosEquilibrio > 0 ? (
                  <>
                    Com essas premissas, o upgrade empata com o CDI a partir de ≈{' '}
                    <strong>
                      {num(calc.minutosEquilibrio, calc.minutosEquilibrio < 10 ? 1 : 0)} min/dia
                    </strong>{' '}
                    — você estimou {num(calc.horasEcoDia * 60)} min.
                  </>
                ) : (
                  <>
                    Com o custo coberto pelas revendas (a do atual agora e a do novo no fim),
                    qualquer minuto ganho já é lucro.
                  </>
                )}{' '}
                Se o ganho real cair pela metade ({num(calc.horasEcoDia * 30)} min/dia), o VPL vai
                de {brl(calc.vpl)} para {brl(calc.cenarios[0].vpl)}
                {calc.cenarios[0].vpl < 0 && calc.vpl >= 0 && <> — e o resultado inverte</>}.
              </>
            }
          />
        </>
      }
    />
  )
}
