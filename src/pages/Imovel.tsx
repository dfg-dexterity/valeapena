import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Home as HomeIcon } from 'lucide-react'
import {
  Card,
  Collapse,
  DataTable,
  LiveBadge,
  NumberField,
  SectionTitle,
  SliderField,
  Segmented,
  StatTile,
  Toggle,
  ToolPage,
  Verdict,
} from '../components/ui'
import { VBarChart, VLineChart, type SeriesDef } from '../components/charts'
import { useRates } from '../lib/rates'
import { aToM, mToA, priceSchedule, sacSchedule, totalOf, type AmortRow } from '../lib/finance'
import { brl, brlCents, brlCompact, meses, num, pct } from '../lib/format'
import { BANCOS_IMOBILIARIO, DFI_ALIQUOTA_MES, REGRAS_IMOBILIARIO, mipAliquota } from '../lib/dados2026'

type Sistema = 'sac' | 'price'

/**
 * CET aproximado: TIR mensal dos fluxos do contrato, por bissecção.
 * Entrada em t0 = valor liberado (financiado − tarifa de avaliação);
 * saídas = parcelas cheias (com MIP + DFI). Retorna % a.a.
 */
function cetAnualPct(liberado: number, rows: AmortRow[]): number {
  if (!(liberado > 0) || rows.length === 0) return NaN
  const npvPagamentos = (r: number) =>
    rows.reduce((acc, row) => acc + row.parcela / Math.pow(1 + r, row.mes), 0)
  // a r = 0 os pagamentos devem superar o liberado (há juros); senão, não há TIR positiva
  if (npvPagamentos(0) <= liberado) return 0
  let lo = 0
  let hi = 1 // 100% a.m. — teto folgado
  for (let i = 0; i < 90; i++) {
    const mid = (lo + hi) / 2
    if (npvPagamentos(mid) > liberado) lo = mid
    else hi = mid
  }
  return mToA((lo + hi) / 2)
}

function somaExtras(rows: AmortRow[]): number {
  return rows.reduce((a, r) => a + (r.extras ?? 0), 0)
}

function Aviso({ tone, children }: { tone: 'warning' | 'negative'; children: ReactNode }) {
  const box =
    tone === 'negative'
      ? 'border-negative/40 bg-negative-soft'
      : 'border-warning/40 bg-warning-soft'
  const icon = tone === 'negative' ? 'text-negative' : 'text-warning'
  return (
    <div className={`themed flex items-start gap-2.5 rounded-xl border px-4 py-3 ${box}`}>
      <AlertTriangle size={14} className={`mt-0.5 shrink-0 ${icon}`} />
      <p className="text-xs leading-relaxed text-ink-2">{children}</p>
    </div>
  )
}

/** eixo/tooltip dos gráficos temporais: mês → "12,5 anos" */
function fmtTempo(v: string | number): string {
  const m = Number(v)
  if (!Number.isFinite(m)) return String(v)
  if (m === 0) return 'início'
  if (m < 12) return `mês ${m}`
  const a = m / 12
  return `${a.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${a <= 1 ? 'ano' : 'anos'}`
}

const SERIES_SISTEMAS: SeriesDef[] = [
  { key: 'sac', name: 'SAC', colorIndex: 0 },
  { key: 'price', name: 'Tabela Price', colorIndex: 1 },
]

const SERIES_COMPOSICAO: SeriesDef[] = [
  { key: 'principal', name: 'Principal', colorIndex: 0 },
  { key: 'juros', name: 'Juros', colorIndex: 1 },
  { key: 'seguros', name: 'Seguros (MIP + DFI)', colorIndex: 2 },
]

const ANOS_TABELA = [1, 2, 3, 5, 8, 10, 15, 20, 25, 30, 35]

export default function Imovel() {
  const rates = useRates()

  // Principais
  const [valorImovel, setValorImovel] = useState(600_000)
  const [entradaPct, setEntradaPct] = useState(20)
  const [sistema, setSistema] = useState<Sistema>('sac')
  const [prazo, setPrazo] = useState(360)
  const [taxaUser, setTaxaUser] = useState<number | null>(null)
  const [usarTr, setUsarTr] = useState(true)
  const [idade, setIdade] = useState(35)
  const [renda, setRenda] = useState(12_000)

  // Avançado
  const [itbiPct, setItbiPct] = useState(REGRAS_IMOBILIARIO.itbiPct * 100)
  const [registroPct, setRegistroPct] = useState(REGRAS_IMOBILIARIO.registroPct * 100)
  const [taxaAvaliacao, setTaxaAvaliacao] = useState<number>(REGRAS_IMOBILIARIO.taxaAvaliacao)
  const [dfiMesPct, setDfiMesPct] = useState(DFI_ALIQUOTA_MES * 100)

  const taxaAa = taxaUser ?? rates.imobMercado

  const sim = useMemo(() => {
    const entrada = (valorImovel * entradaPct) / 100
    const financiado = Math.max(0, valorImovel - entrada)
    const trAnualizadaPct = (Math.pow(1 + rates.trMes / 100, 12) - 1) * 100
    const jurosMes = aToM(taxaAa + (usarTr ? trAnualizadaPct : 0))
    const dfiMes = (valorImovel * Math.max(0, dfiMesPct)) / 100
    const extrasFn = (mes: number, saldo: number) =>
      saldo * mipAliquota(idade + (mes - 1) / 12) + dfiMes

    const sac = sacSchedule(financiado, jurosMes, prazo, extrasFn)
    const price = priceSchedule(financiado, jurosMes, prazo, extrasFn)
    const chosen = sistema === 'sac' ? sac : price

    const p1 = chosen[0]?.parcela ?? 0
    const pUltima = chosen[chosen.length - 1]?.parcela ?? 0
    const totalPago = totalOf(chosen, 'parcela')
    const totalJuros = totalOf(chosen, 'juros')
    const totalSeguros = somaExtras(chosen)

    const liberado = financiado - Math.max(0, taxaAvaliacao)
    const cet = cetAnualPct(liberado, chosen)

    const custosTransacao =
      (valorImovel * (Math.max(0, itbiPct) + Math.max(0, registroPct))) / 100 +
      Math.max(0, taxaAvaliacao)

    const rendaMinima = p1 / REGRAS_IMOBILIARIO.comprometimentoRenda

    // séries amostradas para os gráficos (~140 pontos)
    const step = Math.max(1, Math.round(prazo / 140))
    const parcelaData: Array<Record<string, number>> = []
    const saldoData: Array<Record<string, number>> = [
      { mes: 0, sac: financiado, price: financiado },
    ]
    let ultimoMes = 0
    const ponto = (m: number) => {
      const i = m - 1
      if (!sac[i] || !price[i]) return
      parcelaData.push({ mes: m, sac: sac[i].parcela, price: price[i].parcela })
      saldoData.push({ mes: m, sac: sac[i].saldo, price: price[i].saldo })
      ultimoMes = m
    }
    for (let m = 1; m <= prazo; m += step) ponto(m)
    if (ultimoMes !== prazo) ponto(prazo)

    const composicao = [
      { sistema: 'SAC', principal: financiado, juros: totalOf(sac, 'juros'), seguros: somaExtras(sac) },
      { sistema: 'Price', principal: financiado, juros: totalOf(price, 'juros'), seguros: somaExtras(price) },
    ]
    const totalSac = totalOf(sac, 'parcela')
    const totalPrice = totalOf(price, 'parcela')

    return {
      entrada,
      financiado,
      trAnualizadaPct,
      sac,
      price,
      chosen,
      p1,
      pUltima,
      totalPago,
      totalJuros,
      totalSeguros,
      cet,
      custosTransacao,
      rendaMinima,
      parcelaData,
      saldoData,
      composicao,
      totalSac,
      totalPrice,
    }
  }, [valorImovel, entradaPct, sistema, prazo, taxaAa, usarTr, idade, itbiPct, registroPct, taxaAvaliacao, dfiMesPct, rates.trMes])

  /* ------------------------- Veredito e avisos ------------------------- */

  const compRenda = renda > 0 ? sim.p1 / renda : Infinity
  const cabe = compRenda <= REGRAS_IMOBILIARIO.comprometimentoRenda + 1e-9
  const dentroSfh = valorImovel <= REGRAS_IMOBILIARIO.tetoSfh

  const entradaMinPct = Math.round(
    (1 - (sistema === 'sac' ? REGRAS_IMOBILIARIO.ltvMaxSac : REGRAS_IMOBILIARIO.ltvMaxPrice)) * 100,
  )
  const entradaOk = entradaPct >= entradaMinPct - 1e-9
  const idadeFim = idade + prazo / 12
  const idadeOk = idadeFim <= REGRAS_IMOBILIARIO.idadeMaxFimContrato
  const prazoMaxIdade = Math.max(0, Math.floor((REGRAS_IMOBILIARIO.idadeMaxFimContrato - idade) * 12))
  const cetAcimaTeto = Number.isFinite(sim.cet) && sim.cet > 12

  const nomeSistema = sistema === 'sac' ? 'SAC' : 'Price'
  const limiteParcela = renda * REGRAS_IMOBILIARIO.comprometimentoRenda
  const maiorP1 = Math.max(sim.sac[0]?.parcela ?? 0, sim.price[0]?.parcela ?? 0)
  const mostrarLimite = limiteParcela > 0 && limiteParcela <= maiorP1 * 1.6

  /* --------------------------- Tabela amostrada --------------------------- */

  const tabela = useMemo(() => {
    const rows: ReactNode[][] = []
    const usados = new Set<number>()
    const linha = (label: string, m: number) => {
      const r = sim.chosen[m - 1]
      if (!r || usados.has(m)) return
      usados.add(m)
      rows.push([
        label,
        brlCents(r.parcela),
        brlCents(r.juros),
        brlCents(r.amortizacao),
        brlCents(r.extras ?? 0),
        brl(r.saldo),
      ])
    }
    linha('1º mês', 1)
    for (const a of ANOS_TABELA) if (a * 12 <= prazo) linha(`ano ${a}`, a * 12)
    linha(`mês ${prazo} (fim)`, prazo)
    return rows
  }, [sim.chosen, prazo])

  /* ------------------------------- Página ------------------------------- */

  return (
    <ToolPage
      icon={<HomeIcon size={20} />}
      title="Financiamento imobiliário"
      description="SAC × Price no SBPE — parcelas, seguros, CET e a renda que o banco vai exigir."
      inputs={
        <>
          <Card title="Imóvel e financiamento">
            <div className="space-y-4">
              <SliderField
                label="Valor do imóvel"
                value={valorImovel}
                onChange={setValorImovel}
                min={100_000}
                max={3_000_000}
                step={10_000}
                format={brl}
                hint={`Até ${brlCompact(REGRAS_IMOBILIARIO.tetoSfh)} o imóvel fica no SFH (novo modelo out/2025): permite usar FGTS e tem teto de juros.`}
              />
              <div>
                <SliderField
                  label="Entrada"
                  value={entradaPct}
                  onChange={setEntradaPct}
                  min={5}
                  max={90}
                  step={1}
                  format={v => pct(v, 0)}
                  hint="Novo modelo do crédito imobiliário (out/2025): LTV máx. de 80% no SAC (entrada ≥ 20%) e 70% na Price (entrada ≥ 30%)."
                />
                <p className="mt-1 text-[11px] text-mute">
                  Entrada de <strong className="tnum text-ink-2">{brl(sim.entrada)}</strong> · financia{' '}
                  <strong className="tnum text-ink-2">{brl(sim.financiado)}</strong>
                </p>
              </div>
              <Segmented<Sistema>
                label="Sistema de amortização"
                value={sistema}
                onChange={setSistema}
                options={[
                  { value: 'sac', label: 'SAC' },
                  { value: 'price', label: 'Price' },
                ]}
                hint="SAC: amortização constante — a parcela começa maior e cai todo mês. Price: parcela estável (varia só com a TR), com mais juros no total."
              />
              <SliderField
                label="Prazo"
                value={prazo}
                onChange={setPrazo}
                min={60}
                max={REGRAS_IMOBILIARIO.prazoMaxMeses}
                step={12}
                format={meses}
              />
            </div>
          </Card>

          <Card title="Taxa de juros">
            <div className="space-y-4">
              <SliderField
                label="Taxa efetiva"
                value={taxaAa}
                onChange={setTaxaUser}
                min={7}
                max={18}
                step={0.05}
                format={v => `${pct(v, 2)} a.a.`}
                hint="Default: taxa média dos financiamentos imobiliários PF a taxas de mercado (série 20772 do BCB). Clique num banco abaixo para simular com a taxa dele."
              />
              <LiveBadge live={rates.aoVivo} referencia={rates.referencia} />
              <div>
                <SectionTitle>Taxas por banco (SBPE, “a partir de”)</SectionTitle>
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setTaxaUser(null)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      taxaUser === null
                        ? 'border-accent bg-accent-soft text-ink'
                        : 'border-line text-ink-2 hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    <span className="font-medium">Média do mercado (BCB)</span>
                    <span className="font-semibold tnum">{pct(rates.imobMercado, 2)}</span>
                  </button>
                  {BANCOS_IMOBILIARIO.map(b => {
                    const ativo = taxaUser !== null && Math.abs(taxaAa - b.taxaAa) < 0.005
                    return (
                      <button
                        key={b.nome}
                        type="button"
                        onClick={() => setTaxaUser(b.taxaAa)}
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                          ativo
                            ? 'border-accent bg-accent-soft text-ink'
                            : 'border-line text-ink-2 hover:border-line-strong hover:text-ink'
                        }`}
                      >
                        <span className="font-medium">{b.nome}</span>
                        <span className="font-semibold tnum">{pct(b.taxaAa, 2)} + TR</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <Toggle
                checked={usarTr}
                onChange={setUsarTr}
                label="Somar TR à taxa"
                hint={`Quase todo contrato SBPE é indexado a "taxa + TR". TR atual: ${pct(rates.trMes, 4)} a.m. (série 226 do BCB) ≈ ${pct(sim.trAnualizadaPct, 2)} a.a.`}
              />
            </div>
          </Card>

          <Card title="Você">
            <div className="space-y-4">
              <SliderField
                label="Sua idade"
                value={idade}
                onChange={setIdade}
                min={18}
                max={70}
                step={1}
                format={v => `${num(v)} anos`}
                hint="Define o seguro MIP (morte e invalidez), obrigatório: a alíquota mensal sobre o saldo devedor cresce com a idade — usamos uma tabela típica de mercado, com a idade avançando ao longo do contrato."
              />
              <SliderField
                label="Renda familiar bruta"
                value={renda}
                onChange={setRenda}
                min={1_000}
                max={80_000}
                step={500}
                format={brl}
                hint="Os bancos limitam a parcela a 30% da renda familiar bruta comprovada — pode somar a renda de cônjuge/coproponente."
              />
            </div>
          </Card>

          <Collapse title="Premissas avançadas">
            <div className="space-y-4">
              <NumberField
                label="ITBI"
                value={itbiPct}
                onChange={setItbiPct}
                suffix="%"
                min={0}
                max={5}
                step={0.1}
                hint="Imposto de transmissão pago à vista na compra — ~3% nas capitais (ex.: São Paulo). Não entra no financiamento."
              />
              <NumberField
                label="Registro e escritura"
                value={registroPct}
                onChange={setRegistroPct}
                suffix="%"
                min={0}
                max={3}
                step={0.1}
                hint="Custos de cartório (escritura + registro), tipicamente ~1% do valor do imóvel."
              />
              <NumberField
                label="Tarifa de avaliação"
                value={taxaAvaliacao}
                onChange={setTaxaAvaliacao}
                suffix="R$"
                min={0}
                step={100}
                hint="Cobrada pelo banco para avaliar o imóvel (Caixa: R$ 2.200–3.000). Entra no cálculo do CET."
              />
              <NumberField
                label="DFI (seguro do imóvel)"
                value={dfiMesPct}
                onChange={setDfiMesPct}
                suffix="% a.m."
                min={0}
                max={0.1}
                step={0.005}
                hint="Seguro de Danos Físicos do Imóvel, obrigatório: alíquota mensal sobre o valor de avaliação do imóvel (típico: 0,01% a.m.)."
              />
            </div>
          </Collapse>
        </>
      }
      results={
        <>
          <Verdict
            winner={
              cabe
                ? `Cabe na sua renda — 1ª parcela de ${brlCents(sim.p1)}`
                : `Não cabe ainda — exige renda de ${brl(sim.rendaMinima)}`
            }
            detail={
              <>
                No {nomeSistema}, a primeira parcela ({brlCents(sim.p1)}, já com seguros) compromete{' '}
                <strong className="text-ink">{pct(compRenda * 100, 0)}</strong> da renda de {brl(renda)} — os
                bancos aceitam até 30%, o que exige renda familiar mínima de{' '}
                <strong className="text-ink">{brl(sim.rendaMinima)}</strong>.{' '}
                {sistema === 'sac'
                  ? `No SAC a parcela cai todo mês: a última será ${brlCents(sim.pUltima)}.`
                  : `Na Price a parcela fica praticamente estável até o fim (${brlCents(sim.pUltima)} na última).`}
              </>
            }
            tone={cabe ? 'positive' : 'negative'}
            badge={dentroSfh ? 'Elegível a FGTS · SFH' : `Acima do teto SFH (${brlCompact(REGRAS_IMOBILIARIO.tetoSfh)})`}
          />

          {(!entradaOk || !idadeOk || cetAcimaTeto) && (
            <div className="space-y-2">
              {!entradaOk && (
                <Aviso tone="negative">
                  Entrada de {pct(entradaPct, 0)} é menor que o mínimo de{' '}
                  <strong className="text-ink">{pct(entradaMinPct, 0)}</strong> exigido no {nomeSistema} (LTV
                  máximo do novo modelo, out/2025). O banco não aprova assim —{' '}
                  {sistema === 'price'
                    ? 'aumente a entrada ou mude para o SAC (que aceita entrada de 20%).'
                    : 'aumente a entrada.'}
                </Aviso>
              )}
              {!idadeOk && (
                <Aviso tone="negative">
                  Sua idade + prazo = {num(idadeFim, 1)} anos no fim do contrato — os bancos limitam a{' '}
                  {num(REGRAS_IMOBILIARIO.idadeMaxFimContrato, 1)} anos. Prazo máximo para {num(idade)} anos:{' '}
                  <strong className="text-ink">{meses(prazoMaxIdade)}</strong>.
                </Aviso>
              )}
              {cetAcimaTeto && (
                <Aviso tone="warning">
                  CET de {pct(sim.cet, 1)} a.a. — acima do teto de 12% a.a. do novo modelo SFH (out/2025).
                  Compare bancos ou negocie relacionamento: cada ponto de taxa muda dezenas de milhares de
                  reais no total.
                </Aviso>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            <StatTile
              label="1ª parcela"
              value={sim.p1}
              format={brlCents}
              tone="accent"
              sub={renda > 0 ? `${pct(compRenda * 100, 0)} da sua renda` : 'informe a renda'}
            />
            <StatTile label="Última parcela" value={sim.pUltima} format={brlCents} sub={`no mês ${prazo}`} />
            <StatTile
              label="Total pago ao banco"
              value={sim.totalPago}
              format={brl}
              sub={
                sim.financiado > 0
                  ? `${num(sim.totalPago / sim.financiado, 1)}× o valor financiado`
                  : undefined
              }
            />
            <StatTile
              label="Total de juros"
              value={sim.totalJuros}
              format={brl}
              tone="negative"
              sub={`+ ${brl(sim.totalSeguros)} de seguros`}
            />
            <StatTile
              label="CET aproximado"
              value={sim.cet}
              format={v => `${pct(v, 2)} a.a.`}
              tone="accent"
              sub="TIR c/ seguros e avaliação"
            />
            <StatTile
              label="Custos de transação"
              value={sim.custosTransacao}
              format={brl}
              sub="ITBI + registro + avaliação, à vista"
            />
          </div>

          <Card
            title="Parcela ao longo do tempo — SAC × Price"
            subtitle={`Com TR ${usarTr ? 'incluída' : 'desligada'}, MIP e DFI.${mostrarLimite ? ' Linha tracejada = limite de 30% da sua renda.' : ''}`}
          >
            <VLineChart
              data={sim.parcelaData}
              series={SERIES_SISTEMAS}
              xKey="mes"
              xFormat={fmtTempo}
              yFormat={brlCompact}
              refY={mostrarLimite ? limiteParcela : undefined}
              refYLabel={mostrarLimite ? '30% da renda' : undefined}
            />
          </Card>

          <Card title="Saldo devedor" subtitle="Quanto você ainda deve ao banco em cada momento do contrato.">
            <VLineChart
              data={sim.saldoData}
              series={SERIES_SISTEMAS}
              xKey="mes"
              xFormat={fmtTempo}
              yFormat={brlCompact}
            />
          </Card>

          <Card
            title="Para onde vai o dinheiro"
            subtitle="Composição do total pago em cada sistema, no prazo completo."
          >
            <VBarChart
              data={sim.composicao}
              series={SERIES_COMPOSICAO}
              xKey="sistema"
              yFormat={brlCompact}
              stacked
              height={260}
            />
            <p className="mt-3 text-xs leading-relaxed text-mute">
              No total, o SAC sai{' '}
              <strong className="tnum text-ink">{brl(Math.abs(sim.totalPrice - sim.totalSac))}</strong>{' '}
              {sim.totalPrice >= sim.totalSac ? 'mais barato' : 'mais caro'} que a Price neste cenário — em troca
              de parcelas iniciais {brlCents(Math.max(0, (sim.sac[0]?.parcela ?? 0) - (sim.price[0]?.parcela ?? 0)))}{' '}
              maiores.
            </p>
          </Card>

          <Card
            title="Detalhamento"
            subtitle={`Cronograma amostrado — sistema ${nomeSistema}, ${meses(prazo)}. Valores da parcela do mês indicado.`}
          >
            <DataTable
              columns={['Período', 'Parcela', 'Juros', 'Amortização', 'Seguros', 'Saldo devedor']}
              align={['l', 'r', 'r', 'r', 'r', 'r']}
              rows={tabela}
            />
          </Card>

          <Card title="Premissas e fontes">
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-mute">
              <li>
                Juros mensais = capitalização composta de (taxa contratada + TR anualizada). TR de{' '}
                {pct(rates.trMes, 4)} a.m. (série 226, BCB); taxa média de mercado da série 20772 do BCB.
              </li>
              <li>
                Seguros obrigatórios: MIP com alíquota mensal por idade sobre o saldo devedor (tabela típica
                de mercado, idade avançando durante o contrato) e DFI de {pct(dfiMesPct, 3)} a.m. sobre o
                valor do imóvel.
              </li>
              <li>
                CET aproximado = TIR mensal anualizada dos fluxos: valor liberado (financiado − tarifa de
                avaliação) contra as parcelas cheias. ITBI e registro ficam fora do CET porque são pagos ao
                município/cartório, não ao banco.
              </li>
              <li>
                Regras do novo modelo do crédito imobiliário (out/2025): LTV máximo de 80% no SAC e 70% na
                Price, teto SFH de {brlCompact(REGRAS_IMOBILIARIO.tetoSfh)} (uso de FGTS) e taxa máxima de
                12% a.a.; parcela limitada a 30% da renda bruta e idade + prazo ≤ 80,5 anos.
              </li>
              <li>
                Simulação educacional: bancos arredondam seguros, tarifas e datas de formas próprias — o CET
                oficial sai na sua proposta de crédito.
              </li>
            </ul>
          </Card>
        </>
      }
    />
  )
}
