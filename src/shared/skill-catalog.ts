export interface SkillSuggestion {
  name: string
  description: string
  whenToUse?: string
  displayName?: string
  source?: string
  selectionId?: string
}

/** Accept only real, well-formed catalog entries; never synthesize bundled skills. */
export function parseSkillCatalog(value: unknown): SkillSuggestion[] {
  const skills = value && typeof value === 'object' ? (value as { skills?: unknown }).skills : undefined
  if (!Array.isArray(skills)) throw new Error('skill.list returned no catalog')
  const seen = new Set<string>()
  return skills.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return []
    const skill = entry as Record<string, unknown>
    if (typeof skill.name !== 'string' || !skill.name.trim() || /\s/.test(skill.name) || skill.name.startsWith('/') || seen.has(skill.name)) return []
    seen.add(skill.name)
    return [{ name: skill.name, description: typeof skill.description === 'string' ? skill.description : '',
      ...Object.fromEntries(['displayName', 'source', 'selectionId'].flatMap((key) => typeof skill[key] === 'string' ? [[key, skill[key]]] : [])),
      ...(typeof skill.whenToUse === 'string' && skill.whenToUse ? { whenToUse: skill.whenToUse } : {}) }]
  })
}

/** A selection belongs to the project/engine/session that produced its picker. */
export function skillSelectionScope(selection: { owner: string; scope: string } | null, owner: string): string | undefined {
  if (selection && selection.owner !== owner) throw new Error('Skill project or session changed. Select the skill again.')
  return selection?.scope
}

/** Skills are leading-only. Preserve existing prose when opening the picker. */
export function openSkillPicker(prompt: string): { value: string; caret: number } {
  if (prompt.startsWith('/')) {
    const end = prompt.search(/\s/)
    return { value: prompt, caret: end < 0 ? prompt.length : end }
  }
  return { value: prompt ? `/ ${prompt}` : '/', caret: 1 }
}
