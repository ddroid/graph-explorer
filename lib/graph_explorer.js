const STATE = require('./STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)

module.exports = graph_explorer

async function graph_explorer(opts) {
  const { sdb } = await get(opts.sid)
  const { drive } = sdb

  let vertical_scroll_value = 0
  let horizontal_scroll_value = 0

  const on = {
    entries: on_entries,
    style: inject_style
  }

  const el = document.createElement('div')
  el.className = 'graph-explorer-wrapper'
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `<div class="graph-container"></div>`
  const container = shadow.querySelector('.graph-container')
  container.onscroll = () => {
    vertical_scroll_value = container.scrollTop
    horizontal_scroll_value = container.scrollLeft
  }

  let all_entries = {}
  let view = []
  const instance_states = {}

  let start_index = 0
  let end_index = 0
  const chunk_size = 50
  const max_rendered_nodes = chunk_size * 3
  const node_height = 22

  const top_sentinel = document.createElement('div')
  const bottom_sentinel = document.createElement('div')

  const observer = new IntersectionObserver(handle_sentinel_intersection, {
    root: container,
    threshold: 0
  })

  await sdb.watch(onbatch)

  return el

  async function onbatch(batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail (data, type) { throw new Error('invalid message', { cause: { data, type } }) }

  function on_entries(data) {
    all_entries = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    const root_path = '/'
    if (all_entries[root_path]) {
      if (!instance_states[root_path]) {
        instance_states[root_path] = { expanded_subs: true, expanded_hubs: false }
      }
      build_and_render_view()
    }
  }

  function inject_style(data) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(data[0])
    shadow.adoptedStyleSheets = [sheet]
  }

  function build_and_render_view(focal_instance_path = null) {
    const old_view = [...view]
    const old_scroll_top = vertical_scroll_value
    const old_scroll_left = horizontal_scroll_value

    const old_focal_index = focal_instance_path
      ? old_view.findIndex(node => node.instance_path === focal_instance_path)
      : -1

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

    const new_focal_index = focal_instance_path
      ? view.findIndex(node => node.instance_path === focal_instance_path)
      : -1

    let new_scroll_top = old_scroll_top

    if (focal_instance_path && old_focal_index !== -1 && new_focal_index !== -1) {
      const scroll_diff = (new_focal_index - old_focal_index) * node_height
      new_scroll_top = old_scroll_top + scroll_diff
    } else {
      const old_top_node_index = Math.floor(old_scroll_top / node_height)
      const old_top_node = old_view[old_top_node_index]
      if (old_top_node) {
        const new_top_node_index = view.findIndex(node => node.instance_path === old_top_node.instance_path)
        if (new_top_node_index !== -1) {
          new_scroll_top = new_top_node_index * node_height
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
      children_pipe_trail.push(is_hub_on_top || !is_last_sub)
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

  function create_node({ base_path, instance_path, depth, is_last_sub, is_hub, pipe_trail, is_hub_on_top }) {
    const entry = all_entries[base_path]
    const state = instance_states[instance_path]
    const el = document.createElement('div')
    el.className = `node type-${entry.type}`
    el.dataset.instance_path = instance_path

    const has_hubs = entry.hubs && entry.hubs.length > 0
    const has_subs = entry.subs && entry.subs.length > 0
    
    if (depth) {
      el.style.paddingLeft = '20px'
    }

    if (base_path === '/' && instance_path === '|/') {
      const { expanded_subs } = state
      const prefix_symbol = expanded_subs ? '🪄┬' : '🪄─'
      const prefix_class = has_subs ? 'prefix clickable' : 'prefix'
      el.innerHTML = `<span class="${prefix_class}">${prefix_symbol}</span><span class="name">/🌐</span>`
      if (has_subs) {
        el.querySelector('.prefix').onclick = () => toggle_subs(instance_path)
        el.querySelector('.name').onclick = () => toggle_subs(instance_path)
      }
      return el
    }

    const prefix_symbol = get_prefix(is_last_sub, has_subs, state, is_hub, is_hub_on_top)
    const pipe_html = pipe_trail.map(should_pipe => `<span class=${should_pipe ? 'pipe' : 'blank'}>${should_pipe ? '│' : ' '}</span>`).join('')
    
    const prefix_class = (!has_hubs || base_path !== '/') ? 'prefix clickable' : 'prefix'
    const icon_class = has_subs ? 'icon clickable' : 'icon'

    el.innerHTML = `
      <span class="indent">${pipe_html}</span>
      <span class="${prefix_class}">${prefix_symbol}</span>
      <span class="${icon_class}"></span>
      <span class="name">${entry.name}</span>
    `
    if(has_hubs && base_path !== '/') el.querySelector('.prefix').onclick = () => toggle_hubs(instance_path)
    if(has_subs) el.querySelector('.icon').onclick = () => toggle_subs(instance_path)
    return el
  }

  function toggle_subs(instance_path) {
    const state = instance_states[instance_path]
    if (state) {
      state.expanded_subs = !state.expanded_subs
      build_and_render_view(instance_path)
    }
  }

  function toggle_hubs(instance_path) {
    const state = instance_states[instance_path]
    if (state) {
      state.expanded_hubs = !state.expanded_hubs
      build_and_render_view(instance_path)
    }
  }
}

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
                height: 22px; /* Important for scroll calculation */
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
        }
      }
    }
  }
}
