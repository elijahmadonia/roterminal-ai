#!/usr/bin/env node
// roterminal: live data on every Roblox game, in your terminal and your AI
// agent (server/agent.ts serves it as /roterminal.tgz, so `npx` runs it).
// One file, no dependencies, Node 18 and up.
//
// For people it draws: the number, a line of the week, what to run next.
// For agents (Claude Code, Codex, Cursor… or --json) it answers in JSON,
// the way Vercel's CLI does: { status, data, link, next }, where status is
// ok, error or action_required (a person has to do something first).

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, rmSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const VERSION = '0.1.1'
const API = (process.env.ROTERMINAL_API || 'https://roterminal.co').replace(/\/$/, '')
const SITE = 'roterminal.co'
const env = process.env

// ---------- who's running it ----------

const AGENT = env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT ? 'claude-code' : env.CURSOR_AGENT ? 'cursor' : env.CODEX_SANDBOX || env.CODEX_SANDBOX_NETWORK_DISABLED ? 'codex' : env.GEMINI_CLI ? 'gemini' : env.OPENCODE ? 'opencode' : env.AI_AGENT ? 'agent' : null
const AGENT_NAME = { 'claude-code': 'Claude Code', cursor: 'Cursor', codex: 'Codex', gemini: 'Gemini CLI', opencode: 'OpenCode', agent: 'An AI agent' }

// ---------- arguments ----------

const argv = process.argv.slice(2)
const flags = {}
const words = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--') {
    words.push(...argv.slice(i + 1))
    break
  }
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split(/=(.*)/s)
    const key = k.replace(/-/g, '_')
    if (v !== undefined) flags[key] = v
    else if (['json', 'pretty', 'no_color', 'week', 'global', 'help', 'version', 'with_key', 'yes'].includes(key)) flags[key] = true
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[key] = argv[++i]
    else flags[key] = true
  } else if (a === '-h') flags.help = true
  else if (a === '-v') flags.version = true
  else if (a === '-w') flags.week = true
  else words.push(a)
}
const JSON_OUT = Boolean(flags.json || (AGENT && !flags.pretty))
const TTY = Boolean(process.stdout.isTTY)
const COLOR = TTY && !JSON_OUT && !flags.no_color && !env.NO_COLOR && env.TERM !== 'dumb'

// ---------- looks ----------

const paint = (code) => (s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s))
const c = { bold: paint('1'), dim: paint('2'), green: paint('32'), red: paint('31'), cyan: paint('36'), yellow: paint('33'), gray: paint('90'), blue: paint('34') }
const n = (x) => (x == null ? '' : Number(x).toLocaleString('en-US'))
const short = (x) => {
  if (x == null) return ''
  const v = Number(x)
  if (v >= 1e9) return `${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1).replace(/\.0$/, '')}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`
  if (v >= 1e4) return `${Math.round(v / 1e3)}K`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  return String(Math.round(v))
}
// "+12%" green, "-3%" red.
const change = (s) => (!s ? '' : String(s).startsWith('-') || String(s).startsWith('−') ? c.red(s) : c.green(s))
const BARS = '▁▂▃▄▅▆▇█'
function spark(vals, width = 42) {
  if (!Array.isArray(vals) || vals.length < 2) return ''
  let v = vals
  if (v.length > width) v = Array.from({ length: width }, (_, k) => vals[Math.floor((k * vals.length) / width)])
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  const line = v.map((x) => BARS[hi === lo ? 3 : Math.min(7, Math.floor(((x - lo) / (hi - lo)) * 7.999))]).join('')
  return v.at(-1) >= v[0] ? c.green(line) : c.red(line)
}
// How wide a name is on screen (emoji take two).
const wid = (s) => [...String(s)].reduce((w, ch) => {
  const p = ch.codePointAt(0)
  return w + (p === 0xfe0f || (p >= 0x300 && p < 0x370) ? 0 : p >= 0x1f000 || (p >= 0x2600 && p <= 0x27bf) || (p >= 0x3000 && p <= 0x9fff) ? 2 : 1)
}, 0)
function fit(s, w) {
  s = String(s ?? '')
  if (wid(s) <= w) return s + ' '.repeat(w - wid(s))
  let out = ''
  for (const ch of s) {
    if (wid(out + ch) > w - 1) break
    out += ch
  }
  return out + '…' + ' '.repeat(Math.max(0, w - wid(out) - 1))
}
const pad = (s, w) => ' '.repeat(Math.max(0, w - wid(s))) + s
const link = (url) => {
  const shown = String(url).replace(/^https?:\/\//, '')
  return COLOR && env.TERM_PROGRAM !== 'Apple_Terminal' ? `\x1b]8;;${url}\x07${c.cyan(shown)}\x1b]8;;\x07` : c.cyan(shown)
}
const out = (s = '') => process.stdout.write(s + '\n')

// ---------- the key ----------

const DIR = join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'roterminal')
const AUTH = join(DIR, 'auth.json')
const PENDING = join(DIR, 'pending.json')
const readJSON = (f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}
const saveJSON = (f, v) => {
  mkdirSync(DIR, { recursive: true, mode: 0o700 })
  writeFileSync(f, JSON.stringify(v, null, 2), { mode: 0o600 })
}
const token = () => env.ROTERMINAL_TOKEN || readJSON(AUTH)?.token || null

// ---------- asking RoTerminal ----------

async function call(path, body, method = 'POST') {
  const t = token()
  try {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'user-agent': `roterminal/${VERSION} node/${process.versions.node}`, 'x-roterminal-agent': AGENT ? `cli/${AGENT}` : 'cli', ...(t ? { authorization: `Bearer ${t}` } : {}) },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      signal: AbortSignal.timeout(25_000),
    })
    const txt = await r.text()
    try {
      return JSON.parse(txt)
    } catch {
      return { status: 'error', reason: 'api_error', message: `RoTerminal answered ${r.status}. Try again in a moment.`, retryable: true }
    }
  } catch (e) {
    return { status: 'error', reason: 'network', message: `Can’t reach ${SITE}. Check your connection and try again.`, retryable: true }
  }
}
const tool = (name, input) => call(`/api/agent/${name}`, input)

// ---------- printing a reply ----------

function finish(r, draw) {
  if (JSON_OUT) {
    out(JSON.stringify(r, null, 2))
    process.exitCode = r.status === 'ok' ? 0 : 1
    return
  }
  out()
  if (r.status === 'ok') draw(r.data ?? {}, r)
  else trouble(r)
  if (r.status === 'ok') foot(r)
  out()
  process.exitCode = r.status === 'ok' ? 0 : 1
}

function trouble(r) {
  const head = r.status === 'action_required' ? c.yellow('●') : c.red('●')
  out(`  ${head} ${r.message ?? 'Something went wrong.'}`)
  if (r.verification_uri && r.reason !== 'login_required') out(`    ${link(r.verification_uri)}`)
  for (const x of (r.next ?? []).slice(0, 2)) out(`    ${c.dim('Run')} ${c.bold(x.command)}`)
}

function foot(r) {
  if (r.locked) out(`\n  ${c.yellow('◆')} ${r.locked.message} ${c.dim('→')} ${link(r.locked.upgrade)}`)
  if (r.link) out(`\n  ${c.dim('→')} ${link(r.link)}`)
  const nx = (r.next ?? []).slice(0, 2)
  if (nx.length) {
    out()
    nx.forEach((x, k) => out(`  ${c.dim(k ? '    ' : 'Next')}  ${x.command}`))
  }
  const u = r.usage
  if (u?.limit && u.plan === 'No account' && u.used >= u.limit * 0.6) out(`\n  ${c.dim(`${u.limit - u.used} of ${u.limit} free calls left today. Sign in (free) for more:`)} roterminal login`)
}

// A list of games, one line each.
function rows(list, o = {}) {
  if (!list?.length) return out(`  ${c.dim('Nothing here right now.')}`)
  const nameW = Math.min(30, Math.max(12, ...list.map((g) => wid(g.name ?? ''))))
  for (const [k, g] of list.entries()) {
    const place = c.dim(pad(String(g.place ?? k + 1), 3))
    const ch = o.change ? o.change(g) : g.change_24h ?? g.change ?? ''
    const line = g.spark ? spark(g.spark, 12) : ''
    out(`  ${place}  ${fit(g.name, nameW)}  ${pad(n(g.playing_now), 10)}  ${pad(change(ch), COLOR ? 16 : 7)}  ${line}${line ? '  ' : ''}${c.dim(o.extra ? o.extra(g) : g.genre ?? '')}`)
  }
}

// ---------- the views ----------

function drawGame(d) {
  const top = [d.developer, d.genre, d.came_out ? `out ${d.came_out}` : null].filter(Boolean).join(c.dim(' · '))
  out(`  ${c.bold(d.name)}`)
  if (top) out(`  ${c.dim(top)}`)
  out()
  const place = d.place_on_roblox_by_players ? `${String(d.place_on_roblox_by_players).replace(/ of .*/, '')} on Roblox` : ''
  out(`  ${c.green('●')} ${c.bold(n(d.playing_now))} playing   ${d.change_24h ? `${change(d.change_24h)} ${c.dim('on a day ago')}   ` : ''}${c.dim(place)}`)
  if (d.spark_7d) {
    const hi = d.high_last_14_days?.players ?? Math.max(...d.spark_7d)
    out(`  ${spark(d.spark_7d)}  ${c.dim(`7 days · high ${short(hi)}`)}`)
  }
  out()
  const facts = []
  const m = d.momentum
  if (m) facts.push(['Momentum', m.average_last_7_days ? `${m.stage}: ${short(m.average_last_7_days)} on average this week, ${change(m.against_the_7_days_before)} on the week before` : `${m.stage}: ${change(m.last_24_hours_against_the_same_day_a_week_before)} on the same day last week`])
  if (d.genre_place) facts.push(['In its genre', d.genre_place])
  const up = (d.updates ?? [])[0]
  if (up) facts.push(['Last update', [up.at, up.title && up.title !== 'New version published' ? `“${up.title}”` : null, up.players_after_update ? `players ${change(up.players_after_update)} after` : null].filter(Boolean).join(c.dim(' · '))])
  const riv = (d.rivals_in_genre ?? []).slice(0, 3)
  if (riv.length) facts.push(['Rivals', riv.map((x) => `${x.name} ${c.dim(short(x.playing_now))}`).join(c.dim('  ·  '))])
  if (d.studio?.name) facts.push(['Made by', [d.studio.name, d.studio.verified ? c.blue('✓') : null, d.studio.games > 1 ? c.dim(`${d.studio.games} games`) : null].filter(Boolean).join(' ')])
  if (d.likes) facts.push(['Likes', `${d.likes}${d.visits ? c.dim(` · ${short(d.visits)} visits`) : ''}`])
  for (const [k, v] of facts) out(`  ${c.dim(fit(k, 13))} ${v}`)
  if (d.did_you_mean?.length) out(`\n  ${c.dim('Or did you mean')} ${d.did_you_mean.map((g) => g.name).join(c.dim(', '))}`)
}

function drawList(d) {
  if (d.list) out(`  ${c.bold(d.list)}${d.genre ? c.dim(` · ${d.genre}`) : ''}`)
  if (d.matched != null) out(`  ${c.bold(`${n(d.matched)} games match`)}${d.theme ? c.dim(` · about ${d.theme}`) : ''}`)
  if (d.query) out(`  ${c.bold(`Games matching “${d.query}”`)}`)
  out()
  const week = d.games?.[0]?.a_week_ago != null
  rows(d.games, { change: (g) => g.change ?? g.change_24h ?? '', extra: (g) => [g.genre, week ? null : g.came_out ? `out ${g.came_out}` : null].filter(Boolean).join(' · ') })
}

function drawTrends(d) {
  if (d.note && !d.trends) return out(`  ${d.note}`)
  out(`  ${c.bold('What developers are making')}  ${c.dim('new games a month, against the month before')}`)
  out()
  const w = Math.min(22, Math.max(8, ...d.trends.map((t) => wid(t.word))))
  for (const t of d.trends) {
    const ch = t.new_games_30_days_before ? `${t.new_games_last_30_days >= t.new_games_30_days_before ? '+' : '-'}${Math.round(Math.abs(t.new_games_last_30_days / t.new_games_30_days_before - 1) * 100)}%` : 'new'
    out(`  ${fit(t.word, w)}  ${pad(n(t.new_games_last_30_days), 6)} ${c.dim('new')}  ${pad(change(ch), COLOR ? 15 : 6)}  ${pad(short(t.playing_now), 6)} ${c.dim('playing')}  ${t.biggest_game ? c.dim(`biggest: ${t.biggest_game.name}`) : ''}`)
  }
}

function drawCompare(d) {
  const w = Math.min(28, Math.max(10, ...d.games.map((g) => wid(g.name))))
  for (const g of d.games) {
    out(`  ${c.bold(fit(g.name, w))}  ${pad(n(g.playing_now), 10)}  ${pad(change(g.change_24h ?? ''), COLOR ? 16 : 7)}  ${g.spark_7d ? spark(g.spark_7d, 24) : ''}`)
    const bits = [g.momentum?.stage, g.genre_place, g.latest_update?.players_after_update ? `last update ${g.latest_update.players_after_update}` : null].filter(Boolean)
    if (bits.length) out(`  ${' '.repeat(w)}  ${c.dim(bits.join(' · '))}`)
  }
  const lead = [...d.games].sort((a, b) => (b.playing_now ?? 0) - (a.playing_now ?? 0))
  if (lead.length > 1 && lead[1].playing_now) out(`\n  ${c.dim(`${lead[0].name} has ${(lead[0].playing_now / lead[1].playing_now).toFixed(1)}x the players of ${lead[1].name} right now.`)}`)
}

function drawStudio(d) {
  out(`  ${c.bold(d.name)}${d.verified ? ` ${c.blue('✓')}` : ''}  ${c.dim(d.kind ?? '')}`)
  const line = [d.owner ? `owned by ${d.owner}` : null, d.members ? `${short(d.members)} members` : null, d.place_among_developers ? `${d.place_among_developers} developers` : null].filter(Boolean)
  if (line.length) out(`  ${c.dim(line.join(' · '))}`)
  out(`\n  ${c.green('●')} ${c.bold(n(d.playing_their_games_now))} playing their ${d.games_in_all ?? ''} games${d.visits_in_all ? c.dim(` · ${short(d.visits_in_all)} visits`) : ''}`)
  out()
  rows(d.games, { extra: (g) => g.genre ?? '' })
}

function drawRoblox(d) {
  out(`  ${c.green('●')} ${c.bold(n(d.playing_now_on_all_of_roblox))} playing on Roblox right now`)
  const bits = [d.change_on_a_week_ago ? `${change(d.change_on_a_week_ago)} on this time last week` : null, d.high_last_24h ? `today’s high ${short(d.high_last_24h.players)}` : null].filter(Boolean)
  if (bits.length) out(`  ${c.dim(bits.join(c.dim(' · ')))}`)
  const days = (d.days ?? []).slice().reverse()
  if (days.length > 1) out(`  ${spark(days.map((x) => x.average))}  ${c.dim(`${days.length} days`)}`)
}

function drawGenres(d) {
  out(`  ${c.bold('Genres now')}`)
  out()
  const w = Math.min(26, Math.max(8, ...d.genres.map((g) => wid(g.name))))
  for (const g of d.genres) out(`  ${fit(g.name, w)}  ${pad(n(g.playing_now), 10)}  ${pad(g.share_of_players ?? '', 5)}  ${pad(change(g.change_24h ?? ''), COLOR ? 16 : 7)}  ${c.dim(g.biggest?.[0]?.name ?? '')}`)
}

function drawCharts(d) {
  if (d.charts) {
    out(`  ${c.bold('Roblox’s charts')}`)
    out()
    for (const x of d.charts) out(`  ${fit(x.id, 22)}  ${x.name}  ${c.dim(x.what_it_ranks ?? '')}`)
    return
  }
  out(`  ${c.bold(d.chart?.name ?? d.name ?? 'Chart')}`)
  out()
  rows(d.games, { change: () => '', extra: (g) => g.genre ?? '' })
}

function drawDays(d) {
  out(`  ${c.bold(d.name)}  ${c.dim('day by day, New York time')}`)
  out()
  const days = d.days ?? []
  if (days.length > 1) out(`  ${spark(days.slice().reverse().map((x) => x.average ?? 0))}\n`)
  for (const x of days) out(`  ${fit(x.day, 18)} ${pad(n(x.average), 10)} ${c.dim('avg')} ${pad(n(x.peak), 10)} ${c.dim('peak')}${x.partial ? c.dim('  (part of the day)') : ''}${x.what_happened ? `  ${c.yellow(x.what_happened)}` : ''}`)
}

function drawMe(d) {
  if (!d.games?.length) return out(`  ${d.note ?? 'No games yet.'}`)
  out(`  ${c.bold('Your games')}`)
  out()
  const w = Math.min(28, Math.max(10, ...d.games.map((g) => wid(g.name))))
  for (const g of d.games) {
    out(`  ${c.bold(fit(g.name, w))}  ${pad(n(g.playing_now), 10)}  ${g.change_on_usual ? `${change(g.change_on_usual)} ${c.dim('on usual')}` : ''}`)
    if (g.latest_update) out(`  ${' '.repeat(w)}  ${c.dim(`update ${g.latest_update.at}${g.latest_update.players_after ? ` · players ${g.latest_update.players_after} after` : ''}`)}`)
    for (const a of g.alerts_today ?? []) out(`  ${' '.repeat(w)}  ${c.yellow('●')} ${a.title} ${c.dim(a.at)}`)
  }
}

// ---------- the live ticker ----------

async function watch(game) {
  const first = await tool('live', { game })
  if (JSON_OUT || first.status !== 'ok') return finish(first, () => {})
  const d0 = first.data
  const start = Date.now()
  let last = d0.playing_now
  let hi = last
  let lo = last
  const seen = [last]
  let shown = last
  const draw = (v) => {
    const diff = v - d0.playing_now
    const since = new Date(start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const head = `  ${c.green('●')} ${c.bold(d0.name ?? 'Game')}  ${c.bold(n(Math.round(v)))} ${c.dim('playing')}${d0.place_on_roblox ? c.dim(`  #${d0.place_on_roblox} on Roblox`) : ''}`
    const tail = `  ${seen.length > 1 ? spark(seen, 40) : c.dim('▁')}  ${diff ? change(`${diff > 0 ? '+' : '-'}${n(Math.abs(Math.round(diff)))}`) : c.dim('±0')} ${c.dim(`since ${since}`)}`
    process.stdout.write(`\x1b[2K\r${head}\n\x1b[2K\r${tail}\x1b[1A\r`)
  }
  process.stdout.write('\x1b[?25l\n')
  draw(last)
  const stop = () => {
    const mins = Math.max(1, Math.round((Date.now() - start) / 60000))
    process.stdout.write(`\n\n\x1b[?25h\n  ${c.dim(`Watched ${mins} min · high ${n(hi)} · low ${n(lo)}`)}  ${link(`${API}/g/${d0.id}`)}\n\n`)
    process.exit(0)
  }
  process.on('SIGINT', stop)
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 15_000))
    const r = await tool('live', { game: d0.id })
    if (r.status !== 'ok') continue
    const v = r.data.playing_now
    hi = Math.max(hi, v)
    lo = Math.min(lo, v)
    seen.push(v)
    if (seen.length > 40) seen.shift()
    // The number rolls to its new value, like the site's.
    const from = shown
    for (let k = 1; k <= 12; k++) {
      await new Promise((ok) => setTimeout(ok, 40))
      shown = from + ((v - from) * k) / 12
      draw(shown)
    }
    last = v
  }
}

// ---------- signing in ----------

function open(url) {
  if (env.CI || env.SSH_CONNECTION) return false
  try {
    const cmd = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
    return true
  } catch {
    return false
  }
}

async function login() {
  let p = readJSON(PENDING)
  if (!p || p.until * 1000 < Date.now()) {
    const r = await call('/api/agent/login', { agent: AGENT ? AGENT_NAME[AGENT] : 'RoTerminal CLI', device: hostname().replace(/\.local$/, '').slice(0, 60) })
    if (!r.code) return finish(r, () => {})
    p = { key: r.key, code: r.code, until: r.until, url: r.verification_uri }
    saveJSON(PENDING, p)
    open(p.url)
  }
  const code = `${p.code.slice(0, 3)} ${p.code.slice(3)}`
  if (JSON_OUT) {
    // An agent can't wait on a person for ten minutes: it asks, then runs login again.
    const r = await waitFor(p, 60_000)
    if (r) return done(r)
    return out(JSON.stringify({ status: 'action_required', reason: 'login_required', message: `Ask the person to open ${p.url} and tap Connect (the code is ${code}). Then run \`roterminal login\` again.`, verification_uri: p.url, code, userActionRequired: true, retryable: true, next: [{ command: 'roterminal login', tool: 'login', input: {}, when: 'After they tap Connect' }] }, null, 2))
  }
  out()
  out(`  ${c.bold('Connect RoTerminal')}`)
  out()
  out(`  ${c.dim('Open')}   ${link(p.url)}`)
  out(`  ${c.dim('Code')}   ${c.bold(code)}`)
  out()
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let k = 0
  const spin = TTY ? setInterval(() => process.stdout.write(`\r  ${c.cyan(frames[k++ % frames.length])} ${c.dim('Waiting for you to tap Connect…')}`), 90) : null
  const r = await waitFor(p, p.until * 1000 - Date.now())
  if (spin) clearInterval(spin)
  if (TTY) process.stdout.write('\r\x1b[2K')
  if (!r) {
    rmSync(PENDING, { force: true })
    out(`  ${c.red('●')} The code expired. Run ${c.bold('roterminal login')} again.\n`)
    process.exitCode = 1
    return
  }
  done(r)
}

async function waitFor(p, ms) {
  const end = Date.now() + Math.max(0, ms)
  while (Date.now() < end) {
    const r = await call('/api/agent/login/wait', { key: p.key })
    if (r.state === 'linked') return r
    if (r.state === 'expired') return null
    await new Promise((ok) => setTimeout(ok, 2000))
  }
  return null
}

function done(r) {
  rmSync(PENDING, { force: true })
  saveJSON(AUTH, { token: r.token, user: r.user, plan: r.plan, at: new Date().toISOString() })
  if (JSON_OUT) return out(JSON.stringify({ status: 'ok', tool: 'login', data: { user: r.user, plan: r.plan, lookups_a_day: r.lookups }, next: [{ command: 'roterminal me', tool: 'me', input: {}, when: 'Their own games now' }] }, null, 2))
  out(`  ${c.green('✓')} Signed in as ${c.bold(`@${r.user?.username ?? 'you'}`)} ${c.dim(`· ${r.plan} · ${n(r.lookups)} calls a day`)}`)
  out(`\n  ${c.dim('Next')}  roterminal me\n`)
}

async function logout() {
  if (token()) await call('/api/agent/unlink', {})
  rmSync(AUTH, { force: true })
  if (JSON_OUT) return out(JSON.stringify({ status: 'ok', tool: 'logout', data: { signed_in: false } }, null, 2))
  out(`\n  ${c.green('✓')} Signed out. This key is disconnected.\n`)
}

// ---------- setting up an agent ----------

async function init() {
  let skill
  try {
    const r = await fetch(`${API}/skill.md`, { signal: AbortSignal.timeout(15_000) })
    skill = r.ok ? await r.text() : null
  } catch {}
  if (!skill) return finish({ status: 'error', reason: 'network', message: `Can’t reach ${SITE} to get the skill. Try again in a moment.`, retryable: true }, () => {})
  const base = flags.global ? join(homedir(), '.claude', 'skills', 'roterminal') : join(process.cwd(), '.claude', 'skills', 'roterminal')
  mkdirSync(base, { recursive: true })
  writeFileSync(join(base, 'SKILL.md'), skill)
  const wrote = [join(base, 'SKILL.md')]
  const agents = join(process.cwd(), 'AGENTS.md')
  if (!flags.global && existsSync(agents) && !/roterminal/i.test(readFileSync(agents, 'utf8'))) {
    appendFileSync(agents, `\n## Roblox data (RoTerminal)\n\nFor any question about Roblox games' players, growth, rivals or trends, and before and after shipping an update, use RoTerminal: \`npx -y roterminal <command> --json\` (\`help\` lists the commands). Cite the \`link\` in each answer.\n`)
    wrote.push(agents)
  }
  const r = { status: 'ok', tool: 'init', data: { wrote }, next: [{ command: 'roterminal login', tool: 'login', input: {}, when: 'Sign in (free) for more calls a day and your own games' }, { command: 'roterminal mcp', tool: 'mcp', input: {}, when: 'Add the connector to Claude, Codex or Cursor' }] }
  finish(r, (d) => {
    out(`  ${c.green('✓')} Your agent knows RoTerminal now.`)
    for (const f of d.wrote) out(`    ${c.dim(f.replace(homedir(), '~'))}`)
  })
}

function mcp() {
  const url = `${API}/mcp`
  const t = flags.with_key ? token() : null
  const header = t ? ` --header "Authorization: Bearer ${t}"` : ''
  const cursor = `cursor://anysphere.cursor-deeplink/mcp/install?name=roterminal&config=${Buffer.from(JSON.stringify({ url, ...(t ? { headers: { Authorization: `Bearer ${t}` } } : {}) })).toString('base64')}`
  const ways = { claude_code: `claude mcp add --transport http roterminal ${url}${header}`, codex: `codex mcp add roterminal --url ${url}`, cursor, claude_and_chatgpt_apps: `Claude: Customize → Connectors → Add custom connector → ${url} (ChatGPT: Settings → Apps). Sign in when it asks.` }
  finish({ status: 'ok', tool: 'mcp', data: { url, ...ways }, next: [] }, () => {
    out(`  ${c.bold('Connect RoTerminal to your AI')}`)
    out()
    out(`  ${c.dim(fit('Claude Code', 14))}${ways.claude_code}`)
    out(`  ${c.dim(fit('Codex', 14))}${ways.codex}`)
    out(`  ${c.dim(fit('Cursor', 14))}${link(cursor)}`)
    out(`  ${c.dim(fit('Claude app', 14))}Customize → Connectors → Add custom connector → ${url}`)
    if (!flags.with_key && token()) out(`\n  ${c.dim('Add --with-key to include your key, so it can see your own games.')}`)
  })
}

// ---------- help ----------

const HELP = [
  ['"<game>"', 'Everything on one game now, with its week'],
  ['watch "<game>"', 'Its players live, ticking'],
  ['rising [--week]', 'Games climbing fastest (today, or this week)'],
  ['top [--genre g]', 'The most played games now'],
  ['new', 'The biggest games out in the last 30 days'],
  ['trends [word]', 'What developers are making games about'],
  ['compare "<a>" "<b>"', 'Games side by side'],
  ['studio "<game>"', 'Who makes it, and their other games'],
  ['days "<game>"', 'Day by day (a week free, every day on Pro)'],
  ['screen --theme horror', 'Screen the top 600 by their numbers'],
  ['search "<name>"', 'Find a game'],
  ['roblox · genres · charts', 'All of Roblox, its genres, its charts'],
  ['me', 'Your own games (signed in)'],
  ['login · logout', 'Sign in (free) for more calls a day'],
  ['init', 'Teach your AI agent to use RoTerminal'],
  ['mcp', 'Add the connector to Claude, Codex or Cursor'],
]
function help() {
  out()
  out(`  ${c.bold('RoTerminal')} ${c.dim(`· live data on every Roblox game · v${VERSION}`)}`)
  out()
  for (const [cmd, what] of HELP) out(`  ${c.cyan(fit(`roterminal ${cmd}`, 36))} ${what}`)
  out()
  out(`  ${c.dim('Every command takes --json. Agents get JSON on their own.')}`)
  out(`  ${c.dim('Free to start, no account needed. Sign in for more calls a day.')}  ${link(`${API}/agents.md`)}`)
  out()
}

// ---------- the front door ----------

async function home() {
  const [r, t] = await Promise.all([tool('roblox', {}), tool('top', { limit: 5 })])
  if (JSON_OUT) return out(JSON.stringify({ status: r.status === 'ok' && t.status === 'ok' ? 'ok' : 'error', tool: 'home', data: { roblox: r.data ?? null, most_played: t.data ?? null }, link: `${API}`, next: [{ command: 'roterminal "<game>"', tool: 'game', input: { game: '<name>' }, when: 'Everything on one game' }, { command: 'roterminal rising', tool: 'rising', input: {}, when: 'What’s climbing' }] }, null, 2))
  if (r.status !== 'ok') return finish(r, () => {})
  out()
  out(`  ${c.bold('RoTerminal')}`)
  out()
  drawRoblox(r.data)
  if (t.status === 'ok') {
    out()
    out(`  ${c.dim('Most played now')}`)
    rows(t.data.games, { extra: () => '' })
  }
  out()
  out(`  ${c.dim('Try')}   roterminal "grow a garden"`)
  out(`        roterminal rising --week`)
  out(`        roterminal help`)
  out()
}

// ---------- commands ----------

const games = () => {
  // compare "a" "b", compare a vs b, compare a, b
  const joined = words.slice(1).join(' ')
  if (/\s+vs\.?\s+|,/.test(joined)) return joined.split(/\s+vs\.?\s+|,/).map((s) => s.trim()).filter(Boolean)
  return words.slice(1)
}
const rest = () => words.slice(1).join(' ').trim()
const lim = () => (flags.limit ? Number(flags.limit) : undefined)

const COMMANDS = {
  help: async () => help(),
  rising: async () => finish(await tool('rising', { range: flags.week || flags.range === '7d' || rest() === 'week' ? '7d' : '24h', genre: flags.genre, limit: lim() }), drawList),
  top: async () => finish(await tool('top', { list: 'most_played', genre: flags.genre || rest() || undefined, limit: lim() }), drawList),
  new: async () => finish(await tool('top', { list: 'new', genre: flags.genre || rest() || undefined, limit: lim() }), drawList),
  trends: async () => finish(await tool('trends', { word: rest() || flags.word, limit: lim() }), drawTrends),
  compare: async () => finish(await tool('compare', { games: games() }), drawCompare),
  studio: async () => finish(await tool('studio', rest() ? { game: rest() } : { name: flags.name }), drawStudio),
  days: async () => finish(await tool('days', { game: rest(), days: flags.days ? Number(flags.days) : undefined }), drawDays),
  screen: async () =>
    finish(await tool('screen', { genre: flags.genre, theme: flags.theme || rest() || undefined, sort: flags.sort, min_playing: flags.min_playing, max_playing: flags.max_playing, max_age_days: flags.max_age ?? flags.max_age_days, min_change_24h: flags.min_change_24h, min_change_7d: flags.min_change_7d, min_like_pct: flags.min_likes ?? flags.min_like_pct, limit: lim() }), drawList),
  search: async () => finish(await tool('search', { query: rest() }), drawList),
  roblox: async () => finish(await tool('roblox', {}), drawRoblox),
  genres: async () => finish(await tool('genres', {}), drawGenres),
  charts: async () => finish(await tool('charts', { chart: rest() || undefined, limit: lim() }), drawCharts),
  me: async () => finish(await tool('me', {}), drawMe),
  game: async () => finish(await tool('game', { game: rest() }), drawGame),
  watch: async () => watch(rest()),
  live: async () => watch(rest()),
  login,
  logout,
  whoami: async () => {
    const r = await call('/api/agent/whoami', null, 'GET')
    finish(r.status ? r : { status: 'ok', data: r }, () => out(r.signed_in ? `  Signed in as ${c.bold(`@${r.user.username}`)} ${c.dim(`· ${r.plan} · ${n(r.lookups_a_day)} calls a day`)}` : `  Not signed in ${c.dim(`· ${n(r.lookups_a_day)} calls a day`)} · roterminal login`))
  },
  init,
  mcp: async () => mcp(),
}

async function main() {
  if (flags.version) return out(VERSION)
  if (flags.help) return help()
  if (!words.length) return home()
  const cmd = COMMANDS[words[0].toLowerCase()]
  if (cmd) return cmd()
  // Anything else is a game: roterminal grow a garden
  words.unshift('game')
  return COMMANDS.game()
}

main().catch((e) => {
  if (JSON_OUT) out(JSON.stringify({ status: 'error', reason: 'cli_error', message: String(e?.message ?? e), retryable: false }))
  else out(`\n  ${c.red('●')} ${e?.message ?? e}\n`)
  process.exitCode = 1
})
