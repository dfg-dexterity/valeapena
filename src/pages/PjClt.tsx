import { useMemo, useState, type ReactNode } from 'react'
import { Briefcase } from 'lucide-react'
import {
  AnimatedNumber,
  Card,
  Collapse,
  DataTable,
  Didatico,
  ExportBar,
  InfoTip,
  NumberField,
  Segmented,
  SliderField,
  StatTile,
  ToolPage,
  Verdict,
} from '../components/ui'
import { VLineChart } from '../components/charts'
import { brl, brlCents, brlCompact, num, pct } from '../lib/format'
import {
  FGTS_ALIQUOTA,
  MEI_DAS_SERVICOS_2026,
  MEI_LIMITE_ANUAL_2026,
  SALARIO_MINIMO_2026,
  SIMPLES_ANEXO_III,
  SIMPLES_ANEXO_V,
  aliquotaEfetivaSimples,
  inssClt,
  inssProLabore,
  irDividendosMes,
  irrf2026,
  type FaixaSimples,
} from '../lib/tax2026'

/* ============================ modelo ============================ */

/** 22 dias úteis × 8h — base do valor da hora. */
const HORAS_MES = 176
/** semanas por mês (365,25 ÷ 12 ÷ 7). */
const SEMANAS_MES = 4.345
/** teto de busca do ponto de equilíbrio. */
const FATURAMENTO_MAX_BUSCA = 1_000_000

type ProLaboreModo = 'minimo' | 'fatorR' | 'custom'
type RegimePj = 'simples' | 'mei'
type Modalidade = 'presencial' | 'hibrido' | 'remoto' | 'outro'

function modalidadeDe(dias: number): Modalidade {
  if (dias === 5) return 'presencial'
  if (dias === 3) return 'hibrido'
  if (dias === 0) return 'remoto'
  return 'outro'
}

function diasDe(m: Modalidade): number {
  return m === 'presencial' ? 5 : m === 'hibrido' ? 3 : 0
}

/** INSS progressivo + IRRF 2026 (com redutor da Lei 15.270/2025) de um mês CLT. */
function mesClt(bruto: number, dependentes: number) {
  const inss = inssClt(bruto)
  const irrf = irrf2026(bruto, { inss, dependentes })
  return { inss, irrf, liquido: bruto - inss - irrf }
}

interface Desloc {
  horasMes: number
  dinheiroMes: number
}

function calculaDesloc(diasSemana: number, minutosDia: number, custoDia: number): Desloc {
  const d = Math.max(0, diasSemana)
  return {
    horasMes: d * SEMANAS_MES * (Math.max(0, minutosDia) / 60),
    dinheiroMes: d * SEMANAS_MES * Math.max(0, custoDia),
  }
}

interface PjInputs {
  regime: RegimePj
  plModo: ProLaboreModo
  plCustom: number
  feriasDias: number
  contador: number
  outrosCustos: number
  planoSaude: number
  dependentes: number
  desloc: Desloc
  /** custo extra mensal de trabalhar de casa (energia, internet…) */
  homeOfficeMes: number
}

function calculaPj(faturamento: number, p: PjInputs) {
  const fat = Math.max(0, Number.isFinite(faturamento) ? faturamento : 0)
  // férias sem faturar: cada dia parado é receita que não entra
  const fatEfetivo = fat * (1 - Math.min(365, Math.max(0, p.feriasDias)) / 365)
  const rbt12 = fatEfetivo * 12

  // MEI: acima do teto anual você é desenquadrado — a conta cai
  // automaticamente no Simples com pró-labore mínimo
  const desenquadrado = p.regime === 'mei' && rbt12 > MEI_LIMITE_ANUAL_2026
  const regimeEfetivo: RegimePj = p.regime === 'mei' && !desenquadrado ? 'mei' : 'simples'
  const plModoEfetivo: ProLaboreModo = p.regime === 'mei' ? 'minimo' : p.plModo

  let proLabore = 0
  let fatorR = 0
  let anexoIII = false
  let aliquota = 0
  let das = MEI_DAS_SERVICOS_2026
  let inssPl = 0
  let irrfPl = 0
  if (regimeEfetivo === 'simples') {
    proLabore =
      plModoEfetivo === 'minimo'
        ? SALARIO_MINIMO_2026
        : plModoEfetivo === 'fatorR'
          ? Math.max(SALARIO_MINIMO_2026, 0.28 * fat)
          : Math.max(0, p.plCustom)
    fatorR = rbt12 > 0 ? (proLabore * 12) / rbt12 : 1
    anexoIII = fatorR >= 0.28
    aliquota = aliquotaEfetivaSimples(rbt12, anexoIII ? SIMPLES_ANEXO_III : SIMPLES_ANEXO_V)
    das = aliquota * fatEfetivo
    inssPl = inssProLabore(proLabore)
    irrfPl = irrf2026(proLabore, { inss: inssPl, dependentes: p.dependentes })
  }
  const plLiquido = proLabore - inssPl - irrfPl
  // sobra distribuível = receita − DAS − pró-labore − despesas da empresa
  const sobra = fatEfetivo - das - proLabore - p.contador - p.outrosCustos
  // MEI: retiradas sem IR na prática (32% do faturamento de serviços é lucro
  // isento; o restante fica abaixo da isenção de R$ 5 mil/mês dentro do teto)
  const irDiv = regimeEfetivo === 'mei' ? 0 : sobra > 0 ? irDividendosMes(sobra) : 0
  const dividendosLiquidos = sobra - irDiv
  const liquidoBolso = plLiquido + dividendosLiquidos - p.planoSaude
  const valorHora = liquidoBolso > 0 ? liquidoBolso / HORAS_MES : 0
  const custoDesloc = p.desloc.horasMes * valorHora + p.desloc.dinheiroMes
  const final = liquidoBolso - custoDesloc - p.homeOfficeMes
  const horaEfetiva =
    (liquidoBolso - p.desloc.dinheiroMes - p.homeOfficeMes) / (HORAS_MES + p.desloc.horasMes)
  return {
    regimeEfetivo,
    desenquadrado,
    fatEfetivo,
    rbt12,
    proLabore,
    fatorR,
    anexoIII,
    aliquota,
    das,
    inssPl,
    irrfPl,
    plLiquido,
    sobra,
    irDiv,
    dividendosLiquidos,
    liquidoBolso,
    custoDesloc,
    final,
    horaEfetiva,
  }
}

/* ===================== helpers de exibição ===================== */

const menos = (v: number) => (v > 0 ? brlCents(-v) : brlCents(0))
const mais = (v: number) => (v > 0 ? `+${brlCents(v)}` : brlCents(0))
const forte = (n: ReactNode) => <span className="font-semibold text-ink">{n}</span>

const OPCOES_MODALIDADE: Array<{ value: Modalidade; label: ReactNode }> = [
  { value: 'presencial', label: 'Presencial 5d' },
  { value: 'hibrido', label: 'Híbrido 3d' },
  { value: 'remoto', label: 'Remoto' },
]

/** Tabela de um anexo do Simples com a faixa atual destacada. */
function TabelaAnexo({
  titulo,
  faixas,
  ativa,
  rbt12,
}: {
  titulo: ReactNode
  faixas: FaixaSimples[]
  /** true quando a simulação atual tributa por este anexo */
  ativa: boolean
  rbt12: number
}) {
  const idx = Math.max(
    0,
    faixas.findIndex(f => rbt12 <= f.ate) === -1 ? faixas.length - 1 : faixas.findIndex(f => rbt12 <= f.ate),
  )
  const rows = faixas.map((f, i) => {
    const de = i === 0 ? 0 : faixas[i - 1].ate
    const destaque = ativa && i === idx
    const wrap = (t: ReactNode) =>
      destaque ? <strong className="text-accent">{t}</strong> : <span>{t}</span>
    return [
      wrap(`${i + 1}ª${destaque ? ' ◂' : ''}`),
      wrap(i === 0 ? `até ${brlCompact(f.ate)}` : `${brlCompact(de)} a ${brlCompact(f.ate)}`),
      wrap(pct(f.aliquota * 100, 1)),
      wrap(brl(f.deduzir)),
    ]
  })
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold text-ink">{titulo}</h4>
      <DataTable
        columns={['Faixa', 'Receita bruta 12m', 'Alíq. nominal', 'A deduzir']}
        rows={rows}
        align={['l', 'l', 'r', 'r']}
      />
    </div>
  )
}

/* ============================ página ============================ */

export default function PjClt() {
  // CLT
  const [salario, setSalario] = useState(10000)
  const [vrva, setVrva] = useState(800)
  const [planoEmpresa, setPlanoEmpresa] = useState(600)
  const [outrosBeneficios, setOutrosBeneficios] = useState(0)
  const [dependentes, setDependentes] = useState(0)
  // PJ
  const [faturamento, setFaturamento] = useState(13000)
  const [regime, setRegime] = useState<RegimePj>('simples')
  const [plModo, setPlModo] = useState<ProLaboreModo>('fatorR')
  const [plCustom, setPlCustom] = useState(3000)
  const [planoPj, setPlanoPj] = useState(800)
  const [feriasDias, setFeriasDias] = useState(30)
  const [contador, setContador] = useState(250)
  const [outrosCustos, setOutrosCustos] = useState(0)
  // deslocamento e home office
  const [diasClt, setDiasClt] = useState(5)
  const [diasPj, setDiasPj] = useState(0)
  const [minutosDia, setMinutosDia] = useState(90)
  const [custoTransporteDia, setCustoTransporteDia] = useState(20)
  const [custoHomeDia, setCustoHomeDia] = useState(10)

  const calc = useMemo(() => {
    /* ---------- CLT ---------- */
    const normal = mesClt(salario, dependentes)
    // mês das férias: salário + ⅓, tributado junto (simplificação)
    const mesFerias = mesClt(salario * (4 / 3), dependentes)
    // 13º: INSS e IRRF calculados à parte — o redutor da Lei 15.270/2025 vale
    const dec13 = mesClt(salario, dependentes)
    const liquidoAnual = 11 * normal.liquido + mesFerias.liquido + dec13.liquido
    const liquidoMedio = liquidoAnual / 12
    const beneficios = Math.max(0, vrva) + Math.max(0, planoEmpresa) + Math.max(0, outrosBeneficios)
    const cltPreDesloc = liquidoMedio + beneficios
    const dClt = calculaDesloc(diasClt, minutosDia, custoTransporteDia)
    const valorHoraClt = cltPreDesloc > 0 ? cltPreDesloc / HORAS_MES : 0
    const custoDeslocClt = dClt.horasMes * valorHoraClt + dClt.dinheiroMes
    // dias de home office por semana (semana útil de 5 dias) × custo extra/dia
    const diasCasa = (noEscritorio: number) => Math.max(0, 5 - Math.min(5, Math.max(0, noEscritorio)))
    const homeClt = diasCasa(diasClt) * SEMANAS_MES * Math.max(0, custoHomeDia)
    const homePj = diasCasa(diasPj) * SEMANAS_MES * Math.max(0, custoHomeDia)
    const cltFinal = cltPreDesloc - custoDeslocClt - homeClt
    const horaEfetivaClt = (cltPreDesloc - dClt.dinheiroMes - homeClt) / (HORAS_MES + dClt.horasMes)
    // FGTS: 8% sobre 12 salários + 13º + ⅓ férias ≈ 13,33 salários/ano
    const fgtsAnual = FGTS_ALIQUOTA * Math.max(0, salario) * (13 + 1 / 3)
    const extraMedia = liquidoMedio - normal.liquido

    /* ---------- PJ ---------- */
    const dPj = calculaDesloc(diasPj, minutosDia, custoTransporteDia)
    const pjInputs: PjInputs = {
      regime,
      plModo,
      plCustom,
      feriasDias,
      contador,
      outrosCustos,
      planoSaude: Math.max(0, planoPj),
      dependentes,
      desloc: dPj,
      homeOfficeMes: homePj,
    }
    const pj = calculaPj(faturamento, pjInputs)

    /* ---------- ponto de equilíbrio (menor faturamento estável) ---------- */
    // A curva do líquido PJ tem degraus para BAIXO (perda do Fator R e IR de
    // dividendos acima de R$ 50 mil de sobra), então pode cruzar o CLT mais de
    // uma vez. Procuramos o ÚLTIMO cruzamento: acima dele o PJ fica ≥ CLT para
    // qualquer faturamento — varredura decrescente em grade fina + bisseção.
    let breakEven: number | null
    if (calculaPj(FATURAMENTO_MAX_BUSCA, pjInputs).final < cltFinal) {
      breakEven = null
    } else {
      const passo = 250
      let lo = -1 // maior faturamento da grade com PJ abaixo do CLT
      for (let f = FATURAMENTO_MAX_BUSCA - passo; f >= 0; f -= passo) {
        if (calculaPj(f, pjInputs).final < cltFinal) {
          lo = f
          break
        }
      }
      if (lo < 0) {
        breakEven = 0 // até faturamento zero o PJ já iguala ou vence o CLT
      } else {
        let hi = lo + passo
        for (let i = 0; i < 60; i++) {
          const mid = (lo + hi) / 2
          if (calculaPj(mid, pjInputs).final >= cltFinal) hi = mid
          else lo = mid
        }
        breakEven = (lo + hi) / 2
      }
    }

    /* ---------- curva líquido PJ × faturamento ---------- */
    const f0 = Math.max(500, faturamento * 0.5)
    const f1 = Math.max(f0 + 1000, faturamento * 2)
    const pontos = 40
    const chart: Array<{ fat: number; pj: number }> = []
    for (let i = 0; i <= pontos; i++) {
      const f = f0 + ((f1 - f0) * i) / pontos
      chart.push({ fat: Math.round(f), pj: Math.round(calculaPj(f, pjInputs).final) })
    }

    const diff = pj.final - cltFinal
    // "% a mais" do vencedor, relativa ao lado que PERDE (CLT 8k × PJ 10k → PJ tem 25% a mais)
    const perdedor = diff > 0 ? cltFinal : pj.final
    const diffPct = perdedor > 1e-9 ? (Math.abs(diff) / perdedor) * 100 : Number.NaN
    const empate = Math.abs(diff) < Math.max(100, Math.abs(cltFinal) * 0.02)

    return {
      normal,
      dec13,
      extraMedia,
      liquidoMedio,
      beneficios,
      cltPreDesloc,
      dClt,
      custoDeslocClt,
      homeClt,
      homePj,
      cltFinal,
      horaEfetivaClt,
      fgtsAnual,
      pj,
      breakEven,
      chart,
      diff,
      diffPct,
      empate,
    }
  }, [
    salario,
    dependentes,
    vrva,
    planoEmpresa,
    outrosBeneficios,
    diasClt,
    diasPj,
    minutosDia,
    custoTransporteDia,
    custoHomeDia,
    faturamento,
    regime,
    plModo,
    plCustom,
    feriasDias,
    contador,
    outrosCustos,
    planoPj,
  ])

  const { pj, cltFinal, diff, diffPct, empate, breakEven } = calc
  const anexoTxt = pj.anexoIII ? 'Anexo III' : 'Anexo V'
  const ehMei = pj.regimeEfetivo === 'mei'
  const regimeTxt = ehMei ? 'no MEI' : `no Simples (${anexoTxt})`
  const pjVence = diff > 0
  const pctTxt = Number.isFinite(diffPct) ? ` — ${pct(diffPct)} a mais` : ''

  /* ---------- textos do veredito ---------- */
  const verdictWinner = empate
    ? 'Empate técnico entre PJ e CLT'
    : pjVence
      ? `PJ vence: ${brl(diff)} a mais por mês`
      : `CLT vence: ${brl(-diff)} a mais por mês`
  const verdictDetail = empate
    ? `A diferença é de só ${brlCents(Math.abs(diff))}/mês. Com números tão próximos, decida por estabilidade, liquidez do FGTS e apetite a risco — não pela planilha.`
    : pjVence
      ? `Faturando ${brl(faturamento)} ${regimeTxt}, sobram ${brl(pj.final)}/mês contra ${brl(cltFinal)} do pacote CLT${pctTxt} — já contando benefícios, 13º, férias, deslocamento e home office.`
      : `O pacote CLT entrega ${brl(cltFinal)}/mês contra ${brl(pj.final)} do PJ faturando ${brl(faturamento)} ${regimeTxt}${pctTxt} — já contando benefícios, 13º, férias, deslocamento e home office.`

  /* ---------- exportação (R3.7) ---------- */
  const r2 = (v: number) => Math.round(v * 100) / 100
  const modalidadeTxt = (d: number) =>
    d === 5 ? 'presencial (5 d/sem)' : d === 3 ? 'híbrido (3 d/sem)' : d === 0 ? 'remoto' : `${num(d)} d/sem`
  const regimeLabel = ehMei
    ? 'MEI (DAS fixo)'
    : pj.desenquadrado
      ? 'MEI acima do teto → Simples Nacional'
      : `Simples Nacional (${anexoTxt})`
  const plModoTxt =
    regime === 'mei' || pj.desenquadrado
      ? 'mínimo legal'
      : plModo === 'minimo'
        ? 'mínimo legal'
        : plModo === 'fatorR'
          ? '28% do faturamento'
          : 'valor definido'
  const fatorRTxt = pct(Math.min(pj.fatorR, 9.99) * 100, 0)

  const premissas: [string, string][] = [
    ['Salário bruto CLT', brl(salario)],
    ['VR/VA por mês', brl(vrva)],
    ['Plano de saúde (empresa paga)', brl(planoEmpresa)],
    ['Outros benefícios', brl(outrosBeneficios)],
    ['Dependentes (IR)', num(dependentes)],
    ['Faturamento PJ', `${brl(faturamento)}/mês`],
    ['Regime da PJ', regimeLabel],
    ['Pró-labore', ehMei ? 'sem pró-labore (MEI)' : `${brlCents(pj.proLabore)} (${plModoTxt})`],
    ['Plano de saúde (PJ, do bolso)', brl(planoPj)],
    ['Férias sem faturar', `${num(feriasDias)} dias/ano`],
    ['Contador', `${brl(contador)}/mês`],
    ['Outros custos PJ', `${brl(outrosCustos)}/mês`],
    ['Modalidade — CLT', modalidadeTxt(diasClt)],
    ['Modalidade — PJ', modalidadeTxt(diasPj)],
    ['Trajeto porta a porta', `${num(minutosDia)} min/dia`],
    ['Custo de transporte', `${brl(custoTransporteDia)}/dia`],
    ['Custo do home office', `${brl(custoHomeDia)}/dia`],
  ]

  // os dois waterfalls lado a lado: linha · CLT · PJ ('' = não se aplica)
  const csvLinhas: (string | number)[][] = [
    ['Bruto (salário CLT · faturamento PJ médio após férias)', r2(salario), r2(pj.fatEfetivo)],
    ['INSS (salário · pró-labore)', -r2(calc.normal.inss), -r2(pj.inssPl)],
    ['IRRF (salário · pró-labore)', -r2(calc.normal.irrf), -r2(pj.irrfPl)],
    [ehMei ? 'DAS — MEI (guia fixa)' : `DAS — Simples ${anexoTxt} (${pct(pj.aliquota * 100, 2)})`, '', -r2(pj.das)],
    ['IR sobre dividendos', '', -r2(pj.irDiv)],
    ['13º + ⅓ de férias (média/mês)', r2(calc.extraMedia), ''],
    ['Benefícios (VR/VA, saúde, outros)', r2(calc.beneficios), ''],
    ['Contador', '', -r2(contador)],
    ['Outros custos PJ', '', -r2(outrosCustos)],
    ['Plano de saúde (do bolso)', '', -r2(planoPj)],
    ['Líquido antes de trajeto e home office', r2(calc.cltPreDesloc), r2(pj.liquidoBolso)],
    ['Deslocamento (tempo + transporte)', -r2(calc.custoDeslocClt), -r2(pj.custoDesloc)],
    ['Home office (energia, internet…)', -r2(calc.homeClt), -r2(calc.homePj)],
    ['Total comparável/mês', r2(cltFinal), r2(pj.final)],
  ]

  const resumo = [
    'PJ × CLT — vale a pena?',
    verdictWinner,
    `CLT: pacote comparável de ${brl(cltFinal)}/mês (bruto ${brl(salario)} − INSS ${brlCents(
      calc.normal.inss,
    )} − IRRF ${brlCents(calc.normal.irrf)} + 13º/férias + benefícios − trajeto e home office)`,
    `PJ: ${brl(pj.final)}/mês líquidos faturando ${brl(faturamento)} ${regimeTxt}${
      ehMei ? ` (DAS fixo de ${brlCents(pj.das)})` : ` (alíquota efetiva de ${pct(pj.aliquota * 100, 2)})`
    }`,
    breakEven === null
      ? 'Faturamento de equilíbrio: acima de R$ 1 mi/mês'
      : `Faturamento de equilíbrio: ${brl(breakEven)}/mês`,
    `FGTS + 13º líquido no ano (só o CLT tem): ${brl(calc.fgtsAnual + calc.dec13.liquido)}`,
    'gerado por vale a pena? · Dexterity — valeapena-flame.vercel.app',
  ].join('\n')

  /* ---------- didática (R3.3) ---------- */
  const deslocTempoClt = calc.custoDeslocClt - calc.dClt.dinheiroMes
  const passoRegime =
    ehMei
      ? {
          t: `MEI: guia fixa de ${brlCents(pj.das)}, dê o que der o faturamento`,
          d: (
            <>
              No MEI você não paga imposto por porcentagem: é uma guia única de {forte(brlCents(pj.das))} por
              mês, valendo para qualquer faturamento até {brl(MEI_LIMITE_ANUAL_2026)}/ano. Sobre a sua receita
              média de {brlCents(pj.fatEfetivo)}, isso equivale a uma alíquota de só{' '}
              {forte(pct((pj.das / pj.fatEfetivo) * 100, 2))} — por isso, dentro do teto, o MEI quase sempre
              ganha do Simples.
            </>
          ),
        }
      : pj.desenquadrado
        ? {
            t: 'Você estourou o teto do MEI — a conta virou Simples',
            d: (
              <>
                Faturando {brl(faturamento)}/mês você passa do teto de {brl(MEI_LIMITE_ANUAL_2026)}/ano do MEI
                e é desenquadrado. O cálculo já usa o Simples Nacional com pró-labore mínimo de{' '}
                {brlCents(pj.proLabore)}: Fator R de {fatorRTxt}, {anexoTxt}, alíquota efetiva de{' '}
                {forte(pct(pj.aliquota * 100, 2))} — {brlCents(pj.das)} de DAS por mês.
              </>
            ),
          }
        : pj.anexoIII
          ? {
              t: `Fator R: por que seu imposto é de ${pct(pj.aliquota * 100, 2)}`,
              d: (
                <>
                  O Fator R compara o pró-labore com a receita: {brlCents(pj.proLabore)} × 12 ÷{' '}
                  {brl(pj.rbt12)} = {forte(pct(pj.fatorR * 100, 0))}. Como deu 28% ou mais, sua empresa
                  tributa pelo {forte('Anexo III')}, com alíquota efetiva de{' '}
                  {forte(pct(pj.aliquota * 100, 2))} — {brlCents(pj.das)} de DAS por mês. Com um pró-labore
                  abaixo de 28% da receita, a mesma empresa cairia no Anexo V, que começa em 15,5%.
                </>
              ),
            }
          : {
              t: `Fator R abaixo de 28%: você caiu no Anexo V (${pct(pj.aliquota * 100, 2)})`,
              d: (
                <>
                  Seu pró-labore de {brlCents(pj.proLabore)} é só {forte(fatorRTxt)} da receita de 12 meses (
                  {brl(pj.rbt12)}) — abaixo de 28%, a empresa tributa pelo {forte('Anexo V')}, com alíquota
                  efetiva de {forte(pct(pj.aliquota * 100, 2))} ({brlCents(pj.das)}/mês de DAS). Subir o
                  pró-labore para 28% do faturamento ({brlCents(0.28 * faturamento)}) mudaria para o Anexo
                  III, que começa em 6% — muitas vezes o INSS extra compensa.
                </>
              ),
            }

  const passosDidatico = [
    {
      t: 'O bruto engana — dos dois lados',
      d: (
        <>
          No CLT, dos {brl(salario)} brutos saem {brlCents(calc.normal.inss)} de INSS e{' '}
          {brlCents(calc.normal.irrf)} de IRRF todo mês. No PJ, a nota de {brl(faturamento)} também encolhe:{' '}
          {brlCents(pj.das)} de DAS
          {!ehMei && <>, {brlCents(pj.inssPl + pj.irrfPl)} de INSS/IRRF sobre o pró-labore</>}
          {pj.irDiv > 0 && <>, {brlCents(pj.irDiv)} de IR sobre dividendos</>}, {brl(contador)} de contador e{' '}
          {brl(planoPj)} de plano de saúde que ninguém paga por você — além de {num(feriasDias)} dias de
          férias sem receber. A comparação justa é bolso contra bolso:{' '}
          {forte(`${brl(cltFinal)} × ${brl(pj.final)}`)} por mês.
        </>
      ),
    },
    passoRegime,
    {
      t: 'O custo invisível do trajeto',
      d: (
        <>
          Indo {num(diasClt)} {diasClt === 1 ? 'dia' : 'dias'} por semana ao escritório, o CLT gasta{' '}
          {forte(`${brlCents(calc.custoDeslocClt)}/mês`)} com deslocamento: {brlCents(calc.dClt.dinheiroMes)}{' '}
          de transporte + {num(calc.dClt.horasMes)} horas de trajeto que valem {brlCents(deslocTempoClt)} pelo
          valor da sua hora. Como PJ ({num(diasPj)} {diasPj === 1 ? 'dia' : 'dias'} por semana), o trajeto
          custa {brlCents(pj.custoDesloc)}/mês. Esse dinheiro não aparece no contracheque — mas sai do seu
          bolso e da sua vida do mesmo jeito.
        </>
      ),
    },
    {
      t: 'FGTS e 13º são patrimônio que o PJ não tem',
      d: (
        <>
          Fora do mês a mês, o CLT ainda deposita {forte(brl(calc.fgtsAnual))} de FGTS por ano (8% sobre
          ~13,3 salários) e paga um 13º líquido de {brlCents(calc.dec13.liquido)} — juntos,{' '}
          {forte(`${brl(calc.fgtsAnual + calc.dec13.liquido)}/ano`)} que se acumulam sozinhos. O 13º já está
          diluído no líquido mensal acima; o FGTS não entra na conta — é um colchão extra que o PJ só tem se
          separar o dinheiro todo mês, por conta própria.
        </>
      ),
    },
  ]

  const analogiaDidatico = (
    <>
      Pense em duas caixas de leite de tamanhos diferentes: a do PJ ({brl(faturamento)}) parece bem maior que
      a do CLT ({brl(salario)}), mas cada uma derrama uma parte no caminho até o copo — impostos, contador,
      plano de saúde, férias sem receber, trajeto. O que importa é o que chega ao copo:{' '}
      {forte(brl(cltFinal))} no CLT e {forte(brl(pj.final))} no PJ.
    </>
  )

  const sensibilidadeDidatico =
    breakEven === null ? (
      <>
        Com esses custos e deslocamento, nem R$ 1 milhão/mês de faturamento empataria com o pacote CLT — aqui
        quem decide não é a receita, são os custos fixos do PJ. Revise contador, plano de saúde e dias de
        férias.
      </>
    ) : breakEven === 0 ? (
      <>
        O pacote CLT comparável está zerado ou negativo — qualquer faturamento PJ já vence. Mexa no salário ou
        no deslocamento do lado CLT para ver o jogo virar.
      </>
    ) : (
      <>
        O número que vira o jogo é o faturamento: a partir de {forte(`${brl(breakEven)}/mês`)} o PJ fica na
        frente desse pacote CLT para qualquer valor maior.{' '}
        {faturamento >= breakEven
          ? `Você informou ${brl(faturamento)} — uma folga de ${brl(faturamento - breakEven)}/mês acima do empate.`
          : pjVence
            ? `Com ${brl(faturamento)} o PJ já vence hoje, mas um degrau do Simples ou do IR de dividendos pode derrubar a vantagem antes de ${brl(breakEven)}.`
            : `Com ${brl(faturamento)}, faltam ${brl(breakEven - faturamento)}/mês para o PJ empatar.`}
      </>
    )

  /* ---------- waterfalls ---------- */
  const rowsClt: ReactNode[][] = [
    ['Salário bruto', brlCents(salario)],
    ['INSS (progressivo por faixa)', menos(calc.normal.inss)],
    [
      <span key="ir" className="inline-flex items-center gap-1.5">
        IRRF
        <InfoTip text="Tabela progressiva 2026 com o redutor da Lei 15.270/2025: isenção efetiva até R$ 5.000 de salário e desconto parcial até R$ 7.350." />
      </span>,
      menos(calc.normal.irrf),
    ],
    [forte('Líquido do mês'), forte(brlCents(calc.normal.liquido))],
    [
      <span key="13" className="inline-flex items-center gap-1.5">
        13º + ⅓ de férias (média/mês)
        <InfoTip text="13º tributado à parte (INSS e IRRF próprios — o redutor da Lei 15.270/2025 também vale). O ⅓ de férias entra junto com o salário do mês, tributado como um mês normal (simplificação)." />
      </span>,
      mais(calc.extraMedia),
    ],
    ['Benefícios (VR/VA, saúde, outros)', mais(calc.beneficios)],
    ['Deslocamento (tempo + transporte)', menos(calc.custoDeslocClt)],
    ['Home office (energia, internet…)', menos(calc.homeClt)],
    [forte('Total comparável/mês'), forte(brlCents(cltFinal))],
  ]

  const rowsPj: ReactNode[][] = [
    [
      <span key="fat" className="inline-flex items-center gap-1.5">
        Faturamento médio (após férias)
        <InfoTip
          text={`PJ não tem férias remuneradas: ${num(feriasDias)} dias parados reduzem a receita média para ${brlCents(pj.fatEfetivo)} (${brl(faturamento)} × (1 − ${num(feriasDias)}/365)).`}
        />
      </span>,
      brlCents(pj.fatEfetivo),
    ],
    ...(ehMei
      ? ([
          [
            <span key="dasmei" className="inline-flex items-center gap-1.5">
              DAS — MEI (fixo)
              <InfoTip text="Guia mensal fixa do MEI de serviços em 2026: 5% do salário mínimo (INSS) + R$ 5,00 de ISS = R$ 86,05, independente do faturamento dentro do teto." />
            </span>,
            menos(pj.das),
          ],
          [
            <span key="ret" className="inline-flex items-center gap-1.5">
              IR sobre retiradas
              <InfoTip text="Na prática, zero: 32% do faturamento de serviços é lucro isento (presunção), e o restante — dentro do teto do MEI — fica abaixo da isenção mensal de R$ 5.000 da Lei 15.270/2025." />
            </span>,
            brlCents(0),
          ],
        ] as ReactNode[][])
      : ([
          [`DAS — Simples ${anexoTxt} (${pct(pj.aliquota * 100)})`, menos(pj.das)],
          ['INSS s/ pró-labore (11%)', menos(pj.inssPl)],
          ['IRRF s/ pró-labore', menos(pj.irrfPl)],
          [
            <span key="div" className="inline-flex items-center gap-1.5">
              IR s/ dividendos
              <InfoTip text="Lei 15.270/2025: dividendos ficam isentos até R$ 50 mil/mês por sócio na mesma empresa; acima disso, 10% na fonte sobre o total do mês." />
            </span>,
            menos(pj.irDiv),
          ],
        ] as ReactNode[][])),
    ['Contador', menos(contador)],
    ['Outros custos PJ', menos(outrosCustos)],
    ['Plano de saúde (do bolso)', menos(planoPj)],
    [forte('Líquido no bolso'), forte(brlCents(pj.liquidoBolso))],
    ['Deslocamento (tempo + transporte)', menos(pj.custoDesloc)],
    ['Home office (energia, internet…)', menos(calc.homePj)],
    [forte('Total comparável/mês'), forte(brlCents(pj.final))],
  ]

  return (
    <ToolPage
      icon={<Briefcase size={20} />}
      title="PJ × CLT"
      description="O que chega de verdade no bolso em cada regime — impostos de 2026, benefícios, 13º, férias e o custo do trajeto."
      inputs={
        <>
          <Card title="Lado CLT">
            <div className="space-y-4">
              <SliderField
                label="Salário bruto"
                value={salario}
                onChange={setSalario}
                min={SALARIO_MINIMO_2026}
                max={50000}
                step={100}
                format={brl}
                hint="Salário mensal em carteira, antes dos descontos. INSS e IRRF de 2026 são aplicados automaticamente."
              />
              <SliderField
                label="VR/VA por mês"
                value={vrva}
                onChange={setVrva}
                min={0}
                max={3000}
                step={50}
                format={brl}
                hint="Benefício isento de impostos — soma direto na remuneração total do CLT."
              />
              <SliderField
                label="Plano de saúde (empresa paga)"
                value={planoEmpresa}
                onChange={setPlanoEmpresa}
                min={0}
                max={3000}
                step={50}
                format={brl}
                hint="Quanto custaria um plano equivalente se você pagasse do bolso — como PJ, esse custo é seu."
              />
              <SliderField
                label="Outros benefícios"
                value={outrosBeneficios}
                onChange={setOutrosBeneficios}
                min={0}
                max={5000}
                step={50}
                format={brl}
                hint="Auxílio home office, previdência com contrapartida, academia… tudo que a empresa banca e você usaria de qualquer jeito."
              />
              <NumberField
                label="Dependentes (IR)"
                value={dependentes}
                onChange={v => setDependentes(Math.max(0, Math.min(10, Math.round(v))))}
                min={0}
                max={10}
                hint="Dedução de R$ 189,59 por dependente na base do IRRF — usada quando o desconto legal supera o simplificado. Vale para o salário e para o pró-labore."
              />
            </div>
          </Card>

          <Card title="Lado PJ">
            <div className="space-y-4">
              <SliderField
                label="Faturamento mensal"
                value={faturamento}
                onChange={setFaturamento}
                min={1000}
                max={80000}
                step={500}
                format={brl}
                hint="Valor bruto das notas emitidas por mês. Regra de bolso do mercado: PJ costuma pedir 1,3–1,5× o bruto CLT."
              />
              <Segmented<RegimePj>
                label="Regime da PJ"
                hint="Simples Nacional: DAS percentual pela tabela do anexo, com pró-labore obrigatório. MEI: sem pró-labore, DAS fixo de R$ 86,05/mês e teto de R$ 81 mil/ano (≈ R$ 6.750/mês). Atenção: atividades intelectuais (dev, consultoria, engenharia…) NÃO podem ser MEI — a lista de ocupações permitidas é restrita."
                value={regime}
                onChange={setRegime}
                options={[
                  { value: 'simples', label: 'Simples' },
                  { value: 'mei', label: 'MEI' },
                ]}
              />
              {regime === 'mei' &&
                (pj.desenquadrado ? (
                  <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-[11px] leading-relaxed text-ink-2">
                    Faturamento acima do teto do MEI ({brl(MEI_LIMITE_ANUAL_2026)}/ano ≈ R$ 6.750/mês):
                    você seria <strong className="text-ink">desenquadrado</strong>. O cálculo abaixo já usa
                    o Simples Nacional com pró-labore mínimo.
                  </p>
                ) : (
                  <p className="text-[11px] leading-relaxed text-mute">
                    DAS fixo de <strong className="tnum text-ink-2">{brlCents(MEI_DAS_SERVICOS_2026)}</strong>
                    /mês, sem pró-labore. Teto: {brl(MEI_LIMITE_ANUAL_2026)}/ano.
                  </p>
                ))}
              {regime === 'simples' && (
                <>
                  <Segmented<ProLaboreModo>
                    label="Pró-labore"
                    hint="Fator R (LC 123/2006) = folha de 12 meses ÷ receita de 12 meses. Com pró-labore ≥ 28% do faturamento a empresa tributa pelo Anexo III (a partir de 6%); abaixo, cai no Anexo V (a partir de 15,5%)."
                    value={plModo}
                    onChange={setPlModo}
                    options={[
                      { value: 'minimo', label: 'Mínimo' },
                      { value: 'fatorR', label: '28% (Fator R)' },
                      { value: 'custom', label: 'Outro' },
                    ]}
                  />
                  {plModo === 'custom' ? (
                    <SliderField
                      label="Pró-labore mensal"
                      value={plCustom}
                      onChange={setPlCustom}
                      min={SALARIO_MINIMO_2026}
                      max={30000}
                      step={100}
                      format={brl}
                      hint="O mínimo legal é 1 salário mínimo (R$ 1.621 em 2026). Pró-labore maior paga mais INSS/IRRF, mas pode garantir o Anexo III."
                    />
                  ) : (
                    <p className="text-[11px] leading-relaxed text-mute">
                      Pró-labore de <strong className="tnum text-ink-2">{brlCents(pj.proLabore)}</strong> → Fator R{' '}
                      {pct(Math.min(pj.fatorR, 9.99) * 100, 0)} · {anexoTxt}
                    </p>
                  )}
                </>
              )}
              <SliderField
                label="Plano de saúde (do seu bolso)"
                value={planoPj}
                onChange={setPlanoPj}
                min={0}
                max={4000}
                step={50}
                format={brl}
                hint="Planos individuais/adesão custam bem mais que o coletivo empresarial — cote antes de decidir."
              />
              <SliderField
                label="Férias sem faturar"
                value={feriasDias}
                onChange={setFeriasDias}
                min={0}
                max={90}
                step={5}
                format={v => `${num(v)} dias/ano`}
                hint="PJ não tem férias remuneradas nem ⅓: cada dia parado é receita que não entra. 30 dias ≈ 8,2% do faturamento anual."
              />
            </div>
          </Card>

          <Card
            title="Deslocamento"
            right={
              <InfoTip text="O tempo de trajeto vira custo pelo valor da sua hora: líquido mensal ÷ 176h (22 dias úteis × 8h). Calculado automaticamente para cada lado." />
            }
          >
            <div className="space-y-4">
              <Segmented<Modalidade>
                label="No CLT"
                value={modalidadeDe(diasClt)}
                onChange={m => setDiasClt(diasDe(m))}
                options={OPCOES_MODALIDADE}
              />
              <Segmented<Modalidade>
                label="Como PJ"
                value={modalidadeDe(diasPj)}
                onChange={m => setDiasPj(diasDe(m))}
                options={OPCOES_MODALIDADE}
              />
              <SliderField
                label="Minutos porta a porta/dia"
                value={minutosDia}
                onChange={setMinutosDia}
                min={0}
                max={240}
                step={5}
                format={v => `${num(v)} min`}
                hint="Tempo total de ida e volta num dia presencial — da sua porta à mesa e de volta."
              />
              <SliderField
                label="Custo de transporte/dia"
                value={custoTransporteDia}
                onChange={setCustoTransporteDia}
                min={0}
                max={120}
                step={1}
                format={brl}
                hint="Passagens, combustível + estacionamento ou app, por dia presencial. Duas tarifas de ônibus em SP ≈ R$ 10,60."
              />
              <SliderField
                label="Custo do home office/dia"
                value={custoHomeDia}
                onChange={setCustoHomeDia}
                min={0}
                max={100}
                step={1}
                format={brl}
                hint="Custo extra de trabalhar de casa num dia remoto: energia (ar-condicionado, equipamentos), internet melhor, café… Aplicado aos dias da semana útil fora do escritório, nos dois lados. Se a empresa paga auxílio home office no CLT, lance em 'Outros benefícios'."
              />
              <p className="text-[11px] text-mute">
                Trajeto + home office — CLT:{' '}
                <span className="tnum">{menos(calc.custoDeslocClt + calc.homeClt)}</span>/mês · PJ:{' '}
                <span className="tnum">{menos(pj.custoDesloc + calc.homePj)}</span>/mês
              </p>
            </div>
          </Card>

          <Collapse title="Premissas avançadas">
            <div className="space-y-4">
              <SliderField
                label="Contador (mensalidade)"
                value={contador}
                onChange={setContador}
                min={0}
                max={1500}
                step={25}
                format={brl}
                hint="Contabilidade online para PJ de serviços costuma custar R$ 200–400/mês (média de mercado 2026)."
              />
              <SliderField
                label="Outros custos PJ/mês"
                value={outrosCustos}
                onChange={setOutrosCustos}
                min={0}
                max={5000}
                step={50}
                format={brl}
                hint="Certificado digital (~R$ 200/ano), tarifas de conta PJ, softwares, coworking, previdência privada…"
              />
              <SliderField
                label="Dias no escritório/semana — CLT"
                value={diasClt}
                onChange={setDiasClt}
                min={0}
                max={7}
                step={1}
                format={v => `${num(v)} d/sem`}
                hint="Ajuste fino da modalidade — o segmentado acima usa 5, 3 ou 0 dias."
              />
              <SliderField
                label="Dias no escritório/semana — PJ"
                value={diasPj}
                onChange={setDiasPj}
                min={0}
                max={7}
                step={1}
                format={v => `${num(v)} d/sem`}
                hint="Muitos contratos PJ são remotos — mas se o cliente exigir presença, o custo do trajeto entra aqui."
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
            badge={
              ehMei
                ? 'MEI · DAS fixo'
                : pj.desenquadrado
                  ? 'MEI estourado → Simples'
                  : `Fator R ${pct(Math.min(pj.fatorR, 9.99) * 100, 0)} · ${anexoTxt}`
            }
          />

          <ExportBar
            pagina="pj-clt"
            resumo={resumo}
            csv={{
              nome: 'comparativo',
              colunas: ['Linha', 'CLT (R$/mês)', 'PJ (R$/mês)'],
              linhas: csvLinhas,
            }}
            premissas={premissas}
          />

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile
              label="CLT · líquido/mês"
              value={cltFinal}
              format={brl}
              tone={!empate && !pjVence ? 'accent' : 'neutral'}
              sub={`${brlCents(calc.horaEfetivaClt)}/h efetiva, com trajeto`}
            />
            <StatTile
              label="PJ · líquido/mês"
              value={pj.final}
              format={brl}
              tone={!empate && pjVence ? 'accent' : 'neutral'}
              sub={`${brlCents(pj.horaEfetiva)}/h efetiva, com trajeto`}
            />
            <StatTile
              label="FGTS + 13º no ano (CLT)"
              value={calc.fgtsAnual + calc.dec13.liquido}
              format={brl}
              sub="FGTS é patrimônio à parte; o 13º já está diluído no mês"
            />
            {ehMei ? (
              <StatTile
                label="DAS (MEI, guia fixa)"
                value={pj.das}
                format={brlCents}
                sub="5% do salário mínimo + R$ 5 de ISS"
              />
            ) : (
              <StatTile
                label="DAS efetivo (Simples)"
                value={pj.aliquota * 100}
                format={v => pct(v, 2)}
                sub={`${anexoTxt} · ${brlCents(pj.das)}/mês`}
              />
            )}
          </div>

          <Card>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-mute">
                    Ponto de equilíbrio
                  </span>
                  <InfoTip text="Resolvido numericamente: o menor faturamento a partir do qual o líquido PJ — com DAS, INSS, IRRF, custos e deslocamento — fica igual ou acima do pacote CLT para qualquer valor maior. Os degraus do Fator R e do IR de dividendos já estão considerados." />
                </div>
                <p className="mt-1 text-sm text-ink-2">Para empatar com esse pacote CLT, o PJ precisa faturar</p>
                <div className="mt-1 text-3xl font-extrabold tnum text-accent">
                  {breakEven === null ? (
                    'mais de R$ 1 mi'
                  ) : (
                    <>
                      <AnimatedNumber value={breakEven} format={brl} />
                      <span className="ml-1 text-sm font-semibold text-mute">/mês</span>
                    </>
                  )}
                </div>
              </div>
              <p className="min-w-48 max-w-72 text-xs leading-relaxed text-mute">
                {breakEven === null
                  ? 'Com esses custos e deslocamento, nem R$ 1 mi/mês de faturamento empata — revise as premissas.'
                  : breakEven === 0
                    ? 'O pacote CLT comparável está zerado ou negativo — qualquer faturamento PJ já vence.'
                    : faturamento >= breakEven
                      ? `Você informou ${brl(faturamento)}: folga de ${brl(faturamento - breakEven)}/mês acima do empate.`
                      : pjVence
                        ? `Com ${brl(faturamento)} o PJ já vence hoje, mas um degrau do Simples ou do IR de dividendos derruba o líquido logo adiante — só acima de ${brl(breakEven)} a vantagem vale para qualquer faturamento.`
                        : `Faltam ${brl(breakEven - faturamento)}/mês sobre os ${brl(faturamento)} informados para o PJ empatar.`}
              </p>
            </div>
          </Card>

          <Card
            title="E se o faturamento mudar?"
            subtitle="Líquido PJ comparável por faturamento mensal — a linha tracejada é o pacote CLT de hoje"
          >
            <VLineChart
              data={calc.chart}
              series={[{ key: 'pj', name: 'Líquido PJ (comparável)', colorIndex: 1 }]}
              xKey="fat"
              xFormat={v => brlCompact(Number(v))}
              yFormat={brlCompact}
              refY={Math.round(cltFinal)}
              refYLabel="Pacote CLT"
            />
          </Card>

          <div className="grid gap-5 sm:grid-cols-2">
            <Card title="CLT — do bruto ao bolso" subtitle="Valores médios mensais (13º e férias diluídos)">
              <DataTable columns={['Componente', 'R$/mês']} rows={rowsClt} align={['l', 'r']} />
            </Card>
            <Card title="PJ — da nota ao bolso" subtitle="Valores médios mensais (férias sem faturar diluídas)">
              <DataTable columns={['Componente', 'R$/mês']} rows={rowsPj} align={['l', 'r']} />
              <p className="mt-2 text-[11px] leading-relaxed text-mute">
                Composição do bolso: pró-labore líquido de {brlCents(pj.plLiquido)} + dividendos líquidos de{' '}
                {brlCents(pj.dividendosLiquidos)}. O pró-labore bruto ({brlCents(pj.proLabore)}) não aparece como
                desconto porque volta para você como salário — só os impostos dele ficam no caminho.
              </p>
            </Card>
          </div>

          <Card
            title="Tabelas do Simples Nacional (2026)"
            subtitle={
              ehMei
                ? 'No MEI o DAS é fixo — estas tabelas passam a valer se você desenquadrar do teto de R$ 81 mil/ano'
                : `Sua faixa está destacada — RBT12 de ${brl(pj.rbt12)} → alíquota efetiva de ${pct(pj.aliquota * 100, 2)} pelo ${anexoTxt}`
            }
          >
            <div className="grid gap-5 lg:grid-cols-2">
              <TabelaAnexo
                titulo={
                  <>
                    Anexo III{' '}
                    <span className="font-normal text-mute">— serviços com Fator R ≥ 28%</span>
                  </>
                }
                faixas={SIMPLES_ANEXO_III}
                ativa={!ehMei && pj.anexoIII}
                rbt12={pj.rbt12}
              />
              <TabelaAnexo
                titulo={
                  <>
                    Anexo V{' '}
                    <span className="font-normal text-mute">— serviços com Fator R &lt; 28%</span>
                  </>
                }
                faixas={SIMPLES_ANEXO_V}
                ativa={!ehMei && !pj.anexoIII}
                rbt12={pj.rbt12}
              />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-mute">
              Alíquota efetiva = (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12, onde RBT12 é a
              receita bruta dos últimos 12 meses (LC 123/2006, Resolução CGSN 140/2018). O DAS do mês =
              receita do mês × alíquota efetiva, com ISS já embutido.
            </p>
          </Card>

          <Didatico
            passos={passosDidatico}
            analogia={analogiaDidatico}
            sensibilidade={sensibilidadeDidatico}
          />

          <Card title="Premissas e simplificações">
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-ink-2">
              <li>
                ⅓ de férias tributado junto com o salário do mês, como um mês comum — o cálculo oficial de férias é
                levemente diferente. 13º com INSS e IRRF próprios; o redutor da Lei 15.270/2025 vale nos dois casos.
              </li>
              <li>
                FGTS (8% sobre ~13,33 salários/ano) fica fora do líquido mensal: é patrimônio com saque restrito — mas
                pesa a favor do CLT, junto com multa rescisória de 40% e seguro-desemprego, que não entram na conta.
              </li>
              <li>
                PJ no Simples Nacional, Anexo III ou V pela regra do Fator R (LC 123/2006), com ISS embutido no DAS.
                Dividendos isentos até R$ 50 mil/mês por sócio; acima disso, 10% na fonte (Lei 15.270/2025).
              </li>
              <li>
                MEI (quando selecionado): DAS fixo de {brlCents(MEI_DAS_SERVICOS_2026)}/mês (serviços), sem
                pró-labore, teto de {brl(MEI_LIMITE_ANUAL_2026)}/ano — acima disso a conta muda sozinha para o
                Simples com pró-labore mínimo. Retiradas sem IR na prática (32% do faturamento é lucro isento e o
                restante fica sob a isenção de R$ 5 mil/mês). Atenção: atividades intelectuais (dev, consultoria,
                engenharia…) não estão na lista de ocupações permitidas do MEI.
              </li>
              <li>
                Home office: {brl(custoHomeDia)}/dia fora do escritório (energia, internet, café), aplicado à
                semana útil de 5 dias nos dois lados — trabalhar de casa também tem custo, ele só é menor e mais
                controlável que o do trajeto.
              </li>
              <li>
                O valor da hora (líquido ÷ 176h) monetiza o tempo de trajeto. Se você não daria uso produtivo a esse
                tempo, zere os minutos no painel — o custo em dinheiro do transporte continua valendo.
              </li>
              <li>
                A conta é financeira: estabilidade, férias remuneradas garantidas e previdência do CLT × flexibilidade e
                teto maior do PJ seguem sendo uma decisão sua.
              </li>
            </ul>
          </Card>
        </>
      }
    />
  )
}
