#!/usr/bin/env node
/**
 * Refresh the Git-sourced entries of index.json from each plugin repository's default branch.
 *
 * For every entry whose newest version comes from GitHub, the script reads the repository's
 * default-branch head commit, the package.json at that commit, and the commit date. A version
 * that is not listed yet is added; a listed version whose commit moved is reported as a warning,
 * because that usually means the plugin was changed without bumping its version.
 *
 * Usage: node scripts/update-index.mjs [index.json]
 * Environment: GITHUB_TOKEN (optional, raises the API rate limit in CI).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const file = process.argv[2] ?? 'index.json'
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
const MAX_VERSIONS = 20

const index = JSON.parse(readFileSync(file, 'utf8'))
const root = dirname(file)
const problems = []
let changed = false
let refreshed = 0

const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-plugins-index-updater' }
if (token) headers.authorization = `Bearer ${token}`

async function getJson(url, attempt = 1) {
  let response
  try {
    response = await fetch(url, { headers })
  } catch (error) {
    if (attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, attempt * 1000))
      return getJson(url, attempt + 1)
    }
    throw error
  }
  if (response.status === 404) return undefined
  if (!response.ok) {
    if (attempt < 3 && response.status >= 500) {
      await new Promise(resolve => setTimeout(resolve, attempt * 1000))
      return getJson(url, attempt + 1)
    }
    throw new Error(`${url}: HTTP ${response.status}`)
  }
  return response.json()
}

async function getText(url, attempt = 1) {
  let response
  try {
    response = await fetch(url)
  } catch (error) {
    if (attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, attempt * 1000))
      return getText(url, attempt + 1)
    }
    throw error
  }
  if (response.status === 404) return undefined
  if (!response.ok) {
    if (attempt < 3 && response.status >= 500) {
      await new Promise(resolve => setTimeout(resolve, attempt * 1000))
      return getText(url, attempt + 1)
    }
    throw new Error(`${url}: HTTP ${response.status}`)
  }
  return response.text()
}

/** `https://github.com/owner/repo` -> `{ owner, repo }`; anything else is not refreshable here. */
function githubRepository(url) {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'github.com') return undefined
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean)
    if (!owner || !repo) return undefined
    return { owner, repo }
  } catch {
    return undefined
  }
}

function refreshIcon(plugin, source, head) {
  if (typeof plugin.icon !== 'string' || !plugin.icon.startsWith('icons/')) return
  const target = join(root, plugin.icon)
  if (!existsSync(target)) return
  return { target, url: `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${head}/icon.svg` }
}

for (const plugin of index.plugins) {
  const newest = plugin.versions[0]
  if (newest?.source?.type !== 'git') continue

  const repository = githubRepository(newest.source.url)
  if (repository === undefined) continue

  try {
    const meta = await getJson(`https://api.github.com/repos/${repository.owner}/${repository.repo}`)
    if (meta === undefined) throw new Error('repository not found')
    const branch = meta.default_branch
    const commit = await getJson(`https://api.github.com/repos/${repository.owner}/${repository.repo}/commits/${encodeURIComponent(branch)}`)
    if (commit === undefined) throw new Error(`no commits on ${branch}`)

    const head = commit.sha
    const publishedAt = Math.floor(Date.parse(commit.commit.committer.date) / 1000)
    const manifestUrl = `https://raw.githubusercontent.com/${repository.owner}/${repository.repo}/${head}/package.json`
    const manifest = JSON.parse(await getText(manifestUrl))
    const version = String(manifest.version)

    const known = plugin.versions.find(entry => entry.version === version)
    if (known !== undefined) {
      if (known.source.commit !== head) {
        console.log(`::warning::${plugin.name}: ${version} is listed at ${known.source.commit.slice(0, 7)} but ${branch} is ${head.slice(0, 7)}; bump the version in package.json so the index can publish it`)
      }
    } else {
      plugin.versions.unshift({
        version,
        publishTimestamp: publishedAt,
        source: { type: 'git', url: newest.source.url, commit: head },
      })
      plugin.versions = plugin.versions.slice(0, MAX_VERSIONS)
      changed = true
      console.log(`${plugin.name}: published ${version} at ${head.slice(0, 7)}`)
    }

    const icon = refreshIcon(plugin, repository, head)
    if (icon !== undefined) {
      const text = await getText(icon.url)
      if (text !== undefined && readFileSync(icon.target, 'utf8') !== text) {
        writeFileSync(icon.target, text)
        changed = true
        console.log(`${plugin.name}: refreshed ${plugin.icon}`)
      }
    }
    refreshed += 1
  } catch (error) {
    problems.push(`${plugin.name}: ${error.message}`)
  }
}
if (changed) writeFileSync(file, `${JSON.stringify(index, null, 2)}\n`)
console.log(changed ? `updated ${file}` : `no changes in ${file}`)
for (const problem of problems) {
  console.log(`::warning::could not refresh ${problem}`)
}
if (problems.length > 0 && refreshed === 0) {
  console.error('every repository failed; check network access or GITHUB_TOKEN')
  process.exitCode = 1
}
