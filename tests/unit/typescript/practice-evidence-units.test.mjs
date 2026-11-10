import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { requireTranspiledTs } from './ts-module-loader.mjs'
const { createEvidenceUnits, formatEvidenceUnits } = requireTranspiledTs('src/shared/practice-evidence-units.ts')
const corpus = JSON.parse(readFileSync('tests/fixtures/practice-evidence/handbook-passages.json', 'utf8'))
const split = text => createEvidenceUnits(text, 'book:chapter:passage', 'P1')
const proseA = 'A search procedure examines the available elements and determines whether the requested value is present in the input array.'
const proseB = 'A different procedure maintains a collection of candidate states and updates their values as the computation progresses.'
const proseC = 'An independent section discusses a separate data structure and the operations that are available to its users.'
function lossless(text, units) {
  assert.equal(units.map(u => u.text).join(''), text)
  let end = 0
  for (const u of units) {
    assert.equal(u.start, end)
    assert.ok(u.end > u.start)
    assert.equal(u.text, text.slice(u.start, u.end))
    end = u.end
  }
  assert.equal(end, text.length)
}
function book(id) { return corpus.passages.find(p => p.id.startsWith(`auto:${id}-`)) }

// Verbatim PDF extraction, not cleaned or reformatted examples.
for (const p of corpus.passages) {
  test(`book extraction: lossless, deterministic source mapping ${p.id}`, () => {
    const units = createEvidenceUnits(p.text, p.sourceKey, 'P7')
    lossless(p.text, units)
    assert.deepEqual(units, createEvidenceUnits(p.text, p.sourceKey, 'P7'))
    assert.ok(units.every((u, i) => u.sourceKey === p.sourceKey && u.id === `P7-E${i + 1}`))
  })
}
test('book: separates magnitude discussion from its Phases heading and explanation', () => {
  const p = book('000052'), units = split(p.text)
  assert.equal(units.length, 2)
  assert.equal(units[1].text, p.text.slice(p.text.indexOf('Phases\n\n')))
  assert.ok(units[1].text.includes('consecutive phases'))
})
test('book: BFS Example heading stays with the example, not the preceding definition', () => {
  const p = book('000264'), units = split(p.text)
  assert.equal(units.length, 3)
  assert.equal(units[2].text, p.text.slice(p.text.indexOf('Example\n\n')))
  assert.ok(units[1].text.includes('First the search explores'))
  assert.ok(units[1].text.includes('This process continues'))
})
test('book: flattened equations, C++ loops, and abbreviation spacing are not rewritten', () => {
  for (const id of ['000051', '000085', '000556', '000290']) {
    const p = book(id)
    assert.deepEqual(split(p.text).map(u => u.text), [p.text])
  }
  assert.ok(book('000058').text.includes('O(2n )'))
  assert.ok(book('000556').text.includes('i. e. ,'))
})
test('book: introduction, both DP bullet items, and wrapped item text stay together', () => {
  const p = book('000153'), units = split(p.text)
  assert.equal(units.length, 1)
  assert.ok(units[0].text.includes('Finding an optimal solution'))
  assert.ok(units[0].text.includes('Counting the number of solutions'))
})
test('book: diagram labels are not emitted as standalone evidence', () => {
  const p = book('000141')
  assert.deepEqual(split(p.text).map(u => u.text), [p.text])
})
test('book: actual damaged hyphen characters survive byte-for-byte', () => {
  for (const id of ['000153', '000392', '000266']) {
    const p = book(id)
    assert.ok(p.text.includes('\ufffe'))
    lossless(p.text, split(p.text))
  }
})
test('book: euro denomination scope stays with greedy optimality claim', () => {
  const p = book('000137')
  assert.equal(split(p.text).length, 1)
  assert.ok(p.text.includes('euro coins'))
  assert.ok(p.text.includes('fewest possible number of coins'))
})

// Synthetic formatting/edge cases. These are NOT verbatim textbook passages.
test('separate substantial prose paragraphs become separate evidence units', () => {
  const text = `${proseA}\n\n${proseB}\n\n${proseC}`
  assert.deepEqual(split(text).map(u => u.text), [`${proseA}\n\n`, `${proseB}\n\n`, proseC])
})
test('single newlines, decimals, and abbreviations do not split a paragraph', () => {
  const text = `${proseA}\ni.e., use 1.25 as an example. ${proseB}`
  assert.equal(split(text).length, 1)
})
for (const [name, block] of [
  ['dollar display', '$$\nT(n) = 2T(n/2) + n.\n\nT(1) = 1\n$$'],
  ['bracket display', '\\[\nT(n) = 2T(n/2) + n.\n\nT(1) = 1\n\\]'],
  ['backtick fence', '```cpp\nfor (int i = 0; i < n; ++i) {\n\n  f(i);\n}\n```'],
  ['tilde fence', '~~~cpp\nf();\n\ng();\n~~~']
]) {
  test(`${name}: internal blank lines protected and surrounding explanation attached`, () => {
    const text = `${proseA}\n\n${block}\n\n${proseB}\n\n${proseC}`
    const units = split(text)
    assert.equal(units.length, 2)
    assert.equal(units[0].text, `${proseA}\n\n${block}\n\n${proseB}\n\n`)
    assert.equal(units[1].text, proseC)
    lossless(text, units)
  })
}
for (const [name, block] of [
  ['inline dollar', '$a.\nb$'], ['inline parenthesis', '\\(a.\n\nb\\)'],
  ['inline code', '`a.\n\nb`'], ['multi-backtick inline code', '``a`b\n\nc``']
]) {
  test(`${name}: paragraph separator inside explicit span is protected`, () => {
    const text = `${proseA} ${block} ${proseB}\n\n${proseC}`
    assert.equal(split(text).length, 2)
    assert.ok(split(text)[0].text.includes(block))
    lossless(text, split(text))
  })
}
for (const opener of ['$$', '\\[', '\\(', '```cpp\n', '~~~\n', '`']) {
  test(`unclosed ${JSON.stringify(opener)} keeps the remainder intact`, () => {
    const text = `${proseA}\n\n${opener}${proseB}\n\n${proseC}`
    const units = split(text)
    assert.ok(units.some(u => u.text.includes(`${opener}${proseB}\n\n${proseC}`)))
    lossless(text, units)
  })
}
test('escaped dollar signs do not swallow subsequent paragraph boundaries', () => {
  const text = `${proseA} Cost: \\$5.\n\n${proseB}`
  assert.equal(split(text).length, 2)
})
test('longer code fence ignores a shorter fence inside its body', () => {
  const block = '````md\n```\n\ninside\n```\n````'
  const text = `${proseA}\n\n${block}\n\n${proseB}`
  assert.equal(split(text).length, 1)
})
test('colon introduction, bullet list, and wrapped item text stay together', () => {
  const text = `${proseA}:\n\n- ${proseB}\n\n  continuation of the same item\n\n- ${proseC}`
  assert.equal(split(text).length, 1)
})
test('numbered list stays with introduction', () => {
  assert.equal(split(`${proseA}\n\n1. ${proseB}\n\n2. ${proseC}`).length, 1)
})
test('explicit dependency phrase attaches to its preceding paragraph', () => {
  assert.equal(split(`${proseA}\n\nThis algorithm ${proseB}`).length, 1)
})
test('short heading attaches forward, short trailing fragment attaches backward', () => {
  const text = `${proseA}\n\nBinary search\n\n${proseB}\n\n42`
  assert.deepEqual(split(text).map(u => u.text), [`${proseA}\n\n`, `Binary search\n\n${proseB}\n\n42`])
})
test('CRLF, Unicode, leading/trailing whitespace preserve original offsets', () => {
  const text = `\r\n\r\n😀 ${proseA}\r\n \t\r\n${proseB}\r\n\r\n`
  lossless(text, split(text))
  assert.equal(split(text).length, 2)
})
test('blank input produces no evidence; invalid labels fail explicitly', () => {
  assert.deepEqual(split(' \n\t'), [])
  assert.throws(() => createEvidenceUnits(proseA, '', 'P1'))
  assert.throws(() => createEvidenceUnits(proseA, 'book', 'P1\nInjected'))
})
test('no arbitrary size limit cuts a long sentence with no safe boundaries', () => {
  const text = `${proseA.replaceAll('.', '')} `.repeat(500)
  assert.equal(split(text).length, 1)
  lossless(text, split(text))
})
test('format preview preserves text; different passages have distinct IDs', () => {
  const a = createEvidenceUnits(proseA, 'book:a', 'P1')
  const b = createEvidenceUnits(proseB, 'book:b', 'P2')
  assert.equal(formatEvidenceUnits([...a, ...b]), `Evidence ID: P1-E1\n${proseA}\n\nEvidence ID: P2-E1\n${proseB}`)
  assert.throws(() => formatEvidenceUnits([...a, ...a]), /Duplicate/)
  assert.equal(formatEvidenceUnits([]), '')
})

// Boundary-quality regressions: check context relationships, not only text loss.
test('book: Dijkstra efficiency claim retains its negative-edge qualification', () => {
  const units = split(book('000279').text)
  assert.equal(units.length, 2)
  assert.ok(units[0].text.includes('no negative weight edges'))
  assert.ok(units[0].text.includes('more efficient'))
  assert.ok(units[1].text.includes('each edge'))
  assert.ok(units[1].text.includes('no negative edges'))
  assert.ok(!units.some(u => u.text.trim() === 'Example'))
})
test('book: joint comparison retains both Edmonds–Karp and scaling explanations', () => {
  const units = split(book('000392').text)
  assert.equal(units.length, 1)
  assert.ok(units[0].text.includes('Edmonds–Karp'))
  assert.ok(units[0].text.includes('O(m2n)'))
  assert.ok(units[0].text.includes('The scaling algorithm'))
  assert.ok(units[0].text.includes('threshold value is divided by 2'))
  assert.ok(units[0].text.includes('Both algorithms'))
})
test('book: hashing common-prefix procedure stays with its dependent next-character step', () => {
  const units = split(book('000515').text)
  const prefix = units.find(u => u.text.includes('By combining hashing and binary search'))
  assert.ok(prefix.text.includes('Once we know the length of the common prefix'))
})
test('book: Bellman–Ford applicability retains its negative-cycle qualification', () => {
  const units = split(book('000272').text)
  const algorithm = units.find(u => u.text.includes('The algorithm can process all kinds of graphs'))
  assert.ok(algorithm.text.includes('Bellman'))
  assert.ok(algorithm.text.includes('does not contain a cycle with negative length'))
})
test('book: unfinished formula and dangling headings are never independent units', () => {
  for (const p of corpus.passages) {
    for (const unit of split(p.text)) {
      assert.ok(!/^(?:Example|Loops|O\()\s*$/.test(unit.text.trim()), `${p.id}: ${unit.text}`)
    }
  }
})
test('independent flattened sentences form pairs, without invented paragraph breaks', () => {
  const a = 'Binary search reduces the search interval in a sorted array.'
  const b = 'Merge sort divides an array into smaller parts.'
  const c = 'Breadth-first search uses a queue to process vertices.'
  const d = 'Depth-first search can use a recursive procedure.'
  const text = [a, b, c, d].join(' ')
  assert.deepEqual(split(text).map(u => u.text), [`${a} ${b} `, `${c} ${d}`])
})
for (const continuation of ['However, the algorithm requires nonnegative edges.', 'It requires nonnegative edges.',
  'This algorithm requires nonnegative edges.', 'Therefore, negative edges are excluded.',
  'For example, a zero-weight edge is permitted.', 'The reason is that distances must not decrease after processing.']) {
  test(`conditions and references stay with named algorithm: ${continuation}`, () => {
    const text = `Dijkstra computes shortest paths. A priority queue selects the next vertex. ${continuation}`
    assert.equal(split(text).length, 1)
    lossless(text, split(text))
  })
}
test('unmarked balanced formula punctuation is not treated as sentence punctuation', () => {
  const text = 'A bound is written as O(n!). An example uses f(x, y). Another procedure has a different bound. A final claim concerns storage.'
  assert.equal(split(text).length, 2)
  assert.ok(split(text)[0].text.includes('O(n!)'))
})
test('initials, abbreviations, decimal notation, and inline math survive prose grouping', () => {
  const text = 'E. W. Dijkstra described a method. Fig. 2 illustrates the graph. A weight may equal 1.25. A bound is $O(n!)$.'
  const units = split(text)
  assert.equal(units.length, 2)
  assert.ok(units[0].text.startsWith('E. W. Dijkstra'))
  assert.ok(units[0].text.includes('Fig. 2'))
  lossless(text, units)
})

test('book: complexity classes preserve the all-the-above reference and exact sets', () => {
  const p = book('000058'), units = split(p.text)
  assert.equal(units.length, 1)
  lossless(p.text, units)
  assert.ok(units.some(u => u.text.includes('{1,2,3}')))
  assert.ok(units.some(u => u.text.includes('O(n k )') && u.text.includes('O(2n )')))
})
test('book: coin denominations and unlimited-use rule retain the problem definition', () => {
  const units = split(book('000136').text)
  const coins = units.find(u => u.text.includes('coins = {c1, c2'))
  assert.ok(coins.text.includes('form a sum of money'))
  assert.ok(coins.text.includes('each coin can be used as many times'))
  assert.ok(coins.text.includes('minimum number of coins'))
})
test('book: prose semicolon does not prevent splitting, nor detach Floyd–Warshall from its behavior', () => {
  const units = split(book('000285').text)
  assert.ok(units.length > 1)
  const floyd = units.find(u => u.text.includes('Floyd–Warshall algorithm4'))
  assert.ok(floyd.text.includes('finds all shortest paths'))
  const queue = units.find(u => u.text.includes('By using negative distances'))
  assert.ok(queue.text.includes('default version of the C++ priority queue finds maximum'))
})
test('book: greedy choice definition stays with its explicit causal explanation', () => {
  const units = split(book('000136').text)
  const definition = units.find(u => u.text.includes('For this reason'))
  assert.ok(definition.text.includes('never takes back its choices'))
})
test('synthetic: prose semicolon and mathematical sets are not code markers', () => {
  const text = 'A set contains the elements {1,2,3}. Membership describes which values belong to it. A graph contains vertices; edges connect pairs of vertices. Paths connect vertices through these edges.'
  const units = split(text)
  assert.equal(units.length, 2)
  lossless(text, units)
})

const annotatedReview = JSON.parse(readFileSync('tests/fixtures/practice-evidence/handbook-reviewed-65.json', 'utf8'))
test('manual review covers all 65 original units exactly once, independently of current splits', () => {
  assert.equal(annotatedReview.units.length, 65)
  assert.equal(new Set(annotatedReview.units.map(u => u.id)).size, 65)
  for (const p of corpus.passages) {
    const rows = annotatedReview.units.filter(u => u.passageId === p.id)
    assert.ok(rows.length > 0)
    lossless(p.text, rows)
    assert.ok(rows.every(u => u.reason && Array.isArray(u.sourceIssues)))
  }
})
for (const [passageId, left, right, description] of [
  ['000058', 'O(n!) This time complexity', 'All the above time complexities', 'complexity list and backward reference'],
  ['000392', 'The Edmonds–Karp algorithm', 'Both algorithms are efficient', 'both compared algorithms'],
  ['000154', 'our task is to form the sum n using as few coins as possible', 'In Chapter 6, we solved the problem', 'coin objective and later problem reference']
]) {
  test(`manual-review regression: ${description} must share a unit`, () => {
    const p = book(passageId)
    const unit = split(p.text).find(u => u.text.includes(right))
    assert.ok(unit?.text.includes(left))
    lossless(p.text, split(p.text))
  })
}
for (const reference of ['Both algorithms can be implemented using a queue.',
  'All the above procedures visit the same vertices.',
  'In Section 4, we solved this problem by exhaustive search.']) {
  test(`synthetic backward-reference fallback: ${reference}`, () => {
    const text = `${proseA} ${proseB} ${proseC} ${reference}`
    assert.equal(split(text).length, 1)
    lossless(text, split(text))
  })
}

// Topic-boundary checks use verbatim book text. These expectations describe
// section identity and necessary context, rather than snapshotting unit counts.
for (const [id, heading, priorText, body] of [
  ['000083', '3. 3 Binary search', 'sort(v. begin()', 'A general method for searching'],
  ['000136', '6. 1 Coin problem', 'The locally optimal choices', 'each coin can be used as many times'],
  ['000139', '6. 2 Scheduling', 'if the coins are {1,3,4}', 'as many events as possible'],
  ['000116', '5. 1 Generating subsets', 'If complete search is too slow', 'There are two common methods'],
  ['000164', '7. 2 Longest increasing subsequence', 'count[x] %= m', 'larger than the previous element'],
  ['000154', '7. 1 Coin problem', 'milestone in every competitive programmer', 'In Chapter 6, we solved the problem'],
  ['000260', '12.1 Depth-first search', 'Both algorithms are given a starting node', 'The algorithm begins at a starting node'],
  ['000272', '13. 1 Bellman–Ford algorithm', 'In an unweighted graph', 'does not contain a cycle with negative length'],
  ['000285', '13. 3 Floyd–Warshall algorithm', 'minimum distance will be processed', 'finds all shortest paths']
]) {
  test(`book topic boundary: ${heading}`, () => {
    const p = book(id), units = split(p.text)
    const target = units.find(u => u.text.trimStart().startsWith(heading))
    assert.ok(target, `Expected section-headed unit: ${heading}`)
    assert.ok(target.text.includes(body), 'Heading must retain its explanation/conditions')
    assert.ok(!target.text.includes(priorText), 'Previous topic must remain separate')
    assert.ok(units.some(u => u.text.includes(priorText)))
    lossless(p.text, units)
  })
}
for (const marker of ['6.1 New section', '6. 1 New section', '6.1.2 New section', '## New section']) {
  test(`synthetic explicit heading: ${marker}`, () => {
    const text = `${proseA}\n${marker}\n${proseB} ${proseC}`
    const units = split(text)
    assert.ok(units.some(u => u.text.startsWith(marker) && u.text.includes(proseB)))
    lossless(text, units)
  })
}
for (const block of [
  '```text\n6.1 Not a real section\n' + proseB + '\n```',
  '$$\n6.1 HeadingLikeVariable\n' + proseB + '\n$$',
  '\\[\n6.1 HeadingLikeVariable\n' + proseB + '\n\\]',
  '`literal. 6.1 Not a real section ' + proseB + '`',
  'if (ready) {\n6.1 Not a real section\n' + proseB + '\n}'
]) {
  test(`heading-like content inside protected structure: ${block.slice(0, 30)}`, () => {
    const text = `${proseA}\n\n${block}\n\n${proseC}`
    assert.ok(split(text).some(u => u.text.includes(block)))
    lossless(text, split(text))
  })
}
test('decimals, citations, and section references do not create headings', () => {
  const text = `${proseA} A weight of 1.25 is permitted. See Section 6.1 for details [12]. ${proseB}`
  assert.ok(!split(text).some(u => /^1\.25|^6\.1/.test(u.text)))
  lossless(text, split(text))
})
test('heading with a backward comparison does not detach its earlier referents', () => {
  const text = `${proseA} ${proseB}\n6.1 Comparison\nBoth algorithms visit the same vertices. ${proseC}`
  assert.equal(split(text).length, 1)
})
test('no empty units are created for a heading at the start or a trailing label', () => {
  const text = `6.1 First section\n${proseA}\n\n6.2 Next section`
  lossless(text, split(text))
  assert.ok(split(text).every(u => u.text.trim().length > 0 && u.text.trim() !== '6.2 Next section'))
})

test('heading-like section text inside an unfenced string literal stays intact', () => {
  const text = `const label = "A message. 6.1 Not a section ${proseB}";\n${proseC}`
  assert.ok(split(text).some(u => u.text.includes(`"A message. 6.1 Not a section ${proseB}"`)))
  lossless(text, split(text))
})
test('quoted prose and contractions do not hide a subsequent real heading', () => {
  const text = `The algorithm's label is "a search procedure". ${proseA}\n6.1 New section\n${proseB} ${proseC}`
  assert.ok(split(text).some(u => u.text.startsWith('6.1 New section')))
  lossless(text, split(text))
})


test('book: Kruskal heading retains preceding minimum-spanning-tree scope', () => {
  const p = book('000308'), units = split(p.text)
  const kruskal = units.find(u => u.text.includes('15. 1 Kruskal'))
  assert.ok(kruskal.text.includes('We focus on finding minimum spanning trees'))
  assert.ok(kruskal.text.includes('processing the edges in reverse order'))
  lossless(p.text, units)
})

const currency = JSON.parse(readFileSync('tests/fixtures/practice-evidence/buzzdb-currency.json', 'utf8'))
for (const line of currency.lines) {
  test(`BuzzDB currency regression: ${line.needle}`, () => {
    const text = `${line.text}\n\n${proseA}\n\n${proseB}`
    const units = split(text)
    assert.ok(!units.some(u => u.text.includes(proseA) && u.text.includes(proseB)), 'Price must not swallow unrelated paragraphs')
    assert.ok(units.some(u => u.text === proseB))
    lossless(text, units)
  })
}
for (const expression of ['$O(n^2)$', '$2^n$', '$100$', '$2n + 1$', '$x + y$', '$\\text{cost} = 50$', '$a.\nb$']) {
  test(`currency fix preserves genuine inline math ${expression}`, () => {
    const text = `${proseA} ${expression}\n\n${proseB}`
    const units = split(text)
    assert.ok(units.some(u => u.text.includes(expression)))
    lossless(text, units)
  })
}
test('single-dollar inline math cannot cross blank paragraphs, including CRLF', () => {
  for (const separator of ['\n\n', '\r\n \t\r\n']) {
    const text = `A sale costs $50.${separator}${proseA}${separator}A second sale costs $100.${separator}${proseB}`
    assert.ok(!split(text).some(u => u.text.includes(proseA) && u.text.includes(proseB)))
    assert.ok(split(text).some(u => u.text.includes(proseB)))
    lossless(text, split(text))
  }
})
test('prices mixed with genuine math do not hide later headings', () => {
  const text = `The prices are $50 and $100, while the bound is $O(n^2)$.\n\n6.1 New section\n${proseA} ${proseB}`
  assert.ok(split(text).some(u => u.text.startsWith('6.1 New section')))
  lossless(text, split(text))
})
test('unmatched single dollar does not swallow later paragraphs or headings', () => {
  const text = `The incomplete expression is $O(n^2).\n\n${proseA}\n\n6.1 Another section\n${proseB} ${proseC}`
  assert.ok(split(text).some(u => u.text.startsWith('6.1 Another section')))
  lossless(text, split(text))
})
test('currency in code stays literal and the complete code remains protected', () => {
  const code = '```cpp\ncout << "$50 and $100";\n\ncout << "$O(n)$";\n```'
  assert.ok(split(`${proseA}\n\n${code}\n\n${proseB}`).some(u => u.text.includes(code)))
})
test('stray closing dollars and escaped currency do not create inline math spans', () => {
  const text = `The escaped price is \\$50 and a stray delimiter follows: $.\n\n${proseA}\n\n${proseB}`
  assert.ok(!split(text).some(u => u.text.includes(proseA) && u.text.includes(proseB)))
  lossless(text, split(text))
})

test('an odd number of real BuzzDB prices cannot absorb unrelated chapters', () => {
  const intro = currency.lines.slice(0, 3).map(line => line.text).join('\n')
  const chapters = Array.from({ length: 20 }, (_, i) => `## Chapter ${i + 1}\n\n${proseA}\n\n${proseB}`)
  const text = `${intro}\n\n${chapters.join('\n\n')}`
  const units = split(text)
  assert.ok(units.length >= 20)
  assert.ok(Math.max(...units.map(u => u.text.length)) < text.length / 2)
  assert.ok(!units.some(u => u.text.includes('## Chapter 1\n') && u.text.includes('## Chapter 20\n')))
  lossless(text, units)
})
