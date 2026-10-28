import { readFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/;
export function releasePolicy(version, ref = '') {
  if (typeof version !== 'string' || !versionPattern.test(version)) throw new Error('Desktop version must be X.Y.Z or X.Y.Z-beta.N without leading zeroes');
  const tag = `v${version}`;
  const versionTag = ref.startsWith('refs/tags/v');
  if (versionTag && ref !== `refs/tags/${tag}`) throw new Error(`Release tag must exactly match ${tag}`);
  const publish = versionTag;
  const prerelease = version.includes('-');
  return { version, tag, publish, prerelease, latest: publish && !prerelease };
}
export function desktopBuildIdentity(version, ref) {
  const policy = releasePolicy(version, ref);
  return policy.publish ? policy.tag : 'development';
}
function tomlVersion(source, name) {
  const sections = source.split(/^\[\[package\]\]\s*$/m).slice(1);
  const packages = sections.filter(section => new RegExp(`^name\\s*=\\s*"${name}"\\s*$`, 'm').test(section));
  if (packages.length !== 1) throw new Error(`Expected one Cargo.lock package named ${name}`);
  const version = packages[0].match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) throw new Error('Missing Cargo.lock desktop version');
  return version;
}
export async function checkVersions(root = fileURLToPath(new URL('../', import.meta.url)), ref = '') {
  const files = ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json'];
  const sources = await Promise.all(files.map(file => readFile(path.join(root, file), 'utf8')));
  const pkg = JSON.parse(sources[0]); const lock = JSON.parse(sources[1]);
  const manifest = sources[2].match(/^\[package\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  const versions = {
    'package.json': pkg.version,
    'package-lock.json': lock.version,
    'package-lock.json packages[""]': lock.packages?.['']?.version,
    'src-tauri/Cargo.toml': manifest?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1],
    'src-tauri/Cargo.lock': tomlVersion(sources[3], 'texgo-desktop'),
    'src-tauri/tauri.conf.json': JSON.parse(sources[4]).version,
  };
  for (const [file, version] of Object.entries(versions)) {
    if (version !== pkg.version) throw new Error(`${file}: ${String(version)} does not match package.json ${pkg.version}`);
  }
  return releasePolicy(pkg.version, ref);
}
export async function writeGithubOutputs(policy, destination) {
  const entries = Object.entries(policy).map(([key, value]) => `${key}=${value}\n`).join('');
  await appendFile(destination, entries);
}
