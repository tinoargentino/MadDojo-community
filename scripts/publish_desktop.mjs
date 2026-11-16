// Publish a complete native release only after the entire build matrix succeeds.
import {validateMacRelease} from './release-policy.mjs';
import {createReadStream} from 'node:fs';
import {readFile, readdir, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const tag = 'v'+metadata.version;
const directory = path.resolve(process.argv[2]);
const repo = 'tinoargentino/MadDojo-community';
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== tag) throw new Error('Release tag must match package.json');
const files = (await readdir(directory)).filter(name => /\.(exe|dmg|zip|AppImage|deb|yml|blockmap)$/.test(name) && !name.startsWith('builder-'));
for (const extension of ['.exe','.dmg','.AppImage','.deb']) {
  if (!files.some(name => name.endsWith(extension))) throw new Error('Missing native release format '+extension);
}
const channel = metadata.version.includes('-') ? metadata.version.split('-')[1].split('.')[0] : 'latest';
for (const name of [channel+'.yml', channel+'-mac.yml', channel+'-linux.yml']) {
  if (!files.includes(name)) throw new Error('Missing updater metadata '+name);
}
const macAssessment = JSON.parse(await readFile(path.join(directory, 'mac-assessment.json'), 'utf8'));
const {unnotarized} = validateMacRelease({version: metadata.version, assessment:macAssessment, assets:files, allowUnnotarizedPreview:process.env.UNNOTARIZED_MAC_PREVIEW === '1'});
const temporary = await mkdtemp(path.join(tmpdir(), 'maddojo-release-'));
const gh = args => execFileSync('gh', [...args, '--repo', repo], {stdio: 'inherit'});
try {
  const sums = [];
  for (const name of files) {
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(path.join(directory,name))) hash.update(bytes);
    const digest = hash.digest('hex');
    if (name === macAssessment.artifact && digest !== macAssessment.artifact_sha256) throw new Error('Mac assessment belongs to a different installer');
    sums.push(digest+'  '+name);
  }
  await writeFile(path.join(directory,'SHA256SUMS'), sums.join('\n')+'\n');
  const body = path.join(temporary, 'notes.md');
  const prerelease = metadata.version.includes('-');
  await writeFile(body, `MadDojo ${metadata.version} desktop edition.\n\nIncludes Windows Setup, macOS DMG/ZIP, and Linux AppImage/DEB with bundled Python, CPU source separation, FFmpeg, and models. No terminal or separate dependencies are needed. Songs and recordings stay in the local library.\n\nHelp → Check for updates downloads a verified release and offers restart to install on supported editions.\n\n${unnotarized ? '**Mac testing build:** The broken beta.1 signature is repaired and the final DMG passed strict code-signature checks. This build is not Apple-notarized and does not pass default Gatekeeper approval. Replace the old MadDojo.app in Applications; macOS may require System Settings → Privacy & Security → Open Anyway for this app. See https://support.apple.com/en-us/102445 . Automatic Mac updates remain unavailable until a Developer ID signed build is installed.\n\n' : ''}${prerelease ? 'Windows previews may be unsigned. Physical audio-device testing and cross-version replacement testing remain necessary before a production release.\n' : ''}`);
  // A draft keeps the update feed invisible until every binary and manifest is present.
  gh(['release','create',tag,'--draft','--target',process.env.GITHUB_SHA || 'main','--title','MadDojo '+metadata.version,'--notes-file',body,...(prerelease ? ['--prerelease'] : [])]);
  gh(['release','upload',tag,...files.map(name=>path.join(directory,name)),path.join(directory,'SHA256SUMS')]);
  gh(['release','edit',tag,'--draft=false']);
} finally {await rm(temporary,{recursive:true,force:true});}
