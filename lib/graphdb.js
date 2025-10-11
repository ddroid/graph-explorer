module.exports = graphdb

function graphdb (entries) {
  // Validate entries
  if (!entries || typeof entries !== 'object') {
    console.warn('[graphdb] Invalid entries provided, using empty object')
    entries = {}
  }

  const api = {
    get,
    has,
    keys,
    isEmpty,
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

  function isEmpty () {
    return Object.keys(entries).length === 0
  }

  function root () {
    return entries['/'] || null
  }

  function raw () {
    return entries
  }
}
