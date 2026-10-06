'use client'

import {
  CSSProperties,
  Children,
  ReactElement,
  ReactNode,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

type SharedProps = {
  children: ReactNode
  className?: string
}

type SequencingProps = {
  __sequence?: boolean
  __lineIndex?: number
  __activeIndex?: number
  __terminalStarted?: boolean
  __onDone?: (index: number) => void
}

type TerminalProps = SharedProps & {
  sequence?: boolean
  startOnView?: boolean
}

type AnimatedSpanProps = SharedProps & {
  delay?: number
  startOnView?: boolean
}

type TypingAnimationProps = SharedProps & {
  children: string
  duration?: number
  delay?: number
  as?: React.ElementType
  startOnView?: boolean
}

function joinClasses(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(' ')
}

function useStartOnView(enabled: boolean) {
  const ref = useRef<HTMLElement | null>(null)
  const [isVisible, setIsVisible] = useState(!enabled)

  useEffect(() => {
    if (!enabled) {
      setIsVisible(true)
      return
    }

    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.2 }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [enabled])

  return { ref, isVisible }
}

export function Terminal({ children, className, sequence = true, startOnView = true }: TerminalProps) {
  const { ref, isVisible } = useStartOnView(startOnView)
  const childCount = useMemo(
    () => Children.toArray(children).filter((child) => isValidElement(child)).length,
    [children]
  )
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (sequence && isVisible) {
      setActiveIndex(0)
    }
  }, [sequence, isVisible, children])

  const handleDone = useCallback(
    (index: number) => {
      setActiveIndex((current) => {
        if (current !== index) return current
        return Math.min(index + 1, childCount)
      })
    },
    [childCount]
  )

  let lineIndex = -1
  const enhancedChildren = Children.map(children, (child) => {
    if (!isValidElement(child)) {
      return child
    }

    lineIndex += 1
    const injectedProps: SequencingProps = {
      __sequence: sequence,
      __lineIndex: lineIndex,
      __activeIndex: activeIndex,
      __terminalStarted: isVisible,
      __onDone: handleDone,
    }

    return cloneElement(child as ReactElement<SequencingProps>, injectedProps)
  })

  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      className={joinClasses(
        'overflow-hidden rounded-2xl border border-slate-500/70 bg-[#02050d] text-slate-50',
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-slate-600/70 bg-[#0a1324] px-4 py-3">
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-[#ff5f56]" />
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-[#ffbd2e]" />
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-[#27c93f]" />
        <span className="ml-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-100">
          SafeBill Processing Console
        </span>
      </div>
      <div className="space-y-2 bg-[#050b18] px-4 py-4 font-mono text-[13px] leading-relaxed text-slate-50 md:text-sm">
        {enhancedChildren}
      </div>
      <style jsx global>{`
        @keyframes terminalFadeIn {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}

export function AnimatedSpan(props: AnimatedSpanProps & SequencingProps) {
  const {
    children,
    className,
    delay = 0,
    startOnView = false,
    __sequence = false,
    __lineIndex = 0,
    __activeIndex = 0,
    __terminalStarted = true,
    __onDone,
  } = props
  const { ref, isVisible } = useStartOnView(startOnView && !__sequence)
  const [isAnimated, setIsAnimated] = useState(false)
  const completionRef = useRef(false)

  const shouldStart = __sequence ? __terminalStarted && __activeIndex === __lineIndex : isVisible

  useEffect(() => {
    if (!shouldStart) return

    completionRef.current = false
    const timeoutId = setTimeout(() => {
      setIsAnimated(true)
    }, delay)

    return () => clearTimeout(timeoutId)
  }, [delay, shouldStart])

  useEffect(() => {
    if (!__sequence) return
    if (__activeIndex < __lineIndex) {
      setIsAnimated(false)
    }
  }, [__activeIndex, __lineIndex, __sequence])

  const style = {
    animation: isAnimated ? 'terminalFadeIn 420ms ease-out forwards' : undefined,
    animationDelay: `${delay}ms`,
  } as CSSProperties

  return (
    <span
      ref={ref as React.RefObject<HTMLSpanElement>}
      className={joinClasses('block', isAnimated ? 'opacity-100' : 'opacity-0', className)}
      style={style}
      onAnimationEnd={() => {
        if (!__sequence || completionRef.current) return
        completionRef.current = true
        __onDone?.(__lineIndex)
      }}
    >
      {children}
    </span>
  )
}

export function TypingAnimation(props: TypingAnimationProps & SequencingProps) {
  const {
    children,
    className,
    duration = 60,
    delay = 0,
    as: Component = 'span',
    startOnView = true,
    __sequence = false,
    __lineIndex = 0,
    __activeIndex = 0,
    __terminalStarted = true,
    __onDone,
  } = props
  const { ref, isVisible } = useStartOnView(startOnView && !__sequence)
  const text = useMemo(() => children, [children])
  const [value, setValue] = useState('')
  const [done, setDone] = useState(false)
  const completionRef = useRef(false)
  const shouldStart = __sequence ? __terminalStarted && __activeIndex === __lineIndex : isVisible

  useEffect(() => {
    if (!shouldStart) return

    setValue('')
    setDone(false)
    completionRef.current = false

    let index = 0
    let intervalId: ReturnType<typeof setInterval> | null = null
    const timeoutId = setTimeout(() => {
      intervalId = setInterval(() => {
        index += 1
        setValue(text.slice(0, index))
        if (index >= text.length) {
          if (intervalId) {
            clearInterval(intervalId)
          }
          setDone(true)
          if (__sequence && !completionRef.current) {
            completionRef.current = true
            __onDone?.(__lineIndex)
          }
        }
      }, duration)
    }, delay)

    return () => {
      clearTimeout(timeoutId)
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [__lineIndex, __onDone, __sequence, delay, duration, shouldStart, text])

  return (
    <Component ref={ref as never} className={joinClasses('block text-slate-100', className)}>
      {value}
      {!done ? <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-current align-middle" /> : null}
    </Component>
  )
}
