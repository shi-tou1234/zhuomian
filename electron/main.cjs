const { app, BrowserWindow, globalShortcut, screen } = require('electron')
const path = require('path')

// 增加日志输出
console.log('[Main] Electron process started')

let alwaysOnTopEnabled = true
let clickThroughEnabled = false

const appendDesktopQuery = (url) => {
  try {
    const u = new URL(url)
    if (!u.searchParams.has('desktop')) u.searchParams.set('desktop', '1')
    return u.toString()
  } catch {
    if (url.includes('?')) return `${url}&desktop=1`
    return `${url}?desktop=1`
  }
}

const appendQuery = (url, query) => {
  try {
    const u = new URL(url)
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null) return
      u.searchParams.set(key, String(value))
    })
    return u.toString()
  } catch {
    const pairs = Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&')
    if (!pairs) return url
    if (url.includes('?')) return `${url}&${pairs}`
    return `${url}?${pairs}`
  }
}

const getModuleFromUrl = (url) => {
  try {
    const u = new URL(url)
    const value = u.searchParams.get('module')
    if (value === 'time' || value === 'weather' || value === 'todo' || value === 'agenda') return value
    return null
  } catch {
    return null
  }
}

const getWindowSizeForModule = (module) => {
  if (module === 'time') return { width: 520, height: 260, minWidth: 420, minHeight: 220 }
  if (module === 'weather') return { width: 520, height: 300, minWidth: 420, minHeight: 240 }
  if (module === 'todo') return { width: 620, height: 640, minWidth: 520, minHeight: 520 }
  if (module === 'agenda') return { width: 620, height: 640, minWidth: 520, minHeight: 520 }
  return { width: 520, height: 540, minWidth: 420, minHeight: 360 }
}

const getTitleForModule = (module) => {
  if (module === 'time') return '时钟'
  if (module === 'weather') return '天气'
  if (module === 'todo') return '待办'
  if (module === 'agenda') return '日程'
  return ''
}

const applyWindowBehaviors = (win) => {
  win.setAlwaysOnTop(alwaysOnTopEnabled, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(clickThroughEnabled, { forward: true })
}

const setupEdgeSnap = (win) => {
  const threshold = 18
  let timer = null

  const snap = () => {
    if (win.isDestroyed()) return
    const bounds = win.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const area = display.workArea

    let nextX = bounds.x
    let nextY = bounds.y

    if (Math.abs(bounds.x - area.x) <= threshold) nextX = area.x
    const right = area.x + area.width
    if (Math.abs(bounds.x + bounds.width - right) <= threshold) nextX = right - bounds.width

    if (Math.abs(bounds.y - area.y) <= threshold) nextY = area.y
    const bottom = area.y + area.height
    if (Math.abs(bounds.y + bounds.height - bottom) <= threshold) nextY = bottom - bounds.height

    if (nextX !== bounds.x || nextY !== bounds.y) {
      win.setBounds({ ...bounds, x: nextX, y: nextY }, false)
    }
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(snap, 120)
  }

  win.on('move', schedule)
  win.on('resize', schedule)
  win.on('closed', () => {
    if (timer) clearTimeout(timer)
  })
}

const createWindow = (options = {}) => {
  console.log('[Main] Creating window...')
  const module = options.module || getModuleFromUrl(options.targetUrl || '')
  const size = getWindowSizeForModule(module)
  const title = getTitleForModule(module)
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    backgroundColor: '#00000000',
    transparent: true,
    frame: false,
    roundedCorners: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: !module,
    show: false, // 先隐藏，等待加载完成后显示
    title,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.setTitle(title)
  applyWindowBehaviors(win)
  setupEdgeSnap(win)

  win.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[Main] window.open:', url)
    createWindow({ targetUrl: url })
    return { action: 'deny' }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  console.log('[Main] VITE_DEV_SERVER_URL:', devUrl)

  if (options.targetUrl) {
    const url = appendDesktopQuery(options.targetUrl)
    console.log('[Main] Loading URL:', url)
    win.loadURL(url).catch(e => console.error('[Main] Failed to load URL:', e))
  } else if (devUrl) {
    const url = appendQuery(appendDesktopQuery(devUrl), module ? { module } : {})
    console.log('[Main] Loading URL:', url)
    win.loadURL(url).catch(e => console.error('[Main] Failed to load URL:', e))
  } else {
    const filePath = path.join(__dirname, '..', 'dist', 'index.html')
    console.log('[Main] Loading file:', filePath)
    const query = { desktop: '1', ...(module ? { module } : {}) }
    win.loadFile(filePath, { query }).catch(e => console.error('[Main] Failed to load file:', e))
  }
  
  win.once('ready-to-show', () => {
    console.log('[Main] Window ready to show')
    win.show()
    win.focus()
  })

  win.webContents.on('did-finish-load', () => {
    console.log('[Main] Page loaded successfully')
  })

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Main] Page failed to load:', errorCode, errorDescription)
  })
}

app.whenReady().then(() => {
  console.log('[Main] App ready')
  createWindow()

  globalShortcut.register('CommandOrControl+Alt+T', () => {
    alwaysOnTopEnabled = !alwaysOnTopEnabled
    const focused = BrowserWindow.getFocusedWindow()
    if (focused) {
      focused.setAlwaysOnTop(alwaysOnTopEnabled, 'screen-saver')
    }
    console.log('[Main] Always on top:', alwaysOnTopEnabled)
  })

  globalShortcut.register('CommandOrControl+Alt+P', () => {
    clickThroughEnabled = !clickThroughEnabled
    const focused = BrowserWindow.getFocusedWindow()
    if (focused) {
      focused.setIgnoreMouseEvents(clickThroughEnabled, { forward: true })
    }
    console.log('[Main] Click through:', clickThroughEnabled)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  console.log('[Main] All windows closed')
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
