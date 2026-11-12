// NEXT.JS HELPERS: post a server action as its page does, and read its answer.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** `file#export` → the action's id in this build (ids are per-build hashes), from the build's server manifest. */
export function nextActionIds(tree) {
  const m = JSON.parse(readFileSync(join(tree, '.next/server/server-reference-manifest.json'), 'utf8')).node
  return new Map(Object.entries(m).map(([id, v]) => [`${v.filename}#${v.exportedName}`, id]))
}

/**
 * A server action's answer from its response body (React's flight rows): the action's return value as JSON, each
 * `$@n` reference followed to its row. A response that holds no action answer is a page render, and says so.
 */
export function actionAnswer(text) {
  const rows = new Map()
  for (const line of text.split('\n')) {
    const m = line.match(/^([0-9a-f]+):(.*)$/)
    if (m) rows.set(m[1], m[2])
  }
  const parse = s => { try { return s === undefined ? undefined : JSON.parse(s) } catch { return undefined } }
  const follow = (v, depth = 0) => {
    if (depth > 20) return v
    if (typeof v === 'string' && /^\$@[0-9a-f]+$/.test(v)) return follow(parse(rows.get(v.slice(2))), depth + 1)
    if (Array.isArray(v)) return v.map(e => follow(e, depth + 1))
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, e]) => [k, follow(e, depth + 1)]))
    return v
  }
  const root = parse(rows.get('0'))
  if (!root || typeof root !== 'object' || !('a' in root)) return '(no action answer: the response is a page render)'
  // A `$@n` the response holds no row for follows to undefined, which JSON.stringify answers with undefined, not text.
  return JSON.stringify(follow(root.a), null, 1) ?? '(the answer refers to a row the response does not hold)'
}

const encoders = new Map()
/** The tree's own reply encoder: an action's arguments are encoded by the React the tree was built with. */
function encoderOf(tree) {
  if (!encoders.has(tree)) encoders.set(tree, createRequire(join(tree, 'package.json'))('next/dist/compiled/react-server-dom-webpack/client.edge'))
  return encoders.get(tree)
}

/**
 * Post a server action as its page does. Returns `{ status, redirect, answer }`, or `{ error }` (the first line of a
 * request that threw). `path` is the page's filled path the action is posted to; `id` the build's action id.
 * @param {{ tree: string, context: import('playwright-core').BrowserContext, baseUrl: string, path: string, id: string, args: unknown[] }} o
 */
export async function postServerAction({ tree, context, baseUrl, path, id, args }) {
  const body = await encoderOf(tree).encodeReply(args)
  const headers = { 'next-action': id, accept: 'text/x-component' }
  const common = { maxRedirects: 0, timeout: 120000, failOnStatusCode: false }
  const r = await (typeof body === 'string'
    ? context.request.post(baseUrl + path, { ...common, headers: { ...headers, 'content-type': 'text/plain;charset=UTF-8' }, data: body })
    : context.request.post(baseUrl + path, { ...common, headers, multipart: body })).catch(e => e)
  if (r instanceof Error) return { error: r.message.split('\n')[0] }
  return { status: r.status(), redirect: r.headers()['x-action-redirect'] ?? r.headers()['location'] ?? 'none', answer: actionAnswer(await r.text()) }
}
