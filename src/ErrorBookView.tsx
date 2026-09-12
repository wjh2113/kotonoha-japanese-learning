import { useContext, useMemo, useState } from 'react'
import { Check, ChevronLeft, NotebookPen, Pause, Play, Trash2, Volume2 } from 'lucide-react'
import { SettingsContext } from './settings-context'
import { speakJapanese } from './speech'
import type { Unit, Word } from './types'
import {
  errorBookWords, matchesErrorBookFilter, pickErrorBookWords, wordKatakana,
  type ErrorBookFilter,
} from './dictation'

const FILTERS: { id: ErrorBookFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'fresh', label: '未复习' },
  { id: 'reviewing', label: '复习中' },
  { id: 'sticky', label: '超标（记不住）' },
  { id: 'mastered', label: '已掌握' },
]

export function ErrorBookView({
  units, onBack, onStart, onRemove, onMaster,
}: {
  units: Unit[]
  onBack: () => void
  onStart: (words: Word[]) => void
  onRemove: (wordId: string, unitId: string) => void
  onMaster: (word: Word, unitId: string) => void
}) {
  const [filter, setFilter] = useState<ErrorBookFilter>('all')
  const [unitFilter, setUnitFilter] = useState('all')
  const entries = useMemo(
    () => units.flatMap((unit) => unit.words.filter((word) => word.wrongBook).map((word) => ({ word, unit }))),
    [units],
  )
  const unitOptions = units.filter((unit) => unit.words.some((word) => word.wrongBook))
  const scoped = entries.filter(({ word, unit }) => (unitFilter === 'all' || unit.id === unitFilter) && matchesErrorBookFilter(word, filter))
  const grouped = unitOptions
    .map((unit) => ({ unit, words: scoped.filter((entry) => entry.unit.id === unit.id).map((entry) => entry.word) }))
    .filter((group) => group.words.length)
  const due = entries.filter(({ word }) => !word.mastered).length
  const counts = Object.fromEntries(FILTERS.map((item) => [
    item.id,
    errorBookWords(
      entries.filter(({ unit }) => unitFilter === 'all' || unit.id === unitFilter).map(({ word }) => word),
      item.id,
    ).length,
  ])) as Record<ErrorBookFilter, number>
  const startWords = pickErrorBookWords(scoped.map((entry) => entry.word))

  return (
    <div className="page errorbook-page">
      <button className="back-link" onClick={onBack}><ChevronLeft size={17} />返回</button>
      <section className="errorbook-hero">
        <div>
          <span className="eyebrow">WRONG WORD BOOK</span>
          <h1>错词本</h1>
          <p>听写拼错过的词会自动收进来。先过一遍，再针对没记住的词继续听写。</p>
          <small>已掌握 {entries.filter(({ word }) => word.mastered).length}/{entries.length}，复习中 {counts.reviewing}，未复习 {counts.fresh}</small>
        </div>
        <aside>
          <b>建议今日复习</b>
          <strong>{due}</strong>
          <span>词</span>
          <button className="primary-button" disabled={!startWords.length} onClick={() => onStart(startWords)}>
            <Play size={16} />开始学习
          </button>
        </aside>
      </section>

      {unitOptions.length > 1 && (
        <div className="errorbook-units">
          <button className={unitFilter === 'all' ? 'active' : ''} onClick={() => setUnitFilter('all')}>全部单元</button>
          {unitOptions.map((unit) => (
            <button key={unit.id} className={unitFilter === unit.id ? 'active' : ''} onClick={() => setUnitFilter(unit.id)}>{unit.name}</button>
          ))}
        </div>
      )}

      <div className="filter-tabs errorbook-tabs">
        {FILTERS.map((item) => (
          <button key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}>
            {item.label}<span>{counts[item.id]}</span>
          </button>
        ))}
      </div>

      {grouped.length ? grouped.map(({ unit, words }) => (
        <section key={unit.id} className="errorbook-group">
          <h2><i />{unit.name}</h2>
          <div className="errorbook-list">
            {words.map((word) => (
              <article key={word.id} className="errorbook-row">
                <ErrorBookSpeak word={word} />
                <div>
                  <b className="jp">{word.term}</b>
                  <span className="jp">{wordKatakana(word) || word.reading}</span>
                </div>
                <p>{word.partOfSpeech ? `${word.partOfSpeech}　` : ''}{word.meaning}</p>
                <div className="errorbook-row-actions">
                  {!word.mastered && <button onClick={() => onMaster(word, unit.id)}><Check size={14} />掌握</button>}
                  <button className="remove-word" onClick={() => onRemove(word.id, unit.id)}><Trash2 size={14} />移出</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )) : (
        <div className="wide-empty">
          <NotebookPen />
          <h2>{entries.length ? '这一栏暂时没有单词' : '错词本还是空的'}</h2>
          <p>{entries.length ? '换一个筛选看看，或直接去听写。' : '听写写错的词会自动收录到这里，方便你继续复习。'}</p>
        </div>
      )}
    </div>
  )
}

function ErrorBookSpeak({ word }: { word: Word }) {
  const [speaking, setSpeaking] = useState(false)
  const { voiceGender } = useContext(SettingsContext)
  return (
    <button
      className={`volume-button small ${speaking ? 'speaking' : ''}`}
      aria-label="朗读"
      onClick={async () => {
        await speakJapanese(word.term, voiceGender, {
          onStart: () => setSpeaking(true),
          onEnd: () => setSpeaking(false),
        })
      }}
    >
      {speaking ? <Pause size={14} /> : <Volume2 size={14} />}
    </button>
  )
}
