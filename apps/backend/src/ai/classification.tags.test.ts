import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildClassificationPrompt,
  collapseQuotedHistory,
} from './classification.tags';

test('collapseQuotedHistory keeps top-level quotes and marks deeper nests', () => {
  const input = [
    'Thanks, see below.',
    '',
    'On Mon, Alice wrote:',
    '> Hello',
    '> On Sun, Bob wrote:',
    '> > nested older reply',
    '> > still nested',
    '> ok',
  ].join('\n');

  const collapsed = collapseQuotedHistory(input);
  assert.match(collapsed, /Thanks, see below/);
  assert.match(collapsed, /> Hello/);
  assert.match(collapsed, /deeper quoted history collapsed/);
  assert.doesNotMatch(collapsed, /nested older reply/);
});

test('classification prompt includes full prepared body without 1200 cut', () => {
  const body = 'x'.repeat(2_500);
  const prompt = buildClassificationPrompt({
    subject: 'Hi',
    from: 'a@b.c',
    text: body,
  });
  assert.ok(prompt.includes(body));
  assert.ok(!prompt.includes(`Body: ${body.slice(0, 1200)}\n`));
});
