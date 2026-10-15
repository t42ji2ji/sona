import { useRef } from 'react'
import type { KeyboardEvent } from 'react'

/** Enter 送出，但注音選字中、或剛選完字 100ms 內的 Enter 不算 */
export function useEnter(onEnter: () => void) {
  const composedAt = useRef(0)
  return {
    onCompositionEnd: () => { composedAt.current = performance.now() },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey) return
      if (e.nativeEvent.isComposing || e.keyCode === 229 || performance.now() - composedAt.current < 100) return
      e.preventDefault()
      onEnter()
    },
  }
}
