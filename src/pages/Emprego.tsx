/**
 * Emprego.tsx — Qual proposta escolher?
 * Matriz de decisão ponderada (SMART — Edwards 1977; "weighted scoring") em 3 etapas:
 *   1) seu perfil: peso das 5 áreas × importância 1–5 de 32 critérios (estrutura da
 *      Career Choice Worksheet do usuário, pré-preenchida com o perfil da planilha);
 *   2) nota 1–5 de cada proposta em cada critério — salário, benefícios, bônus e
 *      deslocamento podem virar nota automaticamente a partir dos números reais;
 *   3) ranking com sensibilidade por área, "onde o líder perde" e área decisiva.
 * Tudo persiste em localStorage (chave valeapena-emprego-v1) — nada vai para servidor.
 *
 * Matemática (tudo em useMemo):
 *   Wn_a = W_a/ΣW (ΣW = 0 → 1/5 cada)
 *   areaScore_{o,a} = Σ_{s∈a} w_s·x_{o,s} / (5·Σ_{s∈a} w_s)              ∈ [0,2; 1]
 *   total_o = 100·Σ_a Wn_a·areaScore_{o,a}                               ∈ [20; 100]
 *   pesoEfetivo_s = Wn_a·w_s/Σ_{s∈a} w_s   (Σ_s = 1)
 *   contrib_{o,s} = 100·pesoEfetivo_s·x_{o,s}/5   (Σ_s contrib = total_o — identidade)
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Compass, Plus, RotateCcw, Trash2 } from 'lucide-react'
import {
  Card,
  Collapse,
  DataTable,
  Didatico,
  ExportBar,
  InfoTip,
  NumberField,
  SectionTitle,
  SliderField,
  StatTile,
  Toggle,
  ToolPage,
  Verdict,
} from '../components/ui'
import { VBarChart } from '../components/charts'
import { useVizColors } from '../theme'
import { num, pct } from '../lib/format'
import {
  AREAS_CARREIRA,
  CRITERIOS_CARREIRA,
  IMPORTANCIA_LABELS,
  NOTA_LABELS,
  OPCOES_PADRAO,
  type AreaId,
  type CriterioCarreira,
  type ObjetivoTipo,
} from '../lib/carreira'

/* ============================================================
   Constantes e tipos
   ============================================================ */

type Nivel = 1 | 2 | 3 | 4 | 5

const STORAGE_KEY = 'valeapena-emprego-v1'
const MAX_OPCOES = 4
const MAX_NOME = 24
const NOTA_PADRAO: Nivel = 3
const NIVEIS: Nivel[] = [1, 2, 3, 4, 5]
/** margem (pts de 100) abaixo da qual declaramos empate técnico */
const LIMIAR_EMPATE = 0.5

const AREA_CURTA: Record<AreaId, string> = {
  trabalho: 'Trabalho',
  financeiro: 'Financeiro',
  cultura: 'Cultura',
  equilibrio: 'Equilíbrio',
  empresa: 'Empresa',
}

const CRITERIOS_POR_AREA = AREAS_CARREIRA.map(area => ({
  area,
  criterios: CRITERIOS_CARREIRA.filter(c => c.area === area.id),
}))
const CRITERIO_POR_ID: Record<string, CriterioCarreira> = Object.fromEntries(
  CRITERIOS_CARREIRA.map(c => [c.id, c]),
)
const AREA_POR_ID = Object.fromEntries(AREAS_CARREIRA.map(a => [a.id, a])) as Record<
  AreaId,
  (typeof AREAS_CARREIRA)[number]
>

const FONTE_COMMUTE =
  'Stutzer & Frey 2008 ("the commuting paradox"): +1 h de trajeto por dia ≈ −0,28 ponto de satisfação com a vida — e um salário maior normalmente NÃO compensa. Na nota automática o MENOR tempo vale 5 e o maior vale 1.'
const FONTE_SALARIO =
  'Leitura log-linear (Killingsworth 2021, PNAS): o bem-estar sobe com o % de aumento, não com o valor absoluto — R$ 2 mil a mais mudam muito mais a vida de quem ganha 4 mil do que a de quem ganha 20 mil. A nota automática usa escala linear entre o menor e o maior salário; se a diferença em % for grande, reforce pela importância.'

const OBJETIVO_INFO: Record<ObjetivoTipo, { label: string; suffix: string; hint: string }> = {
  salario: { label: 'Salário líquido/mês', suffix: 'R$', hint: FONTE_SALARIO },
  beneficios: {
    label: 'Benefícios/mês',
    suffix: 'R$',
    hint: 'Plano de saúde, VR/VA, previdência, auxílios — some o valor mensal que a empresa banca por você.',
  },
  bonus: {
    label: 'Bônus e incentivos/ano',
    suffix: 'R$',
    hint: 'PLR, bônus, equity — use o valor ESPERADO (valor × chance de receber), não o teto da promessa.',
  },
  commute: { label: 'Deslocamento ida+volta', suffix: 'min/dia', hint: FONTE_COMMUTE },
}
const OBJETIVOS: ObjetivoTipo[] = ['salario', 'beneficios', 'bonus', 'commute']

type Numeros = Record<ObjetivoTipo, number | null>

interface Opcao {
  id: string
  nome: string
  /** nota manual 1–5 por critério (default 3) */
  notas: Record<string, Nivel>
  /** números reais (null = não preenchido) */
  numeros: Numeros
}

interface Estado {
  pesos: Record<AreaId, number>
  importancias: Record<string, Nivel>
  opcoes: Opcao[]
  usarNumeros: boolean
}

/* ============================================================
   Defaults, persistência e validação
   ============================================================ */

function novoId(): string {
  return `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function notasPadrao(): Record<string, Nivel> {
  return Object.fromEntries(CRITERIOS_CARREIRA.map(c => [c.id, NOTA_PADRAO]))
}

function numerosVazios(): Numeros {
  return { salario: null, beneficios: null, bonus: null, commute: null }
}

function novaOpcao(nome: string): Opcao {
  return { id: novoId(), nome, notas: notasPadrao(), numeros: numerosVazios() }
}

function estadoPadrao(): Estado {
  return {
    pesos: Object.fromEntries(AREAS_CARREIRA.map(a => [a.id, a.pesoPct])) as Record<AreaId, number>,
    importancias: Object.fromEntries(CRITERIOS_CARREIRA.map(c => [c.id, c.importancia])),
    opcoes: OPCOES_PADRAO.map(novaOpcao),
    usarNumeros: false,
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function nivel(v: unknown, fallback: Nivel): Nivel {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? (v as Nivel) : fallback
}

function numOuNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

/** Valida o shape salvo; qualquer estrutura inválida → null (usa defaults). Campos soltos são saneados. */
function sanitizar(raw: unknown): Estado | null {
  if (!isObj(raw)) return null
  const base = estadoPadrao()

  const pesosRaw = isObj(raw.pesos) ? raw.pesos : {}
  const pesos = { ...base.pesos }
  for (const a of AREAS_CARREIRA) {
    const v = pesosRaw[a.id]
    if (typeof v === 'number' && Number.isFinite(v)) pesos[a.id] = Math.min(50, Math.max(0, v))
  }

  const impRaw = isObj(raw.importancias) ? raw.importancias : {}
  const importancias = { ...base.importancias }
  for (const c of CRITERIOS_CARREIRA) importancias[c.id] = nivel(impRaw[c.id], c.importancia)

  if (!Array.isArray(raw.opcoes) || raw.opcoes.length === 0) return null
  const ids = new Set<string>()
  const opcoes: Opcao[] = []
  for (const o of raw.opcoes.slice(0, MAX_OPCOES)) {
    if (!isObj(o)) return null
    const notasRaw = isObj(o.notas) ? o.notas : {}
    const notas = notasPadrao()
    for (const c of CRITERIOS_CARREIRA) notas[c.id] = nivel(notasRaw[c.id], NOTA_PADRAO)
    const nRaw = isObj(o.numeros) ? o.numeros : {}
    let id = typeof o.id === 'string' && o.id ? o.id : novoId()
    if (ids.has(id)) id = novoId()
    ids.add(id)
    opcoes.push({
      id,
      nome: typeof o.nome === 'string' ? o.nome.slice(0, MAX_NOME) : '',
      notas,
      numeros: {
        salario: numOuNull(nRaw.salario),
        beneficios: numOuNull(nRaw.beneficios),
        bonus: numOuNull(nRaw.bonus),
        commute: numOuNull(nRaw.commute),
      },
    })
  }
  return { pesos, importancias, opcoes, usarNumeros: raw.usarNumeros === true }
}

function carregar(): Estado {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return estadoPadrao()
    return sanitizar(JSON.parse(raw)) ?? estadoPadrao()
  } catch {
    return estadoPadrao()
  }
}

function nomeExibicao(o: Opcao, i: number): string {
  return o.nome.trim() || `Proposta ${i + 1}`
}

/** Nome padrão da próxima proposta: primeira letra A–D ainda não usada (evita duas "Proposta A"). */
function nomeNovaProposta(opcoes: Opcao[]): string {
  const usados = new Set(opcoes.map((o, i) => nomeExibicao(o, i).toLowerCase()))
  const letra = ['A', 'B', 'C', 'D'].find(l => !usados.has(`proposta ${l.toLowerCase()}`))
  return `Proposta ${letra ?? opcoes.length + 1}`
}

/* ============================================================
   Motor — matriz de decisão ponderada
   ============================================================ */

interface Flip {
  area: AreaId
  /** peso normalizado (%) da área no ponto de virada */
  novo: number
  /** peso normalizado (%) hoje */
  hoje: number
  totalL: number
  totalR: number
}

interface Resultado {
  nomes: string[]
  somaPesos: number
  pesosZerados: boolean
  areasSemPeso: AreaId[]
  wn: Record<AreaId, number>
  pesoEfetivo: Record<string, number>
  /** nota efetiva por opção → critério (1–5; contínua quando automática) */
  notaEfetiva: Record<string, number>[]
  auto: Record<string, boolean>[]
  areaScore: Record<AreaId, number>[]
  contrib: Record<string, number>[]
  total: number[]
  /** índices das opções, do maior para o menor total */
  ranking: number[]
  L: number
  R: number | null
  margem: number
  notasNoPadrao: number
  totalCelulas: number
  ondeLPerde: Array<{ id: string; diff: number }>
  areaDecisiva: { id: AreaId; pts: number } | null
  flip: Flip | null
  maisPesado: { id: string; peso: number }
}

function totalComPesos(scores: Record<AreaId, number>, w: Record<AreaId, number>): number {
  return 100 * AREAS_CARREIRA.reduce((s, a) => s + w[a.id] * scores[a.id], 0)
}

function calcular(e: Estado): Resultado {
  const nomes = e.opcoes.map(nomeExibicao)

  /* pesos das áreas normalizados */
  const somaPesos = AREAS_CARREIRA.reduce((s, a) => s + e.pesos[a.id], 0)
  const pesosZerados = somaPesos <= 0
  const wn = {} as Record<AreaId, number>
  for (const a of AREAS_CARREIRA) {
    wn[a.id] = pesosZerados ? 1 / AREAS_CARREIRA.length : e.pesos[a.id] / somaPesos
  }

  /* importâncias efetivas e peso efetivo por critério (Σ = 1) */
  const areasSemPeso: AreaId[] = []
  const wEff: Record<string, number> = {}
  const pesoEfetivo: Record<string, number> = {}
  for (const { area, criterios } of CRITERIOS_POR_AREA) {
    const soma = criterios.reduce((s, c) => s + e.importancias[c.id], 0)
    const semPeso = soma <= 0
    if (semPeso) areasSemPeso.push(area.id)
    const somaEff = semPeso ? criterios.length : soma
    for (const c of criterios) {
      wEff[c.id] = semPeso ? 1 : e.importancias[c.id]
      pesoEfetivo[c.id] = (wn[area.id] * wEff[c.id]) / somaEff
    }
  }

  /* notas efetivas: manual, ou automática pelos números reais */
  const auto: Record<string, boolean>[] = e.opcoes.map(() => ({}))
  const notaEfetiva: Record<string, number>[] = e.opcoes.map(o => ({ ...o.notas }))
  if (e.usarNumeros) {
    for (const c of CRITERIOS_CARREIRA) {
      const tipo = c.objetivo
      if (!tipo) continue
      const vals = e.opcoes
        .map(o => o.numeros[tipo])
        .filter((v): v is number => v !== null && Number.isFinite(v))
      if (vals.length === 0) continue
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      e.opcoes.forEach((o, i) => {
        const v = o.numeros[tipo]
        if (v === null || !Number.isFinite(v)) return
        let x = 3
        if (vals.length >= 2 && max > min) {
          const f = (v - min) / (max - min)
          x = 1 + 4 * (tipo === 'commute' ? 1 - f : f)
        }
        notaEfetiva[i][c.id] = x
        auto[i][c.id] = true
      })
    }
  }

  /* areaScore, total e contribuições */
  const areaScore: Record<AreaId, number>[] = []
  const contrib: Record<string, number>[] = []
  const total: number[] = []
  e.opcoes.forEach((_, i) => {
    const scores = {} as Record<AreaId, number>
    let t = 0
    for (const { area, criterios } of CRITERIOS_POR_AREA) {
      let acc = 0
      let somaW = 0
      for (const c of criterios) {
        acc += wEff[c.id] * notaEfetiva[i][c.id]
        somaW += wEff[c.id]
      }
      const score = somaW > 0 ? acc / (5 * somaW) : 0.6
      scores[area.id] = score
      t += wn[area.id] * score
    }
    const cs: Record<string, number> = {}
    for (const c of CRITERIOS_CARREIRA) cs[c.id] = (100 * pesoEfetivo[c.id] * notaEfetiva[i][c.id]) / 5
    areaScore.push(scores)
    contrib.push(cs)
    total.push(Number.isFinite(t) ? 100 * t : 0)
  })

  /* notas ainda no padrão (célula manual com nota 3) */
  let notasNoPadrao = 0
  e.opcoes.forEach((o, i) => {
    for (const c of CRITERIOS_CARREIRA) if (!auto[i][c.id] && o.notas[c.id] === NOTA_PADRAO) notasNoPadrao++
  })
  const totalCelulas = e.opcoes.length * CRITERIOS_CARREIRA.length

  /* ranking */
  const ranking = e.opcoes.map((_, i) => i).sort((a, b) => total[b] - total[a] || a - b)
  const L = ranking[0]
  const R = ranking.length > 1 ? ranking[1] : null
  const margem = R === null ? 0 : total[L] - total[R]

  /* onde o líder perde */
  const ondeLPerde =
    R === null
      ? []
      : CRITERIOS_CARREIRA.map(c => ({ id: c.id, diff: contrib[R][c.id] - contrib[L][c.id] }))
          .filter(d => d.diff > 1e-9)
          .sort((a, b) => b.diff - a.diff)
          .slice(0, 5)

  /* área decisiva */
  let areaDecisiva: Resultado['areaDecisiva'] = null
  if (R !== null) {
    for (const a of AREAS_CARREIRA) {
      const pts = wn[a.id] * (areaScore[L][a.id] - areaScore[R][a.id]) * 100
      if (!areaDecisiva || pts > areaDecisiva.pts) areaDecisiva = { id: a.id, pts }
    }
  }

  /* sensibilidade: menor ajuste do peso de UMA área em que R ≥ L (outras proporcionais) */
  let flip: Flip | null = null
  if (R !== null) {
    let melhorDist = Infinity
    for (const a of AREAS_CARREIRA) {
      const hoje = wn[a.id] * 100
      const outros = 1 - wn[a.id]
      for (let w = 0; w <= 100; w++) {
        const dist = Math.abs(w - hoje)
        if (dist >= melhorDist) continue
        const pesos = {} as Record<AreaId, number>
        for (const b of AREAS_CARREIRA) {
          pesos[b.id] =
            b.id === a.id
              ? w / 100
              : outros > 1e-12
                ? ((1 - w / 100) * wn[b.id]) / outros
                : (1 - w / 100) / (AREAS_CARREIRA.length - 1)
        }
        // verificação: totais recalculados no ponto candidato
        const tL = totalComPesos(areaScore[L], pesos)
        const tR = totalComPesos(areaScore[R], pesos)
        if (tR >= tL - 1e-9) {
          melhorDist = dist
          flip = { area: a.id, novo: w, hoje, totalL: tL, totalR: tR }
        }
      }
    }
  }

  /* critério de maior peso efetivo */
  let maisPesado = { id: CRITERIOS_CARREIRA[0].id, peso: pesoEfetivo[CRITERIOS_CARREIRA[0].id] }
  for (const c of CRITERIOS_CARREIRA) {
    if (pesoEfetivo[c.id] > maisPesado.peso) maisPesado = { id: c.id, peso: pesoEfetivo[c.id] }
  }

  return {
    nomes,
    somaPesos,
    pesosZerados,
    areasSemPeso,
    wn,
    pesoEfetivo,
    notaEfetiva,
    auto,
    areaScore,
    contrib,
    total,
    ranking,
    L,
    R,
    margem,
    notasNoPadrao,
    totalCelulas,
    ondeLPerde,
    areaDecisiva,
    flip,
    maisPesado,
  }
}

/* ============================================================
   Helpers de apresentação
   ============================================================ */

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
function round2(v: number): number {
  return Math.round(v * 100) / 100
}
function fmtNota(x: number): string {
  return Number.isInteger(x) ? num(x, 0) : num(x, 1)
}
function curto(s: string, n = 14): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function EtapaTitulo({ n, children }: { n: number; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold tnum text-accent">
        {n}
      </span>
      <span>{children}</span>
    </span>
  )
}

function Aviso({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-warning/40 bg-warning-soft px-3 py-2 text-[11px] leading-relaxed text-ink-2">
      {children}
    </div>
  )
}

/** Seletor compacto 1–5 (5 botões-pílula). */
function Pills({
  value,
  onChange,
  labels,
  ariaLabel,
}: {
  value: Nivel
  onChange: (v: Nivel) => void
  labels: Record<Nivel, string>
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex shrink-0 gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5"
    >
      {NIVEIS.map(n => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          title={`${n} · ${labels[n]}`}
          onClick={() => onChange(n)}
          className={`h-7 w-7 rounded-md text-[11px] font-semibold tnum transition-colors ${
            value === n ? 'bg-accent text-accent-ink shadow-sm' : 'text-ink-2 hover:bg-surface-3 hover:text-ink'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

/** Célula read-only da nota automática. */
function NotaAuto({ x }: { x: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2 py-1"
      title="Nota calculada a partir dos números reais desta proposta"
    >
      <span className="text-xs font-semibold tnum text-ink">{fmtNota(x)}</span>
      <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-ink">auto</span>
    </span>
  )
}

/* ============================================================
   Página
   ============================================================ */

export default function Emprego() {
  const c = useVizColors()
  const [estado, setEstado] = useState<Estado>(carregar)
  const [grupoFechado, setGrupoFechado] = useState<Partial<Record<AreaId, boolean>>>({})

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(estado))
    } catch {
      /* armazenamento indisponível */
    }
  }, [estado])

  const res = useMemo(() => calcular(estado), [estado])

  /* ------------------------------ Updaters ------------------------------ */
  const setPeso = (a: AreaId, v: number) => setEstado(s => ({ ...s, pesos: { ...s.pesos, [a]: v } }))
  const setImportancia = (id: string, v: Nivel) =>
    setEstado(s => ({ ...s, importancias: { ...s.importancias, [id]: v } }))
  const patchOpcao = (idx: number, patch: (o: Opcao) => Opcao) =>
    setEstado(s => ({ ...s, opcoes: s.opcoes.map((o, i) => (i === idx ? patch(o) : o)) }))
  const setNota = (idx: number, cid: string, v: Nivel) =>
    patchOpcao(idx, o => ({ ...o, notas: { ...o.notas, [cid]: v } }))
  const setNome = (idx: number, nome: string) => patchOpcao(idx, o => ({ ...o, nome: nome.slice(0, MAX_NOME) }))
  const setNumero = (idx: number, tipo: ObjetivoTipo, v: number | null) =>
    patchOpcao(idx, o => ({ ...o, numeros: { ...o.numeros, [tipo]: v } }))
  const limparNumeros = (idx: number) => patchOpcao(idx, o => ({ ...o, numeros: numerosVazios() }))
  const addOpcao = () =>
    setEstado(s =>
      s.opcoes.length >= MAX_OPCOES
        ? s
        : { ...s, opcoes: [...s.opcoes, novaOpcao(nomeNovaProposta(s.opcoes))] },
    )
  const removeOpcao = (idx: number) =>
    setEstado(s => (s.opcoes.length <= 1 ? s : { ...s, opcoes: s.opcoes.filter((_, i) => i !== idx) }))
  const setUsarNumeros = (v: boolean) => setEstado(s => ({ ...s, usarNumeros: v }))
  /** leva à matriz de notas (#pontuar); um <a href="#…"> não rola dentro do router */
  const irParaMatriz = () => {
    const el = document.getElementById('pontuar')
    if (!el) return
    const y0 = window.scrollY
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // fallback: se a rolagem suave não começou (o Chrome a descarta logo após o carregamento), pula direto
    window.setTimeout(() => {
      if (window.scrollY === y0 && Math.abs(el.getBoundingClientRect().top) > 100) {
        el.scrollIntoView({ behavior: 'instant', block: 'start' })
      }
    }, 700)
  }
  const recomecar = () => {
    if (window.confirm('Voltar o perfil e as propostas aos padrões? As notas e os números serão apagados.')) {
      setEstado(estadoPadrao())
      setGrupoFechado({})
    }
  }

  /* ------------------------------ Derivados ------------------------------ */
  const n = estado.opcoes.length
  const { L, R, margem } = res
  const nomeL = res.nomes[L]
  const nomeR = R === null ? '' : res.nomes[R]
  const totalL = res.total[L]
  const totalR = R === null ? 0 : res.total[R]
  const empate = R !== null && margem < LIMIAR_EMPATE
  const preliminar = res.totalCelulas > 0 && res.notasNoPadrao / res.totalCelulas >= 0.5
  /** estado inicial: nenhuma nota manual dada e nenhuma célula automática */
  const nadaPontuado = res.totalCelulas > 0 && res.notasNoPadrao === res.totalCelulas
  const temNumeros = estado.opcoes.some(o => OBJETIVOS.some(t => o.numeros[t] !== null))
  const critMaisPesado = CRITERIO_POR_ID[res.maisPesado.id]
  const pesoMaisPesadoPct = res.maisPesado.peso * 100
  /** 1 ponto de nota no critério mais pesado move o total em 100·peso/5 = 20·peso */
  const notasEquivalentes = res.maisPesado.peso > 0 ? margem / (20 * res.maisPesado.peso) : 0
  const areaDec = res.areaDecisiva
  const nomeAreaDec = areaDec ? AREA_POR_ID[areaDec.id].nome : '—'
  const flip = res.flip
  const flipJaEmpatado = flip !== null && Math.abs(flip.novo - flip.hoje) < 0.5
  /** no ponto de virada o vice só alcança o líder (empate), sem ultrapassar */
  const flipSoEmpata = flip !== null && flip.totalR - flip.totalL < LIMIAR_EMPATE

  const fraseFlip: ReactNode =
    R === null ? null : flip === null ? (
      <>
        Nenhum ajuste de peso de <strong>uma</strong> área sozinha inverte o resultado: mesmo levando
        qualquer área a 0% ou a 100% (com as outras proporcionais), {nomeL} continua à frente de {nomeR}.
      </>
    ) : flipJaEmpatado ? (
      <>
        Com os pesos de hoje, {nomeL} e {nomeR} já estão praticamente empatados ({num(totalL, 1)} ×{' '}
        {num(totalR, 1)}) — qualquer nota que você mude nos critérios de maior peso decide.
      </>
    ) : (
      <>
        Se <strong>{AREA_POR_ID[flip.area].nome}</strong> pesasse <strong>{pct(flip.novo, 0)}</strong>{' '}
        (hoje {pct(flip.hoje, 0)}), <strong>{nomeR}</strong>{' '}
        {flipSoEmpata ? 'alcançaria' : 'passaria à frente de'} {nomeL}: faria {num(flip.totalR, 1)} contra{' '}
        {num(flip.totalL, 1)}. Esse é o menor ajuste de peso de uma área só que{' '}
        {flipSoEmpata ? 'empata' : 'inverte'} o ranking.
      </>
    )
  const fraseFlipTexto =
    R === null
      ? ''
      : flip === null
        ? `Nenhum ajuste de peso de UMA área sozinha inverte o resultado`
        : flipJaEmpatado
          ? `${nomeL} e ${nomeR} já estão praticamente empatados com os pesos de hoje`
          : `Se ${AREA_POR_ID[flip.area].nome} pesasse ${pct(flip.novo, 0)} (hoje ${pct(flip.hoje, 0)}), ${nomeR} ${flipSoEmpata ? 'alcançaria' : 'passaria à frente de'} ${nomeL} (${num(flip.totalR, 1)} × ${num(flip.totalL, 1)})`

  /* ------------------------------ Veredito ------------------------------ */
  let verdictWinner: ReactNode
  let verdictDetail: ReactNode
  let verdictTone: 'positive' | 'neutral'
  if (R === null) {
    verdictTone = 'neutral'
    verdictWinner = 'Adicione uma proposta para comparar'
    verdictDetail = (
      <>
        Com uma opção só ({nomeL}, <strong>{num(totalL, 1)} de 100</strong>) não há ranking. Clique
        em “Adicionar proposta” na etapa 2 — você pode comparar até {MAX_OPCOES} opções.
      </>
    )
  } else if (nadaPontuado) {
    verdictTone = 'neutral'
    verdictWinner = 'Pontue as propostas para ver o ranking'
    verdictDetail = (
      <>
        Todas as <strong>{num(res.totalCelulas)}</strong> notas ainda estão no padrão (3) — por isso{' '}
        {nomeL} e {nomeR} empatam em <strong>{num(totalL, 1)} de 100</strong>. Na etapa 2,{' '}
        <button
          type="button"
          onClick={irParaMatriz}
          className="font-semibold text-accent underline decoration-line underline-offset-2 hover:decoration-accent"
        >
          dê nota de 1 a 5 a cada critério
        </button>
        : o ranking aparece aqui na hora.
      </>
    )
  } else if (empate) {
    verdictTone = 'neutral'
    verdictWinner = (
      <>
        Empate técnico entre {nomeL} e {nomeR}
      </>
    )
    verdictDetail = (
      <>
        {nomeL} fez <strong>{num(totalL, 1)}</strong> e {nomeR} fez <strong>{num(totalR, 1)}</strong> de
        100 — diferença de {num(margem, 1)} pt, menor que {num(LIMIAR_EMPATE, 1)}.{' '}
        {res.notasNoPadrao > 0 ? (
          <>
            Pontue as <strong>{num(res.notasNoPadrao)}</strong> notas que ainda estão no padrão (3):
            é lá que está o desempate.
          </>
        ) : (
          <>Revise a importância dos critérios de maior peso — é lá que está o desempate.</>
        )}
      </>
    )
  } else {
    verdictTone = 'positive'
    verdictWinner = (
      <>
        <span className="text-accent">{nomeL}</span> é a melhor escolha para o seu perfil
      </>
    )
    verdictDetail = (
      <>
        <strong>{num(totalL, 1)} de 100</strong>, <strong>{num(margem, 1)} pts</strong> à frente de{' '}
        {nomeR} ({num(totalR, 1)}).
        {areaDec && areaDec.pts > 0.05 && (
          <>
            {' '}
            A área que mais separa as duas é <strong>{nomeAreaDec}</strong> (+{num(areaDec.pts, 1)} pts
            para {nomeL}).
          </>
        )}
        {preliminar && (
          <>
            {' '}
            Ainda há {num(res.notasNoPadrao)} de {num(res.totalCelulas)} notas no padrão — pontue-as
            para firmar o resultado.
          </>
        )}
      </>
    )
  }
  const badgeTexto = R === null ? '' : empate ? 'empate' : `+${num(margem, 1)} pts`
  const verdictBadge: ReactNode =
    R !== null && nadaPontuado ? (
      'aguardando notas'
    ) : preliminar ? (
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
        resultado preliminar{badgeTexto ? ` · ${badgeTexto}` : ''}
      </span>
    ) : (
      badgeTexto || undefined
    )

  /* ------------------------------ Gráficos ------------------------------ */
  const dadosRanking = res.ranking.map(i => ({ nome: res.nomes[i], total: round1(res.total[i]) }))
  const dadosArea = AREAS_CARREIRA.map(a => {
    const row: Record<string, number | string> = { area: AREA_CURTA[a.id] }
    estado.opcoes.forEach((_, i) => {
      row[`o${i}`] = round1(res.areaScore[i][a.id] * 100)
    })
    return row
  })
  const seriesArea = estado.opcoes.map((_, i) => ({ key: `o${i}`, name: res.nomes[i], colorIndex: i }))
  const topPesos = [...CRITERIOS_CARREIRA]
    .sort((a, b) => res.pesoEfetivo[b.id] - res.pesoEfetivo[a.id])
    .slice(0, 10)
  /* eixo numerado 1–10 (nomes completos na lista abaixo do gráfico): 10 rótulos de texto não cabem e o Recharts omitia metade */
  const dadosPeso = topPesos.map((cr, i) => ({ nome: String(i + 1), peso: round1(res.pesoEfetivo[cr.id] * 100) }))
  const critMaisLeve = CRITERIOS_CARREIRA.reduce((m, cr) => (res.pesoEfetivo[cr.id] < res.pesoEfetivo[m.id] ? cr : m))

  /* ------------------------------ Tabelas ------------------------------ */
  const linhasDetalhe: ReactNode[][] = CRITERIOS_CARREIRA.map(cr => [
    cr.nome,
    AREA_CURTA[cr.area],
    `${estado.importancias[cr.id]} · ${IMPORTANCIA_LABELS[estado.importancias[cr.id]]}`,
    pct(res.pesoEfetivo[cr.id] * 100, 1),
    ...estado.opcoes.map((_, i) => (
      <span key={i}>
        {fmtNota(res.notaEfetiva[i][cr.id])}
        {res.auto[i][cr.id] && <span className="ml-1 text-[10px] text-accent">auto</span>}
      </span>
    )),
  ])
  linhasDetalhe.push([
    <strong key="t" className="text-ink">
      Total
    </strong>,
    '',
    '',
    <strong key="p" className="text-ink">
      100,0%
    </strong>,
    ...estado.opcoes.map((_, i) => (
      <strong key={i} className="text-ink">
        {num(res.total[i], 1)}
      </strong>
    )),
  ])
  const colunasDetalhe: ReactNode[] = [
    'Critério',
    'Área',
    'Importância',
    'Peso no total',
    ...estado.opcoes.map((_, i) => `Nota · ${res.nomes[i]}`),
  ]
  const alinhaDetalhe: Array<'l' | 'r'> = ['l', 'l', 'l', 'r', ...estado.opcoes.map(() => 'r' as const)]

  const linhasPerde: ReactNode[][] =
    R === null
      ? []
      : res.ondeLPerde.map(d => {
          const cr = CRITERIO_POR_ID[d.id]
          return [
            cr.nome,
            AREA_CURTA[cr.area],
            fmtNota(res.notaEfetiva[L][d.id]),
            fmtNota(res.notaEfetiva[R][d.id]),
            `+${num(d.diff, 1)}`,
          ]
        })

  /* ------------------------------ Exportação ------------------------------ */
  const csv = {
    nome: 'matriz',
    colunas: [
      'Critério',
      'Área',
      'Importância',
      'Peso no total (%)',
      ...estado.opcoes.flatMap((_, i) => [`Nota · ${res.nomes[i]}`, `Contribuição · ${res.nomes[i]}`]),
    ],
    linhas: [
      ...CRITERIOS_CARREIRA.map(cr => [
        cr.nome,
        AREA_CURTA[cr.area],
        estado.importancias[cr.id],
        round2(res.pesoEfetivo[cr.id] * 100),
        ...estado.opcoes.flatMap((_, i) => [
          round2(res.notaEfetiva[i][cr.id]),
          round2(res.contrib[i][cr.id]),
        ]),
      ]),
      ['TOTAL', '', '', 100, ...estado.opcoes.flatMap((_, i) => ['', round2(res.total[i])])],
    ] as Array<Array<string | number>>,
  }

  const resumo = [
    'vale a pena? · Emprego — qual proposta escolher?',
    ...res.ranking.map((i, pos) => `${pos + 1}. ${res.nomes[i]} — ${num(res.total[i], 1)} de 100`),
    R === null
      ? 'Adicione uma proposta para comparar'
      : nadaPontuado
        ? 'Ainda sem notas: pontue as propostas para ver o ranking'
        : empate
          ? `Empate técnico entre ${nomeL} e ${nomeR} (diferença de ${num(margem, 1)} pt)`
          : `${nomeL} lidera por ${num(margem, 1)} pts · área decisiva: ${nomeAreaDec} (+${num(areaDec?.pts ?? 0, 1)} pts)`,
    ...(fraseFlipTexto ? [`E se: ${fraseFlipTexto}`] : []),
    `Critério que mais pesa para você: ${critMaisPesado.nome} (${pct(pesoMaisPesadoPct, 1)} do total)`,
    `${num(res.notasNoPadrao)} de ${num(res.totalCelulas)} notas ainda no padrão (3)`,
    'gerado por vale a pena? · Dexterity — valeapena-flame.vercel.app',
  ].join('\n')

  const premissas: [string, string][] = [
    ...AREAS_CARREIRA.map(
      a => [`Peso · ${a.nome}`, `${pct(estado.pesos[a.id], 0)} (normalizado ${pct(res.wn[a.id] * 100, 0)})`] as [string, string],
    ),
    ['Propostas comparadas', `${num(n)} (${res.nomes.join(', ')})`],
    ['Notas por números reais', estado.usarNumeros ? 'sim (salário, benefícios, bônus, deslocamento)' : 'não'],
    ['Notas ainda no padrão (3)', `${num(res.notasNoPadrao)} de ${num(res.totalCelulas)}`],
  ]

  /* ------------------------------ Didático ------------------------------ */
  const passos = [
    {
      t: 'Cada critério vale pontos = importância × peso da área',
      d: (
        <>
          Você disse quanto cada área pesa e quão importante é cada critério dentro dela. Juntando os
          dois, o critério que mais pesa para você hoje é <strong>{critMaisPesado.nome}</strong>:{' '}
          <strong>{pct(pesoMaisPesadoPct, 1)}</strong> do total (importância{' '}
          {estado.importancias[critMaisPesado.id]} numa área que vale{' '}
          {pct(res.wn[critMaisPesado.area] * 100, 0)}). Os {num(CRITERIOS_CARREIRA.length)} critérios
          somam 100%.
        </>
      ),
    },
    {
      t: 'Cada proposta recebe nota de 1 a 5 em cada critério',
      d: (
        <>
          Multiplicamos cada nota pelo peso do critério e somamos: <strong>{nomeL}</strong> fez{' '}
          <strong>{num(totalL, 1)} de 100</strong>
          {R !== null && (
            <>
              ; {nomeR} fez {num(totalR, 1)}
            </>
          )}
          . Nota 3 em tudo daria 60; só 5 em tudo chega a 100.
        </>
      ),
    },
    {
      t: 'O ranking reflete as SUAS prioridades de hoje',
      d: (
        <>
          Se você mudar a importância de um critério ou o peso de uma área, o resultado muda — a
          conta não sabe o que é “bom”, só o que é bom <em>para você</em>.
          {estado.usarNumeros && (
            <>
              {' '}
              Com os números reais ligados, salário, benefícios, bônus e deslocamento viraram nota
              sozinhos: o maior valor = 5, o menor = 1 (no deslocamento, o menor tempo = 5).
            </>
          )}
        </>
      ),
    },
  ]

  const analogia = (
    <>
      É um boletim escolar em que as matérias têm pesos diferentes: para você,{' '}
      {critMaisPesado.nome.toLowerCase()} vale {pct(pesoMaisPesadoPct, 1)} da média e{' '}
      {critMaisLeve.nome.toLowerCase()} vale só {pct(res.pesoEfetivo[critMaisLeve.id] * 100, 1)}.
      Uma proposta pode tirar 5 em muitas matérias leves e ainda perder para outra que tirou 4 nas
      pesadas.
    </>
  )

  const sensibilidade =
    R === null ? (
      <>Adicione uma segunda proposta: a sensibilidade compara o líder com o vice.</>
    ) : (
      <>
        {fraseFlip} A diferença de {num(margem, 1)} pts equivale a{' '}
        <strong>{num(notasEquivalentes, 1)} nota(s)</strong> no seu critério mais importante (
        {critMaisPesado.nome}).
      </>
    )

  /* ------------------------------ Render ------------------------------ */
  return (
    <ToolPage
      icon={<Compass size={20} />}
      title="Emprego: qual escolher?"
      description="Compare até 4 propostas pelo que importa para você — 5 áreas, 32 critérios, ranking com sensibilidade."
      inputs={
        <>
          <Card
            title={<EtapaTitulo n={1}>Seu perfil</EtapaTitulo>}
            subtitle="Quanto cada área pesa na sua decisão"
          >
            <SectionTitle>Peso de cada área</SectionTitle>
            <div className="space-y-4">
              {AREAS_CARREIRA.map(a => (
                <SliderField
                  key={a.id}
                  label={a.nome}
                  value={estado.pesos[a.id]}
                  onChange={v => setPeso(a.id, v)}
                  min={0}
                  max={50}
                  step={5}
                  format={v => pct(v, 0)}
                  hint={a.descricao}
                />
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-mute">Soma</span>
              <span className="inline-flex items-center gap-1.5 font-semibold tnum text-ink">
                {res.somaPesos !== 100 && <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />}
                {pct(res.somaPesos, 0)}
              </span>
            </div>
            {res.pesosZerados ? (
              <div className="mt-2">
                <Aviso>
                  Todos os pesos estão em 0% — usando pesos iguais ({pct(100 / AREAS_CARREIRA.length, 0)}{' '}
                  cada) até você ajustar.
                </Aviso>
              </div>
            ) : (
              res.somaPesos !== 100 && (
                <div className="mt-2">
                  <Aviso>
                    Os pesos somam {pct(res.somaPesos, 0)} — na conta eles são normalizados para 100% (
                    {AREAS_CARREIRA.map(a => `${AREA_CURTA[a.id]} ${pct(res.wn[a.id] * 100, 0)}`).join(
                      ' · ',
                    )}
                    ).
                  </Aviso>
                </div>
              )
            )}
            {res.areasSemPeso.length > 0 && (
              <div className="mt-2">
                <Aviso>
                  {res.areasSemPeso.map(id => AREA_POR_ID[id].nome).join(', ')}: importâncias somam 0 —
                  usando importância igual para todos os critérios da área.
                </Aviso>
              </div>
            )}
          </Card>

          <div className="px-1">
            <SectionTitle>Importância de cada critério</SectionTitle>
            <p className="text-[11px] leading-relaxed text-mute">
              1 = nenhuma · 5 = extrema — pré-preenchida com o perfil da sua planilha. Abra cada área
              para ajustar; o resultado recalcula na hora.
            </p>
          </div>
          {CRITERIOS_POR_AREA.map(({ area, criterios }) => (
            <Collapse
              key={area.id}
              title={
                <span>
                  {area.nome}{' '}
                  <span className="font-normal text-mute">
                    · {criterios.length} critérios · peso {pct(res.wn[area.id] * 100, 0)}
                  </span>
                </span>
              }
            >
              <div className="space-y-2.5">
                {criterios.map(cr => (
                  <div key={cr.id} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs leading-snug text-ink-2">
                      <span>{cr.nome}</span>
                      <InfoTip text={cr.pergunta} />
                    </span>
                    <Pills
                      value={estado.importancias[cr.id]}
                      onChange={v => setImportancia(cr.id, v)}
                      labels={IMPORTANCIA_LABELS}
                      ariaLabel={`Importância: ${cr.nome}`}
                    />
                  </div>
                ))}
              </div>
            </Collapse>
          ))}

          <button
            type="button"
            onClick={recomecar}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <RotateCcw size={13} />
            Recomeçar
          </button>
          <p className="px-1 text-[11px] leading-relaxed text-mute">
            Seu perfil e suas propostas ficam salvos só neste navegador — nada vai para servidor.
          </p>
        </>
      }
      results={
        <>
          <Verdict winner={verdictWinner} detail={verdictDetail} tone={verdictTone} badge={verdictBadge} />

          <ExportBar pagina="emprego" resumo={resumo} csv={csv} premissas={premissas} />

          {/* ---------------- Etapa 2: propostas ---------------- */}
          <div>
            <h2 className="text-sm font-semibold text-ink">
              <EtapaTitulo n={2}>Suas propostas</EtapaTitulo>
            </h2>
            <p className="mt-1 pl-8 text-xs text-mute">
              Dê um nome a cada proposta e, na tabela logo abaixo, pontue cada critério de 1 a 5.
            </p>
          </div>

          <Card title="Propostas" subtitle={`Até ${MAX_OPCOES} opções — nome curto, como “Empresa X” ou “Emprego atual”`}>
            <div className="space-y-3">
              <div>
                <Toggle
                  checked={estado.usarNumeros}
                  onChange={setUsarNumeros}
                  label="Usar números reais para salário, benefícios, bônus e deslocamento"
                />
                {/* explicação visível (um balão de InfoTip fica cortado na borda esquerda em telas de 375px) */}
                <p className="text-[11px] leading-relaxed text-mute">
                  Entre as propostas com o número preenchido, o maior valor vira nota 5 e o menor vira 1 (no
                  deslocamento, o menor tempo vale 5); todos iguais = 3. Proposta sem número mantém a nota manual.
                </p>
              </div>
              {estado.usarNumeros && !temNumeros && (
                <p className="rounded-xl bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-ink-2">
                  Preencha os números de pelo menos duas propostas: na tabela, as células de salário,
                  benefícios, bônus e deslocamento passam a mostrar a nota calculada, marcada como “auto”.
                </p>
              )}
              {estado.opcoes.map((o, i) => {
                const temNumero = OBJETIVOS.some(t => o.numeros[t] !== null)
                return (
                  <div key={o.id} className="rounded-xl border border-line p-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.series[i] }} />
                      <input
                        type="text"
                        value={o.nome}
                        maxLength={MAX_NOME}
                        placeholder={`Proposta ${i + 1}`}
                        aria-label={`Nome da proposta ${i + 1}`}
                        onChange={e => setNome(i, e.target.value)}
                        className="min-w-0 flex-1 border-b border-line bg-transparent py-1 text-sm font-semibold text-ink outline-none placeholder:text-mute focus:border-accent"
                      />
                      <span className="shrink-0 text-[11px] tnum text-mute" title="Total desta proposta (0 a 100)">
                        {num(res.total[i], 1)} / 100
                      </span>
                      <button
                        type="button"
                        onClick={() => removeOpcao(i)}
                        disabled={n <= 1}
                        title={n <= 1 ? 'Mantenha pelo menos uma proposta' : 'Remover proposta'}
                        className="shrink-0 rounded-lg p-1.5 text-mute transition-colors hover:bg-surface-2 hover:text-negative disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {estado.usarNumeros && (
                      <>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {OBJETIVOS.map(t => (
                            <NumberField
                              key={t}
                              label={OBJETIVO_INFO[t].label}
                              value={o.numeros[t] ?? NaN}
                              onChange={v => setNumero(i, t, Math.max(0, v))}
                              suffix={OBJETIVO_INFO[t].suffix}
                              hint={OBJETIVO_INFO[t].hint}
                              min={0}
                              step={t === 'commute' ? 5 : 100}
                            />
                          ))}
                        </div>
                        {temNumero && (
                          <button
                            type="button"
                            onClick={() => limparNumeros(i)}
                            className="mt-2 text-[11px] text-mute underline decoration-line underline-offset-2 hover:text-ink"
                          >
                            limpar números (voltar às notas manuais)
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
              <button
                type="button"
                onClick={addOpcao}
                disabled={n >= MAX_OPCOES}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong px-3 py-2 text-xs font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={13} />
                {n >= MAX_OPCOES ? `Máximo de ${MAX_OPCOES} propostas` : 'Adicionar proposta'}
              </button>
            </div>
          </Card>

          {/* alvo do botão “dê nota…” do veredito; scroll-mt compensa o menu fixo */}
          <div id="pontuar" className="scroll-mt-20">
            <Card
              title="Pontue cada critério de 1 a 5"
              subtitle="1 = muito ruim · 3 = ok · 5 = excelente. O % ao lado de cada critério é quanto ele pesa no total."
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-mute">
                <span>
                  <strong className="tnum text-ink">{num(res.notasNoPadrao)}</strong> de{' '}
                  <span className="tnum">{num(res.totalCelulas)}</span> notas ainda no padrão (3)
                </span>
                {preliminar && (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-ink-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
                    resultado preliminar
                  </span>
                )}
              </div>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-line bg-surface-2">
                      <th className="sticky left-0 z-20 min-w-[136px] border-r border-line bg-surface-2 px-3 py-2 text-left font-semibold text-mute sm:min-w-[200px]">
                        Critério
                      </th>
                      {estado.opcoes.map((o, i) => (
                        <th key={o.id} className="min-w-[160px] px-3 py-2 text-left font-semibold text-ink">
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.series[i] }} />
                            <span className="truncate">{res.nomes[i]}</span>
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {CRITERIOS_POR_AREA.map(({ area, criterios }) => {
                      const fechado = grupoFechado[area.id] === true
                      return (
                        <Fragment key={area.id}>
                          <tr className="border-b border-line bg-surface-2">
                            <td className="sticky left-0 z-10 border-r border-line bg-surface-2 px-3 py-2">
                              <button
                                type="button"
                                onClick={() => setGrupoFechado(g => ({ ...g, [area.id]: !fechado }))}
                                aria-expanded={!fechado}
                                className="flex items-center gap-1.5 text-left text-xs font-semibold text-ink hover:text-accent"
                              >
                                {fechado ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                                <span>
                                  {area.nome}{' '}
                                  <span className="font-normal text-mute">
                                    · peso {pct(res.wn[area.id] * 100, 0)} · {criterios.length} critérios
                                  </span>
                                </span>
                              </button>
                            </td>
                            <td colSpan={n} className="bg-surface-2 px-3 py-2 text-[11px] text-mute">
                              {fechado && (
                                <span>
                                  {estado.opcoes
                                    .map((_, i) => `${curto(res.nomes[i], 12)} ${pct(res.areaScore[i][area.id] * 100, 0)}`)
                                    .join(' · ')}
                                </span>
                              )}
                            </td>
                          </tr>
                          {!fechado &&
                            criterios.map(cr => {
                              const tipo = cr.objetivo
                              const dica = tipo === 'commute' ? `${cr.pergunta} ${FONTE_COMMUTE}` : tipo === 'salario' ? `${cr.pergunta} ${FONTE_SALARIO}` : cr.pergunta
                              return (
                                <tr key={cr.id} className="border-b border-line last:border-0">
                                  <td className="sticky left-0 z-10 max-w-[136px] border-r border-line bg-surface px-3 py-2 align-middle sm:max-w-[240px]">
                                    <div className="flex items-center gap-1.5 text-xs font-medium text-ink">
                                      <span>{cr.nome}</span>
                                      {dica !== cr.pergunta && <InfoTip text={dica} />}
                                      <span className="ml-auto shrink-0 text-[10px] tnum text-mute" title="Quanto este critério pesa no total (importância × peso da área)">
                                        {pct(res.pesoEfetivo[cr.id] * 100, 1)}
                                      </span>
                                    </div>
                                    <div className="mt-0.5 text-[11px] leading-snug text-mute">{cr.pergunta}</div>
                                  </td>
                                  {estado.opcoes.map((o, i) => (
                                    <td key={o.id} className="px-3 py-2 align-middle">
                                      {res.auto[i][cr.id] ? (
                                        <NotaAuto x={res.notaEfetiva[i][cr.id]} />
                                      ) : (
                                        <Pills
                                          value={o.notas[cr.id]}
                                          onChange={v => setNota(i, cr.id, v)}
                                          labels={NOTA_LABELS}
                                          ariaLabel={`${cr.nome} — ${res.nomes[i]}`}
                                        />
                                      )}
                                    </td>
                                  ))}
                                </tr>
                              )
                            })}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* ---------------- Etapa 3: resultado ---------------- */}
          <div>
            <h2 className="text-sm font-semibold text-ink">
              <EtapaTitulo n={3}>Resultado</EtapaTitulo>
            </h2>
            <p className="mt-1 pl-8 text-xs text-mute">
              Quem lidera, por quanto — e o que faria o ranking mudar.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatTile
              label="Total do líder"
              value={totalL}
              format={v => `${num(v, 1)} / 100`}
              sub={nomeL}
              tone="accent"
            />
            <StatTile
              label="Margem sobre o vice"
              value={margem}
              format={v => `${num(v, 1)} pts`}
              sub={R === null ? 'adicione uma proposta' : empate ? `empate técnico com ${nomeR}` : `vs ${nomeR} (${num(totalR, 1)})`}
              tone={R === null ? 'neutral' : empate ? 'neutral' : 'positive'}
            />
            <StatTile
              label={areaDec && areaDec.pts > 0.05 ? `Área decisiva · ${AREA_CURTA[areaDec.id]}` : 'Área decisiva'}
              value={areaDec ? Math.max(0, areaDec.pts) : 0}
              format={v => `+${num(v, 1)} pts`}
              sub={
                R === null
                  ? 'precisa de 2 propostas'
                  : areaDec && areaDec.pts > 0.05
                    ? `onde ${nomeL} mais abre vantagem`
                    : 'nenhuma área separa as duas'
              }
            />
            <StatTile
              label="Critérios ainda no padrão"
              value={res.notasNoPadrao}
              format={v => `${num(v)} de ${num(res.totalCelulas)}`}
              sub={preliminar ? 'metade ou mais — resultado preliminar' : 'notas ainda em 3 (Ok)'}
              tone={preliminar ? 'negative' : 'neutral'}
            />
          </div>

          <Card title="Ranking" subtitle="Total de 0 a 100 — nota 3 em tudo dá 60; o líder aparece em destaque">
            {/* largura mínima: em telas estreitas o gráfico rola dentro do card em vez de omitir rótulos do eixo */}
            <div className="overflow-x-auto">
              <div className="min-w-[440px]">
                <VBarChart
                  data={dadosRanking}
                  series={[{ key: 'total', name: 'Total' }]}
                  xKey="nome"
                  xFormat={v => curto(String(v), 13)}
                  yFormat={v => num(v, 0)}
                  height={220}
                  colorByValue={(_row, idx) => (idx === 0 ? c.series[0] : c.mute)}
                />
              </div>
            </div>
          </Card>

          <Card
            title="Por área"
            subtitle="Quanto cada proposta atinge do máximo em cada área (nota 5 em todos os critérios = 100%)"
          >
            <div className="overflow-x-auto">
              <div className="min-w-[440px]">
                <VBarChart
                  data={dadosArea}
                  series={seriesArea}
                  xKey="area"
                  yFormat={v => pct(v, 0)}
                  height={260}
                  stacked={false}
                />
              </div>
            </div>
          </Card>

          <Card
            title="O que mais pesa para você"
            subtitle="Os 10 critérios que mais pesam no total (importância × peso da área; os 32 somam 100%) — barras numeradas como a lista abaixo"
          >
            <VBarChart
              data={dadosPeso}
              series={[{ key: 'peso', name: 'Peso no total' }]}
              xKey="nome"
              yFormat={v => pct(v, 0)}
              height={240}
            />
            <ol className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-[11px] text-ink-2 sm:grid-cols-2">
              {topPesos.map((cr, i) => (
                <li key={cr.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="tnum text-mute">{i + 1}.</span> {cr.nome}
                  </span>
                  <span className="shrink-0 tnum font-semibold text-ink">{pct(res.pesoEfetivo[cr.id] * 100, 1)}</span>
                </li>
              ))}
            </ol>
          </Card>

          <Card
            title={R === null ? 'Onde o líder perde' : `Onde ${nomeL} perde`}
            subtitle={R === null ? undefined : `Critérios em que ${nomeR} supera ${nomeL} — diferença em pontos do total`}
          >
            {R === null ? (
              <p className="text-xs text-mute">Adicione uma segunda proposta para ver onde o líder perde.</p>
            ) : linhasPerde.length === 0 ? (
              <p className="text-xs text-ink-2">
                <strong>{nomeL}</strong> vence ou empata em todos os {num(CRITERIOS_CARREIRA.length)} critérios.
              </p>
            ) : (
              <DataTable
                columns={['Critério', 'Área', `Nota · ${nomeL}`, `Nota · ${nomeR}`, 'Diferença (pts)']}
                rows={linhasPerde}
                align={['l', 'l', 'r', 'r', 'r']}
              />
            )}
          </Card>

          <Card title="E se…" subtitle="O menor ajuste no peso de uma área que faria o ranking virar">
            {R === null ? (
              <p className="text-xs text-mute">Adicione uma segunda proposta para testar a sensibilidade.</p>
            ) : (
              <div className="space-y-2 text-xs leading-relaxed text-ink-2">
                <p>{fraseFlip}</p>
                <p>
                  A diferença de <strong>{num(margem, 1)} pts</strong> equivale a{' '}
                  <strong>{num(notasEquivalentes, 1)} nota(s)</strong> no seu critério mais importante (
                  {critMaisPesado.nome}, {pct(pesoMaisPesadoPct, 1)} do total — cada ponto de nota ali
                  move {num(20 * res.maisPesado.peso, 2)} pts).
                </p>
              </div>
            )}
          </Card>

          <Card
            title="Detalhamento"
            subtitle="A matriz completa: importância, peso no total (importância × peso da área) e a nota de cada proposta — os mesmos dados do CSV"
          >
            <DataTable columns={colunasDetalhe} rows={linhasDetalhe} align={alinhaDetalhe} />
          </Card>

          <Didatico passos={passos} analogia={analogia} sensibilidade={sensibilidade} />

          <Card title="Método e fontes">
            <ul className="list-disc space-y-1.5 pl-4 text-[11px] leading-relaxed text-ink-2">
              <li>
                <strong>Matriz de decisão ponderada</strong> (SMART — Edwards 1977, “How to use
                multiattribute utility measurement for social decisionmaking”; “weighted scoring”):
                pesos normalizados por área, importância 1–5 por critério, nota 1–5 por proposta;
                total = 100 × Σ peso × (Σ importância × nota ÷ 5 Σ importância). Cada critério vale
                importância × peso da área, e as contribuições somam exatamente o total (
                <a className="underline decoration-line underline-offset-2 hover:text-accent" href="https://ieeexplore.ieee.org/document/4309720" target="_blank" rel="noreferrer">IEEE SMC</a>
                ).
              </li>
              <li>
                <strong>Estrutura:</strong> 5 áreas e 32 critérios da <em>Career Choice Worksheet</em>{' '}
                do usuário, com pesos ({AREAS_CARREIRA.map(a => `${AREA_CURTA[a.id]} ${pct(a.pesoPct, 0)}`).join(', ')}) e
                importâncias pré-preenchidos com o perfil da planilha — todos editáveis.
              </li>
              <li>
                <strong>Deslocamento:</strong> Stutzer &amp; Frey 2008 — +1 h de trajeto ≈ −0,28 ponto
                de satisfação com a vida; salário maior normalmente não compensa (
                <a className="underline decoration-line underline-offset-2 hover:text-accent" href="https://www.bsfrey.ch/wp-content/uploads/2021/08/stress-that-doesnt-pay-the-commuting-paradox.pdf" target="_blank" rel="noreferrer">paper</a>
                ). Por isso a nota automática do deslocamento é invertida: menor tempo = 5.
              </li>
              <li>
                <strong>Salário:</strong> Killingsworth 2021 — o bem-estar sobe com o log da renda, ou
                seja, com o % de aumento e não com o valor absoluto (
                <a className="underline decoration-line underline-offset-2 hover:text-accent" href="https://www.pnas.org/doi/10.1073/pnas.2016976118" target="_blank" rel="noreferrer">pnas.org</a>
                ). A nota automática é linear entre o menor e o maior valor — use a importância para
                refletir o quanto um % a mais muda a sua vida.
              </li>
              <li>
                <strong>Sensibilidade:</strong> para cada área, varremos o peso de 0 a 100% (as outras
                mantêm a proporção entre si) e reportamos o menor ajuste em que o vice alcança o
                líder — os totais no ponto reportado são recalculados, não interpolados.
              </li>
              <li>
                <strong>Honestidade:</strong> a nota mede <em>aderência ao seu perfil</em>, não a
                “qualidade” da empresa. Nota 3 em tudo = 60; empate técnico abaixo de{' '}
                {num(LIMIAR_EMPATE, 1)} pt; com metade ou mais das notas no padrão o resultado é
                marcado como preliminar. Nada é enviado a servidor: seus dados ficam no seu navegador.
              </li>
            </ul>
          </Card>
        </>
      }
    />
  )
}
