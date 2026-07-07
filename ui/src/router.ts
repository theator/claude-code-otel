import { useEffect, useState } from 'react'

// Minimal hash router: #/, #/sessions, #/sessions/:id, #/overview
// Sessions route supports query params in the hash: #/sessions?q=foo&sort=cost&dir=desc&active=1
export type Route =
  | { name: 'overview' }
  | { name: 'sessions' }
  | { name: 'session'; id: string }

export interface SessionsQuery {
  q?: string
  sort?: string
  dir?: 'asc' | 'desc'
  active?: boolean
}

function parsePath(hash: string): Route {
  const h = hash.replace(/^#/, '')
  const path = h.split('?')[0]
  if (path.startsWith('/sessions/')) return { name: 'session', id: path.slice('/sessions/'.length) }
  if (path.startsWith('/sessions')) return { name: 'sessions' }
  return { name: 'overview' }
}

export function parseHashQuery(): SessionsQuery {
  const h = window.location.hash.replace(/^#/, '')
  const qIdx = h.indexOf('?')
  if (qIdx < 0) return {}
  const sp = new URLSearchParams(h.slice(qIdx + 1))
  const dir = sp.get('dir')
  return {
    q: sp.get('q') || undefined,
    sort: sp.get('sort') || undefined,
    dir: dir === 'asc' || dir === 'desc' ? dir : undefined,
    active: sp.get('active') === '1' ? true : undefined,
  }
}

export function setSessionsQuery(q: SessionsQuery): void {
  const sp = new URLSearchParams()
  if (q.q) sp.set('q', q.q)
  if (q.sort) sp.set('sort', q.sort)
  if (q.dir) sp.set('dir', q.dir)
  if (q.active) sp.set('active', '1')
  const qs = sp.toString()
  const newHash = qs ? `#/sessions?${qs}` : '#/sessions'
  if (window.location.hash !== newHash) {
    // replaceState avoids double history entries for filter churn
    history.replaceState(null, '', newHash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
}

export function parseHash(): Route {
  return parsePath(window.location.hash)
}

export function navigate(route: Route): void {
  let hash = '#/'
  if (route.name === 'sessions') hash = '#/sessions'
  else if (route.name === 'session') hash = `#/sessions/${route.id}`
  if (window.location.hash !== hash) window.location.hash = hash
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash())
  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

export function useSessionsQuery(): [SessionsQuery, (next: SessionsQuery) => void] {
  const [query, setQueryState] = useState<SessionsQuery>(parseHashQuery())
  useEffect(() => {
    const onHash = () => setQueryState(parseHashQuery())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const update = (next: SessionsQuery) => {
    setQueryState(next)
    setSessionsQuery(next)
  }
  return [query, update]
}