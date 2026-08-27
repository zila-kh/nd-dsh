import { useState, useCallback } from 'react'
import type { GameAnnouncement } from '../types'

export function useAriaAnnouncer() {
  const [announcement, setAnnouncement] = useState<GameAnnouncement | null>(null)

  const announce = useCallback((message: string, politeness: 'polite' | 'assertive' = 'polite') => {
    setAnnouncement({
      message,
      politeness,
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    })
  }, [])

  const clearAnnouncement = useCallback(() => {
    setAnnouncement(null)
  }, [])

  return {
    announcement,
    announce,
    clearAnnouncement,
  }
}
