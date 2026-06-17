# Graph Explorer Protocol System

The `graph_explorer` module communicates through `net_helper`. Its public API is:

```javascript
const graph_explorer = require('graph-explorer')

const element = await graph_explorer(opts, invite)
```

The parent creates the invite and handles messages from Graph Explorer:

```javascript
const net = require('net_helper')
const graph_explorer = require('graph-explorer')

const { io, _ } = net(id)
io.on = {
  graph_explorer: on_graph_explorer_message
}

const element = await graph_explorer(opts, io.invite('graph_explorer', { storage: id }))

function on_graph_explorer_message (msg) {
  if (msg.type.startsWith('db_')) return handle_db_request(msg)
  console.log('graph explorer event:', msg.type, msg.data)
}
```

## Message Structure

All routed messages are created by `net_helper`:

```javascript
{
  head: [sender_id, receiver_id, message_id],
  refs: { cause: parent_message_head },
  type: 'message_type',
  data: { ... },
  meta: {
    time,
    stack
  }
}
```

- `head` is created by `net_helper` and identifies the message.
- `refs` is supplied by the caller. Use `{}` for root/user events and `{ cause: msg.head }` for caused messages.
- `type` is the command, event, or database operation name.
- `data` is the payload.
- `meta` is created by `net_helper`.

Do not manually construct `{ head, refs, type, data }`. Send through channel helpers:

```javascript
_.graph_explorer('set_mode', {}, { mode: 'search' })
_.graph_explorer('db_response', { cause: request_msg.head }, { result })
```

Graph Explorer sends upward with `_.storage(type, refs, data)`.

## Database Contract

Graph Explorer does not own graph data. The parent/wrapper/page owns the graph database and responds to `db_*` requests.

Graph Explorer sends:

```javascript
_.storage('db_get', {}, { path: '/src/index.js' })
_.storage('db_has', {}, { path: '/' })
_.storage('db_is_empty', {}, {})
_.storage('db_root', {}, {})
_.storage('db_keys', {}, {})
_.storage('db_raw', {}, {})
```

The parent sends responses with the request head as the cause:

```javascript
_.graph_explorer('db_response', { cause: request_msg.head }, { result })
```

The response payload stays:

```javascript
{ result: any | null }
```

Use `null` for unavailable data, unknown operations, and missing paths. The parent may log errors locally, but the wire contract remains `{ result }`.

The parent also initializes the graph:

```javascript
_.graph_explorer('db_initialized', {}, { entries })
```

## Incoming Messages: Parent -> Graph Explorer

These messages can be sent with `_.graph_explorer(type, refs, data)`.

### `set_mode`

Change the current display mode.

```javascript
_.graph_explorer('set_mode', {}, { mode: 'search' })
```

`mode` must be one of `'default'`, `'menubar'`, or `'search'`.

### `set_search_query`

Set the search query.

```javascript
_.graph_explorer('set_search_query', {}, { query: 'my search' })
```

### `select_nodes`

Programmatically select nodes.

```javascript
_.graph_explorer('select_nodes', {}, { instance_paths: ['|/', '|/src'] })
```

### `expand_node`

Expand a node's children and/or hubs.

```javascript
_.graph_explorer('expand_node', {}, {
  instance_path: '|/',
  expand_subs: true,
  expand_hubs: true
})
```

### `collapse_node`

Collapse a node.

```javascript
_.graph_explorer('collapse_node', {}, { instance_path: '|/src' })
```

### `toggle_node`

Toggle a node's expansion state.

```javascript
_.graph_explorer('toggle_node', {}, {
  instance_path: '|/src',
  toggle_type: 'subs'
})
```

`toggle_type` is `'subs'` or `'hubs'`.

### `get_selected`

Request current selected nodes.

```javascript
_.graph_explorer('get_selected', {}, {})
```

Graph Explorer responds with `selected_nodes`.

### `get_confirmed`

Request current confirmed nodes.

```javascript
_.graph_explorer('get_confirmed', {}, {})
```

Graph Explorer responds with `confirmed_nodes`.

### `clear_selection`

Clear selected and confirmed nodes.

```javascript
_.graph_explorer('clear_selection', {}, {})
```

### `set_flag`

Set a configuration flag.

```javascript
_.graph_explorer('set_flag', {}, {
  flag_type: 'hubs',
  value: 'true'
})
```

`flag_type` is one of `'hubs'`, `'selection'`, or `'recursive_collapse'`.

### `scroll_to_node`

Scroll to a node in the view.

```javascript
_.graph_explorer('scroll_to_node', {}, {
  instance_path: '|/src/index.js'
})
```

## Outgoing Messages: Graph Explorer -> Parent

Graph Explorer sends these through `_.storage(type, refs, data)`.

- `node_clicked`: `{ instance_path }`
- `selection_changed`: `{ selected }`
- `subs_toggled`: `{ instance_path, expanded }`
- `hubs_toggled`: `{ instance_path, expanded }`
- `mode_toggling`: `{ from, to }`
- `mode_changed`: `{ mode }`
- `search_query_changed`: `{ query }`
- `node_expanded`: `{ instance_path, expand_subs, expand_hubs }`
- `node_collapsed`: `{ instance_path }`
- `node_toggled`: `{ instance_path, toggle_type }`
- `selected_nodes`: `{ selected }`
- `confirmed_nodes`: `{ confirmed }`
- `selection_cleared`: `{}`
- `flag_changed`: `{ flag_type, value }`
- `scrolled_to_node`: `{ instance_path, scroll_position }`

## Instance Paths

Instance paths uniquely identify a node in the graph, including its position in the hierarchy. They follow the format:

```text
|/path/to/node
```

Examples:

- Root: `|/`
- First-level child: `|/src`
- Nested child: `|/src|/src/index.js`

The pipe character (`|`) separates hierarchy levels, allowing the same base path to appear multiple times in different contexts.
