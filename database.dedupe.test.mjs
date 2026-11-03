import { describe, it, expect } from 'vitest'
import pg from 'pg'
import { createDatabase } from './database.mjs'
import fs from 'node:fs/promises'
const url = process.env.KOTONOHA_TEST_DATABASE_URL
;(url ? describe : describe.skip)('word dedupe integration', () => {
  it('merges progress, rejects repeat and concurrent imports, ignores stale IDs and allows edits', async () => {
    const c = new pg.Client({connectionString:url}); await c.connect()
    const db=createDatabase(url)
    const uid=`dedupe-${Date.now()}`
    try {
      await db.initialize()
      await db.createUnit({id:uid,name:'去重测试'})
      // Recreate legacy duplicates only inside this isolated test database.
      await c.query('DROP INDEX words_unit_term_reading_unique')
      await c.query(`INSERT INTO words(id,unit_id,term,reading,meaning,starred,listening_wrong) VALUES ($1,$3,'水','みず','水',false,2),($2,$3,'水','みず','水',true,5)`,[uid+'a',uid+'b',uid])
      await c.query(await fs.readFile(new URL('./db/dedupe-words.sql',import.meta.url),'utf8'))
      let state=await db.getState(); let unit=state.units.find(x=>x.id===uid)
      expect(unit.words).toHaveLength(1);expect(unit.words[0].starred).toBe(true);expect(unit.words[0].listeningWrong).toBe(5)
      const keeper=unit.words[0]
      const repeated=await db.appendWords(uid,[{id:uid+'c',term:'水',reading:'みず',meaning:'水'}])
      expect(repeated.words).toHaveLength(0);expect(repeated.droppedCount).toBe(1)
      const concurrent=await Promise.all(['d','e'].map(s=>db.appendWords(uid,[{id:uid+s,term:'火',reading:'ひ',meaning:'火'}])))
      expect(concurrent.reduce((n,r)=>n+r.words.length,0)).toBe(1)
      await db.replaceState({units:[{...unit,words:[{...keeper,id:uid+'stale',starred:false,listeningWrong:0}]}],settings:state.settings})
      state=await db.getState(); unit=state.units.find(x=>x.id===uid)
      expect(unit.words).toHaveLength(2);expect(unit.words.find(x=>x.term==='水').listeningWrong).toBe(5)
      await db.replaceState({units:[{...unit,words:[{...keeper,term:'お水'}]}],settings:state.settings})
      expect((await db.getState()).units.find(x=>x.id===uid).words.some(x=>x.term==='お水')).toBe(true)
    } finally {await c.query('DELETE FROM units WHERE id=$1',[uid]);await c.end();await db.close()}
  })
})
