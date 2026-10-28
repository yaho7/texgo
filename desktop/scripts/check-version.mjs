import { checkVersions, writeGithubOutputs } from './release-policy.mjs';
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--github-output')) throw new Error('Usage: check-version.mjs [--github-output]');
const policy = await checkVersions(undefined, process.env.GITHUB_REF ?? '');
if (args.includes('--github-output')) {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
  await writeGithubOutputs(policy, process.env.GITHUB_OUTPUT);
}
console.log(`Version ${policy.version}; ${policy.publish ? `${policy.prerelease ? 'beta' : 'stable'} release ${policy.tag}` : 'artifacts only'}`);
