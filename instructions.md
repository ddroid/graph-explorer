Hey! I'm a vanilla JavaScript developer who works on an open-source project named [UI components](https://github.com/ddroid/ui-components), Where I create ui-components for a decentralized app called **'Theme Widget'**. It's not my own project, I'm just a contributor. I want to tell you about how each Nodejs component is created so you can help me with creating some.

# Guide to create modules:

Here we would discuss the rules and a deep explanation of the steps for creating a module.

## Here are some rules:
- We use StandardJS.
- We use snake_case and try to keep variable names concise.
- We use CommonJS. Which consist of `require` keyword for importing external modules.
- Furthermore, we use shadow DOM.
- We handle all the element creation through JavaScript and try to maximize the use of template literals while creating HTML elements.
- We try to keep the code modular by dividing the functionality into multiple functioned which are defined/placed always under the return statement of parent function and are used above, obviously.
- Likewise, we don't use `btn.addEventListner()` syntax. Instead, we use `btn.onclick = onclick_function` etc.
- We don't use JavaScript `classes` or `this` keyword.
- We use a module called `STATE` for state management and persistent browser storage. I Will discuss it in detail in a bit.
- We use bundlers `budo/browserify`. Our index.html is a small file that just includes the bundle.js script.
- Try to keep code as short as possible without compromising the readability and reusability.

# Structure Explained:
Here is the structure that I would show you step by step.
## `example.js`
First 3 lines for each module are always same:
```js
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)
```
As you can see here we just require the `STATE` module and then execute it to create a state database function. This is then passed with a `fallback` function.

You dont need to get deep into these first 2 lines.

---
A `submodule` is a module that is required by our current module.

A `fallback_module` is a function which returns an object which contains 3 properties:

- **_** : This defines the `submodules`. If there is no `submodule` used or `required`/`imported` in the current module then It is not defined (meaning it should not exist as a key. It should not be like `_:{}`. Instead, there should be nothing). **It is necessary to define when we do require a external module as a `submodule`.**
- **drive** : It is a place where we can store data which we want to be saved in localStorage. We store all the Styles, SVG's inside the drive.
- **api** : this defines another `fallback` function called `fallback_instance`. It is used to provide a developer who reuses our component with customization api to override our default data which is defined in `fallback_module`'s object. `fallback_instance` has obj returned with 2 properties ⇾ **_** and **drive**.
---
#### The `_` property is very important.
It represents the submodules and instances. Any number of instances can be made from a single required module.
It is an object that is assigned to `_`.
Unlike `drive` (which has same structure in both `fallback_module` and `fallback_instance`) the stuctural syntax for **`_`** is a little different in `fallback_module` and `fallback_instance`.

---
In `fallback_module` we include the required module names as keys, and we assign an object to those keys which define the module by `$` key, This `$` property is mandatory what ever reason. We can create as many instances we want using `0,1,2,3,4,5,....,n` as keys of object that is passed to required module key. But mostly we use `fallback_instance` for creating instances. Anyways an example is:
```js
_: {
  '../../module_address' : {
    $ : '', // This is a must. we can either assign a string as a override which keeps the default data intact. Or we can specify an override function which would change the default fallbacks for each instance.
    0 : override_func, // we can assign a override to a sigle instance which will change the data only for this particular instance.
    1 : override_func2, // we can use same or different override functions for each instance.
    2 : '', // obviously we can also assign a empty string which would take data from $. and if $ also has and empty string then it defaults to orignal module data.
    mapping: {
      style: 'style'
    }
  }
}
```
I have added the comments for explanation about `overrides`.

---
In `fallback_instance` the only difference is that we don't have a $ property for representing the module.

That's why the `$` inside the `_` property of `fallback_module` is mandatory whether we use `fallback_instance` for creating instances or `fallback_module`.


There is another mandatory thing inside the **`_`** which is **`mapping`** property. It is always defined where we create Instances.

If we create instance at module level then we would add it inside `_` of `fallback_module` but as most of the times we create instances through the `fallback_instance` add mapping there.

Example:
```js
  _: {
    $: '', // only if we create module level instances
    0: '',
    mapping: {
      style: 'style'
    }
  }
```
---
Let's go back to drive. As discussed above that we place the data in **drive** which is supposed to be stored in localStorage of a browser. It is completely optional, we can ignore it if we want. The data we want to be customizable is stored in **api**'s **drive** (`fallback_instance`) and which is supposed to be not is stored in `fallback_module`'s drive.

Drive is an JavaScript object. It contains datasets of different types or category. These categories can contain multiple files.
```json
drive: {
  'style/': {
    'theme.css': {
      raw: `
      .element-class {
        display: flex;
        align-items: center;
        background-color: #212121;
        padding: 0.5rem;
        // min-width: 456px
      }`
    }
  }
}
```
Now these datasets like `style/` can contain files and each file contains content using `raw:`.

Another way of defining the content is by using `$ref:`. This is used when we want to use a file from the same directory as the module file. For example, if we want to require/import --> $ref `cross.svg` from directory of the module, we can do it like this :
```js
drive: {
  'style/': {
    'theme.css': {
      '$ref': 'example.svg'
    }
  }
}
```
This `$ref` can help a lot in short and clean `fallbacks`

---
### Back to where we left
After we have added those 3 lines of code, we can require modules to use them as `submodules` (if any).

```js
const submodule1 = require('example_submodule')
```

Then we export our current module function.
```js
module.exports = module_function
```
Then we define our function which is always async and always takes one `opts` parameter.
```js
async function module_function (opts) {
  // Code
}
```
Inside the function we start with this line:
```js
  const { id, sdb } = await get(opts.sid)
```
It fetches our `sdb` which is state database.
Now there is also a `sdb` in third line of the module i.e.
```js
const { sdb, get } = statedb(fallback_module)
```
It is used when we use `fallback_module` to create instances. It is only used when we don't add this `const { id, sdb } = await get(opts.sid)` line to the module function. Most of the time we do add it as it's the backbone of customization `api`. I will share the exceptions in a bit.

We should only add this line if we use `fallback_instance` to create instances. Which we mostly do.

---

After that we create this object according to the datasets in drive. They will be helpful in executing certain functions when specific dataset is updated or changed.
```js
  const on = {
    style: inject
  }
```
This has a simple structure where key name is based of dataset and its value is the function we want to execute when that dataset changes.

---

Then we start the real vanilla JavaScript journey for creating some useful HTML.
```js
  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
  <div class="action-bar-container">
    <div class="action-bar-content">
      <button class="icon-button"></button>
      <placeholder></placeholder>
    </div>
  </div>`
```
As mentioned before that we make the maximum use of literals. We also use Shadow DOM with closed mode.

We can also define some placeholder elements that we can later replace with a submodule.

---
Then the most important line of the `STATE` program comes.
```js
  const subs = await sdb.watch(onbatch)
```
This does two things.

First is that it is a watch function which is like an event listener. It triggers the `onbatch()` whenever something in the drive changes. We would share the `onbatch()` code later.

Second it stores `Sid`'s for all the submodules and their instances into the subs array. It gets then from `_` properties of `drive` from both fallbacks (instance and module). These `Sid`'s are passed as parameters to the `submodules`.

The order of execution of functions by `onbatch` is not random. so we need to so we need to make sure that those functions work independent of order of execution. A strategy we can opt is to create elements at the end after storing all the data into variables and then using those variables for creating elements.

---

After we get the `Sid`'s we can append the required submodules into our HTML elements.
```js
  submodule1(subs[0]).then(el => shadow.querySelector('placeholder').replaceWith(el))

  // to add a click event listener to the buttons:
  // const [btn1, btn2, btn3] = shadow.querySelectorAll('button')
  // btn1.onclick = () => { console.log('Terminal button clicked') })
```
We can also add event listeners if we want at this stage. As mentioned in rules we dont use `element.addEventListner()` syntax.

---
 Then we return the `el`. The main element to which we have attached the shadow.
 ```js
 return el
 ```
 This is the end of a clean code. We can add the real mess under this return statement.

 ---

Then we define the functions used under the return statement.
```js
  function onbatch (batch) {
    for (const { type, data } of batch) {
      on[type] && on[type](data)
    }
    // here we can create some elements after storing data
  }
  function inject(data) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(data)
    shadow.adoptedStyleSheets = [sheet]
  }
  function iconject(data) {
    dricons = data[0]
    // using data[0] to retrieve the first file from the dataset.
  }
  function some_useful_function (){
    // NON state function
  }
```
We add both `STATE` related and actual code related functions here. And finally after those we close our main module delimiters.

---
Last but not the least outside the main module function, we define the `fallback_module`

It is placed at the last as it can be pretty long sometimes.

```js
function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      submodule1: {
        $: ''
      }
    }
  }
  function fallback_instance () {
    return {
      _: {
        submodule1: {
          0: '',
          mapping: {
            style: 'style'
          }
        }
      },
      drive: {
        'style/': {
          'theme.css': {
            raw: `
              .element-class {
                display: flex;
                align-items: center;
                background-color: #212121;
                padding: 0.5rem;
                // min-width: 456px
              }
            `
          }
        }
      }
    }
  }
}
```
---
### Thus, here is the whole combined code:

```js
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)

const submodule1 = require('example_submodule')

module.exports = module_function

async function module_function (opts) {
  const { id, sdb } = await get(opts.sid)
  const on = {
    style: inject
  }
  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
  <div class="action-bar-container">
    <div class="action-bar-content">
      <button class="icon-button"></button>
      <placeholder></placeholder>
    </div>
  </div>`
  const subs = await sdb.watch(onbatch)
  submodule1(subs[0]).then(el => shadow.querySelector('placeholder').replaceWith(el))

  return el
  function onbatch (batch) {
    for (const { type, data } of batch) {
      on[type] && on[type](data)
    }
  }
  function inject(data) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(data)
    shadow.adoptedStyleSheets = [sheet]
  }
  function some_useful_function (){
    // NON state function
  }
}
function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      submodule1: {
        $: ''
      }
    }
  }
  function fallback_instance () {
    return {
      _: {
        submodule1: {
          0: '',
          mapping: {
            style: 'style'
          }
        }
      },
      drive: {
        'style/': {
          'theme.css': {
            raw: `
              .element-class {
                display: flex;
                align-items: center;
                background-color: #212121;
                padding: 0.5rem;
                // min-width: 456px
              }
            `
          }
        }
      }
    }
  }
}
```
# Latest and greatest example
## `tabs.js`

This is another example which I think does not need much explanation. But still if you have any questions let me know.

```js
//state Initialization
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)
// exporting the module
module.exports = component
// actual module
async function component(opts, protocol) {
  // getting the state database for the current instance
  const { id, sdb } = await get(opts.sid)
  // optional getting drive from state database but it does not work currently. will be useful in the future though.
  const {drive} = sdb
  // on object which contains the functions to be executed when the dataset changes and onbatch is called.
  const on = {
    variables: onvariables,
    style: inject_style,
    icons: iconject,
    scroll: onscroll
  }
  // creating the main element and attaching shadow DOM to it.
  const div = document.createElement('div')
  const shadow = div.attachShadow({ mode: 'closed' })
  // defining the HTML structure of the component using template literals.
  shadow.innerHTML = `<div class="tab-entries"></div>`
  const entries = shadow.querySelector('.tab-entries')
  // Initializing the variables to be used in the element creation. We store the data from drive through the onbatch function in these variables.
  // this init variable is used to check if the component is initialized or not. It is set to true when the component is initialized for the first time. So that after that we can just update the component instead of creating it again using the onbatch function data.
  let init = false
  let variables = []
  let dricons = []
  
  // subs for storing the Sid's of submodules and onbatch function which is called when the dataset changes.
  const subs = await sdb.watch(onbatch)
  // this is just a custom scrolling through drag clicking functionality.
  if (entries) {
    let is_down = false
    let start_x
    let scroll_start

    const stop = () => {
      is_down = false
      entries.classList.remove('grabbing')
      update_scroll_position()
    }

    const move = x => {
      if (!is_down) return
      if (entries.scrollWidth <= entries.clientWidth) return stop()
      entries.scrollLeft = scroll_start - (x - start_x) * 1.5
    }

    entries.onmousedown = e => {
      if (entries.scrollWidth <= entries.clientWidth) return
      is_down = true
      entries.classList.add('grabbing')
      start_x = e.pageX - entries.offsetLeft
      scroll_start = entries.scrollLeft
      window.onmousemove = e => {
        move(e.pageX - entries.offsetLeft)
        e.preventDefault()
      }
      window.onmouseup = () => {
        stop()
        window.onmousemove = window.onmouseup = null
      }
    }

    entries.onmouseleave = stop

    entries.ontouchstart = e => {
      if (entries.scrollWidth <= entries.clientWidth) return
      is_down = true
      start_x = e.touches[0].pageX - entries.offsetLeft
      scroll_start = entries.scrollLeft
    }
    ;['ontouchend', 'ontouchcancel'].forEach(ev => {
      entries[ev] = stop
    })

    entries.ontouchmove = e => {
      move(e.touches[0].pageX - entries.offsetLeft)
      e.preventDefault()
    }
  }
  // component function returns the main element.
  return div
  // All the functions are defined below this return statement.
  // this create_btn function is executed using forEach on the variables array. It creates the buttons for each variable in the array. It uses the data from the variables and dricons arrays to create the buttons.
  async function create_btn({ name, id }, index) {
    const el = document.createElement('div')
    el.innerHTML = `
    <span class="icon">${dricons[index + 1]}</span>
    <span class='name'>${id}</span>
    <span class="name">${name}</span>
    <button class="btn">${dricons[0]}</button>`

    el.className = 'tabsbtn'
    const icon_el = el.querySelector('.icon')
    const label_el = el.querySelector('.name')
    
    label_el.draggable = false
    // Event listener for the button click. It uses the protocol function to send a message to the parent component. The parent can further handle the message using the protocol function to route the message to the appropriate destination.
    icon_el.onclick = protocol(onmessage)('type','data')
    entries.appendChild(el)
    return
  }
  function onmessage(type, data) {
    return console.log(type,data)
  }
  // this function is called when the dataset changes. It calls the functions defined in `on` object.
  function onbatch (batch) {
    for (const { type, data } of batch) (on[type] || fail)(data, type)
    // this condition checks if the component is initialized or not. If not then it creates the buttons using the create_btn function. if the component is already initialized then it can handle the updates to the drive in future.
    if (!init) {
      // after for loop ends and each of the data is stored in their respective variables, we can create the buttons using the create_btn function.
      variables.forEach(create_btn)
      init = true
    } else {
      // TODO: Here we can handle drive updates
      // currently waiting for the next STATE module to be released so we can use the drive updates.
    }
  }
  // this function throws an error if the type of data is not valid. It is used to handle the errors in the onbatch function.
  function fail (data, type) { throw new Error('invalid message', { cause: { data, type } }) }
  // this function adds styles to shadow DOM. It uses the CSSStyleSheet API to create a new stylesheet and then replaces the existing stylesheet with the new one.
  function inject_style(data) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(data)
    shadow.adoptedStyleSheets = [sheet]
  }
  // we simple store the data from the dataset into variables. We can use this data to create the buttons in the create_btn function.
  function onvariables(data) {
    const vars = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    variables = vars
  }
  // same here we store the data into dricons for later use. We can use this data to create the buttons in the create_btn function.
  function iconject(data) {
    dricons = data
  }
  // waiting for the next STATE module to be released so we can use the drive.put() to update the scroll position.
  function update_scroll_position() {
    // TODO
  }

  function onscroll(data) {
    setTimeout(() => {
      if (entries) {
        entries.scrollLeft = data
      }
    }, 200)
  }
}
// this is the fallback module which is used to create the state database and to provide the default data for the component.
function fallback_module() {
  return {
    api: fallback_instance,
  }
  // this is the fallback instance which is used to provide the default data for the instances of a component. this also help in providing an API for csustomization by overriding the default data.
  function fallback_instance() {
    return {
      drive: {
        'icons/': {
          'cross.svg':{
            '$ref': 'cross.svg'
             // data is stored through '$ref' functionality
          },
          '1.svg': {
            '$ref': 'icon.svg'
          },
          '2.svg': {
            '$ref': 'icon.svg'
          },
          '3.svg': {
            '$ref': 'icon.svg'
          }
        },
        'variables/': {
          'tabs.json': {
            '$ref': 'tabs.json'
          }
        },
        'scroll/': {
          'position.json': {
            raw: '100'
          }
        },
        'style/': {
          'theme.css': {
            '$ref': 'style.css'
          }
        }
      }
    }
  }
}
```

# Important update related to drive fetch, ignore old code above
### State Management
The `STATE` module provides several key features for state management:

#### 1. Instance Isolation
   - Each instance of a module gets its own isolated state
   - State is accessed through the `sdb` interface
   - Instances can be created and destroyed independently

#### 2. sdb Interface
Provides access to following two APIs:

**sdb.watch(onbatch)**
```js
const subs = await sdb.watch(onbatch)
const { drive } = sdb
async function onbatch(batch){
  for (const {type, paths} of batch) {
    const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
    on[type] && on[type](data)
  }
}
```
- Modules can watch for state changes
- Changes are batched and processed through the `onbatch` handler
- Different types of changes can be handled separately using `on`.
- `type` refers to the `dataset_type` used in fallbacks. The key names need to match. E.g. see `template.js`
- `paths` refers to the paths to the files inside the dataset.

**sdb.get_sub**  
  @TODO
**sdb.drive**  
The `sdb.drive` object provides an interface for managing datasets and files attached to the current node. It allows you to list, retrieve, add, and check files within datasets defined in the module's state.

- **sdb.drive.list(path?)**
  - Lists all dataset names (as folders) attached to the current node.
  - If a `path` (dataset name) is provided, returns the list of file names within that dataset.
  - Example:
    ```js
    const datasets = sdb.drive.list(); // ['mydata/', 'images/']
    const files = sdb.drive.list('mydata/'); // ['file1.json', 'file2.txt']
    ```

- **sdb.drive.get(path)**
  - Retrieves a file object from a dataset.
  - `path` should be in the format `'dataset_name/filename.ext'`.
  - Returns an object: `{ id, name, type, raw }` or `null` if not found.
  - Example:
    ```js
    const file = sdb.drive.get('mydata/file1.json');
    // file: { id: '...', name: 'file1.json', type: 'json', raw: ... }
    ```

- **sdb.drive.put(path, buffer)**
  - Adds a new file to a dataset.
  - `path` is `'dataset_name/filename.ext'`.
  - `buffer` is the file content (object, string, etc.).
  - Returns the created file object: `{ id, name, type, raw }`.
  - Example:
    ```js
    sdb.drive.put('mydata/newfile.txt', 'Hello World');
    ```

- **sdb.drive.has(path)**
  - Checks if a file exists in a dataset.
  - `path` is `'dataset_name/filename.ext'`.
  - Returns `true` if the file exists, otherwise `false`.
  - Example:
    ```js
    if (sdb.drive.has('mydata/file1.json')) { /* ... */ }
    ```

**Notes:**
- Dataset names are defined in the fallback structure and must be unique within a node.
- File types are inferred from the file extension.
- All file operations are isolated to the current node's state and changes are persisted immediately.

