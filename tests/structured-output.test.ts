import { describe, expect, it } from 'vitest'
import { splitAssistantSegments } from '../src/shared/structured-output.js'

const REVIEW_JSON = JSON.stringify({
  verdict: 'pass',
  summary: 'All acceptance criteria verified.',
  issues: [],
  memory: [{ title: 'Lesson', content: 'Detail', tags: ['review'] }],
})

describe('splitAssistantSegments', () => {
  it('returns one text segment for plain prose', () => {
    expect(splitAssistantSegments('Hello world')).toEqual([{ kind: 'text', text: 'Hello world' }])
  })

  it('extracts a valid review block into a review segment', () => {
    const segments = splitAssistantSegments(`<nd-dsh-review>${REVIEW_JSON}</nd-dsh-review>`)
    expect(segments).toEqual([{ kind: 'review', review: JSON.parse(REVIEW_JSON) }])
  })

  it('keeps surrounding prose alongside the review card', () => {
    const segments = splitAssistantSegments(`Review done.\n<nd-dsh-review>${REVIEW_JSON}</nd-dsh-review>\nThanks.`)
    expect(segments).toHaveLength(3)
    expect(segments[0]).toEqual({ kind: 'text', text: 'Review done.' })
    expect(segments[1]?.kind).toBe('review')
    expect(segments[2]).toEqual({ kind: 'text', text: 'Thanks.' })
  })

  it('parses review bodies wrapped in a fenced code block', () => {
    const segments = splitAssistantSegments(`<nd-dsh-review>\`\`\`json\n${REVIEW_JSON}\n\`\`\`</nd-dsh-review>`)
    expect(segments).toEqual([{ kind: 'review', review: JSON.parse(REVIEW_JSON) }])
  })

  it('falls back to plain text for malformed review JSON', () => {
    const segments = splitAssistantSegments('<nd-dsh-review>{"verdict":</nd-dsh-review>')
    expect(segments).toEqual([{ kind: 'text', text: '{"verdict":' }])
  })

  it('falls back to plain text when streaming has not closed the tag yet', () => {
    const partial = `Working on it… <nd-dsh-review>${REVIEW_JSON}`
    expect(splitAssistantSegments(partial)).toEqual([{ kind: 'text', text: partial }])
  })

  it('falls back to plain text for a review missing a verdict', () => {
    const bad = JSON.stringify({ summary: 'No verdict here.' })
    const segments = splitAssistantSegments(`<nd-dsh-review>${bad}</nd-dsh-review>`)
    expect(segments).toEqual([{ kind: 'text', text: bad }])
  })

  it('extracts a valid plan block into a plan segment', () => {
    const plan = {
      goal: { title: 'Ship beta', description: 'Accept the beta.' },
      milestones: [{ title: 'M1', description: 'First', tasks: [{ title: 'T1', description: 'Do it' }] }],
    }
    const segments = splitAssistantSegments(`<nd-dsh-plan>${JSON.stringify(plan)}</nd-dsh-plan>`)
    expect(segments).toEqual([{ kind: 'plan', plan }])
  })

  it('handles multiple blocks in one message', () => {
    const text = `<nd-dsh-review>${REVIEW_JSON}</nd-dsh-review>mid<nd-dsh-review>${REVIEW_JSON}</nd-dsh-review>`
    const segments = splitAssistantSegments(text)
    expect(segments).toHaveLength(3)
    expect(segments[0]?.kind).toBe('review')
    expect(segments[1]).toEqual({ kind: 'text', text: 'mid' })
    expect(segments[2]?.kind).toBe('review')
  })
})
