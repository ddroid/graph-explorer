# Graph Explorer Usage Guide

This guide explains how to integrate the graph explorer component using the simple file-based approach with the standard protocol.

## Quick Setup Pattern

1. **Create `entries.json`** in your component directory
2. **Copy `graphdb.js`** to your component directory  
3. **Create `entries` dataset** with `$ref` to your entries.json
4. **Implement protocol** using the standard pattern
5. **Pass drive to graph-explorer** via protocol

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
It can be a custom one but the simplest one is as below.
Copy `graphdb.js` to your component directory:

```javascript
// graphdb.js
module.exports = graphdb

function graphdb (entries) {
  if (!entries || typeof entries !== 'object') {
    console.warn('[graphdb] Invalid entries provided, using empty object')
    entries = {}
  }

  const api = {
    get,
    has,
    keys,
    is_empty,
    root,
    raw
  }

  return api

  function get (path) {
    return entries[path] || null
  }

  function has (path) {
    return path in entries
  }
  
  function keys () {
    return Object.keys(entries)
  }

  function is_empty () {
    return Object.keys(entries).length === 0
  }

  function root () {
    return entries['/'] || null
  }

  function raw () {
    return entries
  }
}
```

## Step 3: Create Component with Drive Dataset

```javascript
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const graph_explorer = require('graph-explorer')
const graphdb = require('./graphdb')

module.exports = my_component_with_graph

async function my_component_with_graph (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  
  const by = id
  let db = null
  let send_to_graph_explorer = null
  let mid = 0

  const on = {
    theme: inject,
    entries: on_entries
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  const sheet = new CSSStyleSheet()
  shadow.adoptedStyleSheets = [sheet]

  const subs = await sdb.watch(onbatch)
  const explorer_el = await graph_explorer(subs[0], graph_explorer_protocol)
  shadow.append(explorer_el)

  return el

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      on[type] && on[type](data)
    }
  }

  function inject (data) {
    sheet.replaceSync(data.join('\n'))
  }

  function on_entries (data) {
    if (!data || !data[0]) {
      console.error('Entries data is missing or empty.')
      db = graphdb({})
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
    notify_db_initialized(parsed_data)
  }

  function notify_db_initialized (entries) {
    if (send_to_graph_explorer) {
      const head = [by, 'graph_explorer', mid++]
      send_to_graph_explorer({
        head,
        type: 'db_initialized',
        data: { entries }
      })
    }
  }

  function graph_explorer_protocol (send) {
    send_to_graph_explorer = send
    return on_graph_explorer_message

    function on_graph_explorer_message (msg) {
      const { type } = msg
      if (type.startsWith('db_')) {
        handle_db_request(msg, send)
      }
    }

    function handle_db_request (request_msg, send) {
      const { head: request_head, type: operation, data: params } = request_msg
      let result

      if (!db) {
        console.error('[my_component] Database not initialized yet')
        send_response(request_head, null)
        return
      }

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
        console.warn('[my_component] Unknown db operation:', operation)
        result = null
      }

      send_response(request_head, result)

      function send_response (request_head, result) {
        const response_head = [by, 'graph_explorer', mid++]
        send({
          head: response_head,
          refs: { cause: request_head },
          type: 'db_response',
          data: { result }
        })
      }
    }
  }
}

function fallback_module () {
  return {
    _: {
      'graph-explorer': { $: '' },
      './graphdb': { $: '' }
    },
    api: fallback_instance
  }

  function fallback_instance () {
    return {
      _: {
        'graph-explorer': {
          $: '',
          0: '',
          mapping: {
            style: 'theme',
            runtime: 'runtime',
            mode: 'mode',
            flags: 'flags',
            keybinds: 'keybinds',
            undo: 'undo'
          }
        },
        './graphdb': {
          $: ''
        }
      },
      drive: {
        'theme/': {
          'style.css': {
            raw: `
              :host {
                display: block;
                height: 100%;
                width: 100%;
              }
              .graph-container {
                color: #abb2bf;
                background-color: #282c34;
                padding: 10px;
                height: 100vh;
                overflow: auto;
              }
              .node {
                display: flex;
                align-items: center;
                white-space: nowrap;
                cursor: default;
                height: 22px;
              }
              .clickable {
                cursor: pointer;
              }
              .node.type-folder > .icon::before { content: '�'; }
              .node.type-js-file > .icon::before { content: '📜'; }
              .node.type-file > .icon::before { content: '📄'; }
            `
          }
        },
        'entries/': {
          'entries.json': {
            $ref: 'entries.json'
          }
        },
        'runtime/': {},
        'mode/': {},
        'flags/': {},
        'keybinds/': {},
        'undo/': {}
      }
    }
  }
}
```

## Step 4: Use Your Component

## Key Points

1. `entries.json`: Store in same directory as your component
2. `graphdb.js`: Copy the simple module to your directory  
3. `$ref`: Use `$ref: 'entries.json'` to link your file
4. `Protocol`: Follow the standard pattern for communication
5. `Drive`: Pass entries to graphdb, then drive to graph_explorer

## File Structure

```
my-component/
├── my_component_with_graph.js
├── entries.json
└── graphdb.js
```

This approach keeps everything simple and local to your component while using the standard protocol for communication.
