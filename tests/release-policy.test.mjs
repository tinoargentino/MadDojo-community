import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateMacRelease} from '../scripts/release-policy.mjs';
const artifact = 'MadDojo-0.2.0-beta.2-mac-arm64.dmg';
const valid = {signature_valid:true, distribution_ready:false, artifact, artifact_sha256:'a'.repeat(64)};
const request = {version:'0.2.0-beta.2', assessment:valid, assets:[artifact]};
test('unnotarized prereleases require explicit publishing selection', () => {
  assert.throws(() => validateMacRelease(request), /Developer ID/);
  assert.deepEqual(validateMacRelease({...request, allowUnnotarizedPreview:true}), {unnotarized:true});
});
test('testing selection cannot publish a stable unnotarized build or a broken signature', () => {
  assert.throws(() => validateMacRelease({...request, version:'0.2.0', allowUnnotarizedPreview:true}), /prereleases/);
  assert.throws(() => validateMacRelease({...request, assessment:{...valid, signature_valid:false}, allowUnnotarizedPreview:true}), /signature is invalid/);
});
test('a trusted build passes and an assessment for a missing installer cannot publish', () => {
  assert.deepEqual(validateMacRelease({...request, version:'0.2.0', assessment:{...valid, distribution_ready:true}}), {unnotarized:false});
  assert.throws(() => validateMacRelease({...request, assets:[], allowUnnotarizedPreview:true}), /exact installer/);
});

test('release assembly accepts the actual nested GitHub artifact layout and rejects collisions', async () => {
  const {collectReleaseArtifacts} = await import('../scripts/release-policy.mjs');
  const {mkdtemp,mkdir,writeFile,rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const path = await import('node:path');
  const folder = await mkdtemp(path.join(tmpdir(),'maddojo-release-layout-'));
  try {
    await mkdir(path.join(folder,'mac/desktop'),{recursive:true});
    await mkdir(path.join(folder,'windows/desktop'),{recursive:true});
    await writeFile(path.join(folder,'mac/desktop',artifact),'verified installer');
    await writeFile(path.join(folder,'mac/mac-assessment.json'),JSON.stringify(valid));
    await writeFile(path.join(folder,'windows/desktop/MadDojo.exe'),'installer');
    const files = await collectReleaseArtifacts(folder);
    assert.equal(files.size,3);
    assert.equal(files.get(artifact),path.join(folder,'mac/desktop',artifact));
    assert.ok(files.has('mac-assessment.json'));
    await writeFile(path.join(folder,'windows/desktop',artifact),'different installer');
    await assert.rejects(collectReleaseArtifacts(folder),/Duplicate release artifact/);
  } finally {await rm(folder,{recursive:true,force:true});}
});
