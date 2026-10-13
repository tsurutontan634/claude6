// dist-single/index.html（1ファイルにまとめたビルド）を、claude.ai の公開ページ用の断片に変換する。
// 公開時に <!doctype>・<html>・<head>・<body> は自動で付くので外し、<title> を先頭に置く。
// 使い方: node scripts/make-artifact.mjs <出力先.html>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const out = process.argv[2]
if (!out) {
  console.error('出力先のパスを指定してください')
  process.exit(1)
}
const html = readFileSync(new URL('../dist-single/index.html', import.meta.url), 'utf8')
const pick = (re) => [...html.matchAll(re)].map((m) => m[0])
const title = pick(/<title>[\s\S]*?<\/title>/g)
const links = pick(/<link[^>]*stylesheet[^>]*>/g)
const preconnect = pick(/<link rel="preconnect"[^>]*>/g)
const styles = pick(/<style[^>]*>[\s\S]*?<\/style>/g)
const scripts = pick(/<script[^>]*>[\s\S]*?<\/script>/g)
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] ?? '<div id="root"></div>'
const bodyWithoutScripts = body.replace(/<script[\s\S]*?<\/script>/g, '').trim()
const parts = [...title, ...preconnect, ...links, ...styles, bodyWithoutScripts, ...scripts]
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, parts.join('\n'))
console.log(`wrote ${out} (${(Buffer.byteLength(parts.join('\n')) / 1024).toFixed(0)} KB)`)
