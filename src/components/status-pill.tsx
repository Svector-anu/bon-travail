import type { TaskState } from '@/domain/task-state'
import { STATE_STYLE } from '@/lib/format'

export function StatusPill({ state }: { state: TaskState }) {
  const style = STATE_STYLE[state]
  return <span className={`pill ${style.tone}`}>{style.label}</span>
}
