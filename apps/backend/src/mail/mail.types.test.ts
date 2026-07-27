import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeThreadId,
  normalizeMessageId,
  parseMessageIds,
} from './mail.types';

test('normalizes message ids with angle brackets', () => {
  assert.equal(normalizeMessageId(' <ABC@example.com> '), '<abc@example.com>');
  assert.equal(normalizeMessageId('abc@example.com'), 'abc@example.com');
  assert.equal(normalizeMessageId(''), null);
});

test('parses references header into unique ids', () => {
  assert.deepEqual(
    parseMessageIds('<one@x> <two@x> <one@x>'),
    ['<one@x>', '<two@x>'],
  );
  assert.deepEqual(parseMessageIds(['<a@x>', '<b@x>']), ['<a@x>', '<b@x>']);
});

test('computes thread id from references root then in-reply-to then message-id', () => {
  assert.equal(
    computeThreadId('<c@x>', '<b@x>', '<a@x> <b@x>'),
    '<a@x>',
  );
  assert.equal(
    computeThreadId('<c@x>', '<b@x>', null),
    '<b@x>',
  );
  assert.equal(
    computeThreadId('<c@x>', null, null),
    '<c@x>',
  );
});
