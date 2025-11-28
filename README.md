# `graph-explorer`

A lightweight, high-performance frontend component for rendering and exploring interactive, hierarchical graph data. It uses a virtual scrolling technique to efficiently display large datasets with thousands of nodes without sacrificing performance.

## Features

- **Virtual Scrolling:** Renders only the visible nodes, ensuring smooth scrolling and interaction even with very large graphs.
- **Interactive Exploration:** Allows users to expand and collapse both hierarchical children (`subs`) and related connections (`hubs`).
- **Standard Protocol:** Implements the standard bidirectional message-based communication protocol for seamless integration.
- **Drive-based Data Flow:** Uses the drive system for efficient data management and real-time updates.

## Quick Start

The graph explorer requires data to be supplied through a drive system and communicates via the standard protocol:

```javascript
const graph_explorer = require('graph-explorer')

// Provide `opts` and optional `protocol` as parameters
const graph = await graph_explorer(opts, protocol)

// Append the element to your application's body or another container
document.body.appendChild(graph)
```
For detailed usage instructions, see [USAGE.md](./guide/USAGE.md).

## Protocol System

The graph explorer implements the **standard bidirectional message-based communication protocol** that allows parent modules to:
- Control the graph explorer programmatically (change modes, select nodes, expand/collapse, etc.)
- Receive notifications about user interactions and state changes

All messages follow the standard format:
```javascript
{
  head: [sender_id, receiver_id, message_id],
  refs: { cause: parent_message_head },
  type: "message_type",
  data: { ... }
}
```

For complete protocol documentation, see [PROTOCOL.md](./guide/PROTOCOL.md).

## Data Flow

The graph explorer uses a drive-based data system for efficient data management:

### Required Drive Datasets

1. **`entries/entries.json`** - Core graph data (see format below)
2. **`theme/style.css`** - CSS styles for the component
3. **`mode/`** - Current mode and search state
4. **`flags/`** - Configuration flags
5. **`keybinds/`** - Keyboard navigation bindings

### Data Integration Pattern

The recommended approach is to use the `graph_explorer` which handles:
- Drive data watching and processing
- Protocol communication setup
- Database initialization
- Message routing between parent and graph explorer

```javascript
const graph_explorer = require('graph-explorer')
const graph = await graph_explorer(opts, protocol)
```

### 1. `entries`

The `entries` dataset provides the core graph data. It should be stored in `entries/entries.json` as an object where each key is a unique path identifier for a node, and the value is an object describing that node's properties.

**Example `entries` Object:**

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
  "/assets": {
    "name": "assets",
    "type": "folder",
    "subs": []
  },
  "/README.md": {
    "name": "README.md",
    "type": "file"
  },
  "/LICENSE": {
    "name": "LICENSE",
    "type": "file"
  },
  "/src/index.js": {
    "name": "index.js",
    "type": "js-file"
  },
  "/src/styles.css": {
    "name": "styles.css",
    "type": "css-file"
  }
}
```

**Node Properties:**

- `name` (String): The display name of the node.
- `type` (String): A type identifier used for styling (e.g., `folder`, `file`, `js-file`). The component will add a `type-<your-type>` class to the node element. And these classes can be used to append `.icon::before` css property to show an icon before name.
- `subs` (Array<String>): An array of paths to child nodes. An empty array indicates no children.
- `hubs` (Array<String>): An array of paths to related, non-hierarchical nodes.

### 2. `theme`

The `theme` dataset provides CSS styles and should be stored in `theme/style.css`. The styles are injected directly into the component's Shadow DOM for full visual control.

**Example `style` Data:**

```css
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
  /*
  This height is crucial for virtual scrolling calculations  and it should match the height of javascript variable i.e 

  const node_height = 22

  */
}
.clickable {
  cursor: pointer;
}
.node.type-folder > .icon::before { content: '📁'; }
.node.type-js-file > .icon::before { content: '📜'; }
/* these use `type` to inject icon */
/* ... more custom styles */
```

## How It Works

The component maintains a complete `view` array representing the flattened, visible graph structure. It uses an `IntersectionObserver` with two sentinel elements at the top and bottom of the scrollable container.

When a sentinel becomes visible, the component dynamically renders the next or previous "chunk" of nodes and removes nodes that have scrolled far out of view. This ensures that the number of DOM elements remains small and constant, providing excellent performance regardless of the total number of nodes in the graph.

## Modes

The graph explorer supports three distinct modes that change how users interact with the component:

### default
The standard navigation mode where users can:
- Click to expand/collapse nodes
- Navigate the graph
- Select individual nodes

### menubar
An enhanced mode with a visible menubar providing gui based quick access to:
- Mode switching button
- Flag toggles
- Multi-select control
- Select-between control

### search
A specialized mode for finding and filtering nodes:
- Displays a search input bar
- Filters the view to show only matching nodes
- Supports multi-select and select-between operations on search results

**Mode State Management:**
- Current mode is stored in `drive` at `mode/current_mode.json`
- Previous mode is tracked in `mode/previous_mode.json` (used when exiting search)
- Search query is persisted in `mode/search_query.json`

## Flags

Flags control behaviors of the graph explorer. They are stored in the `flags/` dataset:

### hubs (`flags/hubs.json`)
Controls the display of hub connections (non-hierarchical relationships):
- `"default"` - Hubs are collapsed by default
- `"true"` - All hubs are expanded
- `"false"` - All hubs are hidden

Toggle through values using the menubar button in menubar mode.

### selection (`flags/selection.json`)
Enables or disables node selection functionality:
- `true` - Users can select nodes (default)
- `false` - Selection is disabled

### recursive_collapse (`flags/recursive_collapse.json`)
Controls collapse behavior for hierarchical nodes:
- `true` - Collapsing a node also collapses all its descendants (default)
- `false` - Only the clicked node is collapsed

## Keybinds

The graph explorer supports keyboard navigation and actions. Keybinds are defined in `keybinds/navigation.json` and can be customized through the drive system.

### Default Keybinds

| Key Combination | Action | Description |
|----------------|--------|-------------|
| `ArrowUp` | Navigate Up | Move focus to the previous visible node |
| `ArrowDown` | Navigate Down | Move focus to the next visible node |
| `Control+ArrowDown` | Toggle Subs | Expand/collapse child nodes (subs) of the current node |
| `Control+ArrowUp` | Toggle Hubs | Expand/collapse hub connections of the current node |
| `Alt+s` | Multi-select | Add/remove the current node to/from the selection |
| `Alt+b` | Select Between | Select all nodes between the last clicked and current node |
| `Control+m` | Toggle Search | Switch between current mode and search mode |
| `Alt+j` | Jump to Next Duplicate | Navigate to the next occurrence of a duplicate node |

**Customizing Keybinds:**

Keybinds can be customized by updating the `keybinds/navigation.json` file in the drive with a JSON object mapping key combinations to action names:

```javascript
{
  "ArrowUp": "navigate_up_current_node",
  "ArrowDown": "navigate_down_current_node",
  "Control+ArrowDown": "toggle_subs_for_current_node",
  "Control+ArrowUp": "toggle_hubs_for_current_node",
  "Alt+s": "multiselect_current_node",
  "Alt+b": "select_between_current_node",
  "Control+m": "toggle_search_mode",
  "Alt+j": "jump_to_next_duplicate"
}
```

**Key Combination Format:**
- Modifier keys: `Control+`, `Alt+`, `Shift+`
- Can combine multiple modifiers: `Control+Shift+Key`
- Key names follow standard JavaScript `event.key` values
