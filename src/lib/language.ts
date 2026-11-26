/**
 * The app chrome is English, so `<html lang="en">` stays correct — but the note
 * inside the editor is in whatever language the page was written in. Without a
 * `lang` of its own, a screen reader pronounces Devanagari with an English voice
 * and reads it as gibberish.
 */

const DEVANAGARI = /[\u0900-\u097F]/g
const LATIN = /[A-Za-z\u00C0-\u024F]/g

/**
 * Best-guess BCP-47 tag for extracted text, or `''` to inherit the document's
 * `lang` when the note is Latin script (or empty).
 *
 * Only Devanagari is detected by design: a mostly-English note with one Hindi
 * word keeps the inherited tag, while a Hindi note — or a genuinely code-mixed
 * one where Devanagari matches the Latin count — is announced as Hindi.
 */
export function noteLanguageTag(text: string): string {
  const devanagari = text.match(DEVANAGARI)?.length ?? 0
  if (devanagari === 0) return ''

  const latin = text.match(LATIN)?.length ?? 0
  return devanagari >= latin ? 'hi' : ''
}
