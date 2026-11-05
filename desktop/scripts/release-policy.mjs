import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/;
const desktopRoot = fileURLToPath(new URL('../', import.meta.url));
const versionFiles = ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json'];
const cargoManifestPackage = /^\[package\][^\S\r\n]*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m;
const tomlVersion = /^(version[^\S\r\n]*=[^\S\r\n]*)"([^"\r\n]+)"/m;
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
function cargoLockPackage(source, name) {
  const sections = source.split(/^\[\[package\]\]\s*$/m).slice(1);
  const packages = sections.filter(section => new RegExp(`^name\\s*=\\s*"${name}"\\s*$`, 'm').test(section));
  if (packages.length !== 1) throw new Error(`Expected one Cargo.lock package named ${name}`);
  return packages[0];
}
export async function checkVersions(root = desktopRoot, ref = '') {
  const sources = await Promise.all(versionFiles.map(file => readFile(path.join(root, file), 'utf8')));
  const pkg = JSON.parse(sources[0]); const lock = JSON.parse(sources[1]);
  const manifest = sources[2].match(cargoManifestPackage)?.[1];
  const versions = {
    'package.json': pkg.version,
    'package-lock.json': lock.version,
    'package-lock.json packages[""]': lock.packages?.['']?.version,
    'src-tauri/Cargo.toml': manifest?.match(tomlVersion)?.[2],
    'src-tauri/Cargo.lock': cargoLockPackage(sources[3], 'texgo-desktop').match(tomlVersion)?.[2],
    'src-tauri/tauri.conf.json': JSON.parse(sources[4]).version,
  };
  for (const [file, version] of Object.entries(versions)) {
    if (version !== pkg.version) throw new Error(`${file}: ${String(version)} does not match package.json ${pkg.version}`);
  }
  return releasePolicy(pkg.version, ref);
}

export async function prepareBuildVersion(root = desktopRoot, ref = '') {
  const tagPrefix = 'refs/tags/v';
  if (!ref.startsWith(tagPrefix)) return checkVersions(root, ref);

  const policy = releasePolicy(ref.slice(tagPrefix.length), ref);
  const { version } = policy;
  const files = versionFiles.map(file => path.join(root, file));
  const [packageJson, packageLock, cargoManifest, cargoLock, tauriConfig] = await Promise.all(files.map(file => readFile(file, 'utf8')));
  const pkg = JSON.parse(packageJson);
  const lock = JSON.parse(packageLock);
  const tauri = JSON.parse(tauriConfig);
  const manifestSection = cargoManifest.match(cargoManifestPackage)?.[1];
  const lockSection = cargoLockPackage(cargoLock, 'texgo-desktop');
  if (!manifestSection?.match(tomlVersion) || !lockSection.match(tomlVersion)) {
    throw new Error('Missing desktop package version in Cargo manifest or lockfile');
  }

  pkg.version = version;
  lock.version = version;
  lock.packages[''].version = version;
  tauri.version = version;
  const setTomlVersion = section => section.replace(tomlVersion, (_, prefix) => prefix + '"' + version + '"');
  const json = value => JSON.stringify(value, null, 2) + '\n';
  const sources = [
    json(pkg),
    json(lock),
    cargoManifest.replace(manifestSection, setTomlVersion),
    cargoLock.replace(lockSection, setTomlVersion),
    json(tauri),
  ];
  await Promise.all(files.map((file, index) => writeFile(file, sources[index])));
  return checkVersions(root, ref);
}

export async function writeGithubOutputs(policy, destination) {
  const entries = Object.entries(policy).map(([key, value]) => `${key}=${value}\n`).join('');
  await appendFile(destination, entries);
}
