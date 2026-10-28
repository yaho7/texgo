import {mkdtemp,writeFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {preparePublicAssets} from '../scripts/prepare-public-assets.mjs';
async function fixture(action) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'texgo-public-assets-'));
  const version='0.3.1', base=`texgo_${version}_`;
  const names=['windows.exe','linux.deb','linux.AppImage','macos_arm64.dmg','macos_x64.dmg','macos_arm64.app.tar.gz','macos_x64.app.tar.gz'];
  const signed=['windows.exe','linux.AppImage','macos_arm64.app.tar.gz','macos_x64.app.tar.gz'];
  try {
    for(const name of [...names,...signed.map(name=>name+'.sig')]) await writeFile(path.join(directory,base+name),'fixture');
    await writeFile(path.join(directory,'latest.json'),JSON.stringify({version,platforms:{windows:{signature:'a'},linux:{signature:'b'},arm:{signature:'c'},intel:{signature:'d'}}}));
    await action({directory,version});
  } finally { await rm(directory,{recursive:true,force:true}); }
}
test('publishes exactly eight files while retaining embedded updater signatures',()=>fixture(async options=>{
  const names=await preparePublicAssets(options); assert.equal(names.length,8);
  assert.deepEqual((await readdir(options.directory)).sort(),names);
  assert.equal(names.some(name=>name.endsWith('.sig')),false);
}));
test('rejects unexpected release files before removing internal signatures',()=>fixture(async options=>{
  await writeFile(path.join(options.directory,'extra.zip'),'extra');
  await assert.rejects(preparePublicAssets(options),/exactly five installers/);
  assert.equal((await readdir(options.directory)).filter(name=>name.endsWith('.sig')).length,4);
}));
