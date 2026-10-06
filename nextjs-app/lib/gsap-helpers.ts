'use client'

import { gsap } from 'gsap'
import { useEffect, type DependencyList, type RefObject } from 'react'

const DEFAULT_EASE = 'power2.out'

function userPrefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type RevealOptions = {
  duration?: number
  stagger?: number
}

export function useGsapReveal(
  scopeRef: RefObject<HTMLElement>,
  deps: DependencyList = [],
  options?: RevealOptions
) {
  const depsKey = deps.map((dep) => String(dep)).join('|')

  useEffect(() => {
    const scope = scopeRef.current
    if (!scope || userPrefersReducedMotion()) return

    const duration = options?.duration ?? 0.6
    const stagger = options?.stagger ?? 0.08
    const cleanupFns: Array<() => void> = []

    const ctx = gsap.context(() => {
      const hero = gsap.utils.toArray<HTMLElement>('[data-gsap="hero"]')
      const cards = gsap.utils.toArray<HTMLElement>('[data-gsap="card"]')
      const listItems = gsap.utils.toArray<HTMLElement>('[data-gsap="list-item"]')
      const panels = gsap.utils.toArray<HTMLElement>('[data-gsap="panel"]')

      if (hero.length) {
        gsap.from(hero, {
          autoAlpha: 0,
          y: 20,
          duration,
          stagger,
          ease: DEFAULT_EASE,
          clearProps: 'all',
        })
      }

      if (cards.length) {
        gsap.from(cards, {
          autoAlpha: 0,
          y: 18,
          scale: 0.98,
          duration,
          stagger: Math.min(stagger, 0.06),
          ease: DEFAULT_EASE,
          clearProps: 'all',
        })
      }

      if (listItems.length) {
        gsap.from(listItems, {
          autoAlpha: 0,
          x: -10,
          duration: duration * 0.8,
          stagger: Math.min(stagger, 0.05),
          ease: DEFAULT_EASE,
          clearProps: 'all',
        })
      }

      if (panels.length) {
        gsap.from(panels, {
          autoAlpha: 0,
          x: 14,
          duration: duration * 0.9,
          stagger: Math.min(stagger, 0.05),
          ease: DEFAULT_EASE,
          clearProps: 'all',
        })
      }

      const hoverLiftTargets = gsap.utils.toArray<HTMLElement>('[data-gsap-hover="lift"]')
      hoverLiftTargets.forEach((element) => {
        const onEnter = () => {
          gsap.to(element, {
            y: -4,
            boxShadow: '0 22px 46px -28px rgba(99, 102, 241, 0.65)',
            duration: 0.2,
            ease: 'power2.out',
          })
        }
        const onLeave = () => {
          gsap.to(element, {
            y: 0,
            boxShadow: '0 0 0 rgba(0,0,0,0)',
            duration: 0.2,
            ease: 'power2.out',
          })
        }

        element.addEventListener('pointerenter', onEnter)
        element.addEventListener('pointerleave', onLeave)
        cleanupFns.push(() => {
          element.removeEventListener('pointerenter', onEnter)
          element.removeEventListener('pointerleave', onLeave)
        })
      })
    }, scope)

    return () => {
      cleanupFns.forEach((cleanup) => cleanup())
      ctx.revert()
    }
  }, [scopeRef, depsKey, options?.duration, options?.stagger])
}

export function useGsapCountUp(scopeRef: RefObject<HTMLElement>, deps: DependencyList = []) {
  const depsKey = deps.map((dep) => String(dep)).join('|')

  useEffect(() => {
    const scope = scopeRef.current
    if (!scope || userPrefersReducedMotion()) return

    const ctx = gsap.context(() => {
      const counterNodes = gsap.utils.toArray<HTMLElement>('[data-count-to]')

      counterNodes.forEach((node) => {
        const to = Number(node.dataset.countTo || '0')
        if (!Number.isFinite(to)) return

        const from = Number(node.dataset.countFrom || '0')
        const decimals = Number(node.dataset.countDecimals || '0')
        const prefix = node.dataset.countPrefix || ''
        const suffix = node.dataset.countSuffix || ''
        const state = { value: from }

        gsap.to(state, {
          value: to,
          duration: 0.9,
          ease: 'power2.out',
          onUpdate: () => {
            node.textContent = `${prefix}${state.value.toFixed(decimals)}${suffix}`
          },
        })
      })
    }, scope)

    return () => {
      ctx.revert()
    }
  }, [scopeRef, depsKey])
}
