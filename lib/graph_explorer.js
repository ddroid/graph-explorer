const STATE = require('./STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)

module.exports = graph_explorer

async function graph_explorer (opts) {
  /******************************************************************************
  1. COMPONENT INITIALIZATION
    - This sets up the initial state, variables, and the basic DOM structure.
    - It also initializes the IntersectionObserver for virtual scrolling and
      sets up the watcher for state changes.
******************************************************************************/
  const { sdb } = await get(opts.sid)
  const { drive } = sdb

  let vertical_scroll_value = 0
  let horizontal_scroll_value = 0
  let selected_instance_paths = []
  let confirmed_instance_paths = []
  let all_entries = {} // Holds the entire graph structure from entries.json.
  let instance_states = {} // Holds expansion state {expanded_subs, expanded_hubs} for each node instance.
  let search_state_instances = {}
  let search_entry_states = {} // Holds expansion state for search mode interactions separately
  let view = [] // A flat array representing the visible nodes in the graph.
  let mode // Current mode of the graph explorer, can be set to 'default', 'menubar' or 'search'. Its value should be set by the `mode` file in the drive.
  let previous_mode
  let search_query = ''
  let drive_updated_by_scroll = false // Flag to prevent `onbatch` from re-rendering on scroll updates.
  let drive_updated_by_toggle = false // Flag to prevent `onbatch` from re-rendering on toggle updates.
  let drive_updated_by_search = false // Flag to prevent `onbatch` from re-rendering on search updates.
  let multi_select_enabled = false // Flag to enable multi-select mode without ctrl key
  let is_rendering = false // Flag to prevent concurrent rendering operations in virtual scrolling.
  let spacer_element = null // DOM element used to manage scroll position when hubs are toggled.
  let spacer_initial_height = 0
  let hub_num = 0 // Counter for expanded hubs.
  let last_clicked_node = null // Track the last clicked node instance path for highlighting.

  const el = document.createElement('div')
  el.className = 'graph-explorer-wrapper'
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <div class="graph-container"></div>
    <div class="searchbar"></div>
    <div class="menubar"></div>
  `
  const searchbar = shadow.querySelector('.searchbar')
  const menubar = shadow.querySelector('.menubar')
  const container = shadow.querySelector('.graph-container')

  document.body.style.margin = 0

  let scroll_update_pending = false
  container.onscroll = onscroll

  let start_index = 0
  let end_index = 0
  const chunk_size = 50
  const max_rendered_nodes = chunk_size * 3
  let node_height

  const top_sentinel = document.createElement('div')
  const bottom_sentinel = document.createElement('div')

  const observer = new IntersectionObserver(handle_sentinel_intersection, {
    root: container,
    rootMargin: '500px 0px',
    threshold: 0
  })

  // Define handlers for different data types from the drive, called by `onbatch`.
  const on = {
    entries: on_entries,
    style: inject_style,
    runtime: on_runtime,
    mode: on_mode
  }
  // Start watching for state changes. This is the main trigger for all updates.
  await sdb.watch(onbatch)

  return el

  /******************************************************************************
  2. STATE AND DATA HANDLING
    - These functions process incoming data from the STATE module's `sdb.watch`.
    - `onbatch` is the primary entry point.
******************************************************************************/
  async function onbatch (batch) {
    // Prevent feedback loops from scroll or toggle actions.
    if (check_and_reset_feedback_flags()) return

    for (const { type, paths } of batch) {
      if (!paths || !paths.length) continue
      const data = await Promise.all(
        paths.map(path =>
          drive
            .get(path)
            .then(file => (file ? file.raw : null))
            .catch(e => {
              console.error(`Error getting file from drive: ${path}`, e)
              return null
            })
        )
      )
      // Call the appropriate handler based on `type`.
      const func = on[type]
      func ? func({ data, paths }) : fail(data, type)
    }
  }

  function fail (data, type) {
    throw new Error(`Invalid message type: ${type}`, { cause: { data, type } })
  }

  function on_entries ({ data }) {
    if (!data || data[0] == null) {
      console.error('Entries data is missing or empty.')
      all_entries = {}
      return
    }
    const parsed_data = parse_json_data(data[0], 'entries.json')
    if (typeof parsed_data !== 'object' || !parsed_data) {
      console.error('Parsed entries data is not a valid object.')
      all_entries = {}
      return
    }
    all_entries = parsed_data

    // After receiving entries, ensure the root node state is initialized and trigger the first render.
    const root_path = '/'
    if (all_entries[root_path]) {
      const root_instance_path = '|/'
      if (!instance_states[root_instance_path]) {
        instance_states[root_instance_path] = {
          expanded_subs: true,
          expanded_hubs: false
        }
      }
      build_and_render_view()
    } else {
      console.warn('Root path "/" not found in entries. Clearing view.')
      view = []
      if (container) container.replaceChildren()
    }
  }

  function on_runtime ({ data, paths }) {
    const on_runtime_paths = {
      'node_height.json': handle_node_height,
      'vertical_scroll_value.json': handle_vertical_scroll,
      'horizontal_scroll_value.json': handle_horizontal_scroll,
      'selected_instance_paths.json': handle_selected_paths,
      'confirmed_selected.json': handle_confirmed_paths,
      'instance_states.json': handle_instance_states,
      'search_entry_states.json': handle_search_entry_states,
      'last_clicked_node.json': handle_last_clicked_node
    }
    let needs_render = false
    const render_nodes_needed = new Set()

    paths.forEach((path, i) => {
      if (data[i] === null) return
      const value = parse_json_data(data[i], path)
      if (value === null) return

      // Extract filename from path and use handler if available
      const filename = path.split('/').pop()
      const handler = on_runtime_paths[filename]
      if (handler) {
        const result = handler({ value, render_nodes_needed })
        if (result?.needs_render) needs_render = true
      }
    })

    if (needs_render) build_and_render_view()
    else if (render_nodes_needed.size > 0) {
      render_nodes_needed.forEach(re_render_node)
    }

    function handle_node_height ({ value }) {
      node_height = value
    }

    function handle_vertical_scroll ({ value }) {
      if (typeof value === 'number') vertical_scroll_value = value
    }

    function handle_horizontal_scroll ({ value }) {
      if (typeof value === 'number') horizontal_scroll_value = value
    }

    function handle_selected_paths ({ value, render_nodes_needed }) {
      selected_instance_paths = process_path_array_update({
        current_paths: selected_instance_paths,
        value,
        render_set: render_nodes_needed,
        name: 'selected_instance_paths'
      })
    }

    function handle_confirmed_paths ({ value, render_nodes_needed }) {
      confirmed_instance_paths = process_path_array_update({
        current_paths: confirmed_instance_paths,
        value,
        render_set: render_nodes_needed,
        name: 'confirmed_selected'
      })
    }

    function handle_instance_states ({ value }) {
      if (typeof value === 'object' && value && !Array.isArray(value)) {
        instance_states = value
        return { needs_render: true }
      } else {
        console.warn('instance_states is not a valid object, ignoring.', value)
      }
    }

    function handle_search_entry_states ({ value }) {
      if (typeof value === 'object' && value && !Array.isArray(value)) {
        search_entry_states = value
        if (mode === 'search') return { needs_render: true }
      } else {
        console.warn('search_entry_states is not a valid object, ignoring.', value)
      }
    }

    function handle_last_clicked_node ({ value, render_nodes_needed }) {
      const old_last_clicked = last_clicked_node
      last_clicked_node = typeof value === 'string' ? value : null
      if (old_last_clicked) render_nodes_needed.add(old_last_clicked)
      if (last_clicked_node) render_nodes_needed.add(last_clicked_node)
    }
  }

  function on_mode ({ data, paths }) {
    const on_mode_paths = {
      'current_mode.json': handle_current_mode,
      'previous_mode.json': handle_previous_mode,
      'search_query.json': handle_search_query,
      'multi_select_enabled.json': handle_multi_select_enabled
    }
    let new_current_mode, new_previous_mode, new_search_query, new_multi_select_enabled

    paths.forEach((path, i) => {
      const value = parse_json_data(data[i], path)
      if (value === null) return

      const filename = path.split('/').pop()
      const handler = on_mode_paths[filename]
      if (handler) {
        const result = handler({ value })
        if (result?.current_mode !== undefined) new_current_mode = result.current_mode
        if (result?.previous_mode !== undefined) new_previous_mode = result.previous_mode
        if (result?.search_query !== undefined) new_search_query = result.search_query
        if (result?.multi_select_enabled !== undefined) new_multi_select_enabled = result.multi_select_enabled
      }
    })

    if (typeof new_search_query === 'string') search_query = new_search_query
    if (new_previous_mode) previous_mode = new_previous_mode
    if (typeof new_multi_select_enabled === 'boolean') {
      multi_select_enabled = new_multi_select_enabled
      render_menubar() // Re-render menubar to update button text
    }

    if (
      new_current_mode &&
      !['default', 'menubar', 'search'].includes(new_current_mode)
    ) {
      console.warn(`Invalid mode "${new_current_mode}" provided. Ignoring update.`)
      return
    }

    if (new_current_mode === 'search' && !search_query) {
      search_state_instances = instance_states
    }
    if (!new_current_mode || mode === new_current_mode) return

    if (mode && new_current_mode === 'search') update_drive_state({ dataset: 'mode', name: 'previous_mode', value: mode })
    mode = new_current_mode
    render_menubar()
    render_searchbar()
    handle_mode_change()
    if (mode === 'search' && search_query) perform_search(search_query)

    function handle_current_mode ({ value }) {
      return { current_mode: value }
    }

    function handle_previous_mode ({ value }) {
      return { previous_mode: value }
    }

    function handle_search_query ({ value }) {
      return { search_query: value }
    }

    function handle_multi_select_enabled ({ value }) {
      return { multi_select_enabled: value }
    }
  }

  function inject_style ({ data }) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(data[0])
    shadow.adoptedStyleSheets = [sheet]
  }

  // Helper to persist component state to the drive.
  async function update_drive_state ({ dataset, name, value }) {
    try {
      await drive.put(`${dataset}/${name}.json`, JSON.stringify(value))
    } catch (e) {
      console.error(`Failed to update ${dataset} state for ${name}:`, e)
    }
  }

  function get_or_create_state (states, instance_path) {
    if (!states[instance_path]) {
      states[instance_path] = { expanded_subs: false, expanded_hubs: false }
    }
    return states[instance_path]
  }

  function calculate_children_pipe_trail ({
    depth,
    is_hub,
    is_last_sub,
    is_first_hub = false,
    parent_pipe_trail,
    parent_base_path,
    base_path,
    all_entries
  }) {
    const children_pipe_trail = [...parent_pipe_trail]
    const is_hub_on_top = base_path === all_entries[parent_base_path]?.hubs?.[0] || base_path === '/'

    if (depth > 0) {
      if (is_hub) {
        if (is_last_sub) {
          children_pipe_trail.pop()
          children_pipe_trail.push(true)
        }
        if (is_hub_on_top && !is_last_sub) {
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
    return { children_pipe_trail, is_hub_on_top }
  }

  // Extracted pipe logic for reuse in both default and search modes
  function calculate_pipe_trail ({
    depth,
    is_hub,
    is_last_sub,
    is_first_hub = false,
    is_hub_on_top,
    parent_pipe_trail,
    parent_base_path,
    base_path,
    all_entries
  }) {
    let last_pipe = null
    const calculated_is_hub_on_top = base_path === all_entries[parent_base_path]?.hubs?.[0] || base_path === '/'
    const final_is_hub_on_top = is_hub_on_top !== undefined ? is_hub_on_top : calculated_is_hub_on_top

    if (depth > 0) {
      if (is_hub) {
        last_pipe = [...parent_pipe_trail]
        if (is_last_sub) {
          last_pipe.pop()
          last_pipe.push(true)
          if (is_first_hub) {
            last_pipe.pop()
            last_pipe.push(false)
          }
        }
        if (final_is_hub_on_top && !is_last_sub) {
          last_pipe.pop()
          last_pipe.push(true)
        }
      }
    }

    const pipe_trail = (is_hub && is_last_sub) || (is_hub && final_is_hub_on_top) ? last_pipe : parent_pipe_trail
    const product = { pipe_trail, is_hub_on_top: final_is_hub_on_top }
    return product
  }

  /******************************************************************************
  3. VIEW AND RENDERING LOGIC AND SCALING
    - These functions build the `view` array and render the DOM.
    - `build_and_render_view` is the main orchestrator.
    - `build_view_recursive` creates the flat `view` array from the hierarchical data.
    - `calculate_mobile_scale` calculates the scale factor for mobile devices.
******************************************************************************/
  function build_and_render_view (focal_instance_path, hub_toggle = false) {
    if (Object.keys(all_entries).length === 0) {
      console.warn('No entries available to render.')
      return
    }

    const old_view = [...view]
    const old_scroll_top = vertical_scroll_value
    const old_scroll_left = horizontal_scroll_value
    let existing_spacer_height = 0
    if (spacer_element && spacer_element.parentNode) existing_spacer_height = parseFloat(spacer_element.style.height) || 0

    // Recursively build the new `view` array from the graph data.
    view = build_view_recursive({
      base_path: '/',
      parent_instance_path: '',
      depth: 0,
      is_last_sub: true,
      is_hub: false,
      parent_pipe_trail: [],
      instance_states,
      all_entries
    })

    const new_scroll_top = calculate_new_scroll_top({
      old_scroll_top,
      old_view,
      focal_path: focal_instance_path
    })
    const render_anchor_index = Math.max(0, Math.floor(new_scroll_top / node_height))
    start_index = Math.max(0, render_anchor_index - chunk_size)
    end_index = Math.min(view.length, render_anchor_index + chunk_size)

    const fragment = document.createDocumentFragment()
    for (let i = start_index; i < end_index; i++) {
      if (view[i]) fragment.appendChild(create_node(view[i]))
    }

    container.replaceChildren(top_sentinel, fragment, bottom_sentinel)
    top_sentinel.style.height = `${start_index * node_height}px`
    bottom_sentinel.style.height = `${(view.length - end_index) * node_height}px`

    observer.observe(top_sentinel)
    observer.observe(bottom_sentinel)

    const set_scroll_and_sync = () => {
      container.scrollTop = new_scroll_top
      container.scrollLeft = old_scroll_left
      vertical_scroll_value = container.scrollTop
    }

    // Handle the spacer element used for keep entries static wrt cursor by scrolling when hubs are toggled.
    handle_spacer_element({
      hub_toggle,
      existing_height: existing_spacer_height,
      new_scroll_top,
      sync_fn: set_scroll_and_sync
    })
  }

  // Traverses the hierarchical `all_entries` data and builds a flat `view` array for rendering.
  function build_view_recursive ({
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

    const state = get_or_create_state(instance_states, instance_path)

    const { children_pipe_trail, is_hub_on_top } = calculate_children_pipe_trail({
      depth,
      is_hub,
      is_last_sub,
      is_first_hub,
      parent_pipe_trail,
      parent_base_path,
      base_path,
      all_entries
    })

    const current_view = []
    // If hubs are expanded, recursively add them to the view first (they appear above the node).
    if (state.expanded_hubs && Array.isArray(entry.hubs)) {
      entry.hubs.forEach((hub_path, i, arr) => {
        current_view.push(
          ...build_view_recursive({
            base_path: hub_path,
            parent_instance_path: instance_path,
            parent_base_path: base_path,
            depth: depth + 1,
            is_last_sub: i === arr.length - 1,
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
      is_first_hub,
      parent_pipe_trail,
      parent_base_path
    })

    // If subs are expanded, recursively add them to the view (they appear below the node).
    if (state.expanded_subs && Array.isArray(entry.subs)) {
      entry.subs.forEach((sub_path, i, arr) => {
        current_view.push(
          ...build_view_recursive({
            base_path: sub_path,
            parent_instance_path: instance_path,
            parent_base_path: base_path,
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
 4. NODE CREATION AND EVENT HANDLING
   - `create_node` generates the DOM element for a single node.
   - It sets up event handlers for user interactions like selecting or toggling.
******************************************************************************/

  function create_node ({
    base_path,
    instance_path,
    depth,
    is_last_sub,
    is_hub,
    is_first_hub,
    parent_pipe_trail,
    parent_base_path,
    is_search_match,
    is_direct_match,
    is_in_original_view,
    query
  }) {
    const entry = all_entries[base_path]
    if (!entry) {
      const err_el = document.createElement('div')
      err_el.className = 'node error'
      err_el.textContent = `Error: Missing entry for ${base_path}`
      return err_el
    }

    const states = mode === 'search' ? search_state_instances : instance_states
    const state = get_or_create_state(states, instance_path)

    const { pipe_trail, is_hub_on_top } = calculate_pipe_trail({
      depth,
      is_hub,
      is_last_sub,
      is_first_hub,
      parent_pipe_trail,
      parent_base_path,
      base_path,
      all_entries
    })

    const el = document.createElement('div')
    el.className = `node type-${entry.type || 'unknown'}`
    el.dataset.instance_path = instance_path

    if (is_search_match) {
      el.classList.add('search-result')
      if (is_direct_match) el.classList.add('direct-match')
      if (!is_in_original_view) el.classList.add('new-entry')
    }

    if (selected_instance_paths.includes(instance_path)) el.classList.add('selected')
    if (confirmed_instance_paths.includes(instance_path)) el.classList.add('confirmed')
    if (last_clicked_node === instance_path) el.classList.add('last-clicked')

    const has_hubs = Array.isArray(entry.hubs) && entry.hubs.length > 0
    const has_subs = Array.isArray(entry.subs) && entry.subs.length > 0

    if (depth) { 
      el.classList.add('left-indent')
      el.style.paddingLeft *= depth
    }

    if (base_path === '/' && instance_path === '|/') return create_root_node({ state, has_subs, instance_path })

    const prefix_class_name = get_prefix({ is_last_sub, has_subs, state, is_hub, is_hub_on_top })
    const pipe_html = pipe_trail.map(p => `<span class="${p ? 'pipe' : 'blank'}"></span>`).join('')
    const prefix_class = has_subs ? 'prefix clickable' : 'prefix'
    const icon_class = has_hubs && base_path !== '/' ? 'icon clickable' : 'icon'
    const entry_name = entry.name || base_path
    const name_html = (is_direct_match && query)
      ? get_highlighted_name(entry_name, query)
      : entry_name

    // Check if this entry appears elsewhere in the view (any duplicate)
    collect_all_duplicate_entries()
    const has_duplicate_entries = has_duplicates(base_path)
    const navigate_button_html = has_duplicate_entries ? '<span class="navigate-to-hub clickable">^</span>' : ''

    el.innerHTML = `
      <span class="indent">${pipe_html}</span>
      <span class="${prefix_class} ${prefix_class_name}"></span>
      <span class="${icon_class}"></span>
      ${navigate_button_html}
      <span class="name clickable">${name_html}</span>
    `

    const icon_el = el.querySelector('.icon')
    if (icon_el && has_hubs && base_path !== '/') {
      icon_el.onclick = mode === 'search'
        ? () => toggle_search_hubs(instance_path)
        : () => toggle_hubs(instance_path)
    }

    const navigate_el = el.querySelector('.navigate-to-hub')
    if (navigate_el) {
      navigate_el.onclick = () => cycle_to_next_duplicate(base_path, instance_path)
    }

    // Add click event to the whole first part (indent + prefix) for expanding/collapsing subs
    if (has_subs) {
      const indent_el = el.querySelector('.indent')
      const prefix_el = el.querySelector('.prefix')

      const toggle_subs_handler = mode === 'search'
        ? () => toggle_search_subs(instance_path)
        : () => toggle_subs(instance_path)

      if (indent_el) indent_el.onclick = toggle_subs_handler
      if (prefix_el) prefix_el.onclick = toggle_subs_handler
    }

    el.querySelector('.name').onclick = ev => mode === 'search' ? search_expand_into_default(instance_path) : select_node(ev, instance_path)

    if (selected_instance_paths.includes(instance_path) || confirmed_instance_paths.includes(instance_path)) el.appendChild(create_confirm_checkbox(instance_path))

    return el
  }

  // `re_render_node` updates a single node in the DOM, used when only its selection state changes.
  function re_render_node (instance_path) {
    const node_data = view.find(n => n.instance_path === instance_path)
    if (node_data) {
      const old_node_el = shadow.querySelector(`[data-instance_path="${CSS.escape(instance_path)}"]`)
      if (old_node_el) old_node_el.replaceWith(create_node(node_data))
    }
  }

  // `get_prefix` determines which box-drawing character to use for the node's prefix. It gives the name of a specific CSS class.
  function get_prefix ({ is_last_sub, has_subs, state, is_hub, is_hub_on_top }) {
    if (!state) {
      console.error('get_prefix called with invalid state.')
      return 'middle-line'
    }

    // Define handlers for different prefix types based on node position
    const on_prefix_types = {
      hub_on_top: get_hub_on_top_prefix,
      hub_not_on_top: get_hub_not_on_top_prefix,
      last_sub: get_last_sub_prefix,
      middle_sub: get_middle_sub_prefix
    }
    // Determine the prefix type based on node position
    let prefix_type
    if (is_hub && is_hub_on_top) prefix_type = 'hub_on_top'
    else if (is_hub && !is_hub_on_top) prefix_type = 'hub_not_on_top'
    else if (is_last_sub) prefix_type = 'last_sub'
    else prefix_type = 'middle_sub'

    const handler = on_prefix_types[prefix_type]

    return handler ? handler({ state, has_subs }) : 'middle-line'

    function get_hub_on_top_prefix ({ state }) {
      const { expanded_subs, expanded_hubs } = state
      if (expanded_subs && expanded_hubs) return 'top-cross'
      if (expanded_subs) return 'top-tee-down'
      if (expanded_hubs) return 'top-tee-up'
      return 'top-line'
    }

    function get_hub_not_on_top_prefix ({ state }) {
      const { expanded_subs, expanded_hubs } = state
      if (expanded_subs && expanded_hubs) return 'middle-cross'
      if (expanded_subs) return 'middle-tee-down'
      if (expanded_hubs) return 'middle-tee-up'
      return 'middle-line'
    }

    function get_last_sub_prefix ({ state, has_subs }) {
      const { expanded_subs, expanded_hubs } = state
      if (expanded_subs && expanded_hubs) return 'bottom-cross'
      if (expanded_subs) return 'bottom-tee-down'
      if (expanded_hubs) return has_subs ? 'bottom-tee-up' : 'bottom-light-tee-up'
      return has_subs ? 'bottom-line' : 'bottom-light-line'
    }

    function get_middle_sub_prefix ({ state, has_subs }) {
      const { expanded_subs, expanded_hubs } = state
      if (expanded_subs && expanded_hubs) return 'middle-cross'
      if (expanded_subs) return 'middle-tee-down'
      if (expanded_hubs) return has_subs ? 'middle-tee-up' : 'middle-light-tee-up'
      return has_subs ? 'middle-line' : 'middle-light-line'
    }
  }

  /******************************************************************************
  5. MENUBAR AND SEARCH
******************************************************************************/
  function render_menubar () {
    const search_button = Object.assign(document.createElement('button'), {
      textContent: 'Search',
      onclick: toggle_search_mode
    })

    const multi_select_button = document.createElement('button')
    multi_select_button.innerHTML = `Multi Select: ${multi_select_enabled ? 'true' : 'false'}`
    multi_select_button.onclick = mode === 'search' ? null : toggle_multi_select

    menubar.replaceChildren(search_button, multi_select_button)
  }

  function render_searchbar () {
    if (mode !== 'search') {
      searchbar.style.display = 'none'
      searchbar.replaceChildren()
      return
    }

    searchbar.style.display = 'flex'
    const search_input = Object.assign(document.createElement('input'), {
      type: 'text',
      placeholder: 'Search entries...',
      className: 'search-input',
      value: search_query,
      oninput: on_search_input
    })

    searchbar.replaceChildren(search_input)
    requestAnimationFrame(() => search_input.focus())
  }

  function handle_mode_change () {
    menubar.style.display = mode === 'default' ? 'none' : 'flex'
    render_searchbar()
    build_and_render_view()
  }

  function toggle_search_mode () {
    if (mode === 'search') {
      search_query = ''
      drive_updated_by_search = true
      update_drive_state({ dataset: 'mode', name: 'search_query', value: '' })
    }
    update_drive_state({ dataset: 'mode', name: 'current_mode', value: mode === 'search' ? previous_mode : 'search' })
    search_state_instances = instance_states
  }

  function toggle_multi_select () {
    multi_select_enabled = !multi_select_enabled
    update_drive_state({ dataset: 'mode', name: 'multi_select_enabled', value: multi_select_enabled })
    render_menubar() // Re-render to update button text
  }

  function on_search_input (event) {
    search_query = event.target.value.trim()
    drive_updated_by_search = true
    update_drive_state({ dataset: 'mode', name: 'search_query', value: search_query })
    if (search_query === '') search_state_instances = instance_states
    perform_search(search_query)
  }

  function perform_search (query) {
    if (!query) return build_and_render_view()
    const original_view = build_view_recursive({
      base_path: '/',
      parent_instance_path: '',
      depth: 0,
      is_last_sub: true,
      is_hub: false,
      parent_pipe_trail: [],
      instance_states,
      all_entries
    })
    const original_view_paths = original_view.map(n => n.instance_path)
    search_state_instances = {}
    const search_view = build_search_view_recursive({
      query,
      base_path: '/',
      parent_instance_path: '',
      parent_base_path: null,
      depth: 0,
      is_last_sub: true,
      is_hub: false,
      is_first_hub: false,
      parent_pipe_trail: [],
      instance_states: search_state_instances,
      all_entries,
      original_view_paths
    })
    render_search_results(search_view, query)
  }

  function build_search_view_recursive ({
    query,
    base_path,
    parent_instance_path,
    parent_base_path = null,
    depth,
    is_last_sub,
    is_hub,
    is_first_hub = false,
    parent_pipe_trail,
    instance_states,
    all_entries,
    original_view_paths,
    is_expanded_child = false
  }) {
    const entry = all_entries[base_path]
    if (!entry) return []

    const instance_path = `${parent_instance_path}|${base_path}`
    const is_direct_match = entry.name && entry.name.toLowerCase().includes(query.toLowerCase())

    // Use extracted pipe logic for consistent rendering
    const { children_pipe_trail, is_hub_on_top } = calculate_children_pipe_trail({
      depth,
      is_hub,
      is_last_sub,
      is_first_hub,
      parent_pipe_trail,
      parent_base_path,
      base_path,
      all_entries
    })

    // Process hubs if they should be expanded
    const search_state = search_entry_states[instance_path]
    const should_expand_hubs = search_state ? search_state.expanded_hubs : false
    const should_expand_subs = search_state ? search_state.expanded_subs : false

    // Process hubs: if manually expanded, show ALL hubs regardless of search match
    const hub_results = (should_expand_hubs ? (entry.hubs || []) : []).flatMap((hub_path, i, arr) => {
      return build_search_view_recursive({
        query,
        base_path: hub_path,
        parent_instance_path: instance_path,
        parent_base_path: base_path,
        depth: depth + 1,
        is_last_sub: i === arr.length - 1,
        is_hub: true,
        is_first_hub: is_hub_on_top,
        parent_pipe_trail: children_pipe_trail,
        instance_states,
        all_entries,
        original_view_paths,
        is_expanded_child: true
      })
    })

    // Handle subs: if manually expanded, show ALL children; otherwise, search through them
    let sub_results = []
    if (should_expand_subs) {
      // Show ALL subs when manually expanded
      sub_results = (entry.subs || []).flatMap((sub_path, i, arr) => {
        return build_search_view_recursive({
          query,
          base_path: sub_path,
          parent_instance_path: instance_path,
          parent_base_path: base_path,
          depth: depth + 1,
          is_last_sub: i === arr.length - 1,
          is_hub: false,
          is_first_hub: false,
          parent_pipe_trail: children_pipe_trail,
          instance_states,
          all_entries,
          original_view_paths,
          is_expanded_child: true
        })
      })
    } else if (!is_expanded_child) {
      // Only search through subs if this node itself isn't an expanded child
      sub_results = (entry.subs || []).flatMap((sub_path, i, arr) =>
        build_search_view_recursive({
          query,
          base_path: sub_path,
          parent_instance_path: instance_path,
          parent_base_path: base_path,
          depth: depth + 1,
          is_last_sub: i === arr.length - 1,
          is_hub: false,
          is_first_hub: false,
          parent_pipe_trail: children_pipe_trail,
          instance_states,
          all_entries,
          original_view_paths
        })
      )
    }

    const has_matching_descendant = sub_results.length > 0

    // If this is an expanded child, always include it regardless of search match
    if (!is_expanded_child && !is_direct_match && !has_matching_descendant) return []

    // Set instance states for rendering
    const final_expand_subs = search_state ? search_state.expanded_subs : has_matching_descendant
    const final_expand_hubs = search_state ? search_state.expanded_hubs : false

    instance_states[instance_path] = { expanded_subs: final_expand_subs, expanded_hubs: final_expand_hubs }
    const is_in_original_view = original_view_paths.includes(instance_path)

    const current_node_view = {
      base_path,
      instance_path,
      depth,
      is_last_sub,
      is_hub,
      is_first_hub,
      parent_pipe_trail,
      parent_base_path,
      is_search_match: true,
      is_direct_match,
      is_in_original_view
    }

    return [...hub_results, current_node_view, ...sub_results]
  }

  function render_search_results (search_view, query) {
    view = search_view
    if (search_view.length === 0) {
      const no_results_el = document.createElement('div')
      no_results_el.className = 'no-results'
      no_results_el.textContent = `No results for "${query}"`
      return container.replaceChildren(no_results_el)
    }
    const fragment = document.createDocumentFragment()
    search_view.forEach(node_data => fragment.appendChild(create_node({ ...node_data, query })))
    container.replaceChildren(fragment)
  }

  /******************************************************************************
  6. VIEW MANIPULATION & USER ACTIONS
      - These functions handle user interactions like selecting, confirming,
        toggling, and resetting the graph.
  ******************************************************************************/
  function select_node (ev, instance_path) {
    last_clicked_node = instance_path
    update_drive_state({ dataset: 'runtime', name: 'last_clicked_node', value: instance_path })
    
    const new_selected = new Set(selected_instance_paths)
    if (ev.ctrlKey || multi_select_enabled) {
      new_selected.has(instance_path) ? new_selected.delete(instance_path) : new_selected.add(instance_path)
      update_drive_state({ dataset: 'runtime', name: 'selected_instance_paths', value: [...new_selected] })
    } else {
      update_drive_state({ dataset: 'runtime', name: 'selected_instance_paths', value: [instance_path] })
    }
  }

  // Add the clicked entry and all its parents in the default tree
  function search_expand_into_default (target_instance_path) {
    if (!target_instance_path) return
    const parts = target_instance_path.split('|').filter(Boolean)
    if (parts.length === 0) return

    const root_state = get_or_create_state(instance_states, '|/')
    root_state.expanded_subs = true

    // Walk from root to target, expanding the path relative to alredy expanded entries
    for (let i = 0; i < parts.length - 1; i++) {
      const parent_base = parts[i]
      const child_base = parts[i + 1]
      const parent_instance_path = parts.slice(0, i + 1).map(p => '|' + p).join('')
      const parent_state = get_or_create_state(instance_states, parent_instance_path)
      const parent_entry = all_entries[parent_base]
      if (!parent_entry) continue
      if (Array.isArray(parent_entry.subs) && parent_entry.subs.includes(child_base)) parent_state.expanded_subs = true
      if (Array.isArray(parent_entry.hubs) && parent_entry.hubs.includes(child_base)) parent_state.expanded_hubs = true
    }

    // Persist selection and expansion state
    update_drive_state({ dataset: 'runtime', name: 'selected_instance_paths', value: [target_instance_path] })
    drive_updated_by_toggle = true
    update_drive_state({ dataset: 'runtime', name: 'instance_states', value: instance_states })
    search_query = ''
    update_drive_state({ dataset: 'mode', name: 'query', value: '' })
    update_drive_state({ dataset: 'mode', name: 'current_mode', value: previous_mode })
  }

  function handle_confirm (ev, instance_path) {
    if (!ev.target) return
    const is_checked = ev.target.checked
    const new_selected = new Set(selected_instance_paths)
    const new_confirmed = new Set(confirmed_instance_paths)

    if (is_checked) {
      new_selected.delete(instance_path)
      new_confirmed.add(instance_path)
    } else {
      new_selected.add(instance_path)
      new_confirmed.delete(instance_path)
    }

    update_drive_state({ dataset: 'runtime', name: 'selected_instance_paths', value: [...new_selected] })
    update_drive_state({ dataset: 'runtime', name: 'confirmed_selected', value: [...new_confirmed] })
  }

  function toggle_subs (instance_path) {
    const state = get_or_create_state(instance_states, instance_path)
    state.expanded_subs = !state.expanded_subs
    build_and_render_view(instance_path)
    // Set a flag to prevent the subsequent `onbatch` call from causing a render loop.
    drive_updated_by_toggle = true
    update_drive_state({ dataset: 'runtime', name: 'instance_states', value: instance_states })
  }

  function toggle_hubs (instance_path) {
    const state = get_or_create_state(instance_states, instance_path)
    state.expanded_hubs ? hub_num-- : hub_num++
    state.expanded_hubs = !state.expanded_hubs
    build_and_render_view(instance_path, true)
    drive_updated_by_toggle = true
    update_drive_state({ dataset: 'runtime', name: 'instance_states', value: instance_states })
  }

  function toggle_search_subs (instance_path) {
    const state = get_or_create_state(search_entry_states, instance_path)
    state.expanded_subs = !state.expanded_subs
    perform_search(search_query) // Re-render search results with new state
    drive_updated_by_toggle = true
    update_drive_state({ dataset: 'runtime', name: 'search_entry_states', value: search_entry_states })
  }

  function toggle_search_hubs (instance_path) {
    const state = get_or_create_state(search_entry_states, instance_path)
    state.expanded_hubs = !state.expanded_hubs
    perform_search(search_query) // Re-render search results with new state
    drive_updated_by_toggle = true
    update_drive_state({ dataset: 'runtime', name: 'search_entry_states', value: search_entry_states })
  }

  function reset () {
    // reset all of the manual expansions made
    if (mode === 'search') {
      search_entry_states = {}
      drive_updated_by_toggle = true
      update_drive_state({ dataset: 'runtime', name: 'search_entry_states', value: search_entry_states })
      perform_search(search_query)
      return
    }
    const root_instance_path = '|/'
    const new_instance_states = {
      [root_instance_path]: { expanded_subs: true, expanded_hubs: false }
    }
    update_drive_state({ dataset: 'runtime', name: 'vertical_scroll_value', value: 0 })
    update_drive_state({ dataset: 'runtime', name: 'horizontal_scroll_value', value: 0 })
    update_drive_state({ dataset: 'runtime', name: 'selected_instance_paths', value: [] })
    update_drive_state({ dataset: 'runtime', name: 'confirmed_selected', value: [] })
    update_drive_state({ dataset: 'runtime', name: 'instance_states', value: new_instance_states })
  }

  /******************************************************************************
  7. VIRTUAL SCROLLING
    - These functions implement virtual scrolling to handle large graphs
      efficiently using an IntersectionObserver.
******************************************************************************/
  function onscroll () {
    if (scroll_update_pending) return
    scroll_update_pending = true
    requestAnimationFrame(() => {
      const scroll_delta = vertical_scroll_value - container.scrollTop
      // Handle removal of the scroll spacer.
      if (spacer_element && scroll_delta > 0 && container.scrollTop === 0) {
        spacer_element.remove()
        spacer_element = null
        spacer_initial_height = 0
        hub_num = 0
      }

      vertical_scroll_value = update_scroll_state({ current_value: vertical_scroll_value, new_value: container.scrollTop, name: 'vertical_scroll_value' })
      horizontal_scroll_value = update_scroll_state({ current_value: horizontal_scroll_value, new_value: container.scrollLeft, name: 'horizontal_scroll_value' })
      scroll_update_pending = false
    })
  }

  async function fill_viewport_downwards () {
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

  async function fill_viewport_upwards () {
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

  function handle_sentinel_intersection (entries) {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        if (entry.target === top_sentinel) fill_viewport_upwards()
        else if (entry.target === bottom_sentinel) fill_viewport_downwards()
      }
    })
  }

  function render_next_chunk () {
    if (end_index >= view.length) return
    const fragment = document.createDocumentFragment()
    const next_end = Math.min(view.length, end_index + chunk_size)
    for (let i = end_index; i < next_end; i++) { if (view[i]) fragment.appendChild(create_node(view[i])) }
    container.insertBefore(fragment, bottom_sentinel)
    end_index = next_end
    bottom_sentinel.style.height = `${(view.length - end_index) * node_height}px`
    cleanup_dom(false)
  }

  function render_prev_chunk () {
    if (start_index <= 0) return
    const fragment = document.createDocumentFragment()
    const prev_start = Math.max(0, start_index - chunk_size)
    for (let i = prev_start; i < start_index; i++) {
      if (view[i]) fragment.appendChild(create_node(view[i]))
    }
    container.insertBefore(fragment, top_sentinel.nextSibling)
    start_index = prev_start
    top_sentinel.style.height = `${start_index * node_height}px`
    cleanup_dom(true)
  }

  // Removes nodes from the DOM that are far outside the viewport.
  function cleanup_dom (is_scrolling_up) {
    const rendered_count = end_index - start_index
    if (rendered_count <= max_rendered_nodes) return

    const to_remove_count = rendered_count - max_rendered_nodes
    if (is_scrolling_up) {
      // If scrolling up, remove nodes from the bottom.
      remove_dom_nodes({ count: to_remove_count, start_el: bottom_sentinel, next_prop: 'previousElementSibling', boundary_el: top_sentinel })
      end_index -= to_remove_count
      bottom_sentinel.style.height = `${(view.length - end_index) * node_height}px`
    } else {
      // If scrolling down, remove nodes from the top.
      remove_dom_nodes({ count: to_remove_count, start_el: top_sentinel, next_prop: 'nextElementSibling', boundary_el: bottom_sentinel })
      start_index += to_remove_count
      top_sentinel.style.height = `${start_index * node_height}px`
    }
  }

  /******************************************************************************
  8. HUB DUPLICATION PREVENTION
  ******************************************************************************/

  function collect_all_duplicate_entries () {
    duplicate_entries_map = {}
    const base_path_counts = {}
    for (const node of view) {
      if (!base_path_counts[node.base_path]) {
        base_path_counts[node.base_path] = []
      }
      base_path_counts[node.base_path].push(node.instance_path)
    }

    // Store only duplicates
    for (const [base_path, instance_paths] of Object.entries(base_path_counts)) {
      if (instance_paths.length > 1) {
        duplicate_entries_map[base_path] = instance_paths
      }
    }
  }

  function get_next_duplicate_instance (base_path, current_instance_path) {
    const duplicates = duplicate_entries_map[base_path]
    if (!duplicates || duplicates.length <= 1) return null

    const current_index = duplicates.indexOf(current_instance_path)
    if (current_index === -1) return duplicates[0]

    const next_index = (current_index + 1) % duplicates.length
    return duplicates[next_index]
  }

  function has_duplicates (base_path) {
    return duplicate_entries_map[base_path] && duplicate_entries_map[base_path].length > 1
  }

  function cycle_to_next_duplicate (base_path, current_instance_path) {
    const next_instance_path = get_next_duplicate_instance(base_path, current_instance_path)
    if (next_instance_path) {
      scroll_to_and_highlight_instance(next_instance_path)
    }
  }

  function scroll_to_and_highlight_instance (target_instance_path) {
    const target_index = view.findIndex(n => n.instance_path === target_instance_path)
    if (target_index === -1) return

    // Calculate scroll position
    const target_scroll_top = target_index * node_height
    container.scrollTop = target_scroll_top

    // Find and highlight the DOM element
    const target_element = shadow.querySelector(`[data-instance_path="${CSS.escape(target_instance_path)}"]`)
    if (target_element) {
      target_element.classList.add('highlight-instance')
      setTimeout(() => {
        target_element.classList.remove('highlight-instance')
      }, 2000)
    }
  }

  /******************************************************************************
  9. HELPER FUNCTIONS
  ******************************************************************************/
  function get_highlighted_name (name, query) {
  // Creates a new regular expression.
  // `escape_regex(query)` sanitizes the query string to treat special regex characters literally.
  // `(...)` creates a capturing group for the escaped query.
  // 'gi' flags: 'g' for global (all occurrences), 'i' for case-insensitive.
    const regex = new RegExp(`(${escape_regex(query)})`, 'gi')
    // Replaces all matches of the regex in 'name' with the matched text wrapped in search-match class.
    // '$1' refers to the content of the first capturing group (the matched query).
    return name.replace(regex, '<span class="search-match">$1</span>')
  }

  function escape_regex (string) {
  // Escapes special regular expression characters in a string.
  // It replaces characters like -, /, \, ^, $, *, +, ?, ., (, ), |, [, ], {, }
  // with their escaped versions (e.g., '.' becomes '\.').
  // This prevents them from being interpreted as regex metacharacters.
    return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') // Corrected: should be \\$& to escape the found char
  }

  function check_and_reset_feedback_flags () {
    if (drive_updated_by_scroll) {
      drive_updated_by_scroll = false
      return true
    }
    if (drive_updated_by_toggle) {
      drive_updated_by_toggle = false
      return true
    }
    if (drive_updated_by_search) {
      drive_updated_by_search = false
      return true
    }
    return false
  }

  function parse_json_data (data, path) {
    if (data === null) return null
    try {
      return typeof data === 'string' ? JSON.parse(data) : data
    } catch (e) {
      console.error(`Failed to parse JSON for ${path}:`, e)
      return null
    }
  }

  function process_path_array_update ({ current_paths, value, render_set, name }) {
    const old_paths = [...current_paths]
    const new_paths = Array.isArray(value)
      ? value
      : (console.warn(`${name} is not an array, defaulting to empty.`, value), [])
    ;[...new Set([...old_paths, ...new_paths])].forEach(p => render_set.add(p))
    return new_paths
  }

  function calculate_new_scroll_top ({ old_scroll_top, old_view, focal_path }) {
    // Calculate the new scroll position to maintain the user's viewport.
    if (focal_path) {
      // If an action was focused on a specific node (like a toggle), try to keep it in the same position.
      const old_idx = old_view.findIndex(n => n.instance_path === focal_path)
      const new_idx = view.findIndex(n => n.instance_path === focal_path)
      if (old_idx !== -1 && new_idx !== -1) {
        return old_scroll_top + (new_idx - old_idx) * node_height
      }
    } else if (old_view.length > 0) {
      // Otherwise, try to keep the topmost visible node in the same position.
      const old_top_idx = Math.floor(old_scroll_top / node_height)
      const old_top_node = old_view[old_top_idx]
      if (old_top_node) {
        const new_top_idx = view.findIndex(n => n.instance_path === old_top_node.instance_path)
        if (new_top_idx !== -1) {
          return new_top_idx * node_height + (old_scroll_top % node_height)
        }
      }
    }
    return old_scroll_top
  }

  function handle_spacer_element ({ hub_toggle, existing_height, new_scroll_top, sync_fn }) {
    if (hub_toggle || hub_num > 0) {
      spacer_element = document.createElement('div')
      spacer_element.className = 'spacer'
      container.appendChild(spacer_element)

      if (hub_toggle) {
        requestAnimationFrame(() => {
          const container_height = container.clientHeight
          const content_height = view.length * node_height
          const max_scroll_top = content_height - container_height

          if (new_scroll_top > max_scroll_top) {
            spacer_initial_height = new_scroll_top - max_scroll_top
            spacer_element.style.height = `${spacer_initial_height}px`
          }
          sync_fn()
        })
      } else {
        spacer_element.style.height = `${existing_height}px`
        requestAnimationFrame(sync_fn)
      }
    } else {
      spacer_element = null
      spacer_initial_height = 0
      requestAnimationFrame(sync_fn)
    }
  }

  function create_root_node ({ state, has_subs, instance_path }) {
    // Handle the special case for the root node since its a bit different.
    const el = document.createElement('div')
    el.className = 'node type-root'
    el.dataset.instance_path = instance_path
    const prefix_class = has_subs || mode === 'search' ? 'prefix clickable' : 'prefix'
    const prefix_name = state.expanded_subs ? 'tee-down' : 'line-h'
    el.innerHTML = `<div class="wand clickable">🪄</div><span class="${prefix_class} ${prefix_name}"></span><span class="name ${mode === 'search' ? '' : 'clickable'}">/🌐</span>`

    el.querySelector('.wand').onclick = reset
    if (has_subs) {
      const prefix_el = el.querySelector('.prefix')
      if (prefix_el) {
        prefix_el.onclick = mode === 'search' ? null : () => toggle_subs(instance_path)
      }
    }
    el.querySelector('.name').onclick = ev => mode === 'search' ? null : select_node(ev, instance_path)
    return el
  }

  function create_confirm_checkbox (instance_path) {
    const checkbox_div = document.createElement('div')
    checkbox_div.className = 'confirm-wrapper'
    const is_confirmed = confirmed_instance_paths.includes(instance_path)
    checkbox_div.innerHTML = `<input type="checkbox" ${is_confirmed ? 'checked' : ''}>`
    const checkbox_input = checkbox_div.querySelector('input')
    if (checkbox_input) checkbox_input.onchange = ev => handle_confirm(ev, instance_path)
    return checkbox_div
  }

  function update_scroll_state ({ current_value, new_value, name }) {
    if (current_value !== new_value) {
      drive_updated_by_scroll = true // Set flag to prevent render loop.
      update_drive_state({ dataset: 'runtime', name, value: new_value })
      return new_value
    }
    return current_value
  }

  function remove_dom_nodes ({ count, start_el, next_prop, boundary_el }) {
    for (let i = 0; i < count; i++) {
      const temp = start_el[next_prop]
      if (temp && temp !== boundary_el) temp.remove()
      else break
    }
  }
}

/******************************************************************************
  10. FALLBACK CONFIGURATION
    - This provides the default data and API configuration for the component,
      following the pattern described in `instructions.md`.
    - It defines the default datasets (`entries`, `style`, `runtime`) and their
      initial values.
******************************************************************************/
function fallback_module () {
  return {
    api: fallback_instance
  }
  function fallback_instance () {
    return {
      drive: {
        'entries/': {
          'entries.json': { $ref: 'entries.json' }
        },
        'style/': {
          'theme.css': {
            $ref: 'theme.css'
          }
        },
        'runtime/': {
          'node_height.json': { raw: '16' },
          'vertical_scroll_value.json': { raw: '0' },
          'horizontal_scroll_value.json': { raw: '0' },
          'selected_instance_paths.json': { raw: '[]' },
          'confirmed_selected.json': { raw: '[]' },
          'instance_states.json': { raw: '{}' },
          'search_entry_states.json': { raw: '{}' },
          'last_clicked_node.json': { raw: 'null' }
        },
        'mode/': {
          'current_mode.json': { raw: '"menubar"' },
          'previous_mode.json': { raw: '"menubar"' },
          'search_query.json': { raw: '""' },
          'multi_select_enabled.json': { raw: 'false' }
        }
      }
    }
  }
}
