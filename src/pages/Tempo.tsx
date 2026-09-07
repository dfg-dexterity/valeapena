/**
 * Tempo.tsx — Custo de oportunidade do seu tempo.
 * Motor: custo-hora real (Robin & Dominguez, Your Money or Your Life) — a hora
 * "de verdade" desconta gastos do trabalho e soma deslocamento/preparo às horas.
 * Três análises: investir em você (VPL com rampa Card-Kluve-Weber), terceirizar
 * tarefas (Whillans PNAS 2017) e hora extra × tempo de qualidade (Pencavel 2015,
 * leitura log-linear de Killingsworth/KKM 2023, alertas assimétricos de família
 * que NUNCA viram R$ — Milkie 2015).
 */
import { useMemo, useState } from 'react'
import { Armchair, HeartHandshake, Hourglass, Moon } from 'lucide-react'
import {
  Card,
  Collapse,
  Didatico,
  ExportBar,
  InfoTip,
  Segmented,
  SliderField,
  StatTile,
  ToolPage,
  Verdict,
} from '../components/ui'
import { VBarChart, VLineChart } from '../components/charts'
import { useVizColors } from '../theme'
import { brl, brlCents, brlCompact, num, pct } from '../lib/format'

/** Semanas por mês (365,25 / 7 / 12). */
const SEMANAS_MES = 4.345
/** Dias úteis por mês (média BR). */
const DIAS_UTEIS_MES = 21.7
/** Dias de trabalho/semana usados no preparo+descompressão (convenção YMOYL). */
const DIAS_TRABALHO = 5

type Modo = 'skill' | 'terceirizar' | 'extra'

/* ------------------------- Modo A: investir em você ------------------------- */
type TipoSkill = 'cert' | 'ingles' | 'pos' | 'curto' | 'custom'
const SKILLS: Record<TipoSkill, { label: string; dw: number; fonte: string }> = {
  cert: {
    label: 'Certificação profissional (+8%)',
    dw: 8,
    fonte:
      'Skillsoft/Global Knowledge IT Skills & Salary Report: sêniores certificados ganham até US$ 20 mil a mais. Pesquisa de fornecedor — use como indicação, não como garantia.',
  },
  ingles: {
    label: 'Inglês fluente (+15%)',
    dw: 15,
    fonte:
      'Catho (13 mil entrevistados): inglês fluente paga até 61% a mais. Pesquisa de mercado — o default de +15% é deliberadamente conservador.',
  },
  pos: {
    label: 'Pós / especialização (+10%)',
    dw: 10,
    fonte:
      'Psacharopoulos & Patrinos 2018: ~9–10% de aumento por ano extra de estudo (705 estimativas globais); América Latina: 11%.',
  },
  curto: {
    label: 'Treinamento curto (+3%)',
    dw: 3,
    fonte: 'Card, Kluve & Weber 2018 (meta-análise de 200+ programas): efeitos modestos e tardios.',
  },
  custom: { label: 'Personalizado', dw: 10, fonte: 'Defina seu próprio aumento esperado.' },
}

/* ------------------------- Modo B: terceirizar ------------------------- */
type Tarefa = 'faxina' | 'cozinha' | 'lavanderia' | 'custom'
const TAREFAS: Record<Tarefa, { label: string; preco: number; horas: number }> = {
  faxina: { label: 'Faxina', preco: 380, horas: 12 },
  cozinha: { label: 'Marmitas', preco: 700, horas: 20 },
  lavanderia: { label: 'Lavanderia', preco: 250, horas: 6 },
  custom: { label: 'Outra', preco: 400, horas: 10 },
}
type Desgosto = 'gosto' | 'tantofaz' | 'detesto'
const F_DESGOSTO: Record<Desgosto, number> = { gosto: 0.8, tantofaz: 1.0, detesto: 1.3 }
const DESGOSTO_LABEL: Record<Desgosto, string> = {
  gosto: 'Gosto (0,8)',
  tantofaz: 'Tanto faz (1,0)',
  detesto: 'Detesto (1,3)',
}
type Uso = 'sei' | 'naosei'
const F_USO: Record<Uso, number> = { sei: 1.0, naosei: 0.5 }

/* ------------------------- Modo C: hora extra ------------------------- */
type Adicional = 'clt' | 'pj' | 'custom'
type Origem = 'lazer' | 'familia' | 'sono'
const ORIGEM_LABEL: Record<Origem, string> = {
  lazer: 'Lazer',
  familia: 'Família',
  sono: 'Sono',
}

/** Fator Pencavel: produtividade marginal da hora na posição h da semana. */
function pencavel(h: number): number {
  return h <= 50 ? 1 : Math.max(0.6, 1 - 0.04 * (h - 50))
}

export default function Tempo() {
  const c = useVizColors()

  /* ------------------------------ Inputs: perfil ------------------------------ */
  const [renda, setRenda] = useState(5000)
  const [hContratada, setHContratada] = useState(44)
  const [hExtraHabitual, setHExtraHabitual] = useState(0)
  const [diasPresenciais, setDiasPresenciais] = useState(5)
  const [deslocMin, setDeslocMin] = useState(60)
  const [prepMin, setPrepMin] = useState(45)
  /** null = seguir o default de 8% da renda; número = editado pelo usuário */
  const [gastosCustom, setGastosCustom] = useState<number | null>(null)
  const gastosTrabalho = gastosCustom ?? Math.round(renda * 0.08)

  const [modo, setModo] = useState<Modo>('skill')

  /* ------------------------------ Inputs: modo A ------------------------------ */
  const [tipoSkill, setTipoSkill] = useState<TipoSkill>('cert')
  const [dwCustom, setDwCustom] = useState<number | null>(null)
  const deltaW = dwCustom ?? SKILLS[tipoSkill].dw
  const [custoSkill, setCustoSkill] = useState(5000)
  const [horasEstudo, setHorasEstudo] = useState(5)
  const [duracaoMeses, setDuracaoMeses] = useState(12)
  const [chanceCaptura, setChanceCaptura] = useState(60)
  const [horizonteAnos, setHorizonteAnos] = useState(15)
  const [kEstudo, setKEstudo] = useState(0.5)
  const [descontoReal, setDescontoReal] = useState(7)

  /* ------------------------------ Inputs: modo B ------------------------------ */
  const [tarefa, setTarefa] = useState<Tarefa>('faxina')
  const [precoServico, setPrecoServico] = useState(TAREFAS.faxina.preco)
  const [horasLiberadas, setHorasLiberadas] = useState(TAREFAS.faxina.horas)
  const [desgosto, setDesgosto] = useState<Desgosto>('tantofaz')
  const [uso, setUso] = useState<Uso>('sei')

  /* ------------------------------ Inputs: modo C ------------------------------ */
  const [horasExtrasNovas, setHorasExtrasNovas] = useState(4)
  const [tipoAdicional, setTipoAdicional] = useState<Adicional>('clt')
  const [adicionalCustom, setAdicionalCustom] = useState(30)
  const adicionalPct = tipoAdicional === 'clt' ? 50 : tipoAdicional === 'pj' ? 0 : adicionalCustom
  const [origem, setOrigem] = useState<Origem>('lazer')

  /* ------------------------------ Motor: custo-hora real ------------------------------ */
  const base = useMemo(() => {
    const horasSemana =
      hContratada +
      hExtraHabitual +
      (deslocMin / 60) * diasPresenciais +
      (prepMin / 60) * DIAS_TRABALHO
    const horasMes = horasSemana * SEMANAS_MES
    const wNominal = hContratada > 0 ? renda / (hContratada * SEMANAS_MES) : 0
    const rendaReal = renda - gastosTrabalho
    const wRealBruto = horasMes > 0 ? rendaReal / horasMes : 0
    const clamped = wRealBruto <= 0
    const wReal = Math.max(0, wRealBruto)
    const quedaPct = wNominal > 0 ? (1 - wReal / wNominal) * 100 : 0
    const horaDesperdicadaMes = wReal * DIAS_UTEIS_MES
    return { horasSemana, horasMes, wNominal, rendaReal, wReal, clamped, quedaPct, horaDesperdicadaMes }
  }, [renda, hContratada, hExtraHabitual, deslocMin, diasPresenciais, prepMin, gastosTrabalho])

  /* ------------------------------ Modo A: VPL da skill ------------------------------ */
  const skill = useMemo(() => {
    const d = duracaoMeses / 12
    const r = Math.max(0, descontoReal) / 100
    const p = chanceCaptura / 100
    const horasEstudoTotais = horasEstudo * SEMANAS_MES * duracaoMeses
    const custoTempo = horasEstudoTotais * base.wReal * kEstudo
    const custoTotal = custoSkill + custoTempo

    // Rampa Card-Kluve-Weber, contada após o fim do estudo:
    // 1º ano pós-estudo = 25%, 2º = 60%, 3º+ = 100% (avaliada no meio do ano t).
    const rampa = (t: number): number => {
      const m = t - 0.5 - d
      if (m <= 0) return 0
      if (m <= 1) return 0.25
      if (m <= 2) return 0.6
      return 1
    }

    const beneficioPleno = renda * 12 * (deltaW / 100) * p
    // VP por unidade de ΔW (100%) — VPL é linear em ΔW, o que dá o ΔW de empate.
    let vpPorUnidade = 0
    let vpBeneficios = 0
    const serie: Array<{ ano: number; vpl: number }> = [{ ano: 0, vpl: -custoTotal }]
    const linhasCsv: Array<Array<string | number>> = []
    let payback = NaN
    let acum = -custoTotal
    for (let t = 1; t <= horizonteAnos; t++) {
      const rp = rampa(t)
      const df = Math.pow(1 + r, t)
      const ben = beneficioPleno * rp
      const benVp = ben / df
      vpPorUnidade += (renda * 12 * p * rp) / df
      vpBeneficios += benVp
      const prev = acum
      acum += benVp
      if (!Number.isFinite(payback) && prev < 0 && acum >= 0 && benVp > 0) {
        payback = t - 1 + -prev / benVp
      }
      serie.push({ ano: t, vpl: acum })
      linhasCsv.push([
        t,
        Number((rp * 100).toFixed(0)),
        Number(ben.toFixed(2)),
        Number(benVp.toFixed(2)),
        Number(acum.toFixed(2)),
      ])
    }
    const vpl = vpBeneficios - custoTotal
    const dwMinPct = vpPorUnidade > 0 ? (custoTotal / vpPorUnidade) * 100 : NaN
    const semRetornoNoHorizonte = vpPorUnidade <= 0

    const cenarios = [0.5, 1, 1.5].map(f => ({
      label:
        f === 1 ? `+${pct(deltaW, 0)} (estimado)` : f < 1 ? `+${pct(deltaW * f, 0)} (metade)` : `+${pct(deltaW * f, 0)} (50% a mais)`,
      vpl: vpBeneficios * f - custoTotal,
    }))

    const horasComEstudo = base.horasSemana + horasEstudo
    return {
      custoTempo,
      custoTotal,
      horasEstudoTotais,
      vpl,
      payback,
      dwMinPct,
      semRetornoNoHorizonte,
      serie,
      linhasCsv,
      cenarios,
      horasComEstudo,
      alertaPencavel: horasComEstudo > 50,
    }
  }, [base, renda, deltaW, custoSkill, horasEstudo, duracaoMeses, chanceCaptura, horizonteAnos, kEstudo, descontoReal])

  /* ------------------------------ Modo B: terceirizar ------------------------------ */
  const terc = useMemo(() => {
    const fDesg = F_DESGOSTO[desgosto]
    const fUso = F_USO[uso]
    const valorHoraLiberada = base.wReal * fDesg * fUso
    const valorMes = horasLiberadas * valorHoraLiberada
    const ganhoMes = valorMes - precoServico
    const precoHora = horasLiberadas > 0 ? precoServico / horasLiberadas : NaN
    const limiar = Math.max(10, precoServico * 0.05)
    return { fDesg, fUso, valorHoraLiberada, valorMes, ganhoMes, precoHora, limiar }
  }, [base.wReal, desgosto, uso, horasLiberadas, precoServico])

  /* ------------------------------ Modo C: hora extra ------------------------------ */
  const extra = useMemo(() => {
    const brutoHora = base.wNominal * (1 + adicionalPct / 100)
    const inicio = base.horasSemana
    // integra o fator Pencavel hora a hora nas horas adicionadas
    const passo = 0.05
    let horasEfetivas = 0
    for (let x = 0; x < horasExtrasNovas - 1e-9; x += passo) {
      const dx = Math.min(passo, horasExtrasNovas - x)
      horasEfetivas += dx * pencavel(inicio + x + dx / 2)
    }
    const rendaExtraMes = horasEfetivas * brutoHora * SEMANAS_MES
    const rendaExtraSemDecaimento = horasExtrasNovas * brutoHora * SEMANAS_MES
    const efetivoMedioHora = horasExtrasNovas > 0 ? rendaExtraMes / (horasExtrasNovas * SEMANAS_MES) : 0
    const deltaRendaPct = renda > 0 ? (rendaExtraMes / renda) * 100 : 0
    const totalSemana = inicio + horasExtrasNovas

    const curva: Array<{ h: number; valor: number }> = []
    for (let h = 40; h <= 70; h++) curva.push({ h, valor: brutoHora * pencavel(h) })
    const linhasCsv = curva.map(row => [
      row.h,
      Number(pencavel(row.h).toFixed(2)),
      Number(row.valor.toFixed(2)),
    ])
    return {
      brutoHora,
      rendaExtraMes,
      rendaExtraSemDecaimento,
      efetivoMedioHora,
      deltaRendaPct,
      totalSemana,
      curva,
      linhasCsv,
      passaDe50: totalSemana > 50,
    }
  }, [base.wNominal, base.horasSemana, adicionalPct, horasExtrasNovas, renda])

  /* ------------------------------ Veredito por modo ------------------------------ */
  let verdictWinner: React.ReactNode
  let verdictDetail: React.ReactNode
  let verdictTone: 'positive' | 'negative' | 'neutral'
  let verdictBadge: React.ReactNode

  if (modo === 'skill') {
    if (skill.semRetornoNoHorizonte) {
      verdictTone = 'negative'
      verdictWinner = 'O horizonte acaba antes do retorno começar'
      verdictDetail = (
        <>
          O estudo dura {num(duracaoMeses)} meses e o aumento só se materializa nos anos seguintes
          (rampa de 2–3 anos, Card-Kluve-Weber). Com horizonte de {num(horizonteAnos)}{' '}
          {horizonteAnos === 1 ? 'ano' : 'anos'}, nenhum benefício entra na conta — VPL de{' '}
          <strong>{brl(skill.vpl)}</strong>. Estenda o horizonte ou escolha algo mais curto.
        </>
      )
      verdictBadge = `VPL ${brl(skill.vpl)}`
    } else if (skill.vpl > 0) {
      verdictTone = 'positive'
      verdictWinner = `Vale a pena — VPL de ${brl(skill.vpl)} em ${num(horizonteAnos)} anos`
      verdictDetail = (
        <>
          Você investe <strong>{brl(skill.custoTotal)}</strong> ({brl(custoSkill)} do curso +{' '}
          {num(skill.horasEstudoTotais)} h de estudo valoradas pela sua hora real) e, capturando{' '}
          <strong>+{pct(deltaW, 0)}</strong> de salário com {pct(chanceCaptura, 0)} de chance,{' '}
          {Number.isFinite(skill.payback) ? (
            <>
              recupera tudo em ~<strong>{num(skill.payback, 1)} anos</strong>.
            </>
          ) : (
            <>não tem custo líquido a recuperar — todo benefício já é ganho.</>
          )}{' '}
          Para empatar com o Tesouro IPCA+ ({pct(descontoReal, 1)} a.a. real), bastaria um aumento
          de {pct(skill.dwMinPct, 1)}.
        </>
      )
      verdictBadge = Number.isFinite(skill.payback)
        ? `payback ~${num(skill.payback, 1)} anos`
        : `VPL ${brl(skill.vpl)}`
    } else {
      verdictTone = 'negative'
      verdictWinner = 'Não vale a pena com essas premissas'
      verdictDetail = (
        <>
          O benefício, trazido a dinheiro de hoje, soma {brl(skill.vpl + skill.custoTotal)} — menos
          que o custo total de <strong>{brl(skill.custoTotal)}</strong> (curso + seu tempo de
          estudo). Para empatar com o Tesouro IPCA+ ({pct(descontoReal, 1)} a.a. real), o aumento
          capturado precisaria ser de pelo menos <strong>{pct(skill.dwMinPct, 1)}</strong> — você
          projetou +{pct(deltaW, 0)} com {pct(chanceCaptura, 0)} de chance.
        </>
      )
      verdictBadge = `VPL ${brl(skill.vpl)}`
    }
  } else if (modo === 'terceirizar') {
    const empate = Math.abs(terc.ganhoMes) <= terc.limiar
    verdictTone = empate ? 'neutral' : terc.ganhoMes > 0 ? 'positive' : 'negative'
    verdictWinner = empate
      ? 'Empate técnico — decida pela qualidade de vida'
      : terc.ganhoMes > 0
        ? `Vale a pena terceirizar — sobra ${brl(terc.ganhoMes)}/mês`
        : `Financeiramente não fecha — faltam ${brl(-terc.ganhoMes)}/mês`
    verdictDetail = (
      <>
        Cada hora liberada custa <strong>{brlCents(terc.precoHora)}</strong> e vale{' '}
        <strong>{brlCents(terc.valorHoraLiberada)}</strong> para você (sua hora real de{' '}
        {brlCents(base.wReal)} × desgosto {num(terc.fDesg, 1)} × uso do tempo {num(terc.fUso, 1)}).
        São {num(horasLiberadas)} h/mês de volta — {num(horasLiberadas * 12)} h/ano.
        {terc.ganhoMes <= 0 && terc.fUso < 1 && (
          <> Com um destino claro para o tempo liberado, a conta melhora — veja a sensibilidade.</>
        )}
      </>
    )
    verdictBadge = `${brlCents(terc.precoHora)}/h liberada`
  } else {
    verdictTone = extra.efetivoMedioHora < base.wNominal ? 'negative' : 'neutral'
    verdictWinner = `+${brl(extra.rendaExtraMes)}/mês — hora efetiva de ${brlCents(extra.efetivoMedioHora)}`
    verdictDetail = (
      <>
        A hora extra paga <strong>{brlCents(extra.brutoHora)}</strong> ({pct(adicionalPct, 0)}{' '}
        sobre a nominal), mas sua semana real iria a{' '}
        <strong>{num(extra.totalSemana, 1)} h</strong>
        {extra.passaDe50 ? (
          <>
            {' '}
            — acima de ~50 h a produtividade por hora cai (Pencavel 2015), e o valor efetivo
            desce para <strong>{brlCents(extra.efetivoMedioHora)}</strong>/h
          </>
        ) : (
          <> — ainda abaixo do limiar de ~50 h, sem desconto de produtividade</>
        )}
        . Isso eleva sua renda em {pct(extra.deltaRendaPct, 1)} — e o bem-estar sobe com o{' '}
        <em>log</em> da renda, não com o valor absoluto.
        {extra.efetivoMedioHora < base.wNominal && (
          <>
            {' '}
            Nesse ponto, a hora extra rende <strong>menos</strong> que a sua hora normal de{' '}
            {brlCents(base.wNominal)}.
          </>
        )}
      </>
    )
    verdictBadge = `+${pct(extra.deltaRendaPct, 1)} de renda`
  }

  /* ------------------------------ Exportação ------------------------------ */
  const premissasBase: [string, string][] = [
    ['Renda líquida mensal', brl(renda)],
    ['Horas contratadas', `${num(hContratada)} h/semana`],
    ['Horas extras habituais', `${num(hExtraHabitual)} h/semana`],
    ['Dias presenciais', `${num(diasPresenciais)}/semana`],
    ['Deslocamento (ida+volta)', `${num(deslocMin)} min/dia`],
    ['Preparo + descompressão', `${num(prepMin)} min/dia`],
    ['Gastos por causa do trabalho', `${brl(gastosTrabalho)}/mês`],
    ['Hora no contracheque', brlCents(base.wNominal)],
    ['Hora de verdade (YMOYL)', brlCents(base.wReal)],
  ]
  const premissasModo: [string, string][] =
    modo === 'skill'
      ? [
          ['Análise', 'Investir em você'],
          ['Tipo', SKILLS[tipoSkill].label],
          ['Aumento esperado (ΔW)', `+${pct(deltaW, 0)}`],
          ['Custo do curso', brl(custoSkill)],
          ['Estudo', `${num(horasEstudo)} h/semana × ${num(duracaoMeses)} meses`],
          ['Chance de capturar', pct(chanceCaptura, 0)],
          ['Horizonte de carreira', `${num(horizonteAnos)} anos`],
          ['k (estudo que sai de tempo pago)', pct(kEstudo * 100, 0)],
          ['Desconto real', `${pct(descontoReal, 1)} a.a.`],
        ]
      : modo === 'terceirizar'
        ? [
            ['Análise', 'Terceirizar tarefas'],
            ['Tarefa', TAREFAS[tarefa].label],
            ['Preço do serviço', `${brl(precoServico)}/mês`],
            ['Horas liberadas', `${num(horasLiberadas)} h/mês`],
            ['Desgosto pela tarefa', DESGOSTO_LABEL[desgosto]],
            ['Fator uso do tempo', num(terc.fUso, 1)],
          ]
        : [
            ['Análise', 'Hora extra × tempo de qualidade'],
            ['Horas extras adicionais', `${num(horasExtrasNovas)} h/semana`],
            ['Adicional sobre a hora', pct(adicionalPct, 0)],
            ['De onde sai o tempo', ORIGEM_LABEL[origem]],
          ]

  const csv =
    modo === 'skill'
      ? {
          nome: 'vpl-anual',
          colunas: ['Ano', 'Rampa (%)', 'Benefício (R$)', 'Benefício em R$ de hoje', 'VPL acumulado (R$)'],
          linhas: skill.linhasCsv,
        }
      : modo === 'terceirizar'
        ? {
            nome: 'terceirizar',
            colunas: ['Item', 'R$/mês', 'R$/hora'],
            linhas: [
              ['Preço do serviço', Number(precoServico.toFixed(2)), Number(terc.precoHora.toFixed(2))],
              ['Valor do tempo para você', Number(terc.valorMes.toFixed(2)), Number(terc.valorHoraLiberada.toFixed(2))],
              ['Ganho líquido', Number(terc.ganhoMes.toFixed(2)), Number((terc.valorHoraLiberada - terc.precoHora).toFixed(2))],
            ] as Array<Array<string | number>>,
          }
        : {
            nome: 'hora-extra',
            colunas: ['Horas semanais totais', 'Fator de produtividade', 'Valor efetivo da hora (R$)'],
            linhas: extra.linhasCsv,
          }

  const resumoModo =
    modo === 'skill'
      ? [
          `Investir em você (${SKILLS[tipoSkill].label}): VPL ${brl(skill.vpl)} em ${num(horizonteAnos)} anos`,
          `Custo total ${brl(skill.custoTotal)} (curso ${brl(custoSkill)} + ${num(skill.horasEstudoTotais)} h de estudo)`,
          Number.isFinite(skill.payback)
            ? `Payback ~${num(skill.payback, 1)} anos · aumento mínimo p/ empatar com o Tesouro IPCA+: ${pct(skill.dwMinPct, 1)}`
            : skill.semRetornoNoHorizonte
              ? `O horizonte de ${num(horizonteAnos)} anos acaba antes de a rampa de benefícios começar`
              : skill.vpl > 0
                ? `Sem custo líquido a recuperar · aumento mínimo p/ empatar com o Tesouro IPCA+: ${pct(skill.dwMinPct, 1)}`
                : `Não se paga no horizonte · aumento mínimo p/ empatar: ${pct(skill.dwMinPct, 1)}`,
        ]
      : modo === 'terceirizar'
        ? [
            `Terceirizar ${TAREFAS[tarefa].label}: ${terc.ganhoMes >= 0 ? 'sobra' : 'faltam'} ${brl(Math.abs(terc.ganhoMes))}/mês`,
            `Cada hora liberada custa ${brlCents(terc.precoHora)} e vale ${brlCents(terc.valorHoraLiberada)} para você`,
            `${num(horasLiberadas)} h/mês liberadas (${num(horasLiberadas * 12)} h/ano)`,
          ]
        : [
            `Hora extra (+${num(horasExtrasNovas)} h/sem): +${brl(extra.rendaExtraMes)}/mês (+${pct(extra.deltaRendaPct, 1)} de renda)`,
            `Hora extra cheia ${brlCents(extra.brutoHora)} → efetiva ${brlCents(extra.efetivoMedioHora)} (semana real de ${num(extra.totalSemana, 1)} h)`,
            `Tempo sai de: ${ORIGEM_LABEL[origem]} — custo não monetizado de propósito`,
          ]

  const resumo = [
    'vale a pena? · Tempo — custo de oportunidade do seu tempo',
    `Hora no contracheque: ${brlCents(base.wNominal)} · hora de verdade: ${brlCents(base.wReal)} (−${pct(Math.max(0, base.quedaPct), 1)})`,
    `Semana real: ${num(base.horasSemana, 1)} h · mês real: ${num(base.horasMes, 1)} h · 1 h/dia desperdiçada ≈ ${brl(base.horaDesperdicadaMes)}/mês`,
    ...resumoModo,
    'gerado por vale a pena? · Dexterity — valeapena-flame.vercel.app',
  ].join('\n')

  /* ------------------------------ Didático ------------------------------ */
  const passos = [
    {
      t: 'Sua hora não vale o que o contracheque diz',
      d: (
        <>
          No papel, sua hora vale {brlCents(base.wNominal)}. Mas sua semana de trabalho de verdade
          tem <strong>{num(base.horasSemana, 1)} h</strong> (jornada + deslocamento + preparo e
          descompressão), e {brl(gastosTrabalho)}/mês dos seus ganhos só existem por causa do
          trabalho. Dividindo o que sobra pelas horas de verdade, sua hora vale{' '}
          <strong>{brlCents(base.wReal)}</strong> — {pct(Math.max(0, base.quedaPct), 1)} a menos.
          (Robin &amp; Dominguez, <em>Your Money or Your Life</em>)
        </>
      ),
    },
    {
      t: 'Comprar tempo deixa as pessoas mais felizes do que comprar coisas',
      d: (
        <>
          Em 6.271 adultos de 4 países, gastar com serviços que economizam tempo previu maior
          satisfação com a vida — em todos os níveis de renda. E quase ninguém pensa nisso: só 2%
          usariam dinheiro extra para comprar tempo. No seu caso, cada hora liberada vale até{' '}
          <strong>{brlCents(base.wReal)}</strong>. (Whillans et al., PNAS 2017)
        </>
      ),
    },
    {
      t: 'Depois de ~50 h por semana, cada hora rende menos',
      d: (
        <>
          Sua semana real já soma <strong>{num(base.horasSemana, 1)} h</strong>
          {base.horasSemana > 50
            ? ' — você já passou do limiar em que a produtividade por hora começa a cair'
            : ` — faltam ${num(50 - base.horasSemana, 1)} h para o limiar em que a produtividade por hora começa a cair`}
          . Você entrega a hora inteira, mas ela produz menos e cobra recuperação. (Pencavel,{' '}
          <em>Economic Journal</em> 2015)
        </>
      ),
    },
    {
      t: 'Dinheiro compra felicidade em porcentagem, não em reais',
      d: (
        <>
          O bem-estar sobe com o <em>log</em> da renda: dobrar de {brl(renda)} para{' '}
          {brl(renda * 2)} vale tanto, em bem-estar, quanto dobrar de {brl(renda * 3)} para{' '}
          {brl(renda * 6)}. Por isso a mesma hora extra compra cada vez menos felicidade conforme
          sua renda cresce. (Killingsworth 2021; Killingsworth, Kahneman &amp; Mellers, PNAS 2023)
        </>
      ),
    },
    {
      t: 'Tempo com a família não tem preço — de propósito',
      d: (
        <>
          Com filhos, o que importa é o <strong>tipo</strong> de tempo, não o total de horas — e na
          adolescência é o tempo engajado que protege. Por isso esta página nunca converte tempo de
          família em R$: ela só avisa quando uma troca ameaça esses blocos. (Milkie et al. 2015;
          Hsin &amp; Felfe 2014)
        </>
      ),
    },
  ]

  const analogia = (
    <>
      Pense na sua hora como uma nota de {brlCents(base.wNominal)} impressa no contracheque.
      No caminho até sua vida, ela paga pedágio: deslocamento, preparo, descompressão e os gastos
      que só existem por causa do trabalho. A nota que chega em casa vale{' '}
      <strong>{brlCents(base.wReal)}</strong> — e é com ela, não com a impressa, que esta página
      faz todas as contas.
    </>
  )

  const sensibilidade =
    modo === 'skill' ? (
      <>
        Você projetou +{pct(deltaW, 0)} de aumento com {pct(chanceCaptura, 0)} de chance.{' '}
        {Number.isFinite(skill.dwMinPct) ? (
          <>
            O empate com o Tesouro IPCA+ ({pct(descontoReal, 1)} a.a. real) está em{' '}
            <strong>+{pct(skill.dwMinPct, 1)}</strong>: abaixo disso, melhor investir o dinheiro.
          </>
        ) : (
          <>
            Com esse horizonte, nenhum benefício entra na conta — o parâmetro que mais muda a
            resposta é o <strong>horizonte de carreira</strong> (ou uma duração de estudo menor).
          </>
        )}{' '}
        E se as suas horas de estudo saírem todas de tempo produtivo (k = 100%), o custo total sobe
        de {brl(skill.custoTotal)} para {brl(custoSkill + skill.horasEstudoTotais * base.wReal)}.
      </>
    ) : modo === 'terceirizar' ? (
      <>
        O resultado inverte se o serviço passar de{' '}
        <strong>{brlCents(terc.valorHoraLiberada)}/hora</strong> (= {brl(terc.valorMes)}/mês por{' '}
        {num(horasLiberadas)} h). E os dois fatores que você controla mudam tudo: detestar a tarefa
        (×1,3) e dar um destino claro ao tempo (×1,0 em vez de ×0,5) podem{' '}
        {terc.fDesg < 1.3 || terc.fUso < 1 ? 'mais que dobrar' : 'sustentar'} o valor da hora
        liberada.
      </>
    ) : (
      <>
        Com +{num(horasExtrasNovas)} h você chega a {num(extra.totalSemana, 1)} h semanais reais.
        {extra.passaDe50 ? (
          <>
            {' '}
            Se a sua semana toda coubesse abaixo de 50 h, as mesmas horas valeriam{' '}
            <strong>{brl(extra.rendaExtraSemDecaimento)}</strong>/mês em vez de{' '}
            {brl(extra.rendaExtraMes)} — o desconto é todo do excesso de jornada.
          </>
        ) : (
          <>
            {' '}
            Abaixo de ~50 h não há desconto de produtividade — mas cada hora a mais aproxima você
            do limiar, e o valor em bem-estar de renda extra cai com o log da renda.
          </>
        )}
      </>
    )

  /* ------------------------------ Render ------------------------------ */
  return (
    <ToolPage
      icon={<Hourglass size={20} />}
      title="Custo de oportunidade do seu tempo"
      description="Quanto vale sua hora — e quando vale mais investir em você, terceirizar tarefas ou proteger tempo de qualidade."
      inputs={
        <>
          <Card title="Seu trabalho hoje">
            <div className="space-y-4">
              <SliderField
                label="Renda líquida mensal"
                value={renda}
                onChange={setRenda}
                min={1500}
                max={50000}
                step={100}
                format={brl}
                hint="O que cai na conta, depois de impostos. Referência: renda média do trabalho no Brasil = R$ 3.722/mês (PNAD Contínua, 1º tri/2026)."
              />
              <SliderField
                label="Horas contratadas/semana"
                value={hContratada}
                onChange={v => setHContratada(Math.round(v))}
                min={20}
                max={60}
                step={1}
                format={v => `${num(v)} h`}
                hint="Jornada CLT padrão: 44 h/semana."
              />
              <SliderField
                label="Horas extras habituais/semana"
                value={hExtraHabitual}
                onChange={v => setHExtraHabitual(Math.round(v))}
                min={0}
                max={30}
                step={1}
                format={v => `${num(v)} h`}
                hint="Horas além do contrato que você já faz toda semana — pagas ou não, elas consomem sua vida e entram na conta da hora real."
              />
              <SliderField
                label="Dias presenciais/semana"
                value={diasPresenciais}
                onChange={v => setDiasPresenciais(Math.round(v))}
                min={0}
                max={7}
                step={1}
                format={v => `${num(v)} dias`}
              />
              <SliderField
                label="Deslocamento ida+volta/dia"
                value={deslocMin}
                onChange={setDeslocMin}
                min={0}
                max={240}
                step={5}
                format={v => `${num(v)} min`}
                hint="Porta a porta, somando ida e volta. Média BR: ~30 min por trajeto; RMs de SP e RJ ~31% acima (IPEA TD 1813). Stutzer & Frey 2008: +1 h de trajeto ≈ −0,28 ponto de satisfação com a vida — e salário maior normalmente NÃO compensa."
              />
              <SliderField
                label="Preparo + descompressão/dia"
                value={prepMin}
                onChange={setPrepMin}
                min={0}
                max={120}
                step={5}
                format={v => `${num(v)} min`}
                hint="Arrumar-se para trabalhar + o tempo de 'desligar' depois. O método Your Money or Your Life conta esse tempo como trabalho — sem ele, o emprego não aconteceria."
              />
              <SliderField
                label="Gastos que só existem pelo trabalho"
                value={gastosTrabalho}
                onChange={setGastosCustom}
                min={0}
                max={20000}
                step={50}
                format={brl}
                hint="Transporte, roupa de trabalho, comida na rua, 'recompensas' de fim de expediente. Default: 8% da renda (convenção do app inspirada no YMOYL) — edite para o seu caso."
              />
              {gastosCustom === null && (
                <p className="text-[11px] text-mute">
                  Usando o padrão de 8% da renda ({brl(gastosTrabalho)}). Mova o slider para
                  personalizar.
                </p>
              )}
            </div>
          </Card>

          <Card title="O que você quer avaliar">
            <div className="space-y-4">
              <Segmented<Modo>
                options={[
                  { value: 'skill', label: 'Investir em você' },
                  { value: 'terceirizar', label: 'Terceirizar' },
                  { value: 'extra', label: 'Hora extra' },
                ]}
                value={modo}
                onChange={setModo}
              />

              {modo === 'skill' && (
                <>
                  <div>
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <label className="text-xs font-medium text-ink-2">Tipo de investimento</label>
                      <InfoTip text={SKILLS[tipoSkill].fonte} />
                    </div>
                    <select
                      value={tipoSkill}
                      onChange={e => {
                        setTipoSkill(e.target.value as TipoSkill)
                        setDwCustom(null)
                      }}
                      className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs font-semibold text-ink outline-none focus:border-accent"
                    >
                      {(Object.keys(SKILLS) as TipoSkill[]).map(k => (
                        <option key={k} value={k}>
                          {SKILLS[k].label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <SliderField
                    label="Aumento salarial esperado"
                    value={deltaW}
                    onChange={setDwCustom}
                    min={1}
                    max={60}
                    step={1}
                    format={v => `+${pct(v, 0)}`}
                    hint={SKILLS[tipoSkill].fonte}
                  />
                  <SliderField
                    label="Custo total do curso"
                    value={custoSkill}
                    onChange={setCustoSkill}
                    min={0}
                    max={60000}
                    step={250}
                    format={brl}
                    hint="Mensalidades, material, provas de certificação — tudo que sai do bolso."
                  />
                  <SliderField
                    label="Horas de estudo/semana"
                    value={horasEstudo}
                    onChange={v => setHorasEstudo(Math.round(v))}
                    min={1}
                    max={20}
                    step={1}
                    format={v => `${num(v)} h`}
                  />
                  <SliderField
                    label="Duração do estudo"
                    value={duracaoMeses}
                    onChange={v => setDuracaoMeses(Math.round(v))}
                    min={3}
                    max={36}
                    step={1}
                    format={v => `${num(v)} meses`}
                  />
                  <SliderField
                    label="Chance de capturar o aumento"
                    value={chanceCaptura}
                    onChange={v => setChanceCaptura(Math.round(v))}
                    min={30}
                    max={90}
                    step={5}
                    format={v => pct(v, 0)}
                    hint="Nem todo curso vira aumento ou promoção. Este é um parâmetro SEU (quão aquecido está seu mercado, quão visível será a skill) — não é ciência."
                  />
                  <SliderField
                    label="Horizonte de carreira"
                    value={horizonteAnos}
                    onChange={v => setHorizonteAnos(Math.round(v))}
                    min={3}
                    max={30}
                    step={1}
                    format={v => `${num(v)} anos`}
                    hint="Por quantos anos você ainda colherá o aumento. Quanto mais cedo na carreira, maior o retorno de estudar."
                  />
                  <Collapse title="Premissas avançadas">
                    <div className="space-y-4">
                      <SliderField
                        label="Estudo que sai de tempo pago/produtivo (k)"
                        value={kEstudo}
                        onChange={setKEstudo}
                        min={0}
                        max={1}
                        step={0.05}
                        format={v => pct(v * 100, 0)}
                        hint="Que fração do estudo sai de tempo que valeria dinheiro (trabalho, lazer que recarrega)? Default 50% — convenção do app, ajuste ao seu caso."
                      />
                      <SliderField
                        label="Desconto real"
                        value={descontoReal}
                        onChange={setDescontoReal}
                        min={0}
                        max={15}
                        step={0.5}
                        format={v => `${pct(v, 1)} a.a.`}
                        hint="Juro real do Tesouro IPCA+ em 2026: ~7% a.a. Tudo nesta análise está em termos reais (sem inflação) — salário e benefício também."
                      />
                    </div>
                  </Collapse>
                </>
              )}

              {modo === 'terceirizar' && (
                <>
                  <Segmented<Tarefa>
                    options={(Object.keys(TAREFAS) as Tarefa[]).map(k => ({
                      value: k,
                      label: TAREFAS[k].label,
                    }))}
                    value={tarefa}
                    onChange={t => {
                      setTarefa(t)
                      setPrecoServico(TAREFAS[t].preco)
                      setHorasLiberadas(TAREFAS[t].horas)
                    }}
                    label="Tarefa"
                    hint="Preços de referência: faxina R$ 380/mês (12 h), marmitas R$ 700/mês (20 h), lavanderia R$ 250/mês (6 h). Edite abaixo para a sua realidade."
                  />
                  <SliderField
                    label="Preço do serviço"
                    value={precoServico}
                    onChange={setPrecoServico}
                    min={0}
                    max={3000}
                    step={10}
                    format={v => `${brl(v)}/mês`}
                  />
                  <SliderField
                    label="Horas liberadas/mês"
                    value={horasLiberadas}
                    onChange={v => setHorasLiberadas(Math.round(v))}
                    min={1}
                    max={60}
                    step={1}
                    format={v => `${num(v)} h`}
                  />
                  <Segmented<Desgosto>
                    options={[
                      { value: 'gosto', label: 'Gosto' },
                      { value: 'tantofaz', label: 'Tanto faz' },
                      { value: 'detesto', label: 'Detesto' },
                    ]}
                    value={desgosto}
                    onChange={setDesgosto}
                    label="Você detesta essa tarefa?"
                    hint="Fatores 0,8 / 1,0 / 1,3 — convenção do app inspirada em Whillans (PNAS 2017): os maiores ganhos de bem-estar vêm de terceirizar o que se detesta. Não é medida científica."
                  />
                  <Segmented<Uso>
                    options={[
                      { value: 'sei', label: 'Já sei o que fazer' },
                      { value: 'naosei', label: 'Não sei' },
                    ]}
                    value={uso}
                    onChange={setUso}
                    label="O que fará com o tempo?"
                    hint="Trabalho, estudo, família, lazer ativo contam como destino claro (fator 1,0). Sem destino, metade do valor se perde em rolagem de tela (fator 0,5) — convenção do app inspirada no Time Smart (Whillans)."
                  />
                </>
              )}

              {modo === 'extra' && (
                <>
                  <SliderField
                    label="Horas extras adicionais/semana"
                    value={horasExtrasNovas}
                    onChange={v => setHorasExtrasNovas(Math.round(v))}
                    min={1}
                    max={20}
                    step={1}
                    format={v => `${num(v)} h`}
                  />
                  <Segmented<Adicional>
                    options={[
                      { value: 'clt', label: 'CLT +50%' },
                      { value: 'pj', label: 'PJ 0%' },
                      { value: 'custom', label: 'Outro' },
                    ]}
                    value={tipoAdicional}
                    onChange={setTipoAdicional}
                    label="Adicional sobre a hora"
                    hint="CLT: hora extra paga no mínimo +50% (CF art. 7º, XVI). PJ sem adicional: a hora a mais vale o mesmo que a normal."
                  />
                  {tipoAdicional === 'custom' && (
                    <SliderField
                      label="Adicional personalizado"
                      value={adicionalCustom}
                      onChange={v => setAdicionalCustom(Math.round(v))}
                      min={0}
                      max={150}
                      step={5}
                      format={v => `+${pct(v, 0)}`}
                    />
                  )}
                  <Segmented<Origem>
                    options={[
                      { value: 'lazer', label: 'Lazer' },
                      { value: 'familia', label: 'Família' },
                      { value: 'sono', label: 'Sono' },
                    ]}
                    value={origem}
                    onChange={setOrigem}
                    label="De onde sai o tempo?"
                    hint="Toda hora extra sai de algum lugar. O app monetiza o que você ganha — mas nunca põe preço no que você perde: só avisa."
                  />
                </>
              )}
            </div>
          </Card>
        </>
      }
      results={
        <>
          {base.clamped && (
            <div className="rounded-xl border border-warning/40 bg-surface-2 px-4 py-3 text-xs leading-relaxed text-ink-2">
              <strong className="text-warning">Atenção:</strong> seus gastos por causa do trabalho (
              {brl(gastosTrabalho)}) são maiores ou iguais à sua renda líquida ({brl(renda)}). Pelo
              método YMOYL, sua hora real vale <strong>R$ 0</strong> — o emprego, nessas premissas,
              não deixa dinheiro. Revise os gastos ou a renda; as análises abaixo usam R$ 0/hora.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile
              label="Sua hora no contracheque"
              value={base.wNominal}
              format={brlCents}
              sub={`${num(hContratada)} h/semana contratadas`}
            />
            <StatTile
              label="Sua hora de verdade"
              value={base.wReal}
              format={brlCents}
              sub={`−${pct(Math.max(0, base.quedaPct), 1)} vs contracheque`}
              tone="accent"
            />
            <StatTile
              label="Horas reais/mês"
              value={base.horasMes}
              format={v => `${num(v, 1)} h`}
              sub={`semana real de ${num(base.horasSemana, 1)} h`}
            />
            <StatTile
              label="1 h/dia desperdiçada custa"
              value={base.horaDesperdicadaMes}
              format={brl}
              sub="por mês (21,7 dias úteis)"
              tone="negative"
            />
          </div>

          <Verdict winner={verdictWinner} detail={verdictDetail} tone={verdictTone} badge={verdictBadge} />

          <ExportBar
            pagina="tempo"
            resumo={resumo}
            csv={csv}
            premissas={[...premissasBase, ...premissasModo]}
          />

          {modo === 'skill' && (
            <>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <StatTile
                  label={`VPL em ${num(horizonteAnos)} anos`}
                  value={skill.vpl}
                  format={brl}
                  sub={`descontado a ${pct(descontoReal, 1)} a.a. real`}
                  tone={skill.vpl >= 0 ? 'positive' : 'negative'}
                />
                <StatTile
                  label="Payback"
                  value={skill.payback}
                  format={v => (Number.isFinite(v) ? `${num(v, 1)} anos` : '—')}
                  sub={
                    Number.isFinite(skill.payback)
                      ? 'contando a rampa de 2–3 anos'
                      : skill.vpl > 0
                        ? 'sem custo líquido a recuperar'
                        : 'não se paga no horizonte'
                  }
                  tone={Number.isFinite(skill.payback) || skill.vpl > 0 ? 'positive' : 'negative'}
                />
                <StatTile
                  label="Aumento mínimo p/ empatar"
                  value={skill.dwMinPct}
                  format={v => (Number.isFinite(v) ? `+${pct(v, 1)}` : '—')}
                  sub="vs deixar o dinheiro no Tesouro IPCA+"
                  tone="accent"
                />
                <StatTile
                  label="Custo total do investimento"
                  value={skill.custoTotal}
                  format={brl}
                  sub={`inclui ${brl(skill.custoTempo)} do seu tempo de estudo`}
                />
              </div>

              <Card
                title="Quando o estudo se paga"
                subtitle={`VPL acumulado ano a ano (benefícios em R$ de hoje − custo total). O aumento entra com rampa: 25% no 1º ano após o estudo, 60% no 2º, 100% do 3º em diante (Card-Kluve-Weber 2018)`}
              >
                <VLineChart
                  data={skill.serie}
                  series={[{ key: 'vpl', name: 'VPL acumulado', colorIndex: 0 }]}
                  xKey="ano"
                  xFormat={v => `${v}a`}
                  yFormat={brlCompact}
                  refY={0}
                  refYLabel="empate"
                />
                {skill.alertaPencavel && (
                  <p className="mt-3 rounded-xl border border-warning/40 bg-surface-2 px-4 py-3 text-[11px] leading-relaxed text-ink-2">
                    <strong className="text-warning">Alerta Pencavel:</strong> sua semana real já
                    tem {num(base.horasSemana, 1)} h; somando {num(horasEstudo)} h de estudo você
                    chega a {num(skill.horasComEstudo, 1)} h — acima de ~50 h/semana sua
                    produtividade por hora cai, e parte do estudo vai sair do seu rendimento (ou o
                    estudo render menos). Considere reduzir o ritmo e alongar a duração.
                  </p>
                )}
              </Card>

              <Card
                title="E se o aumento for outro?"
                subtitle={`VPL no horizonte se o aumento capturado for metade, igual ou 50% maior que os +${pct(deltaW, 0)} estimados`}
              >
                <VBarChart
                  data={skill.cenarios}
                  series={[{ key: 'vpl', name: 'VPL' }]}
                  xKey="label"
                  yFormat={brlCompact}
                  height={240}
                  colorByValue={row => (Number(row.vpl) < 0 ? c.negative : c.positive)}
                />
              </Card>
            </>
          )}

          {modo === 'terceirizar' && (
            <>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <StatTile
                  label="Ganho líquido/mês"
                  value={terc.ganhoMes}
                  format={brl}
                  sub={terc.ganhoMes >= 0 ? 'tempo vale mais do que custa' : 'serviço custa mais do que o tempo vale'}
                  tone={terc.ganhoMes >= 0 ? 'positive' : 'negative'}
                />
                <StatTile
                  label="Preço da hora liberada"
                  value={terc.precoHora}
                  format={brlCents}
                  sub={`${brl(precoServico)} ÷ ${num(horasLiberadas)} h`}
                />
                <StatTile
                  label="Valor da hora para você"
                  value={terc.valorHoraLiberada}
                  format={brlCents}
                  sub={`hora real × ${num(terc.fDesg, 1)} desgosto × ${num(terc.fUso, 1)} uso`}
                  tone="accent"
                />
                <StatTile
                  label="Horas de vida/ano"
                  value={horasLiberadas * 12}
                  format={v => `${num(v)} h`}
                  sub={`${num(horasLiberadas * 12 / 24, 1)} dias inteiros de volta`}
                />
              </div>

              <Card
                title="O que a hora custa × o que ela vale"
                subtitle="Se a barra do valor for maior que a do preço, terceirizar compensa até no frio do dinheiro"
              >
                <VBarChart
                  data={[
                    { label: 'Preço do serviço/mês', valor: precoServico },
                    { label: 'Valor do tempo para você/mês', valor: terc.valorMes },
                  ]}
                  series={[{ key: 'valor', name: 'R$/mês' }]}
                  xKey="label"
                  yFormat={brl}
                  height={240}
                  colorByValue={(_row, i) => (i === 0 ? c.series[1] : c.series[0])}
                />
                <p className="mt-3 text-[11px] leading-relaxed text-mute">
                  Whillans et al. (PNAS 2017, n = 6.271): gastar com serviços que economizam tempo
                  prevê maior satisfação com a vida em todos os níveis de renda — e num experimento,
                  US$ 40 gastos em tempo geraram mais felicidade que US$ 40 em objetos. Mesmo
                  assim, só 2% das pessoas pensam em comprar tempo, e metade dos milionários não
                  terceiriza nada. Se a conta acima empatar, o desempate da ciência é a favor do
                  tempo.
                </p>
              </Card>
            </>
          )}

          {modo === 'extra' && (
            <>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <StatTile
                  label="Renda extra/mês"
                  value={extra.rendaExtraMes}
                  format={brl}
                  sub={`+${pct(extra.deltaRendaPct, 1)} sobre a renda atual`}
                />
                <StatTile
                  label="Hora extra 'cheia'"
                  value={extra.brutoHora}
                  format={brlCents}
                  sub={`nominal + ${pct(adicionalPct, 0)}`}
                />
                <StatTile
                  label="Valor efetivo/hora"
                  value={extra.efetivoMedioHora}
                  format={brlCents}
                  sub={extra.passaDe50 ? 'após o desconto de produtividade' : 'sem desconto (abaixo de 50 h)'}
                  tone={extra.efetivoMedioHora < base.wNominal ? 'negative' : 'accent'}
                />
                <StatTile
                  label="Semana real ficaria com"
                  value={extra.totalSemana}
                  format={v => `${num(v, 1)} h`}
                  sub={extra.passaDe50 ? 'acima do limiar de ~50 h (Pencavel)' : 'abaixo do limiar de ~50 h'}
                  tone={extra.passaDe50 ? 'negative' : 'neutral'}
                />
              </div>

              <Card
                title="Quanto vale cada hora a mais, conforme a semana enche"
                subtitle={`Valor efetivo da hora extra (${pct(adicionalPct, 0)} de adicional) × total de horas semanais. Acima de ~50 h aplicamos o fator Pencavel — uma aproximação didática do decaimento de produtividade, não uma medida exata`}
              >
                <VLineChart
                  data={extra.curva}
                  series={[{ key: 'valor', name: 'Valor efetivo da hora extra', colorIndex: 0 }]}
                  xKey="h"
                  xFormat={v => `${v}h`}
                  yFormat={brlCents}
                  refY={base.wNominal}
                  refYLabel="sua hora nominal"
                  height={260}
                />
                <p className="mt-3 rounded-xl bg-surface-2 px-4 py-3 text-[11px] leading-relaxed text-ink-2">
                  <strong className="text-ink">Leitura log-linear:</strong> essas horas aumentam sua
                  renda em <strong>{pct(extra.deltaRendaPct, 1)}</strong> (de {brl(renda)} para{' '}
                  {brl(renda + extra.rendaExtraMes)}). O bem-estar sobe com o <em>log</em> da renda:
                  dobrar de R$ 3 mil para R$ 6 mil vale tanto quanto dobrar de R$ 10 mil para R$ 20
                  mil — então pergunte-se quanto {pct(extra.deltaRendaPct, 1)} muda a sua vida, não
                  quanto são {brl(extra.rendaExtraMes)}. (Killingsworth 2021; KKM, PNAS 2023)
                </p>
              </Card>

              <div className="rounded-2xl border border-warning/40 bg-surface p-5">
                <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-ink">
                  {origem === 'familia' ? (
                    <HeartHandshake size={15} className="text-warning" />
                  ) : origem === 'sono' ? (
                    <Moon size={15} className="text-warning" />
                  ) : (
                    <Armchair size={15} className="text-warning" />
                  )}
                  O que essas {num(horasExtrasNovas)} h/semana custam — e que não entra na conta
                </div>
                <p className="text-xs leading-relaxed text-ink-2">
                  {origem === 'familia' ? (
                    <>
                      Esse tempo sairia da sua família — e este app <strong>não põe preço nisso,
                      de propósito</strong>. A pesquisa mostra que, com adolescentes, é o tempo{' '}
                      <strong>engajado</strong> que protege (menos comportamentos de risco — Milkie
                      et al. 2015), e que o tipo de tempo importa mais que o total (Hsin &amp;
                      Felfe 2014). A renda extra calculada acima ignora esse custo: a troca ameaça
                      blocos que não têm preço, e nenhum número desta página deve ser lido como
                      "compensa financeiramente" reduzi-los.
                    </>
                  ) : origem === 'sono' ? (
                    <>
                      Esse tempo sairia do seu sono. Além de acelerar a queda de produtividade que
                      já desconta o valor da hora (Pencavel 2015 — a jornada longa "cobra
                      recuperação"), a sensação de tempo suficiente prevê mais bem-estar mesmo
                      controlando pela renda (Kasser &amp; Sheldon 2009). A ciência do dinheiro ×
                      tempo é consistente: quem prospera <strong>compra</strong> tempo, não vende o
                      sono (Whillans, PNAS 2017).
                    </>
                  ) : (
                    <>
                      Esse tempo sairia do seu lazer. "Time affluence" — a sensação de não estar
                      apressado — prevê mais bem-estar mesmo controlando pela abundância material
                      (Kasser &amp; Sheldon 2009, 4 estudos); e gastar para <strong>ganhar</strong>{' '}
                      tempo, não para vendê-lo, é o que aparece ligado à satisfação com a vida
                      (Whillans et al., PNAS 2017, n = 6.271). Antes de vender essas horas por{' '}
                      {brl(extra.rendaExtraMes)}/mês, cheque se o lazer que sai é o que recarrega
                      você.
                    </>
                  )}
                </p>
              </div>
            </>
          )}

          <Didatico passos={passos} analogia={analogia} sensibilidade={sensibilidade} />

          <Card title="Premissas e fontes">
            <ul className="list-disc space-y-1.5 pl-4 text-[11px] leading-relaxed text-ink-2">
              <li>
                <strong>Custo-hora real:</strong> Robin &amp; Dominguez, <em>Your Money or Your
                Life</em> — horas reais somam deslocamento, preparo e descompressão; ganhos reais
                descontam os gastos que só existem pelo trabalho (
                <a className="underline decoration-line underline-offset-2 hover:text-accent" href="https://vickirobin.com/your-money-or-your-life-summary/" target="_blank" rel="noreferrer">vickirobin.com</a>
                ). Mês = semana × 4,345.
              </li>
              <li>
                <strong>Comprar tempo:</strong> Whillans, Dunn et al., PNAS 2017 — n = 6.271 em 4
                países + experimento causal (n = 60) (
                <a className="underline decoration-line underline-offset-2 hover:text-accent" href="https://www.pnas.org/doi/10.1073/pnas.1706541114" target="_blank" rel="noreferrer">pnas.org</a>
                ).
              </li>
              <li>
                <strong>Retorno de educação:</strong> Psacharopoulos &amp; Patrinos 2018 — ~9–10%
                por ano de estudo; América Latina 11% (
                <a className="underline decoration-line underline-offset-2 hover:text-accent" href="https://www.tandfonline.com/doi/abs/10.1080/09645292.2018.1484426" target="_blank" rel="noreferrer">Education Economics</a>
                ). OCDE <em>Education at a Glance</em> 2025: no Brasil, ensino superior paga +148%
                sobre o médio (
                <a className="underline decoration-line underline-offset-2 hover:text-accent" href="https://www.oecd.org/en/publications/education-at-a-glance-2025_1a3543e2-en/brazil_d42263a0-en.html" target="_blank" rel="noreferrer">oecd.org</a>
                ).
              </li>
              <li>
                <strong>Rampa 25/60/100%:</strong> convenção do app inspirada em Card, Kluve &amp;
                Weber 2018 (meta-análise: efeitos de treinamento aparecem 2–3 anos depois — {' '}
                <a className="underline decoration-line underline-offset-2 hover:text-accent" href="https://academic.oup.com/jeea/article-abstract/16/3/894/4430618" target="_blank" rel="noreferrer">JEEA</a>
                ) — não é medida científica.
              </li>
              <li>
                <strong>Fator Pencavel:</strong> aproximação didática do decaimento de produtividade
                acima de ~50 h/semana — máx(0,6; 1 − 0,04 × horas acima de 50) — inspirada em
                Pencavel 2015 (
                <a className="underline decoration-line underline-offset-2 hover:text-accent" href="https://onlinelibrary.wiley.com/doi/abs/10.1111/ecoj.12166" target="_blank" rel="noreferrer">Economic Journal</a>
                ).
              </li>
              <li>
                <strong>Deslocamento:</strong> Stutzer &amp; Frey 2008 — +1 h de trajeto ≈ −0,28
                ponto de satisfação com a vida; salário maior normalmente não compensa (
                <a className="underline decoration-line underline-offset-2 hover:text-accent" href="https://www.bsfrey.ch/wp-content/uploads/2021/08/stress-that-doesnt-pay-the-commuting-paradox.pdf" target="_blank" rel="noreferrer">paper</a>
                ). Brasil: ~30 min/trajeto, SP/RJ +31% (IPEA TD 1813).
              </li>
              <li>
                <strong>Renda × bem-estar:</strong> Killingsworth 2021 (1,7 mi de relatos) e
                Killingsworth, Kahneman &amp; Mellers, PNAS 2023 — o bem-estar sobe com o log da
                renda (
                <a className="underline decoration-line underline-offset-2 hover:text-accent" href="https://www.pnas.org/doi/10.1073/pnas.2208661120" target="_blank" rel="noreferrer">pnas.org</a>
                ).
              </li>
              <li>
                <strong>Família:</strong> Milkie, Nomaguchi &amp; Denny 2015 e Hsin &amp; Felfe
                2014 — o tipo de tempo importa mais que o total; na adolescência, tempo engajado
                protege. Por isso tempo de família <strong>nunca</strong> vira R$ aqui, e os
                alertas são assimétricos: só contra reduzir esses blocos, nunca a favor.
              </li>
              <li>
                <strong>Time affluence:</strong> Kasser &amp; Sheldon 2009 — sentir-se sem pressa
                prevê bem-estar mesmo controlando pela abundância material.
              </li>
              <li>
                <strong>Parâmetros de design (não são ciência):</strong> fatores de desgosto
                (0,8–1,3) e de uso do tempo (0,5/1,0), k = 50% do estudo saindo de tempo pago,
                chance de captura de {pct(chanceCaptura, 0)} e a rampa — todos ajustáveis e
                rotulados como convenção do app. Renda média BR: R$ 3.722/mês (PNAD T1/2026).
              </li>
            </ul>
          </Card>
        </>
      }
    />
  )
}
