/**
 * Dados para "Vale a pena comprar um elétrico?" — pesquisa de 11/09/2026
 * (ANP, ANEEL, Fipe/KBB/Bright/Indicata, ABVE/Fenabrave, IPSA/TEx, Geotab,
 * fabricantes, NBR 17019). Todos os defaults são editáveis na página.
 */

export type Motorizacao = 'bev' | 'phev' | 'ice'

export const MOTORIZACAO_NOME: Record<Motorizacao, string> = {
  bev: 'Elétrico',
  phev: 'Híbrido plug-in',
  ice: 'Combustão',
}

export interface CategoriaEV {
  id: 'compacto' | 'medio' | 'suv'
  nome: string
  /** modelos de referência (set/2026) */
  exemplos: { bev: string; ice: string; phev?: string }
  /** preço de tabela (set/2026) */
  preco: { bev: number; ice: number; phev?: number }
  /** consumo do ELÉTRICO na bateria, kWh/100 km (uso real ≈ Inmetro/0,8; SEM perdas de recarga) */
  kwh100Bev: number
  /** bateria útil do elétrico, kWh */
  bateriaBev: number
  /** combustão: km/l gasolina em uso real (≈ 90% do Inmetro cidade) */
  kmlIce: number
  /** PHEV: kWh/100 km em modo elétrico, km/l em modo híbrido, bateria kWh, autonomia elétrica real km */
  phev?: { kwh100: number; kml: number; bateria: number; autonomiaKm: number }
  /** manutenção + pneus, R$/ano a 15.000 km/ano (CustoCarro 2026, concessionárias) */
  manutencaoAno: { bev: number; ice: number; phev: number }
  /** seguro, fração do valor/ano (IPSA/TEx jun/2026 + cotações ago/2026) */
  seguroPct: { bev: number; ice: number; phev: number }
}

export const CATEGORIAS_EV: CategoriaEV[] = [
  {
    id: 'compacto',
    nome: 'Compacto',
    exemplos: { bev: 'BYD Dolphin Mini GL', ice: 'Chevrolet Onix 1.0' },
    preco: { bev: 119990, ice: 101790 },
    kwh100Bev: 12,
    bateriaBev: 38,
    kmlIce: 12,
    manutencaoAno: { bev: 1500, ice: 2500, phev: 2300 },
    seguroPct: { bev: 0.041, ice: 0.032, phev: 0.03 },
  },
  {
    id: 'medio',
    nome: 'Hatch / sedã médio',
    exemplos: { bev: 'BYD Dolphin GS', ice: 'Toyota Corolla XEi 2.0' },
    preco: { bev: 149990, ice: 174990 },
    kwh100Bev: 14,
    bateriaBev: 44.9,
    kmlIce: 11.5,
    manutencaoAno: { bev: 1800, ice: 2800, phev: 2300 },
    seguroPct: { bev: 0.037, ice: 0.03, phev: 0.03 },
  },
  {
    id: 'suv',
    nome: 'SUV',
    exemplos: { bev: 'Volvo EX30 Plus', ice: 'VW T-Cross Comfortline', phev: 'GWM Haval H6 PHEV19' },
    preco: { bev: 249950, ice: 171990, phev: 248000 },
    kwh100Bev: 16.5,
    bateriaBev: 51,
    kmlIce: 10.5,
    phev: { kwh100: 20, kml: 13, bateria: 19, autonomiaKm: 58 },
    manutencaoAno: { bev: 2250, ice: 3250, phev: 3000 },
    seguroPct: { bev: 0.037, ice: 0.03, phev: 0.03 },
  },
]

/**
 * Depreciação nominal default por motorização (Fipe safras 2023–25 via Motor Show
 * ago/2026, KBB mai/2026, Bright jul/2026, Indicata mar/2026): perda no 1º ano e
 * % a.a. sobre o residual nos seguintes. EVs de entrada chineses já depreciam
 * como combustão; sedãs/SUVs elétricos > R$ 250 mil ainda perdem 22–28% no 1º ano.
 */
export const DEPRECIACAO_EV: Record<Motorizacao, { ano1: number; seguintes: number }> = {
  bev: { ano1: 0.2, seguintes: 0.09 },
  phev: { ano1: 0.18, seguintes: 0.08 },
  ice: { ano1: 0.14, seguintes: 0.06 },
}

export interface IpvaEV {
  uf: string
  nome: string
  /** alíquotas 2026 (fração do valor venal/ano) */
  bev: number
  phev: number
  ice: number
  licenciamento: number
  /** observação exibida no InfoTip */
  nota?: string
}

/** IPVA 2026 para eletrificados (Sefaz estaduais; Autopapo/ABVE jan/2026). */
export const IPVA_EV_UF: IpvaEV[] = [
  { uf: 'SP', nome: 'São Paulo', bev: 0.04, phev: 0, ice: 0.04, licenciamento: 174.08, nota: 'PHEV/híbrido flex até R$ 261.154 isento em 2026 — rampa 1%/2%/3%/4% em 2027–2030 (Lei 13.296/2008). Capital: devolve 50% do IPVA do elétrico (até ~R$ 3.642) e isenta do rodízio até 2030.' },
  { uf: 'RJ', nome: 'Rio de Janeiro', bev: 0.005, phev: 0.015, ice: 0.04, licenciamento: 281.29, nota: 'Lei 7.068/2015: elétricos 0,5%, híbridos 1,5%.' },
  { uf: 'MG', nome: 'Minas Gerais', bev: 0.04, phev: 0.04, ice: 0.04, licenciamento: 150, nota: 'Isenção só para veículo novo fabricado em MG até R$ 199 mil — nenhum elétrico se enquadra.' },
  { uf: 'RS', nome: 'Rio Grande do Sul', bev: 0, phev: 0.03, ice: 0.03, licenciamento: 109.27, nota: 'Elétricos isentos desde 1996.' },
  { uf: 'PR', nome: 'Paraná', bev: 0.019, phev: 0.019, ice: 0.019, licenciamento: 90.94, nota: 'Alíquota geral caiu para 1,9% em 2026 (era 3,5%); sem benefício específico.' },
  { uf: 'SC', nome: 'Santa Catarina', bev: 0.02, phev: 0.02, ice: 0.02, licenciamento: 149.37 },
  { uf: 'DF', nome: 'Distrito Federal', bev: 0, phev: 0, ice: 0.035, licenciamento: 150, nota: 'Isento (motor ≥ 40 kW, bateria > 150 V — Lei 6.296/2019), condicionado à compra no DF.' },
  { uf: 'BA', nome: 'Bahia', bev: 0, phev: 0.025, ice: 0.025, licenciamento: 150, nota: 'Elétricos isentos até R$ 300 mil (requerimento ba.gov.br).' },
  { uf: 'PE', nome: 'Pernambuco', bev: 0, phev: 0.024, ice: 0.024, licenciamento: 150, nota: 'Elétricos isentos, sem teto.' },
  { uf: 'CE', nome: 'Ceará', bev: 0.02, phev: 0.03, ice: 0.035, licenciamento: 150, nota: 'Fontes divergem (0,5–3,5%) — confirme na Sefaz-CE.' },
  { uf: 'GO', nome: 'Goiás', bev: 0.0375, phev: 0.0375, ice: 0.0375, licenciamento: 150, nota: 'Sem benefício (3,75% acima de 100 cv).' },
  { uf: 'ES', nome: 'Espírito Santo', bev: 0.02, phev: 0.02, ice: 0.02, licenciamento: 150 },
]

/** SP: alíquota do PHEV sobe 1 p.p./ano a partir de 2027 até 4% (2030+). anoDesdeCompra: 0 = 2026. */
export function ipvaPhevSp(anoDesdeCompra: number): number {
  return Math.min(0.04, Math.max(0, anoDesdeCompra) * 0.01)
}

export interface TarifaEnergia {
  distribuidora: string
  uf: string
  /** tarifa convencional B1 COM impostos e bandeira amarela, R$/kWh (ANEEL, leitura 11/09/2026) */
  convencional: number
  /** tarifa branca fora de ponta COM impostos, R$/kWh */
  brancaForaPonta: number
}

export const TARIFAS_ENERGIA: TarifaEnergia[] = [
  { distribuidora: 'Enel SP', uf: 'SP', convencional: 1.05, brancaForaPonta: 0.894 },
  { distribuidora: 'CPFL Paulista', uf: 'SP', convencional: 0.985, brancaForaPonta: 0.836 },
  { distribuidora: 'EDP SP', uf: 'SP', convencional: 1.046, brancaForaPonta: 0.867 },
  { distribuidora: 'Elektro', uf: 'SP', convencional: 1.182, brancaForaPonta: 0.956 },
  { distribuidora: 'Light', uf: 'RJ', convencional: 1.199, brancaForaPonta: 1.059 },
  { distribuidora: 'Enel RJ', uf: 'RJ', convencional: 1.44, brancaForaPonta: 1.216 },
  { distribuidora: 'Cemig', uf: 'MG', convencional: 1.198, brancaForaPonta: 0.996 },
  { distribuidora: 'Copel', uf: 'PR', convencional: 1.035, brancaForaPonta: 0.859 },
  { distribuidora: 'Celesc', uf: 'SC', convencional: 0.998, brancaForaPonta: 0.871 },
  { distribuidora: 'RGE', uf: 'RS', convencional: 1.235, brancaForaPonta: 0.998 },
  { distribuidora: 'CEEE (Equatorial)', uf: 'RS', convencional: 1.078, brancaForaPonta: 0.923 },
  { distribuidora: 'Neoenergia Coelba', uf: 'BA', convencional: 1.203, brancaForaPonta: 0.936 },
  { distribuidora: 'Neoenergia PE', uf: 'PE', convencional: 1.098, brancaForaPonta: 0.938 },
  { distribuidora: 'Neoenergia Brasília', uf: 'DF', convencional: 1.127, brancaForaPonta: 0.986 },
  { distribuidora: 'Enel CE', uf: 'CE', convencional: 0.961, brancaForaPonta: 0.802 },
  { distribuidora: 'Equatorial GO', uf: 'GO', convencional: 1.198, brancaForaPonta: 0.983 },
  { distribuidora: 'EDP ES', uf: 'ES', convencional: 1.106, brancaForaPonta: 0.945 },
  { distribuidora: 'Média nacional (33 maiores)', uf: '—', convencional: 1.117, brancaForaPonta: 0.938 },
]

/** Combustíveis — ANP, média Brasil, semana 30/08–05/09/2026 (R$/l). */
export const COMBUSTIVEIS_2026 = { gasolina: 6.51, etanol: 3.95, diesel: 6.88 }

/** Recarga pública, R$/kWh (blend AC/DC; EVblog/Canaltech set/2026). DC rodoviário ≈ 2,90. */
export const RECARGA_PUBLICA_KWH = 2.2

/** kWh de energia solar compensada: só o Fio B (Lei 14.300, 2026) — vale se você injeta excedente. */
export const SOLAR_KWH_MARGINAL = 0.17

export type CenarioRecargaId = 'tomada' | 'wallbox' | 'padrao' | 'condominio' | 'rua'

export interface CenarioRecarga {
  id: CenarioRecargaId
  nome: string
  descricao: string
  /** custo único de infraestrutura em t0 */
  capex: number
  /** faixa verificada (texto) */
  faixa: string
  /** custos recorrentes (stand-by, inspeção, taxa do condomínio), R$/ano */
  recorrenteAno: number
  /** perdas de recarga a somar ao consumo (AC lento 15%, wallbox 7%, DC 8%) */
  perdas: number
  /** fração dos kWh carregados em casa */
  fracCasa: number
  /** potência efetiva de recarga, kW (0 = só rua) */
  potenciaKw: number
}

/** Cenários de recarga em casa (NBR 17019/5410; cotações WEG/Intelbras/BYD/Enel X, eletricistas 2026). */
export const CENARIOS_RECARGA: CenarioRecarga[] = [
  { id: 'tomada', nome: 'Tomada dedicada', descricao: 'Circuito exclusivo + tomada industrial + DR; usa o carregador portátil que vem com o carro (2,2 kW — ~17 h para 38 kWh).', capex: 1500, faixa: 'R$ 800–2.500', recorrenteAno: 0, perdas: 0.15, fracCasa: 0.85, potenciaKw: 2.2 },
  { id: 'wallbox', nome: 'Wallbox em casa', descricao: 'Wallbox 7,4 kW (~R$ 4.300) + instalação até 10 m do quadro + ART.', capex: 7000, faixa: 'R$ 5.500–9.000 (10–30 m: +R$ 2–4 mil)', recorrenteAno: 100, perdas: 0.07, fracCasa: 0.85, potenciaKw: 7.4 },
  { id: 'padrao', nome: 'Wallbox + troca do padrão', descricao: 'Sua entrada é monofásica/fraca: troca do padrão (mono → bi/trifásico, R$ 2.500–5.000; distribuidora não cobra) + wallbox.', capex: 10500, faixa: 'R$ 9.000–15.000+', recorrenteAno: 100, perdas: 0.07, fracCasa: 0.85, potenciaKw: 7.4 },
  { id: 'condominio', nome: 'Apartamento (infra do condomínio)', descricao: 'Ponto individual do medidor até a vaga (cabo até R$ 120/m) + ART; rateio de infra coletiva opcional.', capex: 8000, faixa: 'R$ 6.000–12.000 por ponto', recorrenteAno: 100, perdas: 0.07, fracCasa: 0.85, potenciaKw: 7 },
  { id: 'rua', nome: 'Não consigo carregar em casa', descricao: '100% em carregadores públicos (AC de shopping a DC de rodovia).', capex: 0, faixa: '—', recorrenteAno: 0, perdas: 0.08, fracCasa: 0, potenciaKw: 0 },
]

/** Bateria de tração (Geotab jan/2026: 2,3% a.a.; garantias BYD/GWM 8 anos; NSC Total jun/2026: R$ 1.300–1.800/kWh). */
export const BATERIA_2026 = {
  degradacaoAa: 0.02,
  garantiaAnos: 8,
  garantiaKm: 160000,
  custoPorKwh: 1500,
  /** probabilidade de troca fora da garantia dentro de 8 anos (assunção editável) */
  probTroca: 0.05,
}

/** Perdas de recarga por modo (ADAC/medidas 2026) — usadas pelos cenários acima. */
export const PERDAS_RECARGA = { tomada: 0.15, wallbox: 0.07, dc: 0.08 }

/** SP capital: devolução de 50% do IPVA do elétrico (Lei municipal 15.997/2014, até 2030). */
export const SP_CAPITAL_DEVOLUCAO_IPVA_BEV = 0.5
