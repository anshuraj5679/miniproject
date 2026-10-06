'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowUp,
  Bell,
  BookOpen,
  Calendar,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  FileText,
  Lock,
  LogIn,
  Mail,
  MapPin,
  Menu,
  Phone,
  Quote,
  Shield,
  Smartphone,
  Sparkles,
  Star,
  Twitter,
  Users,
  X,
  Facebook,
  Instagram,
  Youtube,
} from 'lucide-react'
import Image from 'next/image'
import { ThemeToggle } from './theme-toggle'
import { persistClientAuthCookies, signInWithIdentifier } from '@/lib/auth-client'
import { useAuthStore } from '@/lib/store/auth-store'
import { useGsapReveal } from '@/lib/gsap-helpers'
import { AwsBeamSection } from './aws-beam-section'
import type { UserType } from '@/lib/types'

const appArticles = [
  {
    id: 1,
    image: '/images/how-it-works-1.jpg',
    title: 'How to Organize Bills for Tax Season',
    excerpt: 'Learn the best practices for organizing your GST invoices and receipts to make tax filing smoother and stress-free.',
    date: 'March 2025',
    category: 'Finance',
  },
  {
    id: 2,
    image: '/images/feature-family.jpg',
    title: 'Teaching Your Family About Warranty Coverage',
    excerpt: "Simple ways to help everyone in your household understand what's covered and how to file claims when needed.",
    date: 'February 2025',
    category: 'Family',
  },
  {
    id: 3,
    image: '/images/feature-merchant.jpg',
    title: 'Small Business Guide to Digital Invoicing',
    excerpt: 'Why going digital with your bills and warranties can save time, money, and headaches for Indian business owners.',
    date: 'January 2025',
    category: 'Business',
  },
]

const appTestimonials = [
  {
    name: 'Priya Patel',
    role: 'Homemaker, Ahmedabad',
    text: 'I used to spend hours searching for warranty cards. Now with SafeBill, everything is at my fingertips. The reminders have saved me from missing claim deadlines multiple times!',
  },
  {
    name: 'Rajesh Kumar',
    role: 'Electronics Shop Owner, Delhi',
    text: 'As a small business owner, managing GST invoices was a nightmare. SafeBill has made it so much easier. My customers love the digital warranty cards too.',
  },
  {
    name: 'Lakshmi Iyer',
    role: 'Retired Teacher, Chennai',
    text: "I was worried about using technology at my age, but SafeBill is so simple. My son helped me set it up, and now I can find any bill myself. It's wonderful!",
  },
]

const appStoryTimeline = [
  { value: '10L+', label: 'Documents Secured' },
  { value: '50K+', label: 'Happy Families' },
  { value: '28', label: 'States Covered' },
  { value: '4.9+', label: 'User Rating' },
]

const appFeatureCards = [
  {
    id: 'scan',
    title: 'Easy Scan',
    subtitle: 'Snap & Store Instantly',
    year: '2024',
    image: '/images/feature-scan-indian.jpg',
    description:
      'Simply take a photo of any bill, invoice, or warranty card. Smart scanning detects edges and enhances clarity automatically.',
    tastingNotes: 'Works with all phones - no special app needed',
    alcohol: 'Auto-enhance',
    temperature: 'Under 3 seconds',
    aging: 'Instant save',
  },
  {
    id: 'extract',
    title: 'Smart Extraction',
    subtitle: 'AI Reads Your Documents',
    year: '2024',
    image: '/images/how-it-works-2.jpg',
    description:
      'AI extracts warranty dates, product names, merchant information, and GST details so everything is organized.',
    tastingNotes: 'Extracts: Dates, amounts, GSTIN, product details',
    alcohol: 'AI Powered',
    temperature: '99% Accuracy',
    aging: 'Verified',
  },
  {
    id: 'family',
    title: 'Family Sharing',
    subtitle: 'Everyone Stays Informed',
    year: '2024',
    image: '/images/feature-family.jpg',
    description:
      "Share warranty documents with family members so everyone knows what's covered and can act quickly.",
    tastingNotes: 'Share with up to 5 family members',
    alcohol: 'Secure',
    temperature: 'Controlled access',
    aging: 'Always synced',
  },
  {
    id: 'reminders',
    title: 'Timely Alerts',
    subtitle: 'Never Miss a Deadline',
    year: '2024',
    image: '/images/how-it-works-3.jpg',
    description:
      'Get reminders before warranties expire, service due dates approach, or return windows close.',
    tastingNotes: 'SMS, WhatsApp, Email, In-app alerts',
    alcohol: 'Multi-channel',
    temperature: 'Customizable',
    aging: 'Scheduled',
  },
]

const appFeatureHighlights = [
  {
    title: 'Simple Phone Scan',
    description: 'Use any smartphone camera to scan bills and warranties. No expensive equipment required.',
    icon: Smartphone,
  },
  {
    title: 'GST Bill Support',
    description: 'Automatically recognizes and validates GST invoices for families and small businesses.',
    icon: FileText,
  },
  {
    title: 'Family Access',
    description: 'Share important documents with family members so everyone stays informed.',
    icon: Users,
  },
  {
    title: 'Expiry Reminders',
    description: 'Get timely alerts before warranties expire so you never miss a claim.',
    icon: Bell,
  },
]

const appSimpleSteps = [
  {
    image: '/images/feature-scan-indian.jpg',
    title: 'Snap a Photo',
    subtitle: 'Step 1: Quick Scan',
    area: '3',
    unit: 'seconds',
    description: 'Take a clear photo of any bill, invoice, or warranty card using your phone camera.',
  },
  {
    image: '/images/how-it-works-2.jpg',
    title: 'AI Does the Work',
    subtitle: 'Step 2: Automatic Extraction',
    area: '99',
    unit: '% accurate',
    description: 'Our intelligent system extracts warranty dates, product names, merchant info, and GST details.',
  },
  {
    image: '/images/how-it-works-3.jpg',
    title: 'Stay Protected',
    subtitle: 'Step 3: Smart Management',
    area: '24',
    unit: 'x7 access',
    description: 'Access documents anytime and get reminders before expiry and service due dates.',
  },
]

const appSecurityTabs = [
  {
    id: 'security',
    name: 'Data Security',
    icon: Shield,
    image: '/images/feature-seniors.jpg',
    content: {
      title: 'Bank-Level Protection',
      description: 'AES-256 encryption with India-hosted storage and strong protection controls.',
      highlight: 'ISO 27001 Certified',
    },
  },
  {
    id: 'compliance',
    name: 'GST Ready',
    icon: CheckCircle,
    image: '/images/feature-merchant.jpg',
    content: {
      title: 'Built for Indian Business',
      description: 'GSTIN validation, e-invoice detection, and tax-focused organization for business workflows.',
      highlight: 'GST Portal Integrated',
    },
  },
  {
    id: 'control',
    name: 'Your Control',
    icon: Lock,
    image: '/images/feature-family.jpg',
    content: {
      title: 'You Own Your Data',
      description: 'You own your data and can download or remove records whenever needed.',
      highlight: 'DPDP Act Compliant',
    },
  },
]

const appSecurityTimeline = [
  { year: '2023', event: 'SafeBill founded in Bangalore' },
  { year: '2024', event: 'Launched GST compliance features' },
  { year: '2024', event: 'Crossed 50,000 active families' },
  { year: '2025', event: 'Serving all 28 states of India' },
]

function useCountUp(target: number, duration = 2000, start = false) {
  const [count, setCount] = useState(0)
  const hasRun = useRef(false)

  useEffect(() => {
    if (!start || hasRun.current) return
    hasRun.current = true
    const startTime = performance.now()
    const step = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCount(Math.floor(eased * target))
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [start, target, duration])

  return count
}

export function LandingScreen() {
  const router = useRouter()
  const { setAuth } = useAuthStore()
  const rootRef = useRef<HTMLDivElement>(null)
  const [landingPhase, setLandingPhase] = useState<'loading' | 'fading'>('loading')
  const [isLandingLoading, setIsLandingLoading] = useState(true)
  const [heroPhase, setHeroPhase] = useState(0)
  const [activeFeature, setActiveFeature] = useState(0)
  const [currentStep, setCurrentStep] = useState(0)
  const [stepDirection, setStepDirection] = useState<'next' | 'prev'>('next')
  const [activeSecurityTab, setActiveSecurityTab] = useState(0)
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [userType, setUserType] = useState<UserType>('consumer')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newsletterEmail, setNewsletterEmail] = useState('')
  const [newsletterStatus, setNewsletterStatus] = useState<'idle' | 'success' | 'error'>('idle')

  useGsapReveal(rootRef, [userType, loading, error])

  useEffect(() => {
    const scope = rootRef.current
    if (!scope) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible')
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -10% 0px' }
    )

    const nodes = scope.querySelectorAll('.fade-up, .slide-in-left, .slide-in-right, .scale-in')
    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const fadeTimer = setTimeout(() => setLandingPhase('fading'), 2200)
    const completeTimer = setTimeout(() => setIsLandingLoading(false), 2800)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(completeTimer)
    }
  }, [])

  useEffect(() => {
    if (isLandingLoading) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isLandingLoading])

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 50)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else if (!isLandingLoading) {
      document.body.style.overflow = ''
    }
    return () => {
      if (!isLandingLoading) document.body.style.overflow = ''
    }
  }, [isMobileMenuOpen, isLandingLoading])

  const scrollToSection = (id: string) => {
    const target = document.getElementById(id)
    if (!target) return
    const headerOffset = 92
    const y = target.getBoundingClientRect().top + window.scrollY - headerOffset
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
    setIsMobileMenuOpen(false)
  }

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleNewsletter = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newsletterEmail.trim()) {
      setNewsletterStatus('error')
      setTimeout(() => setNewsletterStatus('idle'), 3000)
      return
    }
    setNewsletterStatus('success')
    setNewsletterEmail('')
    setTimeout(() => setNewsletterStatus('idle'), 3000)
  }

  useEffect(() => {
    if (isLandingLoading) return
    const t1 = setTimeout(() => setHeroPhase(1), 80)
    const t2 = setTimeout(() => setHeroPhase(2), 520)
    const t3 = setTimeout(() => setHeroPhase(3), 920)
    const t4 = setTimeout(() => setHeroPhase(4), 1300)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      clearTimeout(t4)
    }
  }, [isLandingLoading])

  const countDocs = useCountUp(10, 1800, heroPhase >= 4)
  const countAccuracy = useCountUp(99, 1800, heroPhase >= 4)
  const countFamilies = useCountUp(50000, 1800, heroPhase >= 4)
  const countStates = useCountUp(28, 1800, heroPhase >= 4)
  const selectedFeature = appFeatureCards[activeFeature]

  const nextFeature = () => setActiveFeature((prev) => (prev + 1) % appFeatureCards.length)
  const prevFeature = () => setActiveFeature((prev) => (prev - 1 + appFeatureCards.length) % appFeatureCards.length)
  const selectedStep = appSimpleSteps[currentStep]
  const selectedSecurity = appSecurityTabs[activeSecurityTab]

  const goToStep = (index: number, direction: 'next' | 'prev' = 'next') => {
    setStepDirection(direction)
    setCurrentStep(index)
  }

  const nextStep = () => goToStep((currentStep + 1) % appSimpleSteps.length, 'next')
  const prevStep = () => goToStep((currentStep - 1 + appSimpleSteps.length) % appSimpleSteps.length, 'prev')

  useEffect(() => {
    const timer = setInterval(() => {
      setStepDirection('next')
      setCurrentStep((prev) => (prev + 1) % appSimpleSteps.length)
    }, 6000)
    return () => clearInterval(timer)
  }, [])

  const handleLogin = async () => {
    if (!identifier.trim() || !password.trim()) {
      setError('Please enter your login ID and password.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await signInWithIdentifier({
        identifier,
        password,
        userType,
      })

      await setAuth(result.user, result.token)
      persistClientAuthCookies(result.token, result.userType)
      router.push(result.userType === 'merchant' ? '/merchant-dashboard' : '/locker')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div ref={rootRef} className="min-h-screen bg-[#fafafa]">
      {isLandingLoading && (
        <div
          className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-blue-900 transition-opacity duration-700 ${landingPhase === 'fading' ? 'opacity-0' : 'opacity-100'
            }`}
        >
          <div className="preloader-text mb-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-white">
              <Shield className="h-10 w-10 text-blue-600" />
            </div>
          </div>
          <div className="preloader-text text-center" style={{ animationDelay: '0.2s' }}>
            <h1 className="mb-2 text-3xl font-bold tracking-wide text-white md:text-4xl">SafeBill</h1>
          </div>
          <div className="mt-8 h-1 w-48 overflow-hidden rounded-full bg-white/20">
            <div className="preloader-line h-full rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400" />
          </div>
          <p
            className="preloader-text mt-4 text-sm font-medium uppercase tracking-[0.3em] text-white/60"
            style={{ animationDelay: '0.4s' }}
          >
            Made for India
          </p>
        </div>
      )}

      <div className="relative min-h-screen overflow-hidden">
        <div className="absolute inset-0">
          <Image src="/images/hero-indian.jpg" alt="SafeBill India hero" fill priority className="object-cover scale-105" />
          <div className="absolute inset-0 bg-gradient-to-r from-blue-900/80 via-blue-800/60 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-40 bg-gradient-to-t from-[#fafafa] to-transparent" />
        </div>

        <header
          className={`fixed left-0 right-0 top-0 z-50 transition-all duration-300 ${isScrolled ? 'bg-white/95 py-2 shadow-lg backdrop-blur-md' : 'bg-transparent py-4'
            }`}
        >
          <div className="container-custom flex items-center justify-between">
            <button
              onClick={() => router.push('/')}
              className="flex items-center gap-3 rounded-xl px-2 py-2 transition"
            >
              <span className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${isScrolled ? 'bg-blue-600' : 'bg-white/20'}`}>
                <Shield className="h-5 w-5" />
              </span>
              <span className="flex flex-col text-left">
                <span className={`text-xl font-bold tracking-wide ${isScrolled ? 'text-slate-900' : 'text-white'}`}>SafeBill</span>
                <span className={`text-[11px] uppercase tracking-[0.12em] ${isScrolled ? 'text-blue-600' : 'text-white/80'}`}>
                  Your Digital Warranty Locker
                </span>
              </span>
            </button>

            <div className="hidden items-center gap-8 lg:flex">
              <button
                onClick={() => scrollToSection('features')}
                className={`text-base font-medium transition-colors ${isScrolled ? 'text-slate-700 hover:text-blue-600' : 'text-white/90 hover:text-white'}`}
              >
                Features
              </button>
              <button
                onClick={() => scrollToSection('articles')}
                className={`text-base font-medium transition-colors ${isScrolled ? 'text-slate-700 hover:text-blue-600' : 'text-white/90 hover:text-white'}`}
              >
                Articles
              </button>
              <button
                onClick={() => scrollToSection('story')}
                className={`text-base font-medium transition-colors ${isScrolled ? 'text-slate-700 hover:text-blue-600' : 'text-white/90 hover:text-white'}`}
              >
                Story
              </button>
              <button
                onClick={() => scrollToSection('signin-form')}
                className={`text-base font-medium transition-colors ${isScrolled ? 'text-slate-700 hover:text-blue-600' : 'text-white/90 hover:text-white'}`}
              >
                Sign In
              </button>
            </div>

            <div className="hidden items-center gap-3 lg:flex">
              <button
                onClick={() => scrollToSection('signin-form')}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Sign in to SafeBill
              </button>
              <ThemeToggle />
            </div>

            <button
              className={`rounded-lg p-2 transition lg:hidden ${isScrolled ? 'text-slate-700 hover:bg-slate-100' : 'text-white hover:bg-white/10'}`}
              onClick={() => setIsMobileMenuOpen((prev) => !prev)}
              aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={isMobileMenuOpen}
            >
              {isMobileMenuOpen ? <X className="h-7 w-7" /> : <Menu className="h-7 w-7" />}
            </button>
          </div>

          <div
            className={`fixed inset-0 top-[84px] bg-white transition-all duration-300 lg:hidden ${isMobileMenuOpen ? 'visible opacity-100' : 'invisible pointer-events-none opacity-0'
              }`}
          >
            <div className="container-custom flex flex-col gap-1 py-6">
              <button onClick={() => scrollToSection('features')} className="rounded-lg px-2 py-3 text-left text-lg font-medium text-slate-800 hover:bg-slate-100">
                Features
              </button>
              <button onClick={() => scrollToSection('articles')} className="rounded-lg px-2 py-3 text-left text-lg font-medium text-slate-800 hover:bg-slate-100">
                Articles
              </button>
              <button onClick={() => scrollToSection('story')} className="rounded-lg px-2 py-3 text-left text-lg font-medium text-slate-800 hover:bg-slate-100">
                Story
              </button>
              <button onClick={() => scrollToSection('signin-form')} className="rounded-lg px-2 py-3 text-left text-lg font-medium text-slate-800 hover:bg-slate-100">
                Sign In
              </button>
            </div>
          </div>
        </header>

        <main id="features" className="container-custom relative z-10 py-28 lg:py-36">
          <section className="space-y-8 self-center">
            <div
              className={`transition-all duration-1000 ${heroPhase >= 2 ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
                }`}
            >
              <div
                className={`inline-flex rounded-full border border-white/30 bg-white/12 px-4 py-2 text-sm font-medium text-white transition-all duration-700 ${heroPhase >= 2 ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
                  }`}
              >
                India&apos;s Trusted Digital Warranty Locker
              </div>
            </div>
            <h1 className="mt-5 max-w-2xl text-5xl font-bold leading-tight text-white lg:text-6xl">
              Never Lose a Bill
              <br />
              or Warranty Again
            </h1>
            <div
              className={`my-8 h-1 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-1000 ${heroPhase >= 2 ? 'w-32 opacity-100' : 'w-0 opacity-0'
                }`}
            />
            <p className="max-w-xl text-lg leading-relaxed text-white/90">
              Securely store bills, invoices, and warranties in one place with GST-aware workflows for Indian
              families and businesses.
            </p>

            <div className={`transition-all duration-700 ${heroPhase >= 4 ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}>
              <p className="mb-2 text-sm font-semibold uppercase tracking-[0.15em] text-amber-400">Our Ambition</p>
              <h3 className="mb-5 text-2xl font-bold text-white">Our Ambition to Achieve</h3>
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-soft">
                  <p className="text-base font-semibold text-slate-700">To secure</p>
                  <p className="text-3xl font-bold text-blue-600">10Lakh+</p>
                  <p className="text-base font-semibold text-slate-700">Documents</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-soft">
                  <p className="text-base font-semibold text-slate-700">To achieve</p>
                  <p className="text-3xl font-bold text-blue-600">99%</p>
                  <p className="text-base font-semibold text-slate-700">Accuracy</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-soft">
                  <p className="text-base font-semibold text-slate-700">To make</p>
                  <p className="text-3xl font-bold text-blue-600">50000+</p>
                  <p className="text-base font-semibold text-slate-700">Happy Families</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-soft">
                  <p className="text-base font-semibold text-slate-700">To cover</p>
                  <p className="text-3xl font-bold text-blue-600">28</p>
                  <p className="text-base font-semibold text-slate-700">States</p>
                </div>
              </div>
            </div>

          </section>
        </main>
      </div>

      <section id="powerful-features" className="section-padding relative overflow-hidden bg-[#fafafa]">
        <div className="absolute inset-0 opacity-[0.03]">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: 'radial-gradient(circle at 2px 2px, #1d4ed8 1px, transparent 0)',
              backgroundSize: '40px 40px',
            }}
          />
        </div>
        <div className="container-custom relative">
          <div className="fade-up text-center">
            <span className="inline-block rounded-full bg-blue-100 px-4 py-2 text-base font-medium text-blue-700">
              Powerful Features
            </span>
            <p className="mt-4 text-sm font-semibold uppercase tracking-[0.15em] text-blue-600">
              BUILT FOR INDIAN FAMILIES & BUSINESSES
            </p>
            <h2 className="mt-2 text-3xl font-bold text-slate-900 lg:text-5xl">Everything You Need in One Place</h2>
          </div>

          <div className="fade-up mb-16 mt-10 flex flex-wrap justify-center gap-3" style={{ transitionDelay: '0.1s' }}>
            {appFeatureCards.map((feature, index) => (
              <button
                key={feature.id}
                onClick={() => setActiveFeature(index)}
                className={`rounded-xl px-6 py-3 text-base font-medium transition-all duration-300 ${index === activeFeature
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                    : 'border border-gray-200 bg-white text-gray-700 hover:bg-blue-50'
                  }`}
              >
                {feature.title}
              </button>
            ))}
          </div>

          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="slide-in-left order-2 lg:order-1">
              <div className="mb-8">
                <span className="mb-3 inline-block rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700">
                  {selectedFeature.year}
                </span>
                <h3 className="mb-2 text-3xl font-bold leading-tight text-gray-900 lg:text-4xl">{selectedFeature.title}</h3>
                <span className="text-xl font-medium text-blue-600">{selectedFeature.subtitle}</span>
                <div className="mt-4 h-1 w-20 rounded-full bg-gradient-to-r from-blue-500 to-amber-500" />
              </div>

              <p className="mb-4 text-lg leading-relaxed text-gray-700">{selectedFeature.description}</p>
              <p className="mb-8 text-base leading-relaxed text-gray-500">{selectedFeature.tastingNotes}</p>

              <div className="mb-8 flex flex-wrap gap-4">
                <div className="rounded-xl bg-blue-50 px-4 py-3">
                  <div className="text-lg font-bold text-blue-700">{selectedFeature.alcohol}</div>
                  <div className="text-sm text-blue-600">{selectedFeature.temperature}</div>
                </div>
                <div className="rounded-xl bg-amber-50 px-4 py-3">
                  <div className="text-lg font-bold text-amber-700">{selectedFeature.aging}</div>
                  <div className="text-sm text-amber-600">Processing</div>
                </div>
              </div>


              <div className="mt-8 flex items-center gap-4">
                <button
                  onClick={prevFeature}
                  className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-gray-200 bg-white text-gray-600 transition-all duration-300 hover:border-blue-600 hover:bg-blue-600 hover:text-white"
                  aria-label="Previous feature"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <span className="text-base font-medium text-gray-500">
                  {activeFeature + 1} of {appFeatureCards.length}
                </span>
                <button
                  onClick={nextFeature}
                  className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-gray-200 bg-white text-gray-600 transition-all duration-300 hover:border-blue-600 hover:bg-blue-600 hover:text-white"
                  aria-label="Next feature"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="slide-in-right order-1 lg:order-2">
              <div className="relative mx-auto aspect-[4/5] max-w-md overflow-hidden rounded-2xl shadow-2xl">
                {appFeatureCards.map((feature, index) => (
                  <Image
                    key={feature.id}
                    src={feature.image}
                    alt={`${feature.title} - ${feature.subtitle}`}
                    width={720}
                    height={900}
                    className={`absolute inset-0 h-full w-full object-cover transition-all duration-700 ${index === activeFeature ? 'scale-100 opacity-100' : 'pointer-events-none scale-105 opacity-0'
                      }`}
                  />
                ))}
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
              </div>
            </div>
          </div>

          <div className="mt-20 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {appFeatureHighlights.map((item) => {
              const IconComponent = item.icon || Sparkles
              return (
                <div key={item.title} className="card-light group p-6 transition-all duration-300 hover:shadow-xl">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-blue-100 transition-colors duration-300 group-hover:bg-blue-600">
                    <IconComponent className="h-7 w-7 text-blue-600 transition-colors duration-300 group-hover:text-white" />
                  </div>
                  <h4 className="mb-2 text-xl font-bold text-gray-900">{item.title}</h4>
                  <p className="text-base leading-relaxed text-gray-600">{item.description}</p>
                </div>
              )
            })}
          </div>

          <div className="mt-16 mx-auto max-w-3xl">
            <div className="testimonial-card text-center">
              <span className="mb-4 inline-block rounded-full bg-amber-100 px-4 py-2 text-sm font-medium text-amber-700">
                Customer Story
              </span>
              <p className="mb-4 text-xl italic leading-relaxed text-gray-700">
                &quot;SafeBill has made managing warranties so simple. My whole family can now find any bill within
                seconds.&quot;
              </p>
              <p className="text-base font-medium text-blue-600">- Anita Sharma, Homemaker from Delhi</p>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="section-padding bg-white">
        <div className="container-custom">
          <div className="fade-up text-center">
            <span className="inline-block rounded-full bg-amber-100 px-4 py-2 text-base font-medium text-amber-700">
              Simple Steps
            </span>
            <p className="mt-4 text-sm font-semibold uppercase tracking-[0.15em] text-blue-600">HOW SAFEBILL WORKS</p>
            <h2 className="mt-2 text-3xl font-bold text-slate-900 lg:text-5xl">Three Easy Steps to Peace of Mind</h2>
          </div>

          <div className="slide-in-left mt-10">
            <div className="grid items-stretch gap-0 overflow-hidden rounded-2xl shadow-2xl lg:grid-cols-2">
              <div className="relative aspect-[4/3] overflow-hidden lg:min-h-[500px] lg:aspect-auto">
                {appSimpleSteps.map((step, index) => (
                  <div
                    key={step.title}
                    className={`absolute inset-0 z-0 transition-all duration-700 ${index === currentStep
                        ? 'z-10 translate-x-0 scale-100 opacity-100'
                        : index === (currentStep - 1 + appSimpleSteps.length) % appSimpleSteps.length && stepDirection === 'next'
                          ? 'z-0 -translate-x-full opacity-0'
                          : index === (currentStep + 1) % appSimpleSteps.length && stepDirection === 'prev'
                            ? 'z-0 translate-x-full opacity-0'
                            : 'z-0 opacity-0'
                      }`}
                  >
                    <Image
                      src={step.image}
                      alt={step.title}
                      width={1200}
                      height={900}
                      className={`h-full w-full object-cover ${index === currentStep ? 'kenburns' : ''}`}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                  </div>
                ))}

                <div className="absolute bottom-6 left-6 z-20 flex gap-3">
                  <button
                    onClick={prevStep}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-lg transition-all duration-300 hover:bg-blue-600 hover:text-white"
                    aria-label="Previous step"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    onClick={nextStep}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-lg transition-all duration-300 hover:bg-blue-600 hover:text-white"
                    aria-label="Next step"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>

                <div className="absolute bottom-6 right-6 z-20 flex gap-2">
                  {appSimpleSteps.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => goToStep(index, index > currentStep ? 'next' : 'prev')}
                      className={`h-2 rounded-full transition-all duration-300 ${index === currentStep ? 'w-8 bg-blue-600' : 'w-4 bg-white/70 hover:bg-white'
                        }`}
                      aria-label={`Go to step ${index + 1}`}
                    />
                  ))}
                </div>
              </div>

              <div className="relative overflow-hidden bg-gray-50 p-8 lg:p-12">
                {appSimpleSteps.map((step, index) => (
                  <div
                    key={step.title}
                    className={`transition-all duration-500 ${index === currentStep ? 'translate-y-0 opacity-100' : 'absolute translate-y-4 opacity-0'
                      }`}
                    style={{ display: index === currentStep ? 'block' : 'none' }}
                  >
                    <div className="mb-4 flex items-center gap-2 text-base font-medium text-blue-600">
                      <MapPin className="h-5 w-5" />
                      <span>Works Across India</span>
                    </div>
                    <span className="mb-3 inline-block rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700">
                      {step.subtitle}
                    </span>
                    <h3 className="mb-4 text-2xl font-bold text-gray-900 lg:text-3xl">{step.title}</h3>
                    <div className="mb-6 flex items-baseline gap-2">
                      <span className="text-4xl font-bold text-blue-600 lg:text-5xl">{step.area}</span>
                      <span className="text-lg text-gray-600">{step.unit}</span>
                    </div>
                    <p className="mb-8 text-lg leading-relaxed text-gray-600">{step.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="fade-up mt-8 flex justify-center" style={{ transitionDelay: '0.2s' }}>
              <div className="flex items-center gap-4 text-base">
                <span className="text-2xl font-bold text-blue-600">{String(currentStep + 1).padStart(2, '0')}</span>
                <div className="h-1 w-12 rounded-full bg-gray-300" />
                <span className="text-gray-500">{String(appSimpleSteps.length).padStart(2, '0')}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="security" className="section-padding relative overflow-hidden bg-gradient-to-br from-blue-50 to-white">
        <div className="container-custom relative">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
            <div>
              <div className="slide-in-left mb-10">
                <span className="mb-4 inline-block rounded-full bg-blue-100 px-4 py-2 text-base font-medium text-blue-700">
                  Your Data is Safe
                </span>
                <span className="mb-4 block text-sm font-medium uppercase tracking-[0.15em] text-blue-600">BANK-LEVEL SECURITY</span>
                <h2 className="has-bar text-3xl font-bold text-gray-900 lg:text-5xl">Protected & Compliant for Indian Users</h2>
              </div>

              <p className="fade-up mb-10 text-lg leading-relaxed text-gray-600" style={{ transitionDelay: '0.1s' }}>
                We understand how important your documents are. SafeBill uses strong security standards and India-focused
                compliance workflows to protect your records.
              </p>

              <div className="fade-up mb-8 flex flex-wrap gap-3" style={{ transitionDelay: '0.15s' }}>
                {appSecurityTabs.map((tab, index) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveSecurityTab(index)}
                    className={`flex items-center gap-2 rounded-xl px-5 py-3 text-base font-medium transition-all duration-300 ${index === activeSecurityTab
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-blue-50'
                      }`}
                  >
                    <tab.icon className="h-5 w-5" />
                    {tab.name}
                  </button>
                ))}
              </div>

              <div className="fade-up" style={{ transitionDelay: '0.2s' }}>
                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-lg transition-all duration-300">
                  <h3 className="mb-4 text-2xl font-bold text-gray-900">{selectedSecurity.content.title}</h3>
                  <p className="mb-4 text-lg leading-relaxed text-gray-600">{selectedSecurity.content.description}</p>
                  <div className="flex items-center gap-3 text-blue-600">
                    <div className="h-1 w-8 rounded-full bg-blue-600" />
                    <span className="text-base font-medium">{selectedSecurity.content.highlight}</span>
                  </div>
                </div>
              </div>

              <div className="fade-up mt-10" style={{ transitionDelay: '0.25s' }}>
                <div className="relative">
                  <div className="absolute left-0 right-0 top-4 h-1 rounded-full bg-blue-200" />
                  <div className="flex justify-between gap-4 overflow-x-auto pb-4">
                    {appSecurityTimeline.map((item) => (
                      <div key={`${item.year}-${item.event}`} className="relative flex min-w-[100px] flex-shrink-0 flex-col items-center">
                        <div className="z-10 flex h-8 w-8 items-center justify-center rounded-full border-4 border-white bg-blue-600 shadow-lg">
                          <div className="h-2 w-2 rounded-full bg-white" />
                        </div>
                        <span className="mt-3 text-lg font-bold text-blue-600">{item.year}</span>
                        <span className="mt-1 text-center text-sm text-gray-500">{item.event}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="fade-up mt-10 flex items-start gap-6" style={{ transitionDelay: '0.3s' }}>
                <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100">
                  <span className="text-3xl text-amber-600">&quot;</span>
                </div>
                <div>
                  <p className="mb-2 text-base font-medium text-blue-600">Our Promise</p>
                  <p className="text-lg italic leading-relaxed text-gray-700">
                    &quot;We treat your documents with the same care we would want for our own family&apos;s important papers.&quot;
                  </p>
                  <p className="mt-3 text-base font-medium text-gray-500">- The SafeBill Team</p>
                </div>
              </div>
            </div>

            <div className="slide-in-right relative" style={{ transitionDelay: '0.15s' }}>
              <div className="relative aspect-[4/5] overflow-hidden rounded-2xl shadow-2xl">
                {appSecurityTabs.map((tab, index) => (
                  <div
                    key={tab.id}
                    className={`absolute inset-0 transition-all duration-500 ${index === activeSecurityTab ? 'scale-100 opacity-100' : 'scale-105 opacity-0'
                      }`}
                  >
                    <Image src={tab.image} alt={tab.name} width={900} height={1200} className="h-full w-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                  </div>
                ))}

                <div className="absolute right-6 top-6 flex h-28 w-28 items-center justify-center rounded-full bg-white/95 shadow-xl backdrop-blur-sm">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-blue-600">99.9%</div>
                    <div className="mt-1 text-xs uppercase tracking-wider text-gray-500">Uptime</div>
                  </div>
                </div>

                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-amber-400">Platform Access</p>
                      <p className="text-xl font-bold text-white">Available 24/7</p>
                    </div>
                    <button
                      onClick={() => scrollToSection('signin')}
                      className="btn-primary rounded-xl px-6 py-3 text-base"
                    >
                      Learn More About Security
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <AwsBeamSection />

      <section id="articles" className="section-padding relative overflow-hidden bg-[#fafafa]">
        <div className="absolute left-0 top-1/4 h-64 w-64 rounded-full bg-blue-200/30 blur-3xl" />
        <div className="absolute bottom-1/4 right-0 h-48 w-48 rounded-full bg-amber-200/30 blur-3xl" />

        <div className="container-custom relative">
          <div className="fade-up mb-10 flex items-end justify-between gap-6">
            <div>
              <span className="inline-block rounded-full bg-amber-100 px-4 py-2 text-base font-medium text-amber-700">
                Helpful Tips
              </span>
              <p className="mt-4 text-sm font-semibold uppercase tracking-[0.15em] text-blue-600">ARTICLES & GUIDES</p>
              <h2 className="has-bar mt-2 text-3xl font-bold text-slate-900 lg:text-5xl">Make the Most of Your Warranties</h2>
            </div>
          </div>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {appArticles.map((item) => (
              <article
                key={item.id}
                className="fade-up card-light group cursor-pointer overflow-hidden"
                style={{ transitionDelay: `${0.1 + item.id * 0.08}s` }}
              >
                <div className="relative aspect-[3/2]">
                  <Image src={item.image} alt={item.title} fill className="object-cover transition-transform duration-700 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  <span className="absolute left-4 top-4 rounded-lg bg-blue-600 px-3 py-1 text-sm font-medium text-white">
                    {item.category}
                  </span>
                </div>
                <div className="p-6">
                  <div className="mb-3 flex items-center gap-2 text-sm text-slate-500">
                    <Calendar className="h-4 w-4" />
                    <span>{item.date}</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">{item.title}</h3>
                  <p className="mt-3 text-base leading-relaxed text-slate-600">{item.excerpt}</p>
                </div>
              </article>
            ))}
          </div>

          <div id="story" className="fade-up mt-24 border-t border-slate-200 pt-20">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div className="slide-in-left">
                <span className="inline-block rounded-full bg-blue-100 px-4 py-2 text-base font-medium text-blue-700">
                  Our Story
                </span>
                <p className="mt-4 text-sm font-semibold uppercase tracking-[0.15em] text-blue-600">
                  BUILT FOR INDIAN FAMILIES
                </p>
                <h2 className="mt-2 whitespace-pre-line text-3xl font-bold text-slate-900 lg:text-4xl">
                  Made in India,
                  {'\n'}
                  Loved by Thousands
                </h2>
                <div className="mt-6 space-y-4 text-lg leading-relaxed text-slate-600">
                  <p>
                    SafeBill was born when we realized how many Indian families lose money simply because they cannot
                    find their warranty documents when they need them most.
                  </p>
                  <p>
                    We set out to create a solution that is simple enough for grandparents to use, yet powerful enough
                    for business owners. Today, over 50,000 families across all 28 states trust SafeBill with their
                    important documents.
                  </p>
                </div>
                <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {appStoryTimeline.map((item) => (
                    <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                      <p className="text-2xl font-bold text-blue-600">{item.value}</p>
                      <p className="text-sm text-slate-500">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="slide-in-right relative">
                <div className="relative aspect-[4/5] overflow-hidden rounded-2xl shadow-2xl">
                  <Image
                    src="/images/testimonial-office.jpg"
                    alt="The SafeBill team working to serve Indian families"
                    fill
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                </div>
                <div className="absolute bottom-6 left-6 right-6 rounded-xl bg-white/95 p-6 shadow-xl backdrop-blur-sm">
                  <p className="mb-2 text-base font-medium text-blue-600">Our Mission</p>
                  <p className="text-lg italic leading-relaxed text-slate-700">
                    &quot;Every family deserves peace of mind when it comes to their purchases. We are here to make
                    that happen.&quot;
                  </p>
                  <p className="mt-2 text-sm font-medium text-slate-500">- SafeBill Founders</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="signin" className="section-padding relative overflow-hidden bg-gradient-to-br from-blue-50 to-white">
        <div className="container-custom relative">
          <div className="fade-up mb-16 text-center">
            <span className="inline-block rounded-full bg-blue-100 px-4 py-2 text-base font-medium text-blue-700">
              Get In Touch
            </span>
            <span className="mt-4 block text-sm font-medium uppercase tracking-[0.15em] text-blue-600">WE&apos;RE HERE TO HELP</span>
            <h2 className="mt-2 text-3xl font-bold text-gray-900 lg:text-5xl">
              Start Your Journey
              <br />
              to Paperless Peace
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
              Have questions? Need help getting started? Sign in to your SafeBill account and continue your workflow.
            </p>
          </div>

          <div className="flex justify-center">
            <div className="w-full max-w-md">
              <div id="signin-form" className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl lg:p-10">
                <div className="mb-6 text-center">
                  <div className="mx-auto mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full bg-blue-100">
                    <LogIn className="h-7 w-7 text-blue-600" />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">Sign in to SafeBill</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Access your locker and claim workflows with SafeBill ID, email, or phone
                  </p>
                </div>

                <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
                  <button
                    className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${userType === 'consumer' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                      }`}
                    onClick={() => {
                      setUserType('consumer')
                      setError(null)
                    }}
                  >
                    Consumer
                  </button>
                  <button
                    className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${userType === 'merchant' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                      }`}
                    onClick={() => {
                      setUserType('merchant')
                      setError(null)
                    }}
                  >
                    Merchant
                  </button>
                </div>

                {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-slate-700">
                      {userType === 'consumer' ? 'Consumer ID, email, or phone' : 'Merchant ID, email, or phone'}
                    </label>
                    <input
                      type="text"
                      placeholder={
                        userType === 'consumer'
                          ? 'CON-XXXXXX, name@email.com, or +91XXXXXXXXXX'
                          : 'MER-XXXXXX, name@email.com, or +91XXXXXXXXXX'
                      }
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                      className="h-11 w-full rounded-xl border border-slate-300 px-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-semibold text-slate-700">Password</label>
                    <input
                      type="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                      className="h-11 w-full rounded-xl border border-slate-300 px-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 text-sm">
                    <button
                      onClick={() => router.push(`/auth/recover-id?userType=${userType}`)}
                      className="font-semibold text-blue-600 transition hover:text-blue-700"
                    >
                      {userType === 'merchant' ? 'Forgot Merchant ID?' : 'Forgot Consumer ID?'}
                    </button>
                    <button
                      onClick={() => router.push(`/auth/forgot-password?userType=${userType}`)}
                      className="font-semibold text-blue-600 transition hover:text-blue-700"
                    >
                      Forgot password?
                    </button>
                  </div>

                  <button
                    onClick={handleLogin}
                    disabled={loading}
                    className="h-11 w-full rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? <span className="loading loading-spinner loading-sm" /> : 'Sign In'}
                  </button>
                </div>

                <p className="mt-4 text-center text-sm text-slate-500">
                  New here?{' '}
                  <button
                    onClick={() => router.push('/signup')}
                    className="font-semibold text-blue-600 transition hover:text-blue-700"
                  >
                    Create a SafeBill account
                  </button>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="relative bg-gray-900 text-white" role="contentinfo">
        <div className="px-8 py-16">
          <div className="flex items-center gap-4 mb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-600">
              <Shield className="h-7 w-7 text-white" />
            </div>
            <span className="text-3xl font-bold text-white">SafeBill</span>
          </div>
          <p className="text-xl leading-relaxed text-gray-300 max-w-xl">
            India&apos;s most trusted digital warranty locker. Securely store and manage all your bills, invoices,
            and warranties in one place.
          </p>
        </div>
      </footer>
    </div>
  )
}
