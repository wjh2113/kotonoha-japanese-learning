/**
 * Full browser regression: build + mobile + PC e2e against production API.
 * Usage: KOTONOHA_PASSWORD=xxx node scripts/e2e-regression.mjs
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

function run(command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: false,
    })
    child.on('exit', (code) => resolve(code || 0))
  })
}

async function main() {
  if (!process.env.KOTONOHA_PASSWORD) {
    console.error('Set KOTONOHA_PASSWORD')
    process.exit(2)
  }

  console.log('\n=== BUILD ===')
  const buildCode = await run('npm', ['run', 'build'])
  if (buildCode !== 0) process.exit(buildCode)

  console.log('\n=== MOBILE FULL ===')
  const mobileCode = await run('node', ['scripts/e2e-mobile-full.mjs'], { E2E_PORT: '4177' })

  console.log('\n=== PC FULL ===')
  const pcCode = await run('node', ['scripts/e2e-pc.mjs'], { E2E_PORT: '4178' })

  console.log('\n=== REGRESSION SUMMARY ===')
  console.log(JSON.stringify({
    mobile: mobileCode === 0 ? 'pass' : 'fail',
    pc: pcCode === 0 ? 'pass' : 'fail',
  }, null, 2))
  process.exit(mobileCode || pcCode ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
