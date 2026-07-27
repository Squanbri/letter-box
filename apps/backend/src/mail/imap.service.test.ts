import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseClassificationSource,
  prepareClassificationText,
} from './imap.service';

test('parses MIME with mailparser and stores clean text only', async () => {
  const source = Buffer.from([
    'From: sender@example.com',
    'To: recipient@example.com',
    'Subject: Test',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '  Hello,   world!  ',
    'Second=20line.',
  ].join('\r\n'));

  assert.equal(
    await parseClassificationSource(source),
    'Hello, world! Second line.',
  );
});

test('limits classification text to 1500 Unicode characters', () => {
  const prepared = prepareClassificationText(`  ${'🙂'.repeat(1_600)}  `);
  assert.equal(Array.from(prepared).length, 1_500);
  assert.equal(prepared, '🙂'.repeat(1_500));
});
