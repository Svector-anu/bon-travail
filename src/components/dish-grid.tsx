'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Countdown } from './clock'

export interface DishCard {
  id: string
  title: string
  lines: [string, string]
  icon: string
  href: string
  action: string
  meta: { label: string; value?: string; countdownTo?: number }
}

/** Turnip's dish picker. The live task is pre-selected; hover previews another. */
export function DishGrid({ cards, selectedId }: { cards: DishCard[]; selectedId: string | null }) {
  const [hover, setHover] = useState<string | null>(null)
  const selected = hover ?? selectedId

  return (
    <div className="dish-grid">
      {cards.map((card) => (
        <article
          key={card.id}
          className={card.id === selected ? 'dish selected' : 'dish'}
          onMouseEnter={() => setHover(card.id)}
          onMouseLeave={() => setHover(null)}
        >
          <div className="dish-icon">
            <img src={card.icon} alt="" />
          </div>
          <h2>{card.title}</h2>
          <p>
            {card.lines[0]}
            <br />
            {card.lines[1]}
          </p>
          <Link className="select-btn" href={card.href}>
            {card.action}
          </Link>
          <div className="apy">
            <span>{card.meta.label}</span>
            <span className="tnum">
              {card.meta.countdownTo !== undefined ? <Countdown to={card.meta.countdownTo} done="closing" /> : card.meta.value}
            </span>
          </div>
        </article>
      ))}
    </div>
  )
}
