/**
 * The game's colours, copied — deliberately — from client/src/styles.css.
 *
 * The API cannot import across the package boundary, and a card that quietly
 * drifts from the board it depicts is worse than a copy someone has to keep in
 * step. If you change a role colour in the client, change it here too.
 */
export const TOKENS = {
  you: '#6c8cff',
  opp: '#f5a524',
  trophy: '#f5c518',
  text: '#e6e8ee',
  muted: '#9aa1b1',
  surface1: '#0f1117',
  surface4: '#1a1d27',
  line2: '#333a4c',
} as const;

export const FONT_DISPLAY = 'Archivo';
export const FONT_BODY = 'Atkinson Hyperlegible';
