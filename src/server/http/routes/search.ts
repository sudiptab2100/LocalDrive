import { Router } from 'express'
import { searchFiles } from '../../files.js'
import { requireAuth } from '../middleware.js'
import { hasPermission, getUserHome } from '../../auth.js'
import { scopeOut } from '../../util/fs-safe.js'
import { parentOf } from '../../util/paths.js'

export const searchRouter = Router()

searchRouter.get('/', requireAuth, (req, res) => {
  const q = String(req.query.q || '')
  const drive = req.query.drive ? String(req.query.drive) : undefined
  const includeHidden = req.query.hidden === '1' || req.query.hidden === 'true'
  const hits = searchFiles(q, drive, 200)
  const user = req.user!
  // Only return hits inside the user's own home that they may read, with the
  // home prefix stripped so results stay relative to their private root.
  const visible: typeof hits = []
  for (const h of hits) {
    const segs = h.path.split('/')
    // The app's internal metadata dir is never surfaced, toggle or not.
    if (segs.some((seg) => seg === '.localdrive')) continue
    // Hidden/dotfiles (e.g. macOS "._" sidecars, .DS_Store) and anything nested
    // inside a hidden folder are excluded unless the caller opts in via ?hidden=1.
    if (!includeHidden && segs.some((seg) => seg.startsWith('.'))) continue
    const home = getUserHome(user, h.drive)
    if (home == null) continue
    if (home && h.path !== home && !h.path.startsWith(home + '/')) continue
    if (!hasPermission(user, h.drive, h.isDir ? h.path : parentOf(h.path), 'read')) continue
    const scoped = scopeOut(home, h.path)
    if (home && scoped === '') continue
    visible.push({ ...h, path: scoped })
    if (visible.length >= 100) break
  }
  res.json({ query: q, hits: visible })
})
