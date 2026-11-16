// Unnotarized Mac releases are an explicit testing option, never a stable default.
export function validateMacRelease({version, assessment, assets, allowUnnotarizedPreview = false}) {
  const prerelease = /^\d+\.\d+\.\d+-[0-9A-Za-z][0-9A-Za-z.-]*$/.test(version);
  if (allowUnnotarizedPreview && !prerelease) throw new Error('Unnotarized Mac publishing is limited to prereleases');
  if (assessment?.signature_valid !== true) throw new Error('Mac code signature is invalid');
  if (!assessment.artifact?.endsWith('.dmg') || !assets.includes(assessment.artifact) || !/^[a-f0-9]{64}$/.test(assessment.artifact_sha256 || '')) {
    throw new Error('Mac assessment must identify the exact installer and checksum');
  }
  if (assessment.distribution_ready === true) return {unnotarized: false};
  if (!allowUnnotarizedPreview) throw new Error('Mac public distribution requires Developer ID, notarization, and Gatekeeper approval');
  return {unnotarized: true};
}
