'use client'

import { ButtonHTMLAttributes, ReactNode } from 'react'

type ShimmerButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
}

function joinClasses(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(' ')
}

export function ShimmerButton({ children, className, ...props }: ShimmerButtonProps) {
  return (
    <button
      className={joinClasses(
        'group relative inline-flex items-center justify-center overflow-hidden rounded-full border border-[#b2b4cc] bg-[#e3e4ee] px-8 py-3 font-semibold text-[#0d1b48] transition hover:scale-[1.015] hover:bg-white',
        className
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute inset-0 -translate-x-[130%] bg-[linear-gradient(110deg,transparent_25%,rgba(255,255,255,0.7)_50%,transparent_75%)]"
        style={{ animation: 'shimmerSlide 2.6s linear infinite' }}
      />
      <span className="relative z-10">{children}</span>
      <style jsx global>{`
        @keyframes shimmerSlide {
          0% {
            transform: translateX(-130%);
          }
          100% {
            transform: translateX(130%);
          }
        }
      `}</style>
    </button>
  )
}
