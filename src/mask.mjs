// MASKING: what changes from run to run anyway, replaced before a file is hashed, so two runs of the same code on the
// same database hash the same. The order is fixed: each step sees the text the step before it left.

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A duration in an act's answer ("6.6s", "250 ms"); never applied to a page's text. */
export const maskDurations = answer => answer.replace(/(?<![\w.])\d+(?:\.\d+)?\s?m?s\b/g, '<duration>')

/**
 * @param {string} text
 * @param {{
 *   since: Date, until?: Date,
 *   strings?: { value: string, as: string }[],
 *   minted?: Set<string>,
 *   inserted?: Set<string>,
 *   text?: [RegExp, string | ((...m: string[]) => string)][],
 *   zones?: string[],
 *   locale?: string,
 * }} run
 */
export function mask(text, { since, until = new Date(), strings = [], minted = new Set(), inserted = new Set(), text: rules = [], zones = ['UTC'], locale = 'en-US' }) {
  let out = text
  // 1. Strings the run was given (a sender address, say), matched without case.
  for (const { value, as } of strings) out = out.replace(new RegExp(escape(value), 'gi'), as)
  // 2. A minted key, wherever it stands as a whole token: not inside a longer run of letters, digits, _ and -.
  for (const key of [...minted].filter(Boolean).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(?<![A-Za-z0-9_-])${escape(key)}(?![A-Za-z0-9_-])`, 'g'), '<minted>')
  }
  // 3. An id the run inserted, numbered per file by first appearance.
  const seen = new Map()
  out = out.replace(UUID, id => inserted.has(id) ? (seen.get(id) ?? (seen.set(id, `<new-${seen.size + 1}>`), seen.get(id))) : id)
  // 4. A timestamp from one minute before the run's start onward. A zone written `Z`, `+00`, `+0000`, `+00:00` or
  //    ` UTC`; none means UTC. `+00` alone is not a form Date reads.
  const from = +since - 60000
  out = out.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(\s?UTC|[+-]\d{2}(:?\d{2})?|Z)?/g, s => {
    const t = s.replace(/\s?UTC$/, 'Z').replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
    const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(t) ? t : t + 'Z')
    return !isNaN(+d) && +d >= from ? '<now>' : s
  })
  // 5. The project's own rules, in order.
  for (const [pattern, replacement] of rules) out = out.replace(pattern, replacement)
  // 6. Every date the run spans, not only the one it ends on (a run crossing midnight in a zone prints both days).
  const days = []
  for (let t = from; t < +until; t += 3600_000) days.push(new Date(t))
  days.push(until)
  for (const tz of zones) {
    for (const day of days) {
      const parts = o => new Intl.DateTimeFormat(locale, { ...o, timeZone: tz }).format(day)
      const iso = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(day)
      for (const s of [iso, parts({ dateStyle: 'long' }), parts({ dateStyle: 'medium' }), parts({ dateStyle: 'short' }),
        parts({ month: 'numeric', day: 'numeric', year: 'numeric' })]) out = out.split(s).join('<today>')
    }
  }
  // 7. A time of day on the run's date is the run's time.
  out = out.replace(/<today>,? \d{1,2}:\d{2}(:\d{2})?\s?[AP]M/g, '<now>')
  // 8. A time of day printed alone is the run's when it falls inside the run's window in a zone the run prints; never
  //    one printed with its own date, and never one end of a range (a timetable, not the clock).
  out = out.replace(/(?<!\d{4},? (?:at )?)(?<!\d{4}-\d{2}-\d{2}[ T])(?<![\d:])(?<!–\s?)(\d{1,2}):(\d{2})(?::\d{2})?\s?([AP])M\b(?!\s?–)/g, (s, h, m, ap) => {
    const minutes = (Number(h) % 12 + (ap === 'P' ? 12 : 0)) * 60 + Number(m)
    return zones.some(tz => {
      const at = d => { const [hh, mm] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).split(':').map(Number); return hh * 60 + mm }
      const a = at(new Date(from)), b = at(until)
      return a <= b ? minutes >= a && minutes <= b : minutes >= a || minutes <= b
    }) ? '<now>' : s
  })
  return out
}
