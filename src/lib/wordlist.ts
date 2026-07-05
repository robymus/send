import { randomInt } from 'node:crypto';
import { WORDS } from './words.js';

/** Generate a memorable token: 3 random EFF-wordlist words joined with dashes. */
export function generateWordToken(): string {
  return Array.from({ length: 3 }, () => WORDS[randomInt(WORDS.length)]).join('-');
}
