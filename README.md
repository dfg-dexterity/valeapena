# ⚖️ vale a pena?

Calculadoras para decisões financeiras no Brasil — compare as duas pontas de cada escolha com números de verdade: **taxas ao vivo do Banco Central**, **impostos de 2026** e **custo de oportunidade**. Uma ferramenta **Dexterity**.

Cada página tem **exportação** (PDF/impressão, CSV e resumo copiável) e uma seção **"Entenda o resultado"** que explica a conta passo a passo, em linguagem simples, com os seus números.

## Ferramentas

| Ferramenta | O que responde |
|---|---|
| 🚗 **Carro: alugar × comprar** | Assinatura 0 km ou compra (0 km ou seminovo de 1–2 anos, à vista/financiada)? Com depreciação por categoria, seguro, manutenção, IPVA por estado, dias sem carro, cashback do cartão e custo de oportunidade — comparação em valor presente com break-even. |
| 🏠 **Financiamento imobiliário** | Simulador SBPE completo: SAC × Price, taxas atuais dos bancos, TR, seguros MIP/DFI, CET, custos de cartório/ITBI, renda mínima e regras do novo modelo de crédito (teto SFH R$ 2,25 mi). |
| 🔑 **Morar: alugar × comprar** | Continuar no aluguel ou comprar o imóvel? Valorização média (FipeZap), reajuste por IGP-M/IPCA ao vivo, ITBI por capital, cartório pelas tabelas reais, IR sobre o ganho de capital na venda (com isenções), FGTS como capital parado, custos do dono × do inquilino — com break-even e aluguel de equilíbrio. |
| 🏦 **Renda fixa na prática** | CDB (grande/médio/pequeno), LCI/LCA, LC, Tesouro Selic/Prefixado/IPCA+ e fundos — todos **líquidos** de IR regressivo, custódia e come-cotas, lado a lado. |
| 📈 **Risco × retorno** | Da poupança ao Bitcoin: simulação de Monte Carlo (2.000 cenários) com bandas de percentil — o que você ganha na mediana e o que arrisca no cenário ruim. |
| 💼 **PJ × CLT** | Líquido real dos dois lados com as tabelas de 2026 (INSS, IRRF com isenção até R$ 5 mil, Simples Nacional com Fator R e tabelas dos Anexos III/V, MEI com DAS fixo e teto), benefícios, férias, FGTS — e os custos de deslocamento e home office por modalidade. |
| 💻 **Upgrade de computador** | Um computador mais rápido se paga? Payback, VPL e quanto custa cada mês de espera. |
| ⏳ **Custo de oportunidade do seu tempo** | Quanto sua hora vale de verdade (método *Your Money or Your Life*) — e quando vale mais investir em skills (retornos da literatura econômica, com rampa realista), terceirizar tarefas (Whillans, PNAS 2017) ou proteger tempo de qualidade (que aqui nunca vira dinheiro — de propósito). |
| 🧭 **Emprego: qual escolher?** | Compare até 4 propostas de trabalho com os critérios que importam para você (5 áreas, 32 critérios — pesos e importância editáveis, salvos no navegador). Financeiro e deslocamento podem virar nota a partir de números reais; o resultado mostra onde o líder perde e que mudança de peso inverteria a decisão. |
| 🔋 **Vale a pena comprar um elétrico?** | Elétrico, híbrido plug-in ou combustão em valor presente: energia (tarifa da sua distribuidora, tarifa branca, solar, recarga na rua) × combustível (ANP, flex otimizado), **infraestrutura de recarga em casa** (tomada dedicada, wallbox, troca do padrão, condomínio ou só rua), depreciação por motorização (Fipe/KBB/Bright 2026), IPVA por estado, seguro, manutenção e provisão de bateria — com break-even em km/mês. |

## Dados

- **Ao vivo**: Selic, CDI, IPCA, IGP-M, TR, poupança e taxas médias de crédito (imobiliário e veículos) via [API SGS do BCB](https://dadosabertos.bcb.gov.br/) ao abrir o app, com fallback embutido (set/2026).
- **Elétricos 2026**: preços e depreciação (Fipe via Motor Show, KBB, Bright, Indicata), tarifas ANEEL por distribuidora, ANP, IPVA estadual, custos de wallbox/instalação (NBR 17019).
- **Mercado imobiliário 2026**: rental yield e valorização FipeZap (jul–ago/2026), ITBI por capital (leis municipais), emolumentos de cartório pelas tabelas CNB-SP/ARISP/CGJ-RJ, IR de ganho de capital com o fator de redução da Lei 11.196/2005.
- **Regras 2026**: salário mínimo R$ 1.621 (Decreto 12.797/2025), INSS (Portaria MPS/MF 13/2026), IRRF com o redutor da Lei 15.270/2025 (isenção até R$ 5 mil/mês), tributação de dividendos (10% acima de R$ 50 mil/mês), Simples Nacional (LC 123/2006), IR regressivo, FGC, novo modelo de crédito imobiliário (CMN out/2025).
- Todos os defaults são **editáveis** — as premissas estão explicadas em tooltips dentro do app.

## Rodando

```bash
npm install
npm run dev      # desenvolvimento
npm run build    # produção (dist/)
```

Stack: Vite · React 19 · TypeScript · Tailwind CSS v4 · Recharts.

> ⚠️ Ferramenta educacional de comparação. Não é recomendação de investimento, de crédito ou aconselhamento tributário.
