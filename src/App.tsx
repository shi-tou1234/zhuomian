import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type WeatherInfo = {
  city: string
  condition: string
  temperature: number
  feels: number
  humidity: number
  wind: string
  air: string
  icon: string
}

type TodoItem = {
  id: string
  title: string
  time: string
  priority: string
  done: boolean
}

type PriorityLevel = '高' | '中' | '低'

type AgendaItem = {
  id: string
  title: string
  time: string
  location: string
}

const storageKeys = {
  todos: 'dashboard_todos_v1',
  agenda: 'dashboard_agenda_v1',
  city: 'dashboard_city_v1',
  cityMode: 'dashboard_city_mode_v1'
}

const loadStorage = <T,>(key: string, fallback: T) => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const saveStorage = (key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value))
}

const createId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`)

const parseJsonLenient = <T,>(rawText: string): T => {
  const text = rawText.trim()
  try {
    return JSON.parse(text) as T
  } catch {
    const firstObj = text.indexOf('{')
    const firstArr = text.indexOf('[')
    const startCandidates = [firstObj, firstArr].filter((value) => value >= 0)
    const start = startCandidates.length ? Math.min(...startCandidates) : -1
    if (start < 0) throw new Error('invalid json')
    const sliced = text.slice(start)
    const endObj = sliced.lastIndexOf('}')
    const endArr = sliced.lastIndexOf(']')
    const endCandidates = [endObj, endArr].filter((value) => value >= 0)
    const end = endCandidates.length ? Math.max(...endCandidates) : -1
    if (end < 0) throw new Error('invalid json')
    return JSON.parse(sliced.slice(0, end + 1)) as T
  }
}

const fetchJson = async <T,>(url: string, timeoutMs = 8000): Promise<T> => {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        accept: 'application/json,text/plain,*/*'
      }
    })
    if (!response.ok) {
      throw new Error(`bad response: ${response.status}`)
    }
    const text = await response.text()
    return parseJsonLenient<T>(text)
  } finally {
    window.clearTimeout(timer)
  }
}

const normalizeCityName = (raw: string) => {
  const value = raw.trim()
  if (!value) return ''
  const lower = value.toLowerCase()
  if (lower === 'ningbo') return '宁波'
  if (lower === 'beijing') return '北京'
  if (lower === 'shanghai') return '上海'
  if (lower === 'hangzhou') return '杭州'
  if (lower === 'shenzhen') return '深圳'
  if (lower === 'guangzhou') return '广州'
  return value
}

const mapWmoToWeather = (code: number) => {
  if (code === 0) return { text: '晴', icon: '☀️' }
  if (code === 1) return { text: '大部晴朗', icon: '🌤️' }
  if (code === 2) return { text: '多云', icon: '⛅️' }
  if (code === 3) return { text: '阴', icon: '☁️' }
  if (code === 45 || code === 48) return { text: '雾', icon: '🌫️' }
  if (code >= 51 && code <= 57) return { text: '毛毛雨', icon: '🌦️' }
  if (code >= 61 && code <= 67) return { text: '雨', icon: '🌧️' }
  if (code >= 71 && code <= 77) return { text: '雪', icon: '🌨️' }
  if (code >= 80 && code <= 82) return { text: '阵雨', icon: '🌦️' }
  if (code >= 85 && code <= 86) return { text: '阵雪', icon: '🌨️' }
  if (code >= 95) return { text: '雷暴', icon: '⛈️' }
  return { text: '多云', icon: '⛅️' }
}

function PrioritySelect({
  value,
  onChange,
}: {
  value: PriorityLevel
  onChange: (value: PriorityLevel) => void
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        setOpen(false)
        return
      }
      if (target.closest('[data-priority-select-root]')) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const options: PriorityLevel[] = ['高', '中', '低']

  return (
    <div className="select-root" data-priority-select-root>
      <button
        type="button"
        className="select-trigger no-drag"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {value}
        <span className="select-arrow" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="select-menu" role="listbox" aria-label="优先级">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              className={`select-option no-drag ${option === value ? 'selected' : ''}`}
              role="option"
              aria-selected={option === value}
              onClick={() => {
                onChange(option)
                setOpen(false)
              }}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function App() {
  const [now, setNow] = useState(() => new Date())

  const query = new URLSearchParams(window.location.search)
  const desktopMode = query.get('desktop') === '1'
  const moduleView = query.get('module') as null | 'time' | 'weather' | 'todo' | 'agenda'

  const [city, setCity] = useState(() => loadStorage(storageKeys.city, '上海'))
  const [cityMode, setCityMode] = useState<'auto' | 'manual'>(() => loadStorage(storageKeys.cityMode, 'auto'))
  const [isEditingCity, setIsEditingCity] = useState(false)
  const [isLocating, setIsLocating] = useState(false)
  const [weather, setWeather] = useState<WeatherInfo | null>(null)
  const [weatherStatus, setWeatherStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const [todos, setTodos] = useState<TodoItem[]>(() => loadStorage(storageKeys.todos, [] as TodoItem[]))
  const [todoForm, setTodoForm] = useState({ title: '', time: '', priority: '中' })

  const [agenda, setAgenda] = useState<AgendaItem[]>(() => loadStorage(storageKeys.agenda, [] as AgendaItem[]))
  const [agendaForm, setAgendaForm] = useState({ title: '', time: '', location: '' })

  const [activePanel, setActivePanel] = useState<null | 'todo' | 'agenda'>(null)
  const autoLocateOnceRef = useRef(false)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (desktopMode) {
      document.body.classList.add('desktop-mode')
      document.documentElement.classList.add('desktop-mode')
    } else {
      document.body.classList.remove('desktop-mode')
      document.documentElement.classList.remove('desktop-mode')
    }
    return () => {
      document.body.classList.remove('desktop-mode')
      document.documentElement.classList.remove('desktop-mode')
    }
  }, [desktopMode])

  useEffect(() => {
    saveStorage(storageKeys.todos, todos)
  }, [todos])

  useEffect(() => {
    saveStorage(storageKeys.agenda, agenda)
  }, [agenda])

  useEffect(() => {
    saveStorage(storageKeys.city, city)
  }, [city])

  useEffect(() => {
    saveStorage(storageKeys.cityMode, cityMode)
  }, [cityMode])

  useEffect(() => {
    const selectTarget = (eventTarget: EventTarget | null) => {
      if (!eventTarget || !(eventTarget instanceof Element)) return null
      return eventTarget.closest(
        '.card, .list-item, .primary-button, .ghost-button, .tiny-button, .dock-button, .module-button, .peek-row'
      ) as HTMLElement | null
    }

    const onPointerOver = (event: PointerEvent) => {
      const el = selectTarget(event.target)
      if (!el) return
      const related = event.relatedTarget
      if (related && related instanceof Node && el.contains(related)) return
      el.style.setProperty('--glow-hue', String(Math.floor(Math.random() * 360)))
    }

    const onPointerMove = (event: PointerEvent) => {
      const el = selectTarget(event.target)
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
      el.style.setProperty('--mx', `${Math.round(x * 100)}%`)
      el.style.setProperty('--my', `${Math.round(y * 100)}%`)
    }

    window.addEventListener('pointerover', onPointerOver, true)
    window.addEventListener('pointermove', onPointerMove, true)
    return () => {
      window.removeEventListener('pointerover', onPointerOver, true)
      window.removeEventListener('pointermove', onPointerMove, true)
    }
  }, [])

  const fetchWeather = useCallback(async (targetCity: string): Promise<boolean> => {
    const normalized = normalizeCityName(targetCity)
    if (!normalized) {
      setWeatherStatus('error')
      return false
    }
    try {
      setWeatherStatus('loading')

      try {
        const geo = await fetchJson<{
          results?: Array<{
            name: string
            latitude: number
            longitude: number
          }>
        }>(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(normalized)}&count=1&language=zh&format=json`, 5000)

        const first = geo.results?.[0]
        if (!first) throw new Error('no geocoding result')

        const forecast = await fetchJson<{
          current?: {
            temperature_2m: number
            apparent_temperature: number
            relative_humidity_2m: number
            wind_speed_10m: number
            weather_code: number
          }
        }>(
          `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(first.latitude))}&longitude=${encodeURIComponent(String(first.longitude))}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`,
          5000
        )

        const current = forecast.current
        if (!current) throw new Error('no current weather')
        const mapped = mapWmoToWeather(current.weather_code)

        setWeather({
          city: normalized,
          condition: mapped.text,
          temperature: Math.round(current.temperature_2m),
          feels: Math.round(current.apparent_temperature),
          humidity: Math.round(current.relative_humidity_2m),
          wind: `${Math.round(current.wind_speed_10m)} km/h`,
          air: '实时',
          icon: mapped.icon
        })
        setWeatherStatus('ready')
        return true
      } catch {
        const data = await fetchJson<{
          current_condition: Array<{
            temp_C: string
            FeelsLikeC: string
            humidity: string
            windspeedKmph: string
            weatherDesc: Array<{ value: string }>
          }>
        }>(`https://wttr.in/${encodeURIComponent(normalized)}?format=j1`, 6000)

        const current = data.current_condition[0]
        if (!current) throw new Error('No weather data')

        const desc = (current.weatherDesc[0]?.value ?? '').toLowerCase()
        let conditionText = '多云'
        let icon = '⛅️'

        if (desc.includes('sunny') || desc.includes('clear')) { conditionText = '晴'; icon = '☀️' }
        else if (desc.includes('partly cloudy')) { conditionText = '多云'; icon = '⛅️' }
        else if (desc.includes('cloudy') || desc.includes('overcast')) { conditionText = '阴'; icon = '☁️' }
        else if (desc.includes('rain') || desc.includes('drizzle') || desc.includes('shower')) { conditionText = '雨'; icon = '🌧️' }
        else if (desc.includes('snow') || desc.includes('ice') || desc.includes('blizzard')) { conditionText = '雪'; icon = '🌨️' }
        else if (desc.includes('thunder')) { conditionText = '雷暴'; icon = '⛈️' }
        else if (desc.includes('fog') || desc.includes('mist') || desc.includes('haze')) { conditionText = '雾'; icon = '🌫️' }

        setWeather({
          city: normalized,
          condition: conditionText,
          temperature: parseInt(current.temp_C),
          feels: parseInt(current.FeelsLikeC),
          humidity: parseInt(current.humidity),
          wind: `${current.windspeedKmph} km/h`,
          air: '实时',
          icon: icon
        })
        setWeatherStatus('ready')
        return true
      }
    } catch (e) {
      console.error(e)
      setWeatherStatus('error')
      return false
    }
  }, [])

  const locateWeather = useCallback(async () => {
    setIsLocating(true)
    try {
      const ipEndpoints = [
        'https://ipwho.is/',
        'https://ipapi.co/json/',
        'https://geolocation-db.com/json/'
      ]

      for (const endpoint of ipEndpoints) {
        try {
          const data = await fetchJson<{ city?: string }>(endpoint, 3000)
          if (data.city) {
            const cityName = normalizeCityName(data.city)
            const ok = await fetchWeather(cityName)
            if (ok) {
              setCity(cityName)
              setCityMode('auto')
              return
            }
          }
        } catch { continue }
      }
    } finally {
      setIsLocating(false)
    }
  }, [fetchWeather])

  useEffect(() => {
    fetchWeather(city)
    if (cityMode !== 'auto') return
    if (autoLocateOnceRef.current) return
    autoLocateOnceRef.current = true
    locateWeather()
  }, [city, cityMode, fetchWeather, locateWeather])

  const timeText = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(now),
    [now]
  )

  const dateText = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      }).format(now),
    [now]
  )

  const greeting = useMemo(() => {
    const hour = now.getHours()
    if (hour < 6) return '夜深了'
    if (hour < 12) return '早上好'
    if (hour < 18) return '下午好'
    return '晚上好'
  }, [now])

  const todoDone = todos.filter((item) => item.done).length
  const todoRate = todos.length ? Math.round((todoDone / todos.length) * 100) : 0

  const addTodo = () => {
    if (!todoForm.title || !todoForm.time) return
    setTodos((prev) => [
      ...prev,
      {
        id: createId(),
        title: todoForm.title,
        time: todoForm.time,
        priority: todoForm.priority,
        done: false
      }
    ])
    setTodoForm({ title: '', time: '', priority: todoForm.priority })
    if (desktopMode) setActivePanel(null)
  }

  const toggleTodo = (id: string) => {
    setTodos((prev) => prev.map((item) => (item.id === id ? { ...item, done: !item.done } : item)))
  }

  const deleteTodo = (id: string) => {
    setTodos((prev) => prev.filter((item) => item.id !== id))
  }

  const addAgenda = () => {
    if (!agendaForm.title || !agendaForm.time) return
    setAgenda((prev) => [
      ...prev,
      {
        id: createId(),
        title: agendaForm.title,
        time: agendaForm.time,
        location: agendaForm.location || '待定'
      }
    ])
    setAgendaForm({ title: '', time: '', location: '' })
    if (desktopMode) setActivePanel(null)
  }

  const deleteAgenda = (id: string) => {
    setAgenda((prev) => prev.filter((item) => item.id !== id))
  }

  const openModuleWindow = useCallback((module: 'time' | 'weather' | 'todo' | 'agenda') => {
    const url = new URL(window.location.href)
    url.searchParams.set('desktop', '1')
    url.searchParams.set('module', module)
    window.open(url.toString(), '_blank', 'noopener,noreferrer')
  }, [])

  const timeCard = (
    <div className="card time-card">
      <div className="peek-header">
        <div className="time-title">{greeting}</div>
        <div className="module-actions">
          <button className="module-button no-drag" type="button" onClick={() => openModuleWindow('time')} title="拆分为窗口">
            ⧉
          </button>
          {moduleView ? (
            <button className="module-button no-drag" type="button" onClick={() => window.close()} title="关闭窗口">
              ×
            </button>
          ) : null}
        </div>
      </div>
      <div className="time">{timeText}</div>
      <div className="date">{dateText}</div>
      <div className="time-meta">
        <span>待办 {todos.length} 项</span>
        <span>日程 {agenda.length} 项</span>
      </div>
    </div>
  )

  const weatherCard = (
    <div className="card weather-card">
      <div className="peek-header">
        <div className="weather-header">
          <span className="weather-icon">{weather?.icon ?? '🌤️'}</span>
          <div className="weather-info-main">
            <div className="weather-city-row">
              {isEditingCity ? (
                <input
                  autoFocus
                  className="city-input no-drag"
                  defaultValue={city}
                  onBlur={(e) => {
                    setCity(e.target.value.trim() || city)
                    setCityMode('manual')
                    setIsEditingCity(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setCity(e.currentTarget.value.trim() || city)
                      setCityMode('manual')
                      setIsEditingCity(false)
                    }
                  }}
                />
              ) : (
                <div className="weather-city no-drag" onClick={() => setIsEditingCity(true)}>
                  {weather?.city ?? city} <span>✎</span>
                </div>
              )}
              <button
                className="tiny-button no-drag"
                onClick={() => locateWeather()}
                disabled={isLocating}
                type="button"
              >
                {isLocating ? '定位中' : '定位'}
              </button>
            </div>
            <div className="weather-condition">
              {weatherStatus === 'error' ? '获取失败，请重试' : weather?.condition ?? '加载中'}
            </div>
          </div>
        </div>
        <div className="module-actions">
          <button
            className="module-button no-drag"
            type="button"
            onClick={() => openModuleWindow('weather')}
            title="拆分为窗口"
          >
            ⧉
          </button>
          {moduleView ? (
            <button className="module-button no-drag" type="button" onClick={() => window.close()} title="关闭窗口">
              ×
            </button>
          ) : null}
        </div>
      </div>
      <div className="weather-temp">
        {weather ? `${weather.temperature}°` : '--'}
        <span>{weather ? `体感 ${weather.feels}°` : '等待数据'}</span>
      </div>
      <div className="weather-meta">
        <span>湿度 {weather ? `${weather.humidity}%` : '--'}</span>
        <span>风速 {weather ? weather.wind : '--'}</span>
        <span>空气 {weather ? weather.air : '--'}</span>
      </div>
    </div>
  )

  const summaryCard = (
    <div className="card summary-card">
      <div className="summary-title">今日概览</div>
      <div className="summary-grid">
        <div>
          <div className="summary-value">{todoRate}%</div>
          <div className="summary-label">待办完成率</div>
        </div>
        <div>
          <div className="summary-value">{weather ? `${weather.temperature}°` : '--'}</div>
          <div className="summary-label">当前气温</div>
        </div>
        <div>
          <div className="summary-value">{agenda.length}</div>
          <div className="summary-label">日程提醒</div>
        </div>
      </div>
    </div>
  )

  const todoCard = (
    <section className="card todo-card">
      <div className="peek-header">
        <div className="card-title">
          待办事项
          <span className="badge">
            {todoDone}/{todos.length}
          </span>
        </div>
        <div className="module-actions">
          <button
            className="module-button no-drag"
            type="button"
            onClick={() => openModuleWindow('todo')}
            title="拆分为窗口"
          >
            ⧉
          </button>
          {moduleView ? (
            <button className="module-button no-drag" type="button" onClick={() => window.close()} title="关闭窗口">
              ×
            </button>
          ) : null}
        </div>
      </div>
      <div className="card-subtitle">按照优先级聚焦最重要的目标</div>
      <div className="form-grid">
        <input
          className="no-drag"
          placeholder="待办内容"
          value={todoForm.title}
          onChange={(event) => setTodoForm((prev) => ({ ...prev, title: event.target.value }))}
        />
        <input
          className="no-drag"
          placeholder="时间 13:00"
          value={todoForm.time}
          onChange={(event) => setTodoForm((prev) => ({ ...prev, time: event.target.value }))}
        />
        <PrioritySelect
          value={(todoForm.priority as PriorityLevel) || '中'}
          onChange={(value) => setTodoForm((prev) => ({ ...prev, priority: value }))}
        />
        <button className="primary-button no-drag" onClick={addTodo} type="button">
          添加待办
        </button>
      </div>
      <div className="list">
        {todos.length ? (
          todos.map((item) => (
            <button
              key={item.id}
              className={`list-item action-item ${item.done ? 'done' : ''}`}
              onClick={() => toggleTodo(item.id)}
              type="button"
            >
              <div>
                <div className="list-title">{item.title}</div>
                <div className="list-meta">
                  优先级 {item.priority} · {item.time}
                </div>
              </div>
              <div className="list-actions">
                <div className={`status ${item.done ? 'status-done' : 'status-pending'}`}>
                  {item.done ? '已完成' : '待处理'}
                </div>
                <button
                  className="icon-button no-drag"
                  onClick={(event) => {
                    event.stopPropagation()
                    deleteTodo(item.id)
                  }}
                  aria-label="删除待办"
                  title="删除"
                  type="button"
                >
                  ×
                </button>
              </div>
            </button>
          ))
        ) : (
          <div className="empty-state">暂无待办，请添加你的任务</div>
        )}
      </div>
    </section>
  )

  const agendaCard = (
    <section className="card agenda-card">
      <div className="peek-header">
        <div className="card-title">日程</div>
        <div className="module-actions">
          <button
            className="module-button no-drag"
            type="button"
            onClick={() => openModuleWindow('agenda')}
            title="拆分为窗口"
          >
            ⧉
          </button>
          {moduleView ? (
            <button className="module-button no-drag" type="button" onClick={() => window.close()} title="关闭窗口">
              ×
            </button>
          ) : null}
        </div>
      </div>
      <div className="card-subtitle">保持节奏，明确每一个行动节点</div>
      <div className="form-grid">
        <input
          className="no-drag"
          placeholder="日程标题"
          value={agendaForm.title}
          onChange={(event) => setAgendaForm((prev) => ({ ...prev, title: event.target.value }))}
        />
        <input
          className="no-drag"
          placeholder="时间 18:30 - 19:10"
          value={agendaForm.time}
          onChange={(event) => setAgendaForm((prev) => ({ ...prev, time: event.target.value }))}
        />
        <input
          className="no-drag"
          placeholder="地点"
          value={agendaForm.location}
          onChange={(event) => setAgendaForm((prev) => ({ ...prev, location: event.target.value }))}
        />
        <button className="primary-button no-drag" onClick={addAgenda} type="button">
          添加日程
        </button>
      </div>
      <div className="list">
        {agenda.length ? (
          agenda.map((item) => (
            <div key={item.id} className="list-item">
              <div>
                <div className="list-title">{item.title}</div>
                <div className="list-meta">{item.location}</div>
              </div>
              <div className="list-actions">
                <div className="list-time">{item.time}</div>
                <button
                  className="icon-button no-drag"
                  onClick={() => deleteAgenda(item.id)}
                  aria-label="删除日程"
                  title="删除"
                  type="button"
                >
                  ×
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">暂无日程，请添加你的安排</div>
        )}
      </div>
    </section>
  )

  return (
    <div className={`app ${desktopMode ? 'desktop' : ''}`}>
      <svg className="liquid-glass-defs" aria-hidden="true">
        <defs>
          <filter id="liquid-glass-filter" x="-35%" y="-35%" width="170%" height="170%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" seed="2" result="NOISE" />
            <feDisplacementMap in="SourceGraphic" in2="NOISE" scale="28" xChannelSelector="R" yChannelSelector="B" result="DISPLACED" />
            <feColorMatrix
              in="DISPLACED"
              type="matrix"
              values="1 0 0 0 0
                      0 0 0 0 0
                      0 0 0 0 0
                      0 0 0 1 0"
              result="R"
            />
            <feColorMatrix
              in="DISPLACED"
              type="matrix"
              values="0 0 0 0 0
                      0 1 0 0 0
                      0 0 0 0 0
                      0 0 0 1 0"
              result="G"
            />
            <feColorMatrix
              in="DISPLACED"
              type="matrix"
              values="0 0 0 0 0
                      0 0 0 0 0
                      0 0 1 0 0
                      0 0 0 1 0"
              result="B"
            />
            <feBlend in="R" in2="G" mode="screen" result="RG" />
            <feBlend in="RG" in2="B" mode="screen" result="RGB" />
            <feGaussianBlur in="RGB" stdDeviation="0.7" />
          </filter>
        </defs>
      </svg>
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />

      {moduleView === 'todo' ? (
        <main className="grid">
          {todoCard}
        </main>
      ) : moduleView === 'agenda' ? (
        <main className="grid">
          {agendaCard}
        </main>
      ) : (
        <>
          <header className="hero">
            {moduleView === 'time' ? (
              timeCard
            ) : moduleView === 'weather' ? (
              weatherCard
            ) : (
              <>
                {timeCard}
                {weatherCard}
                {summaryCard}
              </>
            )}
          </header>

          {desktopMode && !moduleView ? (
            <>
              <div className="desktop-peek">
                <section className="card">
                  <div className="peek-header">
                    <div className="peek-title">待办</div>
                    <div className="module-actions">
                      <button className="module-button no-drag" type="button" onClick={() => setActivePanel('todo')} title="打开面板">
                        ＋
                      </button>
                      <button className="module-button no-drag" type="button" onClick={() => openModuleWindow('todo')} title="拆分为窗口">
                        ⧉
                      </button>
                    </div>
                  </div>
                  <div className="peek-list">
                    {(todos.length ? [...todos].slice(-2).reverse() : []).map((item) => (
                      <button
                        key={item.id}
                        className="peek-row no-drag"
                        type="button"
                        onClick={() => setActivePanel('todo')}
                      >
                        <div className="peek-row-title">{item.title}</div>
                        <div className="peek-row-meta">{item.time}</div>
                      </button>
                    ))}
                    {!todos.length ? <div className="empty-state">暂无待办</div> : null}
                  </div>
                </section>

                <section className="card">
                  <div className="peek-header">
                    <div className="peek-title">日程</div>
                    <div className="module-actions">
                      <button className="module-button no-drag" type="button" onClick={() => setActivePanel('agenda')} title="打开面板">
                        ＋
                      </button>
                      <button className="module-button no-drag" type="button" onClick={() => openModuleWindow('agenda')} title="拆分为窗口">
                        ⧉
                      </button>
                    </div>
                  </div>
                  <div className="peek-list">
                    {(agenda.length ? [...agenda].slice(-2).reverse() : []).map((item) => (
                      <button
                        key={item.id}
                        className="peek-row no-drag"
                        type="button"
                        onClick={() => setActivePanel('agenda')}
                      >
                        <div className="peek-row-title">{item.title}</div>
                        <div className="peek-row-actions">
                          <div className="peek-row-meta">{item.time}</div>
                          <span
                            className="icon-button no-drag"
                            role="button"
                            tabIndex={0}
                            onClick={(event) => {
                              event.stopPropagation()
                              deleteAgenda(item.id)
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                deleteAgenda(item.id)
                              }
                            }}
                            aria-label="删除日程"
                            title="删除"
                          >
                            ×
                          </span>
                        </div>
                      </button>
                    ))}
                    {!agenda.length ? <div className="empty-state">暂无日程</div> : null}
                  </div>
                </section>
              </div>

              <div className="dock">
                <button className="dock-button no-drag" type="button" onClick={() => setActivePanel('todo')}>
                  待办
                </button>
                <button className="dock-button no-drag" type="button" onClick={() => setActivePanel('agenda')}>
                  日程
                </button>
              </div>

              {activePanel ? (
                <div className="overlay" onClick={() => setActivePanel(null)}>
                  <div className="overlay-panel" onClick={(event) => event.stopPropagation()}>
                    <div className="panel-header">
                      <div className="panel-title">{activePanel === 'todo' ? '待办事项' : '日程'}</div>
                      <button className="icon-button no-drag" type="button" onClick={() => setActivePanel(null)} aria-label="关闭">
                        ×
                      </button>
                    </div>
                    {activePanel === 'todo' ? todoCard : agendaCard}
                  </div>
                </div>
              ) : null}
            </>
          ) : !desktopMode && !moduleView ? (
            <main className="grid">
              {todoCard}
              {agendaCard}
            </main>
          ) : null}
        </>
      )}
    </div>
  )
}

export default App
