"use client"

import React, { forwardRef, useRef } from "react"
import type { LucideIcon } from "lucide-react"
import {
  DatabaseZap,
  FileSearch,
  Globe,
  HardDriveUpload,
  ShieldCheck,
  UserRound,
  Zap,
} from "lucide-react"

import { AnimatedBeam } from "@/components/ui/animated-beam"
import { cn } from "@/lib/utils"

type ServiceNodeProps = {
  name: string
  description: string
  icon: LucideIcon
  badgeClassName: string
}

const ServiceNode = forwardRef<HTMLDivElement, ServiceNodeProps>(
  ({ name, description, icon: Icon, badgeClassName }, ref) => {
    return (
      <div className="group relative overflow-hidden rounded-[24px] border border-slate-200/80 bg-white/90 p-4 pr-9 shadow-[0_24px_48px_-32px_rgba(15,23,42,0.45)] backdrop-blur-sm">
        <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-slate-300/80 to-transparent" />
        <div className="relative z-10 flex items-center gap-4">
          <div
            className={cn(
              "relative flex size-14 shrink-0 items-center justify-center rounded-2xl border border-white/20 shadow-lg shadow-slate-900/10",
              badgeClassName
            )}
          >
            <div className="absolute inset-[1px] rounded-[15px] bg-white/10" />
            <Icon className="relative size-6 text-white" strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">{name}</p>
            <p className="text-xs leading-5 text-slate-500">{description}</p>
          </div>
        </div>
        <div
          ref={ref}
          className="absolute right-4 top-1/2 hidden size-2 -translate-y-1/2 rounded-full bg-slate-300 shadow-[0_0_0_5px_rgba(255,255,255,0.96)] lg:block"
        />
      </div>
    )
  }
)
ServiceNode.displayName = "ServiceNode"

const AwsWordmark = () => (
  <svg
    viewBox="0 0 120 72"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="h-14 w-20"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="aws-smile" x1="22" y1="49" x2="100" y2="57" gradientUnits="userSpaceOnUse">
        <stop stopColor="#F59E0B" />
        <stop offset="1" stopColor="#F97316" />
      </linearGradient>
    </defs>
    <text
      x="60"
      y="34"
      textAnchor="middle"
      fill="#0F172A"
      fontSize="28"
      fontWeight="800"
      letterSpacing="0.5"
      fontFamily="system-ui, sans-serif"
    >
      aws
    </text>
    <path d="M24 48C40 60 78 60 98 46" stroke="url(#aws-smile)" strokeWidth="6" strokeLinecap="round" />
    <path d="M89 41L98 46L91 56" stroke="#F59E0B" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const UserNode = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative overflow-hidden rounded-[28px] border border-blue-100 bg-white/85 px-5 py-5 shadow-[0_24px_48px_-32px_rgba(37,99,235,0.45)] backdrop-blur-sm">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.14),transparent_55%)]" />
        <div
          ref={ref}
          className="absolute left-4 top-1/2 hidden size-2 -translate-y-1/2 rounded-full bg-blue-200 shadow-[0_0_0_5px_rgba(255,255,255,0.96)] lg:block"
        />
        <div
          className="relative z-10 flex size-16 items-center justify-center rounded-full border border-blue-200 bg-white shadow-lg shadow-blue-500/10"
        >
          <div className="absolute inset-1 rounded-full bg-blue-50" />
          <UserRound className="relative size-7 text-blue-600" strokeWidth={2.1} />
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-slate-900">You</p>
        <p className="text-xs text-slate-500">Secure access on demand</p>
      </div>
    </div>
  )
})
UserNode.displayName = "UserNode"

export function AwsBeamSection() {
  const containerRef = useRef<HTMLDivElement>(null)
  const s3Ref = useRef<HTMLDivElement>(null)
  const lambdaRef = useRef<HTMLDivElement>(null)
  const cognitoRef = useRef<HTMLDivElement>(null)
  const textractRef = useRef<HTMLDivElement>(null)
  const rdsRef = useRef<HTMLDivElement>(null)
  const cloudfrontRef = useRef<HTMLDivElement>(null)
  const awsInboundRef = useRef<HTMLDivElement>(null)
  const awsOutboundRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)

  const services = [
    {
      name: "S3",
      description: "Bill and warranty storage",
      icon: HardDriveUpload,
      badgeClassName: "bg-gradient-to-br from-emerald-500 via-green-500 to-lime-500",
      beamStart: "#10B981",
      beamStop: "#34D399",
      curvature: 56,
      ref: s3Ref,
    },
    {
      name: "Lambda",
      description: "Serverless validation and orchestration",
      icon: Zap,
      badgeClassName: "bg-gradient-to-br from-orange-500 via-amber-500 to-yellow-400",
      beamStart: "#F97316",
      beamStop: "#F59E0B",
      curvature: 34,
      ref: lambdaRef,
    },
    {
      name: "Cognito",
      description: "Identity, sessions, and secure auth",
      icon: ShieldCheck,
      badgeClassName: "bg-gradient-to-br from-rose-600 via-red-500 to-orange-400",
      beamStart: "#F43F5E",
      beamStop: "#FB7185",
      curvature: 12,
      ref: cognitoRef,
    },
    {
      name: "Textract",
      description: "OCR pipelines for bill data extraction",
      icon: FileSearch,
      badgeClassName: "bg-gradient-to-br from-cyan-500 via-teal-500 to-emerald-400",
      beamStart: "#06B6D4",
      beamStop: "#2DD4BF",
      curvature: -10,
      ref: textractRef,
    },
    {
      name: "RDS",
      description: "Structured relational data at rest",
      icon: DatabaseZap,
      badgeClassName: "bg-gradient-to-br from-blue-600 via-sky-500 to-cyan-400",
      beamStart: "#3B82F6",
      beamStop: "#38BDF8",
      curvature: -34,
      ref: rdsRef,
    },
    {
      name: "CloudFront",
      description: "Fast global delivery and edge caching",
      icon: Globe,
      badgeClassName: "bg-gradient-to-br from-violet-600 via-indigo-500 to-blue-500",
      beamStart: "#8B5CF6",
      beamStop: "#6366F1",
      curvature: -56,
      ref: cloudfrontRef,
    },
  ] as const

  return (
    <section className="section-padding relative overflow-hidden bg-white">
      <div className="container-custom relative">
        <div className="fade-up mb-12 text-center">
          <span className="inline-block rounded-full bg-amber-100 px-4 py-2 text-base font-medium text-amber-700">
            Cloud Infrastructure
          </span>
          <p className="mt-4 text-sm font-semibold uppercase tracking-[0.15em] text-blue-600">
            Powered by Amazon Web Services
          </p>
          <h2 className="mt-2 text-3xl font-bold text-slate-900 lg:text-5xl">
            Built on AWS for Scale &amp; Trust
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-500">
            Every document moves through a secure AWS pipeline from upload to access, without the visual clutter.
          </p>
        </div>

        <div
          ref={containerRef}
          className="relative isolate overflow-hidden rounded-[32px] border border-slate-200/80 bg-[linear-gradient(180deg,#fdfefe_0%,#f7f9fc_100%)] px-6 py-8 shadow-[0_40px_80px_-48px_rgba(15,23,42,0.45)] lg:min-h-[430px] lg:px-8 xl:px-10"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_left_center,rgba(59,130,246,0.07),transparent_30%),radial-gradient(circle_at_center,rgba(245,158,11,0.14),transparent_24%),radial-gradient(circle_at_right_center,rgba(99,102,241,0.08),transparent_30%)]" />
          <div className="relative z-10 grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_auto_minmax(0,0.8fr)] lg:items-center xl:gap-14">
            <div className="grid gap-4 sm:grid-cols-2 lg:pr-8">
              {services.map((service) => (
                <ServiceNode
                  key={service.name}
                  ref={service.ref}
                  name={service.name}
                  description={service.description}
                  icon={service.icon}
                  badgeClassName={service.badgeClassName}
                />
              ))}
            </div>

            <div className="relative flex flex-col items-center gap-4 lg:px-4">
              <div className="pointer-events-none absolute inset-x-0 top-8 h-24 rounded-full bg-amber-200/50 blur-3xl" />
              <div
                className="relative z-10 flex size-28 items-center justify-center rounded-full border-[3px] border-amber-300 bg-white shadow-[0_30px_70px_-30px_rgba(245,158,11,0.75)]"
              >
                <div
                  ref={awsInboundRef}
                  className="absolute left-2 top-1/2 hidden size-2 -translate-y-1/2 rounded-full bg-amber-200 shadow-[0_0_0_5px_rgba(255,255,255,0.96)] lg:block"
                />
                <div
                  ref={awsOutboundRef}
                  className="absolute right-2 top-1/2 hidden size-2 -translate-y-1/2 rounded-full bg-amber-200 shadow-[0_0_0_5px_rgba(255,255,255,0.96)] lg:block"
                />
                <div className="absolute inset-3 rounded-full border border-amber-100 bg-[radial-gradient(circle_at_top,rgba(254,243,199,0.8),rgba(255,255,255,0.98)_65%)]" />
                <div className="relative">
                  <AwsWordmark />
                </div>
              </div>
              <div className="text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">AWS Cloud</p>
                <p className="mt-2 max-w-[14rem] text-sm leading-6 text-slate-500">
                  Storage, auth, OCR, compute, and delivery coordinated through one trusted core.
                </p>
              </div>
            </div>

            <div className="flex justify-center lg:justify-end">
              <UserNode ref={userRef} />
            </div>
          </div>

          <div className="pointer-events-none absolute inset-0 z-0 hidden lg:block">
            {services.map((service) => (
              <AnimatedBeam
                key={service.name}
                containerRef={containerRef}
                fromRef={service.ref}
                toRef={awsInboundRef}
                curvature={service.curvature}
                pathColor="#CBD5E1"
                pathOpacity={0.26}
                pathWidth={1.75}
                gradientStartColor={service.beamStart}
                gradientStopColor={service.beamStop}
              />
            ))}
            <AnimatedBeam
              containerRef={containerRef}
              fromRef={awsOutboundRef}
              toRef={userRef}
              curvature={0}
              pathColor="#CBD5E1"
              pathOpacity={0.32}
              pathWidth={1.75}
              gradientStartColor="#F59E0B"
              gradientStopColor="#2563EB"
            />
          </div>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {services.map((service) => {
            const Icon = service.icon

            return (
              <div
                key={service.name}
                className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm shadow-slate-900/5"
              >
                <div className={cn("flex size-8 items-center justify-center rounded-full text-white", service.badgeClassName)}>
                  <Icon className="size-4" strokeWidth={2.2} />
                </div>
                <span className="text-sm font-semibold text-slate-900">AWS {service.name}</span>
                <span className="text-sm text-slate-400">-</span>
                <span className="text-sm text-slate-500">{service.description}</span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
