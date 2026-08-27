/**
 * Dados de mercado 2026 (pesquisados em ago/2026) usados como defaults
 * editáveis nas calculadoras. Valores são médias/faixas típicas de mercado —
 * cada página permite ao usuário ajustar.
 */

/* ============================== Carro ============================== */

export interface CategoriaCarro {
  id: string
  nome: string
  /** valor típico de um 0 km da categoria, R$ */
  valorRef: number
  /** depreciação no 1º ano (fração) */
  depAno1: number
  /** depreciação a.a. nos anos seguintes (fração) */
  depSeguintes: number
  /** manutenção típica, R$/ano */
  manutencaoAno: number
  /** seguro típico, fração do valor do carro por ano */
  seguroPct: number
  /** assinatura 0 km típica (Localiza Meoo/Movida, ~1.000 km/mês), R$/mês */
  assinaturaMes: number
  /** aluguel mensal avulso de locadora, R$/mês */
  aluguelMes: number
  /** consumo médio, km/l (gasolina) — elétrico usa km/kWh equivalente */
  kmPorLitro: number
}

/** Defaults por categoria (depreciação: síntese FIPE/KBB 2026; assinatura: cotações abr/2026). */
export const CATEGORIAS_CARRO: CategoriaCarro[] = [
  { id: 'popular', nome: 'Popular / hatch', valorRef: 90000, depAno1: 0.15, depSeguintes: 0.09, manutencaoAno: 1800, seguroPct: 0.05, assinaturaMes: 2200, aluguelMes: 2300, kmPorLitro: 12.5 },
  { id: 'sedan', nome: 'Sedan', valorRef: 130000, depAno1: 0.12, depSeguintes: 0.08, manutencaoAno: 2500, seguroPct: 0.05, assinaturaMes: 2900, aluguelMes: 3200, kmPorLitro: 11.5 },
  { id: 'suv', nome: 'SUV compacto/médio', valorRef: 160000, depAno1: 0.12, depSeguintes: 0.09, manutencaoAno: 3500, seguroPct: 0.06, assinaturaMes: 3350, aluguelMes: 3800, kmPorLitro: 10.5 },
  { id: 'picape', nome: 'Picape', valorRef: 200000, depAno1: 0.12, depSeguintes: 0.07, manutencaoAno: 5000, seguroPct: 0.06, assinaturaMes: 3700, aluguelMes: 4300, kmPorLitro: 9 },
  { id: 'premium', nome: 'Premium / luxo', valorRef: 350000, depAno1: 0.2, depSeguintes: 0.1, manutencaoAno: 8000, seguroPct: 0.08, assinaturaMes: 6500, aluguelMes: 7000, kmPorLitro: 8.5 },
  { id: 'eletrico', nome: 'Elétrico', valorRef: 180000, depAno1: 0.25, depSeguintes: 0.12, manutencaoAno: 1500, seguroPct: 0.08, assinaturaMes: 3600, aluguelMes: 4000, kmPorLitro: 25 },
]

export interface EstadoIpva {
  uf: string
  aliquota: number
  licenciamento: number
}

export const IPVA_ESTADOS: EstadoIpva[] = [
  { uf: 'SP', aliquota: 0.04, licenciamento: 174.08 },
  { uf: 'RJ', aliquota: 0.04, licenciamento: 281.29 },
  { uf: 'MG', aliquota: 0.04, licenciamento: 150 },
  { uf: 'RS', aliquota: 0.03, licenciamento: 109.27 },
  { uf: 'PR', aliquota: 0.019, licenciamento: 90.94 },
  { uf: 'SC', aliquota: 0.02, licenciamento: 149.37 },
]

/** Preço médio da gasolina, R$/l (ago/2026, ANP ~R$ 6,20). */
export const PRECO_GASOLINA = 6.2
/** Custo médio por km do elétrico (recarga residencial). */
export const PRECO_KWH = 0.95

/* ============================== Imóvel ============================== */

/** MIP: alíquota MENSAL sobre o saldo devedor, por idade (tabela típica de mercado). */
export const MIP_POR_IDADE: Array<{ ateIdade: number; aliquotaMes: number }> = [
  { ateIdade: 30, aliquotaMes: 0.000145 },
  { ateIdade: 40, aliquotaMes: 0.000225 },
  { ateIdade: 50, aliquotaMes: 0.000395 },
  { ateIdade: 60, aliquotaMes: 0.00078 },
  { ateIdade: 70, aliquotaMes: 0.00152 },
  { ateIdade: 80, aliquotaMes: 0.0028 },
]

export function mipAliquota(idade: number): number {
  const f = MIP_POR_IDADE.find(x => idade <= x.ateIdade)
  return f ? f.aliquotaMes : MIP_POR_IDADE[MIP_POR_IDADE.length - 1].aliquotaMes
}

/** DFI: alíquota mensal sobre o VALOR DE AVALIAÇÃO do imóvel. */
export const DFI_ALIQUOTA_MES = 0.0001

/** Taxas SBPE "a partir de" por banco, % a.a. + TR (ago/2026). */
export const BANCOS_IMOBILIARIO: Array<{ nome: string; taxaAa: number }> = [
  { nome: 'Caixa (relacionamento)', taxaAa: 10.26 },
  { nome: 'Caixa (balcão)', taxaAa: 11.19 },
  { nome: 'Banco do Brasil', taxaAa: 11.6 },
  { nome: 'Itaú', taxaAa: 11.6 },
  { nome: 'Santander', taxaAa: 11.69 },
  { nome: 'Bradesco', taxaAa: 11.7 },
]

/** Regras de mercado vigentes (novo modelo out/2025 + práticas 2026). */
export const REGRAS_IMOBILIARIO = {
  /** LTV máximo SAC (entrada mínima 20%) */
  ltvMaxSac: 0.8,
  /** LTV máximo Price (entrada mínima 30%) */
  ltvMaxPrice: 0.7,
  prazoMaxMeses: 420,
  /** parcela ≤ 30% da renda familiar bruta */
  comprometimentoRenda: 0.3,
  /** teto SFH / uso do FGTS (novo modelo) */
  tetoSfh: 2250000,
  /** idade do proponente + prazo ≤ 80,5 anos */
  idadeMaxFimContrato: 80.5,
  /** ITBI típico de capital (editável) */
  itbiPct: 0.03,
  /** registro/escritura típico */
  registroPct: 0.01,
  /** tarifa de avaliação do banco (Caixa: R$ 2.200–3.000) */
  taxaAvaliacao: 2500,
} as const

/* ============================ Investimentos ============================ */

/** Defaults de produtos de renda fixa (ago/2026), % ou % do CDI — editáveis. */
export const PRODUTOS_RF = {
  cdbGrandePctCdi: 100,
  cdbMedioPctCdi: 108,
  cdbPequenoPctCdi: 118,
  lciPctCdi: 93,
  lcPctCdi: 115,
  tesouroSelicSpread: 0.07,
  tesouroPrefixado: 14.2,
  tesouroIpcaReal: 7.5,
  custodiaB3: 0.2,
  fundoDiTaxaAdm: 0.3,
  fundoRfTaxaAdm: 1.0,
} as const

/* ========================== Risco × retorno ========================== */

export interface ClasseAtivo {
  id: string
  nome: string
  /** retorno esperado nominal, % a.a. (default editável) */
  retornoAa: number
  /** volatilidade anualizada, % */
  volAa: number
  /** nota de risco 1–5 */
  nivelRisco: 1 | 2 | 3 | 4 | 5
  garantia: string
}

/** Classes com defaults calibrados para Selic 14% / IPCA 4,4% (ago/2026). */
export const CLASSES_ATIVO: ClasseAtivo[] = [
  { id: 'poupanca', nome: 'Poupança', retornoAa: 8.4, volAa: 0.2, nivelRisco: 1, garantia: 'FGC até R$ 250 mil' },
  { id: 'selic', nome: 'Tesouro Selic', retornoAa: 14.1, volAa: 0.4, nivelRisco: 1, garantia: 'Tesouro Nacional' },
  { id: 'cdb', nome: 'CDB 105% CDI', retornoAa: 14.6, volAa: 0.6, nivelRisco: 1, garantia: 'FGC até R$ 250 mil' },
  { id: 'ipca', nome: 'Tesouro IPCA+ (2032)', retornoAa: 12.3, volAa: 8, nivelRisco: 2, garantia: 'Tesouro (marcação a mercado)' },
  { id: 'multi', nome: 'Fundo multimercado', retornoAa: 15.5, volAa: 6, nivelRisco: 3, garantia: 'Sem garantia' },
  { id: 'acoes', nome: 'Ações (Ibovespa)', retornoAa: 16, volAa: 22, nivelRisco: 4, garantia: 'Sem garantia' },
  { id: 'cripto', nome: 'Bitcoin', retornoAa: 25, volAa: 55, nivelRisco: 5, garantia: 'Sem garantia' },
]
