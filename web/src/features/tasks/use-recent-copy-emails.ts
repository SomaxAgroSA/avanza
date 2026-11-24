import { useCallback, useState } from 'react'
import { readJson, writeJson } from '@/core/storage/safe-storage'
import { useSession } from '@/features/auth/session'

/** Quantos endereços cabem em "Com cópia" (o mesmo limite do servidor: domain/email.js#MAX_COPY_EMAILS). */
export const MAX_COPY_EMAILS = 5
/** Quantos endereços usados antes ficam guardados (neste navegador, por pessoa). */
const MAX_RECENT = 6
const recentKey = (userId: string) => `avanza.taskCopy.recent.${userId}`

const readRecent = (userId: string | undefined): string[] => {
  const stored = userId ? readJson<unknown>(recentKey(userId), []) : []
  return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT) : []
}

/**
 * Endereços que a pessoa já pôs em cópia (ajuste 24/11): ficam neste navegador para não digitar de novo o da
 * caixa do suporte a cada tarefa. `remember` guarda os da tarefa recém-criada, os mais recentes primeiro.
 */
export function useRecentCopyEmails(): { recent: string[]; remember: (emails: string[]) => void } {
  const userId = useSession().current?.user.id
  const [recent, setRecent] = useState<string[]>(() => readRecent(userId))
  const remember = useCallback(
    (emails: string[]) => {
      if (!userId || emails.length === 0) return
      const next = [...emails, ...readRecent(userId).filter((email) => !emails.includes(email))].slice(0, MAX_RECENT)
      writeJson(recentKey(userId), next)
      setRecent(next)
    },
    [userId],
  )
  return { recent, remember }
}
