import type { CodeflaiApi } from './index'

declare global {
  interface Window {
    codeflai: CodeflaiApi
  }
}

export {}
