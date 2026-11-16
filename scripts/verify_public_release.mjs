// Verify the public installer bytes, rather than treating a source push as delivery.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {collectReleaseArtifacts} from './release-policy.mjs';
const {version} = JSON.parse(await readFile('package.json','utf8'));
const files = await collectReleaseArtifacts(path.resolve(process.argv[2]));
const assessed = JSON.parse(await readFile(files.get('mac-assessment.json'),'utf8'));
assert.equal(assessed.signature_valid,true);
assert.ok(assessed.artifact.includes(`-${version}-mac-`),'Assessment is for another app version');
const base = `https://github.com/tinoargentino/MadDojo-community/releases/download/v${version}/`;
async function fetchAsset(name) {
  const response = await fetch(base+encodeURIComponent(name),{signal:AbortSignal.timeout(180000)});
  if (!response.ok) throw new Error(`Public release file ${name}: HTTP ${response.status}`);
  return response;
}
const sums = new Map((await (await fetchAsset('SHA256SUMS')).text()).trim().split('\n').map(line => {
  const separator=line.indexOf('  ');
  assert.ok(separator===64,'Malformed release checksum manifest');
  return [line.slice(separator+2),line.slice(0,separator)];
}));
assert.equal(sums.get(assessed.artifact),assessed.artifact_sha256);
const hash = createHash('sha256');
let bytes = 0;
for await (const chunk of (await fetchAsset(assessed.artifact)).body) {hash.update(chunk);bytes+=chunk.length;}
const digest = hash.digest('hex');
assert.equal(digest,assessed.artifact_sha256,'Public Mac download differs from the signature-assessed installer');
const channel = version.includes('-') ? version.split('-')[1].split('.')[0] : 'latest';
for (const name of [channel+'.yml',channel+'-mac.yml',channel+'-linux.yml']) {
  const content = await (await fetchAsset(name)).text();
  assert.ok(content.split(/\r?\n/).includes('version: '+version),`Wrong app version in ${name}`);
}
const report = {version,release:`https://github.com/tinoargentino/MadDojo-community/releases/tag/v${version}`,mac_download:base+assessed.artifact,bytes,mac_sha256:digest,signature_valid:true,gatekeeper_accepted:assessed.gatekeeper_accepted,public_download_matches_assessed_dmg:true};
await writeFile('dist/public-release-verification.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
