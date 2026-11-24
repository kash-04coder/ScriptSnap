// Vercel entry point.
//
// Vercel's zero-config Express support only detects `app.js`, `index.js`,
// `server.js` (repo root) or `src/{app,index,server}.*` — not `server/index.js`,
// which is the long-running entry used by `npm start`. Exporting the app from a
// detected filename makes Vercel build the whole Express app as a single
// function, so `/api/*` works alongside the static frontend.
//
// `server/index.js` remains the local/production server (`app.listen`).
import { createApp } from './server/app.js'

export default createApp()
