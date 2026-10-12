type Child = Node | string | null | undefined | false
type Attrs = Record<string, string | number | boolean | undefined | ((event: Event) => void)>

/** A small element factory: string attributes, `on<event>` handlers, children. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue
    if (typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value)
    } else if (key === 'class') {
      node.className = String(value)
    } else {
      node.setAttribute(key, value === true ? '' : String(value))
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

export function icon(name: string, extra = ''): HTMLElement {
  return el('i', { class: `codicon codicon-${name}${extra ? ' ' + extra : ''}`, 'aria-hidden': 'true' })
}

/** Sets an icon element to another codicon, keeping its other classes. */
export function setIcon(node: Element | null, name: string): void {
  if (!node) return
  for (const c of [...node.classList]) if (c.startsWith('codicon-')) node.classList.remove(c)
  node.classList.add(`codicon-${name}`)
}

export function html(markup: string): DocumentFragment {
  const template = document.createElement('template')
  template.innerHTML = markup
  return template.content
}
