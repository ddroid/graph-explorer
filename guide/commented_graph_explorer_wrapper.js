// =============================================================================
// GRAPH EXPLORER WRAPPER - COMMENTED EXAMPLE
// =============================================================================
// This file demonstrates how to create a wrapper component that integrates
// the graph-explorer with the drive system and standard protocol. you don't need a wrapper but it often gets complex with the addition of overrides especially when you want to customize the behavior.
// =============================================================================

const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const graph_explorer = require('graph-explorer')
const graphdb = require('./graphdb')

module.exports = graph_explorer_wrapper

// =============================================================================
// MAIN COMPONENT FUNCTION
// =============================================================================
async function graph_explorer_wrapper (opts, protocol) {
  // -------------------------------------------------------------------------
  // 1. COMPONENT INITIALIZATION
  // -------------------------------------------------------------------------

  // Get component instance and state database from STATE system
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb // Drive system for data management

  // Validate required parent ID for protocol communication
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }

  // Set up protocol identifiers
  const by = id // Our component ID (sender)
  // const to = ids.up  // Parent component ID (receiver) - not used directly

  // -------------------------------------------------------------------------
  // 2. INTERNAL STATE MANAGEMENT
  // -------------------------------------------------------------------------

  let db = null // Graph database instance (will be initialized from entries data)

  // Protocol communication variables
  let send_to_graph_explorer = null // Function to send messages TO graph explorer
  let mid = 0 // Message ID counter for outgoing messages

  // -------------------------------------------------------------------------
  // 3. DATA HANDLERS
  // -------------------------------------------------------------------------

  // Map of data types to handler functions
  const on = {
    theme: inject, // Handle CSS theme updates
    entries: on_entries // Handle graph data updates
  }

  // -------------------------------------------------------------------------
  // 4. DOM ELEMENT SETUP
  // -------------------------------------------------------------------------

  // Create main component container
  const el = document.createElement('div')

  // Create Shadow DOM for style isolation
  const shadow = el.attachShadow({ mode: 'closed' })

  // Set up CSS stylesheet for the Shadow DOM
  const sheet = new CSSStyleSheet()
  shadow.adoptedStyleSheets = [sheet]

  // -------------------------------------------------------------------------
  // 5. DRIVE DATA WATCHING
  // -------------------------------------------------------------------------

  // Start watching drive data changes
  // This will call onbatch() whenever drive data is updated
  const subs = await sdb.watch(onbatch)

  // Initialize the actual graph explorer component
  // Pass drive subscriptions and our protocol handler
  const explorer_el = await graph_explorer(subs[0], graph_explorer_protocol)
  shadow.append(explorer_el)

  // Return the main element to the parent
  return el

  // -------------------------------------------------------------------------
  // 6. DRIVE DATA PROCESSING
  // -------------------------------------------------------------------------

  // Called when drive data changes (batch updates)
  async function onbatch (batch) {
    // Process each change in the batch
    for (const { type, paths } of batch) {
      // Get the actual data for all changed paths
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))

      // Call the appropriate handler for this data type
      on[type] && on[type](data)
    }
  }

  // -------------------------------------------------------------------------
  // 7. THEME/STYLE HANDLING
  // -------------------------------------------------------------------------

  // Inject CSS styles into the Shadow DOM
  function inject (data) {
    // data is an array of CSS strings, join them and apply to stylesheet
    sheet.replaceSync(data.join('\n'))
  }

  // -------------------------------------------------------------------------
  // 8. GRAPH DATA HANDLING
  // -------------------------------------------------------------------------

  // Handle entries data updates (core graph structure)
  function on_entries (data) {
    // Validate incoming data
    if (!data || !data[0]) {
      console.error('Entries data is missing or empty.')
      db = graphdb({}) // Create empty database
      notify_db_initialized({})
      return
    }

    let parsed_data
    try {
      // Parse JSON data if it's a string, otherwise use as-is
      parsed_data = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    } catch (e) {
      console.error('Failed to parse entries data:', e)
      parsed_data = {}
    }

    // Ensure we have a valid object
    if (typeof parsed_data !== 'object' || !parsed_data) {
      console.error('Parsed entries data is not a valid object.')
      parsed_data = {}
    }

    // Create graph database from parsed data
    db = graphdb(parsed_data)

    // Notify graph explorer that database is ready
    notify_db_initialized(parsed_data)
  }

  // -------------------------------------------------------------------------
  // 9. DATABASE NOTIFICATION
  // -------------------------------------------------------------------------

  // Send message to graph explorer when database is initialized/updated
  function notify_db_initialized (entries) {
    if (send_to_graph_explorer) {
      // Create standard protocol message
      const head = [by, 'graph_explorer', mid++]
      send_to_graph_explorer({
        head,
        type: 'db_initialized',
        data: { entries }
      })
    }
  }

  // -------------------------------------------------------------------------
  // 10. PROTOCOL IMPLEMENTATION
  // -------------------------------------------------------------------------

  // Standard protocol handler function
  // Called by graph_explorer to establish communication
  function graph_explorer_protocol (send) {
    // Store the send function provided by graph explorer
    // This allows us to send messages TO the graph explorer
    send_to_graph_explorer = send

    // Return our message handler function
    // This will be called when graph explorer sends messages TO US
    return on_graph_explorer_message

    // -------------------------------------------------------------------------
    // 11. MESSAGE HANDLING
    // -------------------------------------------------------------------------

    // Handle incoming messages from graph explorer
    function on_graph_explorer_message (msg) {
      const { type } = msg

      // Route database-related messages to the database handler
      if (type.startsWith('db_')) {
        handle_db_request(msg, send)
      }
    }

    // -------------------------------------------------------------------------
    // 12. DATABASE REQUEST HANDLING
    // -------------------------------------------------------------------------

    // Handle database operation requests from graph explorer
    function handle_db_request (request_msg, send) {
      const { head: request_head, type: operation, data: params } = request_msg
      let result

      // Ensure database is initialized
      if (!db) {
        console.error('[graph_explorer_wrapper] Database not initialized yet')
        send_response(request_head, null)
        return
      }

      // Execute the requested database operation
      if (operation === 'db_get') {
        result = db.get(params.path)
      } else if (operation === 'db_has') {
        result = db.has(params.path)
      } else if (operation === 'db_is_empty') {
        result = db.is_empty()
      } else if (operation === 'db_root') {
        result = db.root()
      } else if (operation === 'db_keys') {
        result = db.keys()
      } else if (operation === 'db_raw') {
        result = db.raw()
      } else {
        console.warn('[graph_explorer_wrapper] Unknown db operation:', operation)
        result = null
      }

      // Send the response back to graph explorer
      send_response(request_head, result)

      // -------------------------------------------------------------------
      // 13. RESPONSE SENDING
      // -------------------------------------------------------------------

      function send_response (request_head, result) {
        // Create standardized response message following the protocol
        const response_head = [by, 'graph_explorer', mid++]
        send({
          head: response_head,
          refs: { cause: request_head }, // Reference original request for causality
          type: 'db_response',
          data: { result }
        })
      }
    }
  }
}

// =============================================================================
// 14. FALLBACK MODULE DEFINITION
// =============================================================================
// This provides default structure and data when the component is used in
// isolation or for development/testing purposes.

function fallback_module () {
  return {
    // Module dependencies mapping
    _: {
      'graph-explorer': { $: '' },
      './graphdb': { $: '' }
    },
    // Instance factory function
    api: fallback_instance
  }

  function fallback_instance () {
    return {
      // Instance dependencies mapping
      _: {
        'graph-explorer': {
          $: '',
          0: '',
          // Drive dataset mappings for graph explorer
          mapping: {
            style: 'theme', // CSS styles -> theme dataset
            runtime: 'runtime', // Runtime state -> runtime dataset
            mode: 'mode', // Mode settings -> mode dataset
            flags: 'flags', // Configuration flags -> flags dataset
            keybinds: 'keybinds', // Keyboard bindings -> keybinds dataset
            undo: 'undo' // Undo history -> undo dataset
          }
        },
        './graphdb': {
          $: ''
        }
      },
      // Default drive structure with sample data
      drive: {
        // Theme dataset with default styles
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
        // Entries dataset for graph data
        'entries/': {
          'entries.json': {
            $ref: 'entries.json' // Reference to external entries file
          }
        },
        // Other required datasets (empty by default)
        'runtime/': {},
        'mode/': {},
        'flags/': {},
        'keybinds/': {},
        'undo/': {}
      }
    }
  }
}
