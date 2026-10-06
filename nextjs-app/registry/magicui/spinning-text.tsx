'use client'

import { HTMLAttributes, useMemo } from 'react'

type SpinningTextProps = HTMLAttributes<HTMLDivElement> & {
  reverse?: boolean
  duration?: number
  radius?: number
}

function joinClasses(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(' ')
}

export function SpinningText({
  reverse = false,
  duration = 4,
  radius = 6,
  className,
  children,
  ...props
}: SpinningTextProps) {
  const text = typeof children === 'string' ? children : ''
  const chars = useMemo(() => text.split(''), [text])

  return (
    <div
      className={joinClasses('relative inline-block select-none', className)}
      style={{
        width: `${radius * 2}rem`,
        height: `${radius * 2}rem`,
        animation: `spinText ${duration}s linear infinite ${reverse ? 'reverse' : 'normal'}`,
      }}
      aria-label={text}
      {...props}
    >
      {chars.map((char, index) => {
        const angle = (360 / chars.length) * index
        return (
          <span
            key={`${char}-${index}`}
            className="absolute left-1/2 top-1/2 block origin-center font-semibold uppercase tracking-[0.08em]"
            style={{
              transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-${radius}rem)`,
            }}
          >
            {char === ' ' ? '\u00A0' : char}
          </span>
        )
      })}
      <style jsx global>{`
        @keyframes spinText {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  )
}
