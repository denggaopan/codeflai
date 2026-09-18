import { describe, expect, it } from 'vitest'

import { parseCloneProgress } from './git-clone-progress'

// Every sample below is verbatim from a real `git clone --progress` run, trailing spaces
// and all: Git pads its `remote:` lines so a shorter refresh overwrites a longer one.
describe('parseCloneProgress', () => {
  it('reads the phase line and its percentage', () => {
    expect(parseCloneProgress('remote: Counting objects:   7% (136/1942)        \r')).toEqual({
      line: 'remote: Counting objects:   7% (136/1942)',
      percent: 7
    })
  })

  it('keeps only the newest refresh when one chunk carries several', () => {
    const chunk = 'Receiving objects:  40% (1479/3697)\rReceiving objects:  41% (1516/3697)\rReceiving objects:  42% (1553/3697)\r'

    expect(parseCloneProgress(chunk)).toEqual({ line: 'Receiving objects:  42% (1553/3697)', percent: 42 })
  })

  it('discards a trailing partial refresh instead of showing half a line', () => {
    // Chunk boundaries fall mid-refresh; the next chunk repeats the phase milliseconds later,
    // so dropping the fragment costs a frame and never shows torn text.
    expect(parseCloneProgress('Receiving objects:  40% (1479/3697)\rReceiving objects:  4')).toEqual({
      line: 'Receiving objects:  40% (1479/3697)',
      percent: 40
    })
  })

  it('reports a line that carries no percentage at all', () => {
    expect(parseCloneProgress('remote: Enumerating objects: 3697, done.        \n')).toEqual({
      line: 'remote: Enumerating objects: 3697, done.'
    })
  })

  it('does not mistake the object counts in a summary line for a percentage', () => {
    const line = 'remote: Total 3697 (delta 1545), reused 1326 (delta 1127), pack-reused 1755 (from 4)'

    expect(parseCloneProgress(`${line}        \n`)).toEqual({ line })
  })

  it('keeps the transfer rate that only Receiving objects reports', () => {
    const line = 'Receiving objects: 100% (3697/3697), 1.79 MiB | 4.59 MiB/s, done.'

    expect(parseCloneProgress(`${line}\n`)).toEqual({ line, percent: 100 })
  })

  it('has nothing to report for a chunk with no complete line in it', () => {
    expect(parseCloneProgress('Receiving objects:  4')).toBeUndefined()
    expect(parseCloneProgress('\r\n')).toBeUndefined()
    expect(parseCloneProgress('')).toBeUndefined()
  })
})
