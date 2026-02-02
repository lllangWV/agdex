/**
 * FFmpeg documentation provider
 *
 * FFmpeg is a complete, cross-platform solution for recording,
 * converting and streaming audio and video.
 * https://github.com/FFmpeg/FFmpeg
 */
import type { DocProvider, VersionResult } from '../types'

function detectVersion(): VersionResult {
  // Check if ffmpeg is installed and get version
  try {
    const { execSync } = require('child_process')
    const output = execSync('ffmpeg -version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    // Parse version from output like "ffmpeg version 6.1.1 Copyright..."
    const versionMatch = output.match(/ffmpeg version (\d+\.\d+(?:\.\d+)?)/)
    if (versionMatch) {
      return { version: versionMatch[1] }
    }
  } catch {
    // ffmpeg not installed
  }

  return {
    version: null,
    error: 'Could not detect FFmpeg version. Use --fw-version to specify.',
  }
}

export const ffmpegProvider: DocProvider = {
  name: 'ffmpeg',
  displayName: 'FFmpeg',
  repo: 'FFmpeg/FFmpeg',
  docsPath: 'doc',
  extensions: ['.txt', '.md', '.texi'],
  detectVersion,
  // FFmpeg uses tags like n6.1.1 or release/6.1
  versionToTag: (version) => `n${version}`,
  excludePatterns: [
    '**/Makefile',
    '**/*.mak',
    '**/*.sh',
    '**/*.pl',
    '**/*.py',
  ],
  instruction: 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any FFmpeg tasks. FFmpeg is a multimedia framework for audio/video processing.',
}
