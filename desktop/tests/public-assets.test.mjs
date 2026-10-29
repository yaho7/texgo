import {mkdtemp,writeFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {preparePublicAssets} from '../scripts/prepare-public-assets.mjs';
async function fixture(action) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'texgo-public-assets-'));
  const version='0.3.1', base=`texgo_${version}_`;
  const names=['windows.exe','linux.deb','linux.AppImage','macos_arm64.dmg','macos_x64.dmg'];
  try {
    for(const name of names) await writeFile(path.join(directory,base+name),'fixture');
    await action({directory,version});
  } finally { await rm(directory,{recursive:true,force:true}); }
}
test('publishes only the five platform installers',()=>fixture(async options=>{
  const names=await preparePublicAssets(options); assert.equal(names.length,5);
  assert.deepEqual((await readdir(options.directory)).sort(),names);
  assert.equal(names.some(name=>name.endsWith('.sig')),false);
}));
test('rejects unexpected release files',()=>fixture(async options=>{
  await writeFile(path.join(options.directory,'extra.zip'),'extra');
  await assert.rejects(preparePublicAssets(options),/exactly five installers/);
}));

test('rejects empty installers',()=>fixture(async options=>{
  await writeFile(path.join(options.directory,`texgo_${options.version}_windows.exe`),'');
  await assert.rejects(preparePublicAssets(options),/Invalid release asset/);
}));
