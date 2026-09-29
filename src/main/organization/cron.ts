const MINUTE_MS = 60_000
const MAX_SCAN_MINUTES = 366 * 24 * 60

export function nextCronAt(expression: string, timezone: string | undefined, fromMs: number): number {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error('Cron must contain 5 fields: minute hour day-of-month month day-of-week')
  const [minute, hour, dom, month, dow] = fields.map((field, index) => parseField(field!, limits[index]!))
  const zone = timezone?.trim() || 'UTC'
  validateTimezone(zone)
  let candidate = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS
  for (let i = 0; i < MAX_SCAN_MINUTES; i++, candidate += MINUTE_MS) {
    const parts = zonedParts(candidate, zone)
    const dayOfMonthMatch = dom.values.has(parts.day)
    const dayOfWeekMatch = dow.values.has(parts.weekday)
    const dayMatch = dom.wildcard || dow.wildcard
      ? dayOfMonthMatch && dayOfWeekMatch
      : dayOfMonthMatch || dayOfWeekMatch
    if (
      minute.values.has(parts.minute)
      && hour.values.has(parts.hour)
      && month.values.has(parts.month)
      && dayMatch
    ) return candidate
  }
  throw new Error('Cron expression has no occurrence within the next 366 days')
}

export function validateCron(expression: string, timezone?: string): void {
  void nextCronAt(expression, timezone, Date.now())
}

const limits = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6 },
] as const

function parseField(input: string, range: { min: number; max: number }): { values: Set<number>; wildcard: boolean } {
  const values = new Set<number>()
  const wildcard = input === '*'
  for (const part of input.split(',')) {
    const [base, stepRaw] = part.split('/')
    const step = stepRaw === undefined ? 1 : integer(stepRaw, 1, range.max - range.min + 1)
    if (base === '*') {
      for (let value = range.min; value <= range.max; value += step) values.add(value)
      continue
    }
    const [startRaw, endRaw] = base!.split('-')
    const start = integer(startRaw!, range.min, range.max)
    const end = endRaw === undefined ? start : integer(endRaw, range.min, range.max)
    if (end < start) throw new Error(`Invalid cron range: ${part}`)
    for (let value = start; value <= end; value += step) values.add(value)
  }
  if (!values.size) throw new Error(`Invalid cron field: ${input}`)
  return { values, wildcard }
}

function integer(value: string, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`Cron value ${value} must be between ${min} and ${max}`)
  return parsed
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0)
  } catch {
    throw new Error(`Invalid timezone: ${timezone}`)
  }
}

function zonedParts(timestamp: number, timezone: string): { minute: number; hour: number; day: number; month: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    minute: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    day: '2-digit',
    month: '2-digit',
    weekday: 'short',
  })
  const parts = Object.fromEntries(formatter.formatToParts(timestamp).map((item) => [item.type, item.value]))
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday ?? ''),
  }
}
