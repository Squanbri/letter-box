import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyImportantHeuristic,
  looksImportant,
  normalizeTags,
  parseClassificationResponse,
} from './classification.tags';

test('normalizes allowed tags and falls back to other', () => {
  assert.deepEqual(normalizeTags(['Work', 'it', 'work', 'unknown']), ['work', 'it']);
  assert.deepEqual(normalizeTags([]), ['other']);
  assert.deepEqual(normalizeTags('spam, promo'), ['spam', 'promo']);
  assert.deepEqual(normalizeTags(['important', 'work']), ['important', 'work']);
  assert.deepEqual(normalizeTags(['important', 'promo', 'work']), ['promo', 'work']);
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
  assert.deepEqual(
    parseClassificationResponse('{"tags":["important","it"]}'),
    ['important', 'it'],
  );
  assert.deepEqual(
    parseClassificationResponse('{"tags":["important","promo"]}'),
    ['promo'],
  );
});

test('important heuristic catches OTP and security mail', () => {
  assert.equal(
    looksImportant({
      subject: 'Разовый код',
      from: 'security@example.com',
      text: 'Ваш код: 123456',
    }),
    true,
  );
  assert.equal(
    looksImportant({
      subject: "Don't miss today's login reward",
      from: 'no-reply@news.meshy.ai',
      text: 'Come back for rewards',
    }),
    false,
  );
  assert.deepEqual(
    applyImportantHeuristic({
      subject: 'Вход с нового устройства в аккаунт',
      from: 'security@id.mail.ru',
      text: 'Кто-то вошёл',
      tags: ['promo', 'work'],
    }),
    ['important', 'work'],
  );
});
