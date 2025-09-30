# `graph-explorer`

A lightweight, high-performance frontend component for rendering and exploring interactive, hierarchical graph data. It uses a virtual scrolling technique to efficiently display large datasets with thousands of nodes without sacrificing performance.

## Features

- **Virtual Scrolling:** Renders only the visible nodes, ensuring smooth scrolling and interaction even with very large graphs.
- **Interactive Exploration:** Allows users to expand and collapse both hierarchical children (`subs`) and related connections (`hubs`).
- **Dynamic Data Loading:** Listens for data updates and re-renders the view accordingly.
## Usage

Require the `graph_explorer` function and call it with a configuration object. It returns a DOM element that can be appended to the page.

```javascript
const graph_explorer = require('./graph_explorer.js')

// Provide `opts` and optional `protocol` as parameters
const graph = await graph_explorer(opts, protocol)

// Append the element to your application's body or another container
document.body.appendChild(graph)
```

### Protocol System

The graph explorer supports bidirectional message-based communication through an optional protocol parameter. This allows parent modules to:
- Control the graph explorer programmatically (change modes, select nodes, expand/collapse, etc.)
- Receive notifications about user interactions and state changes

## Drive

The component expects to receive data through datasets in drive. It responds to two types of messages: `entries` and `style`.

### 1. `entries`

The `entries` message provides the core graph data. It should be an object where each key is a unique path identifier for a node, and the value is an object describing that node's properties.

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

### 2. `style`

The `style` message provides a string of CSS content that will be injected directly into the component's Shadow DOM. This allows for full control over the visual appearance of the graph, nodes, icons, and tree lines.

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
