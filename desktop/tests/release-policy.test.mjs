import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { collectInstallers } from '../scripts/collect-installers.mjs';
import { checkVersions, desktopBuildIdentity, releasePolicy, writeGithubOutputs } from '../scripts/release-policy.mjs';

test('branches, manual branch runs and unrelated tags never publish', () => {
  for (const ref of ['', 'refs/heads/main', 'refs/heads/feature/test', 'refs/tags/engine-v1', 'refs/tags/desktop-v0.3.0']) {
    assert.equal(releasePolicy('0.3.0', ref).publish, false);
    assert.equal(releasePolicy('0.3.0', ref).latest, false);
    assert.equal(desktopBuildIdentity('0.3.0', ref), 'development');
  }
});
test('exact stable and beta tags have distinct Latest policy and truthful build identity', () => {
  assert.deepEqual(releasePolicy('0.3.0', 'refs/tags/v0.3.0'), { version:'0.3.0', tag:'v0.3.0', publish:true, prerelease:false, latest:true });
  assert.deepEqual(releasePolicy('0.3.0-beta.2', 'refs/tags/v0.3.0-beta.2'), { version:'0.3.0-beta.2', tag:'v0.3.0-beta.2', publish:true, prerelease:true, latest:false });
  assert.equal(desktopBuildIdentity('0.3.0-beta.2', 'refs/tags/v0.3.0-beta.2'), 'v0.3.0-beta.2');
});
test('rejects stale, partial and automatic build tags rather than generating another release', () => {
  for (const ref of ['v0.2.1', 'v0.3.0-beta.1', 'v0.3.0-build.1.1', 'v0.3.0\nlatest=true']) {
    assert.throws(() => releasePolicy('0.3.0', `refs/tags/${ref}`), /exactly match/);
  }
  for (const version of ['0.3', '00.3.0', '0.3.0-beta.01', '0.3.0-rc.1', '0.3.0\nlatest=true']) assert.throws(() => releasePolicy(version));
});
async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texgo-version-'));
  try {
    await mkdir(path.join(root, 'src-tauri'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({version:'0.3.0-beta.2'}));
    await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({version:'0.3.0-beta.2', packages:{'':{version:'0.3.0-beta.2'}}}));
    await writeFile(path.join(root, 'src-tauri/Cargo.toml'), '[package]\nname = "texgo-desktop"\nversion = "0.3.0-beta.2"\n\n[dependencies]\nthing = "1"\n');
    await writeFile(path.join(root, 'src-tauri/Cargo.lock'), 'version = 4\n\n[[package]]\nname = "texgo-desktop"\nversion = "0.3.0-beta.2"\n\n[[package]]\nname = "thing"\nversion = "1.0.0"\n');
    await writeFile(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({version:'0.3.0-beta.2'}));
    await run(root);
  } finally { await rm(root, {recursive:true, force:true}); }
}
test('checks beta versions across all manifests and both npm lock version fields', async () => {
  await fixture(async root => {
    assert.equal((await checkVersions(root, 'refs/tags/v0.3.0-beta.2')).publish, true);
    const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
    lock.packages[''].version = '0.2.1';
    await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lock));
    await assert.rejects(checkVersions(root), /packages\[""\]/);
  });
});
test('rejects a stale Cargo lock and missing/duplicate desktop package records', async () => {
  await fixture(async root => {
    const file = path.join(root, 'src-tauri/Cargo.lock');
    await writeFile(file, '[[package]]\nname = "texgo-desktop"\nversion = "0.2.1"\n');
    await assert.rejects(checkVersions(root), /Cargo.lock.*does not match/);
    await writeFile(file, '[[package]]\nname = "other"\nversion = "0.3.0"\n');
    await assert.rejects(checkVersions(root), /Expected one Cargo.lock package/);
    const entry = '[[package]]\nname = "texgo-desktop"\nversion = "0.3.0-beta.2"\n';
    await writeFile(file, entry + entry); await assert.rejects(checkVersions(root), /Expected one/);
  });
});
test('checks the real repository and emits explicit CI release outputs', async () => {
  const actual = await checkVersions();
  assert.equal(actual.publish, false); assert.match(actual.version, /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/);
  await fixture(async root => {
    const output = path.join(root, 'output');
    await writeGithubOutputs(releasePolicy('0.3.0-beta.2', 'refs/tags/v0.3.0-beta.2'), output);
    const contents = await readFile(output, 'utf8');
    assert.match(contents, /^publish=true$/m); assert.match(contents, /^latest=false$/m); assert.match(contents, /^prerelease=true$/m);
  });
});


test('collects simple version/platform filenames without the original bundle name', async () => {
  await fixture(async root => {
    const cases = [
      ['x86_64-pc-windows-msvc','windows','x64','nsis','.exe','texgo_0.3.0-beta.2_windows.exe'],
      ['aarch64-apple-darwin','macos','arm64','dmg','.dmg','texgo_0.3.0-beta.2_macos_arm64.dmg'],
      ['x86_64-apple-darwin','macos','x64','dmg','.dmg','texgo_0.3.0-beta.2_macos_x64.dmg'],
    ];
    for (const [target,platform,arch,folder,extension,name] of cases) {
      const source = path.join(root,'src-tauri/target',target,'release/bundle',folder);
      await mkdir(source,{recursive:true}); await writeFile(path.join(source,`Long Tauri Installer Name${extension}`),'installer');
      const destination=path.join(root,`collected-${arch}-${platform}`);
      assert.deepEqual(await collectInstallers({target,platform,arch,desktop:root,destination,ref:''}),[name]);
      assert.equal(await readFile(path.join(destination,name),'utf8'),'installer');
      await assert.rejects(collectInstallers({target,platform,arch,desktop:root,destination,ref:''}),/EEXIST/);
    }
  });
});
test('Linux formats stay distinct and multiple bundle candidates never silently overwrite', async () => {
  await fixture(async root => {
    const target='x86_64-unknown-linux-gnu'; const destination=path.join(root,'collected');
    for (const [folder,extension] of [['deb','.deb'],['appimage','.AppImage']]) {
      const source=path.join(root,'src-tauri/target',target,'release/bundle',folder);
      await mkdir(source,{recursive:true}); await writeFile(path.join(source,`original${extension}`),'installer');
    }
    assert.deepEqual(await collectInstallers({target,platform:'linux',arch:'x64',desktop:root,destination,ref:''}),['texgo_0.3.0-beta.2_linux.deb','texgo_0.3.0-beta.2_linux.AppImage']);
    await writeFile(path.join(root,'src-tauri/target',target,'release/bundle/deb/another.deb'),'other');
    await assert.rejects(collectInstallers({target,platform:'linux',arch:'x64',desktop:root,destination,ref:''}),/exactly one/);
    assert.equal(await readFile(path.join(destination,'texgo_0.3.0-beta.2_linux.deb'),'utf8'),'installer');
    await assert.rejects(collectInstallers({target,platform:'macos',arch:'arm64',desktop:root,destination,ref:''}),/matching installer target/);
  });
});
