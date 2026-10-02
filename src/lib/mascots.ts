const TASK_MASCOTS = ['duck', 'turtle', 'snail', 'sushi', 'gorilla', 'squid', 'butterfly'] as const

/** Each task keeps the same picker icon everywhere it appears. */
export function taskMascot(taskId: string): string {
  const seq = Number(taskId.replace(/\D/g, '')) || 0
  return `/mascots/${TASK_MASCOTS[seq % TASK_MASCOTS.length]}.png`
}
