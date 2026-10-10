import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../theme.css', import.meta.url), 'utf8');
const match = /function githubPreviewUrl\(value\)\{[\s\S]*?\n\}/.exec(app);
assert.ok(match, 'githubPreviewUrl() must be declared');

function preview(value) {
  return runInNewContext(match[0] + '\ngithubPreviewUrl(input)', {
    input: value, URL, encodeURIComponent
  });
}

test('GitHub repositories and deep links use the repository social preview', () => {
  const expected = 'https://opengraph.githubassets.com/1/twostraws/SwiftUI-Agent-Skill';
  assert.equal(preview('https://github.com/twostraws/SwiftUI-Agent-Skill'), expected);
  assert.equal(preview('https://github.com/twostraws/SwiftUI-Agent-Skill/issues/1?tab=comments'), expected);
  assert.equal(preview('https://github.com/twostraws/SwiftUI-Agent-Skill/pull/2'), expected);
  assert.equal(preview('https://github.com/flowergorge/moadoogi/'), 'https://opengraph.githubassets.com/1/flowergorge/moadoogi');
});

test('Non-repositories, deceptive hosts and malformed links keep their fallback', () => {
  for (const url of [
    '', 'not a URL', 'https://github.com/twostraws',
    'https://github.com/features/copilot', 'https://github.com/settings/profile',
    'https://gist.github.com/twostraws/abcdef',
    'https://github.com.evil.example/twostraws/SwiftUI-Agent-Skill',
    'javascript:alert(1)', 'https://github.com/twostraws/%22%3Ebad'
  ]) assert.equal(preview(url), '', url);
});

test('GitHub preview renders only in detail view with a working image fallback', () => {
  assert.match(app, /\.preview-art\.github/);
  assert.match(app, /image\.src=githubImage/);
  assert.match(app, /image\.addEventListener\('error'/);
  assert.match(app, /frame\.replaceWith\(placeholder\)/);
  assert.match(css, /\.github-preview-box\{/);
  assert.match(css, /aspect-ratio:2\/1/);
});
