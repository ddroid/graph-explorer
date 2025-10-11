const STATE = require('../lib/STATE')
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
    theme: inject
  }
  const { drive } = sdb

  const subs = await sdb.watch(onbatch, on)

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
  shadow.append(await app(subs[0]))
  // ----------------------------------------
  // INIT
  // ----------------------------------------

  async function onbatch (batch) {
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
          entries: 'entries',
          runtime: 'runtime',
          mode: 'mode',
          flags: 'flags',
          keybinds: 'keybinds',
          undo: 'undo'
        }
      }
    },
    drive: {
      'theme/': { 'style.css': { raw: "body { font-family: 'system-ui'; }" } },
      'lang/': {},
      'entries/': {},
      'runtime/': {},
      'mode/': {},
      'flags/': {},
      'keybinds/': {},
      'undo/': {}
    }
  }
}
