"use client"

import { useEffect, useRef, useState } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Solid, full-color chip with a realistic raised finish (inset highlight +
// soft shadow, same depth vocabulary as buttons/cards elsewhere in the app) —
// the color fills the whole pill rather than living in a small dot, per
// explicit feedback that a dot-only treatment read as flat/lifeless.
const statusPillVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold shadow-[inset_0_1px_0_0_rgba(255,255,255,0.3),0_1px_2px_0_rgba(0,0,0,0.15)] transition-shadow",
  {
    variants: {
      tone: {
        success: "bg-emerald-600 text-white dark:bg-emerald-500",
        warning: "bg-amber-600 text-white dark:bg-amber-500",
        danger: "bg-rose-600 text-white dark:bg-rose-500",
        neutral: "bg-zinc-500 text-white dark:bg-zinc-500",
        blue: "bg-blue-600 text-white dark:bg-blue-500",
        violet: "bg-violet-600 text-white dark:bg-violet-500",
        teal: "bg-teal-600 text-white dark:bg-teal-500",
        sky: "bg-sky-600 text-white dark:bg-sky-500",
        slate: "bg-slate-500 text-white dark:bg-slate-500",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
)

export type StatusTone = NonNullable<VariantProps<typeof statusPillVariants>["tone"]>

function StatusPillBase({
  tone,
  label,
  className,
}: { label: string; className?: string } & VariantProps<typeof statusPillVariants>) {
  const [popping, setPopping] = useState(false)
  const previousLabel = useRef(label)

  useEffect(() => {
    if (previousLabel.current === label) return
    previousLabel.current = label
    setPopping(true)
    const timeout = setTimeout(() => setPopping(false), 200)
    return () => clearTimeout(timeout)
  }, [label])

  return (
    <span className={cn(statusPillVariants({ tone }), popping && "animate-pill-pop", className)}>
      {label}
    </span>
  )
}

export { StatusPillBase, statusPillVariants }
