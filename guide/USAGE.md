# Graph Explorer Usage Guide

This guide explains how to integrate the graph explorer component with a parent-owned graph database and the `net_helper` protocol.

## Quick Setup Pattern

1. Create `entries.json` in your component directory.
2. Copy or provide a `graphdb.js` module in your component.
3. Create an `entries` dataset with `$ref` to your `entries.json`.
4. Create a parent `net_helper` channel for Graph Explorer.
5. Pass an invite to `graph_explorer(opts, invite)`.
6. Answer Graph Explorer `db_*` requests from the parent-owned database.

## Step 1: Create Graph Data File

Create `entries.json` in the same directory as your component:

```json
{
  "/": {
    "name": "Root Directory",
    "type": "root",
    "subs": ["/src", "/assets", "/README.md"],
    "hubs": ["/LICENSE"]
  },
  "/src": {
    "name": "src",
    "type": "folder",
    "subs": ["/src/index.js", "/src/styles.css"]
  },
  "/src/index.js": {
    "name": "index.js",
    "type": "js-file"
  },
  "/README.md": {
    "name": "README.md",
    "type": "file"
  }
}
```

## Step 2: Add GraphDB Module

It can be custom, but the simplest one is:

```javascript
module.exports = graphdb

function graphdb (entries) {
  if (!entries || typeof entries !== 'object') {
    console.warn('[graphdb] Invalid entries provided, using empty object')
    entries = {}
  }

  return {
    get,
    has,
    keys,
    is_empty,
    root,
    raw
  }

  function get (path) { return entries[path] || null }
  function has (path) { return path in entries }
  function keys () { return Object.keys(entries) }
  function is_empty () { return Object.keys(entries).length === 0 }
  function root () { return entries['/'] || null }
  function raw () { return entries }
}
```

## Step 3: Create Parent Component

```javascript
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const net = require('net_helper')
const graph_explorer = require('graph-explorer')
const graphdb = require('./graphdb')

module.exports = my_component_with_graph

async function my_component_with_graph (opts, invite) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const { io, _ } = net(id)

  let db = null
  let latest_entries = null
  let graph_explorer_connected = false

  io.on = {
    storage: onmessage,
    graph_explorer: graph_explorer_protocol
  }
  if (invite) io.accept(invite)

  const on = {
    theme: inject,
    entries: on_entries
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  const sheet = new CSSStyleSheet()
  shadow.adoptedStyleSheets = [sheet]

  const subs = await sdb.watch(onbatch)
  const explorer_el = await graph_explorer(subs[0], io.invite('graph_explorer', { storage: id }))
  graph_explorer_connected = true
  sync_initial_state_to_child()
  shadow.append(explorer_el)

  return el

  function onmessage (msg) {
    if (msg.type === 'set_mode') {
      _.graph_explorer('set_mode', { cause: msg.head }, msg.data)
    }
  }

  function graph_explorer_protocol (msg) {
    if (msg.type.startsWith('db_')) return handle_db_request(msg)
    send_parent_message(msg.type, msg.head ? { cause: msg.head } : {}, msg.data)
  }

  function handle_db_request (request_msg) {
    const { head: request_head, type: operation, data: params } = request_msg

    if (!db) {
      console.error('[my_component] Database not initialized yet')
      return send_response(request_head, null)
    }

    const db_handler = {
      db_get: () => db.get(params.path),
      db_has: () => db.has(params.path),
      db_is_empty: () => db.is_empty(),
      db_root: () => db.root(),
      db_keys: () => db.keys(),
      db_raw: () => db.raw()
    }
    const handler = db_handler[operation]
    if (!handler) {
      console.warn('[my_component] Unknown db operation:', operation)
      return send_response(request_head, null)
    }

    send_response(request_head, handler())
  }

  function send_response (request_head, result) {
    send_child_message('db_response', { cause: request_head }, { result })
  }

  function send_child_message (type, refs = {}, data = {}) {
    if (!_.graph_explorer) throw new Error('my_component net_helper channel "graph_explorer" is not connected')
    return _.graph_explorer(type, refs, data)
  }

  function send_parent_message (type, refs = {}, data = {}) {
    if (!_.storage) return
    return _.storage(type, refs, data)
  }

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const handler = on[type] || fail
      handler({ data, type })
    }
  }

  function inject ({ data }) {
    sheet.replaceSync(data.join('\n'))
  }

  function on_entries ({ data }) {
    if (!data || !data[0]) {
      console.error('Entries data is missing or empty.')
      db = graphdb({})
      latest_entries = {}
      notify_db_initialized({})
      return
    }

    let parsed_data
    try {
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
    notify_db_initialized(parsed_data)
  }

  function notify_db_initialized (entries) {
    if (!graph_explorer_connected) return
    send_child_message('db_initialized', {}, { entries })
  }

  function sync_initial_state_to_child () {
    if (latest_entries !== null) notify_db_initialized(latest_entries)
  }

  function fail ({ data, type }) {
    console.warn('invalid message', { cause: { data, type } })
  }
}
```

## Key Points

- `graph_explorer(opts, invite)` requires a `net_helper` invite.
- The parent owns `graphdb` and responds to Graph Explorer `db_*` requests.
- Parent-to-child sends use `_.graph_explorer(type, refs, data)`.
- Child-to-parent messages arrive through the parent `graph_explorer` handler.
- `db_response` stays `{ result }`; use `null` for unavailable data or unknown operations.
- Do not manually build `head`, `mid`, or `meta`.

## File Structure

```text
my-component/
├── my_component_with_graph.js
├── entries.json
└── graphdb.js
```

This approach keeps graph data local to the parent while Graph Explorer stays focused on rendering and interaction.
