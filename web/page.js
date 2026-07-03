const STATE = require('STATE')
const statedb = STATE(__filename)
const admin_api = statedb.admin()
admin_api.on(event => {
  // console.log(event)
})
const { id, sdb } = statedb(fallback_module)

const graphdb = require('../lib/graphdb')
const net = require('../lib/net_helper')
/******************************************************************************
  PAGE
******************************************************************************/
const app = require('..')
const sheet = new CSSStyleSheet()
config().then(boot)

async function config () {
  const html = document.documentElement
  const meta = document.createElement('meta')
  const font =
    'https://fonts.googleapis.com/css?family=Nunito:300,400,700,900|Slackey&display=swap'
  const loadFont = `<link href=${font} rel='stylesheet' type='text/css'>`
  html.setAttribute('lang', 'en')
  meta.setAttribute('name', 'viewport')
  meta.setAttribute('content', 'width=device-width,initial-scale=1.0')
  // @TODO: use font api and cache to avoid re-downloading the font data every time
  document.head.append(meta)
  document.head.innerHTML += loadFont
  document.adoptedStyleSheets = [sheet]
  await document.fonts.ready // @TODO: investigate why there is a FOUC
}
/******************************************************************************
  PAGE BOOT
******************************************************************************/
async function boot () {
  // ----------------------------------------
  // ID + JSON STATE
  // ----------------------------------------
  const on = {
    theme: inject,
    entries: on_entries
  }
  const { drive } = sdb

  // Database instance for Graph Explorer
  let db = null
  let latest_entries = null
  let graph_explorer_connected = false
  const { io, _ } = net(id)
  io.on = {
    graph_explorer: graph_explorer_protocol
  }

  // Permissions structure (placeholder)
  // Example: perms = { graph_explorer: { deny_list: ['db_raw'] } }
  // const perms = {}
  const subs = await sdb.watch(onbatch)
  console.log(subs)

  // ----------------------------------------
  // TEMPLATE
  // ----------------------------------------
  const el = document.body
  const shopts = { mode: 'closed' }
  const shadow = el.attachShadow(shopts)
  shadow.adoptedStyleSheets = [sheet]
  // ----------------------------------------
  // ELEMENTS
  // ----------------------------------------
  // desktop
  const graph_explorer_el = await app(subs[0], io.invite('graph_explorer', { storage: id }))
  graph_explorer_connected = true
  sync_initial_state_to_child()
  shadow.append(graph_explorer_el)
  // ----------------------------------------
  // INIT
  // ----------------------------------------

  function graph_explorer_protocol (msg) {
    const { type } = msg

    if (type.startsWith('db_')) {
      handle_db_request(msg)
    }

    function handle_db_request (request_msg) {
      const { head: request_head, type: operation, data: params } = request_msg
      let result

      if (!db) {
        console.error('[page.js] Database not initialized yet')
        send_response(request_head, null)
        return
      }

      // TODO: Check permissions here
      // if (perms.graph_explorer?.deny_list?.includes(operation)) {
      //   console.warn('[page.js] Operation denied by permissions:', operation)
      //   send_response(request_head, null)
      //   return
      // }

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
        console.warn('[page.js] Unknown db operation:', operation)
        result = null
      }

      send_response(request_head, result)

      function send_response (request_head, result) {
        send_graph_explorer_message('db_response', { cause: request_head }, { result })
      }
    }
  }

  function on_entries (data) {
    if (!data || data[0] == null) {
      console.error('Entries data is missing or empty.')
      db = graphdb({})
      latest_entries = {}
      notify_db_initialized({})
      return
    }
    const parsed_data = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    if (typeof parsed_data !== 'object' || !parsed_data) {
      console.error('Parsed entries data is not a valid object.')
      db = graphdb({})
      latest_entries = {}
      notify_db_initialized({})
      return
    }
    db = graphdb(parsed_data)
    latest_entries = parsed_data
    notify_db_initialized(parsed_data)
  }

  function notify_db_initialized (entries) {
    if (!graph_explorer_connected) return
    send_graph_explorer_message('db_initialized', {}, { entries })
  }

  function sync_initial_state_to_child () {
    if (latest_entries !== null) notify_db_initialized(latest_entries)
  }

  function send_graph_explorer_message (type, refs = {}, data = {}) {
    if (!_.graph_explorer) throw new Error('page.js net_helper channel "graph_explorer" is not connected')
    return _.graph_explorer(type, refs, data)
  }

  async function onbatch (batch) {
    console.log(batch)
    for (const { type, paths } of batch) {
      const data = await Promise.all(
        paths.map(path => drive.get(path).then(file => file.raw))
      )
      on[type] && on[type](data)
    }
  }
}
async function inject (data) {
  sheet.replaceSync(data.join('\n'))
}

function fallback_module () {
  return {
    _: {
      '..': {
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
      '../lib/graphdb': 0,
      '../lib/net_helper': { $: '' }
    },
    drive: {
      'theme/': { 'style.css': { raw: "body { font-family: 'system-ui'; }" } },
      'entries/': { 'entries.json': { $ref: 'entries.json' } },
      'lang/': {},
      'runtime/': {},
      'mode/': {},
      'flags/': {},
      'keybinds/': {},
      'undo/': {}
    }
  }
}
