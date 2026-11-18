import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LITE_ATTEMPT_TIMEOUT_MS,
  QUALITY_ATTEMPT_TIMEOUT_MS,
  attemptTimeoutFor,
  isLiteTier,
} from '../server/models.js'
import { leadInEnd, stripConversationalFiller } from '../server/text.js'

const strip = (input) => stripConversationalFiller(input)

// --- conversational filler -------------------------------------------------

test('drops a lead-in that shares the line with the text', () => {
  assert.equal(strip('Sure, here is the extracted text: The train leaves at 9.'), 'The train leaves at 9.')
})

test('drops a same-line lead-in and keeps the following lines', () => {
  assert.equal(strip("Here's the text: Groceries\n- milk\n- eggs"), 'Groceries\n- milk\n- eggs')
})

test('drops a same-line preamble from a lite model', () => {
  assert.equal(
    strip('Based on the image provided, here is the text: Meeting notes\n\n- finalise the budget'),
    'Meeting notes\n\n- finalise the budget',
  )
})

test('drops a courtesy opener with a same-line lead-in', () => {
  assert.equal(strip('Certainly! Here is the transcribed text: Call Rita'), 'Call Rita')
})

test('drops a lead-in that sits alone on its line', () => {
  assert.equal(strip('Here is the extracted text:\nline one\nline two'), 'line one\nline two')
})

test('drops an empty lead-in line and the blank line under it', () => {
  assert.equal(strip('Here is the text:\n\nMeeting notes'), 'Meeting notes')
})

test('recognises the lead-in boundary itself', () => {
  assert.equal(leadInEnd('Here is the extracted text: Milk'), 'Here is the extracted text:'.length)
  assert.equal(leadInEnd('Meeting notes'), null)
  assert.equal(leadInEnd('Here are the tasks: 3'), null)
})

test('keeps a note that merely starts with a similar phrase', () => {
  const note = 'Here are the notes:\n- call the bank'
  assert.equal(strip(note), note)
})

test('keeps note headings that look conversational but are not about extraction', () => {
  for (const note of [
    'Here are the tasks:\n- a\n- b',
    'Here is where we meet:\nTuesday at 6',
    'Okay: buy milk',
  ]) {
    assert.equal(strip(note), note)
  }
})

test('unwraps a fenced answer', () => {
  assert.equal(strip('```text\nGroceries\n\n- milk\n```'), 'Groceries\n\n- milk')
})

test('drops a trailing sign-off paragraph', () => {
  assert.equal(strip('Groceries\n\n- milk\n\nHope this helps!'), 'Groceries\n\n- milk')
})

test('keeps a lone "Let me know" line that is the whole note', () => {
  assert.equal(strip('Let me know if you can make it'), 'Let me know if you can make it')
})

test('leaves an ordinary note untouched', () => {
  const note = 'Meeting notes\n\n- finalise the budget by friday\n  - ask rita about the venue\n- book the 9am train'
  assert.equal(strip(note), note)
})

// --- model time budgets ----------------------------------------------------

test('a pinned lite model gets the full window, not the quality leash', () => {
  assert.equal(attemptTimeoutFor('gemini-3.5-flash-lite', 60_000), LITE_ATTEMPT_TIMEOUT_MS)
  assert.equal(LITE_ATTEMPT_TIMEOUT_MS > QUALITY_ATTEMPT_TIMEOUT_MS, true)
})

test('every shipped lite model is recognised as lite tier', () => {
  for (const model of ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest']) {
    assert.equal(isLiteTier(model), true)
    assert.equal(attemptTimeoutFor(model, 60_000), LITE_ATTEMPT_TIMEOUT_MS)
  }
})

test('quality models still get the short leash', () => {
  for (const model of ['gemini-3.8-flash', 'gemini-3.5-flash']) {
    assert.equal(isLiteTier(model), false)
    assert.equal(attemptTimeoutFor(model, 60_000), QUALITY_ATTEMPT_TIMEOUT_MS)
  }
})

test('the remaining chain budget still caps an attempt', () => {
  assert.equal(attemptTimeoutFor('gemini-3.5-flash-lite', 4_000), 4_000)
  assert.equal(attemptTimeoutFor('gemini-3.8-flash', 0), 0)
})
