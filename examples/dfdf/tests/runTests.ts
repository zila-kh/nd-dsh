import { TestRunner } from '../src/testing/testRunner.ts';

async function main() {
  console.log('====================================================');
  console.log('  Project `dfdf` Core Module Verification Suite');
  console.log('====================================================\n');

  const runner = new TestRunner();
  const { success, results } = await runner.runAllSuites();

  let totalTestsAllSuites = 0;
  let passedTestsAllSuites = 0;

  for (const suite of results) {
    console.log(`[SUITE] ${suite.suiteName} (${suite.durationMs}ms)`);
    for (const detail of suite.details) {
      totalTestsAllSuites++;
      if (detail.passed) {
        passedTestsAllSuites++;
        console.log(`  ✓ PASSED: ${detail.testName}`);
      } else {
        console.log(`  ✗ FAILED: ${detail.testName}`);
        console.log(`    Error: ${detail.error}`);
      }
    }
    console.log('');
  }

  const passRate = ((passedTestsAllSuites / totalTestsAllSuites) * 100).toFixed(1);
  console.log('----------------------------------------------------');
  console.log(`Summary: ${passedTestsAllSuites}/${totalTestsAllSuites} tests passed (${passRate}% pass rate)`);
  console.log('----------------------------------------------------');

  if (success) {
    console.log('VERIFICATION SUCCESSFUL: All acceptance criteria met.');
    process.exit(0);
  } else {
    console.log('VERIFICATION FAILED: One or more test criteria failed.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
