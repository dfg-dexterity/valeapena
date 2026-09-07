/**
 * Morar — Alugar × comprar imóvel (v3: dados de mercado 2026, ITBI por cidade,
 * cartório por tabela real, IR de ganho de capital e IPTU com rigor).
 * Compara morar de aluguel vs comprar o mesmo imóvel, em VPL
 * (taxa de desconto = custo de oportunidade líquido de 15% de IR, como no Carro).
 * A linha "comprar" desconta, mês a mês, quanto a venda do imóvel devolveria
 * (já líquida de corretagem, saldo devedor e IR sobre o ganho, quando devido).
 * FGTS e caução entram pelo "forgone value": o custo de usar dinheiro preso é
 * o valor (baixo) que ele deixaria de render, não o CDI.
 */
import { useId, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, KeyRound } from 'lucide-react'
import {
  Card,
  Collapse,
  DataTable,
  Didatico,
  ExportBar,
  InfoTip,
  LiveBadge,
  NumberField,
  SectionTitle,
  Segmented,
  SliderField,
  StatTile,
  Toggle,
  ToolPage,
  Verdict,
} from '../components/ui'
import { VBarChart, VLineChart, type SeriesDef } from '../components/charts'
import { aToM, pmtPrice, priceSchedule, sacSchedule } from '../lib/finance'
import { brl, brlCents, brlCompact, meses, num, pct } from '../lib/format'
import { useRates } from '../lib/rates'
import {
  DFI_ALIQUOTA_MES,
  IPTU_EFETIVO_AA,
  ITBI_CIDADES,
  REGRAS_IMOBILIARIO,
  TARIFA_ADM_MENSAL,
  custoCartorio,
  mipAliquota,
} from '../lib/dados2026'
import { irGanhoCapitalImovel } from '../lib/tax2026'

/** Alíquota de IR de renda fixa acima de 720 dias — usada para o "CDI líquido". */
const IR_LONGO_PRAZO = 0.15
/** Aluguel default = 0,51% do valor do imóvel/mês (rental yield 6,14% a.a., FipeZap jul/2026). */
const YIELD_ALUGUEL_MES = 0.0051

/* ---------------- constantes v2 (pesquisa ago/2026) ---------------- */
/** Rendimento efetivo do FGTS: TR + 3% a.a. + distribuição de resultados do fundo —
 *  7,09% (2022), 7,78% (2023), 6,05% (2024) e 6,90% (2025) → média ~7,0% a.a.
 *  Desde o STF (ADI 5090, jun/2024) há piso de IPCA. Fonte: fgts.gov.br. */
const FGTS_RENDIMENTO_AA_DEFAULT = 7.0
/** Condomínio de referência: ~0,10% do valor do imóvel/mês, piso R$ 530 —
 *  média nacional de R$ 527/mês; capital SP R$ 1.085/mês (Censo Condominial
 *  2026 / Data Lello). O condomínio ORDINÁRIO fica FORA da conta (inquilino
 *  paga — art. 23, §1º, Lei 8.245/91); ele só serve de base para a cota
 *  extraordinária, essa sim do dono. */
const CONDOMINIO_FRAC_MES = 0.001
const CONDOMINIO_PISO_MES = 530
/** Extraordinárias + fundo de reserva: do PROPRIETÁRIO por lei (Lei 8.245/91,
 *  art. 22, parágrafo único: obras estruturais, pintura de fachada, fundo de
 *  reserva) — tipicamente ~10% do boleto de condomínio. */
const EXTRAORDINARIAS_PCT_DEFAULT = 10
/** Seguro residencial do dono: faixa de mercado R$ 300–800/ano (cotações 2026). */
const SEGURO_RESIDENCIAL_ANO_DEFAULT = 500
/** Seguro-fiança: modalidade líder nas capitais — 31,4% dos contratos novos
 *  (CRECI-SP, jan/2026); mercado cobra 8–15% do aluguel anual → default 12%. */
const SEGURO_FIANCA_PCT_DEFAULT = 12
/** Caução: máximo legal de 3 aluguéis (Lei 8.245/91, art. 38, §2º),
 *  devolvidos no fim corrigidos pela poupança. */
const CAUCAO_ALUGUEIS = 3
/** Seguro incêndio: a lei o atribui ao locador (art. 22, VIII), mas a praxe
 *  contratual transfere ao inquilino — R$ 15–50/mês ≈ 0,8% do aluguel. */
const INCENDIO_PCT_DEFAULT = 0.8
/** Pintura na devolução do imóvel: ~1 aluguel vigente (dever de restituir o
 *  imóvel como recebeu — art. 23, III; guias 2026: 1–1,5 aluguel). */
const PINTURA_ALUGUEIS = 1
/** Mudança local em capital: ~R$ 2.000 (guias de frete/mudança, 2026). */
const MUDANCA_DEFAULT = 2000
/** Contrato-padrão de locação de 30 meses → mudança a cada ~3 anos. */
const MUDANCA_CADA_ANOS_DEFAULT = 3

type ModoCompra = 'avista' | 'financiado'
type Sistema = 'sac' | 'price'
type Garantia = 'fiador' | 'fianca' | 'caucao'
type IdxReajuste = 'igpm' | 'ipca' | 'outro'

/** eixo/tooltip dos gráficos temporais: mês → "hoje", "8m", "12,5 anos" */
function fmtTempo(v: string | number): string {
  const m = Number(v)
  if (!Number.isFinite(m)) return String(v)
  if (m === 0) return 'hoje'
  if (m < 12) return `${m}m`
  const a = m / 12
  return `${a.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${a <= 1 ? 'ano' : 'anos'}`
}

function Aviso({ tone, children }: { tone: 'warning' | 'negative'; children: ReactNode }) {
  const box =
    tone === 'negative' ? 'border-negative/40 bg-negative-soft' : 'border-warning/40 bg-warning-soft'
  const icon = tone === 'negative' ? 'text-negative' : 'text-warning'
  return (
    <div className={`themed flex items-start gap-2.5 rounded-xl border px-4 py-3 ${box}`}>
      <AlertTriangle size={14} className={`mt-0.5 shrink-0 ${icon}`} />
      <p className="text-xs leading-relaxed text-ink-2">{children}</p>
    </div>
  )
}

export default function Morar() {
  const rates = useRates()

  /* ------------------------- inputs principais ------------------------- */
  const [valorImovel, setValorImovel] = useState(500_000)
  /** padrão user-override: default acompanha 0,51% do valor até o usuário editar */
  const [aluguelUser, setAluguelUser] = useState<number | null>(null)
  const [horizonteAnos, setHorizonteAnos] = useState(10)
  const [modoCompra, setModoCompra] = useState<ModoCompra>('avista')
  const [entradaPct, setEntradaPct] = useState(20)
  const [sistema, setSistema] = useState<Sistema>('sac')
  const [prazoFin, setPrazoFin] = useState(360)
  const [taxaFinUser, setTaxaFinUser] = useState<number | null>(null)
  const [idade, setIdade] = useState(35)
  const [valorizacaoAa, setValorizacaoAa] = useState(5.5)
  const [idxReajuste, setIdxReajuste] = useState<IdxReajuste>('igpm')
  const [reajusteUser, setReajusteUser] = useState<number | null>(null)
  const [custoOpUser, setCustoOpUser] = useState<number | null>(null)

  /* --------------------------- FGTS (v2 — A) --------------------------- */
  const [fgtsUsado, setFgtsUsado] = useState(0)
  const [fgtsRendAa, setFgtsRendAa] = useState(FGTS_RENDIMENTO_AA_DEFAULT)

  /* ------------------- custos do dono (v2 — B) ------------------- */
  /** padrão user-override: default acompanha o valor do imóvel até o usuário editar */
  const [condominioUser, setCondominioUser] = useState<number | null>(null)
  const [extraordPct, setExtraordPct] = useState(EXTRAORDINARIAS_PCT_DEFAULT)
  const [seguroResAno, setSeguroResAno] = useState(SEGURO_RESIDENCIAL_ANO_DEFAULT)
  const [mudancaCompra, setMudancaCompra] = useState(MUDANCA_DEFAULT)

  /* ----------------- custos do inquilino (v2 — C) ----------------- */
  const [garantia, setGarantia] = useState<Garantia>('fianca')
  const [segFiancaPct, setSegFiancaPct] = useState(SEGURO_FIANCA_PCT_DEFAULT)
  const [incendioPct, setIncendioPct] = useState(INCENDIO_PCT_DEFAULT)
  const [mudancaCadaAnos, setMudancaCadaAnos] = useState(MUDANCA_CADA_ANOS_DEFAULT)
  const [mudancaAluguel, setMudancaAluguel] = useState(MUDANCA_DEFAULT)

  /* ------------------------ premissas avançadas ------------------------ */
  const [cidadeItbi, setCidadeItbi] = useState('São Paulo')
  const [itbiPct, setItbiPct] = useState(REGRAS_IMOBILIARIO.itbiPct * 100)
  const [primeiroSfh, setPrimeiroSfh] = useState(false)
  const [taxaAvaliacao, setTaxaAvaliacao] = useState<number>(REGRAS_IMOBILIARIO.taxaAvaliacao)
  const [tarifaAdm, setTarifaAdm] = useState<number>(TARIFA_ADM_MENSAL)
  const [manutPctAno, setManutPctAno] = useState(0.8)
  const [corretagemPct, setCorretagemPct] = useState(6)
  const [isencaoVenda, setIsencaoVenda] = useState(true)
  const [iptuRepassado, setIptuRepassado] = useState(true)
  const [iptuPctAa, setIptuPctAa] = useState(IPTU_EFETIVO_AA * 100)
  const [trUser, setTrUser] = useState<number | null>(null)
  const idItbiCidade = useId()

  /** defaults ao vivo (BCB) enquanto o usuário não mexe */
  const taxaFin = taxaFinUser ?? rates.imobMercado
  const custoOp = custoOpUser ?? rates.cdi
  const reajuste =
    idxReajuste === 'igpm'
      ? rates.igpm12m
      : idxReajuste === 'ipca'
        ? rates.ipca12m
        : (reajusteUser ?? rates.igpm12m)
  /** escritura + registro pela tabela real de cartório (SP/RJ 2026); −50% p/ 1º imóvel SFH */
  const cartorioCusto = custoCartorio(
    Math.max(1, valorImovel),
    primeiroSfh && modoCompra === 'financiado',
  )
  const trAnualizadaPct = (Math.pow(1 + rates.trMes / 100, 12) - 1) * 100
  const trAa = trUser ?? trAnualizadaPct
  const poupancaMesPct = rates.poupancaMes
  const aluguel0 =
    aluguelUser ??
    Math.min(30_000, Math.max(500, Math.round((valorImovel * YIELD_ALUGUEL_MES) / 50) * 50))
  const condominioRef =
    condominioUser ??
    Math.max(CONDOMINIO_PISO_MES, Math.round((valorImovel * CONDOMINIO_FRAC_MES) / 10) * 10)

  /* ----------------------------- simulação ----------------------------- */
  const sim = useMemo(() => {
    const anos = Math.min(30, Math.max(1, Math.round(horizonteAnos)))
    const N = anos * 12
    const descontoAa = Math.max(0, custoOp) * (1 - IR_LONGO_PRAZO)
    const d = aToM(descontoAa)

    const val = Math.max(1, valorImovel)
    const g = Math.min(15, Math.max(0, valorizacaoAa))
    const fVal = Math.pow(1 + g / 100, 1 / 12)
    /** valor do imóvel no mês m (valorização geométrica) */
    const valorEm = (m: number) => val * Math.pow(fVal, m)

    const alu0 = Math.min(30_000, Math.max(500, aluguel0))
    const reaj = Math.min(30, Math.max(0, reajuste))
    const corret = Math.min(20, Math.max(0, corretagemPct)) / 100
    const manutFrac = Math.max(0, manutPctAno) / 100

    const financiado = modoCompra === 'financiado'
    const entrada = financiado ? (val * Math.min(100, Math.max(0, entradaPct))) / 100 : val
    const principal = Math.max(0, val - entrada)
    const temFin = financiado && principal > 0
    const nFin = Math.min(420, Math.max(1, Math.round(prazoFin)))
    const jurosMes = aToM(Math.max(0, taxaFin) + Math.max(0, trAa))
    const dfiMes = val * DFI_ALIQUOTA_MES
    const tarifaAdmMes = Math.min(50, Math.max(0, tarifaAdm))
    const extrasFn = (mes: number, saldo: number) =>
      saldo * mipAliquota(idade + (mes - 1) / 12) + dfiMes + tarifaAdmMes
    const parcelas = temFin
      ? sistema === 'sac'
        ? sacSchedule(principal, jurosMes, nFin, extrasFn)
        : priceSchedule(principal, jurosMes, nFin, extrasFn)
      : []
    const p1 = parcelas[0]?.parcela ?? 0

    // FGTS (forgone value): só até o teto de imóvel e no máximo a entrada.
    const fgtsPedido = Math.max(0, fgtsUsado)
    const fgtsPermitido = val <= REGRAS_IMOBILIARIO.tetoSfh
    const fgtsS = fgtsPermitido ? Math.min(fgtsPedido, entrada) : 0
    const fgtsIgnorado = fgtsPedido > 0 && !fgtsPermitido
    const fgtsClampado = fgtsPermitido && fgtsPedido > entrada + 1e-6
    const gfAa = Math.max(0, fgtsRendAa)
    const gfM = aToM(gfAa)
    /** fator mensal do custo de usar o FGTS: cresce a g_f, é descontado a d */
    const razaoFgts = (1 + gfM) / (1 + d)

    // Custos do dono (crescem com o reajuste, como o aluguel)
    const extraordFrac = Math.min(25, Math.max(0, extraordPct)) / 100
    const extraordMes0 = Math.max(0, condominioRef) * extraordFrac
    const seguroResMes0 = Math.max(0, seguroResAno) / 12

    // Custos do inquilino
    const incendioFrac = Math.min(3, Math.max(0, incendioPct)) / 100
    const fiancaFrac = garantia === 'fianca' ? Math.min(20, Math.max(0, segFiancaPct)) / 100 : 0
    const poupM = Math.max(0, poupancaMesPct) / 100
    const razaoPoup = (1 + poupM) / (1 + d)
    const caucao0 = garantia === 'caucao' ? CAUCAO_ALUGUEIS * alu0 : 0
    // mudança a cada X anos (X = 0 → nunca muda); step 0,5 ano → ciclo em meses exato
    const cicloMeses = Math.round(Math.min(10, Math.max(0, mudancaCadaAnos)) * 12)
    const custoMudancaRent = Math.max(0, mudancaAluguel)

    // t0: entrada (ou preço cheio) + custos de transação + mudança da compra
    const itbiVal = (val * Math.max(0, itbiPct)) / 100
    const cartorioVal = Math.max(0, cartorioCusto)
    const custosT0 =
      itbiVal +
      cartorioVal +
      (financiado ? Math.max(0, taxaAvaliacao) : 0) +
      Math.max(0, mudancaCompra)

    // IR de ganho de capital na venda (IN SRF 84/2001: ITBI e emolumentos
    // integram o custo de aquisição; a corretagem paga deduz do preço de venda).
    // Isenções: toggle (art. 39, Lei 11.196/2005) e automática p/ venda ≤ R$ 440 mil
    // (único imóvel — art. 23, Lei 9.250/95). FR2 (1,0035^meses) dentro da função.
    const custoAquis = val + itbiVal + cartorioVal
    const irVendaEm = (v: number, m: number) =>
      isencaoVenda || v <= 440_000 ? 0 : irGanhoCapitalImovel(v * (1 - corret) - custoAquis, m)

    // IPTU: fora da conta quando o contrato repassa ao inquilino (praxe de
    // mercado — igual dos dois lados); sem repasse, só o dono paga.
    const iptuFrac = iptuRepassado ? 0 : Math.min(0.02, Math.max(0, iptuPctAa / 100))

    // A parte da entrada paga com FGTS não sai do bolso "caro": o custo dela é
    // o forgone value, somado adiante como fgtsS × razaoFgts^m.
    let pvSaidasBuy = entrada - fgtsS + custosT0
    let pvParcelas = 0
    let pvManut = 0
    let pvIptu = 0
    let pvExtraord = 0
    let pvSegRes = 0
    let pvAluguel = 0
    let pvIncendio = 0
    let pvFianca = 0
    let pvMudancaFixa = 0
    let pvPintura = 0

    const chartFull: Array<{ mes: number; comprar: number; alugar: number }> = [
      { mes: 0, comprar: 0, alugar: 0 },
    ]
    const tabela: Array<{
      ano: number
      valor: number
      aluguelMes: number
      saldo: number
      vpBuy: number
      vpRent: number
    }> = []

    for (let m = 1; m <= N; m++) {
      const df = Math.pow(1 + d, -m)
      const v = valorEm(m)
      // reajuste aplicado a cada 12 meses completos de contrato
      const fReaj = Math.pow(1 + reaj / 100, Math.floor((m - 1) / 12))
      const manutM = (manutFrac * v) / 12
      const iptuM = (iptuFrac * v) / 12
      const extraordM = extraordMes0 * fReaj
      const segResM = seguroResMes0 * fReaj
      const parcela = temFin && m <= nFin ? parcelas[m - 1].parcela : 0
      const saldo = temFin && m <= nFin ? parcelas[m - 1].saldo : 0
      const aluguelM = alu0 * fReaj

      pvParcelas += parcela * df
      pvManut += manutM * df
      pvIptu += iptuM * df
      pvExtraord += extraordM * df
      pvSegRes += segResM * df
      pvSaidasBuy += (parcela + manutM + iptuM + extraordM + segResM) * df

      pvAluguel += aluguelM * df
      pvIncendio += aluguelM * incendioFrac * df
      pvFianca += aluguelM * fiancaFrac * df
      // ciclo de mudança do inquilino (meses ciclo, 2×ciclo, …; nunca no mês 0)
      if (cicloMeses > 0 && m % cicloMeses === 0) {
        pvMudancaFixa += custoMudancaRent * df
        pvPintura += aluguelM * PINTURA_ALUGUEIS * df
      }

      // custo em VP de ter usado o FGTS, avaliado no mês m: o saldo teria
      // virado fgtsS×(1+gf)^m — descontado a d, fgtsS×razaoFgts^m
      const fgtsCustoM = fgtsS * Math.pow(razaoFgts, m)
      // caução: 3 aluguéis presos rendendo poupança, devolvidos se sair em m
      const caucaoCustoM = caucao0 * (1 - Math.pow(razaoPoup, m))

      // custo líquido em VP se vender o imóvel (pagando corretagem, IR sobre o
      // ganho — quando devido — e quitando o saldo) no mês m
      const comprarSeVender =
        pvSaidasBuy - (v * (1 - corret) - saldo) * df + irVendaEm(v, m) * df + fgtsCustoM
      const alugarAteM =
        pvAluguel + pvIncendio + pvFianca + pvMudancaFixa + pvPintura + caucaoCustoM
      chartFull.push({ mes: m, comprar: comprarSeVender, alugar: alugarAteM })

      if (m % 12 === 0) {
        tabela.push({
          ano: m / 12,
          valor: v,
          aluguelMes: alu0 * Math.pow(1 + reaj / 100, m / 12 - 1),
          saldo,
          vpBuy: comprarSeVender,
          vpRent: alugarAteM,
        })
      }
    }

    const dfN = Math.pow(1 + d, -N)
    const vFim = valorEm(N)
    const saldoN = temFin && N <= nFin ? parcelas[N - 1].saldo : 0
    const custoBuy = chartFull[N].comprar
    const custoRent = chartFull[N].alugar

    // Decomposição em VP com identidade exata:
    //   capVP    = preço − venda futura em VP (capital imobilizado, já abatida a valorização)
    //   jurosVP  = entrada + PV(parcelas) + saldo final em VP − preço (custo extra de financiar,
    //              com MIP, DFI e tarifa de administração)
    //   transVP  = ITBI + cartório + avaliação + mudança (t0) + corretagem da venda em VP
    //              + IR de ganho de capital na venda em VP
    //   manEncVP = manutenção + IPTU do dono (se não repassado) + extraordinárias
    //              + seguro residencial do dono, em VP
    //   fgtsCredito = fgtsS − fgtsS×razaoFgts^N (≥ 0 quando g_f < d): crédito, não vira fatia
    //   capVP + jurosVP + transVP + manEncVP − fgtsCredito === custoBuy
    // Lado alugar:
    //   pvAluguel + garantiaVP + pvIncendio + pvMudancaFixa + pvPintura === custoRent
    const ganhoVenda = vFim * (1 - corret) - custoAquis
    const isentoAuto = !isencaoVenda && vFim <= 440_000
    const irVendaN = irVendaEm(vFim, N)
    const irVendaVP = irVendaN * dfN
    const capVP = val - vFim * dfN
    const jurosVP = financiado ? entrada + pvParcelas + saldoN * dfN - val : 0
    const corretagemVP = vFim * corret * dfN
    const transVP = custosT0 + corretagemVP + irVendaVP
    const manEncVP = pvManut + pvIptu + pvExtraord + pvSegRes
    const fgtsCredito = fgtsS - fgtsS * Math.pow(razaoFgts, N)
    const caucaoVP = caucao0 * (1 - Math.pow(razaoPoup, N))
    const garantiaVP = garantia === 'caucao' ? caucaoVP : garantia === 'fianca' ? pvFianca : 0
    const extrasRentVP = garantiaVP + pvIncendio + pvMudancaFixa + pvPintura

    // Break-even robusto (mesma regra do Carro): primeiro mês a partir do qual
    // comprar fica mais barato ATÉ O FIM — as linhas podem se cruzar mais de uma vez.
    let ultimoMesComprarPior = 0
    let comprarJaFoiMaisBarato = false
    for (let m = 1; m <= N; m++) {
      if (chartFull[m].comprar > chartFull[m].alugar) ultimoMesComprarPior = m
      else comprarJaFoiMaisBarato = true
    }
    const breakEven: number | null = ultimoMesComprarPior < N ? ultimoMesComprarPior + 1 : null

    const diff = custoRent - custoBuy // > 0 → comprar é mais barato
    const eqMes = pmtPrice(Math.abs(diff), d, N)
    // Aluguel de equilíbrio (v2): custoRent(A) = k×A + parte fixa. Tudo escala
    // com o aluguel (aluguéis, garantia, incêndio, pintura), EXCETO o frete das
    // mudanças (pvMudancaFixa) → resolve-se o empate isolando o termo fixo.
    const kRent = alu0 > 0 ? (custoRent - pvMudancaFixa) / alu0 : NaN
    const aluguelEq =
      Number.isFinite(kRent) && kRent > 1e-9 ? (custoBuy - pvMudancaFixa) / kRent : NaN

    // amostragem para o gráfico (a conta acima é sempre mensal)
    const step = Math.max(1, Math.ceil(N / 180))
    const chartData = chartFull.filter((p, i) => i % step === 0 || p.mes === N)

    return {
      anos,
      N,
      descontoAa,
      financiado,
      temFin,
      entrada,
      principal,
      p1,
      custosT0,
      alu0,
      g,
      reaj,
      corretPct: corret * 100,
      vFim,
      valorizAcumPct: (Math.pow(1 + g / 100, anos) - 1) * 100,
      saldoN,
      custoBuy,
      custoRent,
      capVP,
      jurosVP,
      transVP,
      corretagemVP,
      itbiVal,
      cartorioVal,
      custoAquis,
      ganhoVenda,
      isentoAuto,
      irVendaN,
      irVendaVP,
      pvManut,
      pvIptu,
      pvExtraord,
      pvSegRes,
      manEncVP,
      pvAluguel,
      pvIncendio,
      pvFianca,
      pvMudancaFixa,
      pvPintura,
      garantiaVP,
      caucaoVP,
      caucao0,
      extrasRentVP,
      cicloMeses,
      fgtsS,
      fgtsCredito,
      fgtsIgnorado,
      fgtsClampado,
      gfAa,
      breakEven,
      comprarJaFoiMaisBarato,
      diff,
      eqMes,
      aluguelEq,
      chartData,
      tabela,
    }
  }, [
    horizonteAnos,
    custoOp,
    valorImovel,
    valorizacaoAa,
    aluguel0,
    reajuste,
    corretagemPct,
    manutPctAno,
    modoCompra,
    entradaPct,
    sistema,
    prazoFin,
    taxaFin,
    trAa,
    idade,
    itbiPct,
    cartorioCusto,
    tarifaAdm,
    isencaoVenda,
    iptuRepassado,
    iptuPctAa,
    taxaAvaliacao,
    fgtsUsado,
    fgtsRendAa,
    condominioRef,
    extraordPct,
    seguroResAno,
    mudancaCompra,
    garantia,
    segFiancaPct,
    incendioPct,
    mudancaCadaAnos,
    mudancaAluguel,
    poupancaMesPct,
  ])

  /* --------------------------- avisos (LTV etc.) --------------------------- */
  const entradaMinPct = Math.round(
    (1 - (sistema === 'sac' ? REGRAS_IMOBILIARIO.ltvMaxSac : REGRAS_IMOBILIARIO.ltvMaxPrice)) * 100,
  )
  const entradaOk = !sim.financiado || entradaPct >= entradaMinPct - 1e-9
  const idadeFim = idade + prazoFin / 12
  const idadeOk = !sim.financiado || idadeFim <= REGRAS_IMOBILIARIO.idadeMaxFimContrato
  const prazoMaxIdade = Math.max(0, Math.floor((REGRAS_IMOBILIARIO.idadeMaxFimContrato - idade) * 12))
  const nomeSistema = sistema === 'sac' ? 'SAC' : 'Price'
  const temAvisos = !entradaOk || !idadeOk || sim.fgtsIgnorado || sim.fgtsClampado

  /* ------------------------------ veredito ------------------------------ */
  const compraLabel = sim.financiado ? 'comprar financiado' : 'comprar à vista'
  const buyWins = sim.diff > 0
  const empate = Math.abs(sim.diff) < Math.max(sim.custoBuy, sim.custoRent, 1) * 0.02
  const garantiaLabel =
    garantia === 'fianca' ? 'seguro-fiança' : garantia === 'caucao' ? 'caução' : 'fiador'

  const fgtsFrase =
    sim.fgtsS > 0
      ? ` Da entrada, ${brl(sim.fgtsS)} vêm do FGTS — preso no fundo, esse dinheiro renderia ${pct(
          sim.gfAa,
          1,
        )} a.a.: ${
          sim.fgtsCredito >= 0
            ? `menos que seu custo de oportunidade líquido, então usá-lo barateia a compra em ${brl(
                sim.fgtsCredito,
              )} em VP.`
            : `neste caso raro, MAIS que seu custo de oportunidade líquido — usá-lo encarece a compra em ${brl(
                -sim.fgtsCredito,
              )} em VP.`
        }`
      : ''

  const verdictWinner = empate
    ? 'Empate técnico — decida pelo que pesa na sua vida'
    : buyWins
      ? `Vale mais a pena ${compraLabel}: economia de ${brlCents(sim.eqMes)}/mês`
      : `Vale mais a pena continuar no aluguel: economia de ${brlCents(sim.eqMes)}/mês`
  const verdictDetail = `Em ${sim.anos} ${sim.anos === 1 ? 'ano' : 'anos'}, ${compraLabel} custa ${brl(
    sim.custoBuy,
  )} e alugar custa ${brl(sim.custoRent)} (aluguéis + ${garantiaLabel}, seguro incêndio e mudanças), em valor presente — a compra já devolve a venda do imóvel no fim (menos ${pct(
    sim.corretPct,
    0,
  )} de corretagem${sim.saldoN > 0 ? ' e o saldo devedor' : ''}). Diferença de ${brl(
    Math.abs(sim.diff),
  )}, o equivalente a ${brlCents(sim.eqMes)} por mês, descontando o que o dinheiro renderia a ${pct(
    sim.descontoAa,
    1,
  )} a.a. (custo de oportunidade líquido de 15% de IR).${fgtsFrase} Atenção: a valorização do imóvel (${pct(
    sim.g,
    1,
  )} a.a. na sua premissa) é o parâmetro mais sensível desta conta — ninguém a conhece de antemão; teste cenários antes de decidir.`
  const verdictBadge = empate
    ? 'Diferença menor que 2%'
    : sim.breakEven === null
      ? sim.comprarJaFoiMaisBarato
        ? 'Alugar vence no seu horizonte'
        : 'Alugar lidera o período todo'
      : sim.breakEven <= 1
        ? 'Comprar ganha desde o 1º mês'
        : `Break-even: ${meses(sim.breakEven)}`

  /* ------------------------------ gráficos ------------------------------ */
  const linhaSeries: SeriesDef[] = [
    { key: 'comprar', name: sim.financiado ? 'Comprar (financiado)' : 'Comprar (à vista)', colorIndex: 0 },
    { key: 'alugar', name: 'Alugar', colorIndex: 1 },
  ]

  /**
   * Fatias negativas não funcionam em barra empilhada (mesma solução do Carro):
   * - se a valorização supera o desconto, o "capital imobilizado" vira crédito;
   * - se a taxa do financiamento fica abaixo do desconto, os juros viram crédito;
   * - o FGTS gera um crédito próprio (fgtsCredito): usar dinheiro preso rendendo
   *   pouco custa menos que usar dinheiro livre — não vira fatia, vira nota;
   * - no aluguel, se a poupança render mais que o desconto, a caução vira crédito.
   */
  const capCredito = sim.capVP < 0 ? -sim.capVP : 0
  const jurosCredito = sim.financiado && sim.jurosVP < 0 ? -sim.jurosVP : 0
  const fgtsCred = Math.max(0, sim.fgtsCredito)
  const fgtsDebito = Math.max(0, -sim.fgtsCredito)
  const rentCredito = sim.extrasRentVP < 0 ? -sim.extrasRentVP : 0
  const rentExtrasSlice = Math.max(0, sim.extrasRentVP)
  const temCredito =
    capCredito > 0 || jurosCredito > 0 || fgtsCred > 0.005 || fgtsDebito > 0.005 || rentCredito > 0.005
  const compSeries: SeriesDef[] = [
    ...(sim.capVP > 0
      ? [{ key: 'cap', name: 'Capital imobilizado − valorização', colorIndex: 0 } satisfies SeriesDef]
      : []),
    ...(sim.financiado && sim.jurosVP > 0
      ? [{ key: 'jur', name: 'Juros + seguros do financiamento', colorIndex: 5 } satisfies SeriesDef]
      : []),
    { key: 'trans', name: 'Transação (ITBI, cartório, corretagem, mudança)', colorIndex: 2 },
    { key: 'man', name: 'Manutenção e encargos do dono', colorIndex: 3 },
    { key: 'alu', name: 'Aluguel', colorIndex: 1 },
    ...(rentExtrasSlice > 0
      ? [{ key: 'extra', name: 'Garantia, seguros e mudanças', colorIndex: 4 } satisfies SeriesDef]
      : []),
  ]
  const compData = [
    {
      opcao: 'Comprar',
      cap: Math.max(0, sim.capVP),
      jur: Math.max(0, sim.jurosVP),
      trans: sim.transVP,
      man: sim.manEncVP,
      alu: 0,
      extra: 0,
    },
    { opcao: 'Alugar', cap: 0, jur: 0, trans: 0, man: 0, alu: sim.pvAluguel, extra: rentExtrasSlice },
  ]

  const garantiaNota =
    garantia === 'fianca'
      ? `o seguro-fiança de ${pct(segFiancaPct, 0)} do aluguel (${brl(sim.garantiaVP)} em VP — pago todo mês, não devolvido)`
      : garantia === 'caucao'
        ? `o custo de oportunidade da caução (${brl(sim.caucao0)} parados rendendo poupança em vez de ${pct(
            sim.descontoAa,
            1,
          )} a.a. — ${
            sim.garantiaVP >= 0
              ? `${brl(sim.garantiaVP)} em VP`
              : `crédito de ${brl(-sim.garantiaVP)} em VP, pois a poupança rende mais que o desconto`
          })`
        : 'a garantia por fiador (custo zero)'

  const tabelaColunas: ReactNode[] = [
    'Ano',
    'Valor do imóvel',
    'Aluguel vigente',
    ...(sim.financiado ? ['Saldo devedor'] : []),
    'VP acum. — comprar',
    'VP acum. — alugar',
  ]
  const tabelaAlign: Array<'l' | 'r'> = [
    'l',
    'r',
    'r',
    ...(sim.financiado ? (['r'] as const) : []),
    'r',
    'r',
  ]

  /* ----------------------------- exportação ----------------------------- */
  const idxLabel =
    idxReajuste === 'igpm' ? 'IGP-M' : idxReajuste === 'ipca' ? 'IPCA' : 'personalizado'
  const anosLabel = `${sim.anos} ${sim.anos === 1 ? 'ano' : 'anos'}`
  const resumo = [
    'vale a pena? — Morar: alugar × comprar',
    `Veredito: ${verdictWinner}`,
    `Horizonte de ${anosLabel} · imóvel de ${brl(valorImovel)} · aluguel inicial de ${brl(sim.alu0)}/mês`,
    `Custo em valor presente — ${compraLabel}: ${brl(sim.custoBuy)} · alugar: ${brl(sim.custoRent)} · diferença: ${brl(Math.abs(sim.diff))} (${brlCents(sim.eqMes)}/mês)`,
    `Aluguel de equilíbrio: ${
      Number.isFinite(sim.aluguelEq) && sim.aluguelEq > 0
        ? `${brl(sim.aluguelEq)}/mês`
        : 'não existe — comprar vence com qualquer aluguel'
    } · break-even: ${sim.breakEven === null ? 'não há no horizonte' : meses(sim.breakEven)}`,
    `Premissas-chave: valorização ${pct(sim.g, 1)} a.a. · reajuste ${idxLabel} ${pct(sim.reaj, 2)} a.a. · desconto ${pct(sim.descontoAa, 1)} a.a.${
      sim.fgtsS > 0 ? ` · FGTS de ${brl(sim.fgtsS)}` : ''
    }${sim.irVendaN > 0 ? ` · IR na venda de ${brl(sim.irVendaN)}` : ''}`,
    'gerado por vale a pena? · Dexterity — valeapena-flame.vercel.app',
  ].join('\n')

  const csvExport = {
    nome: 'ano-a-ano',
    colunas: [
      'Ano',
      'Valor do imóvel (R$)',
      'Aluguel vigente (R$/mês)',
      ...(sim.financiado ? ['Saldo devedor (R$)'] : []),
      'VP acumulado — comprar (R$)',
      'VP acumulado — alugar (R$)',
    ],
    linhas: sim.tabela.map(r => [
      r.ano,
      Math.round(r.valor),
      Math.round(r.aluguelMes),
      ...(sim.financiado ? [Math.round(r.saldo)] : []),
      Math.round(r.vpBuy),
      Math.round(r.vpRent),
    ]),
  }

  const premissasExport: [string, string][] = [
    ['Valor do imóvel', brl(valorImovel)],
    ['Aluguel inicial', `${brl(sim.alu0)}/mês`],
    ['Horizonte', anosLabel],
    ['Forma de compra', sim.financiado ? `Financiado (${nomeSistema})` : 'À vista'],
    ...(sim.financiado
      ? ([
          ['Entrada', `${pct(entradaPct, 0)} (${brl(sim.entrada)})`],
          ['Prazo do financiamento', meses(prazoFin)],
          ['Taxa do financiamento', `${pct(taxaFin, 2)} + TR ${pct(trAa, 2)} a.a.`],
          ['Idade (define o MIP)', `${num(idade)} anos`],
          ['Tarifa de administração', `${brl(tarifaAdm)}/mês`],
          ['Tarifa de avaliação', brl(taxaAvaliacao)],
        ] as [string, string][])
      : []),
    ['Valorização do imóvel', `${pct(sim.g, 1)} a.a.`],
    ['Reajuste do aluguel', `${idxLabel} — ${pct(sim.reaj, 2)} a.a.`],
    ['Custo de oportunidade', `${pct(custoOp, 2)} a.a. (líquido: ${pct(sim.descontoAa, 2)})`],
    ...(sim.fgtsS > 0
      ? ([['FGTS usado', `${brl(sim.fgtsS)} rendendo ${pct(sim.gfAa, 1)} a.a.`]] as [
          string,
          string,
        ][])
      : []),
    ['ITBI', `${cidadeItbi} — ${pct(itbiPct, 1)} (${brl(sim.itbiVal)})`],
    [
      'Escritura + registro',
      `${brl(sim.cartorioVal)}${primeiroSfh && sim.financiado ? ' (−50% SFH)' : ''}`,
    ],
    ['Condomínio de referência', `${brl(condominioRef)}/mês (${pct(extraordPct, 0)} extraordinárias)`],
    ['Seguro residencial (dono)', `${brl(seguroResAno)}/ano`],
    ['Manutenção do dono', `${pct(manutPctAno, 1)}/ano`],
    ['Mudança na compra (t0)', brl(mudancaCompra)],
    [
      'IPTU',
      iptuRepassado
        ? 'repassado ao inquilino (fora da conta)'
        : `só do dono — ${pct(iptuPctAa, 2)} a.a. efetivo`,
    ],
    [
      'Garantia do aluguel',
      garantia === 'fianca'
        ? `Seguro-fiança (${pct(segFiancaPct, 0)} do aluguel)`
        : garantia === 'caucao'
          ? `Caução de ${brl(sim.caucao0)}`
          : 'Fiador',
    ],
    ['Seguro incêndio (inquilino)', `${pct(incendioPct, 1)} do aluguel/mês`],
    [
      'Mudanças no aluguel',
      sim.cicloMeses > 0
        ? `a cada ${fmtTempo(sim.cicloMeses)} (${brl(mudancaAluguel)} + pintura)`
        : 'nenhuma',
    ],
    ['Corretagem na venda', pct(sim.corretPct, 1)],
    [
      'IR de ganho de capital',
      isencaoVenda
        ? 'isento (art. 39, Lei 11.196/2005)'
        : sim.isentoAuto
          ? 'isento — venda ≤ R$ 440 mil'
          : brl(sim.irVendaN),
    ],
  ]

  /* ------------------------------ didática ------------------------------ */
  const didaticoPassos = [
    {
      t: 'Trouxemos tudo para dinheiro de hoje',
      d: (
        <>
          R$ 100 daqui a 5 anos valem menos que R$ 100 agora — dá para saber quanto seus R$ 100
          renderiam no CDI até lá. Por isso cada gasto futuro foi "encolhido" a{' '}
          {pct(sim.descontoAa, 1)} ao ano (seu custo de oportunidade de {pct(custoOp, 1)}, menos 15%
          de IR). Somando tudo em dinheiro de hoje: {compraLabel} custa {brl(sim.custoBuy)} e alugar
          custa {brl(sim.custoRent)}.
        </>
      ),
    },
    {
      t: 'Aluguel não é dinheiro jogado fora',
      d: (
        <>
          Quem aluga paga {brl(sim.pvAluguel)} de aluguéis
          {Math.max(0, sim.extrasRentVP) > 0
            ? ` (+ ${brl(Math.max(0, sim.extrasRentVP))} de garantia, seguros e mudanças)`
            : ''}
          . Mas quem compra também paga para morar:{' '}
          {sim.capVP > 0 ? (
            <>
              deixar {brl(valorImovel)} presos no imóvel em vez de rendendo custa {brl(sim.capVP)}{' '}
              (já abatida a valorização)
            </>
          ) : (
            <>
              na sua premissa a valorização é tão alta que o capital imobilizado vira crédito de{' '}
              {brl(-sim.capVP)}
            </>
          )}
          {sim.financiado && sim.jurosVP > 0 && (
            <>, os juros e seguros do financiamento somam {brl(sim.jurosVP)}</>
          )}
          , mais {brl(sim.manEncVP)} de manutenção e encargos do dono e {brl(sim.transVP)} de ITBI,
          cartório, corretagem{sim.irVendaVP > 0 ? ' e IR da venda' : ''}. Os dois lados têm custo
          invisível — a conta compara os totais.
        </>
      ),
    },
    {
      t: 'O papel do FGTS parado',
      d:
        sim.fgtsS > 0 ? (
          <>
            Da sua entrada, {brl(sim.fgtsS)} vêm do FGTS. Preso no fundo, esse dinheiro rende só{' '}
            {pct(sim.gfAa, 1)} a.a. — bem menos que os {pct(sim.descontoAa, 1)} a.a. do seu dinheiro
            livre. Usar o recurso "barato" na compra{' '}
            {sim.fgtsCredito >= 0 ? (
              <>barateia a conta em {brl(sim.fgtsCredito)}</>
            ) : (
              <>encarece a conta em {brl(-sim.fgtsCredito)}</>
            )}{' '}
            em valor presente.
          </>
        ) : (
          <>
            Você não usou FGTS nesta simulação. Se tiver saldo, vale saber: preso no fundo ele rende
            só ~{pct(FGTS_RENDIMENTO_AA_DEFAULT, 1)} a.a., menos que os {pct(sim.descontoAa, 1)}{' '}
            a.a. do seu dinheiro livre — usá-lo na entrada costuma baratear a compra, porque você
            gasta o dinheiro que rende pouco e preserva o que rende muito.
          </>
        ),
    },
    {
      t: 'A venda no fim fecha a conta',
      d: (
        <>
          Em {anosLabel}, o imóvel valeria {brl(sim.vFim)} (a {pct(sim.g, 1)} a.a.). A conta devolve
          essa venda a quem comprou, menos {pct(sim.corretPct, 0)} de corretagem
          {sim.saldoN > 0 && <>, o saldo devedor de {brl(sim.saldoN)}</>}
          {sim.irVendaN > 0 && <> e {brl(sim.irVendaN)} de IR sobre o ganho</>} — por isso comprar
          pode custar bem menos do que a soma de tudo o que sai do bolso.
        </>
      ),
    },
  ]
  const didaticoAnalogia = (
    <>
      Comprar é como encher um cofre que dá despesa: todo mês você coloca dinheiro nele (parcela ou
      capital parado, manutenção, encargos) e, no fim, quebra o cofre e fica com o que o imóvel
      valer. Alugar é pagar para usar o cofre dos outros — e poder investir o resto.{' '}
      {empate ? (
        <>Aqui os dois cofres praticamente empatam (diferença de {brl(Math.abs(sim.diff))}).</>
      ) : (
        <>
          A pergunta certa não é "quem termina com casa?", e sim "quem termina com mais dinheiro no
          total?" — aqui, {brl(Math.abs(sim.diff))} a favor de {buyWins ? 'comprar' : 'alugar'}.
        </>
      )}
    </>
  )
  const didaticoSensibilidade = (
    <>
      Valorização e horizonte mandam no resultado: você assumiu {pct(sim.g, 1)} a.a. — 2 pontos para
      cima ou para baixo costumam inverter o veredito — e {anosLabel} de horizonte
      {sim.breakEven !== null && sim.breakEven > 1 && (
        <> (comprar só passa a valer a pena ficando mais de {meses(sim.breakEven)})</>
      )}
      . O equilíbrio desta simulação:{' '}
      {Number.isFinite(sim.aluguelEq) && sim.aluguelEq > 0 ? (
        <>
          com aluguel acima de {brl(sim.aluguelEq)}/mês, comprar ganha; abaixo, alugar ganha — o seu
          está em {brl(sim.alu0)}/mês.
        </>
      ) : (
        <>não existe aluguel baixo o bastante para empatar — comprar vence com qualquer aluguel.</>
      )}
    </>
  )

  /* -------------------------------- página ------------------------------- */
  return (
    <ToolPage
      icon={<KeyRound size={20} />}
      title="Morar: alugar × comprar"
      description="Continuar no aluguel ou comprar o imóvel? Comparação em valor presente, com valorização, FGTS, ITBI, corretagem e os custos que só o dono — ou só o inquilino — paga."
      inputs={
        <>
          <Card title="O imóvel">
            <div className="space-y-4">
              <SliderField
                label="Valor do imóvel"
                value={valorImovel}
                onChange={setValorImovel}
                min={100_000}
                max={3_000_000}
                step={10_000}
                format={brl}
                hint="Preço de compra do imóvel. O aluguel de referência ao lado acompanha este valor até você editá-lo."
              />
              <SliderField
                label="Aluguel do mesmo imóvel"
                value={aluguel0}
                onChange={setAluguelUser}
                min={500}
                max={30_000}
                step={50}
                format={v => `${brl(v)}/mês`}
                hint={`Default: 0,51% do valor do imóvel por mês — rental yield de 6,14% a.a., índice FipeZap de locação (jul/2026). Condomínio ordinário${iptuRepassado ? ' e IPTU ficam' : ' fica'} FORA da conta: no Brasil o inquilino normalmente paga${iptuRepassado ? ' os dois' : ''}, então esse custo é igual nos dois lados.`}
              />
              <SliderField
                label="Horizonte"
                value={horizonteAnos}
                onChange={setHorizonteAnos}
                min={1}
                max={30}
                step={1}
                format={v => (v === 1 ? '1 ano' : `${num(v)} anos`)}
                hint="Por quanto tempo você pretende morar nele. No fim do período, a venda do imóvel (menos corretagem e saldo devedor) entra como crédito para quem comprou."
              />
              <SliderField
                label="Valorização do imóvel"
                value={valorizacaoAa}
                onChange={setValorizacaoAa}
                min={0}
                max={15}
                step={0.5}
                format={v => `${pct(v, 1)} a.a.`}
                hint="Default: 5,5% a.a. — venda residencial FipeZap subiu 5,49% em 12 meses (ago/2026). Este é o parâmetro MAIS SENSÍVEL da comparação — 2 pontos para cima ou para baixo costumam inverter o veredito. Premissa conservadora: use o IPCA (imóvel só acompanha a inflação)."
              />
              <Segmented<IdxReajuste>
                label="Índice de reajuste do aluguel"
                value={idxReajuste}
                onChange={setIdxReajuste}
                options={[
                  { value: 'igpm', label: 'IGP-M' },
                  { value: 'ipca', label: 'IPCA' },
                  { value: 'outro', label: 'Outro' },
                ]}
                hint={`Índice escrito no contrato, aplicado a cada 12 meses completos. IGP-M ainda é o dominante nos contratos — e hoje reajusta MENOS que o IPCA (${pct(rates.igpm12m, 2)} × ${pct(rates.ipca12m, 2)} em 12 meses); nem sempre foi assim: em 2021 o IGP-M passou de 37%. Os encargos do dono (extraordinárias, seguro residencial) também crescem por este índice.`}
              />
              {idxReajuste === 'outro' ? (
                <SliderField
                  label="Reajuste anual do aluguel"
                  value={reajuste}
                  onChange={setReajusteUser}
                  min={0}
                  max={15}
                  step={0.5}
                  format={v => `${pct(v, 1)} a.a.`}
                  hint="Reajuste anual do contrato de locação, aplicado a cada 12 meses completos."
                />
              ) : (
                <div className="space-y-2">
                  <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-mute">
                    {idxReajuste === 'igpm' ? 'IGP-M' : 'IPCA'} acumulado 12 meses:{' '}
                    <strong className="tnum text-ink">{pct(reajuste, 2)} a.a.</strong> — aplicado ao
                    aluguel a cada 12 meses completos de contrato.
                  </p>
                  <LiveBadge live={rates.aoVivo} referencia={rates.referencia} />
                </div>
              )}
            </div>
          </Card>

          <Card title="Como você compraria">
            <div className="space-y-4">
              <Segmented<ModoCompra>
                label="Forma de compra"
                options={[
                  { value: 'avista', label: 'À vista' },
                  { value: 'financiado', label: 'Financiado' },
                ]}
                value={modoCompra}
                onChange={setModoCompra}
                hint="À vista: todo o capital fica imobilizado no imóvel desde o dia 1. Financiado: entrada + parcelas com juros, MIP e DFI — como no simulador de financiamento."
              />
              {modoCompra === 'financiado' && (
                <>
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
                  <Segmented<Sistema>
                    label="Sistema de amortização"
                    value={sistema}
                    onChange={setSistema}
                    options={[
                      { value: 'sac', label: 'SAC' },
                      { value: 'price', label: 'Price' },
                    ]}
                    hint="SAC: parcela começa maior e cai todo mês. Price: parcela estável, com mais juros no total."
                  />
                  <SliderField
                    label="Prazo do financiamento"
                    value={prazoFin}
                    onChange={setPrazoFin}
                    min={60}
                    max={REGRAS_IMOBILIARIO.prazoMaxMeses}
                    step={12}
                    format={meses}
                    hint="Se você vender antes de quitar, o saldo devedor é abatido do valor da venda — a conta já faz isso mês a mês."
                  />
                  <SliderField
                    label="Taxa do financiamento"
                    value={taxaFin}
                    onChange={setTaxaFinUser}
                    min={7}
                    max={18}
                    step={0.05}
                    format={v => `${pct(v, 2)} a.a.`}
                    hint="Default: taxa média dos financiamentos imobiliários PF a taxas de mercado (série 20772 do BCB). A TR é somada por cima (edite nas premissas avançadas)."
                  />
                  <SliderField
                    label="Sua idade"
                    value={idade}
                    onChange={setIdade}
                    min={18}
                    max={70}
                    step={1}
                    format={v => `${num(v)} anos`}
                    hint="Define o seguro MIP (morte e invalidez), obrigatório: alíquota mensal sobre o saldo devedor que cresce com a idade — tabela típica de mercado, com a idade avançando ao longo do contrato."
                  />
                  <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-mute">
                    1ª parcela estimada:{' '}
                    <strong className="tnum text-ink">{brlCents(sim.p1)}</strong> (com MIP + DFI) · entrada
                    de <strong className="tnum text-ink">{brl(sim.entrada)}</strong> · financia{' '}
                    <strong className="tnum text-ink">{brl(sim.principal)}</strong>
                  </p>
                </>
              )}
              <SliderField
                label="FGTS usado na compra"
                value={fgtsUsado}
                onChange={setFgtsUsado}
                min={0}
                max={300_000}
                step={5_000}
                format={brl}
                hint="Saldo do FGTS abatido da entrada. Requisitos (fgts.gov.br): 3 anos de trabalho sob FGTS, não ter imóvel residencial no município e não ter financiamento SFH ativo; imóvel de até R$ 2,25 mi (Conselho Curador, 26/11/2025). O FGTS também pode amortizar o saldo a cada 2 anos — não modelado aqui."
              />
              {fgtsUsado > 0 && (
                <SliderField
                  label="Rendimento do FGTS"
                  value={fgtsRendAa}
                  onChange={setFgtsRendAa}
                  min={3}
                  max={10}
                  step={0.1}
                  format={v => `${pct(v, 1)} a.a.`}
                  hint="TR + 3% a.a. + distribuição de resultados do fundo: rendimento efetivo total de 7,09% (2022), 7,78% (2023), 6,05% (2024) e 6,90% (2025) — média de ~7,0% a.a.; desde o STF (ADI 5090, jun/2024) há piso de IPCA. Fonte: fgts.gov.br. Como esse dinheiro rende pouco preso no fundo, usá-lo na compra custa menos que usar dinheiro que renderia CDI."
                />
              )}
              <SliderField
                label="Custo de oportunidade"
                value={custoOp}
                onChange={setCustoOpUser}
                min={0}
                max={30}
                step={0.5}
                format={v => `${pct(v, 1)} a.a.`}
                hint="O que o dinheiro que não vira imóvel renderia investido (default: CDI, média BCB ao vivo). Para trazer os fluxos a valor presente aplicamos 15% de IR sobre o rendimento — alíquota de renda fixa acima de 720 dias (Lei 11.033/2004)."
              />
              <LiveBadge live={rates.aoVivo} referencia={rates.referencia} />
            </div>
          </Card>

          <Collapse title="Custos do dono × do inquilino">
            <div className="space-y-4">
              <SectionTitle>Se comprar (dono)</SectionTitle>
              <SliderField
                label="Condomínio (referência)"
                value={condominioRef}
                onChange={setCondominioUser}
                min={0}
                max={6_000}
                step={10}
                format={v => `${brl(v)}/mês`}
                hint="Default: ~0,10% do valor do imóvel/mês, piso de R$ 530 — média nacional de R$ 527/mês; na capital de SP a média é R$ 1.085/mês (Censo Condominial 2026 / Data Lello); acompanha o valor do imóvel até você editar. O condomínio ORDINÁRIO fica FORA da conta — o inquilino paga (art. 23, §1º, Lei 8.245/91), então é igual dos dois lados. Ele só serve de base para a cota extraordinária abaixo."
              />
              <SliderField
                label="Extraordinárias + fundo de reserva"
                value={extraordPct}
                onChange={setExtraordPct}
                min={0}
                max={25}
                step={1}
                format={v => `${pct(v, 0)} do cond.`}
                hint="Despesas extraordinárias de condomínio são do PROPRIETÁRIO por lei (Lei 8.245/91, art. 22, parágrafo único: obras estruturais, pintura de fachada, fundo de reserva…). Típico: ~10% do boleto. Cresce com o reajuste anual, como o aluguel."
              />
              <SliderField
                label="Seguro residencial (dono)"
                value={seguroResAno}
                onChange={setSeguroResAno}
                min={0}
                max={3_000}
                step={50}
                format={v => `${brl(v)}/ano`}
                hint="Seguro da estrutura do imóvel, típico do proprietário: faixa de mercado de R$ 300–800/ano (cotações 2026). Cresce com o reajuste anual."
              />
              <Toggle
                checked={iptuRepassado}
                onChange={setIptuRepassado}
                label="No aluguel, o contrato repassa o IPTU ao inquilino?"
                hint="Por lei o IPTU é do locador, salvo cláusula em contrário (art. 22, VIII, Lei 8.245/91) — mas o repasse ao inquilino é a praxe do mercado. Repassado (padrão): o IPTU é igual nos dois lados e fica fora da conta. Sem repasse: só o dono paga, e a conta soma o IPTU ao lado de comprar."
              />
              {!iptuRepassado && (
                <SliderField
                  label="IPTU efetivo"
                  value={iptuPctAa}
                  onChange={setIptuPctAa}
                  min={0.2}
                  max={1}
                  step={0.05}
                  format={v => `${pct(v, 2)}/ano`}
                  hint="Alíquota EFETIVA sobre o valor de mercado: a nominal é ~1% sobre o valor venal, que costuma ficar 30–60% abaixo do mercado → efetivo de ~0,4–0,7% a.a. Aplicada sobre o valor atualizado do imóvel, só no lado de comprar."
                />
              )}
              <NumberField
                label="Mudança + adaptação na compra"
                value={mudancaCompra}
                onChange={setMudancaCompra}
                suffix="R$"
                min={0}
                step={100}
                hint="Custo único, na assinatura: frete da mudança e pequenas adaptações — ~R$ 2.000 para mudança local em capital (guias 2026). Entra nos custos de t0, fora do ITBI/registro."
              />

              <SectionTitle>Se alugar (inquilino)</SectionTitle>
              <Segmented<Garantia>
                label="Garantia do contrato"
                value={garantia}
                onChange={setGarantia}
                options={[
                  { value: 'fiador', label: 'Fiador' },
                  { value: 'fianca', label: 'Seguro-fiança' },
                  { value: 'caucao', label: 'Caução' },
                ]}
                hint="Seguro-fiança é a modalidade líder nas capitais: 31,4% dos contratos novos (CRECI-SP, jan/2026). Fiador: custo zero. Caução: 3 aluguéis (máximo legal — art. 38, §2º, Lei 8.245/91) imobilizados hoje e devolvidos no fim corrigidos pela poupança."
              />
              {garantia === 'fianca' && (
                <SliderField
                  label="Seguro-fiança"
                  value={segFiancaPct}
                  onChange={setSegFiancaPct}
                  min={5}
                  max={20}
                  step={1}
                  format={v => `${pct(v, 0)} do aluguel`}
                  hint="Prêmio mensal do seguro-fiança: mercado cobra 8–15% do aluguel anual (≈ 1,0–1,8 aluguel por ano), não devolvido. Default: 12% do aluguel vigente, todo mês."
                />
              )}
              {garantia === 'caucao' && (
                <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-mute">
                  Caução de <strong className="tnum text-ink">{brl(sim.caucao0)}</strong> (3 aluguéis)
                  parada rendendo poupança ({pct(poupancaMesPct, 2)} a.m.) em vez do seu custo de
                  oportunidade —{' '}
                  {sim.caucaoVP >= 0 ? (
                    <>
                      custa <strong className="tnum text-ink">{brl(sim.caucaoVP)}</strong> em VP no
                      horizonte.
                    </>
                  ) : (
                    <>
                      como a poupança rende mais que seu desconto, vira um crédito de{' '}
                      <strong className="tnum text-ink">{brl(-sim.caucaoVP)}</strong> em VP.
                    </>
                  )}
                </p>
              )}
              <SliderField
                label="Seguro incêndio (inquilino)"
                value={incendioPct}
                onChange={setIncendioPct}
                min={0}
                max={3}
                step={0.1}
                format={v => `${pct(v, 1)} do aluguel`}
                hint="R$ 15–50/mês na prática (~0,8% do aluguel). Por lei o seguro contra fogo é do locador (art. 22, VIII, Lei 8.245/91), mas os contratos costumam transferi-lo ao inquilino — se o seu não transfere, use 0."
              />
              <SliderField
                label="Mudança a cada"
                value={mudancaCadaAnos}
                onChange={setMudancaCadaAnos}
                min={0}
                max={10}
                step={0.5}
                format={v => (v === 0 ? 'nunca mudo' : v === 1 ? '1 ano' : `${num(v, 1)} anos`)}
                hint="Contrato-padrão de locação dura 30 meses (~3 anos). A cada ciclo, o inquilino paga frete + pintura de devolução de 1 aluguel vigente (dever de restituir como recebeu — art. 23, III; guias 2026: 1–1,5 aluguel). Use 0 se você ficaria no mesmo imóvel o horizonte todo."
              />
              {mudancaCadaAnos > 0 && (
                <SliderField
                  label="Custo de cada mudança"
                  value={mudancaAluguel}
                  onChange={setMudancaAluguel}
                  min={0}
                  max={10_000}
                  step={100}
                  format={brl}
                  hint="Frete e caixas de uma mudança local em capital: ~R$ 2.000 (guias 2026). A pintura de devolução (1 aluguel vigente) é somada por fora, a cada ciclo."
                />
              )}
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-mute">
                Taxa de cadastro e corretagem de locação: <strong className="text-ink">R$ 0</strong> —
                são do proprietário por lei (art. 22, VII, Lei 8.245/91); cobrar do inquilino é
                contravenção (art. 43).
              </p>
            </div>
          </Collapse>

          <Collapse title="Premissas avançadas">
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <label htmlFor={idItbiCidade} className="text-xs font-medium text-ink-2">
                    Cidade (ITBI)
                  </label>
                  <InfoTip text="Escolher a cidade preenche a alíquota de ITBI abaixo (ela continua editável). Reduções para a parcela financiada pelo SFH existem em SP, Porto Alegre, Florianópolis, Curitiba e Brasília — não modeladas aqui: nelas o ITBI real da compra financiada pode ser menor." />
                </div>
                <select
                  id={idItbiCidade}
                  value={cidadeItbi}
                  onChange={e => {
                    const cidade = e.target.value
                    setCidadeItbi(cidade)
                    const c = ITBI_CIDADES.find(x => x.cidade === cidade)
                    if (c) setItbiPct(c.aliquota * 100)
                  }}
                  className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-accent"
                >
                  {ITBI_CIDADES.map(c => (
                    <option key={c.cidade} value={c.cidade}>
                      {c.cidade} — {pct(c.aliquota * 100, 1)}
                    </option>
                  ))}
                </select>
              </div>
              <NumberField
                label="ITBI"
                value={itbiPct}
                onChange={setItbiPct}
                suffix="%"
                min={0}
                max={5}
                step={0.1}
                hint="Imposto de transmissão pago à vista na compra — alíquota padrão de 2026 da cidade escolhida acima (leis municipais). Quem aluga não paga."
              />
              <Toggle
                checked={primeiroSfh}
                onChange={setPrimeiroSfh}
                label="1º imóvel financiado pelo SFH (−50% no cartório)"
                hint="Lei 6.015/73, art. 290: a primeira aquisição de imóvel residencial financiada pelo SFH tem 50% de desconto nos emolumentos de escritura e registro. O desconto só se aplica no cenário financiado."
              />
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-mute">
                Escritura + registro pela tabela de cartório:{' '}
                <strong className="tnum text-ink">{brl(cartorioCusto)}</strong>
                {primeiroSfh && modoCompra === 'financiado' ? ' (já com −50% do SFH)' : ''} —
                calibrado nas tabelas oficiais de SP (CNB/ARISP) e RJ (CGJ) de 2026: faixas
                degressivas com quase-teto, por isso não é um % fixo do valor.
              </p>
              {modoCompra === 'financiado' && (
                <NumberField
                  label="Tarifa de avaliação"
                  value={taxaAvaliacao}
                  onChange={setTaxaAvaliacao}
                  suffix="R$"
                  min={0}
                  step={100}
                  hint="Cobrada pelo banco para avaliar o imóvel (Caixa 2026: ~R$ 3.100). Só existe na compra financiada."
                />
              )}
              {modoCompra === 'financiado' && (
                <SliderField
                  label="Tarifa de administração"
                  value={tarifaAdm}
                  onChange={setTarifaAdm}
                  min={0}
                  max={50}
                  step={1}
                  format={v => `${brl(v)}/mês`}
                  hint="Tarifa mensal de administração do contrato, somada à parcela junto de MIP e DFI — a Caixa cobra ~R$ 25/mês; bancos privados às vezes isentam (use 0 nesse caso)."
                />
              )}
              <SliderField
                label="Manutenção do proprietário"
                value={manutPctAno}
                onChange={setManutPctAno}
                min={0}
                max={3}
                step={0.1}
                format={v => `${pct(v, 1)}/ano`}
                hint="Reformas, pintura, problemas estruturais — custos que são do dono, não do inquilino. APARTAMENTO: ~0,5%/ano é típico (o condomínio já absorve estrutura e áreas comuns). CASA: use ~1,0%/ano (tudo é do dono). Aplicado sobre o valor atualizado do imóvel."
              />
              <SliderField
                label="Corretagem na venda"
                value={corretagemPct}
                onChange={setCorretagemPct}
                min={0}
                max={10}
                step={0.5}
                format={v => pct(v, 1)}
                hint="Comissão do corretor na venda do imóvel no fim do horizonte — praxe de mercado de 6% (tabelas CRECI). Reduz o valor que a venda devolve a quem comprou e deduz do preço de venda no cálculo do ganho de capital."
              />
              <Toggle
                checked={isencaoVenda}
                onChange={setIsencaoVenda}
                label="Terei isenção de IR na venda"
                hint="Art. 39 da Lei 11.196/2005: vender imóvel residencial e comprar outro em até 180 dias zera o IR sobre o ganho (1 vez a cada 5 anos) — o caso típico de quem vende para morar em outro. Único imóvel vendido por até R$ 440 mil também é isento (art. 23, Lei 9.250/95 — a conta aplica isso sozinha). Desligue se você venderia sem recomprar."
              />
              {modoCompra === 'financiado' && (
                <NumberField
                  label="TR anualizada"
                  value={trAa}
                  onChange={setTrUser}
                  suffix="% a.a."
                  min={0}
                  max={10}
                  step={0.05}
                  hint="Quase todo contrato SBPE é 'taxa + TR'. Default: TR atual do BCB (série 226) anualizada, somada à taxa do financiamento — como no simulador de financiamento."
                />
              )}
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

          <ExportBar pagina="morar" resumo={resumo} csv={csvExport} premissas={premissasExport} />

          {temAvisos && (
            <div className="space-y-2">
              {!entradaOk && (
                <Aviso tone="negative">
                  Entrada de {pct(entradaPct, 0)} é menor que o mínimo de{' '}
                  <strong className="text-ink">{pct(entradaMinPct, 0)}</strong> exigido no {nomeSistema}{' '}
                  (LTV máximo do novo modelo, out/2025). O banco não aprova assim —{' '}
                  {sistema === 'price'
                    ? 'aumente a entrada ou mude para o SAC (que aceita entrada de 20%).'
                    : 'aumente a entrada.'}
                </Aviso>
              )}
              {!idadeOk && (
                <Aviso tone="negative">
                  Sua idade + prazo = {num(idadeFim, 1)} anos no fim do contrato — os bancos limitam a{' '}
                  {num(REGRAS_IMOBILIARIO.idadeMaxFimContrato, 1)} anos. Prazo máximo para {num(idade)}{' '}
                  anos: <strong className="text-ink">{meses(prazoMaxIdade)}</strong>.
                </Aviso>
              )}
              {sim.fgtsIgnorado && (
                <Aviso tone="warning">
                  FGTS ignorado na conta: imóveis acima de{' '}
                  <strong className="text-ink">{brl(REGRAS_IMOBILIARIO.tetoSfh)}</strong> não aceitam FGTS
                  na compra (Conselho Curador do FGTS, 26/11/2025). Reduza o valor do imóvel ou zere o
                  campo.
                </Aviso>
              )}
              {sim.fgtsClampado && (
                <Aviso tone="warning">
                  Você pediu {brl(fgtsUsado)} de FGTS, mas só{' '}
                  <strong className="text-ink">{brl(sim.fgtsS)}</strong> cabem{' '}
                  {sim.financiado ? 'na entrada' : 'no preço do imóvel'} — a conta usa esse valor. (Usar o excedente para amortizar o saldo a cada 2 anos é permitido, mas não
                  é modelado aqui.)
                </Aviso>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile
              label={sim.financiado ? 'Comprar financiado — VP' : 'Comprar à vista — VP'}
              value={sim.custoBuy}
              format={brl}
              sub={`custo em ${sim.anos} ${sim.anos === 1 ? 'ano' : 'anos'}, já com a venda no fim${sim.fgtsS > 0 ? ` e ${brl(sim.fgtsS)} de FGTS` : ''}`}
              tone={!empate && buyWins ? 'positive' : 'neutral'}
            />
            <StatTile
              label="Alugar — VP"
              value={sim.custoRent}
              format={brl}
              sub={`aluguel desde ${brl(sim.alu0)}/mês + ${garantiaLabel}, seguro incêndio e mudanças`}
              tone={!empate && !buyWins ? 'positive' : 'neutral'}
            />
            <StatTile
              label="Valor do imóvel no fim"
              value={sim.vFim}
              format={brl}
              sub={`+${pct(sim.valorizAcumPct, 0)} nominal em ${sim.anos} ${sim.anos === 1 ? 'ano' : 'anos'}, a ${pct(sim.g, 1)} a.a.`}
            />
            <StatTile
              label="Aluguel de equilíbrio"
              value={Number.isFinite(sim.aluguelEq) ? Math.max(0, sim.aluguelEq) : 0}
              format={brl}
              tone="accent"
              sub={
                Number.isFinite(sim.aluguelEq) && sim.aluguelEq > 0
                  ? 'pagando menos que isso, alugar ganha neste horizonte'
                  : 'comprar ganha mesmo com aluguel simbólico'
              }
            />
            {sim.irVendaN > 0 && (
              <StatTile
                label="IR na venda (estimado)"
                value={sim.irVendaN}
                format={brl}
                sub={`sobre ganho de ${brl(sim.ganhoVenda)}, já com o redutor FR2 de ${anosLabel} de posse — ${brl(sim.irVendaVP)} em VP`}
              />
            )}
          </div>

          <Card
            title="Custo acumulado em valor presente"
            subtitle={`A linha de comprar desconta, mês a mês, quanto você recuperaria vendendo o imóvel naquele momento (menos ${pct(sim.corretPct, 0)} de corretagem${sim.financiado ? ' e o saldo devedor' : ''}); a de alugar acumula aluguel, ${garantiaLabel}, seguro incêndio e mudanças`}
          >
            <VLineChart
              data={sim.chartData}
              series={linhaSeries}
              xKey="mes"
              xFormat={fmtTempo}
              yFormat={brlCompact}
            />
            <p className="mt-3 text-[11px] leading-relaxed text-mute">
              {sim.breakEven === null
                ? sim.comprarJaFoiMaisBarato
                  ? 'As linhas chegam a se cruzar, mas alugar termina mais barato no seu horizonte — comprar só compensaria ficando no imóvel por mais tempo.'
                  : 'A linha do aluguel fica abaixo durante todo o horizonte: alugar sai mais barato mesmo contando a venda do imóvel no fim.'
                : sim.breakEven <= 1
                  ? 'Comprar já é mais barato desde o primeiro mês — resultado raro: confira se a valorização que você assumiu é realista.'
                  : `O cruzamento das linhas é o break-even: a partir de ${meses(sim.breakEven)}, comprar fica mais barato que alugar até o fim do horizonte.`}{' '}
              {sim.fgtsS > 0 &&
                `A linha de comprar já cobra o custo real do FGTS: o valor que ${brl(sim.fgtsS)} teriam virado rendendo ${pct(sim.gfAa, 1)} a.a. no fundo. `}
              Lembre: o desenho todo muda com a premissa de valorização.
            </p>
          </Card>

          <Card
            title="De onde vem o custo"
            subtitle={`Composição em valor presente no horizonte de ${sim.anos} ${sim.anos === 1 ? 'ano' : 'anos'}${
              temCredito
                ? ' — créditos não viram fatia (veja a nota abaixo)'
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
              "Capital imobilizado − valorização" é o que você paga pelo imóvel menos o que a venda
              devolve no fim, em valor presente: o custo de deixar {brl(valorImovel)} parados em vez de
              rendendo {pct(sim.descontoAa, 1)} a.a. — a valorização abate parte disso.
              {sim.financiado &&
                sim.jurosVP > 0 &&
                ' "Juros + seguros" é quanto financiar custa a mais do que pagar à vista, em VP (juros, MIP, DFI e tarifa de administração, já líquidos do benefício de adiar pagamentos).'}
              {sim.irVendaVP > 0 &&
                ` A fatia de transação inclui ${brl(sim.irVendaVP)} de IR sobre o ganho de capital da venda, em VP.`}{' '}
              "Manutenção e encargos do dono" junta manutenção ({brl(sim.pvManut)}),{' '}
              {sim.pvIptu > 0 ? <>IPTU não repassado ({brl(sim.pvIptu)}), </> : null}cota
              extraordinária do condomínio ({brl(sim.pvExtraord)}) e seguro residencial (
              {brl(sim.pvSegRes)}) — contas que a Lei 8.245/91 (arts. 22 e 23) deixa com o
              proprietário. No aluguel, além das
              mensalidades{rentExtrasSlice > 0 ? (
                <>
                  , "Garantia, seguros e mudanças" reúne {garantiaNota}, o seguro incêndio (
                  {brl(sim.pvIncendio)}) e{' '}
                  {sim.cicloMeses > 0
                    ? `as mudanças a cada ${fmtTempo(sim.cicloMeses)} (frete + pintura de devolução de 1 aluguel — ${brl(sim.pvMudancaFixa + sim.pvPintura)} em VP)`
                    : 'nenhuma mudança (você assume ficar no mesmo imóvel)'}
                  .
                </>
              ) : (
                ', não há custos extras relevantes na sua premissa.'
              )}
              {sim.fgtsS > 0 &&
                fgtsCred > 0.005 &&
                ` Usar ${brl(sim.fgtsS)} do FGTS gera um crédito de ${brl(
                  fgtsCred,
                )} que não vira fatia: preso no fundo, esse dinheiro renderia só ${pct(
                  sim.gfAa,
                  1,
                )} a.a. — bem menos que os ${pct(
                  sim.descontoAa,
                  1,
                )} a.a. do seu dinheiro livre. Pagar a entrada com o recurso "barato" custa menos, em valor presente; quanto maior o horizonte, maior o desconto.`}
              {sim.fgtsS > 0 &&
                fgtsDebito > 0.005 &&
                ` Na sua premissa o FGTS rende MAIS que seu custo de oportunidade líquido — usá-lo encarece a compra em ${brl(
                  fgtsDebito,
                )} em VP (também fora do gráfico).`}
              {capCredito > 0 &&
                ` Na sua premissa, a valorização de ${pct(sim.g, 1)} a.a. supera o desconto de ${pct(
                  sim.descontoAa,
                  1,
                )} a.a.: o capital imobilizado vira um crédito de ${brl(
                  capCredito,
                )} — por isso as fatias de "Comprar" somam mais que o custo do veredito. Desconfie de premissas que fazem o imóvel "se pagar sozinho".`}
              {jurosCredito > 0 &&
                ` A taxa do financiamento está abaixo do custo de oportunidade: em VP, financiar gera um crédito de ${brl(
                  jurosCredito,
                )}, que também não vira fatia.`}
              {rentCredito > 0 &&
                ` No aluguel, a caução rende mais que seu custo de oportunidade líquido — já descontados o seguro incêndio e as mudanças, o conjunto vira um crédito líquido de ${brl(
                  rentCredito,
                )}, fora do gráfico.`}
            </p>
          </Card>

          <Card
            title="Detalhamento ano a ano"
            subtitle="VP acum. de comprar = custo líquido, em valor presente, se você vendesse o imóvel no fim daquele ano"
          >
            <DataTable
              columns={tabelaColunas}
              align={tabelaAlign}
              rows={sim.tabela.map(r => [
                `${r.ano}º`,
                brl(r.valor),
                `${brl(r.aluguelMes)}/mês`,
                ...(sim.financiado ? [brl(r.saldo)] : []),
                <strong key="b" className={r.vpBuy <= r.vpRent ? 'text-positive' : 'text-ink'}>
                  {brl(r.vpBuy)}
                </strong>,
                <strong key="a" className={r.vpRent < r.vpBuy ? 'text-positive' : 'text-ink'}>
                  {brl(r.vpRent)}
                </strong>,
              ])}
            />
            <p className="mt-2 text-[11px] text-mute">
              "Aluguel vigente" é a mensalidade paga naquele ano, após os reajustes. O VP acumulado de
              alugar inclui garantia, seguro incêndio e mudanças; o de comprar inclui o custo do FGTS
              usado. Verde = opção mais barata até ali.
            </p>
          </Card>

          <Didatico
            passos={didaticoPassos}
            analogia={didaticoAnalogia}
            sensibilidade={didaticoSensibilidade}
          />

          <Card title="Premissas e fontes" subtitle="Tudo é editável nos controles ao lado">
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-ink-2">
              <li>
                Taxa de desconto: custo de oportunidade de {pct(custoOp, 2)} a.a. (default: CDI, média BCB{' '}
                {rates.aoVivo ? 'ao vivo' : 'de referência'}) líquido de 15% de IR — alíquota de renda fixa
                acima de 720 dias (Lei 11.033/2004) — resultando em {pct(sim.descontoAa, 2)} a.a.
              </li>
              <li>
                Aluguel de referência: 0,51% do valor do imóvel por mês (rental yield de 6,14% a.a.,
                índice FipeZap de locação, jul/2026) — acompanha o valor do imóvel até você editá-lo.
                Reajuste de {pct(sim.reaj, 2)} a.a. a cada 12 meses completos (índice: {idxLabel}
                {idxReajuste === 'igpm'
                  ? ', dominante nos contratos — IGP-M 12m da FGV, composto da série 189 do BCB'
                  : idxReajuste === 'ipca'
                    ? ' — IPCA 12m, série 13522 do BCB'
                    : ''}
                ).
              </li>
              <li>
                Valorização de {pct(sim.g, 1)} a.a. (referência: venda residencial FipeZap +5,49% em
                12 meses, ago/2026). Este é o parâmetro mais sensível da comparação e ninguém o
                conhece de antemão — imóveis já passaram décadas rendendo menos que a inflação e
                décadas rendendo muito mais. Premissa conservadora: IPCA.
              </li>
              {fgtsUsado > 0 && (
                <li>
                  FGTS: rendimento de {pct(sim.gfAa, 1)} a.a. (TR + 3% + distribuição de resultados —
                  efetivo entre 6,05% e 7,78% de 2022 a 2025; piso de IPCA desde o STF, ADI 5090,
                  jun/2024 — fonte: fgts.gov.br). Uso na compra exige 3 anos de FGTS, não ter imóvel
                  residencial no município nem financiamento SFH ativo, e imóvel até{' '}
                  {brl(REGRAS_IMOBILIARIO.tetoSfh)} (Conselho Curador, 26/11/2025). Simplificações
                  declaradas: sem a compra, o saldo ficaria intocado até o fim do horizonte (sem
                  saque-aniversário ou rescisão); a amortização extra permitida a cada 2 anos não é
                  modelada.
                </li>
              )}
              <li>
                {iptuRepassado
                  ? 'Condomínio ordinário e IPTU ficam fora dos dois lados: a Lei 8.245/91 até atribui impostos e seguro ao locador "salvo disposição em contrário" (art. 22, VIII), mas a praxe dos contratos transfere ambos ao inquilino — o custo é igual alugando ou comprando.'
                  : `Na sua premissa o contrato NÃO repassa o IPTU ao inquilino (regra legal padrão — art. 22, VIII, Lei 8.245/91): a conta soma ${pct(iptuPctAa, 2)} a.a. do valor atualizado (${brl(sim.pvIptu)} em VP) só ao lado de comprar. O condomínio ordinário continua fora dos dois lados (inquilino paga — art. 23, §1º).`}
              </li>
              <li>
                Dono × inquilino (Lei 8.245/91): despesas ordinárias de condomínio são do inquilino
                (art. 23, §1º); extraordinárias + fundo de reserva são do proprietário (art. 22,
                parágrafo único) — aqui, {pct(extraordPct, 0)} de um condomínio de referência de{' '}
                {brl(condominioRef)}/mês (média nacional R$ 527/mês; capital SP R$ 1.085 — Censo
                Condominial 2026 / Data Lello). Seguro residencial do dono: {brl(seguroResAno)}/ano
                (mercado: R$ 300–800).
              </li>
              <li>
                Garantia do inquilino: {garantiaLabel}. Seguro-fiança lidera nas capitais com 31,4% dos
                contratos novos (CRECI-SP, jan/2026); caução é limitada a 3 aluguéis (art. 38, §2º) e
                devolvida corrigida pela poupança ({pct(poupancaMesPct, 2)} a.m., BCB). Taxa de cadastro
                e corretagem de locação: custo zero para o inquilino por lei (art. 22, VII; cobrar é
                contravenção — art. 43).
              </li>
              <li>
                {sim.cicloMeses > 0
                  ? `Mudanças do inquilino a cada ${fmtTempo(sim.cicloMeses)} (contrato-padrão de 30 meses): ${brl(mudancaAluguel)} de frete + pintura de devolução de 1 aluguel vigente por ciclo (art. 23, III; guias 2026: mudança local ~R$ 2 mil, pintura 1–1,5 aluguel).`
                  : 'Sem mudanças no aluguel (premissa: você ficaria no mesmo imóvel o horizonte todo).'}{' '}
                Na compra, mudança única de {brl(mudancaCompra)} em t0.
              </li>
              <li>
                Custos de transação: ITBI de {pct(itbiPct, 1)} ({cidadeItbi} — alíquotas municipais
                2026) + escritura/registro de {brl(sim.cartorioVal)} pela tabela real de cartório
                (CNB-SP/ARISP e CGJ-RJ 2026; −50% para o 1º imóvel financiado pelo SFH — art. 290,
                Lei 6.015/73{primeiroSfh && sim.financiado ? ', aplicado' : ''})
                {sim.financiado ? `, tarifa de avaliação de ${brl(taxaAvaliacao)}` : ''} e corretagem
                de {pct(sim.corretPct, 1)} na venda (praxe de mercado/CRECI) — total de{' '}
                {brl(sim.custosT0)} na entrada (com a mudança) e {brl(sim.corretagemVP)} de
                corretagem em VP.
              </li>
              <li>
                IR sobre o ganho de capital na venda:{' '}
                {isencaoVenda
                  ? 'zerado pela isenção do art. 39 da Lei 11.196/2005 (vender residencial e comprar outro em 180 dias — 1 vez a cada 5 anos; caso típico de quem vende para morar em outro).'
                  : sim.isentoAuto
                    ? `zerado automaticamente: venda de ${brl(sim.vFim)} ≤ R$ 440 mil (único imóvel — art. 23, Lei 9.250/95).`
                    : sim.irVendaN > 0
                      ? `${brl(sim.irVendaN)} no mês da venda (${brl(sim.irVendaVP)} em VP), sobre ganho de ${brl(sim.ganhoVenda)}.`
                      : 'zero — não há ganho tributável na sua premissa.'}{' '}
                Regra: 15% até R$ 5 mi de ganho (Lei 13.259/2016), base reduzida pelo fator FR2 de
                1,0035^meses de posse (art. 40, Lei 11.196/2005); custo de aquisição inclui ITBI e
                cartório e a corretagem deduz do preço de venda (IN SRF 84/2001).
              </li>
              <li>
                Manutenção do proprietário: {pct(manutPctAno, 1)} do valor atualizado por ano — reformas,
                pintura e estrutura, custos que o inquilino não tem.
              </li>
              {sim.financiado && (
                <li>
                  Financiamento {nomeSistema} a {pct(taxaFin, 2)} a.a. + TR de {pct(trAa, 2)} a.a. (séries
                  20772 e 226 do BCB), com seguros obrigatórios MIP (alíquota mensal por idade sobre o
                  saldo devedor), DFI de {pct(DFI_ALIQUOTA_MES * 100, 3)} a.m. sobre o valor do imóvel e
                  tarifa de administração de {brl(tarifaAdm)}/mês (Caixa ~R$ 25; privados às vezes
                  isentam). Entrada mínima de 20% no SAC e 30% na Price (novo modelo, out/2025).
                  {sim.saldoN > 0
                    ? ` Como o horizonte termina antes do contrato, o saldo devedor de ${brl(sim.saldoN)} é quitado na venda.`
                    : ' O contrato é quitado dentro do horizonte da análise.'}
                </li>
              )}
              <li>
                Aluguel de equilíbrio: quase todo o custo de alugar é proporcional ao aluguel inicial
                (aluguéis, garantia, seguro incêndio e pintura); só o frete das mudanças (
                {brl(sim.pvMudancaFixa)} em VP) é fixo. O empate resolve custo de comprar = k × aluguel +
                parte fixa
                {Number.isFinite(sim.aluguelEq) && sim.aluguelEq > 0
                  ? ` → ${brl(sim.aluguelEq)}/mês`
                  : ' — na sua premissa, comprar custa menos que a parte fixa de alugar: não existe aluguel baixo o bastante para empatar'}
                .
              </li>
              <li>Ferramenta educacional de comparação — não é recomendação financeira.</li>
            </ul>
          </Card>
        </>
      }
    />
  )
}
