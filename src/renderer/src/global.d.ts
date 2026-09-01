import type { LocalDriveApi } from '@shared/ipc'

declare global {
  interface Window {
    ld: LocalDriveApi
  }
}

export {}
