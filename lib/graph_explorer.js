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
  let hubs_flag = 'default' // Flag for hubs behavior: 'default' (prevent duplication), 'true' (no duplication prevention), 'false' (disable hubs)
  let drive_updated_by_scroll = false // Flag to prevent `onbatch` from re-rendering on scroll updates.
  let drive_updated_by_toggle = false // Flag to prevent `onbatch` from re-rendering on toggle updates.
  let drive_updated_by_search = false // Flag to prevent `onbatch` from re-rendering on search updates.
  let ignore_drive_updated_by_scroll = false // Prevent scroll flag.
  let drive_updated_by_match = false // Flag to prevent `onbatch` from re-rendering on matching entry updates.
  let drive_updated_by_tracking = false // Flag to prevent `onbatch` from re-rendering on view order tracking updates.
  let is_loading_from_drive = false // Flag to prevent saving to drive during initial load
  let multi_select_enabled = false // Flag to enable multi-select mode without ctrl key
  let select_between_enabled = false // Flag to enable select between mode
  let select_between_first_node = null // First node selected in select between mode
  let duplicate_entries_map = {}
  let view_order_tracking = {} // Tracks instance paths by base path in real time as they are added into the view through toggle expand/collapse actions.
  let is_rendering = false // Flag to prevent concurrent rendering operations in virtual scrolling.
  let spacer_element = null // DOM element used to manage scroll position when hubs are toggled.
  let spacer_initial_height = 0
  let hub_num = 0 // Counter for expanded hubs.
  let last_clicked_node = null // Track the last clicked node instance path for highlighting.
  let root_wand_state = null // Store original root wand state when replaced with jump button
  const manipulated_inside_search = {}

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
    mode: on_mode,
    flags: on_flags
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
    console.log('[SEARCH DEBUG] onbatch caled:', {
      mode,
      search_query,
      last_clicked_node,
      feedback_flags: {
        scroll: drive_updated_by_scroll,
        toggle: drive_updated_by_toggle,
        search: drive_updated_by_search,
        match: drive_updated_by_match,
        tracking: drive_updated_by_tracking
      }
    })

    // Prevent feedback loops from scroll or toggle actions.
    if (check_and_reset_feedback_flags()) {
      console.log('[SEARCH DEBUG] onbatch prevented by feedback flags')
      return
    }

    for (const { type, paths } of batch) {
      if (!paths || !paths.length) continue
      const data = await Promise.all(
        paths.map(path => {
          return drive
            .get(path)
            .then(file => (file ? file.raw : null))
            .catch(e => {
              console.error(`Error getting file from drive: ${path}`, e)
              return null
            })
        })
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
      // don't rebuild view if we're in search mode with active query
      if (mode === 'search' && search_query) {
        console.log('[SEARCH DEBUG] on_entries: skipping build_and_render_view in Search Mode with query:', search_query)
        perform_search(search_query)
      } else {
        // tracking will be initialized later if drive data is empty
        build_and_render_view()
      }
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
      'last_clicked_node.json': handle_last_clicked_node,
      'view_order_tracking.json': handle_view_order_tracking
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

    if (needs_render) {
      if (mode === 'search' && search_query) {
        console.log('[SEARCH DEBUG] on_runtime: Skipping build_and_render_view in search mode with query:', search_query)
        perform_search(search_query)
      } else {
        build_and_render_view()
      }
    } else if (render_nodes_needed.size > 0) {
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

    function handle_view_order_tracking ({ value }) {
      if (typeof value === 'object' && value && !Array.isArray(value)) {
        is_loading_from_drive = true
        view_order_tracking = value
        is_loading_from_drive = false
        if (Object.keys(view_order_tracking).length === 0) {
          initialize_tracking_from_current_state()
        }
        return { needs_render: true }
      } else {
        console.warn('view_order_tracking is not a valid object, ignoring.', value)
      }
    }
  }

  function on_mode ({ data, paths }) {
    const on_mode_paths = {
      'current_mode.json': handle_current_mode,
      'previous_mode.json': handle_previous_mode,
      'search_query.json': handle_search_query,
      'multi_select_enabled.json': handle_multi_select_enabled,
      'select_between_enabled.json': handle_select_between_enabled
    }
    let new_current_mode, new_previous_mode, new_search_query, new_multi_select_enabled, new_select_between_enabled

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
        if (result?.select_between_enabled !== undefined) new_select_between_enabled = result.select_between_enabled
      }
    })

    if (typeof new_search_query === 'string') search_query = new_search_query
    if (new_previous_mode) previous_mode = new_previous_mode
    if (typeof new_multi_select_enabled === 'boolean') {
      multi_select_enabled = new_multi_select_enabled
      render_menubar() // Re-render menubar to update button text
    }
    if (typeof new_select_between_enabled === 'boolean') {
      select_between_enabled = new_select_between_enabled
      if (!select_between_enabled) select_between_first_node = null
      render_menubar()
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

    if (mode && new_current_mode === 'search') update_drive_state({ type: 'mode/previous_mode', message: mode })
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

    function handle_select_between_enabled ({ value }) {
      return { select_between_enabled: value }
    }
  }

  function on_flags ({ data, paths }) {
    const on_flags_paths = {
      'hubs.json': handle_hubs_flag
    }

    paths.forEach((path, i) => {
      const value = parse_json_data(data[i], path)
      if (value === null) return

      const filename = path.split('/').pop()
      const handler = on_flags_paths[filename]
      if (handler) {
        const result = handler(value)
        if (result && result.needs_render) {
          if (mode === 'search' && search_query) {
            console.log('[SEARCH DEBUG] on_flags: Skipping build_and_render_view in search mode with query:', search_query)
            perform_search(search_query)
          } else {
            build_and_render_view()
          }
        }
      }
    })

    function handle_hubs_flag (value) {
      if (typeof value === 'string' && ['default', 'true', 'false'].includes(value)) {
        hubs_flag = value
        return { needs_render: true }
      } else {
        console.warn('hubs flag must be one of: "default", "true", "false", ignoring.', value)
      }
    }
  }

  function inject_style ({ data }) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(data[0])
    shadow.adoptedStyleSheets = [sheet]
  }

  // Helper to persist component state to the drive.
  async function update_drive_state ({ type, message }) {
    try {
      await drive.put(`${type}.json`, JSON.stringify(message))
    } catch (e) {
      const [dataset, name] = type.split('/')
      console.error(`Failed to update ${dataset} state for ${name}:`, e)
    }
  }

  function get_or_create_state (states, instance_path) {
    if (!states[instance_path]) {
      states[instance_path] = { expanded_subs: false, expanded_hubs: false }
    }
    if (states[instance_path].expanded_subs === null) {
      states[instance_path].expanded_subs = true
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
    console.log('[SEARCH DEBUG] build_and_render_view called:', {
      focal_instance_path,
      hub_toggle,
      current_mode: mode,
      search_query,
      last_clicked_node,
      stack_trace: new Error().stack.split('\n').slice(1, 4).map(line => line.trim())
    })

    // This fuction should'nt be called in search mode for search
    if (mode === 'search' && search_query && !hub_toggle) {
      console.error('[SEARCH DEBUG] build_and_render_view called inappropriately in search mode!', {
        mode,
        search_query,
        focal_instance_path,
        stack_trace: new Error().stack.split('\n').slice(1, 6).map(line => line.trim())
      })
    }

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

    // Recalculate duplicates after view is built
    collect_all_duplicate_entries()

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

    // Handle the spacer element used for keep entries static wrt cursor by scrolling when hubs are toggled.
    handle_spacer_element({
      hub_toggle,
      existing_height: existing_spacer_height,
      new_scroll_top,
      sync_fn: set_scroll_and_sync
    })

    function set_scroll_and_sync () {
      drive_updated_by_scroll = true
      container.scrollTop = new_scroll_top
      container.scrollLeft = old_scroll_left
      vertical_scroll_value = container.scrollTop
    }
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

    let states
    if (mode === 'search') {
      if (manipulated_inside_search[instance_path]) {
        search_entry_states[instance_path] = manipulated_inside_search[instance_path]
        states = search_entry_states
      } else {
        states = search_state_instances
      }
    } else {
      states = instance_states
    }
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
    if (last_clicked_node === instance_path) {
      mode === 'search' ? el.classList.add('search-last-clicked') : el.classList.add('last-clicked')
    }

    const has_hubs = hubs_flag === 'false' ? false : Array.isArray(entry.hubs) && entry.hubs.length > 0
    const has_subs = Array.isArray(entry.subs) && entry.subs.length > 0

    if (depth) {
      el.classList.add('left-indent')
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
    let has_duplicate_entries = false
    let is_first_occurrence = false
    if (mode !== 'search' && hubs_flag !== 'true') { // disabled in search mode and when hubs_flag is 'true'
      has_duplicate_entries = has_duplicates(base_path)

      // coloring class for duplicates
      if (has_duplicate_entries) {
        is_first_occurrence = is_first_duplicate(base_path, instance_path)
        if (is_first_occurrence) {
          el.classList.add('first-matching-entry')
        } else {
          el.classList.add('matching-entry')
        }
      }
    }

    el.innerHTML = `
      <span class="indent">${pipe_html}</span>
      <span class="${prefix_class} ${prefix_class_name}"></span>
      <span class="${icon_class}"></span>
      <span class="name ${has_duplicate_entries && !is_first_occurrence ? '' : 'clickable'}">${name_html}</span>
    `

    // For matching entries, disable normal event listener and add handler to whole entry to create button for jump to next duplicate
    if (has_duplicate_entries && !is_first_occurrence && mode !== 'search' && hubs_flag !== 'true') {
      el.onclick = jump_out_to_next_duplicate
    } else {
      const icon_el = el.querySelector('.icon')
      if (icon_el && has_hubs && base_path !== '/') {
        icon_el.onclick = mode === 'search'
          ? () => toggle_search_hubs(instance_path)
          : () => toggle_hubs(instance_path)
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

      // Special handling for first duplicate entry - it should have normal select behavior but also show jump button
      const name_el = el.querySelector('.name')
      if (has_duplicate_entries && is_first_occurrence && mode !== 'search' && hubs_flag !== 'true') {
        name_el.onclick = ev => {
          select_node(ev, instance_path)
          // Also add jump button functionality for first occurrence
          setTimeout(() => {
            add_jump_button_to_matching_entry(el, base_path, instance_path)
          }, 10)
        }
      } else {
        name_el.onclick = ev => mode === 'search' ? handle_search_name_click(ev, instance_path) : select_node(ev, instance_path)
      }
    }

    if (selected_instance_paths.includes(instance_path) || confirmed_instance_paths.includes(instance_path)) el.appendChild(create_confirm_checkbox(instance_path))

    return el
    function jump_out_to_next_duplicate () {
      // Manually update last clicked
      last_clicked_node = instance_path
      drive_updated_by_match = true

      update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })

      // Manually update DOM
      update_last_clicked_styling(instance_path)
      add_jump_button_to_matching_entry(el, base_path, instance_path)
    }
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
    multi_select_button.onclick = toggle_multi_select

    const select_between_button = document.createElement('button')
    select_between_button.innerHTML = `Select Between: ${select_between_enabled ? 'true' : 'false'}`
    select_between_button.onclick = toggle_select_between

    menubar.replaceChildren(search_button, multi_select_button, select_between_button)
  }

  function render_searchbar () {
    if (mode !== 'search') {
      searchbar.style.display = 'none'
      searchbar.replaceChildren()
      return
    }

    const search_opts = {
      type: 'text',
      placeholder: 'Search entries...',
      className: 'search-input',
      value: search_query,
      oninput: on_search_input
    }
    searchbar.style.display = 'flex'
    const search_input = Object.assign(document.createElement('input'), search_opts)

    searchbar.replaceChildren(search_input)
    requestAnimationFrame(() => search_input.focus())
  }

  function handle_mode_change () {
    menubar.style.display = mode === 'default' ? 'none' : 'flex'
    render_searchbar()
    build_and_render_view()
  }

  function toggle_search_mode () {
    const target_mode = mode === 'search' ? previous_mode : 'search'
    console.log('[SEARCH DEBUG] Switching mode from', mode, 'to', target_mode)
    if (mode === 'search') {
      // When switching from search to default mode, expand selected entries
      if (selected_instance_paths.length > 0) {
        console.log('[SEARCH DEBUG] Expanding selected entries in default mode:', selected_instance_paths)
        expand_selected_entries_in_default(selected_instance_paths)
        drive_updated_by_toggle = true
        update_drive_state({ type: 'runtime/instance_states', message: instance_states })
      }
      // Reset select-between mode when leaving search mode
      if (select_between_enabled) {
        select_between_enabled = false
        select_between_first_node = null
        update_drive_state({ type: 'mode/select_between_enabled', message: false })
        console.log('[SEARCH DEBUG] Reset select-between mode when leaving search')
      }
      search_query = ''
      update_drive_state({ type: 'mode/search_query', message: '' })
    }
    ignore_drive_updated_by_scroll = true
    update_drive_state({ type: 'mode/current_mode', message: target_mode })
    search_state_instances = instance_states
  }

  function toggle_multi_select () {
    multi_select_enabled = !multi_select_enabled
    // Disable select between when enabling multi select
    if (multi_select_enabled && select_between_enabled) {
      select_between_enabled = false
      select_between_first_node = null
      update_drive_state({ type: 'mode/select_between_enabled', message: false })
    }
    update_drive_state({ type: 'mode/multi_select_enabled', message: multi_select_enabled })
    render_menubar() // Re-render to update button text
  }

  function toggle_select_between () {
    select_between_enabled = !select_between_enabled
    select_between_first_node = null // Reset first node selection
    // Disable multi select when enabling select between
    if (select_between_enabled && multi_select_enabled) {
      multi_select_enabled = false
      update_drive_state({ type: 'mode/multi_select_enabled', message: false })
    }
    update_drive_state({ type: 'mode/select_between_enabled', message: select_between_enabled })
    render_menubar() // Re-render to update button text
  }

  function on_search_input (event) {
    search_query = event.target.value.trim()
    drive_updated_by_search = true
    update_drive_state({ type: 'mode/search_query', message: search_query })
    if (search_query === '') search_state_instances = instance_states
    perform_search(search_query)
  }

  function perform_search (query) {
    console.log('[SEARCH DEBUG] perform_search called:', {
      query,
      current_mode: mode,
      search_query_var: search_query,
      has_search_entry_states: Object.keys(search_entry_states).length > 0,
      last_clicked_node
    })

    // Check if we are actualy in search mode
    if (mode !== 'search') {
      console.error('[SEARCH DEBUG] perform_search called but not in search mode!', {
        current_mode: mode,
        query
      })
      return build_and_render_view()
    }

    if (!query) {
      console.log('[SEARCH DEBUG] No query provided, building default view')
      return build_and_render_view()
    }

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

    console.log('[SEARCH DEBUG] Search view built:', search_view.length)
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
    update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })

    // Handle shift+click to enable select between mode temporarily
    if (ev.shiftKey && !select_between_enabled) {
      select_between_enabled = true
      select_between_first_node = null
      update_drive_state({ type: 'mode/select_between_enabled', message: true })
      render_menubar()
    }

    const new_selected = new Set(selected_instance_paths)

    if (select_between_enabled) {
      handle_select_between(instance_path, new_selected)
    } else if (ev.ctrlKey || multi_select_enabled) {
      new_selected.has(instance_path) ? new_selected.delete(instance_path) : new_selected.add(instance_path)
      update_drive_state({ type: 'runtime/selected_instance_paths', message: [...new_selected] })
    } else {
      update_drive_state({ type: 'runtime/selected_instance_paths', message: [instance_path] })
    }
  }

  function handle_select_between (instance_path, new_selected) {
    if (!select_between_first_node) {
      select_between_first_node = instance_path
    } else {
      const first_index = view.findIndex(n => n.instance_path === select_between_first_node)
      const second_index = view.findIndex(n => n.instance_path === instance_path)

      if (first_index !== -1 && second_index !== -1) {
        const start_index = Math.min(first_index, second_index)
        const end_index = Math.max(first_index, second_index)

        // Toggle selection for all nodes in the range
        for (let i = start_index; i <= end_index; i++) {
          const node_instance_path = view[i].instance_path
          new_selected.has(node_instance_path) ? new_selected.delete(node_instance_path) : new_selected.add(node_instance_path)
        }

        update_drive_state({ type: 'runtime/selected_instance_paths', message: [...new_selected] })
      }

      // Reset select between mode after second click
      select_between_enabled = false
      select_between_first_node = null
      update_drive_state({ type: 'mode/select_between_enabled', message: false })
      render_menubar()
    }
  }

  // Add the clicked entry and all its parents in the default tree
  function expand_entry_path_in_default (target_instance_path) {
    console.log('[SEARCH DEBUG] search_expand_into_default called:', {
      target_instance_path,
      current_mode: mode,
      search_query,
      previous_mode,
      current_search_entry_states: Object.keys(search_entry_states).length,
      current_instance_states: Object.keys(instance_states).length
    })

    if (!target_instance_path) {
      console.warn('[SEARCH DEBUG] No target_instance_path provided')
      return
    }

    const parts = target_instance_path.split('|').filter(Boolean)
    if (parts.length === 0) {
      console.warn('[SEARCH DEBUG] No valid parts found in instance path:', target_instance_path)
      return
    }

    console.log('[SEARCH DEBUG] Parsed instance path parts:', parts)

    const root_state = get_or_create_state(instance_states, '|/')
    root_state.expanded_subs = true

    // Walk from root to target, expanding the path relative to already expanded entries
    for (let i = 0; i < parts.length - 1; i++) {
      const parent_base = parts[i]
      const child_base = parts[i + 1]
      const parent_instance_path = parts.slice(0, i + 1).map(p => '|' + p).join('')
      const parent_state = get_or_create_state(instance_states, parent_instance_path)
      const parent_entry = all_entries[parent_base]

      console.log('[SEARCH DEBUG] Processing parent-child relationship:', {
        parent_base,
        child_base,
        parent_instance_path,
        has_parent_entry: !!parent_entry
      })

      if (!parent_entry) continue
      if (Array.isArray(parent_entry.subs) && parent_entry.subs.includes(child_base)) {
        parent_state.expanded_subs = true
        console.log('[SEARCH DEBUG] Expanded subs for:', parent_instance_path)
      }
      if (Array.isArray(parent_entry.hubs) && parent_entry.hubs.includes(child_base)) {
        parent_state.expanded_hubs = true
        console.log('[SEARCH DEBUG] Expanded hubs for:', parent_instance_path)
      }
    }
  }

  // expand multiple selected entry in the default tree
  function expand_selected_entries_in_default (selected_paths) {
    console.log('[SEARCH DEBUG] expand_selected_entries_in_default called:', {
      selected_paths,
      current_mode: mode,
      search_query,
      previous_mode
    })

    if (!Array.isArray(selected_paths) || selected_paths.length === 0) {
      console.warn('[SEARCH DEBUG] No valid selected paths provided')
      return
    }

    // expand foreach selected path
    selected_paths.forEach(path => {
      expand_entry_path_in_default(path)
    })

    console.log('[SEARCH DEBUG] All selected entries expanded in default mode')
  }

  // Add the clicked entry and all its parents in the default tree
  function search_expand_into_default (target_instance_path) {
    if (!target_instance_path) {
      return
    }

    handle_search_node_click(target_instance_path)
    expand_entry_path_in_default(target_instance_path)

    console.log('[SEARCH DEBUG] Current mode before switch:', mode)
    console.log('[SEARCH DEBUG] Target previous_mode:', previous_mode)

    // Persist selection and expansion state
    update_drive_state({ type: 'runtime/selected_instance_paths', message: [target_instance_path] })
    drive_updated_by_toggle = true
    update_drive_state({ type: 'runtime/instance_states', message: instance_states })
    search_query = ''
    update_drive_state({ type: 'mode/search_query', message: '' })

    console.log('[SEARCH DEBUG] About to switch from search mode to:', previous_mode)
    update_drive_state({ type: 'mode/current_mode', message: previous_mode })
  }

  function handle_confirm (ev, instance_path) {
    if (!ev.target) return
    const is_checked = ev.target.checked
    const new_selected = new Set(selected_instance_paths)
    const new_confirmed = new Set(confirmed_instance_paths)

    // use specific logic for mode
    if (mode === 'search') {
      handle_search_node_click(instance_path)
    } else {
      last_clicked_node = instance_path
      update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })
    }

    if (is_checked) {
      new_selected.delete(instance_path)
      new_confirmed.add(instance_path)
    } else {
      new_selected.add(instance_path)
      new_confirmed.delete(instance_path)
    }

    update_drive_state({ type: 'runtime/selected_instance_paths', message: [...new_selected] })
    update_drive_state({ type: 'runtime/confirmed_selected', message: [...new_confirmed] })
  }

  function toggle_subs (instance_path) {
    const state = get_or_create_state(instance_states, instance_path)
    const was_expanded = state.expanded_subs
    state.expanded_subs = !state.expanded_subs

    // Update view order tracking for the toggled subs
    const base_path = instance_path.split('|').pop()
    const entry = all_entries[base_path]
    if (entry && Array.isArray(entry.subs)) {
      entry.subs.forEach(sub_path => {
        if (was_expanded) {
          // Collapsing so
          remove_instances_recursively(sub_path, instance_path, instance_states, all_entries)
        } else {
          // Expanding so
          add_instances_recursively(sub_path, instance_path, instance_states, all_entries)
        }
      })
    }

    last_clicked_node = instance_path
    update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })

    build_and_render_view(instance_path)
    // Set a flag to prevent the subsequent `onbatch` call from causing a render loop.
    drive_updated_by_toggle = true
    update_drive_state({ type: 'runtime/instance_states', message: instance_states })
  }

  function toggle_hubs (instance_path) {
    const state = get_or_create_state(instance_states, instance_path)
    const was_expanded = state.expanded_hubs
    state.expanded_hubs ? hub_num-- : hub_num++
    state.expanded_hubs = !state.expanded_hubs

    // Update view order tracking for the toggled hubs
    const base_path = instance_path.split('|').pop()
    const entry = all_entries[base_path]
    if (entry && Array.isArray(entry.hubs)) {
      entry.hubs.forEach(hub_path => {
        if (was_expanded) {
          // Collapsing so
          remove_instances_recursively(hub_path, instance_path, instance_states, all_entries)
        } else {
          // Expanding so
          add_instances_recursively(hub_path, instance_path, instance_states, all_entries)
        }
      })
    }

    last_clicked_node = instance_path
    drive_updated_by_scroll = true // Prevent onbatch interference with hub spacer
    update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })

    build_and_render_view(instance_path, true)
    drive_updated_by_toggle = true
    update_drive_state({ type: 'runtime/instance_states', message: instance_states })
  }

  function toggle_search_subs (instance_path) {
    console.log('[SEARCH DEBUG] toggle_search_subs called:', {
      instance_path,
      mode,
      search_query,
      current_state: search_entry_states[instance_path]?.expanded_subs || false
    })

    const state = get_or_create_state(search_entry_states, instance_path)
    const old_expanded = state.expanded_subs
    state.expanded_subs = !state.expanded_subs
    const has_matching_descendant = search_state_instances[instance_path]?.expanded_subs ? null : true
    const has_matching_parents = manipulated_inside_search[instance_path] ? search_entry_states[instance_path]?.expanded_hubs : search_state_instances[instance_path]?.expanded_hubs
    manipulated_inside_search[instance_path] = { expanded_hubs: has_matching_parents, expanded_subs: has_matching_descendant }
    console.log('[SEARCH DEBUG] Toggled subs state:', {
      instance_path,
      old_expanded,
      new_expanded: state.expanded_subs
    })

    handle_search_node_click(instance_path)

    perform_search(search_query)
    drive_updated_by_search = true
    update_drive_state({ type: 'runtime/search_entry_states', message: search_entry_states })
  }

  function toggle_search_hubs (instance_path) {
    console.log('[SEARCH DEBUG] toggle_search_hubs called:', {
      instance_path,
      mode,
      search_query,
      current_state: search_entry_states[instance_path]?.expanded_hubs || false
    })

    const state = get_or_create_state(search_entry_states, instance_path)
    const old_expanded = state.expanded_hubs
    state.expanded_hubs = !state.expanded_hubs
    const has_matching_descendant = search_state_instances[instance_path]?.expanded_subs
    manipulated_inside_search[instance_path] = { expanded_hubs: state.expanded_hubs, expanded_subs: has_matching_descendant }
    console.log('[SEARCH DEBUG] Toggled hubs state:', {
      instance_path,
      old_expanded,
      new_expanded: state.expanded_hubs
    })

    handle_search_node_click(instance_path)

    console.log('[SEARCH DEBUG] About to perform_search after toggle_search_hubs')
    perform_search(search_query)
    drive_updated_by_search = true
    update_drive_state({ type: 'runtime/search_entry_states', message: search_entry_states })
    console.log('[SEARCH DEBUG] toggle_search_hubs completed')
  }

  function handle_search_node_click (instance_path) {
    console.log('[SEARCH DEBUG] handle_search_node_click called:', {
      instance_path,
      current_mode: mode,
      search_query,
      previous_last_clicked: last_clicked_node
    })

    if (mode !== 'search') {
      console.warn('[SEARCH DEBUG] handle_search_node_click called but not in search mode!', {
        current_mode: mode,
        instance_path
      })
      return
    }

    // we need to handle last_clicked_node differently
    const old_last_clicked = last_clicked_node
    last_clicked_node = instance_path

    console.log('[SEARCH DEBUG] Updating last_clicked_node:', {
      old_value: old_last_clicked,
      new_value: last_clicked_node,
      mode,
      search_query
    })

    update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })

    // Update visual styling for search mode nodes
    update_search_last_clicked_styling(instance_path)
  }

  function update_search_last_clicked_styling (target_instance_path) {
    console.log('[SEARCH DEBUG] update_search_last_clicked_styling called:', {
      target_instance_path,
      mode,
      search_query
    })

    // Remove `last-clicked` class from all search result nodes
    const search_nodes = container.querySelectorAll('.node.search-result')
    console.log('[SEARCH DEBUG] Found search result nodes:', search_nodes.length)
    search_nodes.forEach(node => {
      const was_last_clicked = node.classList.contains('last-clicked')
      mode === 'search' ? node.classList.remove('search-last-clicked') : node.classList.remove('last-clicked')
      if (was_last_clicked) {
        console.log('[SEARCH DEBUG] Removed last-clicked from:', node.dataset.instance_path)
      }
    })

    // Add last-clicked class to the target node if it exists in search results
    const target_node = container.querySelector(`[data-instance_path="${target_instance_path}"].search-result`)
    if (target_node) {
      mode === 'search' ? target_node.classList.add('search-last-clicked') : target_node.classList.add('last-clicked')
      console.log('[SEARCH DEBUG] Added last-clicked to target node:', target_instance_path)
    } else {
      console.warn('[SEARCH DEBUG] Target node not found in search results:', {
        target_instance_path,
        available_search_nodes: Array.from(search_nodes).map(n => n.dataset.instance_path)
      })
    }
  }

  function handle_search_name_click (ev, instance_path) {
    console.log('[SEARCH DEBUG] handle_search_name_click called:', {
      instance_path,
      mode,
      search_query,
      ctrlKey: ev.ctrlKey,
      metaKey: ev.metaKey,
      shiftKey: ev.shiftKey,
      multi_select_enabled,
      current_selected: selected_instance_paths.length
    })

    if (mode !== 'search') {
      console.error('[SEARCH DEBUG] handle_search_name_click called but not in search mode!', {
        current_mode: mode,
        instance_path
      })
      return
    }

    handle_search_node_click(instance_path)

    if (ev.ctrlKey || ev.metaKey || multi_select_enabled) {
      search_select_node(ev, instance_path)
    } else if (ev.shiftKey) {
      search_select_node(ev, instance_path)
    } else if (select_between_enabled) {
      // Handle select-between mode when button is enabled
      search_select_node(ev, instance_path)
    } else {
      // Regular click
      search_expand_into_default(instance_path)
    }
  }

  function search_select_node (ev, instance_path) {
    console.log('[SEARCH DEBUG] search_select_node called:', {
      instance_path,
      mode,
      search_query,
      shiftKey: ev.shiftKey,
      ctrlKey: ev.ctrlKey,
      metaKey: ev.metaKey,
      multi_select_enabled,
      select_between_enabled,
      select_between_first_node,
      current_selected: selected_instance_paths
    })

    const new_selected = new Set(selected_instance_paths)

    if (select_between_enabled) {
      if (!select_between_first_node) {
        select_between_first_node = instance_path
        console.log('[SEARCH DEBUG] Set first node for select between:', instance_path)
      } else {
        console.log('[SEARCH DEBUG] Completing select between range:', {
          first: select_between_first_node,
          second: instance_path
        })
        const first_index = view.findIndex(n => n.instance_path === select_between_first_node)
        const second_index = view.findIndex(n => n.instance_path === instance_path)

        if (first_index !== -1 && second_index !== -1) {
          const start_index = Math.min(first_index, second_index)
          const end_index = Math.max(first_index, second_index)

          // Toggle selection for all nodes in between
          for (let i = start_index; i <= end_index; i++) {
            const node_instance_path = view[i].instance_path
            if (new_selected.has(node_instance_path)) {
              new_selected.delete(node_instance_path)
            } else {
              new_selected.add(node_instance_path)
            }
          }
        }

        // Reset select between mode after completing the selection
        select_between_enabled = false
        select_between_first_node = null
        update_drive_state({ type: 'mode/select_between_enabled', message: false })
        render_menubar()
        console.log('[SEARCH DEBUG] Reset select between mode')
      }
    } else if (ev.shiftKey) {
      // Enable select between mode on shift click
      select_between_enabled = true
      select_between_first_node = instance_path
      update_drive_state({ type: 'mode/select_between_enabled', message: true })
      render_menubar()
      console.log('[SEARCH DEBUG] Enabled select between mode with first node:', instance_path)
      return
    } else if (multi_select_enabled || ev.ctrlKey || ev.metaKey) {
      if (new_selected.has(instance_path)) {
        console.log('[SEARCH DEBUG] Deselecting node:', instance_path)
        new_selected.delete(instance_path)
      } else {
        console.log('[SEARCH DEBUG] Selecting node:', instance_path)
        new_selected.add(instance_path)
      }
    } else {
      // Single selection mode
      new_selected.clear()
      new_selected.add(instance_path)
      console.log('[SEARCH DEBUG] Single selecting node:', instance_path)
    }

    const new_selection_array = [...new_selected]
    update_drive_state({ type: 'runtime/selected_instance_paths', message: new_selection_array })
    console.log('[SEARCH DEBUG] search_select_node completed, new selection:', new_selection_array)
  }

  function reset () {
    // reset all of the manual expansions made
    instance_states = {}
    view_order_tracking = {} // Clear view order tracking on reset
    drive_updated_by_tracking = true
    update_drive_state({ type: 'runtime/view_order_tracking', message: view_order_tracking })
    if (mode === 'search') {
      search_entry_states = {}
      drive_updated_by_toggle = true
      update_drive_state({ type: 'runtime/search_entry_states', message: search_entry_states })
      perform_search(search_query)
      return
    }
    const root_instance_path = '|/'
    const new_instance_states = {
      [root_instance_path]: { expanded_subs: true, expanded_hubs: false }
    }
    update_drive_state({ type: 'runtime/vertical_scroll_value', message: 0 })
    update_drive_state({ type: 'runtime/horizontal_scroll_value', message: 0 })
    update_drive_state({ type: 'runtime/selected_instance_paths', message: [] })
    update_drive_state({ type: 'runtime/confirmed_selected', message: [] })
    update_drive_state({ type: 'runtime/instance_states', message: new_instance_states })
  }

  /******************************************************************************
  7. VIRTUAL SCROLLING
    - These functions implement virtual scrolling to handle large graphs
      efficiently using an IntersectionObserver.
******************************************************************************/
  function onscroll () {
    if (scroll_update_pending) return
    scroll_update_pending = true
    requestAnimationFrame(scroll_frames)
    function scroll_frames () {
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
    }
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
  8. ENTRY DUPLICATION PREVENTION
  ******************************************************************************/

  function collect_all_duplicate_entries () {
    duplicate_entries_map = {}
    // Use view_order_tracking for duplicate detection
    for (const [base_path, instance_paths] of Object.entries(view_order_tracking)) {
      if (instance_paths.length > 1) {
        duplicate_entries_map[base_path] = {
          instances: instance_paths,
          first_instance: instance_paths[0] // First occurrence in view order
        }
      }
    }
  }

  function initialize_tracking_from_current_state () {
    const root_path = '/'
    const root_instance_path = '|/'
    if (all_entries[root_path]) {
      add_instance_to_view_tracking(root_path, root_instance_path)
      // Add initially expanded subs if any
      const root_entry = all_entries[root_path]
      if (root_entry && Array.isArray(root_entry.subs)) {
        root_entry.subs.forEach(sub_path => {
          add_instances_recursively(sub_path, root_instance_path, instance_states, all_entries)
        })
      }
    }
  }

  function add_instance_to_view_tracking (base_path, instance_path) {
    if (!view_order_tracking[base_path]) view_order_tracking[base_path] = []
    if (!view_order_tracking[base_path].includes(instance_path)) {
      view_order_tracking[base_path].push(instance_path)

      // Only save to drive if not currently loading from drive
      if (!is_loading_from_drive) {
        drive_updated_by_tracking = true
        update_drive_state({ type: 'runtime/view_order_tracking', message: view_order_tracking })
      }
    }
  }

  function remove_instance_from_view_tracking (base_path, instance_path) {
    if (view_order_tracking[base_path]) {
      const index = view_order_tracking[base_path].indexOf(instance_path)
      if (index !== -1) {
        view_order_tracking[base_path].splice(index, 1)
        // Clean up empty arrays
        if (view_order_tracking[base_path].length === 0) {
          delete view_order_tracking[base_path]
        }

        // Only save to drive if not currently loading from drive
        if (!is_loading_from_drive) {
          drive_updated_by_tracking = true
          update_drive_state({ type: 'runtime/view_order_tracking', message: view_order_tracking })
        }
      }
    }
  }

  // Recursively add instances to tracking when expanding
  function add_instances_recursively (base_path, parent_instance_path, instance_states, all_entries) {
    const instance_path = `${parent_instance_path}|${base_path}`
    const entry = all_entries[base_path]
    if (!entry) return

    const state = get_or_create_state(instance_states, instance_path)

    if (state.expanded_hubs && Array.isArray(entry.hubs)) {
      entry.hubs.forEach(hub_path => {
        add_instances_recursively(hub_path, instance_path, instance_states, all_entries)
      })
    }

    if (state.expanded_subs && Array.isArray(entry.subs)) {
      entry.subs.forEach(sub_path => {
        add_instances_recursively(sub_path, instance_path, instance_states, all_entries)
      })
    }

    // Add the instance itself
    add_instance_to_view_tracking(base_path, instance_path)
  }

  // Recursively remove instances from tracking when collapsing
  function remove_instances_recursively (base_path, parent_instance_path, instance_states, all_entries) {
    const instance_path = `${parent_instance_path}|${base_path}`
    const entry = all_entries[base_path]
    if (!entry) return

    const state = get_or_create_state(instance_states, instance_path)

    if (state.expanded_hubs && Array.isArray(entry.hubs)) {
      entry.hubs.forEach(hub_path => {
        remove_instances_recursively(hub_path, instance_path, instance_states, all_entries)
      })
    }

    if (state.expanded_subs && Array.isArray(entry.subs)) {
      entry.subs.forEach(sub_path => {
        remove_instances_recursively(sub_path, instance_path, instance_states, all_entries)
      })
    }

    // Remove the instance itself
    remove_instance_from_view_tracking(base_path, instance_path)
  }

  function get_next_duplicate_instance (base_path, current_instance_path) {
    const duplicates = duplicate_entries_map[base_path]
    if (!duplicates || duplicates.instances.length <= 1) return null

    const current_index = duplicates.instances.indexOf(current_instance_path)
    if (current_index === -1) return duplicates.instances[0]

    const next_index = (current_index + 1) % duplicates.instances.length
    return duplicates.instances[next_index]
  }

  function has_duplicates (base_path) {
    return duplicate_entries_map[base_path] && duplicate_entries_map[base_path].instances.length > 1
  }

  function is_first_duplicate (base_path, instance_path) {
    const duplicates = duplicate_entries_map[base_path]
    return duplicates && duplicates.first_instance === instance_path
  }

  function cycle_to_next_duplicate (base_path, current_instance_path) {
    const next_instance_path = get_next_duplicate_instance(base_path, current_instance_path)
    if (next_instance_path) {
      remove_jump_button_from_entry(current_instance_path)

      // First, handle the scroll and DOM updates without drive state changes
      scroll_to_and_highlight_instance(next_instance_path, current_instance_path)

      // Manually update DOM styling
      update_last_clicked_styling(next_instance_path)
      last_clicked_node = next_instance_path
      drive_updated_by_scroll = true // Prevent onbatch from interfering with scroll
      drive_updated_by_match = true
      update_drive_state({ type: 'runtime/last_clicked_node', message: next_instance_path })

      // Add jump button to the target entry (with a small delay to ensure DOM is ready)
      setTimeout(jump_out, 10)
      function jump_out () {
        const target_element = shadow.querySelector(`[data-instance_path="${CSS.escape(next_instance_path)}"]`)
        if (target_element) {
          add_jump_button_to_matching_entry(target_element, base_path, next_instance_path)
        }
      }
    }
  }

  function update_last_clicked_styling (new_instance_path) {
    // Remove last-clicked class from all elements
    const all_nodes = shadow.querySelectorAll('.node.last-clicked')
    all_nodes.forEach(node => {
      mode === 'search' ? node.classList.remove('search-last-clicked') : node.classList.remove('last-clicked')
    })
    // Add last-clicked class to the new element
    if (new_instance_path) {
      const new_element = shadow.querySelector(`[data-instance_path="${CSS.escape(new_instance_path)}"]`)
      if (new_element) {
        mode === 'search' ? new_element.classList.add('search-last-clicked') : new_element.classList.add('last-clicked')
      }
    }
  }

  function remove_jump_button_from_entry (instance_path) {
    const current_element = shadow.querySelector(`[data-instance_path="${CSS.escape(instance_path)}"]`)
    if (current_element) {
      // restore the wand icon
      const node_data = view.find(n => n.instance_path === instance_path)
      if (node_data && node_data.base_path === '/' && instance_path === '|/') {
        const wand_el = current_element.querySelector('.wand.navigate-to-hub')
        if (wand_el && root_wand_state) {
          wand_el.textContent = root_wand_state.content
          wand_el.className = root_wand_state.className
          wand_el.onclick = root_wand_state.onclick

          root_wand_state = null
        }
        return
      }

      // Regular behavior for non-root nodes
      const button_container = current_element.querySelector('.indent-btn-container')
      if (button_container) {
        button_container.remove()
        // Restore left-indent class
        if (node_data && node_data.depth > 0) {
          current_element.classList.add('left-indent')
        }
      }
    }
  }

  function add_jump_button_to_matching_entry (el, base_path, instance_path) {
    // Check if jump button already exists
    if (el.querySelector('.navigate-to-hub')) return

    // replace the wand icon temporarily
    if (base_path === '/' && instance_path === '|/') {
      const wand_el = el.querySelector('.wand')
      if (wand_el) {
        // Store original wand state in JavaScript variable
        root_wand_state = {
          content: wand_el.textContent,
          className: wand_el.className,
          onclick: wand_el.onclick
        }

        // Replace with jump button
        wand_el.textContent = '^'
        wand_el.className = 'wand navigate-to-hub clickable'
        wand_el.onclick = (event) => {
          event.stopPropagation()
          last_clicked_node = instance_path
          drive_updated_by_match = true
          update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })

          update_last_clicked_styling(instance_path)

          cycle_to_next_duplicate(base_path, instance_path)
        }
      }
      return
    }

    const indent_button_div = document.createElement('div')
    indent_button_div.className = 'indent-btn-container'

    const navigate_button = document.createElement('span')
    navigate_button.className = 'navigate-to-hub clickable'
    navigate_button.textContent = '^'
    navigate_button.onclick = (event) => {
      event.stopPropagation() // Prevent triggering the whole entry click again
      // Manually update last clicked node for jump button
      last_clicked_node = instance_path
      drive_updated_by_match = true
      update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })

      // Manually update DOM classes for last-clicked styling
      update_last_clicked_styling(instance_path)

      cycle_to_next_duplicate(base_path, instance_path)
    }

    indent_button_div.appendChild(navigate_button)

    // Remove left padding
    el.classList.remove('left-indent')
    el.insertBefore(indent_button_div, el.firstChild)
  }

  function scroll_to_and_highlight_instance (target_instance_path, source_instance_path = null) {
    const target_index = view.findIndex(n => n.instance_path === target_instance_path)
    if (target_index === -1) return

    // Calculate scroll position
    let target_scroll_top = target_index * node_height

    if (source_instance_path) {
      const source_index = view.findIndex(n => n.instance_path === source_instance_path)
      if (source_index !== -1) {
        const source_scroll_top = source_index * node_height
        const current_scroll_top = container.scrollTop
        const source_visible_offset = source_scroll_top - current_scroll_top
        target_scroll_top = target_scroll_top - source_visible_offset
      }
    }

    container.scrollTop = target_scroll_top
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
    return string.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') // Corrected: should be \\$& to escape the found char
  }

  function check_and_reset_feedback_flags () {
    if (drive_updated_by_scroll && !ignore_drive_updated_by_scroll) {
      drive_updated_by_scroll = false
      return true
    } else ignore_drive_updated_by_scroll = false
    if (drive_updated_by_toggle) {
      drive_updated_by_toggle = false
      return true
    }
    if (drive_updated_by_search) {
      drive_updated_by_search = false
      return true
    }
    if (drive_updated_by_match) {
      drive_updated_by_match = false
      return true
    }
    if (drive_updated_by_tracking) {
      drive_updated_by_tracking = false
      return true
    }
    console.log('[SEARCH DEBUG] No feedback flags set, allowing onbatch')
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
        requestAnimationFrame(spacer_frames)
      } else {
        spacer_element.style.height = `${existing_height}px`
        requestAnimationFrame(sync_fn)
      }
    } else {
      spacer_element = null
      spacer_initial_height = 0
      requestAnimationFrame(sync_fn)
    }
    function spacer_frames () {
      const container_height = container.clientHeight
      const content_height = view.length * node_height
      const max_scroll_top = content_height - container_height

      if (new_scroll_top > max_scroll_top) {
        spacer_initial_height = new_scroll_top - max_scroll_top
        spacer_element.style.height = `${spacer_initial_height}px`
      }
      sync_fn()
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
      update_drive_state({ type: `runtime/${name}`, message: new_value })
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
          'last_clicked_node.json': { raw: 'null' },
          'view_order_tracking.json': { raw: '{}' }
        },
        'mode/': {
          'current_mode.json': { raw: '"menubar"' },
          'previous_mode.json': { raw: '"menubar"' },
          'search_query.json': { raw: '""' },
          'multi_select_enabled.json': { raw: 'false' },
          'select_between_enabled.json': { raw: 'false' }
        },
        'flags/': {
          'hubs.json': { raw: '"default"' }
        }
      }
    }
  }
}
