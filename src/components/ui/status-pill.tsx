"use client"

import { useEffect, useRef, useState } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const statusPillVariants = cva(
  "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold",
  {
    variants: {
      tone: {
        success: "bg-status-success text-status-success-foreground",
        warning: "bg-status-warning text-status-warning-foreground",
        danger: "bg-status-danger text-status-danger-foreground",
        neutral: "bg-status-neutral text-status-neutral-foreground",
        blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
        violet: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
        teal: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
        sky: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
        slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
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
    <span className={cn(statusPillVariants({ tone }), popping && "animate-pill-pop", className)}>{label}</span>
  )
}

export { StatusPillBase, statusPillVariants }
