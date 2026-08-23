#!/usr/bin/env node
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'vendor', 'vscode-git.json')
const errors = []
let commit = ''

const requiredFiles = [
  'vendor/vscode-git.json',
  'vendor/vscode-git.LICENSE',
  'vendor/vscode-git/src/git.ts',
  'vendor/vscode-git/package.json',
  'src/main/git/git-cli.ts',
  'src/main/git/git-service.ts',
]
for (const path of requiredFiles) {
  if (!existsSync(join(root, path))) errors.push(`missing VS Code Git integration file: ${path}`)
}

if (existsSync(manifestPath)) {
  const pin = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const repository = typeof pin.repository === 'string' ? pin.repository : ''
  commit = typeof pin.commit === 'string' ? pin.commit.toLowerCase() : ''
  const license = typeof pin.license === 'string' ? pin.license : ''
  const upstreamPath = typeof pin.path === 'string' ? pin.path : ''

  if (repository !== 'https://github.com/microsoft/vscode.git') errors.push('VS Code Git upstream pin must use the canonical microsoft/vscode repository')
  if (!/^[0-9a-f]{40}$/.test(commit)) errors.push('VS Code Git upstream pin must contain a full 40-character commit SHA')
  if (upstreamPath !== 'extensions/git') errors.push('VS Code Git upstream pin must record the extensions/git upstream path')
  if (license !== 'MIT') errors.push('VS Code Git upstream pin must record the MIT license')

  const vendorLicensePath = join(root, 'vendor', 'vscode-git.LICENSE')
  if (existsSync(vendorLicensePath)) {
    const licenseText = await fs.readFile(vendorLicensePath, 'utf8')
    if (!licenseText.startsWith('MIT License') || !licenseText.includes('Copyright (c) 2015 - present Microsoft Corporation')) {
      errors.push('vendor/vscode-git.LICENSE must preserve the upstream MIT notice')
    }
  }
}

if (errors.length) {
  console.error('\nVS Code Git integration verification failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}
console.log(`VS Code Git product boundary verified (MIT upstream @ ${commit.slice(0, 12)}).`)
