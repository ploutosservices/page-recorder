import type { Browser, BrowserContext, BrowserContextOptions } from 'playwright-core'
import type { Client } from 'pg'

// ── the configuration ──

/** One kind of user. Any other field is carried to the project's own hooks and into the header's facts. */
export type Audience = {
  name: string
  /** A signed-in context, or a string saying why it could not sign in. Called before each pass the audience takes:
   *  the visits, the acts (when there are acts and `actOrder` names it), the visits after. */
  signIn(x: {
    browser: Browser
    newContext: (opts?: BrowserContextOptions) => Promise<BrowserContext>
    baseUrl: string
    db: Client
    label: (l: string) => Promise<void>
    phase: 'visits' | 'acts' | 'after'
  }): Promise<BrowserContext | string>
  [field: string]: unknown
}

export type Fill = { path: string; other?: boolean } | { not: string }

export type Page = {
  address: string
  fill(x: { audience: Audience | { name: 'none' }; db: Client }): Promise<Fill>
}

export type Notes = {
  notExercised(s: string): void
  borrowed(s: string): void
  keptByText(s: string): void
}

export type Act = {
  /** The file's name under acts/<audience>/; it must end in .txt. */
  name: string
  /** What `shape` and the notes name the act by. */
  key: string
  /** The address the act is posted to. */
  address: string
  press(x: {
    context: BrowserContext
    baseUrl: string
    audience: Audience | { name: 'none' }
    db: Client
    label: (l: string) => Promise<void>
    /** Opens the act's own label (`act <audience> <key>`). Call it once the act will act, after its own skip checks
     *  and before its first write: its rows are the writes under that label, read after the audience's last act. */
    begin: () => Promise<void>
    note: Notes
  }): Promise<{ head: string[]; answer: string } | { not: true }>
}

export type RunFacts = {
  audiences: (Record<string, unknown> & { name: string; signedIn: boolean; why?: string })[]
  notExercised: string[]
  borrowed: string[]
  keptByText: string[]
  /** The pages' and acts' addresses compared by their shape, sorted. */
  shaped: string[]
  stamp?: string
  commit: string
}

export type RecorderConfig = {
  database: {
    /** The new instance's connection string. */
    fresh(): Promise<string> | string
    /** The tree's migrations. */
    prepare?(url: string): Promise<void> | void
    /** Writes made here are captured in no file: test users, grants, fixed timestamps. */
    setup?(db: Client): Promise<void> | void
    /** Names the copy the instance was made from, for the header. */
    stamp?(): Promise<string> | string
  }
  capture?: {
    schema?: string
    /** An SQL condition on rec_rows (tbl, op, old, new) leaving a write out of every file. */
    ignore?: string
  }
  app: {
    /** Starts the application on the instance. Logs go to `<logBase>.<name>.log`, beside the run, never inside it. */
    start(x: { databaseUrl: string; logBase: string }): Promise<{ baseUrl: string; stop(): Promise<void> | void }>
    commit(): Promise<string> | string
  }
  teardown?(): Promise<void> | void
  browser?: { engine?: 'firefox' | 'chromium' | 'webkit'; contextOptions?: BrowserContextOptions }
  audiences: Audience[]
  pages: Page[]
  acts?: Act[]
  /** Default: none, then the audiences as listed. */
  actOrder?: string[]
  /** A page or act written by its shape (tables and operations) instead of its values: one that shows a third party's live data. */
  shape?(address: string, key?: string): boolean
  mask?: {
    /** Strings to replace wherever they stand, matched without case. */
    strings?(): Promise<{ value: string; as: string }[]> | { value: string; as: string }[]
    /** Columns holding keys minted at random: every value held during the run or at its end becomes <minted>, wherever
     *  it stands as a whole token (not inside a longer run of letters, digits, `_` and `-`). */
    minted?: { table: string; column: string }[]
    /** The project's own rules, applied in order after the timestamps. */
    text?: [RegExp, string | ((...m: string[]) => string)][]
  }
  clock?: { zones?: string[]; locale?: string }
  /** `headWord`: the first word of a visit's head line (default `page`). */
  visit?: { loadingPattern?: RegExp; headWord?: string }
  /** Check for pdftotext at start. */
  pdf?: boolean
  header(run: RunFacts): Promise<string> | string
  /** Files written into the run unhashed, by name. */
  extraFiles?(run: RunFacts): Promise<Record<string, string>> | Record<string, string>
}

// ── the library ──

export function record(o: { config: RecorderConfig; out: string }): Promise<{ files: number }>
export function compare(a: string, b: string): { file: string; how: 'differs' | 'only in a' | 'only in b' }[]
export function writeHashes(out: string, unhashed?: string[]): void
export const HASHES: string
export const COMMIT: string
export const FULL: string

export function mask(text: string, run: {
  since: Date
  until?: Date
  strings?: { value: string; as: string }[]
  minted?: Set<string>
  inserted?: Set<string>
  text?: [RegExp, string | ((...m: string[]) => string)][]
  zones?: string[]
  locale?: string
}): string
export function maskDurations(answer: string): string

export function captureSql(schema?: string): string
export function installCapture(db: Client, schema?: string): Promise<void>
export function setLabel(db: Client, label: string, schema?: string): Promise<void>
export function rowsOf(db: Client, label: string, ignore?: string, schema?: string): Promise<string>
export function shapeOf(db: Client, label: string, ignore?: string, schema?: string): Promise<string>
export function insertedIds(db: Client, schema?: string): Promise<Set<string>>
export function columnValues(db: Client, columns: { table: string; column: string }[], schema?: string): Promise<Set<string>>

export function freshFromTemplate(o: { template: string; instance: string; owner: string; asAdmin: (args: string[]) => string }): void
export function templateComment(o: { template: string; asAdmin: (args: string[]) => string }): string

export function answerText(buf: Buffer, type: string, opts?: { onPdf?: () => void }): string
export function pdfText(buf: Buffer): string
export function needPdftotext(): void

export function nextActionIds(tree: string): Map<string, string>
export function actionAnswer(text: string): string
export function postServerAction(o: {
  tree: string
  context: BrowserContext
  baseUrl: string
  path: string
  id: string
  args: unknown[]
}): Promise<{ status: number; redirect: string; answer: string } | { error: string }>
