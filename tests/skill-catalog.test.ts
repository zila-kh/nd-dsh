import { describe, expect, it } from 'vitest'
import { openSkillPicker, parseSkillCatalog, skillSelectionScope } from '../src/shared/skill-catalog.js'
import { applyMention, detectMentionTrigger } from '../src/shared/mentions.js'

describe('real skill catalog', () => {
  it('rejects stale picker selections across project, engine, and session changes', () => {
    const owner = JSON.stringify(['project', 'codex-cli', null])
    const selection = { owner, scope: 'trusted scope' }
    expect(skillSelectionScope(selection, owner)).toBe('trusted scope')
    expect(skillSelectionScope(null, owner)).toBeUndefined()
    for (const next of [['other', 'codex-cli', null], ['project', 'zcode-cli', null], ['project', 'codex-cli', 'session']]) {
      expect(() => skillSelectionScope(selection, JSON.stringify(next))).toThrow('changed')
    }
  })
  it('keeps live-browser only when returned by the runtime', () => {
    expect(parseSkillCatalog({ skills: [] })).toEqual([])
    expect(parseSkillCatalog({ skills: [{ name: 'live-browser', description: 'Visible browser' }] })).toEqual([{ name: 'live-browser', description: 'Visible browser' }])
  })
  it('rejects absent catalogs and filters malformed and duplicate entries', () => {
    expect(() => parseSkillCatalog({})).toThrow('no catalog')
    expect(parseSkillCatalog({ skills: [null, {}, { name: 'bad name' }, { name: '/bad' }, { name: 'real' }, { name: 'real' }] })).toEqual([{ name: 'real', description: '' }])
  })
  it('opens a leading slash without losing prose', () => {
    const opened = openSkillPicker('inspect this page')
    const trigger = detectMentionTrigger(opened.value, opened.caret)!
    expect(trigger.kind).toBe('skill')
    expect(applyMention(opened.value, trigger, '/live-browser').value).toContain('inspect this page')
    expect(openSkillPicker('/live inspect')).toEqual({ value: '/live inspect', caret: 5 })
    expect(openSkillPicker('')).toEqual({ value: '/', caret: 1 })
  })
})
