import {test} from 'node:test';
import assert from 'node:assert/strict';
import policy from '../desktop/policy.cjs';
test('desktop navigation accepts only its own engine origin', () => {
  assert.equal(policy.isLocalURL('http://127.0.0.1:47671/api/takes/1', 'http://127.0.0.1:47671'), true);
  for (const url of ['https://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'http://127.0.0.1:47672/']) {
    assert.equal(policy.isLocalURL(url, 'http://127.0.0.1:47671'), false);
  }
});
test('external navigation cannot open local files or executable protocols', () => {
  assert.equal(policy.isExternalURL('https://ardour.org/download'), true);
  for (const url of ['file:///tmp/x', 'javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com']) assert.equal(policy.isExternalURL(url), false);
});
test('runtime executable paths use native portable Python layouts', () => {
  assert.match(policy.runtimePaths('/engine', 'win32').python, /runtime[/\\]python.exe$/);
  assert.match(policy.runtimePaths('/engine', 'darwin').python, /runtime[/\\]bin[/\\]python3.11$/);
});
