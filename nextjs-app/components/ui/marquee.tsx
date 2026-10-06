'use client'

import { Children, Fragment, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type MarqueeProps = {
  className?: string
  reverse?: boolean
  pauseOnHover?: boolean
  vertical?: boolean
  children: ReactNode
  repeat?: number
}

export function Marquee({
  className,
  reverse = false,
  pauseOnHover = false,
  vertical = false,
  children,
  repeat = 4,
}: MarqueeProps) {
  const childArray = Children.toArray(children)
  const repeated = Array.from({ length: Math.max(1, repeat) }, (_, i) => (
    <Fragment key={`repeat-${i}`}>
      {childArray.map((child, childIndex) => (
        <Fragment key={`item-${i}-${childIndex}`}>{child}</Fragment>
      ))}
    </Fragment>
  ))

  const trackClass = cn(
    'flex shrink-0 justify-around gap-[var(--gap)]',
    vertical ? 'min-h-full flex-col animate-marquee-vertical' : 'min-w-full flex-row animate-marquee-horizontal',
    reverse ? '[animation-direction:reverse]' : '',
    pauseOnHover ? 'group-hover:[animation-play-state:paused]' : ''
  )

  return (
    <div
      className={cn(
        'group flex overflow-hidden [--duration:20s] [--gap:1rem]',
        vertical ? 'h-full flex-col' : 'w-full flex-row',
        className
      )}
    >
      <div className={trackClass}>{repeated}</div>
      <div className={trackClass} aria-hidden>
        {repeated}
      </div>
      <style jsx global>{`
        @keyframes marquee-horizontal {
          from {
            transform: translateX(0%);
          }
          to {
            transform: translateX(calc(-100% - var(--gap)));
          }
        }

        @keyframes marquee-vertical {
          from {
            transform: translateY(0%);
          }
          to {
            transform: translateY(calc(-100% - var(--gap)));
          }
        }

        .animate-marquee-horizontal {
          animation: marquee-horizontal var(--duration) linear infinite;
        }

        .animate-marquee-vertical {
          animation: marquee-vertical var(--duration) linear infinite;
        }
      `}</style>
    </div>
  )
}
