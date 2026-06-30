// =============================================================================
// GRAPH EXPLORER WRAPPER - COMMENTED EXAMPLE
// =============================================================================
// Mirrors the current ui-components graph_viewer.
//
// The wrapper owns graphdb, invites graph_explorer through net_helper, answers
// db_* requests, forwards child events upward, and queues parent commands until
// the graph database is initialized.
// =============================================================================

const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const net = require('net_helper')
const graph_explorer = require('graph-explorer')
const graphdb = require('./graphdb')

module.exports = graph_viewer

// =============================================================================
// MAIN COMPONENT FUNCTION
// =============================================================================
// A STATE component that mounts graph_explorer as a child and acts as the
// protocol boundary between the app and Graph Explorer.
async function graph_viewer (opts, invite) {
  // ---------------------------------------------------------------------------
  // 1. Component setup
  // ---------------------------------------------------------------------------
  // STATE instance id is also the net_helper sender id.
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb // Reads theme and entries data.

  // Parent-owned graph database. Graph Explorer reads through db_* requests.
  let db = null

  // Last parsed entries, reused if data loads before the child channel connects.
  let latest_entries = null

  // Commands wait until db_initialized so path-dependent actions see a view.
  const pending_to_graph_explorer = []
  let graph_explorer_connected = false
  let graph_explorer_db_ready = false

  // ---------------------------------------------------------------------------
  // 2. net_helper wiring
  // ---------------------------------------------------------------------------
  // net(id) returns io for wiring and _ for channel sends.
  //
  // accept(parent invite) creates _.up(...).
  // invite('graph_explorer') creates _.graph_explorer(...).
  const { io, _ } = net(id)
  io.on = {
    // Parent -> wrapper.
    up: onmessage,

    // Graph Explorer -> wrapper.
    graph_explorer: graph_explorer_protocol
  }
  if (invite) io.accept(invite)

  // Drive batch handlers. Names come from fallback_module mappings.
  const on = {
    theme: inject,
    entries: on_entries
  }

  // ---------------------------------------------------------------------------
  // 3. DOM and drive setup
  // ---------------------------------------------------------------------------
  // Wrapper host. Parent sees this one element.
  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })

  // Wrapper-level styles. Graph Explorer has its own mapped datasets.
  const sheet = new CSSStyleSheet()
  shadow.adoptedStyleSheets = [sheet]

  // watch returns submodule opts; subs[0] is Graph Explorer.
  const subs = await sdb.watch(onbatch)

  // Hard-switch API: graph_explorer receives a net_helper invite.
  const explorer_el = await graph_explorer(subs[0], io.invite('graph_explorer', { storage: id }))
  graph_explorer_connected = true

  // Replay already-loaded entries after child channel setup.
  Promise.resolve().then(sync_initial_state_to_child)
  shadow.append(explorer_el)

  return el

  // ---------------------------------------------------------------------------
  // 4. Parent -> wrapper messages
  // ---------------------------------------------------------------------------
  // Parent messages are wrapper commands or child commands to forward.
  function onmessage (msg) {
    const parent_handlers = {
      execute_step: parent_execute_step,
      set_mode: parent_forward_to_graph_explorer,
      set_search_query: parent_forward_to_graph_explorer,
      select_nodes: parent_forward_to_graph_explorer,
      expand_node: parent_forward_to_graph_explorer,
      collapse_node: parent_forward_to_graph_explorer,
      toggle_node: parent_forward_to_graph_explorer,
      get_selected: parent_forward_to_graph_explorer,
      get_confirmed: parent_forward_to_graph_explorer,
      clear_selection: parent_forward_to_graph_explorer,
      set_flag: parent_forward_to_graph_explorer,
      scroll_to_node: parent_forward_to_graph_explorer,
      docs_toggle: parent_forward_to_graph_explorer
    }
    const handler = parent_handlers[msg.type] || fail
    handler(msg)
  }

  // Normalize execute_step payloads into child commands.
  function parent_execute_step (msg) {
    const commands = get_step_commands(msg.data)
    for (const command of commands) {
      // Preserve causality from parent execute_step.
      const refs = msg.head ? { cause: msg.head } : {}
      const data = command.data !== undefined ? command.data : {}
      send_to_graph_explorer_message(command.type, refs, data)
    }
  }

  function parent_forward_to_graph_explorer (msg) {
    // Preserve type/data and link the parent message as cause.
    const refs = msg.head ? { cause: msg.head } : {}
    send_to_graph_explorer_message(msg.type, refs, msg.data)
  }

  function send_to_graph_explorer_message (type, refs, data) {
    // Wait for db_initialized before path/view-dependent commands.
    if (!can_send_to_graph_explorer()) {
      pending_to_graph_explorer.push({ type, refs, data })
      return
    }
    send_child_message(type, refs, data)
  }

  function flush_to_graph_explorer_queue () {
    // Replay in arrival order.
    while (can_send_to_graph_explorer() && pending_to_graph_explorer.length) {
      const next_msg = pending_to_graph_explorer.shift()
      send_child_message(next_msg.type, next_msg.refs, next_msg.data)
    }
  }

  function can_send_to_graph_explorer () {
    return graph_explorer_connected && graph_explorer_db_ready
  }

  function get_step_commands (data) {
    // Accepted shapes:
    // - { commands: [{ type, data }, ...] }
    // - { command: { type, data } }
    // - { type, data }
    if (!data) return []
    if (Array.isArray(data.commands)) return data.commands.filter(has_command_type)
    if (data.command && has_command_type(data.command)) return [data.command]
    if (has_command_type(data)) {
      return [{ type: data.type, data: data.data !== undefined ? data.data : {} }]
    }
    return []

    function has_command_type (command) {
      return command && typeof command.type === 'string' && command.type.length > 0
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Drive data processing
  // ---------------------------------------------------------------------------
  // Load changed drive files and dispatch by dataset type.
  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(load_path_raw))
      const handler = on[type] || fail
      handler({ data, type })
    }

    function load_path_raw (path) { return drive.get(path).then(read_drive_file_raw) }
    function read_drive_file_raw (file) { return file.raw }
  }

  function fail ({ data, type }) {
    // Non-fatal for examples: show bad types without breaking the page.
    console.warn('invalid message', { cause: { data, type } })
  }

  function inject ({ data }) {
    // Theme data is an array of CSS strings.
    sheet.replaceSync(data.join('\n'))
  }

  function on_entries ({ data }) {
    // Invalid or missing entries still initialize an empty graphdb.
    if (!data || !data[0]) {
      console.error('Entries data is missing or empty.')
      latest_entries = {}
      db = graphdb({})
      notify_db_initialized({})
      return
    }

    let parsed_data
    try {
      // Accept raw JSON text or an already-parsed object.
      parsed_data = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    } catch (e) {
      console.error('Failed to parse entries data:', e)
      parsed_data = {}
    }

    if (typeof parsed_data !== 'object' || !parsed_data) {
      console.error('Parsed entries data is not a valid object.')
      parsed_data = {}
    }

    db = graphdb(parsed_data)
    latest_entries = parsed_data

    // Queue commands during the refresh; flush after db_initialized.
    graph_explorer_db_ready = false
    notify_db_initialized(parsed_data)
  }

  function notify_db_initialized (entries) {
    if (!graph_explorer_connected) return

    // net_helper creates head/meta; do not build messages manually.
    send_child_message('db_initialized', {}, { entries })
    graph_explorer_db_ready = true
    flush_to_graph_explorer_queue()
  }

  // ---------------------------------------------------------------------------
  // 6. Graph Explorer -> wrapper messages
  // ---------------------------------------------------------------------------
  // Handles child messages sent with _.storage(...).
  function graph_explorer_protocol (msg) {
    const { type } = msg

    if (type.startsWith('db_')) {
      // db_* stays here because wrapper owns graphdb.
      handle_db_request(msg)
    } else {
      // Forward child events upward and preserve causality.
      send_parent_message(msg.type, msg.head ? { cause: msg.head } : {}, msg.data)
    }
  }

  function send_child_message (type, refs = {}, data = {}) {
    // Wrapper -> child sends always use the channel helper.
    if (!_.graph_explorer) throw new Error('graph_explorer_wrapper net_helper channel "graph_explorer" is not connected')
    return _.graph_explorer(type, refs, data)
  }

  function send_parent_message (type, refs = {}, data = {}) {
    // Wrapper -> parent is only available when the wrapper received an invite.
    if (!_.up) return
    return _.up(type, refs, data)
  }

  function sync_initial_state_to_child () {
    // Send entries that loaded before the child channel existed.
    if (latest_entries !== null) {
      notify_db_initialized(latest_entries)
    }
  }

  function handle_db_request (request_msg) {
    // Graph Explorer db API: db_* request in, db_response out.
    const { head: request_head, type: operation, data: params } = request_msg
    if (!db) {
      console.error('[graph_viewer] Database not initialized yet')
      send_response(request_head, null)
      return
    }

    // Explicit allow-list of graphdb operations exposed to the child.
    const db_handler = {
      db_get: (path) => db.get(path),
      db_has: (path) => db.has(path),
      db_is_empty: () => db.is_empty(),
      db_root: () => db.root(),
      db_keys: () => db.keys(),
      db_raw: () => db.raw()
    }
    const method = db_handler[operation]
    if (!method) {
      db_fail()
      return
    }

    const result = method(params.path)
    send_response(request_head, result)

    function db_fail () {
      console.warn('[graph_viewer] Unknown db operation:', operation)
      send_response(request_head, null)
    }
  }

  function send_response (request_head, result) {
    // db_response stays { result }; failures/misses return null.
    //
    // refs.cause lets Graph Explorer match this to request_head.
    send_child_message('db_response', { cause: request_head }, { result })
  }
}

// =============================================================================
// FALLBACK MODULE DEFINITION
// =============================================================================
// Default dependencies and drive data for isolated/dev use.
function fallback_module () {
  return {
    // Module dependencies.
    _: {
      'graph-explorer': {
        $: ''
      },
      './graphdb': {
        $: ''
      },
      net_helper: {
        $: ''
      }
    },
    api: fallback_instance
  }

  function fallback_instance () {
    return {
      // Instance dependencies and dataset mappings.
      _: {
        'graph-explorer': {
          $: '',
          0: '',
          mapping: {
            // Graph Explorer dataset -> wrapper dataset.
            style: 'theme',
            runtime: 'runtime',
            mode: 'mode',
            flags: 'flags',
            keybinds: 'keybinds',
            undo: 'undo',
            docs: 'docs'
          }
        },
        './graphdb': {
          $: ''
        },
        // Needed for both parent and child channels.
        net_helper: {
          0: ''
        }
      },
      drive: {
        // Wrapper-level theme; mapped to Graph Explorer's style dataset.
        'theme/': {
          'style.css': {
            raw: `
              :host {
              display: block;
              height: 100%;
              width: 100%;
              }
            `
          }
        },
        // Graph data. $ref keeps sample data in entries.json.
        'entries/': {
          'entries.json': {
            $ref: 'entries.json'
          }
        },
        // Graph Explorer runtime state.
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
        // Mode state for default/menubar/search.
        'mode/': {
          'current_mode.json': { raw: '"menubar"' },
          'previous_mode.json': { raw: '"menubar"' },
          'search_query.json': { raw: '""' },
          'multi_select_enabled.json': { raw: 'false' },
          'select_between_enabled.json': { raw: 'false' }
        },
        // Feature flags.
        'flags/': {
          'hubs.json': { raw: '"default"' },
          'selection.json': { raw: 'true' },
          'recursive_collapse.json': { raw: 'true' }
        },
        // Keyboard command mapping.
        'keybinds/': {
          'navigation.json': {
            raw: JSON.stringify({
              ArrowUp: 'navigate_up_current_node',
              ArrowDown: 'navigate_down_current_node',
              'Control+ArrowDown': 'toggle_subs_for_current_node',
              'Control+ArrowUp': 'toggle_hubs_for_current_node',
              'Alt+s': 'multiselect_current_node',
              'Alt+b': 'select_between_current_node',
              'Control+m': 'toggle_search_mode',
              'Alt+j': 'jump_to_next_duplicate'
            })
          }
        },
        // Persisted undo history.
        'undo/': {
          'stack.json': { raw: '[]' }
        },
        // Optional docs dataset.
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        }
      }
    }
  }
}
