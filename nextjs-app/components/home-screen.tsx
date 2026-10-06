'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { gsap } from 'gsap'
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin'
import { ScrollSmoother } from 'gsap/ScrollSmoother'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  BellRing,
  FileCheck2,
  ScanLine,
  Store,
} from 'lucide-react'
import { useGsapReveal } from '@/lib/gsap-helpers'
import { AnimatedSpan, Terminal, TypingAnimation } from '@/components/ui/terminal'
import { ShimmerButton } from '@/components/ui/shimmer-button'
import { Particles } from '@/components/ui/particles'
import { SpinningText } from '@/registry/magicui/spinning-text'
import { Marquee } from '@/registry/magicui/marquee'
import { cn } from '@/lib/utils'

const SAFEBILL_CHUNK_A = `M0.00,0.00 L120.00,0.00 L120.00,30.00 L0.00,30.00 Z M0.00,30.00 L30.00,30.00 L30.00,100.00 L0.00,100.00 Z M0.00,85.00 L120.00,85.00 L120.00,115.00 L0.00,115.00 Z M90.00,100.00 L120.00,100.00 L120.00,170.00 L90.00,170.00 Z M0.00,170.00 L120.00,170.00 L120.00,200.00 L0.00,200.00 Z M146.00,0.00 L266.00,0.00 L266.00,30.00 L146.00,30.00 Z M146.00,30.00 L176.00,30.00 L176.00,200.00 L146.00,200.00 Z M236.00,30.00 L266.00,30.00 L266.00,200.00 L236.00,200.00 Z M146.00,95.00 L266.00,95.00 L266.00,125.00 L146.00,125.00 Z M292.00,0.00 L412.00,0.00 L412.00,30.00 L292.00,30.00 Z M292.00,30.00 L322.00,30.00 L322.00,200.00 L292.00,200.00 Z M292.00,95.00 L392.00,95.00 L392.00,125.00 L292.00,125.00 Z`
const SAFEBILL_CHUNK_B = `M438.00,0.00 L558.00,0.00 L558.00,30.00 L438.00,30.00 Z M438.00,30.00 L468.00,30.00 L468.00,200.00 L438.00,200.00 Z M438.00,85.00 L548.00,85.00 L548.00,115.00 L438.00,115.00 Z M438.00,170.00 L558.00,170.00 L558.00,200.00 L438.00,200.00 Z M584.00,0.00 L694.00,0.00 L694.00,30.00 L584.00,30.00 Z M584.00,30.00 L614.00,30.00 L614.00,200.00 L584.00,200.00 Z M584.00,85.00 L694.00,85.00 L694.00,115.00 L584.00,115.00 Z M584.00,170.00 L694.00,170.00 L694.00,200.00 L584.00,200.00 Z M664.00,30.00 L694.00,30.00 L694.00,85.00 L664.00,85.00 Z M664.00,115.00 L694.00,115.00 L694.00,170.00 L664.00,170.00 Z M730.00,0.00 L850.00,0.00 L850.00,30.00 L730.00,30.00 Z M775.00,30.00 L805.00,30.00 L805.00,170.00 L775.00,170.00 Z M730.00,170.00 L850.00,170.00 L850.00,200.00 L730.00,200.00 Z`
const SAFEBILL_CHUNK_C = `M876.00,0.00 L906.00,0.00 L906.00,200.00 L876.00,200.00 Z M876.00,170.00 L996.00,170.00 L996.00,200.00 L876.00,200.00 Z M1022.00,0.00 L1052.00,0.00 L1052.00,200.00 L1022.00,200.00 Z M1022.00,170.00 L1142.00,170.00 L1142.00,200.00 L1022.00,200.00 Z`
const pulseCenter = { x: 50.4, y: 33.2 }
const pulseRoutes = [
  { id: 'ec2', path: 'M 26.5 16.6 V 21.6 H 44.2 V 28.6 H 49.5', duration: 2.6, delay: 0.0 },
  { id: 'api', path: 'M 45.0 15.6 V 29.4 H 50.1', duration: 2.35, delay: 0.2 },
  { id: 'lambda', path: 'M 62.8 16.6 V 21.6 H 56.0 V 28.6 H 51.1', duration: 2.5, delay: 0.35 },
  { id: 's3-top', path: 'M 14.5 26.2 H 25.8 V 30.1 H 43.6 V 32.0 H 49.4', duration: 2.8, delay: 0.15 },
  { id: 'sage', path: 'M 83.8 26.2 H 74.0 V 30.1 H 57.0 V 32.0 H 51.5', duration: 2.7, delay: 0.5 },
  { id: 'rds', path: 'M 87.5 41.8 H 76.4 V 39.6 H 59.2 V 36.2 H 52.0', duration: 2.8, delay: 0.6 },
  { id: 'dynamo', path: 'M 67.3 53.2 V 46.7 H 61.8 V 40.8 H 53.1', duration: 2.7, delay: 0.85 },
  { id: 'bedrock', path: 'M 50.4 60.5 V 46.2 V 38.4 H 50.4', duration: 2.5, delay: 1.0 },
  { id: 's3-bottom', path: 'M 28.2 52.3 V 46.7 H 38.0 V 40.8 H 47.9 V 36.3 H 49.2', duration: 2.9, delay: 1.25 },
]
const projectHighlights = [
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
const footerMetrics = [
  { label: 'Accuracy Focus', value: '97%', body: 'Schema-first extraction' },
  { label: 'Deadline Alerts', value: '24x7', body: 'Consumer + merchant reminders' },
  { label: 'Claim Readiness', value: '100%', body: 'Packet + evidence checklist' },
  { label: 'Workflow Coverage', value: '360 deg', body: 'Scan to notification lifecycle' },
]
const footerFirstRow = footerMetrics.slice(0, footerMetrics.length / 2)
const footerSecondRow = footerMetrics.slice(footerMetrics.length / 2)
const workflowStories = [
  {
    id: 'processing',
    badge: 'Processing Phase',
    title: 'Process every invoice with full context',
    description:
      'SafeBill ingests invoice PDFs and images, extracts structured warranty details, and validates fields before records are saved.',
    visual: 'image',
    image: '/hero2.png',
    imageAlt: 'Processing phase where invoice data is fed into SafeBill',
    reverse: false,
  },
  {
    id: 'analysis',
    badge: 'Analysis Phase',
    title: 'Ship claim decisions faster with contextual analysis',
    description:
      'Verified bill data, expiry dates, and policy checks are combined into clear claim-readiness insights so teams can act with confidence.',
    visual: 'terminal',
    image: '/hero1.png',
    imageAlt: 'Analysis phase showing SafeBill data graph and claim signals',
    reverse: true,
  },
  {
    id: 'output',
    badge: 'Output Phase',
    title: 'Deliver instant answers for users and support teams',
    description:
      'SafeBill returns grounded responses from stored invoice evidence, timelines, and merchant records, reducing repeat queries and handoffs.',
    visual: 'image',
    image: '/hero3.png',
    imageAlt: 'Output phase where SafeBill provides conversational and actionable insights',
    reverse: false,
  },
]

function ProcessingTerminalDemo() {
  return (
    <Terminal className="h-full min-h-[21rem]">
      <TypingAnimation duration={24} className="font-semibold text-slate-100">
        {'> safebill --start invoice-processing-pipeline'}
      </TypingAnimation>

      <AnimatedSpan className="text-sky-300">
        {'[INFO] Bootstrapping SafeBill architecture in simulation mode.'}
      </AnimatedSpan>

      <AnimatedSpan className="text-emerald-400">
        {'[AWS] Amazon S3 -> stores invoice PDFs/images and backups.'}
      </AnimatedSpan>

      <AnimatedSpan className="text-emerald-400">
        {'[AWS] Amazon EC2 -> runs OCR workers and API services.'}
      </AnimatedSpan>

      <AnimatedSpan className="text-emerald-400">
        {'[AWS] AWS Lambda -> triggers extraction + validation events.'}
      </AnimatedSpan>

      <AnimatedSpan className="text-emerald-400">
        {'[AWS] DynamoDB + RDS -> persist structured records and claim state.'}
      </AnimatedSpan>

      <AnimatedSpan className="text-emerald-400">
        {'[AWS] SageMaker + Bedrock -> confidence scoring and support summaries.'}
      </AnimatedSpan>

      <AnimatedSpan className="text-cyan-300">
        {'[STEP 1] Upload invoice to S3 and start OCR extraction.'}
      </AnimatedSpan>

      <AnimatedSpan className="text-cyan-300">
        {'[STEP 2] Normalize invoice, tax, and warranty fields.'}
      </AnimatedSpan>

      <AnimatedSpan className="text-cyan-300">
        {'[STEP 3] Validate confidence, flag issues, and build claim packet.'}
      </AnimatedSpan>

      <TypingAnimation duration={22} className="text-fuchsia-300">
        {'> output: claim-ready record + reminders + merchant handoff'}
      </TypingAnimation>
    </Terminal>
  )
}

function ProcessingTerminalIdle() {
  return (
    <Terminal className="h-full min-h-[21rem]">
      <span className="block font-semibold text-slate-100">{'> safebill --start invoice-processing-pipeline'}</span>
      <span className="block text-amber-300">{'[WAIT] Hover on this console to start AWS processing simulation.'}</span>
      <span className="block text-slate-300">
        {'Simulation only. This animation does not process real customer invoices.'}
      </span>
    </Terminal>
  )
}

function FooterMetricCard({ label, value, body }: { label: string; value: string; body: string }) {
  return (
    <figure
      className={cn(
        'relative h-full w-[17rem] cursor-pointer overflow-hidden rounded-2xl border p-4 md:w-[18.6rem] md:p-5',
        'border-[#a8c0de]/75 bg-[linear-gradient(145deg,rgba(232,245,255,0.9)_0%,rgba(202,223,246,0.62)_100%)] backdrop-blur-xl',
        'transition duration-300 hover:border-[#86a8d0] hover:bg-[linear-gradient(145deg,rgba(238,248,255,0.95)_0%,rgba(206,227,249,0.7)_100%)]'
      )}
    >
      <figcaption className="text-sm font-medium uppercase tracking-[0.16em] text-[#4f6f9b]">{label}</figcaption>
      <p className="mt-2 text-[2.9rem] font-semibold leading-none text-[#173a62]">{value}</p>
      <blockquote className="mt-2 text-[1.08rem] leading-snug text-[#3f628f]">{body}</blockquote>
    </figure>
  )
}

export function HomeScreen() {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)
  const titleSvgRef = useRef<SVGSVGElement>(null)
  const [isTerminalActive, setIsTerminalActive] = useState(false)
  const [terminalRunId, setTerminalRunId] = useState(0)

  useGsapReveal(rootRef, [])

  useEffect(() => {
    const scope = rootRef.current
    if (!scope) return
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    gsap.registerPlugin(ScrollTrigger, ScrollSmoother)
    ScrollSmoother.get()?.kill()

    const smoother = ScrollSmoother.create({
      wrapper: '#smooth-wrapper',
      content: '#smooth-content',
      smooth: 1.3,
      effects: true,
      normalizeScroll: true,
      smoothTouch: 0.1,
    })

    return () => {
      smoother.kill()
    }
  }, [])

  useEffect(() => {
    const svg = titleSvgRef.current
    if (!svg) return

    gsap.registerPlugin(MorphSVGPlugin)
    const primitives = Array.from(
      svg.querySelectorAll<SVGCircleElement | SVGRectElement | SVGPolygonElement>(
        'circle, rect, polygon'
      )
    )
    MorphSVGPlugin.convertToPath(primitives)

    const triangle = svg.querySelector<SVGPathElement>('#triangle')
    const square = svg.querySelector<SVGPathElement>('#square')
    const circle = svg.querySelector<SVGPathElement>('#circle')
    const targetA = svg.querySelector<SVGPathElement>('#a')
    const targetB = svg.querySelector<SVGPathElement>('#b')
    const targetC = svg.querySelector<SVGPathElement>('#c')
    if (!triangle || !square || !circle || !targetA || !targetB || !targetC) return

    const tl = gsap
      .timeline({
        paused: true,
        repeat: 0,
        yoyo: false,
        defaults: { ease: 'power2.inOut' },
      })
      .to(triangle, { duration: 0.85, morphSVG: targetA })
      .to(square, { duration: 0.85, morphSVG: targetB }, '<')
      .to(circle, { duration: 0.85, morphSVG: targetC }, '<')

    const handleEnter = () => {
      tl.play()
    }

    const handleLeave = () => {
      tl.reverse()
    }

    svg.addEventListener('mouseenter', handleEnter)
    svg.addEventListener('mouseleave', handleLeave)
    svg.addEventListener('focusin', handleEnter)
    svg.addEventListener('focusout', handleLeave)

    return () => {
      svg.removeEventListener('mouseenter', handleEnter)
      svg.removeEventListener('mouseleave', handleLeave)
      svg.removeEventListener('focusin', handleEnter)
      svg.removeEventListener('focusout', handleLeave)
      tl.kill()
    }
  }, [])

  return (
    <div id="smooth-wrapper" className="relative min-h-screen overflow-hidden">
      <div
        id="smooth-content"
        ref={rootRef}
        className="relative min-h-screen overflow-visible text-slate-900"
        style={{
          background: 'linear-gradient(180deg, #cfc9e2 0%, #c3d8ea 58%, #c2d9ec 100%)',
        }}
      >
      <Particles className="z-0 opacity-45" quantity={120} staticity={42} ease={55} size={0.9} color="#7f9ed7" vy={0.01} />
      <header data-gsap="hero" className="relative z-20" data-speed="0.96">
        <div className="relative mx-auto flex w-full max-w-7xl items-center justify-end px-6 py-1.5 md:px-10 md:py-2">
            <ShimmerButton
              onClick={() => router.push('/landing')}
              className="[font-size:clamp(14px,1.08vw,22px)]"
            >
              Login
            </ShimmerButton>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-col px-6 pb-20 pt-0 md:px-10 md:pt-2">
        <section className="relative mx-auto max-w-5xl text-center" data-speed="0.9">
          <div className="pointer-events-none absolute -left-16 top-2 z-20 md:-left-12 md:top-4">
            <SpinningText reverse className="text-[0.48rem] text-[#315789]" duration={7.2} radius={2.35}>
              FAST CLAIMS * SECURE VAULT * SMART REMINDERS *
            </SpinningText>
          </div>
          <h1 data-gsap="hero" className="mx-auto w-full max-w-5xl">
            <svg
              ref={titleSvgRef}
              viewBox="0 0 1142 210"
              className="h-auto w-full cursor-default overflow-visible"
              role="img"
              aria-label="SAFEBILL"
            >
              <defs>
                <linearGradient id="grad-1" x1="140" y1="210" x2="340" y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#9db2ff" />
                  <stop offset="1" stopColor="#4f46e5" />
                </linearGradient>
                <linearGradient id="grad-2" x1="420" y1="0" x2="710" y2="210" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#b8c7ff" />
                  <stop offset="1" stopColor="#5b5be7" />
                </linearGradient>
                <radialGradient id="grad-3" cx="990" cy="110" r="260" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#c6d6ff" />
                  <stop offset="0.45" stopColor="#6b7bff" />
                  <stop offset="1" stopColor="#4f46e5" />
                </radialGradient>
              </defs>

              <path id="triangle" d={SAFEBILL_CHUNK_A} fill="#0d1739" />
              <path id="square" d={SAFEBILL_CHUNK_B} fill="#0d1739" />
              <path id="circle" d={SAFEBILL_CHUNK_C} fill="#0d1739" />

              <g opacity="0">
                <polygon id="a" points="160,190 205,22 250,190" fill="url(#grad-1)" />
                <rect id="b" x="506" y="36" width="200" height="146" rx="22" ry="22" fill="url(#grad-2)" />
                <circle id="c" cx="1032" cy="110" r="84" fill="url(#grad-3)" />
              </g>
            </svg>
          </h1>
          <p
            data-gsap="hero"
            className="mx-auto mt-7 max-w-4xl text-[clamp(1.05rem,1.25vw,1.6rem)] leading-relaxed text-[#27406a]"
          >
            Unblock accurate scan-to-claim flows with structured OCR, clean records, reminders, and merchant-ready
            assignment tracking.
          </p>
        </section>

        <section className="mt-16 grid gap-6 xl:grid-cols-[1fr_1.24fr] xl:items-stretch" data-speed="1.05">
          <div className="grid gap-4 md:grid-cols-2">
            {projectHighlights.map((item) => (
              <article
                key={item.title}
                data-gsap="card"
                className="min-h-[15rem] rounded-[30px] border border-white/60 bg-[linear-gradient(140deg,rgba(238,247,255,0.8)_0%,rgba(204,223,244,0.45)_100%)] p-6 backdrop-blur-2xl shadow-[0_24px_46px_-32px_rgba(37,86,148,0.72)] transition-transform duration-300 hover:-translate-y-1"
              >
                <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/65 bg-white/50 text-[#3a6ba6] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                  <item.icon className="h-5 w-5" />
                </span>
                <h3 className="text-[clamp(1.1rem,1.25vw,1.5rem)] font-semibold text-[#173963]">{item.title}</h3>
                <p className="mt-2 text-[clamp(0.95rem,1.02vw,1.2rem)] leading-relaxed text-[#2a4f78]">
                  {item.description}
                </p>
              </article>
            ))}
          </div>

          <div
            data-gsap="panel"
            className="relative ml-auto w-full overflow-hidden rounded-[34px] border border-white/60 bg-white/30 shadow-[0_26px_60px_-30px_rgba(48,94,154,0.72)] xl:min-h-[31rem]"
          >
            <Image
              src="/hero1.png"
              alt="SafeBill architecture overview"
              width={960}
              height={600}
              className="block h-full w-full object-cover"
              sizes="(min-width: 1280px) 56vw, 100vw"
              priority
            />
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox="0 0 100 62.5"
              aria-hidden
            >
              <defs>
                <radialGradient id="pulse-impact" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
                </radialGradient>
              </defs>

              {pulseRoutes.map((route) => (
                <g key={route.id}>
                  <path d={route.path} fill="none" stroke="#6366f1" strokeOpacity="0.07" strokeWidth="0.22" />
                  <circle r="0.43" fill="#4f46e5">
                    <animateMotion
                      dur={`${route.duration}s`}
                      repeatCount="indefinite"
                      begin={`${route.delay}s`}
                      path={route.path}
                    />
                    <animate
                      attributeName="opacity"
                      values="0;1;1;0"
                      dur={`${route.duration}s`}
                      repeatCount="indefinite"
                      begin={`${route.delay}s`}
                    />
                  </circle>
                  <circle r="0.34" fill="#93c5fd">
                    <animateMotion
                      dur={`${route.duration + 0.45}s`}
                      repeatCount="indefinite"
                      begin={`${route.delay + 0.55}s`}
                      path={route.path}
                    />
                    <animate
                      attributeName="opacity"
                      values="0;0.95;0.95;0"
                      dur={`${route.duration + 0.45}s`}
                      repeatCount="indefinite"
                      begin={`${route.delay + 0.55}s`}
                    />
                  </circle>
                </g>
              ))}

              <circle cx={pulseCenter.x} cy={pulseCenter.y} r="1.8" fill="url(#pulse-impact)">
                <animate attributeName="r" values="1.6;3.1;1.6" dur="1.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.2;0.52;0.2" dur="1.8s" repeatCount="indefinite" />
              </circle>
            </svg>
          </div>
        </section>

        <section
          data-gsap="panel"
          data-speed="1.02"
          className="mt-14 rounded-[34px] border border-white/55 bg-[linear-gradient(135deg,rgba(236,246,255,0.72)_0%,rgba(202,223,245,0.3)_100%)] p-6 shadow-[0_22px_48px_-34px_rgba(44,90,149,0.55)] backdrop-blur-xl md:p-8"
        >
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#416da3] md:text-sm">How It Works</p>
            <h2 className="mt-2 text-[clamp(1.5rem,2.3vw,2.4rem)] font-semibold tracking-tight text-[#14345f]">
              From invoice ingestion to support-ready output
            </h2>
            <p className="mt-3 text-[clamp(0.95rem,1.05vw,1.18rem)] leading-relaxed text-[#2d527b]">
              A phased flow keeps your bill data clean, actionable, and easy to use across claims and customer support.
            </p>
          </div>

          <div className="mt-10 space-y-12 md:space-y-16">
            {workflowStories.map((phase) => (
              <article
                key={phase.id}
                data-gsap="card"
                className={`grid items-center gap-6 rounded-[28px] border border-white/60 bg-white/36 p-5 shadow-[0_16px_36px_-28px_rgba(35,84,142,0.62)] backdrop-blur-xl lg:grid-cols-[1fr_1fr] lg:p-6 ${phase.reverse ? 'lg:[&>*:first-child]:order-2 lg:[&>*:last-child]:order-1' : ''}`}
              >
                {phase.visual === 'terminal' ? (
                  <div
                    className="overflow-hidden rounded-2xl bg-[#02050d] p-0 shadow-[0_20px_42px_-26px_rgba(6,12,28,0.95)]"
                    onMouseEnter={() => {
                      setTerminalRunId((prev) => prev + 1)
                      setIsTerminalActive(true)
                    }}
                    onMouseLeave={() => {
                      setIsTerminalActive(false)
                    }}
                    onFocus={() => {
                      setTerminalRunId((prev) => prev + 1)
                      setIsTerminalActive(true)
                    }}
                    onBlur={() => {
                      setIsTerminalActive(false)
                    }}
                    tabIndex={0}
                    role="region"
                    aria-label="SafeBill processing terminal"
                  >
                    {isTerminalActive ? <ProcessingTerminalDemo key={terminalRunId} /> : <ProcessingTerminalIdle />}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-white/70 bg-white/40 shadow-[0_20px_38px_-26px_rgba(44,88,145,0.64)]">
                    <Image
                      src={phase.image}
                      alt={phase.imageAlt}
                      width={1536}
                      height={1024}
                      className="h-auto w-full object-cover"
                    />
                  </div>
                )}
                <div className="max-w-xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#4d72a1]">{phase.badge}</p>
                  <h3 className="mt-2 text-[clamp(1.22rem,1.5vw,2.2rem)] font-semibold leading-tight text-[#172a52]">
                    {phase.title}
                  </h3>
                  <p className="mt-2 text-[clamp(0.92rem,0.98vw,1.08rem)] leading-relaxed text-[#2f557d]">
                    {phase.description}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <footer
          data-gsap="panel"
          className="relative mt-14 overflow-hidden rounded-[34px] border border-white/60 bg-[linear-gradient(165deg,rgba(227,242,255,0.86)_0%,rgba(191,215,239,0.62)_100%)] p-5 shadow-[0_26px_62px_-34px_rgba(46,90,142,0.52)] backdrop-blur-xl md:p-7"
        >
          <div className="mb-5 flex items-center justify-between gap-4">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#446a9b]">Live Signals</p>
            <p className="text-sm text-[#5178aa]">Hover cards to pause</p>
          </div>
          <Marquee pauseOnHover className="[--duration:26s] [--gap:1rem]">
            {footerFirstRow.map((item) => (
              <FooterMetricCard key={item.label} {...item} />
            ))}
          </Marquee>
          <Marquee reverse pauseOnHover className="mt-4 [--duration:29s] [--gap:1rem]">
            {footerSecondRow.map((item) => (
              <FooterMetricCard key={item.label} {...item} />
            ))}
          </Marquee>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#c2d9ee] to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-[#c2d9ee] to-transparent" />
        </footer>

      </main>
      </div>
    </div>
  )
}

