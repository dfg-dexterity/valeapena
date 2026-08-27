/**
 * Tabelas tributárias vigentes em 2026 (pesquisadas em ago/2026).
 * Fontes: Decreto 12.797/2025 (salário mínimo), Portaria MPS/MF 13/2026 (INSS),
 * MP 1.294/2025 (tabela IRRF) + Lei 15.270/2025 (redutor/isenção até R$ 5 mil),
 * LC 123/2006 (Simples Nacional).
 */

export const SALARIO_MINIMO_2026 = 1621.0

/* ============================== INSS ============================== */

/** Faixas progressivas do INSS empregado 2026 (teto R$ 8.475,55). */
export const INSS_FAIXAS_2026 = [
  { ate: 1621.0, aliquota: 0.075 },
  { ate: 2902.84, aliquota: 0.09 },
  { ate: 4354.27, aliquota: 0.12 },
  { ate: 8475.55, aliquota: 0.14 },
] as const

export const INSS_TETO_SALARIO_2026 = 8475.55
/** Desconto máximo de INSS do empregado (no teto). */
export const INSS_TETO_DESCONTO_2026 = 988.09

/** INSS do empregado CLT (cálculo progressivo por faixa). */
export function inssClt(salarioBruto: number): number {
  const base = Math.min(Math.max(0, salarioBruto), INSS_TETO_SALARIO_2026)
  let total = 0
  let piso = 0
  for (const f of INSS_FAIXAS_2026) {
    if (base <= piso) break
    const tributavel = Math.min(base, f.ate) - piso
    total += tributavel * f.aliquota
    piso = f.ate
  }
  return total
}

/** INSS do contribuinte individual (pró-labore): 11% até o teto. */
export function inssProLabore(proLabore: number): number {
  return Math.min(Math.max(0, proLabore), INSS_TETO_SALARIO_2026) * 0.11
}

/* ============================== IRRF ============================== */

/** Tabela progressiva mensal (vigente desde mai/2025, mantida em 2026). */
export const IRRF_FAIXAS_2026 = [
  { ate: 2428.8, aliquota: 0, deduzir: 0 },
  { ate: 2826.65, aliquota: 0.075, deduzir: 182.16 },
  { ate: 3751.05, aliquota: 0.15, deduzir: 394.16 },
  { ate: 4664.68, aliquota: 0.225, deduzir: 675.49 },
  { ate: Infinity, aliquota: 0.275, deduzir: 908.73 },
] as const

export const IRRF_DEDUCAO_DEPENDENTE = 189.59
export const IRRF_DESCONTO_SIMPLIFICADO = 607.2

/** Imposto pela tabela progressiva, sobre uma base de cálculo. */
export function irrfTabela(base: number): number {
  if (base <= 0) return 0
  const faixa = IRRF_FAIXAS_2026.find(f => base <= f.ate) ?? IRRF_FAIXAS_2026[4]
  return Math.max(0, base * faixa.aliquota - faixa.deduzir)
}

/**
 * IRRF mensal 2026 com o redutor da Lei 15.270/2025.
 * `brutoTributavel` = rendimento tributável do mês (salário bruto, pró-labore).
 * O teste de elegibilidade do redutor usa o rendimento BRUTO tributável
 * (regra oficial RFB), não a base de cálculo.
 */
export function irrf2026(
  brutoTributavel: number,
  opts: { inss?: number; dependentes?: number; pensao?: number } = {},
): number {
  const inss = opts.inss ?? 0
  const baseLegal =
    brutoTributavel - inss - (opts.dependentes ?? 0) * IRRF_DEDUCAO_DEPENDENTE - (opts.pensao ?? 0)
  const baseSimplificada = brutoTributavel - IRRF_DESCONTO_SIMPLIFICADO
  const base = Math.min(baseLegal, baseSimplificada)
  const imposto = irrfTabela(base)

  // Redutor Lei 15.270/2025 (vigente desde 01/01/2026)
  if (brutoTributavel <= 5000) return 0
  if (brutoTributavel <= 7350) {
    const redutor = Math.max(0, 978.62 - 0.133145 * brutoTributavel)
    return Math.max(0, imposto - redutor)
  }
  return imposto
}

/* ========================= Simples Nacional ========================= */

export interface FaixaSimples {
  ate: number
  aliquota: number
  deduzir: number
}

/** Anexo III (serviços com Fator R ≥ 28%). */
export const SIMPLES_ANEXO_III: FaixaSimples[] = [
  { ate: 180000, aliquota: 0.06, deduzir: 0 },
  { ate: 360000, aliquota: 0.112, deduzir: 9360 },
  { ate: 720000, aliquota: 0.135, deduzir: 17640 },
  { ate: 1800000, aliquota: 0.16, deduzir: 35640 },
  { ate: 3600000, aliquota: 0.21, deduzir: 125640 },
  { ate: 4800000, aliquota: 0.33, deduzir: 648000 },
]

/** Anexo V (serviços intelectuais com Fator R < 28%). */
export const SIMPLES_ANEXO_V: FaixaSimples[] = [
  { ate: 180000, aliquota: 0.155, deduzir: 0 },
  { ate: 360000, aliquota: 0.18, deduzir: 4500 },
  { ate: 720000, aliquota: 0.195, deduzir: 9900 },
  { ate: 1800000, aliquota: 0.205, deduzir: 17100 },
  { ate: 3600000, aliquota: 0.23, deduzir: 62100 },
  { ate: 4800000, aliquota: 0.305, deduzir: 540000 },
]

/** Alíquota efetiva do Simples (Resolução CGSN 140/2018). */
export function aliquotaEfetivaSimples(rbt12: number, anexo: FaixaSimples[]): number {
  if (rbt12 <= 0) return anexo[0].aliquota
  const faixa = anexo.find(f => rbt12 <= f.ate) ?? anexo[anexo.length - 1]
  return (rbt12 * faixa.aliquota - faixa.deduzir) / rbt12
}

/**
 * Retenção de IR sobre dividendos (Lei 15.270/2025, vigente 2026):
 * 10% sobre o TOTAL do mês quando a mesma empresa paga > R$ 50.000/mês
 * ao mesmo sócio PF. Abaixo disso, isento.
 */
export function irDividendosMes(valorMes: number): number {
  return valorMes > 50000 ? valorMes * 0.1 : 0
}

/* ============================== MEI ============================== */

/** Teto de receita bruta anual do MEI (vigente em 2026; ≈ R$ 6.750/mês). */
export const MEI_LIMITE_ANUAL_2026 = 81000

/**
 * DAS mensal fixo do MEI prestador de serviços em 2026:
 * 5% do salário mínimo (INSS) + R$ 5,00 de ISS = R$ 86,05.
 * (Comércio/indústria paga R$ 1,00 de ICMS no lugar/além do ISS.)
 */
export const MEI_DAS_SERVICOS_2026 = Math.round((SALARIO_MINIMO_2026 * 0.05 + 5) * 100) / 100

/* ==================== Encargos do empregador (CLT) ==================== */

/**
 * Encargos típicos sobre a folha (empresa fora do Simples):
 * INSS patronal 20% + RAT ~2% + Terceiros/Sistema S 5,8% + FGTS 8% ≈ 35,8%.
 * No Simples (anexos III/V), CPP está no DAS: só FGTS 8%.
 */
export const ENCARGOS_PATRONAIS_PADRAO = 0.358
export const ENCARGOS_PATRONAIS_SIMPLES = 0.08
export const FGTS_ALIQUOTA = 0.08
