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
