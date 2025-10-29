const STATE = require('../lib/STATE')
const graphdb = require('../lib/graphdb')
const statedb = STATE(__filename)
const admin_api = statedb.admin()
admin_api.on(event => {
  // console.log(event)
})
const { sdb } = statedb(fallback_module)

/******************************************************************************
  PAGE
******************************************************************************/
const app = require('..')
const sheet = new CSSStyleSheet()
config().then(() => boot({ sid: '' }))

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
async function boot (opts) {
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
  // Send function for Graph Explorer protocol
  let send_to_graph_explorer = null
  // Message ID counter for page_js -> graph_explorer messages
  let page_js_mid = 0

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
  shadow.append(await app(subs[0], graph_explorer_protocol))
  // ----------------------------------------
  // INIT
  // ----------------------------------------

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
        // Create standardized response message
        const response_head = ['page_js', 'graph_explorer', page_js_mid++]
        send({
          head: response_head,
          refs: { cause: request_head }, // Reference the original request
          type: 'db_response',
          data: { result }
        })
      }
    }
  }

  function on_entries (data) {
    if (!data || data[0] == null) {
      console.error('Entries data is missing or empty.')
      db = graphdb({})
      if (send_to_graph_explorer) {
        send_to_graph_explorer({ type: 'db_initialized', data: { entries: {} } })
      }
      return
    }
    const parsed_data = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    if (typeof parsed_data !== 'object' || !parsed_data) {
      console.error('Parsed entries data is not a valid object.')
      db = graphdb({})
      if (send_to_graph_explorer) {
        send_to_graph_explorer({ type: 'db_initialized', data: { entries: {} } })
      }
      return
    }
    db = graphdb(parsed_data)
    if (send_to_graph_explorer) {
      send_to_graph_explorer({ type: 'db_initialized', data: { entries: parsed_data } })
    }
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
      '../lib/graphdb': 0
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
