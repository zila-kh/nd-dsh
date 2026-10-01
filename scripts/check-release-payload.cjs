const { join } = require('node:path')

module.exports = async function checkReleasePayload({ appOutDir, electronPlatformName }) {
  const { assertNoOfficeEngines } = await import('./release-runtime-policy.mjs')
  const resources = electronPlatformName === 'darwin'
    ? join(appOutDir, 'ND-DSH.app', 'Contents', 'Resources')
    : join(appOutDir, 'resources')
  await assertNoOfficeEngines(join(resources, 'vendor', 'deepseek-harness'))
}
