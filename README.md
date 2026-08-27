# ⚖️ vale a pena?

Calculadoras para decisões financeiras no Brasil — compare as duas pontas de cada escolha com números de verdade: **taxas ao vivo do Banco Central**, **impostos de 2026** e **custo de oportunidade**.

## Ferramentas

| Ferramenta | O que responde |
|---|---|
| 🚗 **Carro: alugar × comprar** | Assinatura 0 km ou compra (à vista/financiada)? Com depreciação por categoria, seguro, manutenção, IPVA por estado e custo de oportunidade — comparação em valor presente com break-even. |
| 🏠 **Financiamento imobiliário** | Simulador SBPE completo: SAC × Price, taxas atuais dos bancos, TR, seguros MIP/DFI, CET, custos de cartório/ITBI, renda mínima e regras do novo modelo de crédito (teto SFH R$ 2,25 mi). |
| 🏦 **Renda fixa na prática** | CDB (grande/médio/pequeno), LCI/LCA, LC, Tesouro Selic/Prefixado/IPCA+ e fundos — todos **líquidos** de IR regressivo, custódia e come-cotas, lado a lado. |
| 📈 **Risco × retorno** | Da poupança ao Bitcoin: simulação de Monte Carlo (2.000 cenários) com bandas de percentil — o que você ganha na mediana e o que arrisca no cenário ruim. |
| 💼 **PJ × CLT** | Líquido real dos dois lados com as tabelas de 2026 (INSS, IRRF com isenção até R$ 5 mil, Simples Nacional com Fator R), benefícios, férias, FGTS — e o custo do deslocamento por modalidade (presencial/híbrido/remoto). |
| 💻 **Upgrade de computador** | Um computador mais rápido se paga? Payback, VPL e quanto custa cada mês de espera. |

## Dados

- **Ao vivo**: Selic, CDI, IPCA, TR, poupança e taxas médias de crédito (imobiliário e veículos) via [API SGS do BCB](https://dadosabertos.bcb.gov.br/) ao abrir o app, com fallback embutido (ago/2026).
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
