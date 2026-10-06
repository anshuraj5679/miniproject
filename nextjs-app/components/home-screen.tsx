'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  ArrowRight,
  BellRing,
  FileCheck2,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Store,
  Workflow,
} from 'lucide-react'
import { useGsapCountUp, useGsapReveal } from '@/lib/gsap-helpers'

const highlights = [
  {
    title: 'Structured OCR',
    description: 'Accurate field extraction for invoice number, amount, dates, GST details, and warranty period.',
    icon: ScanLine,
  },
  {
    title: 'Deadline Intelligence',
    description: 'Live warranty timeline with clear urgency bands so users know what needs attention next.',
    icon: BellRing,
  },
  {
    title: 'Claim Readiness',
    description: 'Actionable guidance with compliance checks and claim packet generation from verified bill data.',
    icon: FileCheck2,
  },
  {
    title: 'Merchant Assignment',
    description: 'Direct merchant-to-consumer warranty assignment with activity tracking and audit-friendly flow.',
    icon: Store,
  },
]

const steps = [
  {
    title: 'Scan Invoice',
    description: 'Upload bill image/PDF and run OCR + extraction with confidence tracking.',
  },
  {
    title: 'Verify Details',
    description: 'Review low-confidence fields, then save clean, structured warranty records.',
  },
  {
    title: 'Stay Protected',
    description: 'Track deadlines, receive reminders, and trigger claim workflows on time.',
  },
]

const HERO_TEXT = 'Built for real invoices, real deadlines, and real claims.'

function useTypewriterText(text: string, speedMs = 42) {
  const [displayText, setDisplayText] = useState('')

  useEffect(() => {
    let index = 0
    const timer = window.setInterval(() => {
      index += 1
      setDisplayText(text.slice(0, index))
      if (index >= text.length) {
        window.clearInterval(timer)
      }
    }, speedMs)

    return () => window.clearInterval(timer)
  }, [text, speedMs])

  return displayText
}

export function HomeScreen() {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)
  const typedHeading = useTypewriterText(HERO_TEXT)

  useGsapReveal(rootRef, [])
  useGsapCountUp(rootRef, [])

  return (
    <div ref={rootRef} className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <Image
          src="/safebill-locker-bg.png"
          alt=""
          fill
          priority
          className="object-cover opacity-25"
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(99,102,241,0.22),rgba(2,6,23,0.88)_45%,rgba(2,6,23,1)_100%)]" />
        <div className="noise-overlay absolute inset-0 opacity-30" />
      </div>

      <header data-gsap="hero" className="relative z-20 bg-slate-950/40 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 md:px-8">
          <button onClick={() => router.push('/')} className="inline-flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-200">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-lg font-semibold tracking-tight">SafeBill</span>
              <span className="block text-xs text-slate-400">AI Warranty Vault</span>
            </span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/landing')}
              data-gsap-hover="lift"
              className="btn btn-sm border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10"
            >
              Login
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 pb-16 pt-10 md:px-8 md:pt-14">
        <section className="grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div data-gsap="hero">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-300/30 bg-indigo-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-indigo-100">
              <Sparkles className="h-3.5 w-3.5" />
              Production-ready warranty intelligence
            </div>
            <h1 className="text-4xl font-semibold tracking-tight text-white md:text-6xl">
              <span>{typedHeading}</span>
              <span className="ml-1 inline-block h-[1em] w-[0.55ch] animate-pulse bg-indigo-300/80 align-[-0.08em]" />
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-300 md:text-base">
              SafeBill helps consumers and merchants manage warranties with OCR accuracy, structured extraction,
              reminders, and traceable claim workflows.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={() => router.push('/landing')}
                data-gsap-hover="lift"
                className="glow-button inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white"
              >
                Open Dashboard
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => router.push('/scan-demo')}
                data-gsap-hover="lift"
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-semibold text-slate-100 hover:bg-white/10"
              >
                Try Scan Flow
              </button>
            </div>
          </div>

          <div data-gsap="panel" className="grid gap-4 sm:grid-cols-2">
            <StatCard title="Accuracy Focus" value="97" suffix="%" hint="Schema-first extraction" />
            <StatCard title="Deadline Alerts" value="24" suffix="x7" hint="Consumer + merchant reminders" />
            <StatCard title="Claim Readiness" value="100" suffix="%" hint="Packet + evidence checklist" />
            <StatCard title="Workflow Coverage" value="360" suffix=" deg" hint="Scan to notification lifecycle" />
          </div>
        </section>

        <section data-gsap="card" className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl md:p-8">
          <div className="mb-5 flex items-center gap-2 text-lg font-semibold">
            <Workflow className="h-5 w-5 text-indigo-300" />
            Core Capabilities
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {highlights.map((item) => (
              <article
                key={item.title}
                data-gsap="card"
                data-gsap-hover="lift"
                className="rounded-2xl border border-white/10 bg-slate-900/50 p-4"
              >
                <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-200">
                  <item.icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-white">{item.title}</h3>
                <p className="mt-1 text-sm text-slate-300">{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section data-gsap="panel" className="rounded-3xl border border-white/10 bg-slate-900/45 p-5 backdrop-blur-xl md:p-8">
          <h2 className="text-2xl font-semibold tracking-tight text-white">How It Works</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {steps.map((step, index) => (
              <div key={step.title} data-gsap="list-item" className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-200">Step {index + 1}</p>
                <p className="mt-2 text-base font-semibold text-white">{step.title}</p>
                <p className="mt-1 text-sm text-slate-300">{step.description}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

function StatCard({
  title,
  value,
  suffix,
  hint,
}: {
  title: string
  value: string
  suffix: string
  hint: string
}) {
  return (
    <div data-gsap="card" data-gsap-hover="lift" className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
      <p className="text-xs uppercase tracking-[0.14em] text-slate-400">{title}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-white">
        <span data-count-to={Number(value)}>{value}</span>
        {suffix}
      </p>
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    </div>
  )
}

