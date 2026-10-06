'use client'

import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, ScanLine, Sparkles } from 'lucide-react'
import { ThemeToggle } from './theme-toggle'
import { useGsapReveal } from '@/lib/gsap-helpers'

export function OnboardingScreen() {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)

  useGsapReveal(rootRef, [])

  const handleComplete = () => {
    router.push('/landing')
  }

  return (
    <div ref={rootRef} className="min-h-screen bg-gradient-to-b from-primary/10 via-base-100 to-base-100">
      <div className="relative min-h-screen">
        {/* Animated Aura */}
        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[300px] h-[300px] bg-primary/15 rounded-full blur-[80px] animate-pulse" />

        <div className="relative z-10 container mx-auto px-8 py-6">
          <div data-gsap="hero" className="flex justify-end mb-4">
            <ThemeToggle />
          </div>

          <div className="max-w-2xl mx-auto">
            {/* Hero Card */}
            <div data-gsap="card" className="flex justify-center mb-12">
              <div className="relative">
                {/* Tilted Cards */}
                <div className="absolute inset-0 w-[280px] h-[280px] border border-base-content/5 rounded-3xl bg-base-content/5 rotate-[3deg]" />
                <div className="absolute inset-0 w-[280px] h-[280px] border border-base-content/5 rounded-3xl bg-base-content/5 -rotate-[3deg]" />

                {/* Main Card */}
                <div className="card relative w-[280px] h-[280px] bg-base-200 shadow-2xl border border-base-300">
                  <div className="card-body items-center justify-center">
                    <div className="absolute inset-0 opacity-10">
                      <div className="grid grid-cols-6 gap-1 h-full">
                        {Array.from({ length: 36 }).map((_, i) => (
                          <div key={i} className="border border-base-content" />
                        ))}
                      </div>
                    </div>
                    <ScanLine className="w-20 h-20 text-primary/90 mb-4" />
                    <progress className="progress progress-primary w-40 mb-3" value="60" max="100"></progress>
                    <p className="text-xs text-primary/70 font-mono">Processing Invoice...</p>
                    <div className="badge badge-success badge-sm absolute top-4 right-4 gap-1">
                      Date Found
                    </div>
                    <div className="badge badge-info badge-sm absolute bottom-6 left-6 gap-1">
                      AI Analysis
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Badge */}
            <div data-gsap="hero" className="flex justify-center mb-6">
              <div className="badge badge-primary badge-outline gap-1.5 py-3 px-4">
                <Sparkles className="w-3 h-3" />
                <span className="text-[10px] font-semibold tracking-wider">AI-POWERED PROTECTION</span>
              </div>
            </div>

            {/* Title */}
            <h1 data-gsap="hero" className="text-4xl md:text-5xl font-semibold text-base-content mb-6 text-center">
              Never lose a{' '}
              <span className="text-primary">
                warranty claim
              </span>{' '}
              again.
            </h1>

            {/* Description */}
            <p data-gsap="hero" className="text-base-content/60 text-center mb-8 leading-relaxed">
              SafeBill organizes your messy bills. Our AI extracts warranty terms, reminds you of expiry, and helps fight denied claims.
            </p>

            {/* Steps */}
            <ul data-gsap="panel" className="steps steps-vertical lg:steps-horizontal w-full mb-8">
              <li className="step step-primary">
                <span className="text-sm">Auto-scan bills & warranties</span>
              </li>
              <li className="step step-primary">
                <span className="text-sm">Get alerted before expiry</span>
              </li>
              <li className="step step-primary">
                <span className="text-sm">Legal guidance for rejected claims</span>
              </li>
            </ul>

            {/* CTA Button */}
            <button
              onClick={handleComplete}
              data-gsap-hover="lift"
              className="btn btn-primary btn-lg w-full gap-2 shadow-lg"
            >
              Start Scanning Free
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
