import { spawn } from 'node:child_process';
const child = spawn(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'tests/browser.test.ts'],
  { stdio: 'inherit', env: { ...process.env, NBLOG_BROWSER_TESTS: '1' } },
);
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
