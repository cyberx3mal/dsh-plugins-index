#!/usr/bin/env node
// Refresh index.json from the local checkouts: version and commit of HEAD, commit time, icon.
// Run after pushing a plugin release:  node update-index.mjs
// The manifest is read from HEAD, not from the working tree, so an uncommitted version bump
// can never pair a new version with an older commit in index.json.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const indexPath = join(root, 'index.json')

/** Package name in index.json -> local checkout. */
const checkouts = {
  'dsh-plugin-project-sounds': 'C:/projects/ds harness widgets/sounds',
  '@local/docker-sidebar': 'C:/projects/ds harness widgets/docker',
  '@local/sidebar-widget-order': 'C:/projects/ds harness widgets/sidebar-order',
  '@local/projects-board': 'C:/projects/ds harness widgets/projects',
  '@local/music-board': 'C:/projects/ds harness widgets/music',
}

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()

const index = JSON.parse(readFileSync(indexPath, 'utf8'))
const problems = []

for (const dirty of ['index.json']) {
  if (!existsSync(join(root, dirty))) problems.push(`${dirty} is missing`)
}

for (const plugin of index.plugins) {
  // npm-sourced entries (third-party) have no local checkout to read from.
  if (plugin.versions[0]?.source?.type !== 'git') continue
  const dir = checkouts[plugin.name]
  if (dir === undefined) {
    console.warn(`skip ${plugin.name}: no checkout configured`)
    continue
  }
  if (!existsSync(join(dir, 'package.json'))) {
    problems.push(`${plugin.name}: ${dir} has no package.json`)
    continue
  }
  let manifest
  try {
    manifest = JSON.parse(git(dir, 'show', 'HEAD:package.json'))
  } catch (error) {
    problems.push(`${plugin.name}: ${dir} has no package.json at HEAD (${error.message})`)
    continue
  }
  if (manifest.name !== plugin.name) {
    problems.push(`${plugin.name}: ${dir} declares ${manifest.name}`)
    continue
  }
  if (!manifest.dsh?.bundle) problems.push(`${plugin.name}: manifest declares no dsh.bundle`)
  if (manifest.private !== false && manifest.private !== undefined) {
    console.warn(`note ${plugin.name}: "private": true is fine for a Git install, but blocks npm publishing`)
  }

  const version = manifest.version
  const commit = git(dir, 'rev-parse', 'HEAD')
  const publishTimestamp = Number(git(dir, 'log', '-1', '--format=%ct'))
  const source = plugin.versions[0]?.source
  if (source?.type !== 'git') {
    problems.push(`${plugin.name}: expected a git source in index.json`)
    continue
  }
  if (git(dir, 'status', '--porcelain') !== '') {
    console.warn(`note ${plugin.name}: uncommitted changes in ${dir} are not part of the pinned commit`)
  }
  if (git(dir, 'rev-parse', 'origin/main') !== commit) {
    console.warn(`note ${plugin.name}: HEAD ${commit.slice(0, 7)} is not origin/main; push it before publishing`)
  }

  const versions = plugin.versions.filter(entry => entry.version !== version)
  versions.unshift({ version, publishTimestamp, source: { type: 'git', url: source.url, commit } })
  plugin.versions = versions

  const icon = join(dir, 'icon.svg')
  if (existsSync(icon)) {
    copyFileSync(icon, join(root, plugin.icon ?? `icons/${plugin.name.split('/').pop()}.svg`))
  }
}

if (problems.length > 0) {
  console.error('refusing to write:\n  ' + problems.join('\n  '))
  process.exit(1)
}

writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`)
console.log(`updated ${indexPath}`)
