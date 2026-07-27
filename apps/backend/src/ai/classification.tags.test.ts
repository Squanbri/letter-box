import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTags,
  parseClassificationResponse,
} from './classification.tags';

test('normalizes allowed tags and falls back to other', () => {
  assert.deepEqual(normalizeTags(['Work', 'it', 'work', 'unknown']), ['work', 'it']);
  assert.deepEqual(normalizeTags([]), ['other']);
  assert.deepEqual(normalizeTags('spam, promo'), ['spam', 'promo']);
});

test('parses ollama json and free-form responses', () => {
  assert.deepEqual(
    parseClassificationResponse('{"tags":["news","it"]}'),
    ['news', 'it'],
  );
  assert.deepEqual(
    parseClassificationResponse('Sure.\n{"tags":["games"]}\n'),
    ['games'],
  );
  assert.deepEqual(
    parseClassificationResponse('tags: work finance'),
    ['work', 'finance'],
  );
});
