import { describe, it, expect, beforeEach, beforeAll } from '@jest/globals'
import request from 'supertest'
import { app } from '../src/server'
import { pool, initDb } from '../src/db'


async function resetDatabase () {
  await initDb()
  await query('DELETE FROM cities')
}

async function query (sql: string) {
  const client = await pool.connect()
  const result = await client.query(sql)
  client.release()
  return result
}


describe('Database Connection', () => {
  beforeAll(async () => {
    await resetDatabase()
  })

  it('should connect to the testdb database', async () => {
    const res = await pool.query('SELECT current_database()')
    expect(res.rows[0].current_database).toBe('testdb')
  })
})


describe('Bulk insert API', () => {
  beforeAll(async () => {
    await resetDatabase()
  })

  it('should insert all the data in a file', async () => {
    const res = await request(app)
      .post('/bulk-insert')
      .attach('file', 'tests/fixtures/sample.json')

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('status')
    expect(res.body).toHaveProperty('processed')
    expect(res.body.status).toBe('completed')
    expect(res.body.processed).toBe(100)
    const result = await query('SELECT count(*) from cities;')
    const processedCnt = parseInt(result.rows[0].count)
    expect(processedCnt).toBe(100)
  })
  
  describe('async=true', () => {
    beforeAll(async () => {
      await resetDatabase()
    })

    let jobId: string

    it('should start an async bulk insert and return 202 with Location header', async () => {
      const res = await request(app)
        .post('/bulk-insert?async=true')
        .attach('file', 'tests/fixtures/sample.json')

      expect(res.status).toBe(202)
      expect(res.headers.location).toMatch(/\/status\//)
      expect(res.body).toHaveProperty('jobId')
      expect(res.body).toHaveProperty('status')
      expect(res.body).toHaveProperty('processed')
      expect(res.body.status).toBe('in-progress')
      expect(res.body.processed).toBe(0)

      jobId = res.body.jobId
    })


    it('should return initial status', async () => {
      const statusRes1 = await request(app).get(`/bulk-insert/status/${jobId}`)
      expect(statusRes1.status).toBe(200)
      expect(statusRes1.body).toHaveProperty('status')
      expect(statusRes1.body).toHaveProperty('processed')
      expect(statusRes1.body.status).toBe('in-progress')
      expect(statusRes1.body.processed).toBe(0)
    })


    it('should return completed status', async () => {
      await new Promise((r) => setTimeout(r, 2000))

      const statusRes2 = await request(app).get(`/bulk-insert/status/${jobId}`)
      expect(statusRes2.status).toBe(200)
      expect(statusRes2.body).toHaveProperty('status')
      expect(statusRes2.body).toHaveProperty('processed')
      expect(statusRes2.body.status).toBe('completed')
      expect(statusRes2.body.processed).toBe(100)
      const result = await query('SELECT count(*) from cities;')
      const processedCnt = parseInt(result.rows[0].count)
      expect(processedCnt).toBe(100)
    })
  })

  it('should return 404 for an unknown job ID', async () => {
    const res = await request(app).get('/bulk-insert/status/unknown-job-id')
    expect(res.status).toBe(404)
  })
})
