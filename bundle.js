(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){

},{}],2:[function(require,module,exports){
(function (__filename){(function (){
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
  await drive.list('runtime/').forEach(async path => console.log(path, await drive.get('runtime/' + path)))
  let vertical_scroll_value = 0
  let horizontal_scroll_value = 0
  let selected_instance_paths = []
  let confirmed_instance_paths = []
  let all_entries = {}
  let instance_states = {}
  let view = []
  let drive_updated_by_scroll = false
  
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
  const node_height = 19

  const top_sentinel = document.createElement('div')
  const bottom_sentinel = document.createElement('div')
  
  const observer = new IntersectionObserver(handle_sentinel_intersection, {
    root: container,
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
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file ? file.raw : null)))
      const func = on[type] || fail
      func(data, type, paths)
    }
  }

  function fail (data, type) { throw new Error('invalid message', { cause: { data, type } }) }

  function on_entries(data) {
    all_entries = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    const root_path = '/'
    if (all_entries[root_path]) {
      const root_instance_path = '|/'
      if (!instance_states[root_instance_path]) {
        instance_states[root_instance_path] = { expanded_subs: true, expanded_hubs: false }
      } else {
        build_and_render_view()
      }
    }
  }

  function on_runtime (data, type, paths) {
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]
      if (data[i] === null) continue
      const value = typeof data[i] === 'string' ? JSON.parse(data[i]) : data[i]
      if (path.endsWith('vertical_scroll_value.json')) vertical_scroll_value = value 
      else if (path.endsWith('horizontal_scroll_value.json')) horizontal_scroll_value = value 
      else if (path.endsWith('selected_instance_paths.json')) {
        const old_paths = [...selected_instance_paths]
        selected_instance_paths = value || []
        const changed_paths = [...new Set([...old_paths, ...selected_instance_paths])]
        changed_paths.forEach(re_render_node)
      } else if (path.endsWith('confirmed_selected.json')) {
        const old_paths = [...confirmed_instance_paths]
        confirmed_instance_paths = value || []
        const changed_paths = [...new Set([...old_paths, ...confirmed_instance_paths])]
        changed_paths.forEach(re_render_node)
      } else if (path.endsWith('instance_states.json')) {
        instance_states = value
        build_and_render_view()
      }
    }
  }

  function inject_style(data) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(data[0])
    shadow.adoptedStyleSheets = [sheet]
  }

  async function update_runtime_state (name, value) {
    await drive.put(`runtime/${name}.json`, JSON.stringify(value))
  }

/******************************************************************************
  3. VIEW AND RENDERING LOGIC
    Functions for building and rendering the graph view.
******************************************************************************/
  function build_and_render_view(focal_instance_path) {
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
      fragment.appendChild(create_node(view[i]))
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
    if (state.expanded_hubs && entry.hubs) {
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

    if (state.expanded_subs && entry.subs) {
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
    const state = instance_states[instance_path]
    const el = document.createElement('div')
    el.className = `node type-${entry.type}`
    el.dataset.instance_path = instance_path
    if (selected_instance_paths.includes(instance_path)) el.classList.add('selected')
    if (confirmed_instance_paths.includes(instance_path)) el.classList.add('confirmed')

    const has_hubs = entry.hubs && entry.hubs.length > 0
    const has_subs = entry.subs && entry.subs.length > 0
    
    if (depth) {
      el.style.paddingLeft = '20px'
    }

    if (base_path === '/' && instance_path === '|/') {
      const { expanded_subs } = state
      const prefix_symbol = expanded_subs ? '┬' : '─'
      const prefix_class = has_subs ? 'prefix clickable' : 'prefix'
      el.innerHTML = `<div class="wand">🪄</div><span class="${prefix_class}">${prefix_symbol}</span><span class="name clickable">/🌐</span>`
      el.querySelector('.wand').onclick = reset
      if (has_subs) {
        el.querySelector('.prefix').onclick = () => toggle_subs(instance_path)
      }
      el.querySelector('.name').onclick = (ev) => select_node(ev, instance_path, base_path)
      return el
    }

    const prefix_symbol = get_prefix(is_last_sub, has_subs, state, is_hub, is_hub_on_top)
    const pipe_html = pipe_trail.map(should_pipe => `<span class=${should_pipe ? 'pipe' : 'blank'}>${should_pipe ? '│' : ' '}</span>`).join('')
    
    const prefix_class = has_subs ? 'prefix clickable' : 'prefix'
    const icon_class = (has_hubs && base_path !== '/') ? 'icon clickable' : 'icon'

    el.innerHTML = `
    <span class="indent">${pipe_html}</span>
      <span class="${prefix_class}">${prefix_symbol}</span>
      <span class="${icon_class}"></span>
      <span class="name clickable">${entry.name}</span>
    `
    if(has_hubs && base_path !== '/') el.querySelector('.icon').onclick = () => toggle_hubs(instance_path)
    if(has_subs) el.querySelector('.prefix').onclick = () => toggle_subs(instance_path)
    el.querySelector('.name').onclick = (ev) => select_node(ev, instance_path, base_path)
    
    if (selected_instance_paths.includes(instance_path) || confirmed_instance_paths.includes(instance_path)) {
      const checkbox_div = document.createElement('div')
      checkbox_div.className = 'confirm-wrapper'
      const is_confirmed = confirmed_instance_paths.includes(instance_path)
      checkbox_div.innerHTML = `<input type="checkbox" ${is_confirmed ? 'checked' : ''}>`
      checkbox_div.querySelector('input').onchange = (ev) => handle_confirm(ev, instance_path)
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

  function get_prefix(is_last_sub, has_subs, state, is_hub, is_hub_on_top) {
    const { expanded_subs, expanded_hubs } = state
    if (is_hub) {
      if (is_hub_on_top) {
        if (expanded_subs && expanded_hubs) return '┌┼'
        if (expanded_subs) return '┌┬'
        if (expanded_hubs) return '┌┴'
        return '┌─'
      } else {
        if (expanded_subs && expanded_hubs) return '├┼'
        if (expanded_subs) return '├┬'
        if (expanded_hubs) return '├┴'
        return '├─'
      }
    } else if (is_last_sub) {
      if (expanded_subs && expanded_hubs) return '└┼'
      if (expanded_subs) return '└┬'
      if (expanded_hubs) return '└┴'
      return '└─'
    } else {
      if (expanded_subs && expanded_hubs) return '├┼'
      if (expanded_subs) return '├┬'
      if (expanded_hubs) return '├┴'
      return '├─'
    }
  }
  
  /******************************************************************************
    5. VIEW MANIPULATION
      Functions for toggling view states, selecting, confirming nodes and resetting graph.
  ******************************************************************************/
  function select_node(ev, instance_path, base_path) {
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
    const state = instance_states[instance_path]
    state.expanded_subs = !state.expanded_subs
    build_and_render_view(instance_path)
    update_runtime_state('instance_states', instance_states)
  }

  function toggle_hubs(instance_path) {
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

  function handle_sentinel_intersection(entries) {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        if (entry.target === top_sentinel) render_prev_chunk()
        else if (entry.target === bottom_sentinel) render_next_chunk()
      }
    })
  }

  function render_next_chunk() {
    if (end_index >= view.length) return
    const fragment = document.createDocumentFragment()
    const next_end = Math.min(view.length, end_index + chunk_size)
    for (let i = end_index; i < next_end; i++) {
      fragment.appendChild(create_node(view[i]))
    }
    container.insertBefore(fragment, bottom_sentinel)
    end_index = next_end
    bottom_sentinel.style.height = `${(view.length - end_index) * node_height}px`
    cleanup_dom(false)
  }

  function render_prev_chunk() {
    if (start_index <= 0) return
    const fragment = document.createDocumentFragment()
    const prev_start = Math.max(0, start_index - chunk_size)
    for (let i = prev_start; i < start_index; i++) {
      fragment.appendChild(create_node(view[i]))
    }
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
        if (bottom_sentinel.previousElementSibling && bottom_sentinel.previousElementSibling !== top_sentinel) {
          bottom_sentinel.previousElementSibling.remove()
        }
      }
      end_index -= to_remove_count
      bottom_sentinel.style.height = `${(view.length - end_index) * node_height}px`
    } else {
      for (let i = 0; i < to_remove_count; i++) {
        if (top_sentinel.nextElementSibling && top_sentinel.nextElementSibling !== bottom_sentinel) {
          top_sentinel.nextElementSibling.remove()
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
                height: 19px; /* Important for scroll calculation */
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
              .blank {
                width: 10px;
                text-align: center;
              }
              .clickable {
                cursor: pointer;
              }
              .prefix, .icon {
                margin-right: 6px;
              }
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
}).call(this)}).call(this,"/lib/graph_explorer.js")
},{"./STATE":1}],3:[function(require,module,exports){
const prefix = 'https://raw.githubusercontent.com/alyhxn/playproject/main/'
const init_url = location.hash === '#dev' ? 'web/init.js' : prefix + 'src/node_modules/init.js'
const args = arguments

const has_save = location.hash.includes('#save')
const fetch_opts = has_save ? {} : { cache: 'no-store' }

if (!has_save) {
  localStorage.clear()
}

fetch(init_url, fetch_opts).then(res => res.text()).then(async source => {
  const module = { exports: {} }
  const f = new Function('module', 'require', source)
  f(module, require)
  const init = module.exports
  await init(args, prefix)
  require('./page') // or whatever is otherwise the main entry of our project
})

},{"./page":4}],4:[function(require,module,exports){
(function (__filename,__dirname){(function (){
const STATE = require('../lib/STATE')
const statedb = STATE(__filename)
const { sdb } = statedb(fallback_module)

/******************************************************************************
  PAGE
******************************************************************************/
const app = require('..')
const sheet = new CSSStyleSheet()
config().then(() => boot({ sid: '' }))

async function config() {
  const path = path => new URL(`../src/node_modules/${path}`, `file://${__dirname}`).href.slice(8)
  const html = document.documentElement
  const meta = document.createElement('meta')
  const font = 'https://fonts.googleapis.com/css?family=Nunito:300,400,700,900|Slackey&display=swap'
  const loadFont = `<link href=${font} rel='stylesheet' type='text/css'>`
  html.setAttribute('lang', 'en')
  meta.setAttribute('name', 'viewport')
  meta.setAttribute('content', 'width=device-width,initial-scale=1.0')
  // @TODO: use font api and cache to avoid re-downloading the font data every time
  document.head.append(meta)
  document.head.innerHTML += loadFont
  document.adoptedStyleSheets = [sheet]
  await document.fonts.ready // @TODO: investigate why there is a FOUC
}
/******************************************************************************
  PAGE BOOT
******************************************************************************/
async function boot(opts) {
  // ----------------------------------------
  // ID + JSON STATE
  // ----------------------------------------
  const on = {
    theme: inject
  }
  const { drive } = sdb

  const subs = await sdb.watch(onbatch, on)

  // ----------------------------------------
  // TEMPLATE
  // ----------------------------------------
  const el = document.body
  const shopts = { mode: 'closed' }
  const shadow = el.attachShadow(shopts)
  shadow.adoptedStyleSheets = [sheet]
  // ----------------------------------------
  // ELEMENTS
  // ----------------------------------------
  { // desktop
    shadow.append(await app(subs[0]))
  }
  // ----------------------------------------
  // INIT
  // ----------------------------------------

  async function onbatch(batch) {
    for (const {type, paths} of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      on[type] && on[type](data)
    }
  }
}
async function inject(data) {
  sheet.replaceSync(data.join('\n'))
}

function fallback_module () {
  return {
    _: {
      '..': { 
        $: '', 
        0: '',
        mapping: {
          'style': 'style',
          'entries': 'entries',
          'runtime': 'runtime'
        }
      }
    },
    drive: {
      'theme/': { 'style.css': { raw: "body { font-family: 'system-ui'; }" } },
      'lang/': {}
    }
  }
}
}).call(this)}).call(this,"/web/page.js","/web")
},{"..":2,"../lib/STATE":1}]},{},[3]);
