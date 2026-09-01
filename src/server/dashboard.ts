import { getStats, getDb } from './db/index.js'
import { syncDrives } from './drives/registry.js'
import { listUsers } from './auth.js'
import { getStatus } from './status.js'
import type { DashboardData } from '../shared/ipc.js'
import type { ActivityRecord } from '../shared/types.js'

/** Assemble the dashboard payload used by both the HTTP API and the desktop app. */
export async function getDashboard(includeAdmin: boolean): Promise<DashboardData> {
  const stats = getStats()
  const drives = (await syncDrives()).filter((d) => d.registered)

  let activity: ActivityRecord[] = []
  let usersCount = 0
  if (includeAdmin) {
    activity = getDb()
      .prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 50')
      .all() as ActivityRecord[]
    usersCount = listUsers().length
  }

  return {
    transfers: {
      bytesIn: stats.bytes_in || 0,
      bytesOut: stats.bytes_out || 0,
      uploads: stats.uploads || 0,
      downloads: stats.downloads || 0
    },
    drives: drives.map((d) => ({
      uuid: d.uuid,
      label: d.label,
      online: d.online,
      totalBytes: d.totalBytes,
      freeBytes: d.freeBytes
    })),
    server: getStatus(),
    activity,
    usersCount
  }
}
