// Vercel entry point.
//
// Vercel's zero-config Express detection only considers `app.js`, `index.js`,
// `server.js` (repo root) or `src/{app,index,server}.*` — not `server/index.js`,
// which is the long-running entry used by `npm start`. Detecting it is a static
// check on this file, so this module must import `express` itself: importing the
// factory alone gives "No entrypoint found which imports express".
//
// `server/index.js` remains the local/production server (`app.listen`).
import express from 'express'
import { createApp } from './server/app.js'

// The import above is required by Vercel's detector, so keep it genuinely used
// rather than an unused hint: fail loudly if express itself did not load.
if (typeof express !== 'function') {
  throw new Error('The express package failed to load.')
}

export default createApp()
