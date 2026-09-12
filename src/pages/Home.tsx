import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { TOOLS } from '../App'
import { useRates } from '../lib/rates'
import { LiveBadge } from '../components/ui'
import { pct } from '../lib/format'

function RateChip({ label, value, suffix = '% a.a.' }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="flex items-baseline gap-2 rounded-xl border border-line bg-surface px-4 py-3">
      <span className="text-[11px] font-medium text-mute">{label}</span>
      <span className="text-sm font-bold tnum text-ink">
        {value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        <span className="ml-0.5 text-[10px] font-medium text-mute">{suffix}</span>
      </span>
    </div>
  )
}

export default function Home() {
  const rates = useRates()
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      {/* Hero */}
      <section className="animate-fadeup pt-14 pb-10 text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight text-ink sm:text-5xl">
          Vale a pena<span className="text-accent">?</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-ink-2">
          Alugar ou comprar? PJ ou CLT? Parcelar ou pagar à vista? Das decisões grandes às do dia a
          dia, toda escolha de dinheiro tem duas pontas — aqui você compara as duas com{' '}
          <strong className="text-ink">números de verdade</strong>: taxas ao vivo do Banco Central,
          impostos de 2026 e custo de oportunidade.
        </p>
        <div className="mt-5 flex justify-center">
          <LiveBadge live={rates.aoVivo} referencia={rates.referencia} />
        </div>
      </section>

      {/* Taxas ao vivo */}
      <section className="animate-fadeup-1 mb-10 flex flex-wrap justify-center gap-2">
        <RateChip label="Selic" value={rates.selic} />
        <RateChip label="CDI" value={rates.cdi} />
        <RateChip label="IPCA 12m" value={rates.ipca12m} suffix="%" />
        <RateChip label="Poupança" value={rates.poupancaMes} suffix="% a.m." />
        <RateChip label="Crédito imobiliário" value={rates.imobTotal} />
        <RateChip label="Financiamento de veículo" value={rates.veiculos} />
      </section>

      {/* Ferramentas */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map((t, i) => (
          <Link
            key={t.path}
            to={t.path}
            className={`group themed animate-fadeup-${Math.min(3, i % 3)} flex flex-col rounded-2xl border border-line bg-surface p-5 transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-lg`}
          >
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <t.icon size={20} />
            </div>
            <h2 className="text-[15px] font-bold text-ink">{t.title}</h2>
            <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-mute">{t.desc}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-accent">
              Comparar agora
              <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </section>

      {/* Como funciona */}
      <section className="animate-fadeup-3 mt-12 grid gap-4 rounded-2xl border border-line bg-surface p-6 sm:grid-cols-3">
        {[
          {
            t: 'Taxas ao vivo',
            d: `Selic, CDI, TR e as taxas médias de crédito vêm direto da API do Banco Central ao abrir o app — hoje o CDI está em ${pct(rates.cdi, 2)} a.a.`,
          },
          {
            t: 'Regras de 2026',
            d: 'Tabelas de INSS e IRRF (incluindo a isenção até R$ 5 mil), Simples Nacional, FGC, IR regressivo e as regras do novo crédito imobiliário.',
          },
          {
            t: 'Custo de oportunidade',
            d: 'Toda comparação considera o que o seu dinheiro renderia investido — porque parado ele nunca está. Vale para a compra da casa e para o desconto à vista do IPVA.',
          },
        ].map(x => (
          <div key={x.t}>
            <h3 className="text-sm font-bold text-ink">{x.t}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-mute">{x.d}</p>
          </div>
        ))}
      </section>
    </div>
  )
}
