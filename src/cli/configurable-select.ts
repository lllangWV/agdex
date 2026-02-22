import pc from 'picocolors'

type State = 'browsing' | 'editing-version' | 'editing-description'

interface SelectableItem {
  title: string
  value: string
  selected: boolean
  version: string
  description: string
  defaultVersion: string
}

export interface ConfigurableChoice {
  title: string
  value: string
  defaultVersion: string
}

export interface ConfigurableResult {
  value: string
  version: string
  description: string
}

export async function configurableMultiselect(options: {
  message: string
  choices: ConfigurableChoice[]
}): Promise<ConfigurableResult[] | null> {
  return new Promise((resolve) => {
    const items: SelectableItem[] = options.choices.map((c) => ({
      title: c.title,
      value: c.value,
      selected: false,
      version: c.defaultVersion,
      description: '',
      defaultVersion: c.defaultVersion,
    }))

    let cursor = 0
    let state: State = 'browsing'
    let editBuffer = ''
    let renderedLines = 0

    const stdin = process.stdin
    const stdout = process.stdout

    const wasRaw = stdin.isRaw
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    function cleanup() {
      stdout.write('\x1b[?25h') // show cursor
      stdin.setRawMode(wasRaw ?? false)
      stdin.removeAllListeners('data')
      stdin.pause()
    }

    function render() {
      // Clear previous render
      if (renderedLines > 0) {
        stdout.write(`\x1b[${renderedLines}A\x1b[0J`)
      }

      const lines: string[] = []
      lines.push(pc.cyan('? ') + pc.bold(options.message))

      if (state === 'browsing') {
        lines.push(pc.gray('  Space: toggle · Tab: configure · Enter: confirm'))
      } else {
        lines.push(pc.gray('  Tab/Enter: next field · Esc: cancel'))
      }
      lines.push('')

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const isCursor = i === cursor
        const checkbox = item.selected ? pc.green('◉') : '○'
        const arrow = isCursor ? pc.cyan('❯ ') : '  '
        const title = isCursor ? pc.cyan(item.title) : item.title

        let configInfo = ''
        if (item.version) {
          configInfo += pc.gray(` (v${item.version})`)
        }
        if (item.description) {
          configInfo += pc.gray(` - ${item.description}`)
        }

        lines.push(`${arrow}${checkbox} ${title}${configInfo}`)

        // Show inline config fields when editing this item
        if (isCursor && state !== 'browsing') {
          const vActive = state === 'editing-version'
          const dActive = state === 'editing-description'

          const vLabel = vActive ? pc.cyan('  Version: ') : pc.gray('  Version: ')
          const vValue = vActive ? editBuffer + pc.inverse(' ') : (item.version || pc.gray('(auto-detect)'))
          lines.push(`     ${vLabel}${vValue}`)

          const dLabel = dActive ? pc.cyan('  Description: ') : pc.gray('  Description: ')
          const dValue = dActive ? editBuffer + pc.inverse(' ') : (item.description || pc.gray('(optional)'))
          lines.push(`     ${dLabel}${dValue}`)
        }
      }

      stdout.write('\x1b[?25l') // hide cursor
      stdout.write(lines.join('\n') + '\n')
      renderedLines = lines.length
    }

    function onData(key: string) {
      // Ctrl+C
      if (key === '\x03') {
        cleanup()
        // Clear the rendered output
        if (renderedLines > 0) {
          stdout.write(`\x1b[${renderedLines}A\x1b[0J`)
        }
        process.exit(0)
      }

      if (state === 'browsing') {
        if (key === '\x1b[A' || key === 'k') {
          // Up
          cursor = Math.max(0, cursor - 1)
        } else if (key === '\x1b[B' || key === 'j') {
          // Down
          cursor = Math.min(items.length - 1, cursor + 1)
        } else if (key === ' ') {
          // Space - toggle selection
          items[cursor].selected = !items[cursor].selected
        } else if (key === '\t') {
          // Tab - enter config mode
          state = 'editing-version'
          editBuffer = items[cursor].version
          items[cursor].selected = true // auto-select when configuring
        } else if (key === '\r') {
          // Enter - confirm
          cleanup()
          if (renderedLines > 0) {
            stdout.write(`\x1b[${renderedLines}A\x1b[0J`)
          }
          const selected = items.filter((i) => i.selected)

          // Print summary
          stdout.write(pc.cyan('? ') + pc.bold(options.message) + ' ')
          if (selected.length === 0) {
            stdout.write(pc.gray('(none selected)') + '\n')
          } else {
            stdout.write(pc.green(selected.map((s) => s.title).join(', ')) + '\n')
          }

          resolve(
            selected.map((i) => ({
              value: i.value,
              version: i.version,
              description: i.description,
            }))
          )
          return
        }
      } else if (state === 'editing-version' || state === 'editing-description') {
        if (key === '\t' || key === '\r') {
          // Save current field and advance
          if (state === 'editing-version') {
            items[cursor].version = editBuffer || items[cursor].defaultVersion
            state = 'editing-description'
            editBuffer = items[cursor].description
          } else {
            items[cursor].description = editBuffer
            state = 'browsing'
          }
        } else if (key === '\x1b' || key === '\x1b\x1b') {
          // Escape - cancel edit, restore defaults
          if (state === 'editing-version') {
            // Don't save, keep existing
          } else {
            // Don't save, keep existing
          }
          state = 'browsing'
        } else if (key === '\x7f' || key === '\b') {
          // Backspace
          editBuffer = editBuffer.slice(0, -1)
        } else if (key.length === 1 && key.charCodeAt(0) >= 32) {
          // Printable character
          editBuffer += key
        }
      }

      render()
    }

    stdin.on('data', onData)
    render()
  })
}
