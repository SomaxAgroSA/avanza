import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, render, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { RealtimeClient, RealtimeEvent, RealtimeListener, RealtimeStatus } from '@/core/realtime/realtime-client'
import { RealtimeContext } from './realtime-context'
import { LIVE_MIN_INTERVAL_MS, LIVE_SAFETY_NET_MS, useLiveProject, useLiveProjects, useLiveRefetchInterval, useRealtimeResync } from './use-live'

afterEach(() => vi.useRealTimers())

function fakeRealtime(initial: RealtimeStatus = 'live') {
  const listeners = new Map<string, Set<RealtimeListener>>()
  const statusListeners = new Set<(status: RealtimeStatus) => void>()
  let status = initial
  const client: RealtimeClient = {
    subscribe(topic, listener) {
      if (!listeners.has(topic)) listeners.set(topic, new Set())
      listeners.get(topic)!.add(listener)
      return () => listeners.get(topic)?.delete(listener)
    },
    getStatus: () => status,
    onStatus: (fn) => {
      statusListeners.add(fn)
      return () => statusListeners.delete(fn)
    },
    close: () => {},
  }
  const emit = (topic: string, event: RealtimeEvent) => listeners.get(topic)?.forEach((fn) => fn(event))
  const setStatus = (next: RealtimeStatus) => {
    status = next
    statusListeners.forEach((fn) => fn(next))
  }
  return { client, emit, listeners, setStatus }
}

function Live({ projectId }: { projectId?: string }) {
  useLiveProject(projectId)
  return null
}

describe('useLiveProject', () => {
  it('assina o tópico do projeto, junta os avisos e atualiza os dados afetados de uma vez; ao sair cancela', async () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const realtime = fakeRealtime()
    const view = render(
      <QueryClientProvider client={queryClient}>
        <RealtimeContext.Provider value={realtime.client}>
          <Live projectId="p1" />
        </RealtimeContext.Provider>
      </QueryClientProvider>,
    )
    expect(realtime.listeners.get('project:p1')?.size).toBe(1)
    const base = { action: 'update' as const, projectId: 'p1', itemId: null }
    act(() => {
      realtime.emit('project:p1', { ...base, collection: 'tasks', id: 't1', taskId: 't1' })
      realtime.emit('project:p1', { ...base, collection: 'tasks', id: 't2', taskId: 't2' })
    })
    expect(invalidate).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey))
    expect(keys).toContain(JSON.stringify(['tasks', 'board', 'p1']))
    expect(keys).toContain(JSON.stringify(['tasks', 'detail', 't1']))
    expect(keys).toContain(JSON.stringify(['tasks', 'detail', 't2']))
    // o quadro aparece uma vez só, mesmo com dois avisos
    expect(keys.filter((k) => k === JSON.stringify(['tasks', 'board', 'p1']))).toHaveLength(1)
    view.unmount()
    expect(realtime.listeners.get('project:p1')?.size).toBe(0)
  })

  it('com uma alteração da própria pessoa em andamento, espera ela terminar (evita o cartão "voltar")', async () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    let mutating = 1
    vi.spyOn(queryClient, 'isMutating').mockImplementation(() => mutating)
    const realtime = fakeRealtime()
    render(
      <QueryClientProvider client={queryClient}>
        <RealtimeContext.Provider value={realtime.client}>
          <Live projectId="p1" />
        </RealtimeContext.Provider>
      </QueryClientProvider>,
    )
    act(() => realtime.emit('project:p1', { collection: 'plan_items', action: 'update', id: 'i1', projectId: 'p1', taskId: null, itemId: 'i1' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(invalidate).not.toHaveBeenCalled()
    mutating = 0
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['plan', 'p1'] })
  })

  it('equipe mexendo sem parar: no máximo uma busca a cada 2,5 s por tela (a primeira sai na hora)', async () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const realtime = fakeRealtime()
    render(
      <QueryClientProvider client={queryClient}>
        <RealtimeContext.Provider value={realtime.client}>
          <Live projectId="p1" />
        </RealtimeContext.Provider>
      </QueryClientProvider>,
    )
    const event = (id: string): RealtimeEvent => ({ collection: 'plan_items', action: 'update', id, projectId: 'p1', taskId: null, itemId: id })
    const boardFetches = () => invalidate.mock.calls.filter(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(['plan', 'p1'])).length
    act(() => realtime.emit('project:p1', event('i1')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(boardFetches()).toBe(1)
    // novos avisos logo depois esperam a janela de 2,5 s e saem juntos numa busca só
    act(() => realtime.emit('project:p1', event('i2')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => realtime.emit('project:p1', event('i3')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    expect(boardFetches()).toBe(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_MIN_INTERVAL_MS)
    })
    expect(boardFetches()).toBe(2)
  })

  it('sem projeto não assina nada', () => {
    const realtime = fakeRealtime()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RealtimeContext.Provider value={realtime.client}>
          <Live />
        </RealtimeContext.Provider>
      </QueryClientProvider>,
    )
    expect(realtime.listeners.size).toBe(0)
  })
})

function LiveMany({ projectIds }: { projectIds: string[] }) {
  useLiveProjects(projectIds)
  return null
}

describe('useLiveProjects (Kanban de todos os projetos)', () => {
  it('assina um tópico por projeto; avisos de projetos diferentes viram uma busca só do quadro', async () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const realtime = fakeRealtime()
    const view = render(
      <QueryClientProvider client={queryClient}>
        <RealtimeContext.Provider value={realtime.client}>
          <LiveMany projectIds={['p1', 'p2']} />
        </RealtimeContext.Provider>
      </QueryClientProvider>,
    )
    expect(realtime.listeners.get('project:p1')?.size).toBe(1)
    expect(realtime.listeners.get('project:p2')?.size).toBe(1)
    const base = { collection: 'tasks', action: 'update' as const, taskId: null, itemId: null }
    act(() => {
      realtime.emit('project:p1', { ...base, id: 't1', projectId: 'p1' })
      realtime.emit('project:p2', { ...base, id: 't2', projectId: 'p2' })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey))
    expect(keys.filter((k) => k === JSON.stringify(['tasks', 'board-all']))).toHaveLength(1)
    // nova lista de projetos: troca as assinaturas
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <RealtimeContext.Provider value={realtime.client}>
          <LiveMany projectIds={['p2', 'p3']} />
        </RealtimeContext.Provider>
      </QueryClientProvider>,
    )
    expect(realtime.listeners.get('project:p1')?.size).toBe(0)
    expect(realtime.listeners.get('project:p3')?.size).toBe(1)
    view.unmount()
    expect(realtime.listeners.get('project:p3')?.size).toBe(0)
  })
})

describe('rede de segurança e reconexão', () => {
  function wrapper(realtime: RealtimeClient, queryClient = new QueryClient()) {
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <RealtimeContext.Provider value={realtime}>{children}</RealtimeContext.Provider>
      </QueryClientProvider>
    )
  }

  it('com o tempo real ligado a consulta periódica vira rede de segurança de 5 min; sem ele, volta ao intervalo curto', () => {
    const realtime = fakeRealtime('live')
    const { result } = renderHook(() => useLiveRefetchInterval(15_000), { wrapper: wrapper(realtime.client) })
    expect(result.current).toBe(LIVE_SAFETY_NET_MS)
    act(() => realtime.setStatus('reconnecting'))
    expect(result.current).toBe(15_000)
  })

  it('a conexão caiu e voltou: busca de novo o que está na tela (os avisos do intervalo se perderam)', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const realtime = fakeRealtime('connecting')
    renderHook(() => useRealtimeResync(), { wrapper: wrapper(realtime.client, queryClient) })
    act(() => realtime.setStatus('live'))
    expect(invalidate).not.toHaveBeenCalled()
    act(() => realtime.setStatus('reconnecting'))
    act(() => realtime.setStatus('live'))
    expect(invalidate).toHaveBeenCalledTimes(1)
  })
})
