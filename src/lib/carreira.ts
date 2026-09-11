/**
 * Critérios de satisfação na carreira — base da página "Emprego: qual escolher?".
 * Estrutura e valores default vêm da planilha "Career Choice Worksheet" do usuário
 * (5 áreas com peso, 32 subcritérios com importância 1–5), traduzida para pt-BR.
 */

export type AreaId = 'trabalho' | 'financeiro' | 'cultura' | 'equilibrio' | 'empresa'

/** Ajuda objetiva: critérios que podem ser pontuados a partir de números reais. */
export type ObjetivoTipo = 'salario' | 'beneficios' | 'bonus' | 'commute'

export interface AreaCarreira {
  id: AreaId
  nome: string
  /** peso default (%) — os 5 somam 100 */
  pesoPct: number
  descricao: string
}

export interface CriterioCarreira {
  id: string
  area: AreaId
  nome: string
  /** importância default 1–5 (perfil da planilha do usuário) */
  importancia: 1 | 2 | 3 | 4 | 5
  /** pergunta-guia para pontuar uma proposta de 1 a 5 */
  pergunta: string
  objetivo?: ObjetivoTipo
}

export const AREAS_CARREIRA: AreaCarreira[] = [
  { id: 'trabalho', nome: 'O trabalho em si', pesoPct: 20, descricao: 'O que você faz no dia a dia e para onde isso leva.' },
  { id: 'financeiro', nome: 'Financeiro', pesoPct: 25, descricao: 'Salário, benefícios, bônus e segurança.' },
  { id: 'cultura', nome: 'Cultura', pesoPct: 10, descricao: 'Pessoas, reconhecimento e estilo de trabalho.' },
  { id: 'equilibrio', nome: 'Equilíbrio vida-trabalho', pesoPct: 20, descricao: 'Horários, flexibilidade, deslocamento e viagens.' },
  { id: 'empresa', nome: 'A empresa', pesoPct: 25, descricao: 'Tamanho, valores, liderança, setor e imagem.' },
]

export const IMPORTANCIA_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Nenhuma',
  2: 'Baixa',
  3: 'Média',
  4: 'Alta',
  5: 'Extrema',
}

export const NOTA_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Muito ruim',
  2: 'Ruim',
  3: 'Ok',
  4: 'Bom',
  5: 'Excelente',
}

export const CRITERIOS_CARREIRA: CriterioCarreira[] = [
  // O trabalho em si
  { id: 'responsabilidades', area: 'trabalho', nome: 'Responsabilidades do cargo', importancia: 4, pergunta: 'As responsabilidades são as que você quer ter?' },
  { id: 'aprendizado', area: 'trabalho', nome: 'Aprendizado e crescimento', importancia: 3, pergunta: 'Quanto você vai aprender e evoluir?' },
  { id: 'promocao', area: 'trabalho', nome: 'Chance de promoção', importancia: 1, pergunta: 'Há caminho claro para subir?' },
  { id: 'carreira', area: 'trabalho', nome: 'Potencial futuro de carreira', importancia: 2, pergunta: 'Abre portas para os próximos passos?' },
  { id: 'autoridade', area: 'trabalho', nome: 'Autoridade para decidir', importancia: 5, pergunta: 'Você decide, ou só executa?' },
  { id: 'lideranca-pessoas', area: 'trabalho', nome: 'Liderar/supervisionar pessoas', importancia: 2, pergunta: 'Tem gestão de pessoas na medida que você quer?' },
  { id: 'variedade', area: 'trabalho', nome: 'Variedade', importancia: 1, pergunta: 'O trabalho varia ou é repetitivo?' },
  { id: 'autonomia', area: 'trabalho', nome: 'Autonomia', importancia: 5, pergunta: 'Quanta liberdade para organizar o próprio trabalho?' },
  { id: 'desafio', area: 'trabalho', nome: 'Desafio', importancia: 3, pergunta: 'O nível de desafio é o que te motiva?' },
  { id: 'criatividade', area: 'trabalho', nome: 'Expressão pessoal e criatividade', importancia: 4, pergunta: 'Dá para colocar sua marca no que faz?' },
  { id: 'ambiente-fisico', area: 'trabalho', nome: 'Ambiente físico', importancia: 1, pergunta: 'Escritório, equipamentos e conforto atendem?' },
  // Financeiro
  { id: 'salario', area: 'financeiro', nome: 'Salário', importancia: 5, pergunta: 'O salário líquido é bom para o seu padrão?', objetivo: 'salario' },
  { id: 'beneficios', area: 'financeiro', nome: 'Benefícios', importancia: 5, pergunta: 'Plano de saúde, VR/VA, previdência…', objetivo: 'beneficios' },
  { id: 'incentivos', area: 'financeiro', nome: 'Bônus e incentivos', importancia: 5, pergunta: 'PLR, bônus, equity — quanto e com que certeza?', objetivo: 'bonus' },
  { id: 'estabilidade', area: 'financeiro', nome: 'Estabilidade e segurança', importancia: 5, pergunta: 'Risco de demissão, saúde da empresa, vínculo.' },
  // Cultura
  { id: 'relacoes', area: 'cultura', nome: 'Relações no trabalho', importancia: 2, pergunta: 'Você gostaria de trabalhar com essas pessoas?' },
  { id: 'pessoas-cultura', area: 'cultura', nome: 'Pessoas, cultura e estilo', importancia: 2, pergunta: 'O jeito de trabalhar combina com você?' },
  { id: 'reconhecimento', area: 'cultura', nome: 'Reconhecimento', importancia: 3, pergunta: 'Bom trabalho é notado e recompensado?' },
  { id: 'prestigio', area: 'cultura', nome: 'Prestígio e título', importancia: 1, pergunta: 'O cargo e a marca pesam no seu currículo?' },
  // Equilíbrio vida-trabalho
  { id: 'horario', area: 'equilibrio', nome: 'Horário de trabalho', importancia: 4, pergunta: 'Jornada e horários cabem na sua vida?' },
  { id: 'flexibilidade', area: 'equilibrio', nome: 'Flexibilidade para família e compromissos', importancia: 1, pergunta: 'Dá para remanejar o dia quando precisa?' },
  { id: 'deslocamento', area: 'equilibrio', nome: 'Tempo de deslocamento', importancia: 3, pergunta: 'Quanto tempo por dia você perde no trajeto?', objetivo: 'commute' },
  { id: 'viagens', area: 'equilibrio', nome: 'Viagens a trabalho', importancia: 3, pergunta: 'A quantidade de viagens é a que você quer?' },
  // A empresa
  { id: 'tamanho', area: 'empresa', nome: 'Tamanho da empresa', importancia: 2, pergunta: 'O porte é o que você prefere?' },
  { id: 'valores', area: 'empresa', nome: 'Valores', importancia: 2, pergunta: 'Os valores da empresa batem com os seus?' },
  { id: 'lideranca', area: 'empresa', nome: 'Liderança', importancia: 2, pergunta: 'Você confia em quem dirige a empresa?' },
  { id: 'produto', area: 'empresa', nome: 'Produto e qualidade', importancia: 2, pergunta: 'Você se orgulha do que a empresa entrega?' },
  { id: 'ambiental', area: 'empresa', nome: 'Preocupação ambiental', importancia: 2, pergunta: 'A postura ambiental importa e é boa?' },
  { id: 'setor', area: 'empresa', nome: 'Setor de atuação', importancia: 2, pergunta: 'O setor tem futuro e te interessa?' },
  { id: 'localizacao', area: 'empresa', nome: 'Localização', importancia: 2, pergunta: 'Cidade/região funcionam para você?' },
  { id: 'imagem', area: 'empresa', nome: 'Imagem e integridade', importancia: 2, pergunta: 'A reputação da empresa é sólida?' },
  { id: 'sociedade', area: 'empresa', nome: 'Contribuição para a sociedade', importancia: 2, pergunta: 'O trabalho faz bem para além da empresa?' },
]

/** Nome padrão das opções na primeira visita. */
export const OPCOES_PADRAO = ['Emprego atual', 'Proposta A']
