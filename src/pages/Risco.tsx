import { useMemo, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import {
  Card,
  Collapse,
  DataTable,
  InfoTip,
  LiveBadge,
  NumberField,
  Segmented,
  SliderField,
  StatTile,
  ToolPage,
  Verdict,
} from '../components/ui'
import { VFanChart, VLineChart } from '../components/charts'
import { useVizColors } from '../theme'
import { useRates } from '../lib/rates'
import { CLASSES_ATIVO } from '../lib/dados2026'
import { aToM, fvSeries } from '../lib/finance'
import { brl, brlCompact, num, pct } from '../lib/format'

/* ============================================================
   Monte Carlo — GBM mensal, 2.000 caminhos, semente fixa.
   RNG determinístico (mulberry32 + Box-Muller): os mesmos
   "futuros" são sorteados em toda visita — o resultado só muda
   quando o usuário muda uma premissa.
   ============================================================ */

const N_CAMINHOS = 2000
const SEED = 20260827

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Normais padrão via Box-Muller, sequência determinística. */
function gerarNormais(qtd: number, seed: number): Float32Array {
  const rand = mulberry32(seed)
  const out = new Float32Array(qtd)
  for (let i = 0; i < qtd; i += 2) {
    const u1 = Math.max(rand(), 1e-12)
    const u2 = rand()
    const r = Math.sqrt(-2 * Math.log(u1))
    out[i] = r * Math.cos(2 * Math.PI * u2)
    if (i + 1 < qtd) out[i + 1] = r * Math.sin(2 * Math.PI * u2)
  }
  return out
}

interface Premissa {
  ret: number
  vol: number
}

function premissasPadrao(): Record<string, Premissa> {
  return Object.fromEntries(CLASSES_ATIVO.map(c => [c.id, { ret: c.retornoAa, vol: c.volAa }]))
}

const LABEL_CURTO: Record<string, string> = {
  poupanca: 'Poup.',
  selic: 'Selic',
  cdb: 'CDB',
  ipca: 'IPCA+',
  multi: 'Multi',
  acoes: 'Ações',
  cripto: 'BTC',
}

/** Eixo X / rótulo do tooltip: meses → "hoje", "18 meses", "5 anos". */
function fmtMes(v: string | number): string {
  const m = Number(v)
  if (!Number.isFinite(m)) return String(v)
  if (m === 0) return 'hoje'
  if (m % 12 === 0) {
    const a = m / 12
    return `${a} ${a === 1 ? 'ano' : 'anos'}`
  }
  return `${num(m)} meses`
}

function RiscoDots({ nivel, className = '' }: { nivel: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} title={`Risco ${nivel} de 5`}>
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i <= nivel ? 'bg-accent' : 'bg-surface-3'}`}
        />
      ))}
    </span>
  )
}

/** Fatores por caminho em cada instante amostrado: valor = inicial·A + aporte·B. */
interface SimClasse {
  A: Float64Array[]
  B: Float64Array[]
}

export default function Risco() {
  const rates = useRates()
  const cores = useVizColors()

  /* -------------------- estado -------------------- */
  const [inicial, setInicial] = useState(10000)
  const [aporte, setAporte] = useState(500)
  const [anos, setAnos] = useState(10)
  const [focoId, setFocoId] = useState('acoes')
  const [selecionadas, setSelecionadas] = useState<string[]>(['poupanca', 'selic', 'multi', 'acoes'])
  const [premissas, setPremissas] = useState<Record<string, Premissa>>(premissasPadrao)
  const [cdiCustom, setCdiCustom] = useState<number | null>(null)

  const cdi = cdiCustom ?? rates.cdi
  const foco = CLASSES_ATIVO.find(c => c.id === focoId) ?? CLASSES_ATIVO[0]
  const mesesTotal = Math.max(1, Math.round(anos)) * 12
  const anosTxt = `${anos} ${anos === 1 ? 'ano' : 'anos'}`

  const escolherFoco = (id: string) => {
    setFocoId(id)
    // a classe em foco entra sempre no gráfico de comparação (máx. 4)
    setSelecionadas(sel => (sel.includes(id) ? sel : [...sel.slice(0, 3), id]))
  }

  const alternarClasse = (id: string) => {
    if (id === focoId) return // o foco fica sempre no gráfico
    setSelecionadas(sel =>
      sel.includes(id) ? sel.filter(x => x !== id) : sel.length >= 4 ? sel : [...sel, id],
    )
  }

  const setPremissa = (id: string, campo: keyof Premissa, valor: number) => {
    const [min, max] = campo === 'ret' ? [-95, 100] : [0, 150]
    const v = Math.min(max, Math.max(min, Number.isFinite(valor) ? valor : 0))
    setPremissas(p => ({ ...p, [id]: { ...(p[id] ?? { ret: 0, vol: 0 }), [campo]: v } }))
  }

  /* -------------------- simulação -------------------- */

  // instantes amostrados (≤ 49 pontos) — sempre inclui t=0 e o horizonte.
  // O passo precisa DIVIDIR mesesTotal: o eixo X do Recharts é categórico
  // (espaçamento uniforme), e um último intervalo quebrado distorceria a curva.
  const tempos = useMemo(() => {
    let passo = Math.max(1, Math.ceil(mesesTotal / 48))
    while (mesesTotal % passo !== 0) passo++
    const t: number[] = []
    for (let m = 0; m <= mesesTotal; m += passo) t.push(m)
    return t
  }, [mesesTotal])

  // choques normais compartilhados por todas as classes (comparação justa:
  // o mesmo "mundo" sorteado é aplicado a cada classe)
  const ruido = useMemo(() => gerarNormais(N_CAMINHOS * mesesTotal, SEED), [mesesTotal])

  // núcleo pesado: fatores A (cresc. do valor inicial) e B (cresc. dos aportes)
  // por caminho — independem de quanto você investe, então mover os sliders de
  // dinheiro recombina os caminhos sem re-simular nada
  const sims = useMemo(() => {
    const out: Record<string, SimClasse> = {}
    for (const c of CLASSES_ATIVO) {
      const pr = premissas[c.id] ?? { ret: c.retornoAa, vol: c.volAa }
      const vol = Math.max(0, pr.vol) / 100
      const mMes = (Math.log(1 + Math.max(-95, pr.ret) / 100) - (vol * vol) / 2) / 12
      const sMes = vol / Math.sqrt(12)
      const A = tempos.map(() => new Float64Array(N_CAMINHOS))
      const B = tempos.map(() => new Float64Array(N_CAMINHOS))
      for (let cam = 0; cam < N_CAMINHOS; cam++) {
        let a = 1
        let b = 0
        let ponto = 1 // tempos[0] === 0 → A=1, B=0 (default do Float64Array já cobre B)
        A[0][cam] = 1
        const base = cam * mesesTotal
        for (let m = 1; m <= mesesTotal; m++) {
          const g = Math.exp(mMes + sMes * ruido[base + m - 1])
          a *= g
          b = b * g + 1 // aporte de 1 no fim de cada mês
          if (tempos[ponto] === m) {
            A[ponto][cam] = a
            B[ponto][cam] = b
            ponto++
          }
        }
      }
      out[c.id] = { A, B }
    }
    return out
  }, [premissas, tempos, mesesTotal, ruido])

  // classes desenhadas no gráfico de medianas: foco primeiro (azul), depois
  // as selecionadas na ordem canônica — cores nunca embaralham
  const idsGrafico = useMemo(() => {
    const outras = CLASSES_ATIVO.map(c => c.id).filter(
      id => id !== focoId && selecionadas.includes(id),
    )
    return [focoId, ...outras].slice(0, 4)
  }, [focoId, selecionadas])

  // recombinação leve: aplica inicial/aporte, extrai percentis e probabilidades
  const resultado = useMemo(() => {
    const totalInvestido = inicial + aporte * mesesTotal
    const cdiFinal = fvSeries(inicial, aToM(cdi), mesesTotal, aporte)
    const ultimo = tempos.length - 1

    const combinar = (sim: SimClasse, ponto: number): Float64Array => {
      const arr = new Float64Array(N_CAMINHOS)
      const A = sim.A[ponto]
      const B = sim.B[ponto]
      for (let i = 0; i < N_CAMINHOS; i++) arr[i] = inicial * A[i] + aporte * B[i]
      return arr.sort()
    }
    const pctl = (ordenado: Float64Array, q: number): number => {
      const idx = q * (ordenado.length - 1)
      const lo = Math.floor(idx)
      const hi = Math.min(ordenado.length - 1, lo + 1)
      const f = idx - lo
      return ordenado[lo] * (1 - f) + ordenado[hi] * f
    }

    // trajetórias: leque (foco) + medianas (classes do gráfico)
    const fanRows: Array<{ t: number; p10: number; mediana: number; p90: number }> = []
    const medianas: Array<Record<string, number>> = tempos.map(t => ({ t }))
    for (const id of idsGrafico) {
      const sim = sims[id]
      if (!sim) continue
      for (let p = 0; p < tempos.length; p++) {
        const v = combinar(sim, p)
        medianas[p][id] = pctl(v, 0.5)
        if (id === focoId) {
          fanRows.push({ t: tempos[p], p10: pctl(v, 0.1), mediana: pctl(v, 0.5), p90: pctl(v, 0.9) })
        }
      }
    }

    // distribuição no horizonte, para todas as classes (tabela)
    const porClasse: Record<string, { p10: number; p50: number; p90: number }> = {}
    let probCdi = 0
    let probPerda = 0
    for (const c of CLASSES_ATIVO) {
      const sim = sims[c.id]
      if (!sim) continue
      const v = combinar(sim, ultimo)
      porClasse[c.id] = { p10: pctl(v, 0.1), p50: pctl(v, 0.5), p90: pctl(v, 0.9) }
      if (c.id === focoId && totalInvestido > 0) {
        let nCdi = 0
        let nPerda = 0
        for (let i = 0; i < N_CAMINHOS; i++) {
          if (v[i] < cdiFinal) nCdi++
          if (v[i] < totalInvestido) nPerda++
        }
        probCdi = nCdi / N_CAMINHOS
        probPerda = nPerda / N_CAMINHOS
      }
    }

    return { totalInvestido, cdiFinal, fanRows, medianas, porClasse, probCdi, probPerda }
  }, [sims, tempos, mesesTotal, inicial, aporte, cdi, focoId, idsGrafico])

  /* -------------------- veredito -------------------- */

  const stFoco = resultado.porClasse[foco.id] ?? { p10: 0, p50: 0, p90: 0 }
  const temDinheiro = resultado.totalInvestido > 0
  const vsCdi = resultado.cdiFinal > 0 ? stFoco.p50 / resultado.cdiFinal - 1 : 0
  const tom = !temDinheiro
    ? 'neutral'
    : vsCdi > 0.02
      ? 'positive'
      : vsCdi < -0.02
        ? 'negative'
        : 'neutral'

  const corFoco = cores.series[0]

  return (
    <ToolPage
      icon={<TrendingUp size={20} />}
      title="Risco × retorno"
      description="2.000 futuros simulados, da poupança ao Bitcoin — quanto pode render e quanto pode doer no caminho."
      inputs={
        <>
          <Card title="Sua simulação">
            <div className="space-y-4">
              <SliderField
                label="Valor inicial"
                value={inicial}
                onChange={setInicial}
                min={0}
                max={500000}
                step={5000}
                format={brl}
              />
              <SliderField
                label="Aporte mensal"
                value={aporte}
                onChange={setAporte}
                min={0}
                max={10000}
                step={100}
                format={brl}
                hint="Aplicado no fim de cada mês, sem reajuste pela inflação ao longo do tempo."
              />
              <SliderField
                label="Horizonte"
                value={anos}
                onChange={v => setAnos(Math.round(v))}
                min={1}
                max={30}
                step={1}
                format={v => `${v} ${v === 1 ? 'ano' : 'anos'}`}
                hint="Prazos maiores abrem o leque de resultados — mas, em classes com retorno esperado positivo, reduzem a chance de terminar no prejuízo."
              />
              <div>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="text-xs font-medium text-ink-2">Classe em foco</span>
                  <InfoTip text="A classe destacada no veredito, nos indicadores e no leque de cenários. Ela entra automaticamente no gráfico de comparação." />
                </div>
                <div className="scrollbar-none -mx-1 overflow-x-auto px-1 pb-1">
                  <div className="min-w-[420px]">
                    <Segmented
                      options={CLASSES_ATIVO.map(c => ({
                        value: c.id,
                        label: LABEL_CURTO[c.id] ?? c.nome,
                      }))}
                      value={focoId}
                      onChange={escolherFoco}
                    />
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card
            title="Comparar classes"
            subtitle="Até 4 linhas no gráfico de medianas"
            right={
              <span className="text-[11px] font-semibold tnum text-mute">
                {Math.min(4, selecionadas.length)}/4
              </span>
            }
          >
            <div className="grid grid-cols-2 gap-1.5">
              {CLASSES_ATIVO.map(cl => {
                const ativa = selecionadas.includes(cl.id)
                const ehFoco = cl.id === focoId
                const lotado = !ativa && selecionadas.length >= 4
                return (
                  <button
                    key={cl.id}
                    type="button"
                    onClick={() => alternarClasse(cl.id)}
                    disabled={lotado}
                    title={
                      ehFoco
                        ? 'Classe em foco — fica sempre no gráfico'
                        : lotado
                          ? 'Limite de 4 classes — desmarque uma para trocar'
                          : undefined
                    }
                    className={`rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                      ativa
                        ? 'border-accent/60 bg-accent-soft text-ink'
                        : lotado
                          ? 'cursor-not-allowed border-line text-mute opacity-60'
                          : 'border-line text-ink-2 hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    <span className="block font-semibold leading-tight">{cl.nome}</span>
                    <RiscoDots nivel={cl.nivelRisco} className="mt-1.5" />
                  </button>
                )
              })}
            </div>
          </Card>

          <Collapse title="Premissas avançadas">
            <div className="space-y-4">
              <LiveBadge live={rates.aoVivo} referencia={rates.referencia} />
              <NumberField
                label="CDI de referência"
                value={cdi}
                onChange={v =>
                  setCdiCustom(Math.min(50, Math.max(0, Number.isFinite(v) ? v : 0)))
                }
                suffix="% a.a."
                min={0}
                max={50}
                step={0.1}
                hint="Régua da comparação sem risco: o que renderia a 100% do CDI. Default: média BCB (série SGS 4389), atualizada ao abrir o app."
              />
              <div className="flex items-center gap-1.5 pt-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-mute">
                  Retorno × volatilidade
                </span>
                <InfoTip text="Retorno nominal esperado e desvio-padrão anual de cada classe. Defaults calibrados para Selic 14% / IPCA 4,4% (ago/2026) — são premissas editáveis, não previsões." />
              </div>
              {CLASSES_ATIVO.map(cl => {
                const pr = premissas[cl.id] ?? { ret: cl.retornoAa, vol: cl.volAa }
                return (
                  <div key={cl.id}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-ink-2">{cl.nome}</span>
                      <RiscoDots nivel={cl.nivelRisco} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <NumberField
                        label="Retorno"
                        value={pr.ret}
                        onChange={v => setPremissa(cl.id, 'ret', v)}
                        suffix="% a.a."
                        min={-95}
                        max={100}
                        step={0.1}
                      />
                      <NumberField
                        label="Volatilidade"
                        value={pr.vol}
                        onChange={v => setPremissa(cl.id, 'vol', v)}
                        suffix="% a.a."
                        min={0}
                        max={150}
                        step={0.5}
                      />
                    </div>
                  </div>
                )
              })}
              <button
                type="button"
                onClick={() => {
                  setPremissas(premissasPadrao())
                  setCdiCustom(null)
                }}
                className="w-full rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                Restaurar padrões de 2026
              </button>
            </div>
          </Collapse>
        </>
      }
      results={
        <>
          <Verdict
            winner={
              temDinheiro
                ? `${foco.nome}: mediana de ${brl(stFoco.p50)} em ${anosTxt}`
                : 'Defina um valor inicial ou um aporte para simular'
            }
            detail={
              temDinheiro ? (
                <>
                  Metade dos 2.000 cenários termina acima de {brl(stFoco.p50)}. No cenário ruim
                  (p10) você teria <strong className="text-ink">{brl(stFoco.p10)}</strong>. Deixando
                  tudo no CDI ({pct(cdi, 1)} a.a.) terminaria com {brl(resultado.cdiFinal)} quase
                  certos — {foco.nome} fica atrás do CDI em{' '}
                  <strong className="text-ink">{pct(resultado.probCdi * 100, 0)}</strong> das
                  simulações. Valores nominais, antes de IR e inflação.
                </>
              ) : (
                'Ajuste o valor inicial ou o aporte mensal ao lado — a simulação roda na hora, com 2.000 futuros sorteados por classe.'
              )
            }
            tone={tom}
            badge={`2.000 cenários · ${anosTxt}`}
          />

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            <StatTile
              label="Mediana no horizonte"
              value={stFoco.p50}
              format={brl}
              tone="accent"
              sub="metade acima, metade abaixo"
            />
            <StatTile
              label="Cenário ruim (p10)"
              value={stFoco.p10}
              format={brl}
              tone={temDinheiro && stFoco.p10 < resultado.totalInvestido ? 'negative' : 'neutral'}
              sub="1 em cada 10 termina abaixo disso"
            />
            <StatTile
              label="Cenário bom (p90)"
              value={stFoco.p90}
              format={brl}
              tone="positive"
              sub="1 em cada 10 termina acima disso"
            />
            <StatTile
              label="Chance de perder do CDI"
              value={resultado.probCdi * 100}
              format={v => pct(v, 0)}
              tone={
                !temDinheiro
                  ? 'neutral'
                  : resultado.probCdi >= 0.5
                    ? 'negative'
                    : resultado.probCdi < 0.2
                      ? 'positive'
                      : 'neutral'
              }
              sub={`CDI (${pct(cdi, 1)} a.a.) daria ${brl(resultado.cdiFinal)}`}
            />
            <StatTile
              label="Chance de perda nominal"
              value={resultado.probPerda * 100}
              format={v => pct(v, 0)}
              tone={
                !temDinheiro ? 'neutral' : resultado.probPerda > 0.1 ? 'negative' : 'neutral'
              }
              sub="terminar com menos do que aportou"
            />
            <StatTile
              label="Total investido"
              value={resultado.totalInvestido}
              format={brl}
              sub={`${brl(inicial)} hoje + ${mesesTotal}× ${brl(aporte)}`}
            />
          </div>

          <Card
            title={`O leque de futuros — ${foco.nome}`}
            subtitle="80% das simulações terminam entre as linhas pessimista e otimista; a linha cheia é a mediana"
            right={
              <span className="hidden shrink-0 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[11px] font-medium text-ink-2 sm:inline-block">
                {foco.garantia}
              </span>
            }
          >
            <VFanChart
              data={resultado.fanRows}
              xKey="t"
              lowKey="p10"
              medianKey="mediana"
              highKey="p90"
              labels={{ low: 'Pessimista (p10)', median: 'Mediana', high: 'Otimista (p90)' }}
              xFormat={fmtMes}
              yFormat={brlCompact}
              height={300}
              color={corFoco}
            />
            <p className="mt-2 text-[11px] leading-relaxed text-mute">
              Cada linha é um percentil dos 2.000 caminhos sorteados. Quanto mais volátil a classe,
              mais cedo — e mais largo — o leque abre.
            </p>
          </Card>

          <Card
            title="Caminho mediano, classe a classe"
            subtitle="Linha = mediana das 2.000 simulações de cada classe selecionada"
          >
            <VLineChart
              data={resultado.medianas}
              series={idsGrafico.map((id, i) => ({
                key: id,
                name: CLASSES_ATIVO.find(c => c.id === id)?.nome ?? id,
                colorIndex: i,
              }))}
              xKey="t"
              xFormat={fmtMes}
              yFormat={brlCompact}
              height={280}
            />
            <p className="mt-2 text-[11px] leading-relaxed text-mute">
              A mediana esconde o risco: duas classes podem ter linhas parecidas e leques muito
              diferentes — confira p10 e p90 na tabela abaixo.
            </p>
          </Card>

          <Card
            title="Detalhamento por classe"
            subtitle={`Onde cada classe chega em ${anosTxt}, com ${brl(inicial)} + ${brl(aporte)}/mês`}
          >
            <DataTable
              columns={[
                'Classe',
                'Risco',
                'Garantia',
                'Pessimista (p10)',
                'Mediana',
                'Otimista (p90)',
              ]}
              align={['l', 'l', 'l', 'r', 'r', 'r']}
              rows={CLASSES_ATIVO.map(cl => {
                const st = resultado.porClasse[cl.id] ?? { p10: 0, p50: 0, p90: 0 }
                const ehFoco = cl.id === focoId
                return [
                  <span key="n" className={`flex items-center gap-1.5 ${ehFoco ? 'font-semibold text-ink' : ''}`}>
                    {cl.nome}
                    {ehFoco && (
                      <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                        em foco
                      </span>
                    )}
                  </span>,
                  <RiscoDots key="r" nivel={cl.nivelRisco} />,
                  cl.garantia,
                  brl(st.p10),
                  brl(st.p50),
                  brl(st.p90),
                ]
              })}
            />
          </Card>

          <Card title="Como ler esta simulação" subtitle="Premissas e limitações — leia antes de decidir">
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-ink-2">
              <li>
                Cada classe segue um passeio aleatório (GBM mensal) com retorno esperado e
                volatilidade fixos. São 2.000 futuros sorteados com semente fixa: os números não
                mudam entre visitas, só quando você mexe nas premissas — e todas elas são editáveis
                em &ldquo;Premissas avançadas&rdquo;.
              </li>
              <li>
                Os valores são <strong className="text-ink">nominais e brutos</strong>: não descontam
                IR, taxas nem inflação (IPCA 12m hoje: {pct(rates.ipca12m, 1)}). Em {anosTxt},{' '}
                {brl(stFoco.p50)} não compram o que compram hoje.
              </li>
              <li>
                Os retornos default foram calibrados para Selic {pct(rates.selic, 1)} / IPCA{' '}
                {pct(rates.ipca12m, 1)} (ago/2026). São premissas, não previsão — rentabilidade
                passada não garante retorno futuro.
              </li>
              <li>
                O modelo ignora crises com saltos, correlação entre classes e mudanças de juros no
                caminho: a incerteza real é <em>maior</em> do que o leque mostra, principalmente em
                ações e cripto.
              </li>
              <li>Ferramenta educacional de comparação — não é recomendação de investimento.</li>
            </ul>
          </Card>
        </>
      }
    />
  )
}
