import { lazy, Suspense } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { Briefcase, Car, Home as HomeIcon, Hourglass, KeyRound, Landmark, Laptop, Moon, Scale, Sun, TrendingUp } from 'lucide-react'
import { useTheme } from './theme'
import Home from './pages/Home'

const Carro = lazy(() => import('./pages/Carro'))
const Imovel = lazy(() => import('./pages/Imovel'))
const Morar = lazy(() => import('./pages/Morar'))
const Investimentos = lazy(() => import('./pages/Investimentos'))
const Risco = lazy(() => import('./pages/Risco'))
const PjClt = lazy(() => import('./pages/PjClt'))
const Computador = lazy(() => import('./pages/Computador'))
const Tempo = lazy(() => import('./pages/Tempo'))

export const TOOLS = [
  {
    path: '/carro',
    label: 'Carro',
    title: 'Carro: alugar × comprar',
    desc: 'Assinatura, aluguel ou compra — com depreciação real, custo de oportunidade e manutenção.',
    icon: Car,
  },
  {
    path: '/imovel',
    label: 'Imóvel',
    title: 'Financiamento imobiliário',
    desc: 'SAC × Price com taxas atuais dos bancos, seguros, custos de cartório e renda mínima.',
    icon: HomeIcon,
  },
  {
    path: '/morar',
    label: 'Morar',
    title: 'Morar: alugar × comprar',
    desc: 'Aluguel ou compra do imóvel? Com valorização média, ITBI, corretagem, manutenção e custo de oportunidade.',
    icon: KeyRound,
  },
  {
    path: '/investimentos',
    label: 'Investir',
    title: 'Renda fixa na prática',
    desc: 'CDB, LCI/LCA, LC, Tesouro e fundos — líquido de IR, taxas e come-cotas, lado a lado.',
    icon: Landmark,
  },
  {
    path: '/risco',
    label: 'Risco',
    title: 'Risco × retorno',
    desc: 'Da poupança às ações: cenários e simulação de milhares de futuros possíveis.',
    icon: TrendingUp,
  },
  {
    path: '/pj-clt',
    label: 'PJ × CLT',
    title: 'PJ × CLT',
    desc: 'Salário líquido real dos dois lados — benefícios, impostos 2026 e o custo do deslocamento.',
    icon: Briefcase,
  },
  {
    path: '/computador',
    label: 'Upgrade',
    title: 'Computador mais rápido',
    desc: 'Quanto tempo (e dinheiro) um computador mais rápido devolve — payback do upgrade.',
    icon: Laptop,
  },
  {
    path: '/tempo',
    label: 'Tempo',
    title: 'Custo de oportunidade do seu tempo',
    desc: 'Quanto vale sua hora — e quando vale mais investir em você, terceirizar tarefas ou proteger tempo de qualidade.',
    icon: Hourglass,
  },
] as const

function TopBar() {
  const { theme, toggle } = useTheme()
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-page/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2.5">
        <NavLink to="/" className="mr-2 flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-ink">
            <Scale size={17} strokeWidth={2.4} />
          </span>
          <span className="font-display text-[17px] font-bold text-ink">
            vale a pena<span className="text-accent">?</span>
          </span>
        </NavLink>
        <nav className="scrollbar-none -mx-1 flex flex-1 items-center gap-0.5 overflow-x-auto px-1">
          {TOOLS.map(t => (
            <NavLink
              key={t.path}
              to={t.path}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  isActive ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                }`
              }
            >
              <t.icon size={14} />
              <span className="hidden sm:inline">{t.label}</span>
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          onClick={toggle}
          title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  )
}

function Footer() {
  const { theme } = useTheme()
  return (
    <footer className="border-t border-line py-6">
      <div className="mx-auto max-w-6xl px-4 text-center text-[11px] leading-relaxed text-mute">
        <div className="mb-3 flex flex-col items-center gap-1.5">
          <img
            src={theme === 'dark' ? '/brand/logo-offwhite.svg' : '/brand/logo-cor.svg'}
            alt="Dexterity"
            className="h-6"
          />
          <p>uma ferramenta Dexterity · vale a pena?</p>
        </div>
        <p>
          Dados de mercado: Banco Central do Brasil (SGS e Olinda), atualizados ao abrir o app. Regras
          tributárias e de crédito vigentes em 2026.
        </p>
        <p className="mt-1">
          Ferramenta educacional de comparação — não é recomendação de investimento ou de crédito.
        </p>
      </div>
    </footer>
  )
}

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="flex-1">
        <Suspense
          fallback={<div className="py-24 text-center text-sm text-mute">Carregando calculadora…</div>}
        >
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/carro" element={<Carro />} />
            <Route path="/imovel" element={<Imovel />} />
            <Route path="/morar" element={<Morar />} />
            <Route path="/investimentos" element={<Investimentos />} />
            <Route path="/risco" element={<Risco />} />
            <Route path="/pj-clt" element={<PjClt />} />
            <Route path="/computador" element={<Computador />} />
            <Route path="/tempo" element={<Tempo />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </div>
  )
}
