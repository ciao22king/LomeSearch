/**
 * Field table shared by the on-disk segment reader, the scoring model and the
 * in-memory index used by the web demo. It lives on its own so the query path
 * does not have to import a module that touches the file system.
 */

export const FIELD_COUNT = 5;
/** Fields that keep token positions: title, headings, body, url. */
export const POSITIONED_FIELDS = 4;

export const FIELD = {
  title: 0,
  heading: 1,
  body: 2,
  url: 3,
  meta: 4,
} as const;

export type FieldLengths = [number, number, number, number, number];

export function emptyLengths(): FieldLengths {
  return [0, 0, 0, 0, 0];
}
