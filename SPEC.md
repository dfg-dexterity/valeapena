# SPEC — vale a pena?

App de calculadoras de decisão financeira (pt-BR, dados 2026). Vite + React 19 + TS strict + Tailwind v4 + Recharts + lucide-react. **Não adicionar dependências.**

## Arquitetura

- `src/lib/finance.ts` — matemática (juros, Price/SAC, IR regressivo, VPL, FV)
- `src/lib/format.ts` — `brl`, `brlCents`, `brlCompact`, `pct`, `num`, `meses`
- `src/lib/rates.tsx` — `useRates()` → taxas ao vivo do BCB (selic, cdi, ipca12m, trMes, poupancaMes, imobMercado, imobRegulado, imobTotal, veiculos, aoVivo, referencia)
- `src/lib/tax2026.ts` — INSS/IRRF 2026 (com Lei 15.270/2025), Simples Nacional, dividendos
- `src/lib/dados2026.ts` — categorias de carro, IPVA, MIP/DFI, bancos imobiliário, regras SBPE, defaults de renda fixa, classes de ativo
- `src/components/ui.tsx` — `ToolPage`, `Card`, `SectionTitle`, `Collapse`, `SliderField`, `NumberField`, `Segmented`, `Toggle`, `InfoTip`, `StatTile`, `AnimatedNumber`, `Verdict`, `DataTable`, `LiveBadge`
- `src/components/charts.tsx` — `VLineChart`, `VAreaChart`, `VBarChart`, `ChartTooltip`, `SeriesDef`
- `src/theme.tsx` — `useVizColors()` (cores concretas para gráficos)

Leia esses arquivos antes de implementar — use as APIs existentes, não reinvente.

## Estrutura padrão de página

```tsx
<ToolPage icon={<Icone size={20}/>} title="..." description="..."
  inputs={<>
    <Card title="..."> <SliderField/> <Segmented/> ... </Card>
    <Collapse title="Premissas avançadas"> ... </Collapse>
  </>}
  results={<>
    <Verdict winner="..." detail="..." tone="positive|negative|neutral" badge="..."/>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4"> <StatTile/> ... </div>
    <Card title="..."> <VLineChart/> </Card>
    ...
    <Card title="Detalhamento"> <DataTable/> </Card>
  </>}
/>
```

Regras de UX:
- **Veredito primeiro** — a resposta à pergunta "vale a pena?" em uma frase, com número.
- Todo default vem de `dados2026.ts`/`useRates()` e é **editável** (slider ou premissas avançadas).
- Toda premissa não óbvia tem `InfoTip` explicando a fonte/regra.
- Recálculo instantâneo (`useMemo` para simulações pesadas).
- Sliders com faixas realistas e steps redondos. Valores em `brl()`/`pct()`.
- Mobile: tudo empilha; nada estoura horizontalmente.

## Regras de visualização (obrigatórias)

- Cores de série SEMPRE via `useVizColors().series[i]` ou `colorIndex` — ordem fixa:
  slot 0 = azul (opção "comprar"/"CLT"/principal), slot 1 = laranja (alternativa), slot 2 = verde-água (terceira). Nunca embaralhar entre renders.
- Máx. 4 séries por gráfico de linhas; um eixo Y só; texto sempre em tokens de tinta (nunca na cor da série).
- Ranking de magnitude (1 medida, n itens) = barras em UMA cor (accent), destaque apenas no vencedor.
- Legenda aparece automaticamente para ≥2 séries (os wrappers cuidam disso).
- Tooltip: os wrappers já aplicam. `yFormat={brlCompact}` em eixos monetários.

## Especificações por página

### Carro.tsx — Alugar × comprar
Compara em VPL (taxa de desconto = CDI líquido de 15% de IR): **Comprar** (à vista ou financiado, Segmented) × **Assinatura 0 km**.
Inputs: categoria (`CATEGORIAS_CARRO` — Segmented; ao trocar, atualiza defaults), valor do carro, km/mês (300–5000), horizonte (1–10 anos, default 5), se financiado: entrada %, prazo (12–60), taxa a.a. (default `rates.veiculos`), mensalidade da assinatura (default da categoria), estado IPVA (`IPVA_ESTADOS`), custo de oportunidade % a.a. (default CDI). Avançado: seguro %, manutenção/ano, depreciação ano 1 e seguintes, licenciamento.
Modelo mensal: comprar paga seguro (%×valor atual/12), manutenção/12, IPVA (alíquota×valor atual/12), licenciamento/12; carro deprecia geometricamente (ano 1 `depAno1`, depois `depSeguintes`); no fim, **revenda entra como fluxo positivo**. Financiado: entrada em t0 + parcelas Price. Assinatura: mensalidade (já inclui IPVA/seguro/manutenção — não duplicar). Combustível fica FORA (igual nos dois lados — dizer isso num InfoTip).
Saídas: Verdict (mais barato em VPL + diferença em R$/mês equivalente), StatTiles (custo total VP de cada, custo/km, valor de revenda), gráfico de linhas custo acumulado em VP (2 séries, ponto de cruzamento = break-even), barras de composição do custo de comprar (depreciação, seguro, manutenção, IPVA, juros do financiamento) vs assinatura, tabela ano a ano.

### Imovel.tsx — Financiamento imobiliário
Simulador SBPE completo. Inputs: valor do imóvel (100k–3mi), entrada % (respeitar LTV: SAC ≥20%, Price ≥30% — `REGRAS_IMOBILIARIO`; avisar se violar), sistema (SAC × Price), prazo (60–420, default 360), taxa a.a.: default média `rates.imobMercado` com `LiveBadge`, e tabela clicável de `BANCOS_IMOBILIARIO` que seta a taxa; toggle TR (default on, TR de `rates.trMes` anualizada); idade (18–70, para MIP via `mipAliquota`), renda familiar bruta. Avançado: ITBI %, registro %, taxa de avaliação, DFI.
Cálculo: cronogramas `sacSchedule`/`priceSchedule` com juros mensais = `aToM(taxa + trAnualizada)`; extras mensais = MIP(saldo, idade) + DFI(valor imóvel). **CET aproximado**: TIR mensal dos fluxos (líquido liberado = financiado − avaliação; pagamentos = parcelas com seguros) via bissecção, anualizada.
Saídas: Verdict (renda mínima exigida — 1ª parcela ≤30% da renda — e se cabe na renda informada; tone conforme), StatTiles (1ª parcela, última parcela, total pago, total de juros, CET % a.a., custos de transação ITBI+registro+avaliação), gráfico parcela×tempo SAC vs Price (2 séries), gráfico saldo devedor×tempo, composição do total pago (principal/juros/seguros — barras empilhadas por sistema), tabela do cronograma (anos: 1, 2, 5, 10, 15… amostrada). Avisos: idade+prazo>80,5 anos; imóvel ≤ R$ 2,25 mi permite FGTS/SFH (badge); CET>12% = acima do teto do novo modelo SFH (nota).

### Investimentos.tsx — Renda fixa na prática
Compara líquido de IR/custos, com `PRODUTOS_RF` (tudo editável no avançado): Poupança (0,5% a.m.+TR, isenta), CDB banco grande 100% CDI, CDB médio 108%, CDB pequeno 118%, LCI/LCA 93% CDI (isenta), LC 115% (IR normal), Tesouro Selic (Selic+0,07, custódia B3 0,20% com isenção até R$ 10 mil, IR), Tesouro Prefixado 14,2%, Tesouro IPCA+ (IPCA projetado editável + 7,5% real, IR), Fundo DI (CDI − 0,3% adm, come-cotas 15% semestral aproximado).
Inputs: aporte inicial, aporte mensal, prazo (1–120 meses, default 24; mostrar em anos/meses), IPCA projetado (default `rates.ipca12m`).
Saídas: Verdict (melhor líquido no prazo + FGC/liquidez em uma frase), ranking em barras horizontais ou verticais (1 cor, vencedor destacado, rótulo direto no topo), tabela completa (bruto, IR, taxas, líquido, % a.a. líquida, garantia), gráfico de linhas evolução dos 4 melhores no tempo, insight de equivalência ("LCI a 93% empata com CDB a X% do CDI") — calcular X = 93/(1−alíquota IR do prazo). Nota sobre degraus do IR regressivo (180/360/720 dias).

### Risco.tsx — Risco × retorno
Monte Carlo educacional com `CLASSES_ATIVO` (retorno/vol editáveis no avançado). Inputs: valor inicial, aporte mensal, horizonte (1–30 anos, default 10), classe em foco (Segmented), classes na comparação (máx. 4 no gráfico).
Simulação: GBM mensal, 2.000 caminhos, RNG determinístico com seed fixa (mulberry32 + Box-Muller) — resultados estáveis entre renders; `useMemo`.
Saídas: Verdict (mediana da classe em foco no horizonte + "no cenário ruim (p10) você teria X" + comparação com CDI), fan chart da classe em foco (`VAreaChart`: banda p10–p90 + linha mediana — construir com áreas empilhadas: base invisível + banda), linhas das medianas das classes selecionadas (≤4 séries), StatTiles (mediana, p10, p90, probabilidade de perder do CDI, probabilidade de perda nominal), tabela por classe (nível de risco 1–5 com bolinhas, garantia, mediana, p10, p90). Disclaimers claros: premissas editáveis, passado ≠ futuro.

### PjClt.tsx — PJ × CLT
Inputs CLT: salário bruto, VR/VA mensal, plano de saúde da empresa, outros benefícios, dependentes. Inputs PJ: faturamento mensal, pró-labore (Segmented: mínimo R$ 1.621 | 28% do faturamento (Fator R) | custom), contador (R$ 250), outros custos PJ/mês, plano de saúde próprio, dias de férias sem faturar (default 30). Deslocamento (para cada lado): modalidade (Presencial 5d | Híbrido 3d | Remoto 0d — editável dias/semana), minutos porta-a-porta/dia (default 90), custo transporte/dia; valor da hora = líquido/176 (automático, InfoTip).
CLT líquido: usar `inssClt` + `irrf2026`; anualizar 12 salários + 13º (INSS/IRRF separados, redutor vale) + ⅓ férias (tributado junto do salário do mês — simplificar tributando como mês normal, com InfoTip); FGTS 8%×13,33 salários/ano como patrimônio SEPARADO (tile próprio, não somar no líquido mensal); benefícios somam na "remuneração total".
PJ: faturamento efetivo = faturamento×(12 − dias férias/30×1)/12… simplificar: ×(1 − diasFérias/365). RBT12 = faturamento efetivo×12. Fator R = pró-labore×12/RBT12 → Anexo III se ≥28%, senão V (`aliquotaEfetivaSimples`); DAS; INSS pró-labore 11%; IRRF pró-labore com redutor; dividendos = sobra (aplicar `irDividendosMes` se >50k). Líquido PJ = pró-labore líquido + dividendos líquidos − contador − custos − plano.
Custo de deslocamento/mês = dias/sem×4,345×(min/60×valor hora + custo transporte/dia) — subtrair de cada lado conforme modalidade.
Saídas: Verdict (quem ganha, diferença R$/mês e %), 2 cards lado a lado com waterfall em `DataTable` (bruto→descontos→líquido de cada), StatTiles (líquido mensal cada, R$/hora efetiva contando horas de deslocamento, FGTS+13º anual CLT), **hero insight**: "para empatar com esse CLT, o PJ precisa faturar R$ X/mês" (resolver por busca binária), gráfico de linhas: líquido PJ × faturamento (range 0,5×–2× do atual) com linha de referência do CLT líquido (ReferenceLine via refY).

### Morar.tsx — Alugar × comprar imóvel
Compara morar de aluguel vs comprar o mesmo imóvel, em VPL (desconto = custo de oportunidade × 0,85, mesma convenção do Carro; CDI líquido de 15% de IR).
Inputs principais: valor do imóvel (100k–3mi, default 500k); aluguel mensal do imóvel equivalente (padrão user-override: default 0,45% do valor/mês — rental yield ~5,4% a.a., referência FipeZap; recalcula ao mover o valor até o usuário editar); horizonte (1–30 anos, default 10); compra à vista × financiada (Segmented); se financiada: entrada % (mín. 20 SAC / 30 Price, avisar como no Imovel), sistema SAC × Price, prazo (60–420, default 360), taxa a.a. (default `rates.imobMercado`, LiveBadge), idade (18–70, MIP); valorização do imóvel % a.a. (default 5,0 — média FipeZap; InfoTip: conservador = IPCA); reajuste anual do aluguel % a.a. (default `rates.ipca12m`, aplicado a cada 12 meses completos); custo de oportunidade (default CDI).
Avançado: ITBI % (3), registro/escritura % (1), taxa de avaliação (R$ 2.500, só se financiado), manutenção do proprietário %/ano sobre o valor atualizado (default 0,8 — reformas, pintura, estrutura), corretagem na venda (6%), TR % a.a. (default TR ao vivo anualizada, somada à taxa do financiamento como no Imovel).
IMPORTANTE (InfoTip obrigatório): condomínio e IPTU ficam FORA da conta — no Brasil o inquilino normalmente paga os dois, então o custo é igual dos dois lados.
Modelo mensal (m = 1..N):
- Comprar: t0 = entrada + ITBI + registro + avaliação. Parcelas via `sacSchedule`/`priceSchedule` com extras MIP(saldo, idade) + DFI(valor original); juros mensais = `aToM(taxa + TR)`. Manutenção mensal = manut% × valorImovel(m)/12. valorImovel(m) = valor × (1+valorização/100)^(m/12).
- Venda no mês m: recebe valorImovel(m) × (1 − corretagem) − saldoDevedor(m). Linha do gráfico "Comprar" = PV(saídas até m) − PV(venda líquida em m) — mesma mecânica do Carro.
- Alugar: aluguel do mês m = aluguel0 × (1+reajuste/100)^floor((m−1)/12); linha "Alugar" = PV acumulado dos aluguéis.
- Break-even robusto (mesma regra do Carro: primeiro mês a partir do qual comprar fica mais barato ATÉ O FIM; flag para cruzamento duplo).
- Insight "aluguel de equilíbrio": PV(aluguéis) é linear no aluguel0 → aluguelEq = aluguel0 × custoBuy/custoRent. Exibir: "pagando menos de R$ X de aluguel, alugar ganha neste horizonte".
Saídas: Verdict (vencedor + equivalente mensal via `pmtPrice(|diff|, d, N)` + tone) → StatTiles (Comprar — VP, Alugar — VP, valor do imóvel no fim (nominal, com % de valorização acumulada), aluguel de equilíbrio) → linha VP acumulado (comprar colorIndex 0, alugar colorIndex 1) com nota do break-even → barras empilhadas de composição do custo de comprar vs alugar (definir fatias com identidade exata: juros+seguros do financiamento, custos de transação incl. corretagem em VP, manutenção, e "capital imobilizado − valorização" = valor + custos t0... documentar; se a valorização superar o desconto a fatia fica negativa → tratar como crédito com nota, igual ao Carro faz com jurosVP) → tabela ano a ano (valor do imóvel, aluguel mensal vigente, saldo devedor, VP acum. de cada) → card Premissas e fontes (FipeZap, corretagem 6%, inquilino paga condomínio/IPTU, MIP/DFI, Lei 11.033).
Guards: aluguel 500–30.000; valorização 0–15%; sem NaN em extremos; avisos de LTV e idade+prazo como no Imovel.

### Computador.tsx — Upgrade de computador
Inputs: custo do novo (default 15.000), revenda do atual (3.000), vida útil (1–6 anos, default 3), valor da hora (salário mensal default 10.000 → /176, ou custom), modo do ganho (Segmented): "minutos/dia" (default 30 min) × "% mais rápido" (velocidade +30% em tarefas que ocupam 25% do tempo → tempo economizado = horas×%tempo×(1−1/1,3)), horas/dia (8), dias/mês (21), custo de oportunidade (CDI), revenda do novo no fim (default 35% do preço).
Modelo: valor mensal = horas economizadas×valor hora; custo líquido inicial = custo − revenda atual; payback = mês em que valor acumulado ≥ custo acumulado com juros (CDI); VPL na vida útil incluindo revenda final; ROI.
Saídas: Verdict (payback em meses vs vida útil; "cada mês sem trocar custa R$ X"), StatTiles (payback, VPL, horas/ano economizadas, valor gerado/mês), gráfico de linhas: valor acumulado × custo+juros (cruzamento = payback, 2 séries), barras de cenários (ganho 50%/100%/150% → VPL de cada, cor por sinal: negativo `c.negative`, positivo `c.positive` via `colorByValue`), tabela ano a ano. Nota: ganhos de produtividade só viram dinheiro se o tempo liberado tiver uso produtivo (InfoTip honesto).

## Qualidade

- `npx tsc --noEmit` limpo (strict, noUnusedLocals). Rodar antes de terminar.
- Página deve funcionar com qualquer combinação de inputs (sem NaN/Infinity na tela — usar guards).
- Números conferidos: testar 2-3 casos à mão (ex.: IRRF de R$ 5.000 = R$ 0; parcela Price de 200k/12% a.a. efetiva/360 ≈ R$ 1.963 — a lib usa conversão composta `aToM`, padrão brasileiro).
