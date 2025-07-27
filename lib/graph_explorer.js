const STATE = require('./STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)

module.exports = graph_explorer

async function graph_explorer(opts) {
/******************************************************************************
  1. COMPONENT INITIALIZATION
    Set up state, variables, DOM, and watchers.
******************************************************************************/
  const { sdb } = await get(opts.sid)
  const { drive } = sdb

  let vertical_scroll_value = 0
  let horizontal_scroll_value = 0
  let selected_instance_paths = []
  let confirmed_instance_paths = []
  let all_entries = {}
  let instance_states = {}
  let view = []
  let drive_updated_by_scroll = false
  let is_rendering = false
  
  const el = document.createElement('div')
  el.className = 'graph-explorer-wrapper'
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `<div class="graph-container"></div>`
  const container = shadow.querySelector('.graph-container')

  document.body.style.margin = 0
  
  let scroll_update_pending = false
  container.onscroll = onscroll

  let start_index = 0
  let end_index = 0
  const chunk_size = 50
  const max_rendered_nodes = chunk_size * 3
  const node_height = 16

  const top_sentinel = document.createElement('div')
  const bottom_sentinel = document.createElement('div')
  
  const observer = new IntersectionObserver(handle_sentinel_intersection, {
    root: container,
    rootMargin: '500px 0px',
    threshold: 0
  })
  const on = {
    entries: on_entries,
    style: inject_style,
    runtime: on_runtime
  }
  await sdb.watch(onbatch)
  
  return el

/******************************************************************************
  2. STATE AND DATA HANDLING
    Functions for processing data from the STATE module.
******************************************************************************/
  async function onbatch(batch) {
    if (drive_updated_by_scroll) {
      drive_updated_by_scroll = false
      return
    }
    for (const { type, paths } of batch) {
      if (!paths || paths.length === 0) continue
      const data = await Promise.all(paths.map(async (path) => {
        try {
          const file = await drive.get(path)
          return file ? file.raw : null
        } catch (e) {
          console.error(`Error getting file from drive: ${path}`, e)
          return null
        }
      }))

      const func = on[type]
      func ? func({ data, type, paths }) : fail(data, type)
    }
  }

  function fail (data, type) { throw new Error(`Invalid message type: ${type}`, { cause: { data, type } }) }

  function on_entries({ data }) {
    if (!data || data[0] === null || data[0] === undefined) {
      console.error('Entries data is missing or empty.')
      all_entries = {}
      return
    }
    try {
      const parsed_data = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
      if (typeof parsed_data !== 'object' || parsed_data === null) {
        console.error('Parsed entries data is not a valid object.')
        all_entries = {}
        return
      }
      all_entries = parsed_data
    } catch (e) {
      console.error('Failed to parse entries data:', e)
      all_entries = {}
      return
    }
  
    const root_path = '/'
    if (all_entries[root_path]) {
      const root_instance_path = '|/'
      if (!instance_states[root_instance_path]) {
        instance_states[root_instance_path] = { expanded_subs: true, expanded_hubs: false }
      }
      build_and_render_view()
    } else {
      console.warn('Root path "/" not found in entries. Clearing view.')
      view = []
      if (container) container.replaceChildren()
    }
  }

  function on_runtime ({ data, paths }) {
    let needs_render = false
    const render_nodes_needed = new Set()

    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]
      if (data[i] === null) continue
      
      let value
      try {
        value = typeof data[i] === 'string' ? JSON.parse(data[i]) : data[i]
      } catch (e) {
        console.error(`Failed to parse JSON for ${path}:`, e)
        continue
      }

      switch (true) {
        case path.endsWith('vertical_scroll_value.json'):
          if (typeof value === 'number') vertical_scroll_value = value
          break
        case path.endsWith('horizontal_scroll_value.json'):
          if (typeof value === 'number') horizontal_scroll_value = value
          break
        case path.endsWith('selected_instance_paths.json'): {
          const old_paths = [...selected_instance_paths]
          if (Array.isArray(value)) {
            selected_instance_paths = value
          } else {
            console.warn('selected_instance_paths is not an array, defaulting to empty.', value)
            selected_instance_paths = []
          }
          const changed_paths = [...new Set([...old_paths, ...selected_instance_paths])]
          changed_paths.forEach(p => render_nodes_needed.add(p))
          break
        }
        case path.endsWith('confirmed_selected.json'): {
          const old_paths = [...confirmed_instance_paths]
          if (Array.isArray(value)) {
            confirmed_instance_paths = value
          } else {
            console.warn('confirmed_selected is not an array, defaulting to empty.', value)
            confirmed_instance_paths = []
          }
          const changed_paths = [...new Set([...old_paths, ...confirmed_instance_paths])]
          changed_paths.forEach(p => render_nodes_needed.add(p))
          break
        }
        case path.endsWith('instance_states.json'):
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          instance_states = value
          needs_render = true
        } else console.warn('instance_states is not a valid object, ignoring.', value)
        break
      }
    }

    if (needs_render) {
      build_and_render_view()
    } else if (render_nodes_needed.size > 0) {
      render_nodes_needed.forEach(re_render_node)
    }
  }

  function inject_style({ data }) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(data[0])
    shadow.adoptedStyleSheets = [sheet]
  }

  async function update_runtime_state (name, value) {
    try {
      await drive.put(`runtime/${name}.json`, JSON.stringify(value))
    } catch (e) {
      console.error(`Failed to update runtime state for ${name}:`, e)
    }
  }

/******************************************************************************
  3. VIEW AND RENDERING LOGIC
    Functions for building and rendering the graph view.
******************************************************************************/
  function build_and_render_view(focal_instance_path) {
    if (Object.keys(all_entries).length === 0) {
      console.warn('No entries available to render.')
      return
    }
    const old_view = [...view]
    const old_scroll_top = vertical_scroll_value
    const old_scroll_left = horizontal_scroll_value

    view = build_view_recursive({
      base_path: '/',
      parent_instance_path: '',
      depth: 0,
      is_last_sub : true,
      is_hub: false,
      parent_pipe_trail: [],
      instance_states,
      all_entries
    })

    let new_scroll_top = old_scroll_top

    if (focal_instance_path) {
      const old_toggled_node_index = old_view.findIndex(node => node.instance_path === focal_instance_path)
      const new_toggled_node_index = view.findIndex(node => node.instance_path === focal_instance_path)

      if (old_toggled_node_index !== -1 && new_toggled_node_index !== -1) {
        const index_change = new_toggled_node_index - old_toggled_node_index
        new_scroll_top = old_scroll_top + (index_change * node_height)
      }
    } else if (old_view.length > 0) {
      const old_top_node_index = Math.floor(old_scroll_top / node_height)
      const scroll_offset = old_scroll_top % node_height
      const old_top_node = old_view[old_top_node_index]
      if (old_top_node) {
        const new_top_node_index = view.findIndex(node => node.instance_path === old_top_node.instance_path)
        if (new_top_node_index !== -1) {
          new_scroll_top = (new_top_node_index * node_height) + scroll_offset
        }
      }
    }

    const render_anchor_index = Math.max(0, Math.floor(new_scroll_top / node_height))
    start_index = Math.max(0, render_anchor_index - chunk_size)
    end_index = Math.min(view.length, render_anchor_index + chunk_size)

    const fragment = document.createDocumentFragment()
    for (let i = start_index; i < end_index; i++) {
      if (view[i]) fragment.appendChild(create_node(view[i]))
      else console.warn(`Missing node at index ${i} in view.`)
    }

    container.replaceChildren()
    container.appendChild(top_sentinel)
    container.appendChild(fragment)
    container.appendChild(bottom_sentinel)

    top_sentinel.style.height = `${start_index * node_height}px`
    bottom_sentinel.style.height = `${(view.length - end_index) * node_height}px`

    observer.observe(top_sentinel)
    observer.observe(bottom_sentinel)

    requestAnimationFrame(() => {
      container.scrollTop = new_scroll_top
      container.scrollLeft = old_scroll_left
    })
  }

  function build_view_recursive({
    base_path,
    parent_instance_path,
    parent_base_path = null,
    depth,
    is_last_sub,
    is_hub,
    is_first_hub = false,
    parent_pipe_trail,
    instance_states,
    all_entries
  }) {
    const instance_path = `${parent_instance_path}|${base_path}`
    const entry = all_entries[base_path]
    if (!entry) return []
    
    if (!instance_states[instance_path]) {
      instance_states[instance_path] = {
        expanded_subs: false,
        expanded_hubs: false
      }
    }
    const state = instance_states[instance_path]
    const is_hub_on_top = (base_path === all_entries[parent_base_path]?.hubs?.[0]) || (base_path === '/')
    const children_pipe_trail = [...parent_pipe_trail]
    let last_pipe = null
    if (depth > 0) {
      if (is_hub) {
        last_pipe = [...parent_pipe_trail]
        if (is_last_sub) { 
          children_pipe_trail.pop()
          children_pipe_trail.push(true)
          last_pipe.pop()
          last_pipe.push(true)
          if (is_first_hub) {
            last_pipe.pop()
            last_pipe.push(false)
          }
        }
        if (is_hub_on_top && !is_last_sub) {
          last_pipe.pop()
          last_pipe.push(true)
          children_pipe_trail.pop()
          children_pipe_trail.push(true)
        }
        if (is_first_hub) {
          children_pipe_trail.pop()
          children_pipe_trail.push(false)
        }
      }
      children_pipe_trail.push(is_hub || !is_last_sub)
    }

    let current_view = []
    if (state.expanded_hubs && Array.isArray(entry.hubs)) {
      entry.hubs.forEach((hub_path, i, arr) => {
        current_view = current_view.concat(
          build_view_recursive({
            base_path: hub_path,
            parent_instance_path: instance_path,
            parent_base_path: base_path,
            depth: depth + 1,
            is_last_sub : i === arr.length - 1,
            is_hub: true,
            is_first_hub: is_hub ? is_hub_on_top : false,
            parent_pipe_trail: children_pipe_trail,
            instance_states,
            all_entries
          })
        )
      })
    }

    current_view.push({
      base_path,
      instance_path,
      depth,
      is_last_sub,
      is_hub,
      pipe_trail: ((is_hub && is_last_sub) || (is_hub && is_hub_on_top)) ? last_pipe : parent_pipe_trail,
      is_hub_on_top
    })

    if (state.expanded_subs && Array.isArray(entry.subs)) {
      entry.subs.forEach((sub_path, i, arr) => {
        current_view = current_view.concat(
          build_view_recursive({
            base_path: sub_path,
            parent_instance_path: instance_path,
            depth: depth + 1,
            is_last_sub: i === arr.length - 1,
            is_hub: false,
            parent_pipe_trail: children_pipe_trail,
            instance_states,
            all_entries
          })
        )
      })
    }
    return current_view
  }
  
  /******************************************************************************
 4. NODE CREATION AND GRAPH BUILDING
   Functions for creating nodes in the graph.
   ******************************************************************************/
  
  function create_node({ base_path, instance_path, depth, is_last_sub, is_hub, pipe_trail, is_hub_on_top }) {
    const entry = all_entries[base_path]
    if (!entry) {
      console.error(`Entry not found for path: ${base_path}. Cannot create node.`)
      const err_el = document.createElement('div')
      err_el.className = 'node error'
      err_el.textContent = `Error: Missing entry for ${base_path}`
      return err_el
    }
    
    let state = instance_states[instance_path]
    if (!state) {
      console.warn(`State not found for instance: ${instance_path}. Using default.`)
      state = { expanded_subs: false, expanded_hubs: false }
      instance_states[instance_path] = state
    }

    const el = document.createElement('div')
    el.className = `node type-${entry.type || 'unknown'}`
    el.dataset.instance_path = instance_path
    if (selected_instance_paths.includes(instance_path)) el.classList.add('selected')
    if (confirmed_instance_paths.includes(instance_path)) el.classList.add('confirmed')

    const has_hubs = Array.isArray(entry.hubs) && entry.hubs.length > 0
    const has_subs = Array.isArray(entry.subs) && entry.subs.length > 0
    
    if (depth) {
      el.style.paddingLeft = '17.5px'
    }

    if (base_path === '/' && instance_path === '|/') {
      const { expanded_subs } = state
      const prefix_class_name = expanded_subs ? 'tee-down' : 'line-h'
      const prefix_class = has_subs ? 'prefix clickable' : 'prefix'
      el.innerHTML = `<div class="wand">🪄</div><span class="${prefix_class} ${prefix_class_name}"></span><span class="name clickable">/🌐</span>`

      const wand_el = el.querySelector('.wand')
      if (wand_el) wand_el.onclick = reset

      if (has_subs) {
        const prefix_el = el.querySelector('.prefix')
        if (prefix_el) prefix_el.onclick = () => toggle_subs(instance_path)
      }

      const name_el = el.querySelector('.name')
      if (name_el) name_el.onclick = (ev) => select_node(ev, instance_path, base_path)

      return el
    }

    const prefix_class_name = get_prefix({ is_last_sub, has_subs, state, is_hub, is_hub_on_top })
    const pipe_html = pipe_trail.map(should_pipe => `<span class="${should_pipe ? 'pipe' : 'blank'}"></span>`).join('')
    
    const prefix_class = has_subs ? 'prefix clickable' : 'prefix'
    const icon_class = (has_hubs && base_path !== '/') ? 'icon clickable' : 'icon'

    el.innerHTML = `
    <span class="indent">${pipe_html}</span>
      <span class="${prefix_class} ${prefix_class_name}"></span>
      <span class="${icon_class}"></span>
      <span class="name clickable">${entry.name || base_path}</span>
    `

    if(has_hubs && base_path !== '/') {
      const icon_el = el.querySelector('.icon')
      if (icon_el) icon_el.onclick = () => toggle_hubs(instance_path)
    }

    if(has_subs) {
      const prefix_el = el.querySelector('.prefix')
      if (prefix_el) prefix_el.onclick = () => toggle_subs(instance_path)
    }

    const name_el = el.querySelector('.name')
    if (name_el) name_el.onclick = (ev) => select_node(ev, instance_path, base_path)
    
    if (selected_instance_paths.includes(instance_path) || confirmed_instance_paths.includes(instance_path)) {
      const checkbox_div = document.createElement('div')
      checkbox_div.className = 'confirm-wrapper'
      const is_confirmed = confirmed_instance_paths.includes(instance_path)
      checkbox_div.innerHTML = `<input type="checkbox" ${is_confirmed ? 'checked' : ''}>`
      const checkbox_input = checkbox_div.querySelector('input')
      if (checkbox_input) checkbox_input.onchange = (ev) => handle_confirm(ev, instance_path)
      el.appendChild(checkbox_div)
    }

    return el
  }

  function re_render_node (instance_path) {
    const node_data = view.find(n => n.instance_path === instance_path)
    if (node_data) {
      const old_node_el = shadow.querySelector(`[data-instance_path="${CSS.escape(instance_path)}"]`)
      if (old_node_el) {
        const new_node_el = create_node(node_data)
        old_node_el.replaceWith(new_node_el)
      }
    }
  }

  function get_prefix({ is_last_sub, has_subs, state, is_hub, is_hub_on_top }) {
    if (!state) {
      console.error('get_prefix called with invalid state.')
      return 'middle-line'
    }
    const { expanded_subs, expanded_hubs } = state
    if (is_hub) {
      if (is_hub_on_top) {
        if (expanded_subs && expanded_hubs) return 'top-cross'
        if (expanded_subs) return 'top-tee-down'
        if (expanded_hubs) return 'top-tee-up'
        return 'top-line'
      } else {
        if (expanded_subs && expanded_hubs) return 'middle-cross'
        if (expanded_subs) return 'middle-tee-down'
        if (expanded_hubs) return 'middle-tee-up'
        return 'middle-line'
      }
    } else if (is_last_sub) {
      if (expanded_subs && expanded_hubs) return 'bottom-cross'
      if (expanded_subs) return 'bottom-tee-down'
      if (expanded_hubs) return has_subs ? 'bottom-tee-up' : 'bottom-light-tee-up'
      return has_subs ? 'bottom-line' : 'bottom-light-line'
    } else {
      if (expanded_subs && expanded_hubs) return 'middle-cross'
      if (expanded_subs) return 'middle-tee-down'
      if (expanded_hubs) return has_subs ? 'middle-tee-up' : 'middle-light-tee-up'
      return has_subs ? 'middle-line' : 'middle-light-line'
    }
  }
  
  /******************************************************************************
    5. VIEW MANIPULATION
      Functions for toggling view states, selecting, confirming nodes and resetting graph.
  ******************************************************************************/
  function select_node(ev, instance_path) {
    if (ev.ctrlKey) {
      const new_selected_paths = [...selected_instance_paths]
      const index = new_selected_paths.indexOf(instance_path)
      if (index > -1) {
        new_selected_paths.splice(index, 1)
      } else {
        new_selected_paths.push(instance_path)
      }
      update_runtime_state('selected_instance_paths', new_selected_paths)
    } else {
      update_runtime_state('selected_instance_paths', [instance_path])
    }
  }

  function handle_confirm(ev, instance_path) {
    if (!ev.target) return console.warn('Checkbox event target is missing.')
    const is_checked = ev.target.checked
    const new_selected_paths = [...selected_instance_paths]
    const new_confirmed_paths = [...confirmed_instance_paths]

    if (is_checked) {
      const idx = new_selected_paths.indexOf(instance_path)
      if (idx > -1) new_selected_paths.splice(idx, 1)
      if (!new_confirmed_paths.includes(instance_path)) {
          new_confirmed_paths.push(instance_path)
      }
    } else {
      if (!new_selected_paths.includes(instance_path)) {
          new_selected_paths.push(instance_path)
      }
      const idx = new_confirmed_paths.indexOf(instance_path)
      if (idx > -1) new_confirmed_paths.splice(idx, 1)
    }
    update_runtime_state('selected_instance_paths', new_selected_paths)
    update_runtime_state('confirmed_selected', new_confirmed_paths)
  }

  function toggle_subs(instance_path) {
    if (!instance_states[instance_path]) {
      console.warn(`Toggling subs for non-existent state: ${instance_path}. Creating default state.`)
      instance_states[instance_path] = { expanded_subs: false, expanded_hubs: false }
    }
    const state = instance_states[instance_path]
    state.expanded_subs = !state.expanded_subs
    build_and_render_view(instance_path)
    update_runtime_state('instance_states', instance_states)
  }

  function toggle_hubs(instance_path) {
    if (!instance_states[instance_path]) {
      console.warn(`Toggling hubs for non-existent state: ${instance_path}. Creating default state.`)
      instance_states[instance_path] = { expanded_subs: false, expanded_hubs: false }
    }
    const state = instance_states[instance_path]
    state.expanded_hubs = !state.expanded_hubs
    build_and_render_view(instance_path)
    update_runtime_state('instance_states', instance_states)
  }

  function reset() {
    const root_path = '/'
    const root_instance_path = '|/'
    const new_instance_states = {}
    if (all_entries[root_path]) {
      new_instance_states[root_instance_path] = { expanded_subs: true, expanded_hubs: false }
    }
    update_runtime_state('vertical_scroll_value', 0)
    update_runtime_state('horizontal_scroll_value', 0)
    update_runtime_state('selected_instance_paths', [])
    update_runtime_state('confirmed_selected', [])
    update_runtime_state('instance_states', new_instance_states)
  }

/******************************************************************************
  6. VIRTUAL SCROLLING
    Functions for handling virtual scrolling and DOM cleanup.
******************************************************************************/
  function onscroll() {
    if (scroll_update_pending) return
    scroll_update_pending = true
    requestAnimationFrame(() => {
      if (vertical_scroll_value !== container.scrollTop) {
        vertical_scroll_value = container.scrollTop
        drive_updated_by_scroll = true
        update_runtime_state('vertical_scroll_value', vertical_scroll_value)
      }
      if (horizontal_scroll_value !== container.scrollLeft) {
        horizontal_scroll_value = container.scrollLeft
        drive_updated_by_scroll = true
        update_runtime_state('horizontal_scroll_value', horizontal_scroll_value)
      }
      scroll_update_pending = false
    })
  }

  async function fill_viewport_downwards() {
    if (is_rendering || end_index >= view.length) return
    is_rendering = true
    const container_rect = container.getBoundingClientRect()
    let sentinel_rect = bottom_sentinel.getBoundingClientRect()
    while (end_index < view.length && sentinel_rect.top < container_rect.bottom + 500) {
      render_next_chunk()
      await new Promise(resolve => requestAnimationFrame(resolve))
      sentinel_rect = bottom_sentinel.getBoundingClientRect()
    }
    is_rendering = false
  }

  async function fill_viewport_upwards() {
    if (is_rendering || start_index <= 0) return
    is_rendering = true
    const container_rect = container.getBoundingClientRect()
    let sentinel_rect = top_sentinel.getBoundingClientRect()
    while (start_index > 0 && sentinel_rect.bottom > container_rect.top - 500) {
      render_prev_chunk()
      await new Promise(resolve => requestAnimationFrame(resolve))
      sentinel_rect = top_sentinel.getBoundingClientRect()
    }
    is_rendering = false
  }

  function handle_sentinel_intersection(entries) {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        if (entry.target === top_sentinel) fill_viewport_upwards()
        else if (entry.target === bottom_sentinel) fill_viewport_downwards()
      }
    })
  }

  function render_next_chunk() {
    if (end_index >= view.length) return
    const fragment = document.createDocumentFragment()
    const next_end = Math.min(view.length, end_index + chunk_size)
    for (let i = end_index; i < next_end; i++) if (view[i]) fragment.appendChild(create_node(view[i]))
    container.insertBefore(fragment, bottom_sentinel)
    end_index = next_end
    bottom_sentinel.style.height = `${(view.length - end_index) * node_height}px`
    cleanup_dom(false)
  }

  function render_prev_chunk() {
    if (start_index <= 0) return
    const fragment = document.createDocumentFragment()
    const prev_start = Math.max(0, start_index - chunk_size)
    for (let i = prev_start; i < start_index; i++) if (view[i]) fragment.appendChild(create_node(view[i]))
    container.insertBefore(fragment, top_sentinel.nextSibling)
    start_index = prev_start
    top_sentinel.style.height = `${start_index * node_height}px`
    cleanup_dom(true)
  }

  function cleanup_dom(is_scrolling_up) {
    const rendered_count = end_index - start_index
    if (rendered_count <= max_rendered_nodes) return

    const to_remove_count = rendered_count - max_rendered_nodes
    if (is_scrolling_up) {
      for (let i = 0; i < to_remove_count; i++) {
        const temp = bottom_sentinel.previousElementSibling
        if (temp && temp !== top_sentinel) {
          temp.remove()
        }
      }
      end_index -= to_remove_count
      bottom_sentinel.style.height = `${(view.length - end_index) * node_height}px`
    } else {
      for (let i = 0; i < to_remove_count; i++) {
        const temp = top_sentinel.nextElementSibling
        if (temp && temp !== bottom_sentinel) {
          temp.remove()
        }
      }
      start_index += to_remove_count
      top_sentinel.style.height = `${start_index * node_height}px`
    }
  }
}

/******************************************************************************
  7. FALLBACK CONFIGURATION
    Provides default data and API for the component.
******************************************************************************/
function fallback_module() {
  return {
    api: fallback_instance
  }
  function fallback_instance() {
    return {
      drive: {
        'entries/': {
          'entries.json': { $ref: 'entries.json' }
        },
        'style/': {
          'theme.css': {
            raw: `
              .graph-container, .node {
                font-family: monospace;
              }
              .graph-container {
                color: #abb2bf;
                background-color: #282c34;
                padding: 10px;
                height: 500px; /* Or make it flexible */
                overflow: auto;
              }
              .node {
                display: flex;
                align-items: center;
                white-space: nowrap;
                cursor: default;
                height: 16px; /* Important for scroll calculation */
              }
              .node.error {
                color: red;
              }
              .node.selected {
                background-color: #776346;
              }
              .node.confirmed {
                background-color: #774346;
              }
              .confirm-wrapper {
                margin-left: auto;
                padding-left: 10px;
              }
              .indent {
                display: flex;
              }
              .pipe {
                text-align: center;
              }
              .pipe::before { content: '┃'; }
              .blank {
                width: 8.5px;
                text-align: center;
              }
              .clickable {
                cursor: pointer;
              }
              .prefix, .icon {
                margin-right: 2px;
              }
              .top-cross::before { content: '┏╋'; }
              .top-tee-down::before { content: '┏┳'; }
              .top-tee-up::before { content: '┏┻'; }
              .top-line::before { content: '┏━'; }
              .middle-cross::before { content: '┣╋'; }
              .middle-tee-down::before { content: '┣┳'; }
              .middle-tee-up::before { content: '┣┻'; }
              .middle-line::before { content: '┣━'; }
              .bottom-cross::before { content: '┗╋'; }
              .bottom-tee-down::before { content: '┗┳'; }
              .bottom-tee-up::before { content: '┗┻'; }
              .bottom-line::before { content: '┗━'; }
              .bottom-light-tee-up::before { content: '┖┸'; }
              .bottom-light-line::before { content: '┖─'; }
              .middle-light-tee-up::before { content: '┠┸'; }
              .middle-light-line::before { content: '┠─'; }
              .tee-down::before { content: '┳'; }
              .line-h::before { content: '━'; }
              .icon { display: inline-block; text-align: center; }
              .name { flex-grow: 1; }
              .node.type-root > .icon::before { content: '🌐'; }
              .node.type-folder > .icon::before { content: '📁'; }
              .node.type-html-file > .icon::before { content: '📄'; }
              .node.type-js-file > .icon::before { content: '📜'; }
              .node.type-css-file > .icon::before { content: '🎨'; }
              .node.type-json-file > .icon::before { content: '📝'; }
              .node.type-file > .icon::before { content: '📄'; }
            `
          }
        },
        'runtime/': {
          'vertical_scroll_value.json': { raw: '0' },
          'horizontal_scroll_value.json': { raw: '0' },
          'selected_instance_paths.json': { raw: '[]' },
          'confirmed_selected.json': { raw: '[]' },
          'instance_states.json': { raw: '{}' }
        }
      }
    }
  }
}
