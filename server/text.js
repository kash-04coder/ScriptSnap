/**
 * Guards the editor against models that answer the prompt instead of obeying it.
 * Only recognised chatter is removed, and only from the edges, so the note's own
 * lines are left alone.
 */

/** Some models wrap the whole answer in a Markdown fence. */
export function unwrapFence(text) {
  const fenced = /^```[a-z]*\r?\n([\s\S]*?)\r?\n```$/i.exec(text.trim())
  return fenced ? fenced[1].trim() : text
}

/** "Sure, " — a courtesy word the model may prefix its chatter with. */
const OPENER = /^(?:sure|certainly|of course|okay|alright)[,!. ]+/i

/** The chatter proper always starts with one of these. */
const LEAD_IN_START = /^(?:based on (?:the|this) image|i(?:'|’)?ve extracted|here(?:'s| is| are)|below is|this is)\b/i

/** ...and must talk about the extraction, not the note's own subject. */
const META = /(extract|handwrit|transcri|the text|this text|the image|from the image)/i

const MAX_LEAD_IN_LENGTH = 300
const MAX_LEAD_IN_BEFORE_COLON = 150

/**
 * Returns the index just past a conversational lead-in, or null when the line is
 * note content. Covers both shapes: the lead-in alone on its line
 * ("Here is the text:") and the lead-in run into the text
 * ("Here is the text: Milk and eggs").
 */
export function leadInEnd(line) {
  if (line.length > MAX_LEAD_IN_LENGTH) return null

  const opener = OPENER.exec(line)
  const offset = opener ? opener[0].length : 0
  const rest = line.slice(offset)

  if (!LEAD_IN_START.test(rest)) return null

  const colon = rest.indexOf(':')
  if (colon === -1 || colon > MAX_LEAD_IN_BEFORE_COLON) return null
  if (!META.test(rest.slice(0, colon))) return null

  return offset + colon + 1
}

/** "Hope this helps!" — a short closing remark, not note content. */
function isSignOff(paragraph) {
  if (paragraph.length > 200) return false
  return /^(?:i )?hope (?:this|that) helps|^(?:please )?let me know|^feel free to|^if you(?:'|’)?d like\b/i.test(
    paragraph,
  )
}

export function stripConversationalFiller(raw) {
  const lines = unwrapFence(raw).split('\n')

  const first = (lines[0] ?? '').trim()
  const cut = leadInEnd(first)
  if (cut !== null) {
    const remainder = first.slice(cut).trim()
    if (remainder) {
      lines[0] = remainder
    } else {
      lines.shift()
      while (lines.length > 0 && lines[0].trim() === '') lines.shift()
    }
  }

  const paragraphs = lines.join('\n').split(/\n{2,}/)
  while (paragraphs.length > 1 && isSignOff(paragraphs[paragraphs.length - 1].trim())) {
    paragraphs.pop()
  }

  return paragraphs.join('\n\n').trim()
}
