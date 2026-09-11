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

#### Morar v2 — FGTS e custos assimétricos (pesquisa ago/2026)

**A) FGTS como capital "parado".** Novos inputs no card "Como você compraria":
- "FGTS usado na compra" (slider R$ 0–300 mil, step 5 mil, default 0). Só é permitido se imóvel ≤ R$ 2,25 mi (Conselho Curador, 26/11/2025) — acima disso, mostrar Aviso e IGNORAR o FGTS na conta (tratar como 0). Clamp: S efetivo = min(S, entrada + custos t0? NÃO — só entrada); se o usuário pedir mais que a entrada, usar S = entrada e avisar em nota. InfoTip com requisitos: 3 anos de FGTS, não ter imóvel residencial no município, não ter financiamento SFH ativo; uso também permitido para amortizar a cada 2 anos (não modelado — nota).
- "Rendimento do FGTS" (% a.a., slider 3–10, step 0,1, default **7,0**). InfoTip: TR + 3% a.a. + distribuição de resultados do fundo — rendimento efetivo total foi 7,09% (2022), 7,78% (2023), 6,05% (2024) e 6,90% (2025), média de ~7,0%; desde o STF (ADI 5090, jun/2024) há piso de IPCA. Fonte: fgts.gov.br.
- **Matemática (forgone value)**: o dinheiro do FGTS, se não usado, ficaria preso rendendo g_f (baixo) — não o CDI. Custo em VP de usar S do FGTS, avaliado no mês m: `S × ((1+g_f_mensal)/(1+d))^m` (o valor que ele teria no mês m, descontado a d). Implementação: `pvSaidasBuy` começa com `(entrada − S) + custosT0`; a linha "comprar se vender no mês m" soma `S × ((1+gfM)/(1+d))^m`; `custoBuy` usa m = N. Com g_f < d (caso normal), usar FGTS BARATEIA a compra, e o barateamento cresce com o horizonte. Identidade da composição: `fgtsCredito = S − S×((1+gfM)/(1+d))^N ≥ 0` entra como CRÉDITO (mesma mecânica de capCredito/jurosCredito: não vira fatia; nota explica). Verdict: quando S > 0, mencionar no detail que R$ S vêm do FGTS rendendo só g_f% preso no fundo.
- Simplificação declarada (nota): assume que sem a compra o saldo ficaria intocado até o fim do horizonte (sem saque-aniversário/rescisão).

**B) Custos do DONO (lado comprar), além da manutenção já existente** — novo Collapse "Custos do dono × do inquilino":
- "Condomínio (referência)" R$/mês — padrão user-override: default `max(450, round(valor × 0,0007 / 10) × 10)` (média nacional R$ 527/mês, Cerus 2026; ~0,07% do valor/mês) acompanhando o slider de valor até o usuário editar. O condomínio ORDINÁRIO em si fica FORA da conta (igual nos dois lados — inquilino paga, art. 23 §1º da Lei 8.245/91); ele existe só para derivar a linha abaixo.
- "Extraordinárias + fundo de reserva" (% do condomínio, slider 0–25, default **10**): despesas extraordinárias são do PROPRIETÁRIO por lei (art. 22, parágrafo único: obras estruturais, pintura de fachada, fundo de reserva…). Custo mensal do lado comprar = condomínio × %, crescendo com o reajuste (inflação) a cada 12 meses.
- "Seguro residencial (dono)" R$/ano, slider 0–3.000 step 50, default **500** (faixa de mercado R$ 300–800/ano) — lado comprar, /12 por mês, crescendo com o reajuste.
- "Mudança + adaptação na compra" R$ único em t0, default **2.000** (mudança local em capital, guias 2026) — some em custosT0 (não entra no ITBI/registro %).

**C) Custos do INQUILINO (lado alugar)** — mesmo Collapse:
- "Garantia" (Segmented: **Fiador** (custo 0) | **Seguro-fiança** (default selecionado — modalidade líder em capitais: 31,4% dos contratos, CRECI-SP jan/2026) | **Caução**).
  - Seguro-fiança: slider "% do aluguel" 5–20, default **12** (mercado: 8–15% do aluguel anual ≈ 1,0–1,8 aluguel/ano; não devolvido). Custo mensal = aluguel vigente × 12%.
  - Caução: 3 aluguéis (art. 38 §2º) imobilizados em t0, devolvidos no fim corrigidos pela POUPANÇA — custo em VP = `3×A₀ − 3×A₀×((1+poupM)/(1+d))^N` (mesma mecânica forgone-value do FGTS; poupança = `rates.poupancaMes`). Sem custo mensal.
  - Fiador: 0.
- "Seguro incêndio (inquilino)": % do aluguel/mês, slider 0–3 step 0,1, default **0,8** (R$ 15–50/mês; por lei é do locador — art. 22 VIII — mas os contratos transferem; nota).
- "Mudança a cada X anos": slider 0–10 anos, step 0,5, default **3** (contrato-padrão de 30 meses; 0 = "nunca mudo, fico no mesmo imóvel"). A cada ciclo (meses 36, 72, …, exclusive o mês 0 e só se ≤ N): custo = mudança (R$, slider default **2.000**) + pintura de devolução de **1 aluguel vigente** (art. 23 III; guias 2026: ~1–1,5 aluguel), ambos em VP.
- Taxa de cadastro e corretagem de locação: R$ 0 SEMPRE — são do proprietário por lei (art. 22 VII; cobrar do inquilino é contravenção, art. 43) — citar na nota como "custo zero por lei".

**D) Ajustes decorrentes:**
- `custoRent` agora = PV(aluguéis) + PV(garantia) + PV(seguro incêndio) + PV(mudanças + pinturas). A linha do gráfico "Alugar" acumula tudo.
- **Aluguel de equilíbrio deixa de ser proporção simples**: custoRent(A) = A×k + C_fix (mudança fixa não escala com A; caução, seguro-fiança, incêndio e pintura escalam). Calcular `k = (custoRent − C_fixVP)/A₀` e `aluguelEq = (custoBuy − C_fixVP)/k` (guards para k ≤ 0 / valores negativos como hoje). O REVISOR deve verificar re-simulando com aluguelEq.
- Composição (barras): lado Comprar mantém cap/jur/trans e a fatia "man" vira **"Manutenção e encargos do dono"** = manutenção + extraordinárias + seguro residencial (em VP). Lado Alugar ganha uma 2ª fatia **"Garantia, seguros e mudanças"** (colorIndex 4) além do aluguel. Identidades exatas continuam obrigatórias (créditos fora do gráfico com nota, como hoje).
- Tiles: sub do tile "Alugar — VP" menciona que inclui garantia/mudanças; premissas e fontes ganham bullets: Lei 8.245/91 arts. 22/23 (ordinárias × extraordinárias), CRECI-SP (garantias), fgts.gov.br (rendimento), guias 2026 (mudança/pintura).
- IPTU e condomínio ordinário: seguem fora dos dois lados (inquilino paga na prática) — atualizar o bullet citando art. 22 VIII ("salvo disposição em contrário", praxe de transferir) em vez de "praxe consolidada" genérica.

### Computador.tsx — Upgrade de computador
Inputs: custo do novo (default 15.000), revenda do atual (3.000), vida útil (1–6 anos, default 3), valor da hora (salário mensal default 10.000 → /176, ou custom), modo do ganho (Segmented): "minutos/dia" (default 30 min) × "% mais rápido" (velocidade +30% em tarefas que ocupam 25% do tempo → tempo economizado = horas×%tempo×(1−1/1,3)), horas/dia (8), dias/mês (21), custo de oportunidade (CDI), revenda do novo no fim (default 35% do preço).
Modelo: valor mensal = horas economizadas×valor hora; custo líquido inicial = custo − revenda atual; payback = mês em que valor acumulado ≥ custo acumulado com juros (CDI); VPL na vida útil incluindo revenda final; ROI.
Saídas: Verdict (payback em meses vs vida útil; "cada mês sem trocar custa R$ X"), StatTiles (payback, VPL, horas/ano economizadas, valor gerado/mês), gráfico de linhas: valor acumulado × custo+juros (cruzamento = payback, 2 séries), barras de cenários (ganho 50%/100%/150% → VPL de cada, cor por sinal: negativo `c.negative`, positivo `c.positive` via `colorByValue`), tabela ano a ano. Nota: ganhos de produtividade só viram dinheiro se o tempo liberado tiver uso produtivo (InfoTip honesto).

## Rodada 3 — Marca Dexterity, exportação e didática

### R3.1 Marca Dexterity (tema global)

Paleta oficial (manual em uso na empresa): Off White `#f7f3e7`, Grafite `#4d4d4d`, Verde Cerceta `#009994`, Roxo Flamingo `#98569A`, Amarelo Cromo `#FFA436`, Verde Musgo `#597C59`. Fontes: **Boston** (texto, pesos 400/600/700) e **Proxima Soft ExCn** (títulos/display, 500/700). Assets já copiados: `public/brand/fonts/*.otf`, `public/brand/logo-{cor,negativa,offwhite}.svg` (horizontais, viewBox 836×227), `public/brand/icone-d.png` (favicon 128px).

**index.css** — substituir tokens mantendo TODOS os nomes (`--page`, `--surface`…, nada de renomear):
- `@font-face`: Boston 400/600/700 e Proxima Soft ExCn 500/700, `src: url('/brand/fonts/…') format('opentype')`, `font-display: swap`. `--font-sans: 'Boston', system-ui…`; nova `--font-display: 'Proxima Soft ExCn', 'Boston', sans-serif` (expor no `@theme inline` como `--font-display` p/ classe `font-display`).
- Dark (padrão) em grafite QUENTE: page `#171614`, surface `#211f1c`, surface-2 `#2a2824`, surface-3 `#34312c`, ink `#f7f3e7` (off white), ink-2 `#c9c4b2`, mute `#948f7d`, line `rgba(247,243,231,.11)`/strong `.19`, grid `#312f2a`, axis `#403d36`, accent `#1cb3ad` (cerceta clara p/ contraste), accent-ink `#08211f`? NÃO — accent-ink `#ffffff` só se contraste ≥4,5; com `#1cb3ad` use accent-ink `#0c2b29`. accent-soft `rgba(28,179,173,.15)`. positive/negative/warning mantêm semântica atual (verde/vermelho/âmbar — dinheiro precisa de vermelho; a paleta Dexterity não tem).
- Light em OFF WHITE: page `#f7f3e7`, surface `#fffdf8`, surface-2 `#f0ebdc`, surface-3 `#e6e0cd`, ink `#33312c`, ink-2 `#5d5a4f`, mute `#8d887a`, line `rgba(77,77,77,.15)`/strong `.26`, grid `#e4decb`, axis `#c7c0aa`, accent `#00807b` (cerceta escurecida p/ AA em texto), accent-ink `#ffffff`, accent-soft `rgba(0,153,148,.12)`.
- h1‑h3 e `.font-display`: família display. Números continuam em Boston + `.tnum`.

**theme.tsx / useVizColors** — nova ordem fixa de séries (mantém semântica slot 0 = principal/“comprar”, 1 = alternativa, e distinção p/ daltonismo por matiz+luminância):
- dark: `['#22c1ba', '#ffa436', '#c084c2', '#8fb08f', '#e87ba4', '#3987e5', '#c98500', '#e66767']`
- light: `['#00807b', '#c56f00', '#98569a', '#597c59', '#c95c86', '#2a78d6', '#9c6a00', '#d03b3b']`
- grid/axis/surface/ink acompanham os novos tokens acima. positive/negative/warning inalterados.

**App.tsx** — TopBar: wordmark “vale a pena?” com `font-display` (peso 700, tracking normal); badge do ícone continua (bg-accent). Footer: logo Dexterity (`<img>` trocando por tema: `logo-cor.svg` no light, `logo-offwhite.svg` no dark, h-6, `alt="Dexterity"`) + linha “uma ferramenta Dexterity · vale a pena?”. **Adicionar rota `/tempo`** (lazy `pages/Tempo`) e entrada no TOOLS: label “Tempo”, title “Custo de oportunidade do seu tempo”, desc “Quanto vale sua hora — e quando vale mais investir em você, terceirizar tarefas ou proteger tempo de qualidade.”, icon `Hourglass`.

**index.html** — `<title>vale a pena? · Dexterity</title>`, favicon `/brand/icone-d.png`, `<meta name="theme-color" content="#009994">`, preload de `Boston-Regular.otf` e `ProximaSoftExCn-Bold.otf` (`as="font" crossorigin`).

**pages/Tempo.tsx** — criar PLACEHOLDER mínimo compilável (ToolPage com um Card “em construção”) — a página real vem na etapa seguinte.

### R3.2 Exportação (todas as páginas)

`src/components/ui.tsx` ganha:
- `usePrintExport()` — hook: se tema atual é dark, troca p/ light, espera ~450 ms (recharts re-render), `window.print()`, e restaura o tema no `afterprint`. ThemeProvider ganha `set(theme)` além de `toggle`.
- `ExportBar({ pagina, resumo, csv, premissas })`:
  - `pagina: string` (slug p/ nome de arquivo), `resumo: string` (texto multi-linha pronto), `csv?: { nome: string; colunas: string[]; linhas: (string|number)[][] }`, `premissas?: [string, string][]`.
  - Renderiza barra compacta (borda `line`, ícones lucide `Printer`/`FileDown`/`Copy`) com 3 botões: **“PDF / imprimir”** (usePrintExport), **“CSV”** (só se `csv`; gera com BOM `﻿`, separador `;`, decimais com vírgula — Excel pt-BR — e baixa via Blob), **“Copiar resumo”** (clipboard; feedback “Copiado ✓” por 2 s).
  - Renderiza também `<div className="print-only">` com: logo Dexterity, título da página, data (`new Date().toLocaleDateString('pt-BR')`), e grade 2 colunas das `premissas` — visível SÓ na impressão.
- CSS de impressão em index.css (`@media print`, DEPOIS dos blocos de tema): esconde `header, footer, nav`, coluna de inputs (`.print-hide`), a própria ExportBar (botões), Collapse fechados; `.print-only { display: block }` (na tela, `display: none`); resultados em coluna única largura total; `print-color-adjust: exact`; fundo branco (redefinir tokens claros em `:root` dentro do `@media print` — cobre o caso raro de imprimir antes do switch de tema).
- `ToolPage` marca a coluna de inputs com `print-hide`.
- Cada página monta `resumo`/`csv`/`premissas` com seus números REAIS e coloca `<ExportBar>` logo abaixo do `Verdict`.

### R3.3 “Entenda o resultado” (didática, todas as páginas)

`ui.tsx` ganha `Didatico({ passos, analogia, sensibilidade })`:
- `passos: { t: string; d: ReactNode }[]` — passo a passo numerado (círculos com número em `accent-soft`), título curto + explicação em linguagem de 6º ano.
- `analogia?: ReactNode` — caixa destacada (`surface-2`, ícone `Lightbulb`) “Em outras palavras…”.
- `sensibilidade?: ReactNode` — caixa “O que mudaria a resposta” (ícone `SlidersHorizontal`).
- Renderiza como `Card title="Entenda o resultado"` com ícone `GraduationCap`, posicionado no FIM dos resultados (antes de premissas/fontes).
Regras de conteúdo (cada página): os textos interpolam os NÚMEROS ATUAIS do usuário (nunca texto estático); explicar VPL como “trouxemos tudo para dinheiro de hoje, porque R$ 100 daqui a 5 anos valem menos que R$ 100 agora — dá para saber quanto seus R$ 100 renderiam no CDI”; 3–5 passos; 1 analogia concreta do cotidiano; 1 frase de sensibilidade honesta (“se X mudar para Y, o resultado inverte”).

### R3.4 rates.tsx — IGP-M e fallbacks set/2026

- Novo campo `igpm12m` (% acumulado 12 m). Não há série SGS pronta com CORS p/ 12 m: buscar `bcdata.sgs.189/dados/ultimos/12` e compor `(∏(1+vᵢ/100) − 1)×100`; falhou → fallback.
- FALLBACK_RATES capturado em 06/09/2026: selic 14.00, cdi 13.90, ipca12m 4.44, trMes 0.1690, poupancaMes 0.6698, imobMercado 14.28, imobRegulado 10.92, imobTotal 11.30, veiculos 26.52, igpm12m 2.18, referencia 'set/2026'.

### R3.5 Morar v3 — precisão e dados de mercado (pesquisa 06/09/2026)

Já adicionados em `dados2026.ts`: `ITBI_CIDADES`, `custoCartorio(valor, primeiroImovelSfh)`, `TARIFA_ADM_MENSAL` (25), `IPTU_EFETIVO_AA` (0,005), `REGRAS_IMOBILIARIO.taxaAvaliacao` agora 3100; em `tax2026.ts`: `irGanhoCapitalImovel(ganho, mesesPosse)`. `rates.igpm12m` disponível (R3.4).

1. **Defaults recalibrados (FipeZap jul–ago/2026):** aluguel user-override passa de 0,45% → **0,51% do valor/mês** (yield 6,14% a.a., FipeZap jul/2026); valorização default 5,0 → **5,5% a.a.** (venda 12m +5,49%, ago/2026); condomínio referência `max(450, valor×0,0007…)` → **`max(530, round(valor × 0,0010 / 10) × 10)`** (Censo Condominial 2026: média nacional R$ 527/mês; SP R$ 1.085 — InfoTip cita os dois).
2. **Índice de reajuste do aluguel** — substituir o slider único por Segmented **IGP-M | IPCA | Outro**: IGP-M usa `rates.igpm12m` (2,16%) e é o DEFAULT (índice dominante nos contratos); IPCA usa `rates.ipca12m` (4,44%); Outro abre o slider atual. InfoTip: "hoje o IGP-M reajusta MENOS que o IPCA — nem sempre foi assim (2021: IGP-M ~37%)". LiveBadge nos dois primeiros.
3. **ITBI por cidade** — select/Segmented compacto de `ITBI_CIDADES` acima do slider de ITBI %: escolher cidade seta o slider (user-override continua editável). Nota: reduções SFH p/ parcela financiada existem em SP/POA/Floripa/CWB/BSB (não modeladas — citar no InfoTip).
4. **Cartório por tabela real** — trocar `registroPct` (% linear) por `custoCartorio(valor, primeiroSfh)` com Toggle "1º imóvel financiado pelo SFH (–50% de emolumentos, Lei 6.015/73 art. 290)" default off. Mostrar o valor em R$ no hint. Avaliação bancária: usar `REGRAS_IMOBILIARIO.taxaAvaliacao` (3100), só se financiado (como hoje).
5. **Tarifa de administração** — cenário financiado soma `TARIFA_ADM_MENSAL` (R$ 25/mês, slider 0–50 no avançado — privados às vezes isentam) aos extras mensais junto de MIP/DFI.
6. **IR sobre ganho de capital na venda** (novo, no fim do horizonte): custo de aquisição = preço + ITBI + cartório (IN SRF 84/2001); ganho = valorFinal×(1−corretagem)? NÃO — ganho tributável usa preço de venda CHEIO menos custo de aquisição (corretagem também deduz do preço de venda — IN 84/2001 permite deduzir corretagem paga pelo vendedor: ganho = valorFinal×(1−corret) − custoAquis). IR = `irGanhoCapitalImovel(ganho, N_meses)`. Toggle no avançado: "Terei isenção na venda (art. 39: comprar outro imóvel em 180 dias, 1×/5 anos — ou único imóvel ≤ R$ 440 mil)" default **on** (caso típico de quem vende para morar em outro) → IR = 0; quando off, o IR reduz a venda líquida no mês N (e some na linha do gráfico/composição como parte da transação). Isenção automática: se venda ≤ 440 mil, IR = 0 com nota. StatTile/nota mostrando o IR estimado quando > 0.
7. **IPTU (rigor)** — Toggle no Collapse "Custos do dono × do inquilino": "No aluguel, o contrato repassa o IPTU ao inquilino?" default **sim** (mercado; IPTU segue fora dos dois lados). Se **não**: lado COMPRAR soma IPTU mensal = `IPTU_EFETIVO_AA`(slider 0,2–1,0%, default 0,5)×valorAtualizado/12 (só o dono paga). InfoTip: art. 22 VIII Lei 8.245/91.
8. **Manutenção** — hint atualizado: 0,5%/ano é típico de APARTAMENTO (condomínio absorve estrutura); casa: usar ~1,0%.
9. **Premissas/fontes** — atualizar bullets: FipeZap jul–ago/2026 (yield 6,14%, venda +5,49%), FGV IGP-M ago/2026, Censo Condominial 2026, tabelas CNB-SP/ARISP/CGJ-RJ 2026, Lei 13.259/2016 + Lei 11.196/2005 (FR2), art. 290 Lei 6.015/73.
10. **Guards**: identidades da composição continuam exatas (IR e cartório entram em `transVP`); aluguel de equilíbrio continua correto (IR não depende do aluguel — entra no lado buy; re-derivar `k`/fixos se necessário). Sem NaN em extremos (ganho negativo → IR 0).

### R3.6 Tempo.tsx — Custo de oportunidade do seu tempo (página NOVA)

Rota `/tempo` (TOOLS já criado na R3.1). Ícone `Hourglass`. Compara o valor REAL da hora com três usos do tempo/dinheiro. Base científica pesquisada em 06/09/2026 — citar fontes nos InfoTips e no card de premissas (URLs abaixo).

**Inputs — Card "Seu trabalho hoje":**
- Renda líquida mensal (slider 1.500–50.000, step 100, default 5.000; InfoTip: renda média BR T1/2026 = R$ 3.722, PNAD).
- Horas contratadas/semana (20–60, default 44) · Horas extras habituais/semana (0–30, default 0).
- Dias presenciais/semana (0–7, default 5) · Deslocamento porta-a-porta ida+volta, min/dia (0–240, default 60; InfoTip IPEA: média BR ~30 min/trajeto, SP/RJ +31%).
- Preparo + descompressão, min/dia (0–120, default 45; InfoTip Your Money or Your Life).
- Gastos que só existem por causa do trabalho, R$/mês (user-override: default 8% da renda; transporte, roupa, comida fora, "recompensas").

**Motor — custo-hora real (YMOYL, Vicki Robin):**
```
horasSemana = contratada + extra + (desloc/60)×diasPresenciais + (prep/60)×diasTrabalho(=5)
horasMes    = horasSemana × 4,345
wNominal    = renda / (contratada × 4,345)
wReal       = (renda − gastosTrabalho) / horasMes
```
Hero: par de StatTiles "sua hora no contracheque R$ X" × "sua hora de verdade R$ Y (−Z%)" + tile horas reais/mês + tile "1h/dia desperdiçada = R$ W/mês" (= wReal×21,7).

**Card "O que você quer avaliar" — Segmented `modo` (3 análises, cada uma com seus inputs + resultados):**

A) **Investir em você (skill)** — inputs: tipo (select com ΔW default: Certificação profissional +8% | Inglês fluente +15% | Pós/especialização +10% | Treinamento curto +3% | Personalizado), custo total R$ (default 5.000), horas de estudo/semana (1–20, default 5), duração do estudo em meses (3–36, default 12), chance de capturar o aumento % (30–90, default 60; InfoTip: nem todo curso vira aumento — parâmetro seu, não ciência), horizonte de carreira anos (3–30, default 15). Avançado: fração do estudo que sai do trabalho/lazer pago k (0–1, default 0,5), desconto real % a.a. (default 7,0 — juro real Tesouro IPCA+ 2026; TUDO nesta análise em termos REAIS, sem inflação).
Modelo: `custoTotal = custo + horasEstudo×4,345×duração×wReal×k`; benefício anual pleno = `renda×12×ΔW%×p`; rampa Card-Kluve-Weber: ano 1 = 25%, ano 2 = 60%, ano 3+ = 100% (contada APÓS o fim do estudo); `VPL = Σ benefício_t/(1+r)^t − custoTotal` (t em anos, horizonte T). Saídas: Verdict (VPL + payback em anos + "aumento mínimo p/ empatar com o Tesouro IPCA+" resolvido de ΔW), linha VPL acumulado × anos (cruza zero no payback; série 0), barras de sensibilidade (ΔW×0,5 | ΔW | ΔW×1,5 → VPL, cor por sinal), nota Pencavel se horasSemana+horasEstudo > 50 ("acima de ~50h/semana sua produtividade por hora cai — parte do estudo vai sair do seu rendimento").
B) **Terceirizar tarefas** — inputs: tarefa (Segmented: Faxina R$ 380/mês·12h | Cozinhar/marmita R$ 700/mês·20h | Lavanderia R$ 250/mês·6h | Personalizado) com preço R$/mês e horas liberadas/mês editáveis; "você detesta essa tarefa?" (Segmented: gosto 0,8 | tanto faz 1,0 | detesto 1,3); "o que fará com o tempo?" (Segmented: já sei (trabalho, estudo, família, lazer ativo) 1,0 | não sei 0,5).
Modelo: `valorHoraLiberada = wReal×fDesgosto×fUso`; `ganhoMes = horas×valorHoraLiberada − preço`; `precoHora = preço/horas`. Saídas: Verdict ("cada hora liberada custa R$ A e vale R$ B para você" + ganho/mês), barras comparando preço×valor (2 barras), nota Whillans PNAS 2017 (6.271 adultos; comprar tempo → mais satisfação; só 2% pensam nisso).
C) **Hora extra × tempo de qualidade** — inputs: horas extras adicionais/semana (1–20, default 4), adicional sobre a hora (%: 50 CLT | 0 PJ sem adicional | custom, default 50), "de onde sai o tempo?" (Segmented: lazer | família | sono).
Modelo: valor bruto hora extra = `wNominal×(1+adicional)`; se `horasTotais > 50`, aplicar fator Pencavel `max(0,6, 1 − 0,04×(horasTotais−50))` por hora acima de 50 (rotulado como aproximação didática do decaimento); ΔrendaPct = rendaExtra/renda; leitura log-linear (Killingsworth/KKM 2023): mostrar "essas horas aumentam sua renda em X% — o bem-estar sobe com o LOG da renda: dobrar de 3 p/ 6 mil vale tanto quanto de 10 p/ 20 mil". Saídas: Verdict (R$/mês extra e valor efetivo/hora após o desconto de produtividade), curva "valor efetivo da hora × horas semanais totais" com ReferenceLine em 50h (refY não — refX? usar refY se o wrapper só tem refY: então plotar linha horizontal = wNominal e curva decaindo; escolher o que o wrapper suportar), e os ALERTAS ASSIMÉTRICOS (nunca monetizar): família → Milkie 2015 ("com adolescentes, tempo ENGAJADO protege — essa troca ameaça blocos que não têm preço"); sono/lazer → Kasser & Sheldon (time affluence) + Whillans. Se deslocamento aumentar em algum cenário → Stutzer & Frey (−0,28 pt de satisfação por +1h; salário maior normalmente NÃO compensa).

**Regras de honestidade (obrigatórias, da pesquisa):** f_desgosto/f_uso/k/p/rampa/fator Pencavel são PARÂMETROS DE DESIGN rotulados como tal (InfoTip "convenção do app inspirada em X, não medida científica"); tempo de família NUNCA vira R$; alertas só CONTRA reduzir blocos de família, nunca a favor. Card "Premissas e fontes" com as citações: Robin & Dominguez (YMOYL), Whillans et al. PNAS 2017, Psacharopoulos & Patrinos 2018 (~9–10%/ano; ALC 11%), OCDE EAG 2025 (BR +148% superior), Card-Kluve-Weber 2018 (rampa 2–3 anos), Pencavel 2015 (~50h), Stutzer & Frey 2008, Killingsworth 2021 + KKM 2023, Milkie 2015 / Hsin & Felfe 2014, Kasser & Sheldon 2009.
**Didatico:** mensagens 1 (hora real), 2 (comprar tempo), 7 (50h), 9 (log da renda) e 10 (família) da pesquisa, interpoladas com os números do usuário. ExportBar completa (CSV = tabela do modo ativo; resumo = wReal + veredito do modo).

### R3.7 ExportBar + Didatico em TODAS as páginas

Cada página (Carro, Imovel, Morar, Investimentos, Risco, PjClt, Computador, Tempo):
1. `<ExportBar>` logo abaixo do `Verdict`, com: `pagina` (slug), `resumo` (texto multi-linha: veredito com números + 3–5 linhas-chave + "gerado por vale a pena? · Dexterity — valeapena-flame.vercel.app"), `csv` (a tabela principal da página: mesmas linhas do DataTable de detalhamento), `premissas` (pares [label, valor] dos inputs relevantes — TODOS os que afetam a conta, formatados).
2. `<Didatico>` no fim dos resultados (antes de premissas/fontes): 3–5 passos com os números REAIS calculados, 1 analogia, 1 sensibilidade. Conteúdo específico por página (ex.: Carro explica depreciação+VPL; Investimentos explica IR regressivo e por que isento ≠ melhor; Risco explica p10/p90 e "risco não é ruim, é preço"; PjClt explica Fator R e o custo invisível do deslocamento; Computador explica payback).
3. Não alterar a matemática existente das 6 páginas antigas (exceto Morar, R3.5).

## Rodada 4 — Emprego.tsx: qual proposta escolher? (página NOVA)

Rota `/emprego` (TOOLS/route já registrados em App.tsx, ícone `Compass`). Dados em `src/lib/carreira.ts` (LEIA: `AREAS_CARREIRA` 5 áreas c/ `pesoPct` somando 100, `CRITERIOS_CARREIRA` 32 critérios c/ `importancia` default = perfil da planilha do usuário, `pergunta`-guia e `objetivo?` p/ 4 critérios pontuáveis por números reais; `IMPORTANCIA_LABELS`, `NOTA_LABELS`, `OPCOES_PADRAO`). Origem: planilha "Career Choice Worksheet" do usuário — ela só media *o que importa* (importância × peso); esta página REESTRUTURA em 3 etapas mais intuitivas: **1) seu perfil → 2) pontue cada proposta → 3) ranking com sensibilidade**.

**Layout** (ToolPage): coluna de inputs = Etapa 1; coluna principal = Verdict → ExportBar → Etapa 2 (propostas + matriz) → Etapa 3 (resultados) → Didatico → premissas. Cabeçalhos numerados “1 · Seu perfil”, “2 · Suas propostas”, “3 · Resultado” (círculo com número em `accent-soft`) para guiar.

**Etapa 1 — Seu perfil (inputs, sticky):**
- Card “Peso de cada área”: 5 SliderFields 0–50% step 5 (defaults 20/25/10/20/25). Linha “Soma: X%” — se ≠ 100, Aviso âmbar “os pesos são normalizados para 100%” (a conta SEMPRE normaliza por ΣW; se ΣW = 0 → pesos iguais + aviso).
- 5 `Collapse` (um por área, fechado por padrão, título com a área e “n critérios”): para cada critério um seletor compacto de importância 1–5 (Segmented pequeno ou 5 botões-pílula com o número; tooltip mostra `IMPORTANCIA_LABELS`). Defaults = `importancia` de carreira.ts, com nota “pré-preenchido com o perfil da sua planilha”.
- Botão “Recomeçar” (ícone `RotateCcw`) que volta perfil e propostas aos defaults.
- **Persistência**: tudo (pesos, importâncias, propostas com notas e números) em `localStorage` chave `valeapena-emprego-v1`, com try/catch e carga no primeiro render (lazy initializer); qualquer mudança salva (debounce não é necessário). Nada vai para servidor.

**Etapa 2 — Suas propostas (coluna principal):**
- Card “2 · Suas propostas”: lista de 1–4 opções (default `OPCOES_PADRAO`); cada uma com nome editável (input texto, máx. 24 chars), botão remover (mín. 1) e “+ Adicionar proposta” (máx. 4). Toggle da página “Pontuar Financeiro e deslocamento pelos números reais” (default OFF). Quando ON, cada opção mostra 4 NumberFields: salário líquido/mês (R$), benefícios/mês (R$), bônus e incentivos/ano (R$), deslocamento ida+volta (min/dia).
- Card “Pontue cada critério de 1 a 5”: matriz critérios × opções, agrupada por área (cabeçalho da área com peso e um botão para recolher o grupo); coluna 1 = nome do critério + pergunta-guia em `text-mute` (InfoTip com `pergunta`); uma coluna por opção com seletor 1–5 (5 botões-pílula compactos; selecionado em `accent`; tooltip `NOTA_LABELS`). Default de toda nota = 3 (“Ok”). Contador “X de Y notas ainda no padrão (3)” acima da matriz. Container com `overflow-x-auto` e 1ª coluna `sticky left-0` (mobile). Para os 4 critérios com `objetivo`, quando o toggle de números está ON: a célula vira read-only mostrando a nota automática + badge “auto” (fórmula abaixo); OFF: manual.
- **Nota automática** (por critério objetivo, entre as opções que têm o número preenchido): `x = 1 + 4 × (v − min)/(max − min)`; se max = min (ou só 1 opção) → 3; `commute` é INVERTIDO (menor tempo = 5). Opção sem o número preenchido → mantém a nota manual. InfoTips: deslocamento cita Stutzer & Frey 2008 (+1h/trajeto ≈ −0,28 pt de satisfação; salário maior normalmente não compensa) e salário cita a leitura log-linear (Killingsworth 2021: bem-estar sobe com o % de aumento, não com o valor absoluto) — mesmas fontes já usadas em Tempo.tsx.

**Matemática (matriz de decisão ponderada, tudo em `useMemo`):**
```
Wn_a      = W_a / ΣW                                   (pesos normalizados; ΣW=0 → 1/5 cada)
areaScore_{o,a} = Σ_{s∈a} w_s·x_{o,s} / (5·Σ_{s∈a} w_s)  ∈ [0,2 ; 1]   (w = importância 1–5, x = nota 1–5)
total_o   = 100 · Σ_a Wn_a · areaScore_{o,a}            ∈ [20 ; 100]
pesoEfetivo_s = Wn_a · w_s / Σ_{s∈a} w_s                (quanto cada critério pesa no total; Σ_s = 1)
contrib_{o,s} = 100 · pesoEfetivo_s · x_{o,s}/5         (Σ_s contrib = total_o — identidade obrigatória)
```
- Ranking por `total` (desc). Líder L e vice R.
- **Sensibilidade por área**: para cada área a, varrer W_a' de 0 a 100 (passo 1) mantendo as OUTRAS áreas proporcionais entre si (renormalizar) e achar o menor |W_a' − W_a| em que R ≥ L. Reportar o flip mais próximo (“se *Financeiro* pesasse 12% (hoje 25%), *Proposta A* passaria à frente”) ou “nenhum ajuste de peso de UMA área sozinha inverte o resultado”. Verificar re-calculando totais no ponto reportado.
- **Onde o líder perde**: critérios com `contrib_{R,s} − contrib_{L,s} > 0`, ordenados pela diferença — top 5 com a diferença em pontos.
- **Área decisiva**: a área com maior `Wn_a·(areaScore_L − areaScore_R)·100`.
- Margem: `total_L − total_R` (pts de 100).

**Etapa 3 — Resultado (coluna principal):**
- `Verdict`: com ≥2 opções e margem ≥ 0,5 pt → “**{L}** é a melhor escolha para o seu perfil: {total_L} de 100, {margem} pts à frente de {R}” (tone positive; badge “+{margem} pts”); margem < 0,5 → “Empate técnico entre {L} e {R}” (neutral) + dica para pontuar os critérios que ainda estão no padrão; 1 opção só → neutral “Adicione uma proposta para comparar”. Se `notasPadrao ≥ 50%` das células, badge âmbar “resultado preliminar”.
- ExportBar (`pagina: 'emprego'`; csv = matriz completa: critério, área, importância, peso efetivo %, nota e contribuição de cada opção + linha TOTAL; resumo = ranking com totais + área decisiva + flip; premissas = pesos das áreas, nº de propostas, toggle números, nº de notas no padrão).
- StatTiles (grid 2×2): total do líder, margem sobre o vice, área decisiva (com a diferença em pts), critérios ainda no padrão.
- Gráfico 1 “Ranking” — `VBarChart` 1 série (total 0–100), `colorByValue` destacando o líder em `accent` e os demais em `mute`/série neutra; rótulo = nome da opção.
- Gráfico 2 “Por área” — `VBarChart stacked={false}` x = área (nome curto), séries = opções (colorIndex 0..3, ordem das opções), y = areaScore×100 (“% do máximo”).
- Gráfico 3 “O que mais pesa para você” — top 10 `pesoEfetivo_s` em %, 1 cor (accent); sub: “importância × peso da área”.
- Card “Onde {L} perde” — DataTable dos até 5 critérios em que R supera L (critério, área, nota L, nota R, diferença em pts). Se vazio: “{L} vence ou empata em todos os critérios”.
- Card “E se…” — a frase da sensibilidade por área + “diferença de {margem} pts equivale a {margem / (100·pesoEfetivo_max/5)} nota(s) no seu critério mais importante ({nome})” (arredondar 1 casa).
- Card “Detalhamento” — DataTable da matriz (critério, área, importância, peso efetivo %, nota por opção) — pode ser o mesmo dataset do CSV.
- `Didatico`: (1) “cada critério vale pontos = importância × peso da área” citando o critério de maior peso efetivo com o % real; (2) “cada proposta recebe nota 1–5; multiplicamos pelo peso e somamos: {L} fez {total_L} de 100” ; (3) “o ranking reflete as SUAS prioridades de hoje — se mudar a importância, o resultado muda” (+ se toggle ON: “salário, benefícios, bônus e deslocamento viraram nota sozinhos: o maior = 5, o menor = 1”); analogia: boletim escolar em que as matérias têm pesos diferentes (ou júri com votos de pesos diferentes); sensibilidade = a frase do flip.
- Card “Método e fontes”: matriz de decisão ponderada (SMART — Edwards 1977; “weighted scoring”), estrutura de 5 áreas/32 critérios da Career Choice Worksheet; Stutzer & Frey 2008; Killingsworth 2021 — e a honestidade: “a nota mede aderência ao seu perfil, não ‘qualidade’ da empresa”.

**Guards/UX**: sem NaN (ΣW=0, Σw=0 numa área → areaScore = 0,6 (nota 3) com aviso, 1 opção); nomes vazios → “Proposta N”; max 4 opções; mobile empilha e a matriz rola dentro do card; tudo pt-BR; sem novas dependências; `npx tsc --noEmit` limpo.

## Qualidade

- `npx tsc --noEmit` limpo (strict, noUnusedLocals). Rodar antes de terminar.
- Página deve funcionar com qualquer combinação de inputs (sem NaN/Infinity na tela — usar guards).
- Números conferidos: testar 2-3 casos à mão (ex.: IRRF de R$ 5.000 = R$ 0; parcela Price de 200k/12% a.a. efetiva/360 ≈ R$ 1.963 — a lib usa conversão composta `aToM`, padrão brasileiro).
