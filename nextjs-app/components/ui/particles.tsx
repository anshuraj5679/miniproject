'use client'

import { useEffect, useRef } from 'react'

type ParticlesProps = {
  className?: string
  quantity?: number
  staticity?: number
  ease?: number
  size?: number
  refresh?: boolean
  color?: string
  vx?: number
  vy?: number
}

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  alpha: number
  size: number
}

function joinClasses(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(' ')
}

export function Particles({
  className,
  quantity = 100,
  staticity = 50,
  ease = 50,
  size = 0.4,
  refresh = false,
  color = '#ffffff',
  vx = 0,
  vy = 0,
}: ParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let particles: Particle[] = []
    let animationFrame = 0
    let width = 0
    let height = 0
    let isDisposed = false
    const mouse = { x: 0, y: 0 }

    const createParticles = () => {
      particles = Array.from({ length: Math.max(1, quantity) }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.15 + vx,
        vy: (Math.random() - 0.5) * 0.15 + vy,
        alpha: 0.2 + Math.random() * 0.55,
        size: size + Math.random() * size * 1.2,
      }))
    }

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      mouse.x = width / 2
      mouse.y = height / 2
      createParticles()
    }

    const step = () => {
      if (isDisposed) return
      ctx.clearRect(0, 0, width, height)

      const swayX = (mouse.x - width / 2) / Math.max(1, staticity * 12)
      const swayY = (mouse.y - height / 2) / Math.max(1, staticity * 12)

      for (const p of particles) {
        p.vx += (vx - p.vx) / Math.max(4, ease)
        p.vy += (vy - p.vy) / Math.max(4, ease)
        p.x += p.vx + swayX
        p.y += p.vy + swayY

        if (p.x < -12) p.x = width + 12
        if (p.x > width + 12) p.x = -12
        if (p.y < -12) p.y = height + 12
        if (p.y > height + 12) p.y = -12

        ctx.globalAlpha = p.alpha
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.globalAlpha = 1
      animationFrame = window.requestAnimationFrame(step)
    }

    const onMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouse.x = event.clientX - rect.left
      mouse.y = event.clientY - rect.top
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', onMove)
    animationFrame = window.requestAnimationFrame(step)

    return () => {
      isDisposed = true
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMove)
      window.cancelAnimationFrame(animationFrame)
    }
  }, [color, ease, quantity, refresh, size, staticity, vx, vy])

  return (
    <canvas
      ref={canvasRef}
      className={joinClasses('pointer-events-none absolute inset-0 h-full w-full', className)}
      aria-hidden
    />
  )
}
