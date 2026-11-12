// HASHES AND COMPARISON: one SHA-256 per file of a run; two runs differ where a hash differs.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export const HASHES = 'hashes.txt'
export const COMMIT = 'commit.txt'
export const FULL = '.full.txt'

const files = dir => readdirSync(dir).flatMap(n => statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)])

/** Write hashes.txt: `<sha256>  <path>` for every file but itself, commit.txt, the .full.txt files and `unhashed`,
 *  sorted by path. */
export function writeHashes(out, unhashed = []) {
  const skip = new Set([HASHES, COMMIT, ...unhashed])
  const lines = files(out).map(f => relative(out, f).split(sep).join('/')).filter(f => !skip.has(f) && !f.endsWith(FULL)).sort()
    .map(f => `${createHash('sha256').update(readFileSync(join(out, f))).digest('hex')}  ${f}`)
  writeFileSync(join(out, HASHES), lines.join('\n') + '\n')
}

/** The files whose hashes differ between two runs: `{ file, how }`, `how` one of differs, only in a, only in b. */
export function compare(a, b) {
  const read = d => new Map(readFileSync(join(d, HASHES), 'utf8').trim().split('\n').filter(Boolean).map(l => [l.slice(66), l.slice(0, 64)]))
  const ha = read(a), hb = read(b)
  return [...new Set([...ha.keys(), ...hb.keys()])].sort().filter(f => ha.get(f) !== hb.get(f))
    .map(file => ({ file, how: ha.has(file) ? (hb.has(file) ? 'differs' : 'only in a') : 'only in b' }))
}
