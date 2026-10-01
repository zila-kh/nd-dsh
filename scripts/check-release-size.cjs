const { statSync } = require('node:fs')

const MAX_DOWNLOAD_BYTES = 400_000_000

function checkReleaseSize({ artifactPaths }) {
  for (const path of artifactPaths.filter((value) => /\.exe$/i.test(value))) {
    const bytes = statSync(path).size
    if (bytes > MAX_DOWNLOAD_BYTES) {
      throw new Error(`Release download is ${(bytes / 1_000_000).toFixed(1)} MB; ND's limit is 400 MB: ${path}`)
    }
    console.log(`Release download: ${(bytes / 1_000_000).toFixed(1)} MB / 400 MB`)
  }
  return []
}

module.exports = checkReleaseSize
