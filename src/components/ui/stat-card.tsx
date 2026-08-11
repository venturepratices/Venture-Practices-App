import * as React from "react"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { TrendingDown, TrendingUp } from "lucide-react"

import { cn } from "@/lib/utils"
import { Card, CardAction } from "@/components/ui/card"

type StatCardTone = "primary" | "accent" | "neutral"

const ICON_TONE_CLASSES: Record<StatCardTone, string> = {
  primary: "bg-primary/10 text-primary",
  accent: "bg-secondary-accent/10 text-secondary-accent",
  neutral: "bg-muted text-muted-foreground",
}

function StatCard({
  label,
  value,
  href,
  icon: Icon,
  tone = "neutral",
  trend,
  size = "default",
  delayMs = 0,
  className,
}: {
  label: string
  value: React.ReactNode
  href?: string
  icon?: LucideIcon
  tone?: StatCardTone
  trend?: { direction: "up" | "down" | "flat"; label: string }
  size?: "default" | "compact"
  delayMs?: number
  className?: string
}) {
  const body = (
    <Card
      size={size === "compact" ? "default" : "lg"}
      className={cn(
        "hover-glow-ring animate-in fade-in slide-in-from-bottom-1 duration-300 hover:-translate-y-0.5",
        tone === "accent" && "[--shadow-glow-ring:var(--shadow-glow-ring-accent)]",
        className
      )}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="flex items-start justify-between gap-3 px-(--card-spacing)">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground" title={label}>
            {label}
          </span>
          <span
            className={cn(
              "text-4xl font-bold tracking-tight tabular-nums",
              tone === "accent" && "text-secondary-accent"
            )}
          >
            {value}
          </span>
          {trend && (
            <span
              className={cn(
                "flex items-center gap-1 text-xs font-medium",
                trend.direction === "up" && "text-status-success-foreground",
                trend.direction === "down" && "text-status-danger-foreground",
                trend.direction === "flat" && "text-muted-foreground"
              )}
            >
              {trend.direction === "up" && <TrendingUp className="size-3.5" />}
              {trend.direction === "down" && <TrendingDown className="size-3.5" />}
              {trend.label}
            </span>
          )}
        </div>
        {Icon && (
          <CardAction>
            <span className={cn("flex size-10 items-center justify-center rounded-full", ICON_TONE_CLASSES[tone])}>
              <Icon className="size-5" />
            </span>
          </CardAction>
        )}
      </div>
    </Card>
  )

  if (href) {
    return (
      <Link href={href} className="block">
        {body}
      </Link>
    )
  }

  return body
}

export { StatCard }
