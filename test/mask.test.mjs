import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mask, maskDurations } from '../src/mask.mjs'

const since = new Date('2030-03-04T15:00:00Z')
const until = new Date('2030-03-04T15:40:00Z')
const run = extra => ({ since, until, zones: ['UTC'], ...extra })

test('ids the run inserted are numbered per file by first appearance; others are kept', () => {
  const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222'
  const kept = '33333333-3333-4333-8333-333333333333'
  const out = mask(`${b} ${a} ${b} ${kept}`, run({ inserted: new Set([a, b]) }))
  assert.equal(out, `<new-1> <new-2> <new-1> ${kept}`)
})

test('a timestamp from a minute before the start onward is <now>, with no upper bound; an older one is kept', () => {
  assert.equal(mask('at 2030-03-04T14:59:30Z', run()), 'at <now>')
  assert.equal(mask('due 2030-04-01 09:00:00+00', run()), 'due <now>')          // a future time the run wrote
  assert.equal(mask('was 2030-03-03 14:58 UTC', run()), 'was 2030-03-03 14:58 UTC')
  assert.equal(mask('was 2030-03-04 14:58 UTC', run()), 'was <today> 14:58 UTC')     // the run's own date, as a date
})

test('strings without case, minted keys as whole tokens, then the project rules, in that order', () => {
  const key = 'minted-key-for-the-test-00000000'
  const out = mask(`From Sender@Example.test key=${key} x${key} {"token":"abc"}`, run({
    strings: [{ value: 'sender@example.test', as: '<sender>' }],
    minted: new Set([key]),
    text: [[/("token"\s*:\s*")[^"]+"/g, '$1<token>"']],
  }))
  assert.equal(out, `From <sender> key=<minted> x${key} {"token":"<token>"}`)
  assert.equal(mask('k=a+b/c== z', run({ minted: new Set(['a+b/c==']) })), 'k=<minted> z')   // any characters
  assert.equal(mask('a, b. (c)', run({ minted: new Set(['']) })), 'a, b. (c)')                // an empty key is no key
})

test('the run\'s dates in every form, a time on that date, and a lone time inside the window; never a range', () => {
  assert.equal(mask('2030-03-04 · March 4, 2030 · Mar 4, 2030 · 3/4/30 · 3/4/2030', run()), '<today> · <today> · <today> · <today> · <today>')
  assert.equal(mask('rendered March 4, 2030, 3:20:05 PM', run()), 'rendered <now>')
  assert.equal(mask('read 3:15 PM', run()), 'read <now>')
  assert.equal(mask('read 4:15 PM', run()), 'read 4:15 PM')
  assert.equal(mask('meeting 3:00 PM – 3:30 PM', run()), 'meeting 3:00 PM – 3:30 PM')
  assert.equal(mask('Oct 3, 2029 at 3:20 PM', run()), 'Oct 3, 2029 at 3:20 PM')
})

test('a second zone adds its own dates and hours', () => {
  const ny = run({ zones: ['UTC', 'America/New_York'] })
  assert.equal(mask('read 10:15 AM', ny), 'read <now>')          // 15:15 UTC is 10:15 in New York
  assert.equal(mask('read 10:15 AM', run()), 'read 10:15 AM')
})

test('durations in an answer', () => {
  assert.equal(maskDurations('took 6.6s and 250 ms, v1.5s stays'), 'took <duration> and <duration>, v1.5s stays')
})
