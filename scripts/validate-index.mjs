#!/usr/bin/env node
/**
 * Validate index.json with the same rules DSH applies before it shows the index.
 * Environment: VALIDATOR_PATH (path to @deepseek-ai/dsh-plugin-market-index lib/index.js),
 *              INDEX_URL (the URL the index is served from, used to resolve relative icons).
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const modulePath = process.env.VALIDATOR_PATH
if (!modulePath) {
  console.error('VALIDATOR_PATH is not set')
  process.exit(1)
}

const { parseMarketIndex } = await import(pathToFileURL(modulePath).href)
const file = process.argv[2] ?? 'index.json'
const indexUrl = process.env.INDEX_URL ?? 'https://raw.githubusercontent.com/cyberx3mal/dsh-plugins-index/main/index.json'

try {
  const index = parseMarketIndex(JSON.parse(readFileSync(file, 'utf8')), indexUrl)
  console.log(`valid: ${index.plugins.length} plugins`)
} catch (error) {
  console.error(`invalid: ${error.path ?? '$'} ${error.reason ?? error.message}`)
  process.exit(1)
}
