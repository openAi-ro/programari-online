/** Inaltimea casetei de mesaj din chat: creste in sus cu textul, pana la 12 randuri sau 40% din ecran. */
export const COMPOSER_MIN_HEIGHT = 48;
const LINE_HEIGHT = 20;
const VERTICAL_CHROME = 13 * 2 + 2;
const MAX_LINES = 12;
const MAX_SCREEN_SHARE = 0.4;

export function composerMaxHeight(windowHeight: number): number {
  const lines = MAX_LINES * LINE_HEIGHT + VERTICAL_CHROME;
  return Math.max(COMPOSER_MIN_HEIGHT, Math.min(lines, Math.floor(windowHeight * MAX_SCREEN_SHARE)));
}

export function composerInputHeight(contentHeight: number, windowHeight: number): number {
  return Math.min(Math.max(contentHeight, COMPOSER_MIN_HEIGHT), composerMaxHeight(windowHeight));
}