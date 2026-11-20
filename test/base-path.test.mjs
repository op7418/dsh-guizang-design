import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createContext, runInContext, runInNewContext } from 'node:vm'

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const gallery = readFileSync(new URL('../gallery/app.js', import.meta.url), 'utf8')
const origin = 'https://dsh.example'

test('侧栏从 DSH 的文档基址打开画廊', () => {
  for (const mount of ['/', '/app/member-a/', '/app/member-b/']) {
    let factory
    const React = {
      createElement: (tag, props) => ({ tag, props }),
      useRef: () => ({}),
      useState: (initial) => [initial()],
      useEffect: () => {},
    }
    runInNewContext(client, {
      URL,
      document: { baseURI: origin + mount },
      navigator: { language: 'en' },
      window: { __ModuleLoader__: { load: (entry) => { factory = entry.factory } } },
    })
    let frame
    factory(() => React).apply({
      inject: () => {},
      slots: {
        inject: (_, action) => action(),
        register: (slot, component) => { if (slot.name === 'main') frame = component() },
      },
    })
    assert.equal(new URL(frame.props.src, origin + mount).href, origin + mount + 'guizang-design/?lang=en')
  }
})

test('画廊在自己的挂载路径内打开示例、作品、附件和缩略图', async () => {
  const example = {
    id: 'example',
    kind: 'image',
    url: '/guizang-design/examples/cards/main.png',
    thumb: '/guizang-design/examples/cards/cover.png',
    files: ['/guizang-design/examples/cards/main.png', '/guizang-design/examples/cards/card%202.png'],
  }
  const work = {
    id: 'work',
    kind: 'image',
    url: '/guizang-design/works/work/main.png',
    thumb: '/guizang-design/thumbs/work.jpg?v=rev',
    files: ['/guizang-design/works/work/main.png', '/guizang-design/works/work/card%202.png'],
  }

  for (const mount of ['/', '/app/member-a/', '/app/member-b/']) {
    const baseURI = origin + mount + 'guizang-design/?lang=en'
    const elements = { '#app': {}, '#rail-foot': {} }
    const viewerBody = { querySelector: () => null }
    const viewer = { querySelector: (selector) => selector === '.viewer-body' ? viewerBody : { focus() {} } }
    const context = createContext({
      URL,
      location: { hash: '#/examples', origin },
      document: {
        baseURI,
        addEventListener: () => {},
        querySelector: (selector) => elements[selector],
        querySelectorAll: () => [],
        getElementById: () => viewer,
      },
      window: { GZ_I18N: { lang: 'en', t: (key) => key, apply() {} } },
      fetch: async (path) => {
        assert.equal(new URL(path, baseURI).href, origin + mount + 'guizang-design/api/catalog?lang=en')
        return { json: async () => ({ skills: [], examples: [structuredClone(example)], works: [structuredClone(work)] }) }
      },
      addEventListener: () => {},
      IntersectionObserver: class {},
      matchMedia: () => ({ matches: false }),
    })
    runInContext(gallery, context)
    await runInContext('load()', context)
    for (const [group, item] of [['examples', example], ['works', work]]) {
      const loaded = runInContext(`data.${group}[0]`, context)
      const scoped = (url) => new URL(url, baseURI).href
      const expected = (url) => origin + mount.slice(0, -1) + url
      assert.equal(scoped(loaded.url), expected(item.url))
      assert.equal(scoped(loaded.thumb), expected(item.thumb))
      assert.deepEqual(Array.from(loaded.files, scoped), item.files.map(expected))
      runInContext(`openViewer(data.${group}[0])`, context)
      for (const file of item.files) {
        const path = new URL(expected(file)).pathname
        const srcs = Array.from(viewerBody.innerHTML.matchAll(/src="([^"]+)"/g), (match) => new URL(match[1], baseURI).pathname)
        assert.ok(srcs.includes(path))
      }
    }
  }
})
