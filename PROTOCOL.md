# Graph Explorer Protocol System

The `graph_explorer` module implements a standard bidirectional message-based communication protocol that allows parent modules to control the graph explorer and receive notifications after the requested message was processed.

## Usage

When initializing the graph explorer, pass a protocol function as the second parameter:

```javascript
const _ = {} // Store the send function to communicate with graph_explorer
const graph_explorer = require('graph-explorer')

const element = await graph_explorer(opts, protocol)

function protocol (send) {
  // Store the send function to communicate with graph_explorer
  _.graph_send = send
  
  // Return a message handler function
  return onmessage
  
  function onmessage (msg) {
    const { head, refs, type, data } = msg
    // Handle messages from graph_explorer
    switch (type) {
      case 'node_clicked':
        console.log('Node clicked:', data.instance_path)
        break
      case 'selection_changed':
        console.log('Selection changed:', data.selected)
        break
      // ... handle other message types
    }
  }
}
```

## Message Structure

All messages follow the standard protocol format:

```javascript
{
  head: [sender_id, receiver_id, message_id],
  refs: { cause: parent_message_head },
  type: "message_type",
  data: { ... }
}
```

- `head`: `[from, to, id]` - Unique message identifier
- `refs`: reference to cause (empty `{}` for user events)
- `type`: Message type string
- `data`: Message payload

## Incoming Messages (Parent → Graph Explorer)

These messages can be sent to the graph explorer to control its behavior:

### `set_mode`
Change the current display mode.

**Data:**
- `mode` (String): One of `'default'`, `'menubar'`, or `'search'`

**Example:**
```javascript
graph_send({ 
  head: [by, to, mid++], 
  refs: {}, 
  type: 'set_mode', 
  data: { mode: 'search' }
})
```

### `set_search_query`
Set the search query (automatically switches to search mode if not already).

**Data:**
- `query` (String): The search query string

**Example:**
```javascript
graph_send({ 
  head: [by, to, mid++], 
  refs: {}, 
  type: 'set_search_query', 
  data: { query: 'my search' }
})
```

### `select_nodes`
Programmatically select specific nodes.

**Data:**
- `instance_paths` (Array<String>): Array of instance paths to select - More about Instance paths will be defined at the end of this file

**Example:**
```javascript
graph_send({ 
  head: [by, to, mid++], 
  refs: {}, 
  type: 'select_nodes', 
  data: { instance_paths: ['|/', '|/src'] }
})
```

### `expand_node`
Expand a specific node's children and/or hubs.

**Data:**
- `instance_path` (String): The instance path of the node to expand
- `expand_subs` (Boolean, optional): Whether to expand children (default: true)
- `expand_hubs` (Boolean, optional): Whether to expand hubs (default: false)

**Example:**
```javascript
graph_send({ 
  head: [by, to, mid++], 
  refs: {}, 
  type: 'expand_node', 
  data: { instance_path: '|/', expand_subs: true, expand_hubs: true }
})
```

### `collapse_node`
Collapse a specific node's children and hubs.

**Data:**
- `instance_path` (String): The instance path of the node to collapse

**Example:**
```javascript
graph_send({ 
  head: [by, to, mid++], 
  refs: {}, 
  type: 'collapse_node', 
  data: { instance_path: '|/src' }
})
```

### `toggle_node`
Toggle expansion state of a node.

**Data:**
- `instance_path` (String): The instance path of the node to toggle
- `toggle_type` (String, optional): Either `'subs'` or `'hubs'` (default: `'subs'`)

**Example:**
```javascript
graph_send({ 
  head: [by, to, mid++], 
  refs: {}, 
  type: 'toggle_node', 
  data: { instance_path: '|/src', toggle_type: 'subs' }
})
```

### `get_selected`
Request the current selection state.

**Data:** None (empty object)

**Response:** Triggers a `selected_nodes` message

**Example:**
```javascript
graph_send({ 
  head: [by, to, mid++], 
  refs: {}, 
  type: 'get_selected', 
  data: {}
})
```

### `get_confirmed`
Request the current confirmed selection state.

**Data:** None (empty object)

**Response:** Triggers a `confirmed_nodes` message

**Example:**
```javascript
graph_send({ 
  head: [by, to, mid++], 
  refs: {}, 
  type: 'get_confirmed', 
  data: {}
})
```

### `clear_selection`
Clear all selected and confirmed nodes.

**Data:** None (empty object)

**Example:**
```javascript
graph_send({ 
  head: [by, to, mid++], 
  refs: {}, 
  type: 'clear_selection', 
  data: {}
})
```

### `set_flag`
Set a configuration flag.

**Data:**
- `flag_type` (String): One of `'hubs'`, `'selection'`, or `'recursive_collapse'`
- `value` (String|Boolean): The flag value
  - For `'hubs'`: `'default'`, `'true'`, or `'false'`
  - For `'selection'`: Boolean
  - For `'recursive_collapse'`: Boolean

**Example:**
```javascript
graph_send({ 
  head: [by, to, mid++], 
  refs: {}, 
  type: 'set_flag', 
  data: { flag_type: 'hubs', value: 'true' }
})
```

### `scroll_to_node`
Scroll to a specific node in the view.

**Data:**
- `instance_path` (String): The instance path of the node to scroll to

**Example:**
```javascript
graph_send({ 
  head: [by, to, mid++], 
  refs: {}, 
  type: 'scroll_to_node', 
  data: { instance_path: '|/src/index.js' }
})
```

## Outgoing Messages (Graph Explorer → Parent)

These messages are sent by the graph explorer to notify the parent module of events. They follow the same standard protocol format:

### `node_clicked`
Fired when a node is clicked.

**Data:**
- `instance_path` (String): The instance path of the clicked node

### `selection_changed`
Fired when the selection state changes.

**Data:**
- `selected` (Array<String>): Array of currently selected instance paths

### `subs_toggled`
Fired when a node's children are expanded or collapsed.

**Data:**
- `instance_path` (String): The instance path of the toggled node
- `expanded` (Boolean): Whether the children are now expanded

### `hubs_toggled`
Fired when a node's hubs are expanded or collapsed.

**Data:**
- `instance_path` (String): The instance path of the toggled node
- `expanded` (Boolean): Whether the hubs are now expanded

### `mode_toggling`
Fired when the mode is about to change.

**Data:**
- `from` (String): The current mode
- `to` (String): The target mode

### `mode_changed`
Fired when the mode has changed.

**Data:**
- `mode` (String): The new mode

### `search_query_changed`
Fired when the search query changes.

**Data:**
- `query` (String): The new search query

### `node_expanded`
Fired in response to an `expand_node` command.

**Data:**
- `instance_path` (String): The expanded node's instance path
- `expand_subs` (Boolean): Whether children were expanded
- `expand_hubs` (Boolean): Whether hubs were expanded

### `node_collapsed`
Fired in response to a `collapse_node` command.

**Data:**
- `instance_path` (String): The collapsed node's instance path

### `node_toggled`
Fired in response to a `toggle_node` command.

**Data:**
- `instance_path` (String): The toggled node's instance path
- `toggle_type` (String): Either `'subs'` or `'hubs'`

### `selected_nodes`
Fired in response to a `get_selected` command.

**Data:**
- `selected` (Array<String>): Array of currently selected instance paths

### `confirmed_nodes`
Fired in response to a `get_confirmed` command.

**Data:**
- `confirmed` (Array<String>): Array of currently confirmed instance paths

### `selection_cleared`
Fired in response to a `clear_selection` command.

**Data:** Empty object

### `flag_changed`
Fired in response to a `set_flag` command.

**Data:**
- `flag_type` (String): The flag that was changed
- `value` (String|Boolean): The new flag value

### `scrolled_to_node`
Fired in response to a `scroll_to_node` command.

**Data:**
- `instance_path` (String): The node that was scrolled to
- `scroll_position` (Number): The scroll position in pixels

## Instance Paths

Instance paths uniquely identify a node in the graph, including its position in the hierarchy. They follow the format:

```
|/path/to/node
```

For example:
- Root: `|/`
- First-level child: `|/src`
- Nested child: `|/src|/src/index.js`

The pipe character (`|`) separates hierarchy levels, allowing the same base path to appear multiple times in different contexts (e.g., when a node is referenced as both a child and a hub).

