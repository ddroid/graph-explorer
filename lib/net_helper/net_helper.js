module.exports = net

function net (id) {
  const [label, io, _, sub, hub] = [`[${id}@${__filename}]`, { invite, accept, on: {} }, {}, {}, {}]
  return { io, _ }
  function forward (to, M) {
    if (to.startsWith(id)) {
      const ups = [...new Set(Object.keys(hub).map(id => hub[id].tx))]
      for (const tx of ups) tx(M)
      return
    }
    for (const id of Object.keys(sub)) if (to.startsWith(id)) return sub[id].tx(M)
    throw new Error(`${label} unknown recipient "${to}"`)
  }
  function invite (name, ids) {
    if (!io.on[name]) throw new Error(`${label} no protocol handler for "${name}"`)
    return Object.assign(invite, { ids })
    function invite (tx) {
      const rx = router(sub)
      add(name, tx, tx.id, rx, sub)
      return rx
    }
  }
  function accept (invite) {
    const rx = router(hub)
    const tx = invite(Object.assign(rx, { id }))
    for (const [name, to] of Object.entries(invite.ids)) {
      if (hub[to]) throw new Error(`${label} already connected to "${to}"`)
      if (!io.on[name]) throw new Error(`${label} no "${name}" protocol for "${to}"`)
      add(name, tx, to, rx, hub)
    }
  }
  function router ($) {
    return function rx (M) {
      const { head: [by, to] } = M
      console.log(`[M]\n${by} \n to: \n ${to}`, M)
      if (to !== id) return forward(to, M)
      if (!$[by]) throw new Error(`${label} unknown sender "${by}"`)
      const { name } = $[by].state
      if (!io.on[name]) throw new Error(`${label} no "${name}" protocol for "${to}"`)
      io.on[name](M)
    }
  }
  function add (name, tx, to, rx, $) {
    const state = { name, to, mid: 0 }
    _[name] = send
    $[to] = { rx, tx, state }
    function send (type, refs = {}, data = null) {
      const head = [id, to, state.mid++]
      const meta = { time: Date.now(), stack: (new Error().stack) }
      tx({ head, refs, type, data, meta })
      return head
    }
  }
}
