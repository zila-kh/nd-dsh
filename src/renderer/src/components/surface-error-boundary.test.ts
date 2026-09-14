import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SurfaceErrorBoundary, describeSurfaceError } from './surface-error-boundary'

interface BoundaryProps {
  label: string
  resetKey?: string | undefined
  onError?: ((message: string) => void) | undefined
  children: React.ReactNode
}

/**
 * The boundary is exercised without a DOM: only its error lifecycle methods
 * matter here, so the instance is driven directly with a recording setState.
 */
function createBoundary(props: BoundaryProps) {
  const boundary = new SurfaceErrorBoundary(props)
  const setState = vi.fn((next: { message: string | undefined }) => {
    boundary.state = { ...boundary.state, ...next }
  })
  boundary.setState = setState as unknown as typeof boundary.setState
  return { boundary, setState }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('describeSurfaceError', () => {
  it('prefers the error message', () => {
    expect(describeSurfaceError(new Error('boom'))).toBe('boom')
  })

  it('falls back to the error name for a blank message', () => {
    expect(describeSurfaceError(new TypeError(''))).toBe('TypeError')
  })

  it('describes non-error throws without inventing text', () => {
    expect(describeSurfaceError('nope')).toBe('nope')
    expect(describeSurfaceError({ code: 'E_FAIL' })).toBe('[object Object]')
  })

  it('never returns an empty description', () => {
    expect(describeSurfaceError(undefined)).toBe('undefined')
    expect(describeSurfaceError(new Error('   '))).toBe('Error')
  })
})

describe('SurfaceErrorBoundary error lifecycle', () => {
  it('captures the failure message as soon as a child throws', () => {
    expect(SurfaceErrorBoundary.getDerivedStateFromError(new Error('renderer exploded'))).toEqual({ message: 'renderer exploded' })
  })

  it('reports once with the surface label and survives a throwing notifier', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onError = vi.fn()
    const { boundary } = createBoundary({ label: 'Chat', onError, children: null })
    boundary.componentDidCatch(new Error('boom'), { componentStack: '' })
    expect(onError).toHaveBeenCalledWith('Chat pane crashed: boom')

    const throwing = vi.fn(() => { throw new Error('toast transport down') })
    const second = createBoundary({ label: 'Browser', onError: throwing, children: null })
    expect(() => second.boundary.componentDidCatch(new Error('boom'), { componentStack: '' })).not.toThrow()
  })

  it('never throws from a malformed error info', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { boundary } = createBoundary({ label: 'QA', children: null })
    expect(() => boundary.componentDidCatch('plain string failure', undefined as unknown as React.ErrorInfo)).not.toThrow()
  })

  it('retries the same surface from the fallback button', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { boundary, setState } = createBoundary({ label: 'Chat', children: null })
    boundary.state = { message: 'boom' }
    boundary.componentDidUpdate({ label: 'Chat', children: null })
    expect(setState).not.toHaveBeenCalled()

    // The fallback's retry is the only recovery path when the reset key is stable.
    ;(boundary as unknown as { retry(): void }).retry()
    expect(setState).toHaveBeenCalledWith({ message: undefined })
    expect(boundary.state.message).toBeUndefined()
  })

  it('recovers automatically when the reset key changes while crashed', () => {
    const { boundary, setState } = createBoundary({ label: 'Company', resetKey: 'company-b', children: null })
    boundary.state = { message: 'boom' }
    boundary.componentDidUpdate({ label: 'Company', resetKey: 'company-b', children: null })
    expect(setState).not.toHaveBeenCalled()

    boundary.componentDidUpdate({ label: 'Company', resetKey: 'company-a', children: null })
    expect(setState).toHaveBeenCalledWith({ message: undefined })
    expect(boundary.state.message).toBeUndefined()
  })

  it('leaves a healthy surface untouched when the reset key changes', () => {
    const { boundary, setState } = createBoundary({ label: 'Files', resetKey: 'a', children: null })
    boundary.componentDidUpdate({ label: 'Files', resetKey: 'b', children: null })
    expect(setState).not.toHaveBeenCalled()
  })
})
